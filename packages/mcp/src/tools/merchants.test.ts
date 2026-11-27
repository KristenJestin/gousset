import { createHash } from "node:crypto";

import {
  CategoryNotFound,
  CategoryRefused,
  CategoryStore,
  DataExport,
  Expenses,
  ImportProfiles,
  Imports,
  LineMerchantRefused,
  LineNotFound,
  MAX_MERCHANT_NAME,
  MerchantAliasNotFound,
  MerchantLabelRefused,
  MerchantLabelTaken,
  MerchantLogoNotFound,
  MerchantLogoRefused,
  MerchantMergeRefused,
  MerchantNameRefused,
  MerchantNameTaken,
  MerchantNameUnknown,
  MerchantNotFound,
  Merchants,
  MonthFacts,
  RuleJobs,
  Subscriptions,
  Transfers,
  checkLogo,
  memoryAccountStore,
  memoryCategory,
  memoryCategoryStore,
  memoryId,
  memoryLineStore,
  merchantKey,
} from "@gousset/core";
import type {
  Look,
  LookColor,
  MemoryCategoryRows,
  MemoryLineDetail,
  MemoryLineRows,
  MerchantDefaultCategory,
  MerchantLine,
  MerchantLogo,
  MerchantSummary,
} from "@gousset/core";
import { UserData } from "@gousset/db/user-data";
import { Effect, Layer, Result, Schema } from "effect";
import { describe, expect, test } from "vite-plus/test";

import { goussetServer } from "../gousset";
import type { GoussetServices } from "../gousset";
import { ERROR_LIMIT, RESULT_LIMIT } from "../results";
import { connectInProcess } from "../test-client";
import type { Caller, Runner } from "../tool";

// The merchants tool through the official client, on a small in-memory `Merchants` of made-up
// shops: the tool's words, paging and refusals; the service's own rules are core's tests.

const writer: Caller = { userId: "ada", canWrite: true, currency: "EUR" };
const reader: Caller = { userId: "ada", canWrite: false, currency: "EUR" };

type StoredMerchant = {
  id: string;
  name: string;
  aliases: Array<string>;
  intermediary?: boolean;
  subscriptionDismissed?: boolean;
  /** Its colour (#204); automatic when left out. */
  color?: LookColor | null;
  /** Its logo (#204), as core keeps it. */
  logo?: MerchantLogo;
};

/** A line paid through an intermediary (#30), as core reads it: its intermediary and who was paid. */
type PaidLine = {
  readonly line: MemoryLineDetail;
  readonly intermediary: string | null;
  merchant: string | null;
  /** One whole entry of its own, which who was paid can be set on. */
  readonly assignable: boolean;
};

type Store = {
  merchants: Array<StoredMerchant>;
  /** Each merchant's latest lines, by its id. */
  lines: Map<string, ReadonlyArray<MerchantLine>>;
  /** Ada's categories, and her merchants' default categories, by owner. */
  categories?: Map<string, MemoryCategoryRows>;
  /** Runs just before a default category is written: what another call does meanwhile. */
  beforeDefault?: () => void;
  /** Ada's lines, each with its intermediary and who was paid. */
  paid?: Array<PaidLine>;
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

/** Ada's categories, a few of the default set's, with Family archived. */
function categoryRows(merchants: ReadonlyArray<StoredMerchant>): MemoryCategoryRows {
  const groceries = memoryCategory("expense", "Groceries");

  return {
    categories: [
      groceries,
      memoryCategory("expense", "Bakery", { parentId: groceries.id }),
      memoryCategory("expense", "Transport", { position: 1 }),
      memoryCategory("expense", "Family", {
        position: 2,
        archivedAt: "2026-11-01T10:00:00.000Z",
      }),
      memoryCategory("expense", "Other", { position: 3, fallback: true }),
      memoryCategory("income", "Salary"),
      memoryCategory("income", "Other", { position: 1, fallback: true }),
    ],
    entries: [],
    lines: [],
    merchants: merchants.map((each) => ({ id: each.id, defaultCategoryId: null })),
  };
}

/** Four made-up shops; Greenmarket under two cleaned labels, with two lines. */
function store(): Store {
  const greenmarket = merchant("Greenmarket", ["GREENMARKET", "GREENMARKET RIVERTON"]);

  const merchants = [
    greenmarket,
    merchant("Corner Cafe", ["CORNER CAFE"]),
    merchant("Fuelstop", ["FUELSTOP"]),
    merchant("Green Grocer", ["GREEN GROCER"]),
  ];

  return {
    categories: new Map([[writer.userId, categoryRows(merchants)]]),
    merchants,
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

const lookOf = (stored: StoredMerchant): Look => ({
  color: stored.color ?? null,
  logo: stored.logo?.version ?? null,
});

const summaryOf = (stored: StoredMerchant): MerchantSummary => ({
  id: stored.id,
  name: stored.name,
  aliases: stored.aliases.length,
  intermediary: stored.intermediary === true,
  look: lookOf(stored),
});

/** Labels cleaned as core cleans them, once each; the first that cleans to nothing is refused. */
function keysOf(labels: ReadonlyArray<string>) {
  const keys: Array<string> = [];

  for (const label of labels) {
    const key = merchantKey(label, null);

    if (key === null) {
      return Effect.fail(new MerchantLabelRefused({ label }));
    }

    if (!keys.includes(key)) {
      keys.push(key);
    }
  }

  return Effect.succeed(keys);
}

const nameOf = (name: string) => {
  const trimmed = name.trim();

  if (trimmed === "") {
    return Effect.fail(new MerchantNameRefused({ reason: "blank" }));
  }

  return trimmed.length > MAX_MERCHANT_NAME
    ? Effect.fail(new MerchantNameRefused({ reason: "too_long" }))
    : Effect.succeed(trimmed);
};

/** A merchant's default category, as the database reads it with the merchant. */
function defaultOf(state: Store, merchantId: string): MerchantDefaultCategory | null {
  const rows = state.categories?.get(writer.userId);
  const chosen = rows?.merchants?.find((each) => each.id === merchantId)?.defaultCategoryId;
  const category = rows?.categories.find((each) => each.id === chosen);

  if (category === undefined) {
    return null;
  }

  const parent = rows?.categories.find((each) => each.id === category.parentId);

  return {
    id: category.id,
    name: category.name,
    parentName: parent?.name ?? null,
    kind: category.kind,
    icon: null,
    color: null,
    archived: category.archivedAt !== null,
  };
}

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

  const paidLine = (lineId: string) => state.paid?.find((each) => each.line.id === lineId);

  /** A merchant of the store by its name, as a line names it; null for none. */
  const named = (name: string | null) => {
    const stored = name === null ? undefined : byName(name);

    return stored === undefined ? null : { id: stored.id, name: stored.name, look: lookOf(stored) };
  };

  /** The first of `keys` another merchant than `merchantId` has, as core refuses it. */
  const takenLabel = (keys: ReadonlyArray<string>, merchantId: string | null) => {
    for (const key of keys) {
      const other = state.merchants.find((each) => each.aliases.includes(key));

      if (other !== undefined && other.id !== merchantId) {
        return Effect.fail(new MerchantLabelTaken({ label: key, alias: key, name: other.name }));
      }
    }

    return Effect.void;
  };

  /** A default category chosen: one of Ada's, not archived. */
  const chosenDefault = (categoryId: string) => {
    const rows = state.categories?.get(writer.userId);
    const found = rows?.categories.find((each) => each.id === categoryId);

    if (found === undefined) {
      return Effect.fail(new CategoryNotFound({ categoryId }));
    }

    return found.archivedAt === null
      ? Effect.succeed(found.id)
      : Effect.fail(new CategoryRefused({ reason: "archived" }));
  };

  const setDefault = (merchantId: string, categoryId: string | null) => {
    const rows = state.categories?.get(writer.userId);

    if (rows !== undefined) {
      state.categories?.set(writer.userId, {
        ...rows,
        merchants: [
          ...(rows.merchants ?? []).filter((each) => each.id !== merchantId),
          { id: merchantId, defaultCategoryId: categoryId },
        ],
      });
    }
  };

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
        intermediary: found.intermediary === true,
        look: lookOf(found),
        subscriptionDismissed: found.subscriptionDismissed === true,
        defaultCategory: defaultOf(state, found.id),
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
    create: (_owner, input) =>
      Effect.gen(function* () {
        const wanted = yield* nameOf(input.name);
        const keys = yield* keysOf(input.aliases);
        const other = byName(wanted);

        if (other !== undefined) {
          return yield* new MerchantNameTaken({ name: other.name });
        }

        if (input.defaultCategoryId !== null) {
          yield* chosenDefault(input.defaultCategoryId);
        }

        yield* takenLabel(keys, null);

        const made: StoredMerchant = {
          ...merchant(wanted, keys),
          intermediary: input.intermediary,
          color: input.color,
        };

        state.merchants.push(made);
        setDefault(made.id, input.defaultCategoryId);

        return summaryOf(made);
      }),
    edit: (_owner, merchantId, edit) =>
      Effect.gen(function* () {
        const wanted = edit.name === undefined ? undefined : yield* nameOf(edit.name);
        const keys = yield* keysOf(edit.addAliases ?? []);
        const found = yield* byId(merchantId);
        const other = wanted === undefined ? undefined : byName(wanted);

        if (other !== undefined && other.id !== found.id) {
          return yield* new MerchantNameTaken({ name: other.name });
        }

        yield* takenLabel(keys, found.id);

        found.name = wanted ?? found.name;
        found.intermediary = edit.intermediary ?? found.intermediary;
        found.color = edit.color === undefined ? found.color : edit.color;
        found.aliases.push(...keys.filter((key) => !found.aliases.includes(key)));

        return summaryOf(found);
      }),
    setLogo: (_owner, merchantId, content) =>
      Effect.gen(function* () {
        const checked = checkLogo(content);

        if (Result.isFailure(checked)) {
          return yield* new MerchantLogoRefused({ reason: checked.failure });
        }

        const found = yield* byId(merchantId);
        const version = createHash("sha256").update(content).digest("hex").slice(0, 16);

        found.logo = { mediaType: checked.success, content: new Uint8Array(content), version };

        return lookOf(found);
      }),
    removeLogo: (_owner, merchantId) =>
      Effect.map(byId(merchantId), (found) => {
        found.logo = undefined;

        return lookOf(found);
      }),
    logo: (_owner, merchantId) =>
      Effect.flatMap(byId(merchantId), (found) =>
        found.logo === undefined
          ? Effect.fail(new MerchantLogoNotFound({ merchantId }))
          : Effect.succeed(found.logo),
      ),
    markIntermediary: (_owner, merchantId, intermediary) =>
      Effect.map(byId(merchantId), (found) => {
        found.intermediary = intermediary;

        return summaryOf(found);
      }),
    markSubscription: (_owner, merchantId, dismissed) =>
      Effect.map(byId(merchantId), (found) => {
        found.subscriptionDismissed = dismissed;

        return summaryOf(found);
      }),
    ofLine: (_owner, lineId) => {
      const found = paidLine(lineId);

      if (found === undefined) {
        return Effect.fail(new LineNotFound({ lineId }));
      }

      const paid = named(found.merchant);

      return Effect.succeed({
        merchant: paid,
        intermediary: named(found.intermediary),
        asks: found.intermediary !== null && paid === null && found.assignable,
      });
    },
    assignLine: (_owner, lineId, name) =>
      Effect.gen(function* () {
        const wanted = yield* nameOf(name);
        const found = paidLine(lineId);

        if (found === undefined) {
          return yield* new LineNotFound({ lineId });
        }

        if (found.intermediary === null) {
          return yield* new LineMerchantRefused({ lineId, reason: "not_intermediary" });
        }

        if (!found.assignable) {
          return yield* new LineMerchantRefused({ lineId, reason: "not_one_entry" });
        }

        const existing = byName(wanted);

        if (existing?.intermediary === true) {
          return yield* new LineMerchantRefused({ lineId, reason: "intermediary_chosen" });
        }

        const paid = existing ?? merchant(wanted, []);

        if (existing === undefined) {
          state.merchants.push(paid);
        }

        found.merchant = paid.name;

        return {
          merchant: { id: paid.id, name: paid.name, look: lookOf(paid) },
          created: existing === undefined,
          category: null,
        };
      }),
  });
}

/** The categories over the store, with what happens meanwhile before a default is written. */
function categoriesOf(state: Store) {
  const memory = memoryCategoryStore(state.categories);
  const meanwhile = state.beforeDefault;

  if (meanwhile === undefined) {
    return memory;
  }

  return Layer.effect(
    CategoryStore,
    Effect.gen(function* () {
      const store = yield* CategoryStore;

      return {
        ...store,
        setMerchantDefault: (owner, merchantId, decide) =>
          Effect.suspend(() => {
            meanwhile();

            return store.setMerchantDefault(owner, merchantId, decide);
          }),
      };
    }),
  ).pipe(Layer.provide(memory));
}

/** The lines of the store, as the lines' own store reads them. */
function lineRowsOf(state: Store): MemoryLineRows {
  const account = {
    ...CURRENT,
    kind: "current",
    envelope: null,
    currency: "EUR",
    mode: "lines",
    openingBalanceMinor: 0,
    openedOn: null,
    closedOn: null,
    settlesIntoAccountId: null,
    creditOrder: "oldest_first",
    balanceCategoryId: null,
    topUpDays: 3,
    topUpCapMinor: null,
  } as const;

  return { accounts: [account], lines: (state.paid ?? []).map((each) => each.line), imports: [] };
}

function runnerOf(state: Store): Runner<GoussetServices> {
  const layer = Layer.mergeAll(
    memoryAccountStore(),
    memoryLineStore(new Map([[writer.userId, lineRowsOf(state)]])),
    categoriesOf(state),
    // merchants never reaches the imports nor the export.
    Layer.mock(Imports, {}),
    Layer.mock(ImportProfiles, {}),
    Layer.mock(DataExport, {}),
    Layer.mock(Transfers, {}),
    Layer.mock(Expenses, {}),
    Layer.mock(UserData, {}),
    Layer.mock(RuleJobs, {}),
    Layer.mock(Subscriptions, {}),
    Layer.mock(MonthFacts, {}),
    merchantsOf(state),
  );

  return (effect) => Effect.runPromiseExit(Effect.provide(effect, layer));
}

type Arguments = {
  readonly [key: string]: string | number | boolean | ReadonlyArray<string>;
};

/** A PNG's first bytes, made here: no real picture. */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);

/** A PNG one byte over 256 KiB. */
function largePng() {
  const bytes = new Uint8Array(256 * 1024 + 1);

  bytes.set(PNG);

  return bytes;
}

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

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
  Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Array(Schema.String)]),
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

describe("merchants edit with category", () => {
  test("sets the merchant's default category, which show then gives", async () => {
    const state = store();

    const { text, isError } = await merchants(state, {
      action: "edit",
      merchant: "greenmarket",
      category: "groceries > bakery",
    });

    expect(isError, text).toBe(false);
    expect(text).toBe(
      "Greenmarket's default category is now Groceries > Bakery (expense): the category its entries go in by default.",
    );

    const shown = await merchants(state, { action: "show", merchant: "Greenmarket" });

    expect(shown.text).toContain("Default category: Groceries > Bakery (expense).");
  });

  test("an income category, and clear_category to clear it", async () => {
    const state = store();

    const set = await merchants(state, {
      action: "edit",
      merchant: "Corner Cafe",
      category: "Salary",
    });

    expect(set.text).toContain("is now Salary (income)");

    const { text, isError } = await merchants(state, {
      action: "edit",
      merchant: "Corner Cafe",
      clear_category: true,
    });

    expect(isError, text).toBe(false);
    expect(text).toBe("Corner Cafe has no default category any more.");

    const shown = await merchants(state, { action: "show", merchant: "Corner Cafe" });

    expect(shown.text).toContain("No default category: edit with category sets one.");
  });

  test("category is always a name: a category named None is chosen, and none clears nothing", async () => {
    const state = store();

    await merchants(state, { action: "edit", merchant: "Corner Cafe", category: "Transport" });

    const missing = await merchants(state, {
      action: "edit",
      merchant: "Corner Cafe",
      category: "none",
    });

    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('No category of the user\'s is named "none".');

    const kept = await merchants(state, { action: "show", merchant: "Corner Cafe" });

    expect(kept.text).toContain("Default category: Transport (expense).");

    const rows = state.categories?.get(writer.userId);

    rows?.categories.push(memoryCategory("expense", "None", { position: 4 }));

    const { text, isError } = await merchants(state, {
      action: "edit",
      merchant: "Corner Cafe",
      category: "None",
    });

    expect(isError, text).toBe(false);
    expect(text).toContain("Corner Cafe's default category is now None (expense)");
  });

  test("a blank category is refused with a call that only reads", async () => {
    const { text, isError } = await merchants(store(), {
      action: "edit",
      merchant: "Fuelstop",
      category: " ",
    });

    expect(isError).toBe(true);
    expect(text).toContain("clear_category");
    expect(text).toContain('A valid call: categories {"action":"list"}');
  });

  test("a category merged away meanwhile: a call that only reads, never one that clears", async () => {
    const state = store();

    state.beforeDefault = () => {
      const rows = state.categories?.get(writer.userId);

      if (rows !== undefined) {
        rows.categories = rows.categories.filter((each) => each.name !== "Transport");
      }
    };

    const { text, isError } = await merchants(state, {
      action: "edit",
      merchant: "Fuelstop",
      category: "Transport",
    });

    expect(isError).toBe(true);
    expect(text).toContain('The category "Transport" is gone');
    expect(text).toContain('A valid call: categories {"action":"list"}');
    expect(text).not.toContain("clear_category");
    expect(text.length).toBeLessThan(ERROR_LIMIT);
  });

  test("an unknown category: the user's categories, and a call that answers", async () => {
    const state = store();

    const { text, isError } = await merchants(state, {
      action: "edit",
      merchant: "Fuelstop",
      category: "Fuel",
    });

    expect(isError).toBe(true);
    expect(text).toContain('No category of the user\'s is named "Fuel".');
    expect(text).toContain("Groceries > Bakery");
    expect(text).toContain('categories {"action":"list"}');
    expect(text.length).toBeLessThan(ERROR_LIMIT);
  });

  test("a name an expense and an income category share: kind tells them apart", async () => {
    const state = store();

    const { text, isError } = await merchants(state, {
      action: "edit",
      merchant: "Fuelstop",
      category: "Other",
    });

    expect(isError).toBe(true);
    expect(text).toContain("Add kind, expense or income");

    const example = await expectValidExample(text, state);

    expect(example).toEqual({
      action: "edit",
      merchant: "Fuelstop",
      category: "Other",
      kind: "expense",
    });
  });

  test("an archived category is refused, with the call that restores it", async () => {
    const state = store();

    const { text, isError } = await merchants(state, {
      action: "edit",
      merchant: "Fuelstop",
      category: "Family",
    });

    expect(isError).toBe(true);
    expect(text).toContain('"Family" is archived');
    expect(text).toContain('categories {"action":"archive","category":"Family","restore":true}');

    const shown = await merchants(state, { action: "show", merchant: "Fuelstop" });

    expect(shown.text).toContain("No default category");
  });

  test("an archived default is shown as such", async () => {
    const state = store();
    const rows = state.categories?.get(writer.userId);
    const family = rows?.categories.find((each) => each.name === "Family");
    const fuelstop = state.merchants.find((each) => each.name === "Fuelstop");

    if (rows !== undefined) {
      rows.merchants = rows.merchants?.map((each) =>
        each.id === fuelstop?.id ? { ...each, defaultCategoryId: family?.id ?? null } : each,
      );
    }

    const { text } = await merchants(state, { action: "show", merchant: "Fuelstop" });

    expect(text).toContain(
      "Default category: Family (expense), archived: it can no longer be chosen; edit with category sets another.",
    );
  });

  test("clear_category goes alone, and never with category", async () => {
    const { text, isError } = await merchants(store(), {
      action: "edit",
      merchant: "Fuelstop",
      category: "Transport",
      clear_category: true,
    });

    expect(isError).toBe(true);
    expect(text).toContain("one thing at a time");
    await expectValidExample(text);
  });

  test("category goes alone", async () => {
    const { text, isError } = await merchants(store(), {
      action: "edit",
      merchant: "Fuelstop",
      name: "Fuel Stop",
      category: "Transport",
    });

    expect(isError).toBe(true);
    expect(text).toContain("one thing at a time");
    await expectValidExample(text);
  });

  test("needs the write scope", async () => {
    const { text, isError } = await merchants(
      store(),
      { action: "edit", merchant: "Fuelstop", category: "Transport" },
      reader,
    );

    expect(isError).toBe(true);
    expect(text).toContain("choose Read and write on Gousset's consent page");
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

/** Ada's store, with PayPal, an intermediary, and a line of hers paid through it. */
function withPaypal(change: Partial<PaidLine> = {}): Store {
  const state = store();

  state.merchants.push({ ...merchant("PayPal", ["PAYPAL"]), intermediary: true });
  state.paid = [
    {
      line: {
        id: memoryId(),
        accountId: CURRENT.id,
        bookedOn: "2026-10-21",
        valueOn: null,
        amountMinor: -1999,
        label: "CB PAYPAL *PIXELPLAY 21/10",
        memo: null,
        counterpartyName: null,
      },
      intermediary: "PayPal",
      merchant: null,
      assignable: true,
      ...change,
    },
  ];

  return state;
}

const paidLineOf = (state: Store) => state.paid?.[0]?.line.id ?? "";

describe("merchants and payment intermediaries", () => {
  test("list, search and show say which merchant is an intermediary", async () => {
    const state = withPaypal();
    const listed = await merchants(state, { action: "list" });

    expect(listed.text).toContain("- PayPal (payment intermediary): 1 cleaned label");
    expect(listed.text).toContain("- Fuelstop: 1 cleaned label");

    const found = await merchants(state, { action: "search", text: "pay" });

    expect(found.text).toContain("- PayPal (payment intermediary): 1 cleaned label");

    const shown = await merchants(state, { action: "show", merchant: "paypal" });

    expect(shown.isError, shown.text).toBe(false);
    expect(shown.text).toContain("Merchant: PayPal, a payment intermediary");
  });

  test("edit with intermediary marks a merchant one, or not", async () => {
    const state = withPaypal();

    const marked = await merchants(state, {
      action: "edit",
      merchant: "Corner Cafe",
      intermediary: true,
    });

    expect(marked.isError, marked.text).toBe(false);
    expect(marked.text).toContain("Corner Cafe is now a payment intermediary");
    expect(state.merchants.find((each) => each.name === "Corner Cafe")?.intermediary).toBe(true);

    const unmarked = await merchants(state, {
      action: "edit",
      merchant: "PayPal",
      intermediary: false,
    });

    expect(unmarked.isError, unmarked.text).toBe(false);
    expect(unmarked.text).toContain("PayPal is no longer a payment intermediary");
    expect(state.merchants.find((each) => each.name === "PayPal")?.intermediary).toBe(false);

    const both = await merchants(state, {
      action: "edit",
      merchant: "PayPal",
      intermediary: true,
      name: "Paypal",
    });

    expect(both.isError).toBe(true);
  });

  test("assign sets who was paid, made when new, and proposes the rule for next time", async () => {
    const state = withPaypal();

    const { text, isError } = await merchants(state, {
      action: "assign",
      line: paidLineOf(state),
      merchant: "Pixelplay",
    });

    expect(isError, text).toBe(false);
    expect(text).toContain(
      'Who was paid on the line of 2026-10-21, -19.99 EUR, "CB PAYPAL *PIXELPLAY 21/10", is now Pixelplay, a merchant made for it.',
    );
    expect(text).toContain(
      'propose this rule to the user: rules {"action":"create","conditions":[{"field":"label","operator":"contains","value":"PAYPAL *PIXELPLAY"}],"merchant":"Pixelplay","from_correction":true}',
    );
    expect(text).not.toContain('"value":"PAYPAL"}');
    expect(state.paid?.[0]?.merchant).toBe("Pixelplay");
    expect(state.merchants.some((each) => each.name === "Pixelplay")).toBe(true);

    // An existing merchant is named in any case, and not made again.
    const again = await merchants(state, {
      action: "assign",
      line: paidLineOf(state),
      merchant: "corner cafe",
    });

    expect(again.isError, again.text).toBe(false);
    expect(again.text).toContain("is now Corner Cafe.");
    expect(state.merchants.filter((each) => each.name === "Corner Cafe")).toHaveLength(1);
  });

  test("assign refuses what it cannot set, saying what to do", async () => {
    const plain = withPaypal({ intermediary: null });

    const refusals = [
      [plain, "Pixelplay", "names no payment intermediary"],
      [withPaypal({ assignable: false }), "Pixelplay", "one expense or income of its own"],
      [withPaypal(), "paypal", "is a payment intermediary itself"],
    ] as const;

    for (const [state, name, says] of refusals) {
      const { text, isError } = await merchants(state, {
        action: "assign",
        line: paidLineOf(state),
        merchant: name,
      });

      expect(isError).toBe(true);
      expect(text).toContain(says);
      expect(text).toContain(`lines {"action":"show","line":"${paidLineOf(state)}"}`);
      expect(text.length).toBeLessThan(ERROR_LIMIT);
    }

    const unknown = await merchants(withPaypal(), {
      action: "assign",
      line: "not-a-line",
      merchant: "Pixelplay",
    });

    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain("Handles come from search");

    const missing = await merchants(withPaypal(), { action: "assign", merchant: "Pixelplay" });

    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("assign needs line");

    const readOnly = await merchants(
      withPaypal(),
      { action: "assign", line: paidLineOf(plain), merchant: "Pixelplay" },
      reader,
    );

    expect(readOnly.isError).toBe(true);
    expect(readOnly.text).toContain("this connection was allowed to read only");
  });
});

describe("merchants and subscriptions", () => {
  test("edit with subscription false dismisses a merchant's payments, true proposes them again", async () => {
    const state = store();
    const greenmarket = () => state.merchants.find((each) => each.name === "Greenmarket");

    const dismissed = await merchants(state, {
      action: "edit",
      merchant: "greenmarket",
      subscription: false,
    });

    expect(dismissed.isError, dismissed.text).toBe(false);
    expect(dismissed.text).toContain(
      "Greenmarket's payments are no subscription: month subscriptions never proposes them again.",
    );
    expect(greenmarket()?.subscriptionDismissed).toBe(true);

    const shown = await merchants(state, { action: "show", merchant: "Greenmarket" });

    expect(shown.text).toContain("The user said its payments are no subscription");

    const back = await merchants(state, {
      action: "edit",
      merchant: "Greenmarket",
      subscription: true,
    });

    expect(back.isError, back.text).toBe(false);
    expect(back.text).toContain("Greenmarket's payments may be proposed as a subscription again");
    expect(greenmarket()?.subscriptionDismissed).toBe(false);

    const again = await merchants(state, { action: "show", merchant: "Greenmarket" });

    expect(again.text).not.toContain("no subscription");
  });

  test("edit with subscription does one thing at a time, on a merchant that exists", async () => {
    const both = await merchants(store(), {
      action: "edit",
      merchant: "Greenmarket",
      subscription: false,
      name: "Green Market",
    });

    expect(both.isError).toBe(true);
    expect(both.text).toContain("edit does one thing at a time");

    const unknown = await merchants(store(), {
      action: "edit",
      merchant: "Pantry",
      subscription: false,
    });

    expect(unknown.isError).toBe(true);
    expect(await expectValidExample(unknown.text)).toEqual({ action: "list" });
  });
});

describe("merchants create (#204)", () => {
  test("makes a merchant by hand with its labels, default category, mark and colour", async () => {
    const state = store();

    const { text, isError } = await merchants(state, {
      action: "create",
      name: "Riverside Bakery",
      // Two spellings of one shop: one cleaned label.
      labels: ["CB RIVERSIDE BAKERY 2110 RIVERTON", "riverside bakery"],
      category: "Groceries > Bakery",
      color: "amber",
    });

    expect(isError, text).toBe(false);
    expect(text).toContain("Made the merchant Riverside Bakery.");
    expect(text).toContain("1 cleaned label name the lines");

    const made = state.merchants.find((each) => each.name === "Riverside Bakery");

    expect(made?.aliases).toEqual(["RIVERSIDE BAKERY"]);
    expect(made?.color).toBe("amber");

    const shown = await merchants(state, { action: "show", merchant: "riverside bakery" });

    expect(shown.text).toContain("Default category: Groceries > Bakery (expense).");
    expect(shown.text).toContain("Shown as its initials on amber; no logo");
    expect(shown.text).toContain("- RIVERSIDE BAKERY");

    const listed = await merchants(state, { action: "search", text: "riverside" });

    expect(listed.text).toContain("- Riverside Bakery: 1 cleaned label, colour amber");
  });

  test("makes one with its name alone, automatic and no label", async () => {
    const state = store();

    const { text, isError } = await merchants(state, {
      action: "create",
      name: "Corner Bookshop",
      intermediary: false,
      color: "automatic",
    });

    expect(isError, text).toBe(false);
    expect(text).toContain("No cleaned label names it yet");
    expect(state.merchants.find((each) => each.name === "Corner Bookshop")?.color).toBeNull();
  });

  test.each([
    ["no name", { action: "create" }, "create needs name"],
    ["a blank name", { action: "create", name: "  " }, "create needs name"],
    ["a name taken", { action: "create", name: "greenmarket" }, 'named "Greenmarket" already'],
    [
      "a label that names no one",
      { action: "create", name: "Cash", labels: ["RETRAIT DAB 21/10"] },
      "names no one once cleaned",
    ],
  ] as const)("refuses %s, with a valid call", async (_, args, says) => {
    const state = store();
    const { text, isError } = await merchants(state, args);

    expect(isError).toBe(true);
    expect(text).toContain(says);
    expect(state.merchants).toHaveLength(4);
    await expectValidExample(text);
  });

  test("refuses an archived category, with a call that reads the categories", async () => {
    const state = store();

    const { text, isError } = await merchants(state, {
      action: "create",
      name: "Toy Shop",
      category: "Family",
    });

    expect(isError).toBe(true);
    expect(text).toContain('"Family" is archived');
    expect(text).toContain('A valid call: categories {"action":"list"}');
    expect(state.merchants).toHaveLength(4);
  });

  test("refuses a label another merchant has, with the create that leaves it out, then the move", async () => {
    const state = store();

    const { text, isError } = await merchants(state, {
      action: "create",
      name: "Greenmarket Fuel",
      labels: ["CB GREENMARKET RIVERTON 2110", "greenmarket riverton", "GREENMARKET FUEL 2110"],
      category: "Transport",
      intermediary: false,
      color: "teal",
    });

    expect(isError).toBe(true);
    expect(text).toContain('The label "GREENMARKET RIVERTON" names Greenmarket already');
    expect(state.merchants).toHaveLength(4);

    // The same create without the labels cleaned as the one taken: it makes what was asked.
    expect(await expectValidExample(text, state)).toEqual({
      action: "create",
      name: "Greenmarket Fuel",
      labels: ["GREENMARKET FUEL 2110"],
      category: "Transport",
      intermediary: false,
      color: "teal",
    });

    const move = writtenCall(text, "then move the label to it: ");

    expect(move).toEqual({
      action: "edit",
      merchant: "Greenmarket",
      alias: "GREENMARKET RIVERTON",
      to: "Greenmarket Fuel",
    });

    const moved = await merchants(state, move ?? {});

    expect(moved.isError, moved.text).toBe(false);

    const made = state.merchants.find((each) => each.name === "Greenmarket Fuel");

    expect(made?.aliases).toEqual(["GREENMARKET FUEL", "GREENMARKET RIVERTON"]);
    expect(made?.color).toBe("teal");
    expect(
      (await merchants(state, { action: "show", merchant: "Greenmarket Fuel" })).text,
    ).toContain("Default category: Transport (expense).");
  });
});

describe("merchants edit with color, labels and logo (#204)", () => {
  test("sets a colour, then the automatic one again", async () => {
    const state = store();
    const set = await merchants(state, { action: "edit", merchant: "Fuelstop", color: "teal" });

    expect(set.isError, set.text).toBe(false);
    expect(set.text).toContain("Fuelstop's avatar is now drawn on teal.");

    const automatic = await merchants(state, {
      action: "edit",
      merchant: "Fuelstop",
      color: "automatic",
    });

    expect(automatic.text).toContain("an automatic colour");
    expect(state.merchants.find((each) => each.name === "Fuelstop")?.color).toBeNull();
  });

  test("adds labels, and refuses one another merchant has", async () => {
    const state = store();

    const added = await merchants(state, {
      action: "edit",
      merchant: "Fuelstop",
      labels: ["FUELSTOP", "PRLV SEPA FUELSTOP CARD"],
    });

    expect(added.isError, added.text).toBe(false);
    expect(added.text).toContain("Fuelstop now has 1 cleaned label");

    const taken = await merchants(state, {
      action: "edit",
      merchant: "Fuelstop",
      labels: ["CORNER CAFE"],
    });

    expect(taken.isError).toBe(true);
    expect(taken.text).toContain("names Corner Cafe already");
    expect(await expectValidExample(taken.text, state)).toEqual({
      action: "edit",
      merchant: "Corner Cafe",
      alias: "CORNER CAFE",
      to: "Fuelstop",
    });
  });

  test("sets a logo from its base64, which show and list then say, and clears it", async () => {
    const state = store();

    const set = await merchants(state, {
      action: "edit",
      merchant: "Greenmarket",
      logo: base64(PNG),
    });

    expect(set.isError, set.text).toBe(false);
    expect(set.text).toContain("Greenmarket's logo is set");
    expect(state.merchants.find((each) => each.name === "Greenmarket")?.logo?.mediaType).toBe(
      "image/png",
    );

    const shown = await merchants(state, { action: "show", merchant: "Greenmarket" });

    expect(shown.text).toContain("Shown with its logo");
    expect((await merchants(state, { action: "list" })).text).toContain(
      "- Greenmarket: 2 cleaned labels, a logo",
    );

    const cleared = await merchants(state, {
      action: "edit",
      merchant: "Greenmarket",
      clear_logo: true,
    });

    expect(cleared.text).toContain("Greenmarket has no logo any more");
    expect(state.merchants.find((each) => each.name === "Greenmarket")?.logo).toBeUndefined();
  });

  test.each([
    ["not base64", "%%%", "not valid base64"],
    [
      "an SVG",
      base64(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>")),
      "neither PNG, JPEG nor WebP",
    ],
    ["over 256 KiB", base64(largePng()), "over 256 KiB"],
  ])("refuses a logo %s, with a valid call", async (_, logo, says) => {
    const state = store();

    const { text, isError } = await merchants(state, {
      action: "edit",
      merchant: "Greenmarket",
      logo,
    });

    expect(isError).toBe(true);
    expect(text).toContain(says);
    expect(text.length).toBeLessThan(ERROR_LIMIT);
    expect(state.merchants.some((each) => each.logo !== undefined)).toBe(false);

    // Another picture, never clear_logo: that would delete the logo the merchant has.
    const example = writtenCall(text, "A valid call: ");

    expect(example).toEqual({
      action: "edit",
      merchant: "Greenmarket",
      logo: "<base64 of a PNG, JPEG or WebP, 256 KiB at most>",
    });

    const retried = await merchants(state, { ...example, logo: base64(PNG) });

    expect(retried.isError, retried.text).toBe(false);
  });

  test("each goes alone", async () => {
    const both = await merchants(store(), {
      action: "edit",
      merchant: "Greenmarket",
      color: "teal",
      clear_logo: true,
    });

    expect(both.isError).toBe(true);
    expect(both.text).toContain("edit does one thing at a time");
  });
});

describe("the merchants tool", () => {
  test("refuses its writes to a token allowed to read only, and says how to get the write scope", async () => {
    const state = store();

    const writes: ReadonlyArray<Arguments> = [
      { action: "edit", merchant: "Greenmarket", name: "Green Market" },
      { action: "merge", merchant: "Green Grocer", into: "Greenmarket" },
      { action: "edit", merchant: "Greenmarket", subscription: false },
      { action: "create", name: "Riverside Bakery" },
      { action: "edit", merchant: "Greenmarket", color: "teal" },
      { action: "edit", merchant: "Greenmarket", logo: base64(PNG) },
      { action: "edit", merchant: "Greenmarket", clear_logo: true },
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

    expect(state.merchants.some((each) => each.subscriptionDismissed === true)).toBe(false);
    expect(
      state.merchants.some((each) => each.color !== undefined || each.logo !== undefined),
    ).toBe(false);

    const read = await merchants(state, { action: "show", merchant: "Greenmarket" }, reader);

    expect(read.isError).toBe(false);
  });

  test("writes, says so, and comes after lines in the fixed order", async () => {
    const client = await connectInProcess(
      goussetServer,
      { run: runnerOf(store()) },
      reader,
      "2026-07-28",
    );

    const { tools } = await client.listTools();
    const tool = tools.find((each) => each.name === "merchants");

    expect(tools.map((each) => each.name)).toEqual([
      "month",
      "imports",
      "accounts",
      "data",
      "lines",
      "merchants",
      "categories",
      "rules",
      "review",
    ]);
    expect(tool?.title).toBe("Merchants");
    expect(tool?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
  });
});
