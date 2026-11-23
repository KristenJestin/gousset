import {
  DataExport,
  FixtureLedger,
  ImportProfiles,
  Imports,
  MAX_MERCHANT_NAME,
  MerchantAliasNotFound,
  MerchantMergeRefused,
  MerchantNameRefused,
  MerchantNameTaken,
  MerchantNameUnknown,
  MerchantNotFound,
  Merchants,
  memoryAccountStore,
  memoryLineStore,
} from "@gousset/core";
import type { MerchantLine, MerchantSummary } from "@gousset/core";
import { Effect, Layer, Schema } from "effect";
import { describe, expect, test } from "vite-plus/test";

import { goussetServer } from "../gousset";
import type { GoussetServices } from "../gousset";
import { ERROR_LIMIT, RESULT_LIMIT } from "../results";
import { connectInProcess } from "../test-client";
import type { Caller, Runner } from "../tool";

// The merchants tool through the official client, on a small in-memory `Merchants` of made-up
// shops: the tool's words, paging and refusals; the service's own rules are core's tests.

const writer: Caller = { userId: "ada", canWrite: true };
const reader: Caller = { userId: "ada", canWrite: false };

type StoredMerchant = { id: string; name: string; aliases: Array<string> };

type Store = {
  merchants: Array<StoredMerchant>;
  /** Each merchant's latest lines, by its id. */
  lines: Map<string, ReadonlyArray<MerchantLine>>;
};

let made = 0;

const newId = () => {
  made += 1;

  return `00000000-0000-4000-8000-${String(made).padStart(12, "0")}`;
};

const CURRENT = { id: newId(), name: "Current account", institution: "Riverside Bank" };

function line(bookedOn: string, minor: number, label: string): MerchantLine {
  return { id: newId(), bookedOn, label, amount: { minor, currency: "EUR" }, account: CURRENT };
}

function merchant(name: string, aliases: Array<string>): StoredMerchant {
  return { id: newId(), name, aliases };
}

/** Four made-up shops; Greenmarket under two cleaned labels, with two lines. */
function store(): Store {
  const greenmarket = merchant("Greenmarket", ["GREENMARKET", "GREENMARKET RIVERTON"]);

  return {
    merchants: [
      greenmarket,
      merchant("Corner Cafe", ["CORNER CAFE"]),
      merchant("Fuelstop", ["FUELSTOP"]),
      merchant("Green Grocer", ["GREEN GROCER"]),
    ],
    lines: new Map([
      [
        greenmarket.id,
        [
          line("2026-11-03", -4290, "CB GREENMARKET 0311 RIVERTON"),
          line("2026-10-12", -1875, "CB GREENMARKET RIVERTON 1210"),
        ],
      ],
    ]),
  };
}

const summaryOf = (stored: StoredMerchant): MerchantSummary => ({
  id: stored.id,
  name: stored.name,
  aliases: stored.aliases.length,
});

const nameOf = (name: string) => {
  const trimmed = name.trim();

  if (trimmed === "") {
    return Effect.fail(new MerchantNameRefused({ reason: "blank" }));
  }

  return trimmed.length > MAX_MERCHANT_NAME
    ? Effect.fail(new MerchantNameRefused({ reason: "too_long" }))
    : Effect.succeed(trimmed);
};

/** `Merchants` over the store, as the database one answers. */
function merchantsOf(state: Store) {
  const byId = (merchantId: string) => {
    const found = state.merchants.find((each) => each.id === merchantId);

    return found === undefined
      ? Effect.fail(new MerchantNotFound({ merchantId }))
      : Effect.succeed(found);
  };

  const byName = (name: string) =>
    state.merchants.find((each) => each.name.toLowerCase() === name.trim().toLowerCase());

  return Layer.succeed(Merchants, {
    list: (_owner, query) => {
      const text = query.text?.toLowerCase() ?? "";

      const matching = state.merchants
        .filter(
          (each) =>
            text === "" ||
            each.name.toLowerCase().includes(text) ||
            each.aliases.some((alias) => alias.toLowerCase().includes(text)),
        )
        .toSorted((a, b) => (a.name < b.name ? -1 : 1));

      const after = query.after;
      const rest = after === null ? matching : matching.filter((each) => each.name > after);
      const page = rest.slice(0, query.limit);

      return Effect.succeed({
        merchants: page.map(summaryOf),
        next: rest.length > query.limit ? (page.at(-1)?.name ?? null) : null,
        total: matching.length,
      });
    },
    show: (_owner, merchantId) =>
      Effect.map(byId(merchantId), (found) => ({
        id: found.id,
        name: found.name,
        aliases: found.aliases.toSorted(),
        lines: state.lines.get(found.id) ?? [],
      })),
    named: (_owner, name) => {
      const found = byName(name);

      if (found !== undefined) {
        return Effect.succeed(summaryOf(found));
      }

      const close = state.merchants
        .filter((each) => each.name.toLowerCase().includes(name.trim().toLowerCase()))
        .map((each) => each.name)
        .toSorted()
        .slice(0, 5);

      return Effect.fail(new MerchantNameUnknown({ name, close }));
    },
    rename: (_owner, merchantId, name) =>
      Effect.gen(function* () {
        const wanted = yield* nameOf(name);
        const found = yield* byId(merchantId);
        const other = byName(wanted);

        if (other !== undefined && other.id !== found.id) {
          return yield* new MerchantNameTaken({ name: other.name });
        }

        found.name = wanted;

        return summaryOf(found);
      }),
    moveAlias: (_owner, merchantId, given, to) =>
      Effect.gen(function* () {
        const wanted = yield* nameOf(to);
        const from = yield* byId(merchantId);

        // As core cleans it: upper case, accents removed, spaces collapsed.
        const alias = given
          .normalize("NFKD")
          .replaceAll(/\p{M}/gu, "")
          .toUpperCase()
          .replaceAll(/\s+/g, " ")
          .trim();

        if (!from.aliases.includes(alias)) {
          return yield* new MerchantAliasNotFound({ alias });
        }

        const existing = byName(wanted);
        const target = existing ?? merchant(wanted, []);

        if (existing === undefined) {
          state.merchants.push(target);
        }

        from.aliases = from.aliases.filter((each) => each !== alias);
        target.aliases.push(alias);

        return {
          alias,
          from: summaryOf(from),
          to: summaryOf(target),
          created: existing === undefined,
        };
      }),
    merge: (_owner, merchantId, intoId) =>
      Effect.gen(function* () {
        const from = yield* byId(merchantId);
        const into = yield* byId(intoId);

        if (from.id === into.id) {
          return yield* new MerchantMergeRefused({ merchantId });
        }

        into.aliases.push(...from.aliases);
        state.merchants = state.merchants.filter((each) => each.id !== from.id);

        return { into: summaryOf(into), merged: from.name, aliasesMoved: from.aliases.length };
      }),
    recognise: () => Effect.succeed({ merchants: 0, aliases: 0 }),
  });
}

function runnerOf(state: Store): Runner<GoussetServices> {
  const layer = Layer.mergeAll(
    FixtureLedger,
    memoryAccountStore(),
    memoryLineStore(),
    // merchants never reaches the imports nor the export.
    Layer.mock(Imports, {}),
    Layer.mock(ImportProfiles, {}),
    Layer.mock(DataExport, {}),
    merchantsOf(state),
  );

  return (effect) => Effect.runPromiseExit(Effect.provide(effect, layer));
}

type Arguments = { readonly [key: string]: string | number | boolean };

async function merchants(state: Store, args: Arguments, caller: Caller = writer) {
  const client = await connectInProcess(
    goussetServer,
    { run: runnerOf(state) },
    caller,
    "2025-11-25",
  );

  const result = await client.callTool({ name: "merchants", arguments: args });
  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}

const Written = Schema.Record(
  Schema.String,
  Schema.Union([Schema.String, Schema.Number, Schema.Boolean]),
);

/** The arguments of a call a result writes after `before` (`merchants {…}`), read back. */
function writtenCall(text: string, before: string): Arguments | undefined {
  const at = text.indexOf(`${before}merchants {`);

  if (at === -1) {
    return undefined;
  }

  const json = text.slice(at + before.length + "merchants ".length).split("\n")[0] ?? "";

  return Schema.decodeUnknownSync(Written)(JSON.parse(json));
}

/** The merchants a page lists, in order. */
const namesOf = (text: string) =>
  [...text.matchAll(/^- (.+): \d+ cleaned labels?$/gm)].map(([, name]) => name);

/** A refusal: under the error limit, with a valid call that answers. */
async function expectValidExample(text: string, state: Store = store()) {
  expect(text.length).toBeLessThan(ERROR_LIMIT);

  const example = writtenCall(text, "A valid call: ");

  expect(example, text).toBeDefined();

  const answered = await merchants(state, example ?? {});

  expect(answered.isError, answered.text).toBe(false);

  return example;
}

describe("merchants list and search", () => {
  test("lists every merchant by name, with how many cleaned labels each has, no id", async () => {
    const state = store();
    const { text, isError } = await merchants(state, { action: "list" });

    expect(isError).toBe(false);
    expect(text).toContain("4 merchant(s) in all.");
    expect(namesOf(text)).toEqual(["Corner Cafe", "Fuelstop", "Green Grocer", "Greenmarket"]);
    expect(text).toContain("- Greenmarket: 2 cleaned labels");
    expect(text).toContain("- Fuelstop: 1 cleaned label");

    for (const each of state.merchants) {
      expect(text).not.toContain(each.id);
    }
  });

  test("says when the user has no merchant yet", async () => {
    const { text, isError } = await merchants(
      { merchants: [], lines: new Map() },
      {
        action: "list",
      },
    );

    expect(isError).toBe(false);
    expect(text).toContain("The user has no merchant yet");
  });

  test("reads every page with the next call it writes, never a merchant twice", async () => {
    const state: Store = {
      merchants: Array.from({ length: 23 }, (_, index) =>
        merchant(`Shop ${String(index).padStart(2, "0")}`, [`SHOP ${index}`]),
      ),
      lines: new Map(),
    };

    const seen: Array<string | undefined> = [];
    let next: Arguments | undefined = { action: "search", text: "shop", limit: 10 };
    let pages = 0;

    while (next !== undefined) {
      const { text, isError } = await merchants(state, next);

      expect(isError, text).toBe(false);
      expect(text).toContain('23 merchant(s) whose name or a cleaned label contains "shop".');

      seen.push(...namesOf(text));
      next = writtenCall(text, "More merchants remain. Read them with: ");
      pages += 1;

      if (next !== undefined) {
        expect(next).toMatchObject({ action: "search", text: "shop", limit: 10 });
      }
    }

    expect(pages).toBe(3);
    expect(seen).toHaveLength(23);
    expect(new Set(seen).size).toBe(23);
  });

  test("searches by a piece of a name or of a cleaned label, any case", async () => {
    const byName = await merchants(store(), { action: "search", text: "GREEN" });

    expect(byName.isError).toBe(false);
    expect(namesOf(byName.text)).toEqual(["Green Grocer", "Greenmarket"]);

    const byLabel = await merchants(store(), { action: "search", text: "riverton" });

    expect(namesOf(byLabel.text)).toEqual(["Greenmarket"]);

    const none = await merchants(store(), { action: "search", text: "no such shop" });

    expect(none.isError).toBe(false);
    expect(none.text).toContain("0 merchant(s)");
    expect(none.text).toContain("No merchant on this page.");
  });

  test("refuses a search without text, with a valid call", async () => {
    const searches: ReadonlyArray<Arguments> = [
      { action: "search" },
      { action: "search", text: "  " },
    ];

    for (const args of searches) {
      const { text, isError } = await merchants(store(), args);

      expect(isError).toBe(true);
      expect(text).toContain("search needs text");
      await expectValidExample(text);
    }
  });

  test(`stays under ${RESULT_LIMIT} characters, in one part, at the most merchants with the longest names`, async () => {
    const state: Store = {
      merchants: Array.from({ length: 150 }, (_, index) =>
        merchant(
          `${String(index).padStart(3, "0")} ${"Riverside Organic Market ".repeat(4)}`.slice(
            0,
            MAX_MERCHANT_NAME,
          ),
          [`ALIAS ${index}`],
        ),
      ),
      lines: new Map(),
    };

    const { text, isError } = await merchants(state, { action: "list", limit: 100 });

    expect(isError).toBe(false);
    expect(text.length).toBeLessThan(RESULT_LIMIT);
    expect(text).not.toContain("Part 1 of");
    expect(namesOf(text)).toHaveLength(100);
    expect(text).toContain("More merchants remain. Read them with:");
  });
});

describe("merchants show", () => {
  test("gives a merchant by its name in any case: its cleaned labels and latest lines", async () => {
    const state = store();
    const { text, isError } = await merchants(state, { action: "show", merchant: "greenMARKET" });

    expect(isError).toBe(false);
    expect(text).toContain("Merchant: Greenmarket.");
    expect(text).toContain(
      "Its 2 cleaned labels (bank labels once cleaned; edit with alias moves one to another merchant):\n- GREENMARKET\n- GREENMARKET RIVERTON",
    );
    expect(text).toContain("found among the 5,000 newest lines of the user's accounts");
    expect(text).toContain(
      '- 2026-11-03, Current account (Riverside Bank): -42.90 EUR, "CB GREENMARKET 0311 RIVERTON"',
    );
    expect(text).toContain('lines {"action":"search","text":"GREENMARKET"}');

    for (const each of [...state.merchants, CURRENT]) {
      expect(text).not.toContain(each.id);
    }
  });

  test("says when no line of its own is among the newest", async () => {
    const { text } = await merchants(store(), { action: "show", merchant: "Fuelstop" });

    expect(text).toContain("No line of its own among the 5,000 newest lines");
  });

  test("an unknown name: close names, and a call that answers", async () => {
    const { text, isError } = await merchants(store(), { action: "show", merchant: "green" });

    expect(isError).toBe(true);
    expect(text).toContain(
      'No merchant of the user\'s is named "green". Close names: Green Grocer, Greenmarket.',
    );
    expect(await expectValidExample(text)).toEqual({ action: "show", merchant: "Green Grocer" });
  });

  test("a name nothing is close to: search or list", async () => {
    const { text, isError } = await merchants(store(), { action: "show", merchant: "Pantry" });

    expect(isError).toBe(true);
    expect(text).toContain("nor has a name containing it");
    expect(await expectValidExample(text)).toEqual({ action: "list" });
  });

  test("asks for the merchant when show has none", async () => {
    const { text, isError } = await merchants(store(), { action: "show" });

    expect(isError).toBe(true);
    expect(text).toContain("show needs merchant");
    await expectValidExample(text);
  });

  test(`stays under ${ERROR_LIMIT} characters with the longest name and close names`, async () => {
    const long = "Riverside Organic Market ".repeat(4).slice(0, MAX_MERCHANT_NAME);

    const state: Store = {
      merchants: Array.from({ length: 5 }, (_, index) =>
        merchant(`${index}${long}`.slice(0, MAX_MERCHANT_NAME), []),
      ),
      lines: new Map(),
    };

    const { text, isError } = await merchants(state, {
      action: "show",
      merchant: "Riverside ".repeat(400),
    });

    expect(isError).toBe(true);
    expect(text.length).toBeLessThan(ERROR_LIMIT);
  });
});

describe("merchants edit", () => {
  test("renames a merchant", async () => {
    const state = store();

    const { text, isError } = await merchants(state, {
      action: "edit",
      merchant: "greenmarket",
      name: "Green Market",
    });

    expect(isError, text).toBe(false);
    expect(text).toBe(
      'Renamed the merchant "Greenmarket" to "Green Market". Its 2 cleaned labels and their lines stay its own.',
    );

    const shown = await merchants(state, { action: "show", merchant: "Green Market" });

    expect(shown.text).toContain("Merchant: Green Market.");
  });

  test("a name another merchant has: merge them instead", async () => {
    const state = store();

    const { text, isError } = await merchants(state, {
      action: "edit",
      merchant: "Green Grocer",
      name: "GREENMARKET",
    });

    expect(isError).toBe(true);
    expect(text).toContain('Another merchant is named "Greenmarket" already.');
    expect(await expectValidExample(text, state)).toEqual({
      action: "merge",
      merchant: "Green Grocer",
      into: "Greenmarket",
    });
  });

  test.each([
    ["a blank name", "   ", "name cannot be blank"],
    ["a name too long", "x".repeat(MAX_MERCHANT_NAME + 1), `name is at most ${MAX_MERCHANT_NAME}`],
  ])("%s", async (_, name, said) => {
    const { text, isError } = await merchants(store(), {
      action: "edit",
      merchant: "Fuelstop",
      name,
    });

    expect(isError).toBe(true);
    expect(text).toContain(said);
    expect(await expectValidExample(text)).toEqual({
      action: "edit",
      merchant: "Fuelstop",
      name: "Riverside Bakery",
    });
  });

  test("moves a cleaned label to a merchant made for it: a split", async () => {
    const state = store();

    const { text, isError } = await merchants(state, {
      action: "edit",
      merchant: "Greenmarket",
      alias: "greenmarket  riverton",
      to: "Greenmarket Riverton",
    });

    expect(isError, text).toBe(false);
    expect(text).toBe(
      'Moved the cleaned label "GREENMARKET RIVERTON", and its lines, from Greenmarket to Greenmarket Riverton, a merchant made for it, which has 1 cleaned label. Greenmarket keeps 1 cleaned label.',
    );

    const found = await merchants(state, { action: "search", text: "greenmarket" });

    expect(namesOf(found.text)).toEqual(["Greenmarket", "Greenmarket Riverton"]);
  });

  test("moves a cleaned label to a merchant that exists, and says what is left", async () => {
    const state = store();

    const { text } = await merchants(state, {
      action: "edit",
      merchant: "Fuelstop",
      alias: "FUELSTOP",
      to: "corner cafe",
    });

    expect(text).toContain("from Fuelstop to Corner Cafe, which has 2 cleaned labels.");
    expect(text).toContain("Fuelstop has no cleaned label left: merge it into another merchant");
  });

  test("a cleaned label that is not the merchant's: its own, and a call that moves one", async () => {
    const state = store();

    const { text, isError } = await merchants(state, {
      action: "edit",
      merchant: "Greenmarket",
      alias: "CORNER CAFE",
      to: "Somewhere",
    });

    expect(isError).toBe(true);
    expect(text).toContain(
      '"CORNER CAFE" is not one of Greenmarket\'s cleaned labels. Its cleaned labels: GREENMARKET, GREENMARKET RIVERTON.',
    );
    expect(await expectValidExample(text, state)).toEqual({
      action: "edit",
      merchant: "Greenmarket",
      alias: "GREENMARKET",
      to: "Somewhere",
    });
  });

  test("a blank merchant to move to", async () => {
    const { text, isError } = await merchants(store(), {
      action: "edit",
      merchant: "Greenmarket",
      alias: "GREENMARKET",
      to: " ",
    });

    expect(isError).toBe(true);
    expect(text).toContain("to cannot be blank");
    await expectValidExample(text);
  });

  test.each([
    ["neither name nor alias", {}, "edit needs either name"],
    ["to without alias", { to: "Greenmarket Fuel" }, "to needs alias"],
    ["alias without to", { alias: "GREENMARKET" }, "alias needs to"],
    ["name with alias", { name: "Green", alias: "GREENMARKET", to: "X" }, "one thing at a time"],
  ])("%s", async (_, more, said) => {
    const { text, isError } = await merchants(store(), {
      action: "edit",
      merchant: "Greenmarket",
      ...more,
    });

    expect(isError).toBe(true);
    expect(text).toContain(said);
    await expectValidExample(text);
  });

  test("an unknown merchant to edit: close names", async () => {
    const { text, isError } = await merchants(store(), {
      action: "edit",
      merchant: "Corner",
      name: "Corner Coffee",
    });

    expect(isError).toBe(true);
    expect(text).toContain("Close names: Corner Cafe.");
    await expectValidExample(text);
  });
});

describe("merchants merge", () => {
  test("moves every cleaned label into the merchant kept, and deletes the other", async () => {
    const state = store();

    const { text, isError } = await merchants(state, {
      action: "merge",
      merchant: "green grocer",
      into: "Greenmarket",
    });

    expect(isError, text).toBe(false);
    expect(text).toBe(
      "Merged Green Grocer into Greenmarket: 1 cleaned label moved, and Green Grocer deleted. Greenmarket now has 3 cleaned labels.",
    );

    const listed = await merchants(state, { action: "list" });

    expect(namesOf(listed.text)).toEqual(["Corner Cafe", "Fuelstop", "Greenmarket"]);
  });

  test("refuses a merge into itself", async () => {
    const { text, isError } = await merchants(store(), {
      action: "merge",
      merchant: "Fuelstop",
      into: "FUELSTOP",
    });

    expect(isError).toBe(true);
    expect(text).toContain("never into itself");
    await expectValidExample(text);
  });

  test("refuses a merge without both names, or with an unknown one", async () => {
    const missing = await merchants(store(), { action: "merge", merchant: "Fuelstop" });

    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("merge needs merchant");
    await expectValidExample(missing.text);

    const unknown = await merchants(store(), {
      action: "merge",
      merchant: "Fuelstop",
      into: "Pantry",
    });

    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain('No merchant of the user\'s is named "Pantry"');
    await expectValidExample(unknown.text);
  });
});

describe("the merchants tool", () => {
  test("refuses its writes to a token allowed to read only, and says how to get the write scope", async () => {
    const state = store();

    const writes: ReadonlyArray<Arguments> = [
      { action: "edit", merchant: "Greenmarket", name: "Green Market" },
      { action: "merge", merchant: "Green Grocer", into: "Greenmarket" },
    ];

    for (const args of writes) {
      const { text, isError } = await merchants(state, args, reader);

      expect(isError).toBe(true);
      expect(text).toContain("this connection was allowed to read only");
      expect(text).toContain("choose Read and write on Gousset's consent page");
    }

    expect(state.merchants.map((each) => each.name)).toEqual([
      "Greenmarket",
      "Corner Cafe",
      "Fuelstop",
      "Green Grocer",
    ]);

    const read = await merchants(state, { action: "show", merchant: "Greenmarket" }, reader);

    expect(read.isError).toBe(false);
  });

  test("writes, says so, and comes last in the fixed order", async () => {
    const client = await connectInProcess(
      goussetServer,
      { run: runnerOf(store()) },
      reader,
      "2026-07-28",
    );

    const { tools } = await client.listTools();
    const tool = tools.find((each) => each.name === "merchants");

    expect(tools.map((each) => each.name).at(-1)).toBe("merchants");
    expect(tool?.title).toBe("Merchants");
    expect(tool?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
  });
});
