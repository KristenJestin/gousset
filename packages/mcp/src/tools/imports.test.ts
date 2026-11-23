import {
  DataExport,
  EmptyFile,
  FileTooLarge,
  FixtureLedger,
  IMPORTS_LISTED,
  ImportBusy,
  ImportNotFound,
  ImportProfiles,
  Imports,
  UnknownFormat,
  memoryAccountStore,
  memoryLineStore,
} from "@gousset/core";
import type {
  ImportAccount,
  ImportProfileEntry,
  ImportSummary,
  ProfilesForImport,
  Started,
  Undone,
  Upload,
} from "@gousset/core";
import { Effect, Fiber, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, test } from "vite-plus/test";

import { goussetServer } from "../gousset";
import type { GoussetServices } from "../gousset";
import { ERROR_LIMIT, RESULT_LIMIT } from "../results";
import { callText, connectInProcess } from "../test-client";
import type { Caller, Runner } from "../tool";

const writer: Caller = { userId: "ada", canWrite: true };
const reader: Caller = { userId: "ada", canWrite: false };

const idOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const CURRENT: ImportAccount = {
  id: idOf(900),
  name: "Current account",
  currency: "EUR",
  institution: "Banque Exemple",
};

const SAVINGS: ImportAccount = {
  id: idOf(901),
  name: "Savings",
  currency: "EUR",
  institution: "Banque Exemple",
};

/** A done import of the example statement, with what a test changes. */
function summary(changes: Partial<ImportSummary> = {}): ImportSummary {
  return {
    id: idOf(1),
    fileName: "october.xml",
    format: "camt053",
    status: "done",
    waitingFor: null,
    account: { id: CURRENT.id, name: CURRENT.name },
    periodFrom: "2026-10-01",
    periodTo: "2026-10-31",
    linesRead: 6,
    linesAdded: 6,
    linesDuplicate: 0,
    linesHeld: 0,
    errorCode: null,
    jobId: "job-1",
    createdAt: "2026-11-20T10:00:00.000Z",
    finishedAt: "2026-11-20T10:00:02.000Z",
    undoneAt: null,
    ...changes,
  };
}

type Fake = {
  /** The user's imports, newest first. */
  readonly imports: Array<ImportSummary>;
  readonly accounts: ReadonlyArray<ImportAccount>;
  /** What each upload was started with. */
  readonly uploads: Array<Upload>;
  /** The import an upload starts, as `start` answers it. */
  started: ImportSummary;
  /** What `show` answers for it afterwards; it stays as started when null. */
  settled: ImportSummary | null;
  sameFile: Started["sameFile"];
  startFailure: EmptyFile | FileTooLarge | UnknownFormat | null;
  undoCounts: Omit<Undone, "undone">;
  /** The user's profiles and the shipped ones, as `ImportProfiles.list` gives them. */
  profiles: ReadonlyArray<ImportProfileEntry>;
  /** What `ImportProfiles.forImport` answers, by import id. */
  profilesFor: { [importId: string]: ProfilesForImport };
};

function fake(changes: Partial<Fake> = {}): Fake {
  return {
    imports: [],
    accounts: [CURRENT, SAVINGS],
    uploads: [],
    started: summary(),
    settled: null,
    sameFile: null,
    startFailure: null,
    undoCounts: { linesRemoved: 6, linesGivenBack: 0, laterOverlapping: 0, months: ["2026-10"] },
    profiles: [],
    profilesFor: {},
    ...changes,
  };
}

/** `ImportProfiles` over the fake's lists: no database, no file read. */
function profilesOf(state: Fake) {
  return Layer.mock(ImportProfiles, {
    list: () => Effect.succeed(state.profiles),
    forImport: (_owner, importId) => {
      const found = state.profilesFor[importId];

      return found === undefined
        ? Effect.fail(new ImportNotFound({ importId }))
        : Effect.succeed(found);
    },
  });
}

/** `Imports` over the fake's in-memory list: no database. */
function importsOf(state: Fake) {
  const find = (importId: string) => {
    const found = state.imports.find((each) => each.id === importId);

    return found === undefined
      ? Effect.fail(new ImportNotFound({ importId }))
      : Effect.succeed(found);
  };

  return Layer.succeed(Imports, {
    start: (_owner, upload) => {
      state.uploads.push(upload);

      if (state.startFailure !== null) {
        return Effect.fail(state.startFailure);
      }

      state.imports.unshift(state.settled ?? state.started);

      return Effect.succeed({ started: state.started, sameFile: state.sameFile });
    },
    show: (_owner, importId) => find(importId),
    list: (_owner, before) => {
      const start = before === null ? 0 : state.imports.findIndex((each) => each.id === before) + 1;

      const page = state.imports.slice(start, start + IMPORTS_LISTED);
      const more = state.imports.length > start + IMPORTS_LISTED;

      return Effect.succeed({ imports: page, next: more ? (page.at(-1)?.id ?? null) : null });
    },
    undo: (_owner, importId) =>
      Effect.flatMap(find(importId), (found) =>
        found.status === "done" || found.status === "waiting" || found.status === "failed"
          ? Effect.succeed({ undone: { ...found, status: "undone" as const }, ...state.undoCounts })
          : Effect.fail(new ImportBusy({ importId, status: found.status })),
      ),
    resume: (_owner, importId) => find(importId),
    accounts: () => Effect.succeed(state.accounts),
    csvQuestions: (_owner, importId) => Effect.fail(new ImportNotFound({ importId })),
  });
}

/** The app's runtime for these tests: the made-up ledger, no accounts, and the fake imports. */
function runnerOf(state: Fake): Runner<GoussetServices> {
  return (effect) =>
    Effect.runPromiseExit(
      Effect.provide(
        effect,
        Layer.mergeAll(
          FixtureLedger,
          memoryAccountStore(),
          memoryLineStore(),
          importsOf(state),
          profilesOf(state),
          Layer.mock(DataExport, {}),
        ),
      ),
    );
}

/** The same, on a test clock moved 40 seconds on: an upload that waits gives up meanwhile. */
function runnerWithTime(state: Fake): Runner<GoussetServices> {
  return (effect) =>
    Effect.runPromiseExit(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(effect);

        for (let second = 0; second < 40; second += 1) {
          yield* TestClock.adjust("1 second");
        }

        return yield* Fiber.join(fiber);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            FixtureLedger,
            memoryAccountStore(),
            memoryLineStore(),
            importsOf(state),
            profilesOf(state),
            Layer.mock(DataExport, {}),
            TestClock.layer(),
          ),
        ),
      ),
    );
}

async function imports(
  state: Fake,
  args: { [key: string]: string },
  caller: Caller = writer,
  run: Runner<GoussetServices> = runnerOf(state),
) {
  const client = await connectInProcess(goussetServer, { run }, caller, "2025-11-25");

  return callText(client, "imports", args);
}

const CAMT = '<?xml version="1.0"?><Document>made up</Document>';

const upload = (changes: { [key: string]: string } = {}) => ({
  action: "upload",
  file_name: "october.xml",
  content: CAMT,
  ...changes,
});

/** The valid call a refusal writes, read back: its action is one of the tool's. */
function exampleOf(text: string) {
  const written = /A valid call: imports (\{.*\})$/.exec(text)?.[1];

  expect(written, text).toBeDefined();

  return Schema.decodeUnknownSync(Example)(JSON.parse(written ?? "{}"));
}

const Example = Schema.Struct({
  action: Schema.Literals(["upload", "status", "list", "undo", "profiles"]),
  account: Schema.optional(Schema.String),
  format: Schema.optional(Schema.String),
  import: Schema.optional(Schema.String),
});

describe("imports upload", () => {
  test("answers the summary once the import is done", async () => {
    const state = fake({ started: summary({ status: "queued", linesRead: 0, linesAdded: 0 }) });

    state.settled = summary();

    const { text, isError } = await imports(state, upload());

    expect(isError).toBe(false);
    expect(text).toContain("Imported october.xml into Current account, 2026-10-01 to 2026-10-31.");
    expect(text).toContain(
      "6 lines read: 6 added, 0 already known (duplicates), 0 held for review as near duplicates.",
    );
    expect(text).toContain(`Import id: ${idOf(1)}`);
    expect(state.uploads).toHaveLength(1);
    expect(new TextDecoder().decode(state.uploads[0]?.content)).toBe(CAMT);
    expect(state.uploads[0]?.format).toBeNull();
    expect(state.uploads[0]?.accountId).toBeNull();
  });

  test("says first that the same file was already imported, and that nothing is added twice", async () => {
    const state = fake({
      started: summary({ id: idOf(2), linesAdded: 0, linesDuplicate: 6 }),
      sameFile: { fileName: "october.xml", importedAt: "2026-11-20T10:00:00.000Z" },
    });

    const { text } = await imports(state, upload());

    expect(text).toMatch(
      /^This same file was already imported, as october\.xml on 2026-11-20: nothing is added twice\./,
    );
    expect(text).toContain("6 lines read: 0 added, 6 already known (duplicates)");
  });

  test("an import waiting for its account says which account argument to pass", async () => {
    const state = fake({
      started: summary({ status: "waiting", waitingFor: "account", account: null, format: "qif" }),
    });

    const { text, isError } = await imports(state, upload({ file_name: "october.qif" }));

    expect(isError).toBe(false);
    expect(text).toContain("waits for its account");
    expect(text).toContain("The user's accounts: Current account, Savings.");
    expect(text).toContain('"account":"Current account"');
    expect(text).toContain("import screen");
  });

  test("an import waiting for its CSV columns sends the user to the import screen", async () => {
    const state = fake({
      started: summary({ status: "waiting", waitingFor: "profile", format: "csv" }),
    });

    const { text } = await imports(state, upload({ file_name: "export.csv", account: "savings" }));

    expect(text).toContain("CSV columns to be confirmed");
    expect(text).toContain("Gousset's import screen");
    expect(text).toContain('"action":"status"');
  });

  test("a failed import says why in words, with what to do", async () => {
    const state = fake({
      started: summary({ status: "failed", errorCode: "CURRENCY_MISMATCH", linesAdded: 0 }),
    });

    const { text } = await imports(state, upload());

    expect(text).toContain("failed");
    expect(text).toContain("currency is not its account's");
  });

  test("an import still running after the wait says how to follow it", async () => {
    const state = fake({ started: summary({ status: "reading", linesRead: 0 }) });
    const { text, isError } = await imports(state, upload(), writer, runnerWithTime(state));

    expect(isError).toBe(false);
    expect(text).toContain("still running");
    expect(text).toContain(`imports {"action":"status","import":"${idOf(1)}"}`);
  });

  test("matches the account by its name, in any case", async () => {
    const state = fake();

    await imports(state, upload({ account: "  SAVINGS " }));

    expect(state.uploads[0]?.accountId).toBe(SAVINGS.id);
  });

  test("refuses an account name that matches none, naming the accounts there are", async () => {
    const state = fake();
    const { text, isError } = await imports(state, upload({ account: "Joint" }));

    expect(isError).toBe(true);
    expect(text).toContain("No account is named Joint.");
    expect(text).toContain("The user's accounts: Current account, Savings.");
    expect(exampleOf(text).account).toBe("Current account");
    expect(state.uploads).toHaveLength(0);
  });

  test("refuses an account name that matches several", async () => {
    const state = fake({
      accounts: [CURRENT, { ...CURRENT, id: idOf(902), name: "current account" }],
    });

    const { text, isError } = await imports(state, upload({ account: "Current Account" }));

    expect(isError).toBe(true);
    expect(text).toContain("Several accounts are named Current Account");
    expect(text).toContain("Current account, current account");
    expect(state.uploads).toHaveLength(0);
  });

  test("takes the file as base64 too", async () => {
    const state = fake();
    const base64 = btoa(CAMT);

    const { isError } = await imports(state, {
      action: "upload",
      file_name: "october.xml",
      content_base64: base64,
    });

    expect(isError).toBe(false);
    expect(new TextDecoder().decode(state.uploads[0]?.content)).toBe(CAMT);
  });

  test("refuses content and content_base64 both, or neither", async () => {
    const state = fake();
    const both = await imports(state, upload({ content_base64: btoa(CAMT) }));
    const neither = await imports(state, { action: "upload", file_name: "october.xml" });

    expect(both.isError).toBe(true);
    expect(both.text).toContain("not both");
    expect(neither.isError).toBe(true);
    expect(neither.text).toContain("content_base64");
    expect(exampleOf(neither.text).action).toBe("upload");
    expect(state.uploads).toHaveLength(0);
  });

  test("a request too large never reaches the tool: the SDK refuses it unread", async () => {
    const state = fake();
    const huge = "A".repeat(5 * 1024 * 1024);

    await expect(
      imports(state, { action: "upload", file_name: "big.csv", content: huge }),
    ).rejects.toThrow("Payload Too Large");
    expect(state.uploads).toHaveLength(0);
  });
});

describe("imports with a read-only connection", () => {
  test("refuses upload and undo with the scope message, and still lists and shows", async () => {
    const state = fake({ imports: [summary()] });
    const uploaded = await imports(state, upload(), reader);
    const undone = await imports(state, { action: "undo", import: idOf(1) }, reader);
    const listed = await imports(state, { action: "list" }, reader);
    const shown = await imports(state, { action: "status", import: idOf(1) }, reader);

    for (const refused of [uploaded, undone]) {
      expect(refused.isError).toBe(true);
      expect(refused.text).toContain("allowed to read only");
      expect(refused.text).toContain("Read and write");
    }

    expect(state.uploads).toHaveLength(0);
    expect(listed.isError).toBe(false);
    expect(listed.text).toContain("october.xml");
    expect(shown.isError).toBe(false);
    expect(shown.text).toContain("october.xml (camt053): done: all 3 steps");
  });
});

describe("imports status", () => {
  test("says the import's step, counts, account and period", async () => {
    const state = fake({
      imports: [summary({ status: "saving", linesAdded: 0 }), summary({ id: idOf(2) })],
    });

    const { text } = await imports(state, { action: "status", import: idOf(1) });

    expect(text).toContain("october.xml (camt053): running: step save (3 of 3).");
    expect(text).toContain("Account: Current account. Period: 2026-10-01 to 2026-10-31.");
    expect(text).toContain("6 lines read: 0 added");
  });

  test("refuses an import the user does not have, pointing to list", async () => {
    const { text, isError } = await imports(fake(), { action: "status", import: idOf(7) });

    expect(isError).toBe(true);
    expect(text).toContain("no import with the id");
    expect(exampleOf(text).action).toBe("list");
  });
});

describe("imports list", () => {
  test("fifty long imports stay under the limit and write the call for the older ones", async () => {
    const many = Array.from({ length: IMPORTS_LISTED + 1 }, (_, n) =>
      summary({
        id: idOf(n + 1),
        fileName: `${"statement-of-a-very-long-name-".repeat(10)}${n}.xml`,
        account: { id: CURRENT.id, name: "An account with a long name ".repeat(8) },
        linesRead: 12_345,
        linesAdded: 12_000,
        linesDuplicate: 300,
        linesHeld: 45,
      }),
    );

    const state = fake({ imports: many });
    const first = await imports(state, { action: "list" });
    const last = many[IMPORTS_LISTED - 1]?.id ?? "";

    expect(first.isError).toBe(false);
    expect(first.text.length).toBeLessThan(RESULT_LIMIT);
    expect(first.text).not.toContain("Part 1 of");
    expect(first.text.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(50);
    expect(first.text).toContain(`Older imports: imports {"action":"list","before":"${last}"}`);

    const older = await imports(state, { action: "list", before: last });

    expect(older.text).toContain(`Id: ${idOf(IMPORTS_LISTED + 1)}`);
    expect(older.text).toContain("These are all of them.");
  });
});

describe("imports undo", () => {
  test("says what was removed, what counts again, and the later imports that overlap", async () => {
    const state = fake({
      imports: [summary()],
      undoCounts: { linesRemoved: 6, linesGivenBack: 2, laterOverlapping: 1, months: ["2026-10"] },
    });

    const { text, isError } = await imports(state, { action: "undo", import: idOf(1) });

    expect(isError).toBe(false);
    expect(text).toContain(
      "Undid the import of october.xml (Current account, 2026-10-01 to 2026-10-31): 6 lines removed.",
    );
    expect(text).toContain("2 lines of other imports count again");
    expect(text).toContain("1 later imports of this account overlap its period");
    expect(text).toContain("Importing its file again brings them back.");
  });

  test("says nothing of overlap when no later import overlaps", async () => {
    const state = fake({ imports: [summary()] });
    const { text } = await imports(state, { action: "undo", import: idOf(1) });

    expect(text).toContain("6 lines removed.");
    expect(text).not.toContain("overlap");
    expect(text).not.toContain("count again");
  });

  test("refuses an import still running, and one already undone", async () => {
    const state = fake({
      imports: [summary({ status: "reading" }), summary({ id: idOf(2), status: "undone" })],
    });

    const running = await imports(state, { action: "undo", import: idOf(1) });
    const undone = await imports(state, { action: "undo", import: idOf(2) });

    expect(running.isError).toBe(true);
    expect(running.text).toContain("still running");
    expect(exampleOf(running.text).action).toBe("status");
    expect(undone.isError).toBe(true);
    expect(undone.text).toContain("already undone");
  });
});

describe("imports refusals", () => {
  const megabytes = 1024 * 1024;

  const longNames = Array.from({ length: 200 }, (_, n) => ({
    ...CURRENT,
    id: idOf(1000 + n),
    name: `A savings account with a long name ${n}`,
  }));

  const cases: ReadonlyArray<[string, Partial<Fake>, { [key: string]: string }, string]> = [
    ["empty file", { startFailure: new EmptyFile() }, upload(), "empty"],
    [
      "file too large",
      { startFailure: new FileTooLarge({ bytes: 12 * megabytes, limit: 10 * megabytes }) },
      upload(),
      "10 MB at most",
    ],
    ["unknown format", { startFailure: new UnknownFormat() }, upload(), "Name it with format"],
    ["no file name", {}, { action: "upload", content: CAMT }, "file_name"],
    ["unknown account among many", { accounts: longNames }, upload({ account: "Joint" }), "Joint"],
    ["bad base64", {}, { action: "upload", file_name: "a.ofx", content_base64: "%%%" }, "base64"],
    ["status without an import", {}, { action: "status" }, "needs import"],
    ["undo of an unknown import", {}, { action: "undo", import: "nope" }, "no import"],
    ["profiles of an unknown import", {}, { action: "profiles", import: "nope" }, "no CSV import"],
  ];

  for (const [name, changes, args, says] of cases) {
    test(`${name}: under ${ERROR_LIMIT} characters, with a valid call`, async () => {
      const { text, isError } = await imports(fake(changes), args);

      expect(isError, name).toBe(true);
      expect(text, name).toContain(says);
      expect(text.length, name).toBeLessThan(ERROR_LIMIT);
      expectValidExample(text);
    });
  }
});

function expectValidExample(text: string) {
  expect(exampleOf(text).action).toMatch(/^(upload|status|list|undo|profiles)$/);
}

type CsvProfile = NonNullable<ImportProfileEntry["definition"]>;

const DEBIT_CREDIT: CsvProfile = {
  version: 1,
  separator: ";",
  encoding: "windows-1252",
  skipRows: 3,
  headerRow: true,
  dateFormat: "DD/MM/YYYY",
  decimalMark: ",",
  columns: {
    bookedOn: 1,
    valueOn: 2,
    amount: { kind: "debit-credit", debit: 4, credit: 5 },
    label: 3,
    memo: null,
    bankId: null,
    currency: null,
  },
};

const RIVERSIDE: ImportProfileEntry = {
  source: "stored",
  id: idOf(500),
  name: "Riverside current account",
  institution: "Riverside Bank",
  kind: "statement",
  header: "date;date de valeur;libellé;débit;crédit",
  definition: DEBIT_CREDIT,
};

const BROKEN: ImportProfileEntry = {
  source: "stored",
  id: idOf(501),
  name: "Old card export",
  institution: null,
  kind: "statement",
  header: null,
  definition: null,
};

const US_STYLE: ImportProfileEntry = {
  source: "shipped",
  key: "us-signed",
  name: "US style: one signed amount, month first",
  institution: null,
  kind: "statement",
  header: "date;description;amount;running bal.",
  definition: {
    ...DEBIT_CREDIT,
    separator: ",",
    encoding: "utf8",
    skipRows: 0,
    dateFormat: "MM/DD/YYYY",
    decimalMark: ".",
    columns: { ...DEBIT_CREDIT.columns, valueOn: null, amount: { kind: "signed", column: 3 } },
  },
};

const SHIPPED: ReadonlyArray<ImportProfileEntry> = [US_STYLE];

describe("imports profiles", () => {
  test("lists the user's profiles and the shipped ones, by name, with what each reads", async () => {
    const state = fake({ profiles: [RIVERSIDE, BROKEN, ...SHIPPED] });
    const { text, isError } = await imports(state, { action: "profiles" }, reader);

    expect(isError).toBe(false);
    expect(text).toContain(
      "- Riverside current account (Riverside Bank), the user's: separated by semicolons, encoded windows-1252, 3 lines skipped above a header row, dates DD/MM/YYYY, decimal comma, debit in column 4 and credit in column 5.",
    );
    expect(text).toContain("- Old card export, the user's: its definition can no longer be read");
    expect(text).toContain(
      "- US style: one signed amount, month first, shipped with Gousset: separated by commas, encoded utf8, a header row, dates MM/DD/YYYY, decimal point, one signed amount in column 3.",
    );
    expect(text).toContain('imports {"action":"profiles","import":"<a CSV import\'s id>"}');
    expect(text).not.toContain(idOf(500));
  });

  test("with an import, says which profiles read its file, and the one it used", async () => {
    const [french] = SHIPPED;

    if (french === undefined) {
      throw new Error("No profile is shipped.");
    }

    const state = fake({
      profilesFor: {
        [idOf(3)]: {
          fileName: "export.csv",
          status: "done",
          used: RIVERSIDE,
          fitting: [
            { profile: RIVERSIDE, by: "header" },
            { profile: french, by: "header" },
            { profile: { ...BROKEN, definition: DEBIT_CREDIT }, by: "test-read" },
          ],
        },
      },
    });

    const { text, isError } = await imports(state, { action: "profiles", import: idOf(3) }, reader);

    expect(isError).toBe(false);
    expect(text).toContain("Profiles that read export.csv:");
    expect(text).toContain(
      "- Riverside current account (Riverside Bank), the user's: its header row is the file's.",
    );
    expect(text).toContain(`- ${french.name}, shipped with Gousset: its header row is the file's.`);
    expect(text).toContain(
      "- Old card export, the user's: a test read of the file's first lines succeeds.",
    );
    expect(text).toContain("This import read its file with Riverside current account.");
  });

  test("with an import no profile reads, says the import screen proposes its columns", async () => {
    const state = fake({
      profilesFor: {
        [idOf(4)]: { fileName: "odd.csv", status: "waiting", used: null, fitting: [] },
      },
    });

    const { text, isError } = await imports(state, { action: "profiles", import: idOf(4) });

    expect(isError).toBe(false);
    expect(text).toContain("No profile reads odd.csv");
    expect(text).toContain("import screen");
    expect(text).toContain("No profile has read it yet (it is waiting).");
  });

  test("with a done import that names no profile, says it may have used one deleted since", async () => {
    const state = fake({
      profilesFor: {
        [idOf(5)]: { fileName: "gone.csv", status: "done", used: null, fitting: [] },
      },
    });

    const { text, isError } = await imports(state, { action: "profiles", import: idOf(5) });

    expect(isError).toBe(false);
    expect(text).toContain(
      "This import names no profile Gousset still has: its columns were detected or confirmed on Gousset's import screen, or the profile it used was deleted since or is no longer shipped.",
    );
  });

  test("a long list stays under the limit, in parts that write the next call", async () => {
    const many = Array.from({ length: 400 }, (_, n) => ({
      ...RIVERSIDE,
      id: idOf(1000 + n),
      name: `${"A profile with a very long name ".repeat(6)}${n}`,
      institution: "An institution with a long name ".repeat(4),
    }));

    const { text, isError } = await imports(fake({ profiles: many }), { action: "profiles" });

    expect(isError).toBe(false);
    expect(text.length).toBeLessThan(RESULT_LIMIT);
    expect(text).toContain('"cursor"');
  });
});
