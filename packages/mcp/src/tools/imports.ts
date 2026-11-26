import {
  IMPORT_STEPS,
  ImportProfiles,
  Imports,
  MAX_PENDING_UPLOADS,
  MAX_UPLOAD_PARTS,
  UPLOAD_MINUTES,
} from "@gousset/core";
import type {
  CreatedUpload,
  CsvPreview,
  CsvReadRefusal,
  FileUploadStatus,
  ImportAccount,
  ImportFormat,
  ImportPage,
  ImportProfileEntry,
  ImportSummary,
  ProfileChoice,
  ProfilesForImport,
  Started,
  Undone,
} from "@gousset/core";
import { CsvDefinition, findsColumnsByName, isPlace, minorDigits } from "@gousset/import";
import { Cause, Duration, Effect, Exit, Schema } from "effect";

import { ToolRefusal, defineTool } from "../tool";
import type { Caller } from "../tool";

const FORMATS = ["ofx", "qfx", "qif", "camt053", "mt940", "csv"] as const;

/** A broker's operations profile, as an agent writes one (`OperationsProfile`, version 2). */
export const PROFILE_EXAMPLE = JSON.stringify({
  version: 2,
  reads: "operations",
  separator: ";",
  encoding: "utf8",
  skipRows: 0,
  headerRow: true,
  dateFormat: "DD/MM/YYYY",
  decimalMark: ",",
  columns: { bookedOn: 1, kind: 2, isin: 3, securityName: 4, quantity: 5, unitPrice: 6, amount: 7 },
  kinds: [
    { word: "Achat", kind: "purchase" },
    { word: "Vente", kind: "sale" },
  ],
  referenceUnique: false,
});

/** An account's statement profile (`CsvProfile`, version 1): every column, `null` where none. */
export const STATEMENT_EXAMPLE = JSON.stringify({
  version: 1,
  separator: ";",
  encoding: "utf8",
  skipRows: 0,
  headerRow: true,
  dateFormat: "DD/MM/YYYY",
  decimalMark: ",",
  columns: {
    bookedOn: 1,
    valueOn: null,
    amount: { kind: "signed", column: 3 },
    label: 2,
    memo: null,
    bankId: null,
    currency: null,
  },
});

const ImportsInput = Schema.Struct({
  action: Schema.Literals([
    "upload",
    "create_upload",
    "status",
    "list",
    "undo",
    "profiles",
    "test_profile",
    "save_profile",
    "confirm",
  ]).annotate({
    description:
      "upload: import a statement file. create_upload: an address to send a large file to from a shell, before upload. status: where one import or file upload stands. list: the imports, newest first. undo: remove what one import added. profiles: the CSV import profiles, or those that read one import's file. test_profile: read a waiting CSV import's file with a profile you write. save_profile: keep that profile as the user's. confirm: import the waiting file with a profile.",
  }),
  file_name: Schema.optional(
    Schema.String.annotate({
      description: "upload: the file's name, with its extension (statement-2026-10.ofx).",
    }),
  ),
  content: Schema.optional(
    Schema.String.annotate({ description: "upload: the file's text, whole, as it is." }),
  ),
  content_base64: Schema.optional(
    Schema.String.annotate({
      description:
        "upload, instead of content: the file's bytes in base64, for a file not in UTF-8.",
    }),
  ),
  file_upload: Schema.optional(
    Schema.String.annotate({
      description:
        "upload, instead of content: the id create_upload gave, once the file was sent to its address. status: that id, to see whether the file arrived.",
    }),
  ),
  size: Schema.optional(
    Schema.Int.annotate({
      description: "create_upload: the file's exact size in bytes (wc -c < statement.ofx).",
    }),
  ),
  parts: Schema.optional(
    Schema.Int.annotate({
      description: `create_upload: how many parts the file is sent in, 1 by default, ${MAX_UPLOAD_PARTS} at most: more than one only when a proxy refuses a request that large.`,
    }),
  ),
  format: Schema.optional(
    Schema.Literals(FORMATS).annotate({
      description:
        "upload, create_upload: the file's format, when its name and content do not tell it.",
    }),
  ),
  account: Schema.optional(
    Schema.String.annotate({
      description: "upload, create_upload: the account's name, as the user calls it (any case).",
    }),
  ),
  import: Schema.optional(
    Schema.String.annotate({
      description:
        "status, undo: the import's id, as upload and list give it. profiles: a CSV import's id, to see which profiles read its file. test_profile, save_profile, confirm: the CSV import waiting for its columns.",
    }),
  ),
  profile_json: Schema.optional(
    Schema.String.annotate({
      description: `test_profile, save_profile, confirm: a profile as the JSON text of a profile file (what Gousset exports). A broker's operations: ${PROFILE_EXAMPLE} Columns count from 1, or are found by the header's names ({"names":["Montant net"]}, "optional":true when a file may lack it; {"after":["Price"]}: the unnamed column after it); leave out those the file lacks. Others: valueOn, label, reference, securityCurrency, amountCurrency, feesCurrency, priceCurrency, value (the trade's worth in the account's currency, for a price in another). kinds: each word of the kind column as purchase, sale, dividend, fee, deposit or withdrawal; kind null: the quantity's sign tells a purchase from a sale. referenceUnique: true when the broker's reference is unique to each row. An account's statement: ${STATEMENT_EXAMPLE}`,
    }),
  ),
  name: Schema.optional(
    Schema.String.annotate({ description: "save_profile: the profile's name, for the user." }),
  ),
  profile: Schema.optional(
    Schema.String.annotate({
      description: "confirm, instead of profile_json: a profile's name, as profiles lists it.",
    }),
  ),
  before: Schema.optional(
    Schema.String.annotate({
      description: "list: an import's id, to list the older ones, as a list's last line writes it.",
    }),
  ),
});

type ImportsInput = typeof ImportsInput.Type;

const DESCRIPTION = `Imports bank statement files into the user's accounts, without duplicates, and lists, follows and undoes imports. Use it when the user gives a statement file (OFX, QFX, QIF, CAMT.053, MT940, CSV) or asks what was imported. A broker's CSV of operations, read with an operations profile of the user's, goes the same way into an investment account, its summary counting operations.

A file you can reach from a shell, larger than a few tens of kilobytes, goes through a file upload, so that its bytes never pass through the conversation: {"action":"create_upload","file_name":"2024-2026.ofx","size":1048576} (its exact size in bytes), then, from that shell, curl -sS -F 'file=@2024-2026.ofx' <the address it gave>, then {"action":"upload","file_upload":"<the id it gave>"}. A smaller file goes in the call itself: {"action":"upload","file_name":"october.ofx","content":"OFXHEADER:100..."}

Refused: an empty file, a file over 10 MB (through content, a request carries 4 MB at most, about 3 MB of file in base64: send a larger one through create_upload), a format not recognised, an account name matching none or several of the user's accounts (the refusal names them), more than ${MAX_PENDING_UPLOADS} file uploads waiting, a file upload used, expired or not received whole, an import id the user does not have, and undoing an import still running. A CSV file no profile reads waits for its columns: map them with test_profile, save_profile and confirm, or on Gousset's import screen. Writes need a connection allowed to read and write.

Actions:
- upload (writes): imports one file. Give file_name and exactly one of content (the file's text) or content_base64 (its bytes, for a file not in UTF-8); or file_upload alone, for a file sent to a file upload. The format is told from the file; name it with format when it is not. The account is recognised from the file (IBAN, number); name it with account, the user's name for it, when the file does not say it (QIF and CSV never do). It waits up to 15 seconds and answers the summary: lines read, added, already known (duplicates, never added twice) and held for review as near duplicates. A file imported before adds nothing again, and the answer says so.
- create_upload (writes): for a file you can reach from a shell, larger than a few tens of kilobytes: its bytes then never pass through the conversation. Give file_name and size (its exact size in bytes), and account or format when needed. It answers a file upload's id and its address, secret and valid ${UPLOAD_MINUTES} minutes. Send the file from your shell, as it is: curl -sS -F 'file=@statement.ofx' <address>. Then call upload with file_upload. A proxy refusing so large a request: declare parts (2 to ${MAX_UPLOAD_PARTS}) and send each part in order, with its number (-F part=1). A file upload is imported once, by this connection only, then deleted; unused, it expires.
- status (reads): one import's state, step and counts; or, with file_upload, whether the file upload is pending, uploaded or expired.
- list (reads): the imports, newest first, 50 a page.
- undo (writes, destructive): removes exactly the lines one import added; lines of other imports it held count again.
- profiles (reads): the CSV import profiles, the user's and those shipped with Gousset, and how each reads a file. With import (a CSV import's id): those that read its file, and the one it used.
- test_profile (reads): import (a CSV import waiting for its columns) and profile_json: the file's first row and lines as the profile reads them, or where it fails.
- save_profile (writes): name, profile_json and import, once test_profile reads it: the user's profile, recognising the next such file.
- confirm (writes): imports the waiting file with profile (a name) or profile_json, once it reads it; account if it waits for one.

More examples:
{"action":"upload","file_name":"export.csv","content":"date;label;amount...","account":"Joint account"}
{"action":"undo","import":"<the id that upload or list gave>"}`;

/** A call's arguments, as an example writes them. */
type Arguments = { readonly [key: string]: string | number };

const call = (args: Arguments) => `imports ${JSON.stringify(args)}`;

const refuse = (message: string, example: Arguments) =>
  Effect.fail(new ToolRefusal({ message, example: call(example) }));

/** A name or file name cut to `length`, so that one long name never fills a page. */
function clip(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

const STILL_RUNNING = new Set(["queued", "reading", "saving"]);

/** How often an upload reads its import again, and for how long, before it answers. */
const POLL = Duration.millis(500);
const SETTLE_POLLS = 30;

function period(summary: ImportSummary): string {
  return summary.periodFrom === null || summary.periodTo === null
    ? "no period yet"
    : `${summary.periodFrom} to ${summary.periodTo}`;
}

function accountName(summary: ImportSummary): string {
  return summary.account === null ? "no account yet" : summary.account.name;
}

function counts(summary: ImportSummary): string {
  if (summary.reads === "operations") {
    return `${summary.linesRead} operations read: ${summary.linesAdded} added, ${summary.linesDuplicate} already known (duplicates)`;
  }

  return `${summary.linesRead} lines read: ${summary.linesAdded} added, ${summary.linesDuplicate} already known (duplicates), ${summary.linesHeld} held for review as near duplicates`;
}

/** Some banks write a balance of 0.00 for an account that is not empty: the import ignored it. */
function balanceText(summary: ImportSummary): string {
  return summary.balanceIgnored
    ? "The file's balance looks empty and was ignored: it says 0, while the account's lines make it something else that day. The account is not checked against it."
    : "";
}

/** Where the job stands, in its steps (read, deduplicate, save). */
function stepOf(summary: ImportSummary): string {
  const all = IMPORT_STEPS.join(", ");

  switch (summary.status) {
    case "queued": {
      return `queued: none of its steps (${all}) has started yet`;
    }

    case "reading": {
      return `running: step read (1 of ${IMPORT_STEPS.length})`;
    }

    case "saving": {
      return `running: step save (${IMPORT_STEPS.length} of ${IMPORT_STEPS.length})`;
    }

    case "done": {
      return `done: all ${IMPORT_STEPS.length} steps (${all}) done`;
    }

    case "waiting": {
      return summary.waitingFor === "profile"
        ? "waiting: for the CSV's columns to be confirmed"
        : "waiting: for its account to be chosen";
    }

    case "failed": {
      return "failed";
    }

    case "undone": {
      return "undone";
    }
  }
}

/** Why an import failed, in words, with what to do. */
function failureText(code: string | null): string {
  switch (code) {
    case "CURRENCY_MISMATCH": {
      return "The file's currency is not its account's. Upload it again naming, with account, an account in the file's currency.";
    }

    case "NOT_AN_INVESTMENT_ACCOUNT": {
      return "A broker's operations go only into an investment account kept by its lines. Upload the file again naming, with account, the user's investment account (a PEA, a securities account).";
    }

    case "OperationRefused":
    case "InvalidIsin":
    case "InvalidQuantity": {
      return `A row of the broker's file is no operation Gousset can keep (${code}): an ISIN whose check digit is wrong, a quantity or an amount it cannot hold. Check the file is the broker's export, unchanged; then upload it again.`;
    }

    case "QUEUE_UNAVAILABLE": {
      return "Gousset could not start the import. Upload the file again in a moment.";
    }

    case "NEEDS_CURRENCY":
    case "NEEDS_PROFILE": {
      return "The file needs its account (and, for a CSV, its columns) to be read. Upload it again naming its account, or finish it on Gousset's import screen.";
    }

    case "NotAStatement":
    case "MalformedFile":
    case "MissingField":
    case "InvalidField":
    case "UnsupportedContent":
    case "InvalidOption": {
      return `The file could not be read as a statement (${code}). Check it is the bank's export, whole and unchanged, or name its format with format; then upload it again.`;
    }

    default: {
      return `It failed on Gousset's side (${code ?? "no reason recorded"}). Upload the file again; if it keeps failing, tell the administrator.`;
    }
  }
}

/** One import, as status answers it. */
function statusText(summary: ImportSummary): string {
  return [
    `${summary.fileName} (${summary.format}): ${stepOf(summary)}.`,
    `Account: ${accountName(summary)}. Period: ${period(summary)}.`,
    `${counts(summary)}.`,
    balanceText(summary),
    summary.status === "failed" ? failureText(summary.errorCode) : "",
    `Import id: ${summary.id}`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function waitingText(
  summary: ImportSummary,
  accounts: ReadonlyArray<ImportAccount>,
  viaFileUpload: boolean,
): string {
  if (summary.waitingFor === "profile") {
    return `${summary.fileName} waits for its CSV columns to be confirmed: the user confirms them on Gousset's import screen (Imports), where this import waits, then call: ${call({ action: "status", import: summary.id })}. Or map them yourself: ${call({ action: "test_profile", import: summary.id, profile_json: "…" })}, then confirm.`;
  }

  const names = accounts.map((each) => each.name);
  const example = names[0] ?? "Current account";

  return [
    `${summary.fileName} waits for its account: the file does not say which of the user's accounts it is.`,
    names.length === 0
      ? "The user has no open account yet: one must be added in Gousset first."
      : `The user's accounts: ${names.join(", ")}.`,
    viaFileUpload
      ? `Send it again through a new file upload naming the account (create_upload with file_name, size and account: "${example}"), or choose the account on Gousset's import screen, where this import waits.`
      : `Upload it again naming the account, as ${call({ action: "upload", file_name: summary.fileName, content: "…", account: example })}, or choose the account on Gousset's import screen, where this import waits.`,
    `Import id: ${summary.id}`,
  ].join("\n");
}

function doneText(summary: ImportSummary): string {
  const readWith = summary.profile === null ? "" : ` with ${clip(summary.profile, 100)}`;

  return [
    `Imported ${summary.fileName} into ${accountName(summary)}, ${period(summary)}.`,
    summary.reads === "operations" ? `Read as a broker's operations${readWith}.` : "",
    `${counts(summary)}.`,
    summary.linesHeld > 0
      ? "The lines held wait for the user's review: they count only once confirmed."
      : "",
    balanceText(summary),
    `Import id: ${summary.id} (to undo it: ${call({ action: "undo", import: summary.id })})`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function sameFileText(started: Started): string {
  return started.sameFile === null
    ? ""
    : `This same file was already imported, as ${started.sameFile.fileName} on ${started.sameFile.importedAt.slice(0, 10)}: nothing is added twice.\n\n`;
}

const IMPORT_NOT_FOUND = (importId: string) =>
  refuse(
    `The user has no import with the id ${clip(importId, 60)}. List the imports to find its id.`,
    { action: "list" },
  );

/** The database did not answer: no refusal, the call fails as an error on Gousset's side. */
const failure = <Failed>(failed: Failed) => Effect.die(failed);

const UNAVAILABLE = () =>
  refuse("Gousset could not start the import just now. Try the same call again in a moment.", {
    action: "list",
  });

/** The account the user named, matched by name in any case, or a refusal naming the accounts. */
function namedAccount(
  owner: string,
  name: string,
  example: Arguments,
): Effect.Effect<string, ToolRefusal, Imports> {
  return Effect.gen(function* () {
    const imports = yield* Imports;
    const accounts = yield* imports.accounts(owner).pipe(Effect.orDie);
    const wanted = name.trim().toLowerCase();
    const matching = accounts.filter((each) => each.name.trim().toLowerCase() === wanted);
    const [only] = matching;
    const names = accounts.map((each) => each.name);

    if (matching.length === 1 && only !== undefined) {
      return only.id;
    }

    if (names.length === 0) {
      return yield* refuse(
        `No account is named ${clip(name, 80)}: the user has no open account yet. Add one in Gousset first, or leave account out when the file names its account (IBAN or number).`,
        example,
      );
    }

    const why =
      matching.length > 1
        ? `Several accounts are named ${clip(name, 80)}: Gousset cannot tell which one is meant.`
        : `No account is named ${clip(name, 80)}.`;

    return yield* refuse(
      `${why} The user's accounts: ${clip(names.join(", "), 1200)}. Name one of them exactly, or leave account out when the file names its account.`,
      { ...example, account: names[0] ?? "Current account" },
    );
  });
}

const decodeBase64 = Schema.decodeUnknownExit(Schema.Uint8ArrayFromBase64);

/** The file's bytes, from exactly one of content and content_base64. */
function bytesOf(input: ImportsInput, fileName: string): Effect.Effect<Uint8Array, ToolRefusal> {
  const example = { action: "upload", file_name: fileName, content: "…" };

  if (input.content !== undefined && input.content_base64 !== undefined) {
    return refuse(
      "Give the file once: content (its text) or content_base64 (its bytes in base64), not both.",
      example,
    );
  }

  if (input.content !== undefined) {
    return Effect.succeed(new TextEncoder().encode(input.content));
  }

  if (input.content_base64 === undefined) {
    return refuse(
      "upload needs the file: content (its text) or content_base64 (its bytes in base64, for a file not in UTF-8).",
      example,
    );
  }

  const decoded = decodeBase64(input.content_base64.replaceAll(/\s/g, ""));

  return Exit.isSuccess(decoded)
    ? Effect.succeed(decoded.value)
    : refuse(
        "content_base64 is not valid base64. Give the file's bytes in base64, or its text in content.",
        example,
      );
}

/** Reads the import again until it no longer runs, for 15 seconds at most. */
function settle(owner: string, summary: ImportSummary) {
  return Effect.gen(function* () {
    const imports = yield* Imports;
    let current = summary;

    for (let poll = 0; poll < SETTLE_POLLS && STILL_RUNNING.has(current.status); poll += 1) {
      yield* Effect.sleep(POLL);
      current = yield* imports.show(owner, summary.id);
    }

    return current;
  });
}

function settledText(
  owner: string,
  started: Started,
  summary: ImportSummary,
  viaFileUpload: boolean,
): Effect.Effect<string, never, Imports> {
  return Effect.gen(function* () {
    const notice = sameFileText(started);

    switch (summary.status) {
      case "done": {
        return `${notice}${doneText(summary)}`;
      }

      case "waiting": {
        const imports = yield* Imports;

        const accounts =
          summary.waitingFor === "account" ? yield* imports.accounts(owner).pipe(Effect.orDie) : [];

        return `${notice}${waitingText(summary, accounts, viaFileUpload)}`;
      }

      case "failed": {
        return `${notice}The import of ${summary.fileName} failed. ${failureText(summary.errorCode)}\nImport id: ${summary.id}`;
      }

      case "queued":
      case "reading":
      case "saving":
      case "undone": {
        return `${notice}The import of ${summary.fileName} is still running (${stepOf(summary)}). Follow it with: ${call({ action: "status", import: summary.id })}`;
      }
    }
  });
}

function upload(input: ImportsInput, owner: string) {
  return Effect.gen(function* () {
    const fileName = input.file_name;

    if (fileName === undefined || fileName.trim() === "") {
      return yield* refuse(
        "upload needs file_name: the file's name with its extension, which tells its format.",
        { action: "upload", file_name: "october.ofx", content: "…" },
      );
    }

    const content = yield* bytesOf(input, fileName);

    const accountId =
      input.account === undefined
        ? null
        : yield* namedAccount(owner, input.account, {
            action: "upload",
            file_name: fileName,
            content: "…",
          });

    const format: ImportFormat | null = input.format ?? null;
    const imports = yield* Imports;
    const started = yield* imports.start(owner, { fileName, content, format, accountId });
    const settled = yield* settle(owner, started.started);

    return yield* settledText(owner, started, settled, false);
  }).pipe(
    Effect.catchTags({
      EmptyFile: () =>
        refuse("The file is empty: give its whole content.", {
          action: "upload",
          file_name: "october.ofx",
          content: "…",
        }),
      FileTooLarge: (tooLarge) =>
        refuse(
          `The file is ${(tooLarge.bytes / 1024 / 1024).toFixed(1)} MB; an import takes ${tooLarge.limit / 1024 / 1024} MB at most. Export a shorter period from the bank and upload that.`,
          { action: "upload", file_name: "october.ofx", content: "…" },
        ),
      UnknownFormat: () =>
        refuse(
          `Gousset cannot tell this file's format from its name or content. Name it with format: one of ${FORMATS.join(", ")}.`,
          {
            action: "upload",
            file_name: input.file_name ?? "statement.xml",
            content: "…",
            format: "camt053",
          },
        ),
      AccountNotFound: () =>
        refuse("This account is no longer the user's. List their accounts again and name one.", {
          action: "upload",
          file_name: input.file_name ?? "statement.xml",
          content: "…",
          account: "Current account",
        }),
      ImportUnavailable: UNAVAILABLE,
      ImportNotFound: (missing) => IMPORT_NOT_FOUND(missing.importId),
      QueryFailed: failure,
    }),
  );
}

/** Where the upload route serves (apps/web): the app's own address, then a file upload's token. */
const UPLOAD_PATH = "/api/import-uploads/";

const CREATE_EXAMPLE = { action: "create_upload", file_name: "statement.ofx", size: 1_048_576 };

/** A word of a shell command, quoted whole. */
const quoted = (word: string) => `'${word.replaceAll("'", String.raw`'\''`)}'`;

/** The command that sends a file, or one numbered part of it, to an upload address. */
function curlOf(path: string, address: string, part: number | null): string {
  const numbered = part === null ? "" : ` -F part=${part}`;

  return `curl -sS${numbered} -F ${quoted(`file=@${path}`)} ${address}`;
}

function createdText(created: CreatedUpload, origin: string): string {
  const address = `${origin}${UPLOAD_PATH}${created.token}`;
  const name = clip(created.fileName, 100);

  const head = [
    `File upload made for ${name}: ${created.size} bytes, in ${created.parts === 1 ? "one part" : `${created.parts} parts`}, until ${created.expiresAt} (${UPLOAD_MINUTES} minutes). Its address works for this file only and is a secret: write it nowhere but the command.`,
  ];

  const send =
    created.parts === 1
      ? [
          "Send the file from a shell in its folder, as it is (not converted, not compressed):",
          curlOf(created.fileName, address, null),
        ]
      : [
          `Send it in ${created.parts} parts, in order, each with its number: together they are the file as it is, ${created.size} bytes. Split it, for example, with: split -n ${created.parts} -d -a 2 ${quoted(created.fileName)} ${quoted(`${created.fileName}.part`)}`,
          ...Array.from({ length: created.parts }, (_, index) =>
            curlOf(`${created.fileName}.part${String(index).padStart(2, "0")}`, address, index + 1),
          ),
        ];

  return [
    ...head,
    ...send,
    `Each part's answer says what arrived. Then import it: ${call({ action: "upload", file_upload: created.id })}`,
    `File upload id: ${created.id}`,
  ].join("\n");
}

function createUpload(input: ImportsInput, caller: Caller) {
  const owner = caller.userId;
  const { grantId, origin } = caller;

  return Effect.gen(function* () {
    const fileName = input.file_name?.trim().slice(0, 255) ?? "";

    if (fileName === "") {
      return yield* refuse(
        "create_upload needs file_name: the file's name with its extension, which tells its format.",
        CREATE_EXAMPLE,
      );
    }

    if (input.size === undefined) {
      return yield* refuse(
        "create_upload needs size: the file's exact size in bytes, as wc -c < statement.ofx prints it.",
        { ...CREATE_EXAMPLE, file_name: fileName },
      );
    }

    if (input.content !== undefined || input.content_base64 !== undefined) {
      return yield* refuse(
        "create_upload takes no content: the file goes to the address it answers. To give the file's text in the call itself, use upload.",
        { ...CREATE_EXAMPLE, file_name: fileName, size: input.size },
      );
    }

    // The door gives both to every call; a caller without them never made a grant.
    if (grantId === undefined || origin === undefined) {
      return yield* refuse(
        "This connection cannot make a file upload: connect Gousset again through its consent page.",
        { action: "list" },
      );
    }

    const accountId =
      input.account === undefined
        ? null
        : yield* namedAccount(owner, input.account, {
            ...CREATE_EXAMPLE,
            file_name: fileName,
            size: input.size,
          });

    const imports = yield* Imports;

    const created = yield* imports.createUpload(owner, {
      grantId,
      fileName,
      size: input.size,
      parts: input.parts ?? 1,
      accountId,
      format: input.format ?? null,
    });

    return createdText(created, origin);
  }).pipe(
    Effect.catchTags({
      EmptyFile: () =>
        refuse(
          "size is 0: an empty file imports nothing. Give the file's size in bytes.",
          CREATE_EXAMPLE,
        ),
      FileTooLarge: (tooLarge) =>
        refuse(
          `The file is ${(tooLarge.bytes / 1024 / 1024).toFixed(1)} MB; an import takes ${tooLarge.limit / 1024 / 1024} MB at most. Export a shorter period from the bank and upload that.`,
          CREATE_EXAMPLE,
        ),
      TooManyParts: (tooMany) =>
        refuse(
          `parts goes from 1 to ${tooMany.limit}, never more parts than bytes. Most files go in one part: leave parts out.`,
          CREATE_EXAMPLE,
        ),
      TooManyFileUploads: (tooMany) =>
        refuse(
          `The user has ${tooMany.limit} file uploads waiting already, the most at once. Import them (upload with their file_upload) or let them expire, ${UPLOAD_MINUTES} minutes after they were made; then make this one.`,
          { action: "upload", file_upload: "<a file upload's id>" },
        ),
      AccountNotFound: () =>
        refuse("This account is no longer the user's. List their accounts again and name one.", {
          ...CREATE_EXAMPLE,
          account: "Current account",
        }),
      QueryFailed: failure,
    }),
  );
}

/** Imports the file sent to a file upload, as upload imports a file given in the call. */
function uploadFile(input: ImportsInput, caller: Caller, id: string) {
  const owner = caller.userId;
  const again = { action: "upload", file_upload: id };

  return Effect.gen(function* () {
    if (input.content !== undefined || input.content_base64 !== undefined) {
      return yield* refuse(
        "Give the file once: file_upload (a file sent to its address) or content, not both.",
        again,
      );
    }

    const accountId =
      input.account === undefined ? null : yield* namedAccount(owner, input.account, again);

    const imports = yield* Imports;

    const started = yield* imports.startUpload(owner, id, caller.grantId ?? "", {
      format: input.format ?? null,
      accountId,
    });

    const settled = yield* settle(owner, started.started);

    return yield* settledText(owner, started, settled, true);
  }).pipe(
    Effect.catchTags({
      FileUploadNotFound: () =>
        refuse(
          `No file upload ${clip(id, 60)} waits for this connection: it was imported already (a file upload is imported once), it expired and was deleted, or another connection made it. Make a new one and send the file again.`,
          CREATE_EXAMPLE,
        ),
      FileUploadExpired: (expired) =>
        refuse(
          `This file upload expired at ${expired.expiresAt}, before it was imported. Make a new one and send the file again.`,
          CREATE_EXAMPLE,
        ),
      FileUploadIncomplete: (incomplete) =>
        refuse(
          `The file has not all arrived: ${incomplete.partsReceived} of ${incomplete.parts} part(s), ${incomplete.bytesReceived} of ${incomplete.size} bytes. Send the rest to the address create_upload gave, then call upload again.`,
          { action: "status", file_upload: id },
        ),
      UnknownFormat: () =>
        refuse(
          `Gousset cannot tell this file's format from its name or content. Name it with format: one of ${FORMATS.join(", ")}. The file upload waits until it expires.`,
          { ...again, format: "camt053" },
        ),
      AccountNotFound: () =>
        refuse("This account is no longer the user's. List their accounts again and name one.", {
          ...again,
          account: "Current account",
        }),
      // The file upload was used: the import holding its file exists, failed.
      ImportUnavailable: () =>
        refuse(
          "Gousset kept the file but could not start its import just now: the import is listed as failed, and the file upload is used. Find it with list; the user runs it again on Gousset's import screen, or make a new file upload and send the file again.",
          { action: "list" },
        ),
      ImportNotFound: (missing) => IMPORT_NOT_FOUND(missing.importId),
      QueryFailed: failure,
    }),
  );
}

/** One file upload, as status answers it. */
function fileUploadText(status: FileUploadStatus): string {
  const name = clip(status.fileName, 100);

  switch (status.state) {
    case "pending": {
      return [
        `${name}: pending, ${status.partsReceived} of ${status.parts} part(s) received (${status.bytesReceived} of ${status.size} bytes), until ${status.expiresAt}.`,
        status.parts === 1
          ? "Send the file to the address create_upload gave."
          : `Send part ${status.partsReceived + 1} next to the address create_upload gave.`,
        `File upload id: ${status.id}`,
      ].join("\n");
    }

    case "uploaded": {
      return `${name}: uploaded, whole (${status.size} bytes), until ${status.expiresAt}. Import it: ${call({ action: "upload", file_upload: status.id })}`;
    }

    case "expired": {
      return `${name}: expired at ${status.expiresAt}, before it was imported. Make a new file upload and send the file again: ${call({ action: "create_upload", file_name: status.fileName, size: status.size })}`;
    }
  }
}

function fileUploadStatus(owner: string, id: string) {
  return Effect.gen(function* () {
    const imports = yield* Imports;

    return fileUploadText(yield* imports.uploadStatus(owner, id));
  }).pipe(
    Effect.catchTags({
      FileUploadNotFound: () =>
        refuse(
          `The user has no file upload ${clip(id, 60)} waiting: it was imported (then list shows its import), or it expired and was deleted.`,
          { action: "list" },
        ),
      QueryFailed: failure,
    }),
  );
}

function needImport(action: "status" | "undo") {
  return refuse(`${action} needs import: the import's id, as upload and list give it.`, {
    action,
    import: "<an id from list>",
  });
}

function listText(page: ImportPage): string {
  if (page.imports.length === 0) {
    return "No imports here: the user has imported no statement yet (or none older).";
  }

  const lines = page.imports.map(
    (each) =>
      `- ${clip(each.fileName, 100)}, ${clip(accountName(each), 60)}, ${period(each)}, ${each.status}, imported ${each.createdAt.slice(0, 10)}: ${each.linesRead} read, ${each.linesAdded} added, ${each.linesDuplicate} duplicates, ${each.linesHeld} held. Id: ${each.id}`,
  );

  const next =
    page.next === null
      ? "These are all of them."
      : `Older imports: ${call({ action: "list", before: page.next })}`;

  return [`Imports, newest first:`, ...lines, "", next].join("\n");
}

function undoText({
  undone,
  linesRemoved,
  linesGivenBack,
  transfersRemoved,
  laterOverlapping,
  months,
}: Undone) {
  return [
    `Undid the import of ${undone.fileName} (${accountName(undone)}, ${period(undone)}): ${linesRemoved} lines removed.`,
    linesGivenBack > 0
      ? `${linesGivenBack} lines of other imports count again: they were held as near duplicates of its lines.`
      : "",
    transfersRemoved > 0
      ? `${transfersRemoved} transfers its lines were a side of are undone with them: their other sides are no transfer any more, until paired again.`
      : "",
    laterOverlapping > 0
      ? `${laterOverlapping} later imports of this account overlap its period and skipped some of its lines as duplicates: those lines are gone now. Importing its file again brings them back.`
      : "",
    months.length > 0 ? `Months changed: ${months.join(", ")}.` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** How a profile reads a file: `@gousset/import`'s `CsvDefinition`, as core lists it. */
type Definition = NonNullable<ImportProfileEntry["definition"]>;

/** A broker's operations' profile (`OperationsProfile`). */
type OperationsProfile = Extract<Definition, { readonly reads: "operations" }>;

const SEPARATORS = {
  ";": "semicolons",
  ",": "commas",
  "\t": "tabs",
  "|": "pipes",
} satisfies { readonly [separator in Definition["separator"]]: string };

/** How a table is split and its values written, in a few words. */
function tableText(profile: Definition): ReadonlyArray<string> {
  const header = profile.headerRow ? "a header row" : "no header row";

  return [
    `separated by ${SEPARATORS[profile.separator]}`,
    `encoded ${profile.encoding}`,
    profile.skipRows === 0 ? header : `${profile.skipRows} lines skipped above ${header}`,
    `dates ${profile.dateFormat}`,
    profile.decimalMark === "," ? "decimal comma" : "decimal point",
  ];
}

type Place = OperationsProfile["columns"]["amount"];

/** Where a profile finds a column: at its place, or by its name. */
function placeText(place: Place): string {
  if (isPlace(place)) {
    return `column ${place}`;
  }

  return "names" in place
    ? `the column named ${clip(place.names[0] ?? "", 40)}`
    : `the column after ${clip(place.after[0] ?? "", 40)}`;
}

/** How a broker's operations profile reads a file: into an investment account only. */
function operationsText(profile: OperationsProfile): string {
  const { kind, amount } = profile.columns;

  const kinds =
    kind === null
      ? "each row a purchase or a sale by its quantity's sign"
      : `the kind in ${placeText(kind)}, ${profile.kinds.map((each) => `${clip(each.word, 40)} as ${each.kind}`).join(", ")}`;

  return [
    "a broker's operations, into an investment account",
    ...tableText(profile),
    kinds,
    `the amount in ${placeText(amount)}`,
  ].join(", ");
}

/** How a profile reads a file, in a few words: what an agent needs to choose one. */
function readsText(profile: Definition): string {
  if ("reads" in profile) {
    return operationsText(profile);
  }

  if (profile.layout === "paypal-activity") {
    return "PayPal's activity export, its columns found by their names in English or French, the completed rows that moved the balance in the account's currency, a payment in another currency by its conversion; days and amounts read as the file writes them";
  }

  const { amount } = profile.columns;

  const amounts =
    amount.kind === "signed"
      ? `one signed amount in column ${amount.column}`
      : `debit in column ${amount.debit} and credit in column ${amount.credit}`;

  return [...tableText(profile), amounts].join(", ");
}

/** A profile by its name: whose it is, and the institution it reads. */
function profileName(entry: ImportProfileEntry): string {
  const institution = entry.institution === null ? "" : ` (${clip(entry.institution, 60)})`;
  const whose = entry.source === "stored" ? "the user's" : "shipped with Gousset";
  const operations = entry.kind === "operations" ? ", for a broker's operations" : "";

  return `${clip(entry.name, 100)}${institution}, ${whose}${operations}`;
}

const PROFILES_OF_IMPORT = call({ action: "profiles", import: "<a CSV import's id>" });

function profilesText(entries: ReadonlyArray<ImportProfileEntry>): string {
  const lines = entries.map((entry) =>
    entry.definition === null
      ? `- ${profileName(entry)}: its definition can no longer be read; the user saves it again on Gousset's import screen.`
      : `- ${profileName(entry)}: ${readsText(entry.definition)}.`,
  );

  return [
    "CSV import profiles, the user's first, then those shipped with Gousset. On upload, a CSV file is read with the first profile whose header row it has, or, for PayPal activity and a profile that finds its columns by their names, whose header row names those columns among any others.",
    ...lines,
    "",
    `Which of them read one CSV import's file: ${PROFILES_OF_IMPORT}`,
  ].join("\n");
}

function usedText(found: ProfilesForImport): string {
  if (found.used !== null) {
    return `This import read its file with ${clip(found.used.name, 100)}.`;
  }

  return found.status === "done"
    ? "This import names no profile Gousset still has: its columns were detected or confirmed on Gousset's import screen, or the profile it used was deleted since or is no longer shipped."
    : `No profile has read it yet (it is ${found.status}).`;
}

/** How a profile recognises a file by its header row. */
function headerText(definition: Definition): string {
  if ("reads" in definition) {
    return findsColumnsByName(definition)
      ? "the file's header row names the profile's columns"
      : "its header row is the file's";
  }

  return definition.layout === "paypal-activity"
    ? "the file's header row names PayPal's mandatory columns"
    : "its header row is the file's";
}

function profilesForText(found: ProfilesForImport): string {
  const fileName = clip(found.fileName, 100);

  const lines = found.fitting.map(({ profile, by }) => {
    const { definition } = profile;

    const header = definition === null ? "its header row is the file's" : headerText(definition);

    return `- ${profileName(profile)}: ${by === "header" ? header : "a test read of the file's first lines succeeds"}.`;
  });

  return [
    lines.length === 0
      ? `No profile reads ${fileName}: Gousset's import screen proposes its columns from the file, and the user can save them as a profile there.`
      : `Profiles that read ${fileName}:\n${lines.join("\n")}`,
    usedText(found),
  ].join("\n");
}

function profiles(input: ImportsInput, owner: string) {
  const importId = input.import;

  return Effect.gen(function* () {
    const service = yield* ImportProfiles;

    return importId === undefined
      ? profilesText(yield* service.list(owner))
      : profilesForText(yield* service.forImport(owner, importId));
  }).pipe(
    Effect.catchTags({
      ImportNotFound: () =>
        refuse(
          `The user has no CSV import with the id ${clip(importId ?? "", 60)}, or its file was removed by an undo. List the imports to find a CSV one's id, or leave import out to list every profile.`,
          { action: "list" },
        ),
      QueryFailed: failure,
    }),
  );
}

const decodeProfile = Schema.decodeUnknownExit(Schema.fromJsonString(CsvDefinition));

/** How much of a profile's decoding error a refusal quotes: enough to say what is wrong. */
const PROBLEM_LENGTH = 900;

const TEST_EXAMPLE = {
  action: "test_profile",
  import: "<the waiting import's id>",
  profile_json: PROFILE_EXAMPLE,
};

/** The profile `profile_json` writes, decoded as a profile file is, or why it is none. */
function writtenProfile(
  input: ImportsInput,
  action: string,
): Effect.Effect<CsvDefinition, ToolRefusal> {
  if (input.profile_json === undefined) {
    return refuse(
      `${action} needs profile_json: the profile, as the JSON text of a profile file.`,
      TEST_EXAMPLE,
    );
  }

  const decoded = decodeProfile(input.profile_json);

  if (Exit.isSuccess(decoded)) {
    return Effect.succeed(decoded.value);
  }

  const issue = Cause.squash(decoded.cause);
  const problem = issue instanceof Error ? issue.message : "It holds no profile Gousset reads.";

  return refuse(
    `profile_json is no profile Gousset reads: ${clip(problem, PROBLEM_LENGTH)} Write it as the example does.`,
    TEST_EXAMPLE,
  );
}

/** The CSV import a profile action reads, by its id, or a refusal saying to give it. */
function waitingImport(input: ImportsInput, action: string): Effect.Effect<string, ToolRefusal> {
  return input.import === undefined
    ? refuse(`${action} needs import: the id of the CSV import waiting for its columns.`, {
        ...TEST_EXAMPLE,
        action,
      })
    : Effect.succeed(input.import);
}

/** Minor units as a decimal number in `currency`, or in ten-thousandths before an account. */
function amountOf(minor: number, currency: string | null): string {
  const digits = currency === null ? 4 : minorDigits(currency);
  const text = String(Math.abs(minor)).padStart(digits + 1, "0");
  const whole = text.slice(0, text.length - digits);
  const fraction = digits === 0 ? "" : `.${text.slice(text.length - digits)}`;

  return `${minor < 0 ? "-" : ""}${whole}${fraction}${currency === null ? "" : ` ${currency}`}`;
}

/** Why a test read refused the file, at its line and column. */
function refusalText(refusal: CsvReadRefusal): string {
  const where = [
    refusal.line === null ? "" : `line ${refusal.line}`,
    refusal.column === null ? "" : `column ${refusal.column}`,
    refusal.field === null ? "" : `field ${refusal.field}`,
    refusal.text === null ? "" : `value ${JSON.stringify(clip(refusal.text, 40))}`,
  ]
    .filter((part) => part !== "")
    .join(", ");

  return `The profile does not read this file: ${refusal.error}${where === "" ? "" : ` at ${where}`}. A kind word it does not list, a column at the wrong place or a format (date, decimal mark, separator, encoding, lines to skip) the file does not write gives this. Fix profile_json and test again.`;
}

/** The file's columns, as the profile splits its header row, numbered as profiles count them. */
function columnsText(preview: CsvPreview): string {
  const [first = []] = preview.rows;

  const named = first
    .slice(0, 40)
    .map((cell, index) => `${index + 1} ${JSON.stringify(clip(cell, 40))}`)
    .join(", ");

  return named === "" ? "The file shows no row with these settings." : `First row: ${named}.`;
}

/** A test read of a waiting import's file with a profile, as the import screen shows it. */
function testText(preview: CsvPreview): string {
  if ("refused" in preview.read) {
    return [columnsText(preview), refusalText(preview.read.refused)].join("\n");
  }

  const lines = preview.read.lines.map(
    (line) =>
      `- ${line.bookedOn}${line.kind === null ? "" : `, ${line.kind}`}, ${clip(line.label, 60)}, ${amountOf(line.amountMinor, preview.currency)}`,
  );

  return [
    columnsText(preview),
    `The profile reads the file's first lines${preview.currency === null ? " (no account yet: amounts in ten-thousandths)" : ""}:`,
    ...lines,
    "Keep it with save_profile, or import the file with it with confirm.",
  ].join("\n");
}

/** The test read of a waiting CSV import's file with a profile (`Imports.csvPreview`). */
const previewWith = (owner: string, importId: string, definition: CsvDefinition) =>
  Effect.gen(function* () {
    const imports = yield* Imports;

    return yield* imports.csvPreview(owner, importId, definition);
  }).pipe(
    Effect.catchTags({
      ImportNotFound: () =>
        refuse(
          `The user has no CSV import with the id ${clip(importId, 60)}, or its file was removed by an undo. List the imports to find the one waiting for its columns.`,
          { action: "list" },
        ),
      QueryFailed: failure,
    }),
  );

/** The profile read must succeed before it is kept or imported with, as on the import screen. */
function readsFile(preview: CsvPreview, importId: string): Effect.Effect<void, ToolRefusal> {
  return "refused" in preview.read
    ? refuse(refusalText(preview.read.refused), { ...TEST_EXAMPLE, import: importId })
    : Effect.void;
}

function testProfile(input: ImportsInput, owner: string) {
  return Effect.gen(function* () {
    const importId = yield* waitingImport(input, "test_profile");
    const definition = yield* writtenProfile(input, "test_profile");

    return testText(yield* previewWith(owner, importId, definition));
  });
}

function saveProfile(input: ImportsInput, owner: string) {
  return Effect.gen(function* () {
    const importId = yield* waitingImport(input, "save_profile");
    const definition = yield* writtenProfile(input, "save_profile");
    const preview = yield* previewWith(owner, importId, definition);

    yield* readsFile(preview, importId);

    const service = yield* ImportProfiles;

    const saved = yield* service.save(owner, {
      name: input.name ?? "",
      institution: null,
      definition,
      header: preview.header,
    });

    return [
      `Saved ${clip(saved.name, 100)} as the user's profile${saved.kind === "operations" ? ", for a broker's operations" : ""}: a file with the same header row is read with it on upload.`,
      `Import the waiting file with it: ${call({ action: "confirm", import: importId, profile: saved.name })}`,
    ].join("\n");
  }).pipe(
    Effect.catchTags({
      ProfileNameMissing: () =>
        refuse("save_profile needs name: the profile's name, as the user will see it.", {
          ...TEST_EXAMPLE,
          action: "save_profile",
          name: "Broker's operations",
        }),
      ProfileTooLong: (tooLong) =>
        refuse(
          `The profile's ${tooLong.field} is longer than ${tooLong.limit} characters: give a shorter one.`,
          { ...TEST_EXAMPLE, action: "save_profile", name: "Broker's operations" },
        ),
      TooManyProfiles: (tooMany) =>
        refuse(
          `The user keeps ${tooMany.limit} profiles, the most: one must be deleted on Gousset's import screen first. Meanwhile, import the file with profile_json: confirm needs no saved profile.`,
          { ...TEST_EXAMPLE, action: "confirm" },
        ),
      QueryFailed: failure,
    }),
  );
}

/** The profile `confirm` reads with: one the user has, by its name, or one written for it. */
function confirmedProfile(
  input: ImportsInput,
  owner: string,
): Effect.Effect<
  { readonly definition: CsvDefinition; readonly choice: ProfileChoice | null },
  ToolRefusal,
  ImportProfiles
> {
  return Effect.gen(function* () {
    if (input.profile === undefined) {
      return { definition: yield* writtenProfile(input, "confirm"), choice: null };
    }

    if (input.profile_json !== undefined) {
      return yield* refuse("Give one profile: profile (a profile's name) or profile_json.", {
        action: "confirm",
        import: input.import ?? "<the waiting import's id>",
        profile: input.profile,
      });
    }

    const service = yield* ImportProfiles;
    const entries = yield* service.list(owner).pipe(Effect.catchTag("QueryFailed", failure));
    const wanted = input.profile.trim().toLowerCase();
    const found = entries.find((entry) => entry.name.trim().toLowerCase() === wanted);

    if (found === undefined || found.definition === null) {
      return yield* refuse(
        `The user has no profile named ${clip(input.profile, 80)} that still reads. Their profiles: ${clip(entries.map((entry) => entry.name).join(", "), 1000)}.`,
        { action: "profiles" },
      );
    }

    return {
      definition: found.definition,
      choice:
        found.source === "stored"
          ? { kind: "stored", id: found.id }
          : { kind: "shipped", key: found.key },
    };
  });
}

function confirm(input: ImportsInput, owner: string) {
  return Effect.gen(function* () {
    const importId = yield* waitingImport(input, "confirm");
    const { definition, choice } = yield* confirmedProfile(input, owner);

    yield* readsFile(yield* previewWith(owner, importId, definition), importId);

    const accountId =
      input.account === undefined
        ? null
        : yield* namedAccount(owner, input.account, { action: "confirm", import: importId });

    const imports = yield* Imports;

    const resumed = yield* imports.resume(owner, importId, {
      accountId,
      csvProfile: choice === null ? definition : null,
      profile: choice,
    });

    const settled = yield* settle(owner, resumed);

    return yield* settledText(owner, { started: resumed, sameFile: null }, settled, false);
  }).pipe(
    Effect.catchTags({
      ImportNotFound: (missing) => IMPORT_NOT_FOUND(missing.importId),
      ImportBusy: (busy) =>
        refuse(
          `This import is ${busy.status}: only one waiting for its columns or its account, or one that failed, is read again. Follow it with status.`,
          { action: "status", import: busy.importId },
        ),
      AccountNotFound: () =>
        refuse("This account is no longer the user's. List their accounts again and name one.", {
          action: "confirm",
          import: input.import ?? "",
          account: "Current account",
        }),
      ProfileNotFound: () =>
        refuse("This profile is no longer the user's.", { action: "profiles" }),
      ProfileUnreadable: () =>
        refuse("This profile no longer reads: write it again with profile_json.", TEST_EXAMPLE),
      ImportUnavailable: UNAVAILABLE,
      QueryFailed: failure,
    }),
  );
}

/** The imports family (docs/mcp.md, "Tools"): statements in, without duplicates, and undone. */
export const importsTool = defineTool<
  ImportsInput,
  typeof ImportsInput.Encoded,
  Imports | ImportProfiles
>({
  name: "imports",
  title: "Statement imports",
  description: DESCRIPTION,
  idempotent: false,
  input: ImportsInput,
  example: { action: "list" },
  access: {
    upload: "write",
    create_upload: "write",
    status: "read",
    list: "read",
    undo: "write",
    profiles: "read",
    test_profile: "read",
    save_profile: "write",
    confirm: "write",
  },
  run: (input, caller) => {
    const owner = caller.userId;

    switch (input.action) {
      case "upload": {
        return input.file_upload === undefined
          ? upload(input, owner)
          : uploadFile(input, caller, input.file_upload);
      }

      case "create_upload": {
        return createUpload(input, caller);
      }

      case "status": {
        const importId = input.import;

        if (input.file_upload !== undefined && importId !== undefined) {
          return refuse("status reads one thing: an import, or a file upload, not both.", {
            action: "status",
            import: importId,
          });
        }

        if (input.file_upload !== undefined) {
          return fileUploadStatus(owner, input.file_upload);
        }

        if (importId === undefined) {
          return needImport("status");
        }

        return Effect.gen(function* () {
          const imports = yield* Imports;

          return statusText(yield* imports.show(owner, importId));
        }).pipe(
          Effect.catchTags({
            ImportNotFound: () => IMPORT_NOT_FOUND(importId),
            QueryFailed: failure,
          }),
        );
      }

      case "list": {
        return Effect.gen(function* () {
          const imports = yield* Imports;

          return listText(yield* imports.list(owner, input.before ?? null));
        }).pipe(Effect.catchTag("QueryFailed", failure));
      }

      case "undo": {
        const importId = input.import;

        if (importId === undefined) {
          return needImport("undo");
        }

        return Effect.gen(function* () {
          const imports = yield* Imports;

          return undoText(yield* imports.undo(owner, importId));
        }).pipe(
          Effect.catchTags({
            ImportNotFound: () => IMPORT_NOT_FOUND(importId),
            ImportBusy: (busy) =>
              busy.status === "undone"
                ? refuse("This import was already undone: there is nothing to do.", {
                    action: "list",
                  })
                : refuse(
                    `This import is still running (${busy.status}): it can be undone once it ends. Wait a moment and follow it with status, then undo it.`,
                    { action: "status", import: importId },
                  ),
            QueryFailed: failure,
          }),
        );
      }

      case "profiles": {
        return profiles(input, owner);
      }

      case "test_profile": {
        return testProfile(input, owner);
      }

      case "save_profile": {
        return saveProfile(input, owner);
      }

      case "confirm": {
        return confirm(input, owner);
      }
    }
  },
});
