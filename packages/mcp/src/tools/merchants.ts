import {
  MERCHANT_LINES_SCANNED,
  MERCHANT_LINES_SHOWN,
  MAX_MERCHANT_NAME,
  Merchants,
  listMerchants,
  setMerchantDefaultCategory,
  showMerchant,
} from "@gousset/core";
import type {
  AliasMoved,
  CategoryStore,
  LineCategory,
  MerchantDetail,
  MerchantLine,
  MerchantPage,
  MerchantSummary,
  Merged,
} from "@gousset/core";
import { Effect, Schema } from "effect";

import { ToolRefusal, defineTool } from "../tool";
import { amount, named } from "./accounts";
import { namedCategory, pathText } from "./categories";

/** The merchants `list` and `search` give when none are asked for, and the most. */
const DEFAULT_MERCHANTS = 50;
const MAX_MERCHANTS = 100;

const MerchantsInput = Schema.Struct({
  action: Schema.Literals(["list", "search", "show", "edit", "merge"]).annotate({
    description:
      "list: every merchant by name. search: those whose name or a cleaned label contains text. show: one merchant, its default category, cleaned labels and latest lines. edit: rename one, move one of its cleaned labels to another merchant, or set its default category. merge: fold one merchant into another.",
  }),
  text: Schema.optional(
    Schema.String.annotate({
      description: "search: a piece of a merchant's name or of a cleaned label, any case.",
    }),
  ),
  limit: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MAX_MERCHANTS })).annotate({
      description: `list, search: how many merchants, 1 to ${MAX_MERCHANTS}; ${DEFAULT_MERCHANTS} if left out.`,
    }),
  ),
  after: Schema.optional(
    Schema.String.annotate({
      description:
        "list, search: an opaque handle to read on, exactly as the result's next call gives it. Never made up.",
    }),
  ),
  merchant: Schema.optional(
    Schema.String.annotate({
      description:
        "show, edit, merge: the merchant's name, as list writes it (any case). merge: the one merged away and deleted.",
    }),
  ),
  name: Schema.optional(Schema.String.annotate({ description: "edit: the merchant's new name." })),
  alias: Schema.optional(
    Schema.String.annotate({
      description: "edit: one of the merchant's cleaned labels, as show lists it, to move with to.",
    }),
  ),
  to: Schema.optional(
    Schema.String.annotate({
      description:
        "edit, with alias: the name of the merchant the cleaned label moves to, made when none has it.",
    }),
  ),
  into: Schema.optional(
    Schema.String.annotate({ description: "merge: the name of the merchant kept." }),
  ),
  category: Schema.optional(
    Schema.String.annotate({
      description:
        'edit: the merchant\'s default category, by its name or "Parent > Child" as categories list writes it (any case); "none" clears it.',
    }),
  ),
  kind: Schema.optional(
    Schema.Literals(["expense", "income"]).annotate({
      description:
        'edit, with category: expense or income, when an expense and an income category share the name ("Other").',
    }),
  ),
});

type MerchantsInput = typeof MerchantsInput.Type;

type Encoded = typeof MerchantsInput.Encoded;

const SCANNED = MERCHANT_LINES_SCANNED.toLocaleString("en-US");

const DESCRIPTION = `Merchants: who was paid, recognised from the bank's labels. A label is cleaned ("CB GREENMARKET 2110 RIVERTON" becomes the cleaned label "GREENMARKET") and each cleaned label names one merchant; each import recognises its new lines' merchants. \`list\` gives them by name; \`search\` finds them by a piece of a name or of a cleaned label (\`text\`, any case); \`show\` gives one with its cleaned labels and latest lines.

Use it for "who is this shop?" or to tidy merchants up. Use \`lines\` instead for lines by label, amount or period, \`accounts\` for balances, \`month\` for where the money went.

Writes (need a connection allowed to read and write):
- \`edit\` with \`name\`: renames; refused when another merchant has the name (merge instead).
- \`edit\` with \`alias\` and \`to\`: moves one of the merchant's cleaned labels, and its lines, to the merchant named \`to\`, made when none has it: how a merchant is split.
- \`edit\` with \`category\`: sets the merchant's default category, the one its entries go in by default, expense or income, named as \`categories\` lists it ("Parent > Child" for a child; add \`kind\` when an expense and an income category share the name); "none" clears it. An archived or unknown category is refused. Merging categories moves it; archiving keeps it, shown archived.
- \`merge\`: moves every cleaned label of \`merchant\` to \`into\`, then deletes \`merchant\`; \`into\` keeps its default category, or takes \`merchant\`'s when it has none.

Names are any case. An unknown name is refused with close names; a blank name or one over ${MAX_MERCHANT_NAME} characters, a merge into itself, or a cleaned label the merchant lacks is refused with a valid call. \`limit\` is 1 to ${MAX_MERCHANTS}, ${DEFAULT_MERCHANTS} by default; when more remain, the result writes the next call with \`after\`: copy it.

Examples: {"action":"search","text":"greenmarket"} · {"action":"edit","merchant":"Greenmarket","name":"Green Market"} · {"action":"edit","merchant":"Greenmarket","alias":"GREENMARKET FUEL","to":"Greenmarket Fuel"} · {"action":"edit","merchant":"Greenmarket","category":"Groceries > Supermarket"} · {"action":"merge","merchant":"Green Mkt","into":"Greenmarket"}`;

const call = (input: Encoded) => `merchants ${JSON.stringify(input)}`;

const refuse = (message: string, example: Encoded) =>
  Effect.fail(new ToolRefusal({ message, example: call(example) }));

/** A name as the caller gave it, cut so that one long argument never fills an error. */
function clip(text: string): string {
  return text.length > MAX_MERCHANT_NAME ? `${text.slice(0, MAX_MERCHANT_NAME - 1)}…` : text;
}

const blank = (text: string | undefined) => text === undefined || text.trim() === "";

const labels = (count: number) => (count === 1 ? "1 cleaned label" : `${count} cleaned labels`);

/** The list's own arguments, as the caller gave them: the next call repeats them. */
function pageArguments(input: MerchantsInput): Encoded {
  return input.action === "search"
    ? { action: "search", text: input.text, limit: input.limit }
    : { action: "list", limit: input.limit };
}

/** A page of merchants: how many match, the merchants by name, and the call that reads on. */
function pageText(page: MerchantPage, input: MerchantsInput): string {
  const text = input.text?.trim() ?? "";

  const header =
    input.action === "search"
      ? `${page.total} merchant(s) whose name or a cleaned label contains "${text}".`
      : `${page.total} merchant(s) in all.`;

  if (page.merchants.length === 0) {
    return page.total === 0 && input.action === "list"
      ? "The user has no merchant yet: merchants are recognised from the lines each import adds."
      : `${header}\n\nNo merchant on this page.`;
  }

  const rows = [
    `These ${page.merchants.length}, by name (name: how many cleaned labels; show gives them):`,
    ...page.merchants.map((merchant) => `- ${merchant.name}: ${labels(merchant.aliases)}`),
  ];

  const next =
    page.next === null
      ? []
      : [
          `More merchants remain. Read them with: ${call({ ...pageArguments(input), after: page.next })}`,
        ];

  return [header, [...rows, ...next].join("\n")].join("\n\n");
}

const quoted = (label: string) => (label === "" ? "(no label)" : `"${label}"`);

function lineText(line: MerchantLine): string {
  return `- ${line.bookedOn}, ${named(line.account)}: ${amount(line.amount)}, ${quoted(line.label)}`;
}

/** A category with its kind: "Groceries > Bakery (expense)". */
const categoryText = (category: LineCategory) => `${pathText(category)} (${category.kind})`;

/** The merchant's default category, archived or not, or how to set one. */
function defaultText(detail: MerchantDetail): string {
  const chosen = detail.defaultCategory;

  if (chosen === null) {
    return "No default category: edit with category sets one.";
  }

  return chosen.archived
    ? `Default category: ${categoryText(chosen)}, archived: it can no longer be chosen; edit with category sets another.`
    : `Default category: ${categoryText(chosen)}.`;
}

/** One merchant: its name, its default category, the cleaned labels that name it, its lines. */
function showText(detail: MerchantDetail): string {
  const [first] = detail.aliases;

  const aliases =
    detail.aliases.length === 0
      ? ["No cleaned label names it any more: no line is its own. Merge it into another merchant."]
      : [
          `Its ${labels(detail.aliases.length)} (bank labels once cleaned; edit with alias moves one to another merchant):`,
          ...detail.aliases.map((alias) => `- ${alias}`),
        ];

  const lines =
    detail.lines.length === 0
      ? [`No line of its own among the ${SCANNED} newest lines of the user's accounts.`]
      : [
          `Its latest ${detail.lines.length} line(s), newest first, found among the ${SCANNED} newest lines of the user's accounts, ${MERCHANT_LINES_SHOWN} at most (booked on, account: amount, label):`,
          ...detail.lines.map(lineText),
        ];

  const more =
    first === undefined
      ? []
      : [
          `For every line of a cleaned label, search the lines: lines ${JSON.stringify({ action: "search", text: first })}`,
        ];

  return [
    `Merchant: ${detail.name}.\n${defaultText(detail)}`,
    aliases.join("\n"),
    [...lines, ...more].join("\n"),
  ].join("\n\n");
}

function renamedText(from: string, renamed: MerchantSummary): string {
  return `Renamed the merchant "${from}" to "${renamed.name}". Its ${labels(renamed.aliases)} and their lines stay its own.`;
}

function movedText(moved: AliasMoved): string {
  if (moved.from.id === moved.to.id) {
    return `The cleaned label "${moved.alias}" is already ${moved.to.name}'s: nothing moved.`;
  }

  const made = moved.created ? ", a merchant made for it" : "";

  const left =
    moved.from.aliases === 0
      ? ` ${moved.from.name} has no cleaned label left: merge it into another merchant, or move one back.`
      : ` ${moved.from.name} keeps ${labels(moved.from.aliases)}.`;

  return `Moved the cleaned label "${moved.alias}", and its lines, from ${moved.from.name} to ${moved.to.name}${made}, which has ${labels(moved.to.aliases)}.${left}`;
}

function mergedText(merged: Merged): string {
  return `Merged ${merged.merged} into ${merged.into.name}: ${labels(merged.aliasesMoved)} moved, and ${merged.merged} deleted. ${merged.into.name} now has ${labels(merged.into.aliases)}.`;
}

/**
 * The merchant of that name, or the refusal to give: close names to choose from, read through a
 * call that only reads.
 */
function merchantNamed(owner: string, name: string) {
  return Effect.gen(function* () {
    const merchants = yield* Merchants;

    return yield* merchants.named(owner, name);
  }).pipe(
    Effect.catchTags({
      MerchantNameUnknown: (unknown) => {
        const [first] = unknown.close;

        return first === undefined
          ? refuse(
              `No merchant of the user's is named "${clip(unknown.name)}", nor has a name containing it. Find the name with search (a piece of the name or of the bank's label) or list, then call again with the name as it is written.`,
              { action: "list" },
            )
          : refuse(
              `No merchant of the user's is named "${clip(unknown.name)}". Close names: ${unknown.close.join(", ")}. Call again with one of them, as it is written.`,
              { action: "show", merchant: first },
            );
      },
      QueryFailed: Effect.die,
    }),
  );
}

/** A refused name, for a rename (`name`) or a move (`to`), with a call that differs only there. */
function nameRefusal(reason: "blank" | "too_long", field: string, example: Encoded) {
  return refuse(
    reason === "blank"
      ? `${field} cannot be blank: give the merchant's name.`
      : `${field} is at most ${MAX_MERCHANT_NAME} characters: give a shorter name.`,
    example,
  );
}

function show(owner: string, merchant: string | undefined) {
  if (merchant === undefined || blank(merchant)) {
    return refuse("show needs merchant: the merchant's name, as list or search writes it.", {
      action: "list",
    });
  }

  return Effect.gen(function* () {
    const found = yield* merchantNamed(owner, merchant);

    return showText(yield* showMerchant(owner, found.id));
  }).pipe(
    Effect.catchTags({
      MerchantNotFound: () =>
        refuse(`The merchant "${clip(merchant)}" is gone: it was just merged or split away.`, {
          action: "list",
        }),
      QueryFailed: Effect.die,
    }),
  );
}

function rename(owner: string, merchant: string, name: string) {
  return Effect.gen(function* () {
    const found = yield* merchantNamed(owner, merchant);
    const merchants = yield* Merchants;
    const renamed = yield* merchants.rename(owner, found.id, name);

    return renamedText(found.name, renamed);
  }).pipe(
    Effect.catchTags({
      MerchantNameRefused: (refused) =>
        nameRefusal(refused.reason, "name", {
          action: "edit",
          merchant,
          name: "Riverside Bakery",
        }),
      MerchantNameTaken: (taken) =>
        refuse(
          `Another merchant is named "${taken.name}" already. To make them one, merge this one into it; or choose another name.`,
          { action: "merge", merchant, into: taken.name },
        ),
      MerchantNotFound: () =>
        refuse(`The merchant "${clip(merchant)}" is gone: it was just merged or split away.`, {
          action: "list",
        }),
      QueryFailed: Effect.die,
    }),
  );
}

function moveAlias(owner: string, merchant: string, alias: string, to: string) {
  return Effect.gen(function* () {
    const found = yield* merchantNamed(owner, merchant);
    const merchants = yield* Merchants;

    return yield* merchants.moveAlias(owner, found.id, alias, to).pipe(
      Effect.map(movedText),
      Effect.catchTag("MerchantAliasNotFound", () =>
        Effect.gen(function* () {
          const detail = yield* showMerchant(owner, found.id);
          const [first] = detail.aliases;

          return yield* refuse(
            detail.aliases.length === 0
              ? `${detail.name} has no cleaned label to move.`
              : `"${clip(alias)}" is not one of ${detail.name}'s cleaned labels. Its cleaned labels: ${detail.aliases.slice(0, 20).join(", ")}${detail.aliases.length > 20 ? ", … (show lists them all)" : ""}.`,
            first === undefined
              ? { action: "show", merchant: detail.name }
              : { action: "edit", merchant: detail.name, alias: first, to },
          );
        }),
      ),
    );
  }).pipe(
    Effect.catchTags({
      MerchantNameRefused: (refused) =>
        nameRefusal(refused.reason, "to", {
          action: "edit",
          merchant,
          alias,
          to: "Greenmarket Fuel",
        }),
      MerchantNotFound: () =>
        refuse(`The merchant "${clip(merchant)}" is gone: it was just merged or split away.`, {
          action: "list",
        }),
      QueryFailed: Effect.die,
    }),
  );
}

/** "none", in any case: the default category cleared. */
const NONE = "none";

function setDefault(
  owner: string,
  merchant: string,
  category: string,
  kind: "expense" | "income" | undefined,
) {
  return Effect.gen(function* () {
    const found = yield* merchantNamed(owner, merchant);

    if (category.trim().toLowerCase() === NONE) {
      yield* setMerchantDefaultCategory(owner, found.id, null);

      return `${found.name} has no default category any more.`;
    }

    const chosen = yield* namedCategory(owner, category, kind, (name, of) =>
      call({ action: "edit", merchant, category: name, kind: of }),
    );

    const set = yield* setMerchantDefaultCategory(owner, found.id, chosen.id);

    return set === null
      ? `${found.name} has no default category any more.`
      : `${found.name}'s default category is now ${categoryText(set)}: the category its entries go in by default.`;
  }).pipe(
    Effect.catchTags({
      // The one refusal a category in use never meets: it is archived.
      CategoryRefused: () =>
        Effect.fail(
          new ToolRefusal({
            message: `"${clip(category.trim())}" is archived: it can no longer be chosen. Choose a category in use, or restore it first.`,
            example: `categories ${JSON.stringify({ action: "archive", category: category.trim(), restore: true })}`,
          }),
        ),
      CategoryNotFound: () =>
        refuse(`The category "${clip(category)}" is gone: it was just merged away.`, {
          action: "edit",
          merchant,
          category: NONE,
        }),
      MerchantNotFound: () =>
        refuse(`The merchant "${clip(merchant)}" is gone: it was just merged or split away.`, {
          action: "list",
        }),
      QueryFailed: Effect.die,
    }),
  );
}

function edit(owner: string, input: MerchantsInput) {
  const { merchant, name, alias, to, category } = input;

  if (merchant === undefined || blank(merchant)) {
    return refuse(
      "edit needs merchant: the name of the merchant to change, as list or search writes it.",
      { action: "list" },
    );
  }

  const asked = [name, alias ?? to, category].filter((each) => each !== undefined).length;

  if (asked > 1) {
    return refuse(
      "edit does one thing at a time: either name (a rename), alias and to (a move), or category (its default category). Make one call for each.",
      { action: "edit", merchant, name: name ?? merchant },
    );
  }

  if (category !== undefined) {
    return blank(category)
      ? refuse(
          'category cannot be blank: name a category as categories list writes it, or "none" to clear it.',
          { action: "edit", merchant, category: NONE },
        )
      : setDefault(owner, merchant, category, input.kind);
  }

  if (name !== undefined) {
    return rename(owner, merchant, name);
  }

  if (alias !== undefined && to !== undefined) {
    return moveAlias(owner, merchant, alias, to);
  }

  if (to !== undefined) {
    return refuse(
      "to needs alias: the cleaned label, among those show lists for the merchant, that moves to it.",
      { action: "show", merchant },
    );
  }

  if (alias !== undefined) {
    return refuse(
      "alias needs to: the name of the merchant it moves to, made when none has that name.",
      { action: "edit", merchant, alias, to: "Greenmarket Fuel" },
    );
  }

  return refuse(
    "edit needs either name, to rename the merchant, alias and to, to move one of its cleaned labels (show lists them) to another merchant, or category, to set its default category.",
    { action: "show", merchant },
  );
}

function merge(owner: string, input: MerchantsInput) {
  const { merchant, into } = input;

  if (merchant === undefined || blank(merchant) || into === undefined || blank(into)) {
    return refuse(
      "merge needs merchant, the one merged away and deleted, and into, the one kept, both by name as list writes them.",
      { action: "list" },
    );
  }

  return Effect.gen(function* () {
    const from = yield* merchantNamed(owner, merchant);
    const kept = yield* merchantNamed(owner, into);
    const merchants = yield* Merchants;

    return mergedText(yield* merchants.merge(owner, from.id, kept.id));
  }).pipe(
    Effect.catchTags({
      MerchantMergeRefused: () =>
        refuse(
          `merchant and into both name "${clip(merchant)}": a merchant is merged into another one, never into itself.`,
          { action: "search", text: merchant.trim().slice(0, 40) },
        ),
      MerchantNotFound: () =>
        refuse("One of the merchants is gone: it was just merged or split away.", {
          action: "list",
        }),
      QueryFailed: Effect.die,
    }),
  );
}

/** The merchants family (docs/mcp.md, "Tools"): reads, and the user's edits and merges. */
export const merchantsTool = defineTool<MerchantsInput, Encoded, Merchants | CategoryStore>({
  name: "merchants",
  title: "Merchants",
  description: DESCRIPTION,
  // A repeated rename, move, merge or default category finds the work done, and changes nothing
  // more.
  idempotent: true,
  input: MerchantsInput,
  example: { action: "search", text: "greenmarket" },
  access: { list: "read", search: "read", show: "read", edit: "write", merge: "write" },
  run: (input, caller) => {
    switch (input.action) {
      case "list":
      case "search": {
        if (input.action === "search" && blank(input.text)) {
          return refuse(
            "search needs text: a piece of a merchant's name or of a cleaned label, any case. Or list them all.",
            { action: "search", text: "greenmarket" },
          );
        }

        return listMerchants(caller.userId, {
          text: input.action === "search" ? input.text : undefined,
          after: input.after,
          limit: input.limit ?? DEFAULT_MERCHANTS,
        }).pipe(
          Effect.map((page) => pageText(page, input)),
          Effect.catchTags({ QueryFailed: Effect.die }),
        );
      }

      case "show": {
        return show(caller.userId, input.merchant);
      }

      case "edit": {
        return edit(caller.userId, input);
      }

      case "merge": {
        return merge(caller.userId, input);
      }
    }
  },
});
