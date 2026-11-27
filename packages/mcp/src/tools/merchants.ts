import {
  LOGO_MAX_BYTES,
  LOOK_COLORS,
  MERCHANT_LINES_SCANNED,
  MERCHANT_LINES_SHOWN,
  MAX_MERCHANT_NAME,
  Merchants,
  assignLineMerchant,
  listMerchants,
  markIntermediary,
  markSubscription,
  merchantKey,
  ruleWords,
  setMerchantDefaultCategory,
  showLine,
  showMerchant,
} from "@gousset/core";
import type {
  AliasMoved,
  CategoryStore,
  LineCategory,
  LineMerchantAssigned,
  LineMerchantRefused,
  LineStore,
  Look,
  LookColor,
  MerchantDetail,
  MerchantLine,
  MerchantPage,
  MerchantSummary,
  Merged,
} from "@gousset/core";
import { Effect, Exit, Schema } from "effect";

import { ToolRefusal, defineTool } from "../tool";
import { amount, named } from "./accounts";
import { namedCategory, pathText } from "./categories";
import { proposedRule } from "./rules";

/** The merchants `list` and `search` give when none are asked for, and the most. */
const DEFAULT_MERCHANTS = 50;
const MAX_MERCHANTS = 100;

const MerchantsInput = Schema.Struct({
  action: Schema.Literals(["list", "search", "show", "create", "edit", "merge", "assign"]).annotate(
    {
      description:
        "list: every merchant by name. search: those whose name or a cleaned label contains text. show: one merchant, its default category, cleaned labels and latest lines. create: make one by hand. edit: rename one, move one of its cleaned labels to another merchant, or set its default category, colour, labels or logo. merge: fold one merchant into another. assign: who was paid on an intermediary's line.",
    },
  ),
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
        "show, edit, merge, assign: the merchant's name, as list writes it (any case); assign makes it when none has it. merge: the one merged away and deleted.",
    }),
  ),
  name: Schema.optional(
    Schema.String.annotate({ description: "create: the new merchant's name. edit: its new name." }),
  ),
  labels: Schema.optional(
    Schema.Array(Schema.String).annotate({
      description:
        "create, edit: bank labels that name it, cleaned as imports clean them; edit adds them.",
    }),
  ),
  color: Schema.optional(
    Schema.Literals([...LOOK_COLORS, "automatic"]).annotate({
      description: "create, edit: its avatar's colour; automatic: chosen from its name.",
    }),
  ),
  logo: Schema.optional(
    Schema.String.annotate({
      description: "edit: its logo in base64, PNG, JPEG or WebP, 256 KiB at most.",
    }),
  ),
  clear_logo: Schema.optional(
    Schema.Boolean.annotate({ description: "edit: true removes its logo." }),
  ),
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
        'create, edit: the merchant\'s default category, by its name or "Parent > Child" as categories list writes it (any case). Always a name: clear_category clears it.',
    }),
  ),
  clear_category: Schema.optional(
    Schema.Boolean.annotate({
      description: "edit: true clears the merchant's default category; alone, without category.",
    }),
  ),
  kind: Schema.optional(
    Schema.Literals(["expense", "income"]).annotate({
      description:
        'create, edit, with category: expense or income, when an expense and an income category share the name ("Other").',
    }),
  ),
  line: Schema.optional(
    Schema.String.annotate({
      description: "assign: the line's handle, exactly as lines gives it.",
    }),
  ),
  intermediary: Schema.optional(
    Schema.Boolean.annotate({
      description: "create, edit: true marks it a payment intermediary.",
    }),
  ),
  subscription: Schema.optional(
    Schema.Boolean.annotate({
      description:
        "edit: false, its payments are no subscription and none is proposed again; true proposes them again.",
    }),
  ),
});

type MerchantsInput = typeof MerchantsInput.Type;

type Encoded = typeof MerchantsInput.Encoded;

const SCANNED = MERCHANT_LINES_SCANNED.toLocaleString("en-US");

const LOGO_KIB = LOGO_MAX_BYTES / 1024;

/** A logo's most characters in base64: four for every three bytes. */
const LOGO_CHARACTERS = (Math.ceil(LOGO_MAX_BYTES / 3) * 4).toLocaleString("en-US");

const DESCRIPTION = `Merchants: who was paid, recognised from the bank's labels. A label is cleaned ("CB GREENMARKET 2110 RIVERTON" becomes the cleaned label "GREENMARKET") and each cleaned label names one merchant; each import recognises its new lines' merchants. \`list\` gives them by name; \`search\` finds them by a piece of a name or of a cleaned label (\`text\`, any case); \`show\` gives one with its cleaned labels and latest lines.

Use it for "who is this shop?" or to tidy merchants up. Use \`lines\` instead for lines by label, amount or period, \`accounts\` for balances, \`month\` for where the money went.

Writes (need a connection allowed to read and write):
- \`create\` with \`name\`, and optionally \`labels\`, \`category\`, \`intermediary\`, \`color\`: makes a merchant by hand; the next imported lines whose labels clean as one of \`labels\` are its. Refused: a name taken, a label that cleans to nothing, or one naming another merchant (move it with edit alias and to).
- \`edit\` with \`color\` (a key, or automatic), \`labels\` (adds them, refused as create), \`logo\` (base64 of a PNG, JPEG or WebP, ${LOGO_KIB} KiB at most, about ${LOGO_CHARACTERS} characters; it replaces the one it has; the user can also upload it in Gousset) or \`clear_logo: true\` (its initials again).
- \`edit\` with \`name\`: renames; refused when another merchant has the name (merge instead).
- \`edit\` with \`alias\` and \`to\`: moves one of the merchant's cleaned labels, and its lines, to the merchant named \`to\`, made when none has it: how a merchant is split.
- \`edit\` with \`category\`: sets the merchant's default category, the one its entries go in by default, expense or income, named as \`categories\` lists it ("Parent > Child" for a child; add \`kind\` when an expense and an income category share the name). \`clear_category: true\`, alone, clears it. Its entries not classified yet (classified by default) of that kind move to it, and still count as to review; cleared, they go back to the fallback; the user's own choices stay. An archived or unknown category is refused. Merging categories moves it; archiving keeps it, shown archived, and it then classifies nothing new.
- \`merge\`: moves every cleaned label of \`merchant\` to \`into\`, then deletes \`merchant\`; \`into\` keeps its default category, or takes \`merchant\`'s when it has none.
- \`edit\` with \`intermediary\` true/false: marks it a payment intermediary (PayPal…), whose labels hide who was paid, or not.
- \`edit\` with \`subscription\` false: its payments are no subscription, and \`month\` subscriptions never proposes them again; true proposes them again.
- \`assign\` with \`line\` (a \`lines\` handle) and \`merchant\`: sets who was paid on an intermediary's line, made when none has the name, as the user's choice, and proposes the \`rules\` call for the next ones. Refused: a label naming no intermediary, a line not one whole expense or income, an intermediary as \`merchant\`.

Names are any case. An unknown name is refused with close names; a blank name or one over ${MAX_MERCHANT_NAME} characters, a merge into itself, or a cleaned label the merchant lacks is refused with a valid call. \`limit\` is 1 to ${MAX_MERCHANTS}, ${DEFAULT_MERCHANTS} by default; when more remain, the result writes the next call with \`after\`: copy it.

Examples: {"action":"search","text":"greenmarket"} · {"action":"create","name":"Riverside Bakery","labels":["CB RIVERSIDE BAKERY"],"color":"amber"} · {"action":"edit","merchant":"Greenmarket","name":"Green Market"} · {"action":"edit","merchant":"Greenmarket","alias":"GREENMARKET FUEL","to":"Greenmarket Fuel"} · {"action":"edit","merchant":"Greenmarket","category":"Groceries > Supermarket"} · {"action":"edit","merchant":"Greenmarket","clear_category":true} · {"action":"merge","merchant":"Green Mkt","into":"Greenmarket"} · {"action":"edit","merchant":"Streamly","subscription":false}`;

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

/** A payment intermediary (#30) is said so wherever a merchant is named in a list. */
const marked = (merchant: { readonly intermediary: boolean }) =>
  merchant.intermediary ? " (payment intermediary)" : "";

/** What a list says of a look (#204): only what the user chose. */
function lookNote(look: Look): string {
  const color = look.color === null ? "" : `, colour ${look.color}`;

  return look.logo === null ? color : `${color}, a logo`;
}

/** How a merchant is shown (#204), as show says it. */
function lookText(look: Look): string {
  const color =
    look.color === null ? "an automatic colour (edit with color picks one)" : look.color;

  return look.logo === null
    ? `Shown as its initials on ${color}; no logo (edit with logo sets one).`
    : `Shown with its logo (edit with clear_logo removes it); its initials' colour: ${color}.`;
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
    ...page.merchants.map(
      (merchant) =>
        `- ${merchant.name}${marked(merchant)}: ${labels(merchant.aliases)}${lookNote(merchant.look)}`,
    ),
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

  const intermediary = detail.intermediary
    ? ", a payment intermediary: its lines' labels hide who was paid, which assign sets on each line"
    : "";

  const dismissed = detail.subscriptionDismissed
    ? "\nThe user said its payments are no subscription: month subscriptions never proposes them; edit with subscription true proposes them again."
    : "";

  return [
    `Merchant: ${detail.name}${intermediary}.\n${defaultText(detail)}${dismissed}\n${lookText(detail.look)}`,
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
export function merchantNamed(owner: string, name: string) {
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

/** A refusal whose valid call reads the user's categories: it changes nothing. */
const refuseWithCategories = (message: string) =>
  Effect.fail(
    new ToolRefusal({ message, example: `categories ${JSON.stringify({ action: "list" })}` }),
  );

function clearDefault(owner: string, merchant: string) {
  return Effect.gen(function* () {
    const found = yield* merchantNamed(owner, merchant);

    yield* setMerchantDefaultCategory(owner, found.id, null);

    return `${found.name} has no default category any more.`;
  }).pipe(
    Effect.catchTags({
      // A category's refusals: clearing names none, so neither is ever met.
      CategoryNotFound: Effect.die,
      CategoryRefused: Effect.die,
      MerchantNotFound: () =>
        refuse(`The merchant "${clip(merchant)}" is gone: it was just merged or split away.`, {
          action: "list",
        }),
      QueryFailed: Effect.die,
    }),
  );
}

function setDefault(
  owner: string,
  merchant: string,
  category: string,
  kind: "expense" | "income" | undefined,
) {
  return Effect.gen(function* () {
    const found = yield* merchantNamed(owner, merchant);

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
        refuseWithCategories(
          `The category "${clip(category)}" is gone: it was just merged away or deleted. Find the name it goes by now with the call below, then call edit again with it.`,
        ),
      MerchantNotFound: () =>
        refuse(`The merchant "${clip(merchant)}" is gone: it was just merged or split away.`, {
          action: "list",
        }),
      QueryFailed: Effect.die,
    }),
  );
}

/** Marks a merchant a payment intermediary, or not (#30). */
function mark(owner: string, merchant: string, intermediary: boolean) {
  return Effect.gen(function* () {
    const found = yield* merchantNamed(owner, merchant);
    const changed = yield* markIntermediary(owner, found.id, intermediary);

    return changed.intermediary
      ? `${changed.name} is now a payment intermediary: its lines' labels hide who was paid. lines show says so on each line, and merchants assign sets who was paid.`
      : `${changed.name} is no longer a payment intermediary: its lines are its own.`;
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

/** Says a merchant's payments are no subscription, or takes it back (#34). */
function dismiss(owner: string, merchant: string, subscription: boolean) {
  return Effect.gen(function* () {
    const found = yield* merchantNamed(owner, merchant);
    const changed = yield* markSubscription(owner, found.id, !subscription);

    return subscription
      ? `${changed.name}'s payments may be proposed as a subscription again: month subscriptions detects them when they recur.`
      : `${changed.name}'s payments are no subscription: month subscriptions never proposes them again. edit with subscription true takes it back.`;
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

/** The colour asked for: a key of the palette, or null for the automatic one. */
const colorOf = (color: LookColor | "automatic"): LookColor | null =>
  color === "automatic" ? null : color;

const gone = (merchant: string) =>
  refuse(`The merchant "${clip(merchant)}" is gone: it was just merged or split away.`, {
    action: "list",
  });

type TakenLabel = { readonly alias: string; readonly name: string };

/** A label refused (#204): it cleans to nothing, or names another merchant already. */
const labelRefusals = (retry: Encoded) => ({
  MerchantLabelRefused: (refused: { readonly label: string }) =>
    refuse(
      `The label "${clip(refused.label)}" names no one once cleaned (only a date, a reference or a withdrawal): give the words of the bank's label that name the shop.`,
      { ...retry, labels: ["CB RIVERSIDE BAKERY"] },
    ),
  MerchantLabelTaken: (taken: TakenLabel) =>
    refuse(
      `The label "${clip(taken.alias)}" names ${taken.name} already: a cleaned label names one merchant. Move it with the call below, or merge the two merchants.`,
      {
        action: "edit",
        merchant: taken.name,
        alias: taken.alias,
        to: retry.name ?? retry.merchant,
      },
    ),
});

/**
 * A label refused to `create` because another merchant has it (#204). Moving it first would make a
 * bare merchant, and the create retried after would find the name taken: so the merchant is made
 * first, as asked but for the labels cleaned as that one, and the label moved to it after.
 */
function takenOnCreate(input: MerchantsInput, name: string, taken: TakenLabel) {
  const rest = (input.labels ?? []).filter((label) => merchantKey(label, null) !== taken.alias);

  const move: Encoded = { action: "edit", merchant: taken.name, alias: taken.alias, to: name };

  return refuse(
    `The label "${clip(taken.alias)}" names ${taken.name} already: a cleaned label names one merchant. Make the merchant without it with the call below, then move the label to it: ${call(move)}\nOr merge the two merchants once it is made.`,
    {
      action: "create",
      name,
      labels: rest.length === 0 ? undefined : rest,
      category: input.category,
      kind: input.kind,
      intermediary: input.intermediary,
      color: input.color,
    },
  );
}

function createdText(made: MerchantSummary, input: MerchantsInput): string {
  const named =
    made.aliases === 0
      ? " No cleaned label names it yet: edit with labels adds some, or move one to it."
      : ` Its ${labels(made.aliases)} name the lines whose bank labels clean the same way, the next imported ones among them.`;

  const category =
    input.category === undefined ? "" : " Its entries go in its default category by default.";

  return `Made the merchant ${made.name}${marked(made)}.${named}${category}`;
}

function create(owner: string, input: MerchantsInput) {
  const { name, category } = input;
  const example: Encoded = { action: "create", name: "Riverside Bakery" };

  if (name === undefined || blank(name)) {
    return refuse("create needs name: the new merchant's name.", example);
  }

  if (category !== undefined && blank(category)) {
    return refuseWithCategories(
      "category cannot be blank: name a category as categories list writes it, or leave category out.",
    );
  }

  const retry: Encoded = { action: "create", name };

  return Effect.gen(function* () {
    const chosen =
      category === undefined
        ? null
        : yield* namedCategory(owner, category, input.kind, (path, of) =>
            call({ ...retry, category: path, kind: of }),
          );

    const merchants = yield* Merchants;

    const made = yield* merchants.create(owner, {
      name,
      defaultCategoryId: chosen?.id ?? null,
      intermediary: input.intermediary ?? false,
      color: input.color === undefined ? null : colorOf(input.color),
      aliases: input.labels ?? [],
    });

    return createdText(made, input);
  }).pipe(
    Effect.catchTags({
      MerchantNameRefused: (refused) => nameRefusal(refused.reason, "name", example),
      MerchantNameTaken: (taken) =>
        refuse(
          `A merchant is named "${taken.name}" already: change it with edit (its labels, its colour), or choose another name.`,
          { action: "show", merchant: taken.name },
        ),
      ...labelRefusals(retry),
      MerchantLabelTaken: (taken) => takenOnCreate(input, name, taken),
      CategoryRefused: () =>
        refuseWithCategories(
          `"${clip(category?.trim() ?? "")}" is archived: it can no longer be chosen. Choose a category in use.`,
        ),
      CategoryNotFound: () =>
        refuseWithCategories(
          `The category "${clip(category ?? "")}" is gone: find the name it goes by now, then call create again.`,
        ),
      QueryFailed: Effect.die,
    }),
  );
}

/** Sets a merchant's colour, or adds labels to it (#204). */
function editLook(
  owner: string,
  merchant: string,
  change: { readonly color?: LookColor | "automatic"; readonly labels?: ReadonlyArray<string> },
) {
  return Effect.gen(function* () {
    const found = yield* merchantNamed(owner, merchant);
    const merchants = yield* Merchants;

    const edited = yield* merchants.edit(owner, found.id, {
      color: change.color === undefined ? undefined : colorOf(change.color),
      addAliases: change.labels,
    });

    return change.color === undefined
      ? `${edited.name} now has ${labels(edited.aliases)}: the lines whose bank labels clean the same way are its, the next imported ones among them.`
      : `${edited.name}'s avatar is now drawn on ${edited.look.color ?? "an automatic colour, chosen from its name"}.`;
  }).pipe(
    Effect.catchTags({
      ...labelRefusals({ action: "edit", merchant }),
      // Neither a name nor a category is changed here.
      MerchantNameRefused: Effect.die,
      MerchantNameTaken: Effect.die,
      CategoryNotFound: Effect.die,
      CategoryRefused: Effect.die,
      MerchantNotFound: () => gone(merchant),
      QueryFailed: Effect.die,
    }),
  );
}

const decodeBase64 = Schema.decodeUnknownExit(Schema.Uint8ArrayFromBase64);

/** What a refused logo is retried with: another picture, never clear_logo, which deletes its own. */
const LOGO_RETRY = `<base64 of a PNG, JPEG or WebP, ${LOGO_KIB} KiB at most>`;

const LOGO_REFUSALS = {
  empty: "logo holds no byte: give the picture's bytes in base64.",
  too_large: `logo is over ${LOGO_KIB} KiB: give a smaller picture (the user can shrink it).`,
  type: "logo is neither PNG, JPEG nor WebP, by its bytes (SVG and others are refused): give one of the three, in base64.",
} as const;

/** Sets a merchant's logo from its base64, or removes it (#204). */
function setLogo(owner: string, merchant: string, logo: string | null) {
  const example: Encoded = { action: "edit", merchant, logo: LOGO_RETRY };
  const decoded = logo === null ? undefined : decodeBase64(logo.replaceAll(/\s/g, ""));

  if (decoded !== undefined && Exit.isFailure(decoded)) {
    return refuse("logo is not valid base64: give the picture's bytes in base64.", example);
  }

  return Effect.gen(function* () {
    const found = yield* merchantNamed(owner, merchant);
    const merchants = yield* Merchants;

    if (decoded === undefined) {
      yield* merchants.removeLogo(owner, found.id);

      return `${found.name} has no logo any more: its initials are shown.`;
    }

    yield* merchants.setLogo(owner, found.id, decoded.value);

    return `${found.name}'s logo is set: Gousset shows it wherever ${found.name} is named.`;
  }).pipe(
    Effect.catchTags({
      MerchantLogoRefused: (refused) => refuse(LOGO_REFUSALS[refused.reason], example),
      MerchantNotFound: () => gone(merchant),
      QueryFailed: Effect.die,
    }),
  );
}

function edit(owner: string, input: MerchantsInput) {
  const { merchant, name, alias, to, category, intermediary, subscription } = input;
  const clearing = input.clear_category === true;

  if (merchant === undefined || blank(merchant)) {
    return refuse(
      "edit needs merchant: the name of the merchant to change, as list or search writes it.",
      { action: "list" },
    );
  }

  const asked =
    [
      name,
      alias ?? to,
      category,
      intermediary,
      subscription,
      input.color,
      input.labels,
      input.logo,
      input.clear_logo,
    ].filter((each) => each !== undefined).length + (clearing ? 1 : 0);

  if (asked > 1) {
    return refuse(
      "edit does one thing at a time: either name (a rename), alias and to (a move), category (its default category), clear_category, intermediary, subscription, color, labels, logo or clear_logo. Make one call for each.",
      { action: "edit", merchant, name: name ?? merchant },
    );
  }

  if (clearing) {
    return clearDefault(owner, merchant);
  }

  if (input.color !== undefined || input.labels !== undefined) {
    return editLook(owner, merchant, { color: input.color, labels: input.labels });
  }

  if (input.logo !== undefined) {
    return setLogo(owner, merchant, input.logo);
  }

  if (input.clear_logo !== undefined) {
    return input.clear_logo
      ? setLogo(owner, merchant, null)
      : refuse("clear_logo is true or left out: true removes the merchant's logo.", {
          action: "edit",
          merchant,
          clear_logo: true,
        });
  }

  if (intermediary !== undefined) {
    return mark(owner, merchant, intermediary);
  }

  if (subscription !== undefined) {
    return dismiss(owner, merchant, subscription);
  }

  if (category !== undefined) {
    return blank(category)
      ? refuseWithCategories(
          "category cannot be blank: name a category as categories list writes it. To clear the default category, give clear_category: true instead.",
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
    "edit needs either name, to rename the merchant, alias and to, to move one of its cleaned labels (show lists them) to another merchant, category, to set its default category, clear_category: true, to clear it, color, labels, logo or clear_logo: true.",
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

/** Who was paid, set on an intermediary's line, and the rule that would do it next time (#30). */
function assignedText(
  line: {
    readonly bookedOn: string;
    readonly label: string;
    readonly amount: MerchantLine["amount"];
  },
  assigned: LineMerchantAssigned,
  proposal: string | undefined,
): string {
  const made = assigned.created ? ", a merchant made for it" : "";

  const moved =
    assigned.category === null
      ? ""
      : ` It went in ${categoryText(assigned.category)}, ${assigned.merchant.name}'s default category.`;

  const done = `Who was paid on the line of ${line.bookedOn}, ${amount(line.amount)}, ${quoted(line.label)}, is now ${assigned.merchant.name}${made}. Kept as the user's choice: no rule changes it unasked.${moved}`;

  return proposal === undefined ? done : `${done}\n${proposal}`;
}

/** A refusal whose valid call reads the line: it changes nothing. */
const refuseWithLine = (message: string, line: string) =>
  Effect.fail(
    new ToolRefusal({
      message,
      example: `lines ${JSON.stringify({ action: "show", line: line.slice(0, 80) })}`,
    }),
  );

const ASSIGN_REFUSALS = {
  not_intermediary:
    "This line's label names no payment intermediary: its merchant is the one its cleaned label names. To change it, move that cleaned label to another merchant (edit with alias and to), or mark its merchant an intermediary first (edit with intermediary: true).",
  not_one_entry:
    "Who was paid is set on a line that is one expense or income of its own: this one is held for review, discarded, a side of a transfer, split, or of no amount.",
  intermediary_chosen:
    "That merchant is a payment intermediary itself: name who was paid through it, as the label says after the intermediary's name (the shop, the person).",
} as const satisfies { readonly [Reason in LineMerchantRefused["reason"]]: string };

function assign(owner: string, input: MerchantsInput) {
  const line = input.line?.trim() ?? "";
  const { merchant } = input;

  if (line === "" || merchant === undefined || blank(merchant)) {
    return Effect.fail(
      new ToolRefusal({
        message:
          "assign needs line, the line's handle as lines search gives it, and merchant, the name of who was paid (made when no merchant has it).",
        example: `lines ${JSON.stringify({ action: "search", text: "paypal" })}`,
      }),
    );
  }

  return Effect.gen(function* () {
    const detail = yield* showLine(owner, line);
    const assigned = yield* assignLineMerchant(owner, detail.id, merchant);

    const proposal = proposedRule(ruleWords(detail.label, detail.counterpartyName, true), {
      merchant: assigned.merchant.name,
    });

    return assignedText(detail, assigned, proposal);
  }).pipe(
    Effect.catchTags({
      LineNotFound: () =>
        Effect.fail(
          new ToolRefusal({
            message: `No line of the user's has the handle "${line.slice(0, 80)}". Handles come from search: search for the line, then use the handle its result gives.`,
            example: `lines ${JSON.stringify({ action: "search", text: "paypal" })}`,
          }),
        ),
      LineMerchantRefused: (refused) => refuseWithLine(ASSIGN_REFUSALS[refused.reason], line),
      MerchantNameRefused: (refused) =>
        nameRefusal(refused.reason, "merchant", { action: "assign", line, merchant: "Pixelplay" }),
      QueryFailed: Effect.die,
    }),
  );
}

/** The merchants family (docs/mcp.md, "Tools"): reads, and the user's edits and merges. */
export const merchantsTool = defineTool<
  MerchantsInput,
  Encoded,
  Merchants | CategoryStore | LineStore
>({
  name: "merchants",
  title: "Merchants",
  description: DESCRIPTION,
  // A repeated rename, move, merge or default category finds the work done, and changes nothing
  // more.
  idempotent: true,
  input: MerchantsInput,
  example: { action: "search", text: "greenmarket" },
  access: {
    list: "read",
    search: "read",
    show: "read",
    create: "write",
    edit: "write",
    merge: "write",
    assign: "write",
  },
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

      case "create": {
        return create(caller.userId, input);
      }

      case "edit": {
        return edit(caller.userId, input);
      }

      case "merge": {
        return merge(caller.userId, input);
      }

      case "assign": {
        return assign(caller.userId, input);
      }
    }
  },
});
