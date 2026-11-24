import {
  accountNamed,
  classifyLine,
  lineTransferOf,
  pairEveryLine,
  pairLineWithAccount,
  pairLines,
  searchLines,
  showLine,
  unpairLine,
} from "@gousset/core";
import type {
  AccountStore,
  CategoryStore,
  EntryKind,
  LineDetail,
  LineNotClassifiable,
  LinePage,
  LineRow,
  LineStore,
  LineTransfer,
  PairingSummary,
  TransferRefused,
  TransferSide,
  Transfers,
} from "@gousset/core";
import { Effect, Schema } from "effect";

import { ToolRefusal, defineTool } from "../tool";
import { MOVEMENT, accountToWrite, amount, named } from "./accounts";
import { namedCategory, pathText } from "./categories";
import { proposedRule } from "./rules";

/** The lines `search` gives when none are asked for, and the most: 100 fit the result's budget. */
const DEFAULT_LINES = 50;
const MAX_LINES = 100;

const LinesInput = Schema.Struct({
  action: Schema.Literals(["search", "show", "pair", "classify", "unpair"]).annotate({
    description:
      "search: the lines that match, across accounts, newest first. show: one line, all that is known of it. pair: two lines as one transfer (writes). classify: what one line is (writes). unpair: undoes a line's transfer (writes).",
  }),
  text: Schema.optional(
    Schema.String.annotate({
      description: "search: a piece of the label, memo or counterparty's name, any case.",
    }),
  ),
  account: Schema.optional(
    Schema.String.annotate({
      description:
        "search: one account's lines, by its name as accounts lists it (any case). pair, classify: in place of other, an account kept by its balance, whose side Gousset makes.",
    }),
  ),
  institution: Schema.optional(
    Schema.String.annotate({
      description:
        "search, pair, classify: the account's bank or issuer, when two accounts share the name.",
    }),
  ),
  from: Schema.optional(
    Schema.String.annotate({ description: "search: booked on or after this day, YYYY-MM-DD." }),
  ),
  to: Schema.optional(
    Schema.String.annotate({ description: "search: booked on or before this day, YYYY-MM-DD." }),
  ),
  amount_min: Schema.optional(
    Schema.String.annotate({
      description:
        'search: the least absolute amount, a decimal in each account\'s currency ("40", "12.50").',
    }),
  ),
  amount_max: Schema.optional(
    Schema.String.annotate({
      description: "search: the greatest absolute amount, the same way.",
    }),
  ),
  to_review: Schema.optional(
    Schema.Boolean.annotate({
      description:
        "search: true for the lines to review only: near duplicates held, lines whose transfer's other side the user chooses among several, and every counted line still classified by default (not classified yet).",
    }),
  ),
  limit: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: MAX_LINES })).annotate({
      description: `search: how many lines, 1 to ${MAX_LINES}; ${DEFAULT_LINES} if left out.`,
    }),
  ),
  after: Schema.optional(
    Schema.String.annotate({
      description:
        "search: an opaque handle to read on, exactly as the result's next call gives it. Never made up.",
    }),
  ),
  line: Schema.optional(
    Schema.String.annotate({
      description: "show, pair, classify, unpair: the line's handle, as search gives it.",
    }),
  ),
  other: Schema.optional(
    Schema.String.annotate({
      description:
        "pair, classify: the handle of the transfer's other side; left out, the line's only candidate.",
    }),
  ),
  kind: Schema.optional(
    Schema.Literals(["transfer", "expense", "income"]).annotate({
      description:
        "classify: what the line is: transfer (one side of money moved between two of the user's accounts), expense (money out) or income (money in), in category, or in that kind's fallback when category is left out. Left out with a category: the line's own kind.",
    }),
  ),
  category: Schema.optional(
    Schema.String.annotate({
      description:
        'classify, with kind expense or income: the category as categories list writes it (any case): a name alone is the top-level category of that name, else its one child; "Parent > Child" names a child. Left out: the kind\'s fallback.',
    }),
  ),
});

type LinesInput = typeof LinesInput.Type;

const DESCRIPTION = `Every line of the user's accounts, as the bank wrote it: search across accounts, read one, say what it is. \`search\` finds lines by a piece of their label, memo or counterparty (\`text\`, any case), one account (\`account\`), a period (\`from\`, \`to\`, YYYY-MM-DD, both included), an amount range (\`amount_min\`, \`amount_max\`), or the lines to review (\`to_review: true\`, listed only then: near duplicates held, transfers whose other side the user chooses, and every counted line still classified by default, that is not classified yet); newest first, with how many match in all, each line's category and its handle. \`show\` gives one line by that handle: its account, days, amount (and the amount in another currency), label, memo, counterparty, category, expiry, the line a held one looks like, its transfer, and the import it came from or how it was made.

Use it for "when did I pay this shop?", "what was this 42.90?", "which import brought this line?", "put this line in Groceries". Use \`accounts\` instead for balances and one account's latest lines, \`month\` for where the money went, \`categories\` to list or change the categories themselves. search and show only read.

Writes, with the write scope: \`classify\` says what \`line\` is, by \`kind\`: "transfer", "expense" or "income". With "expense" or "income", the line goes in \`category\`, named as \`categories\` list writes it (any case): a name alone is the top-level category of that name, else its one child; "Parent > Child" names a child. Without \`category\`, the kind's fallback. \`kind\` may be left out with a category: the line's own. Kept as the user's choice: no rule changes it unasked. The answer proposes the \`rules\` call that classifies lines like it the same way from then on. Refused, with what to do: a line held, discarded or of no amount (no expense nor income), a side of a transfer (unpair it first), a line split across several expenses, a kind or category of the other kind than the line's (money out is an expense, money in an income), an archived category, an unknown or ambiguous category name (with the names to choose from), a category with "transfer".

\`pair\` pairs \`line\` and \`other\` as one transfer, never spending; \`line\` alone: its only candidate; neither: every clear pair. \`classify\` \`kind\` "transfer" is the same; \`unpair\` undoes it. Refused: lines of one account or direction, a paired line, several candidates. With \`account\` in place of \`other\`, an account kept by its balance: Gousset makes its side, which its noted balances' movements then leave out; refused for an account kept by its lines or of another currency.

\`account\` is the name as \`accounts\` lists it (any case); add \`institution\` when two accounts share it. An unknown or ambiguous name is refused with the names to choose from. Amounts are decimal strings in each account's own currency, without sign or currency, compared with the line's absolute amount: a -42.90 EUR payment matches "amount_min":"40". A period that ends before it starts, an amount that is no decimal, or an \`after\` no result gave is refused. \`limit\` is 1 to ${MAX_LINES} lines, ${DEFAULT_LINES} by default; when more remain, the result writes the exact next call with \`after\`: copy it.

Examples: {"action":"search","text":"corner cafe","account":"Current account","institution":"Riverside Bank","from":"2026-10-01"} · {"action":"search","amount_min":"40","amount_max":"45.50"} · {"action":"show","line":"<a handle search gave>"} · {"action":"classify","line":"<a handle search gave>","kind":"expense","category":"Groceries > Bakery"} · {"action":"pair","line":"<a handle search gave>","account":"Gift card"}`;

const call = (input: typeof LinesInput.Encoded) => `lines ${JSON.stringify(input)}`;

/** The search's own arguments, as the caller gave them: the next call repeats them. */
function searchArguments(input: LinesInput): typeof LinesInput.Encoded {
  return {
    action: "search",
    text: input.text,
    account: input.account,
    institution: input.institution,
    from: input.from,
    to: input.to,
    amount_min: input.amount_min,
    amount_max: input.amount_max,
    to_review: input.to_review,
    limit: input.limit,
  };
}

const quoted = (label: string) => (label === "" ? "(no label)" : `"${label}"`);

/** A line's label, quoted; a movement of a noted balance has none, and is named so (#31). */
const labelOf = (line: { readonly label: string; readonly fromBalance: boolean }) =>
  line.fromBalance ? `(${MOVEMENT})` : quoted(line.label);

function amountsText(input: LinesInput): Array<string> {
  const min = input.amount_min?.trim() ?? "";
  const max = input.amount_max?.trim() ?? "";

  if (min === "" && max === "") {
    return [];
  }

  const range =
    min === "" ? `at most ${max}` : max === "" ? `at least ${min}` : `between ${min} and ${max}`;

  return [`an absolute amount ${range} in the account's currency`];
}

/** The filters the search understood, in words. */
function filtersText(input: LinesInput, account: string | undefined): string {
  const text = input.text?.trim() ?? "";

  const filters = [
    ...(text === "" ? [] : [`containing "${text}"`]),
    ...(account === undefined ? [] : [`in ${account}`]),
    ...(input.from === undefined ? [] : [`booked from ${input.from}`]),
    ...(input.to === undefined ? [] : [`booked until ${input.to}`]),
    ...amountsText(input),
  ];

  const kind =
    input.to_review === true
      ? "to review (near duplicates held, transfers whose other side the user chooses, and counted lines still classified by default: not classified yet)"
      : "counted (add to_review: true for the lines to review)";

  return filters.length === 0 ? `every line ${kind}` : `lines ${kind}, ${filters.join(", ")}`;
}

function rowText(line: LineRow): string {
  const held = line.toReview ? ", to review" : "";
  const category = line.category === null ? "" : `, in ${pathText(line.category)}`;

  return `- ${line.bookedOn}, ${named(line.account)}: ${amount(line.amount)}, ${labelOf(line)}${category}${held}; line: ${line.id}`;
}

/** A page of the search: how many match, the filters, the lines, and the call that reads on. */
function searchText(page: LinePage, input: LinesInput, account: string | undefined): string {
  const header = `${page.total} line(s) match: ${filtersText(input, account)}. Lines booked after today are not shown.`;

  if (page.lines.length === 0) {
    return `${header}\n\nNo line on this page.`;
  }

  const lines = [
    `These ${page.lines.length}, newest first (booked on, account: amount, label, category; the handle show and classify take):`,
    ...page.lines.map(rowText),
  ];

  const next =
    page.next === null
      ? []
      : [
          `More lines remain. Read them with: ${call({ ...searchArguments(input), after: page.next })}`,
        ];

  return [header, [...lines, ...next].join("\n")].join("\n\n");
}

/** The formats as people write them; the detail carries the stored name. */
const FORMAT_NAMES = new Map([
  ["ofx", "OFX"],
  ["qfx", "QFX"],
  ["qif", "QIF"],
  ["camt053", "CAMT.053"],
  ["mt940", "MT940"],
  ["csv", "CSV"],
]);

const SOURCE_TEXTS = {
  import: "Came from an import whose record is gone.",
  manual: "Entered by hand.",
  balance: "Made by Gousset from a balance the user noted.",
  counterpart:
    "Made by Gousset: the side of a transfer that this account's own statement does not show.",
} as const satisfies { readonly [Source in LineDetail["source"]]: string };

function originText(detail: LineDetail): string {
  const read = detail.import;

  if (read === null) {
    return SOURCE_TEXTS[detail.source];
  }

  const period =
    read.periodFrom === null || read.periodTo === null
      ? ""
      : `, covering ${read.periodFrom} to ${read.periodTo}`;

  const format = FORMAT_NAMES.get(read.format) ?? read.format;

  return `Imported from "${read.fileName}" (${format}) on ${read.importedAt.slice(0, 10)}${period}.`;
}

const PAIRED_BY = { import: "Gousset", rule: "a rule", user: "the user" } as const;

function sideText(side: TransferSide): string {
  const made = side.madeByApp
    ? ", made by Gousset as that account's statement does not show it"
    : "";

  return `the line of ${side.bookedOn}, ${named(side.account)}: ${amount(side.amount)}, ${quoted(side.label)}${made}; line: ${side.id}`;
}

/** A line's transfer, its candidates, or nothing when it is no transfer and has none. */
function transferText(lineId: string, transfer: LineTransfer): Array<string> {
  const { paired, candidates } = transfer;

  if (paired !== null) {
    const way = paired.direction === "out" ? "to" : "from";
    const aside = paired.setAside ? " Set aside: money moved to savings or investments." : "";

    return [
      `Transfer ${way} ${named(paired.other.account)}, paired by ${PAIRED_BY[paired.pairedBy]}: never counted as spending.${aside} Its other side is ${sideText(paired.other)}. If it is no transfer: ${call({ action: "unpair", line: lineId })}`,
    ];
  }

  const [first] = candidates;

  if (first === undefined) {
    return [];
  }

  const intro =
    candidates.length === 1
      ? "Maybe a transfer: one line may be its other side, but it has other candidates:"
      : `To review: ${candidates.length} lines may be the other side of this transfer; the user chooses:`;

  return [
    [
      intro,
      ...candidates.map((side) => `- ${sideText(side)}`),
      `Pair it with one: ${call({ action: "pair", line: lineId, other: first.id })}`,
    ].join("\n"),
  ];
}

/** One line, in Gousset's words: where and when, how much, what the bank said, where it came from. */
function showText(detail: LineDetail, transfer: LineTransfer): string {
  const valueOn = detail.valueOn === null ? "" : `, value on ${detail.valueOn}`;

  const original =
    detail.originalAmount === null ? "" : ` (originally ${amount(detail.originalAmount)})`;

  const look = detail.duplicateOf;

  const review = detail.toReview
    ? [
        look === null
          ? "To review: held as a near duplicate, not counted until the user decides."
          : `To review: held as a near duplicate of the line of ${look.bookedOn}, ${amount(look.amount)}, ${quoted(look.label)} (line: ${look.id}); not counted until the user decides.`,
      ]
    : [];

  return [
    `Line of ${named(detail.account)}, booked on ${detail.bookedOn}${valueOn}.`,
    `Amount: ${amount(detail.amount)}${original}.`,
    `Label: ${labelOf(detail)}`,
    ...(detail.memo === null ? [] : [`Memo: ${detail.memo}`]),
    ...(detail.counterpartyName === null ? [] : [`Counterparty: ${detail.counterpartyName}`]),
    ...(detail.category === null
      ? []
      : [`Category: ${pathText(detail.category)} (${detail.category.kind})`]),
    ...(detail.expiresOn === null ? [] : [`Expires on: ${detail.expiresOn}`]),
    ...review,
    ...transferText(detail.id, transfer),
    originText(detail),
  ].join("\n");
}

function pairingText(summary: PairingSummary): string {
  const review =
    summary.toReview === 0
      ? "No line is left with several possible other sides."
      : `${summary.toReview} line(s) have several possible other sides and wait for the user: \`show\` one to see them, then pair it with \`other\`.`;

  return [
    `Paired every clear transfer: ${summary.paired} between two lines, ${summary.cardDebits} deferred card debit(s) with the card's side made by Gousset, ${summary.replaced} side(s) Gousset had made replaced by the statement's own line.`,
    review,
  ].join(" ");
}

const lineRefused = (line: string, message: string) =>
  Effect.fail(
    new ToolRefusal({
      message: `${message.replace("{line}", `"${line.slice(0, 80)}"`)} Handles come from search: search for the line, then use the handle its result gives.`,
      example: call({ action: "search", text: "corner cafe" }),
    }),
  );

const NOT_FOUND = "No line of the user's has the handle {line}.";

const TRANSFER_REFUSALS = {
  same_line: "A transfer has two sides: name two different lines.",
  same_account:
    "Both sides are on the same account: a transfer moves money between two of the user's accounts.",
  same_sign:
    "Both lines move money the same way: a transfer is one line out (negative) and one line in (positive).",
  zero_amount: "A line of no amount moves no money: it is no side of a transfer.",
  not_counted:
    "The line {line} is held for review as a near duplicate (or thrown away): it is not counted, so it cannot be paired.",
  made_from_balance:
    "The line {line} was made by Gousset from a balance the user noted: it stands for the month's movement of an account kept by its balance, never for one side of a transfer.",
  already_paired:
    "The line {line} is already a side of a transfer: unpair it first if that pairing is wrong.",
  no_candidate:
    "No line of another of the user's accounts has the opposite amount within a few days (up to 4 days after the next fortnight's start, the 1st or the 16th, when one side is a savings account): name the other side with other (across currencies too).",
  several_candidates:
    "Several lines may be the other side of this transfer: show the line to list them, then pair it with other.",
  account_kept_by_lines:
    "That account is kept by its lines: its own side of the transfer is one of its lines. Pair the line {line} with that line, named with other.",
  other_currency:
    "That account is in another currency than the line {line}: Gousset makes its side only in the line's currency. Pair it with a line of that account, named with other.",
} as const satisfies { readonly [Reason in TransferRefused["reason"]]: string };

function transferRefused(input: LinesInput, refused: TransferRefused) {
  const line = input.line ?? "";

  const example =
    refused.reason === "already_paired"
      ? call({ action: "unpair", line: refused.lineId })
      : refused.reason === "several_candidates" || refused.reason === "no_candidate"
        ? call({ action: "show", line })
        : call({ action: "search", text: "transfer" });

  return Effect.fail(
    new ToolRefusal({
      message: TRANSFER_REFUSALS[refused.reason].replace("{line}", refused.lineId),
      example,
    }),
  );
}

/**
 * `pair` with an account kept by its balance (#31): Gousset makes that account's side, and its
 * movements are made again around it.
 */
function pairWithAccountRun(input: LinesInput, owner: string, line: string, name: string) {
  return Effect.gen(function* () {
    const found = yield* accountToWrite(owner, name, input.institution, (each) =>
      call({
        action: "pair",
        line,
        account: each.name,
        institution: each.institution ?? undefined,
      }),
    );

    const transfer = yield* pairLineWithAccount(owner, line, found.id);

    return [
      "Paired as a transfer.",
      ...transferText(line, transfer),
      `The movements of ${named(found)}'s noted balances leave it out from now on.`,
    ].join("\n");
  }).pipe(
    Effect.catchTags({
      LineNotFound: (missing) => lineRefused(missing.lineId, NOT_FOUND),
      // Found by name a moment before: deleted in between, as good as unknown.
      AccountNotFound: () =>
        Effect.fail(
          new ToolRefusal({
            message: `The account "${name}" is gone. List the accounts again.`,
            example: `accounts ${JSON.stringify({ action: "list" })}`,
          }),
        ),
      TransferRefused: (refused) => transferRefused(input, refused),
      QueryFailed: Effect.die,
    }),
  );
}

/**
 * `pair` and `classify` as a transfer: two lines, one line and its only candidate, every line, or
 * one line and an account kept by its balance.
 */
function pairRun(input: LinesInput, owner: string) {
  const line = input.line?.trim() ?? "";
  const other = input.other?.trim() ?? "";
  const account = input.account?.trim() ?? "";

  if (account !== "") {
    if (other !== "" || line === "") {
      return Effect.fail(
        new ToolRefusal({
          message:
            "account names the other side of one line's transfer, in place of other: give the line's handle as line, and leave other out.",
          example: call({ action: "pair", line: line === "" ? "<a handle>" : line, account }),
        }),
      );
    }

    return pairWithAccountRun(input, owner, line, account);
  }

  if (line === "") {
    return other === ""
      ? pairEveryLine(owner).pipe(
          Effect.map(pairingText),
          Effect.catchTag("QueryFailed", Effect.die),
        )
      : Effect.fail(
          new ToolRefusal({
            message: "other is the second side: give line too, the first one.",
            example: call({ action: "pair", line: "<a handle>", other }),
          }),
        );
  }

  return pairLines(owner, line, other === "" ? null : other).pipe(
    Effect.map((transfer) => [`Paired as a transfer.`, ...transferText(line, transfer)].join("\n")),
    Effect.catchTags({
      LineNotFound: (missing) => lineRefused(missing.lineId, NOT_FOUND),
      TransferRefused: (refused) => transferRefused(input, refused),
      QueryFailed: Effect.die,
    }),
  );
}

function unpairRun(input: LinesInput, owner: string) {
  const line = input.line?.trim() ?? "";

  if (line === "") {
    return Effect.fail(
      new ToolRefusal({
        message: "unpair needs the handle of one side of the transfer.",
        example: call({ action: "search", text: "transfer" }),
      }),
    );
  }

  return unpairLine(owner, line).pipe(
    Effect.map(({ other, madeSideDeleted }) => {
      if (!madeSideDeleted) {
        return `No longer a transfer: the line and ${sideText(other)} are two separate lines again, each an expense or an income.`;
      }

      return other.madeByApp
        ? `No longer a transfer. Its other side, which Gousset had made on ${named(other.account)}, is deleted; the line counts as an expense or an income again.`
        : `No longer a transfer. This line, which Gousset had made, is deleted; ${sideText(other)} counts as an expense or an income again.`;
    }),
    Effect.catchTags({
      LineNotFound: (missing) => lineRefused(missing.lineId, NOT_FOUND),
      NotATransfer: () =>
        Effect.fail(
          new ToolRefusal({
            message: `The line "${line.slice(0, 80)}" is no side of a transfer: there is nothing to unpair.`,
            example: call({ action: "show", line }),
          }),
        ),
      QueryFailed: Effect.die,
    }),
  );
}

const SEARCH_REFUSALS = {
  amount: {
    message:
      'amount_min and amount_max are decimals in each account\'s own currency, without sign nor currency ("40", "12.50"), and the minimum is at most the maximum.',
    example: { action: "search", amount_min: "40", amount_max: "45.50" },
  },
  period: {
    message:
      "from and to are days written YYYY-MM-DD, and from is on or before to (both are included).",
    example: { action: "search", from: "2026-10-01", to: "2026-10-31" },
  },
  cursor: {
    message:
      "after is a handle only a previous search's next call gives: copy it exactly, or leave it out to start from the newest line.",
    example: { action: "search" },
  },
} as const satisfies {
  readonly [Reason in "amount" | "period" | "cursor"]: {
    readonly message: string;
    readonly example: typeof LinesInput.Encoded;
  };
};

/** The account a search names, resolved as the accounts tool does, or the refusal to give. */
function accountOf(caller: string, input: LinesInput) {
  const { account, institution } = input;

  if (account === undefined) {
    return Effect.succeed(undefined);
  }

  return accountNamed(caller, account, institution).pipe(
    Effect.catchTags({
      AccountNameUnknown: (unknown) => {
        const [first] = unknown.accounts;

        return Effect.fail(
          new ToolRefusal({
            message:
              first === undefined
                ? "The user has no account in Gousset yet: there is no line to search."
                : `No account of the user's is named "${unknown.name}"${institution === undefined ? "" : ` at "${institution}"`}. Their accounts: ${unknown.accounts.map(named).join(", ")}. Search again with one of these names, or without account for every account.`,
            example:
              first === undefined
                ? call({ action: "search" })
                : call({
                    ...searchArguments(input),
                    account: first.name,
                    institution: first.institution ?? undefined,
                  }),
          }),
        );
      },
      AccountNameAmbiguous: (ambiguous) => {
        const [first] = ambiguous.matches;
        const institutions = new Set(ambiguous.matches.map((match) => match.institution));

        const apart =
          institutions.size === ambiguous.matches.length
            ? "Add institution to tell them apart."
            : "Some share their institution too, so a name cannot tell them apart: ask the user to rename one in Gousset.";

        return Effect.fail(
          new ToolRefusal({
            message: `Several accounts of the user's are named "${ambiguous.name}": ${ambiguous.matches.map(named).join(", ")}. ${apart}`,
            example: call({
              ...searchArguments(input),
              account: first?.name ?? ambiguous.name,
              institution: first?.institution ?? undefined,
            }),
          }),
        );
      },
    }),
  );
}

const UNKNOWN_LINE = (line: string) =>
  new ToolRefusal({
    message: `No line of the user's has the handle "${line.slice(0, 80)}". Handles come from search: search for the line, then use the handle its result gives.`,
    example: call({ action: "search", text: "corner cafe" }),
  });

const NOT_CLASSIFIABLE = {
  no_entry:
    "This line has no category to change: it is held for review, discarded, or of no amount, so it counts as no expense nor income.",
  transfer:
    "This line is a side of a transfer between two of the user's accounts: never an expense nor an income. If it is no transfer, unpair it first, then classify it.",
  split:
    "This line is split across several expenses, each with its own category: classify them in Gousset, one by one.",
} as const satisfies { readonly [Reason in LineNotClassifiable["reason"]]: string };

/**
 * Puts a line in the category a person names, or in the fallback of the kind named (expense or
 * income) when none is, as the user's choice.
 */
function classifyAction(owner: string, input: LinesInput, kind: EntryKind | undefined) {
  const { line, category } = input;

  if (line === undefined || line.trim() === "" || (category === undefined && kind === undefined)) {
    return Effect.fail(
      new ToolRefusal({
        message:
          "classify needs the line's handle, as search gives it, and a category, as categories list writes it, or a kind: expense, income or transfer.",
        example: call({ action: "search", text: "corner cafe" }),
      }),
    );
  }

  const handle = line.trim();

  return Effect.gen(function* () {
    const detail = yield* showLine(owner, handle);

    // Its kind tells an expense "Other" from an income one: the one named, else its sign's.
    const kindOf =
      kind ?? detail.category?.kind ?? (detail.amount.minor < 0 ? "expense" : "income");

    const chosen =
      category === undefined
        ? { fallbackOf: kindOf }
        : {
            categoryId: (yield* namedCategory(owner, category, kindOf, (other, otherKind) =>
              call({ action: "classify", line: handle, category: other, kind: otherKind }),
            )).id,
          };

    const placed = yield* classifyLine(owner, detail.id, chosen);

    // A correction to a category of the user's choosing may become a rule (#25); a fallback, not.
    const proposal =
      category === undefined
        ? undefined
        : proposedRule(detail.label, detail.counterpartyName, pathText(placed));

    const done = `The line of ${detail.bookedOn}, ${amount(detail.amount)}, ${labelOf(detail)}, is now in ${pathText(placed)} (${placed.kind}). Kept as the user's choice: no rule changes it unasked.`;

    return proposal === undefined ? done : `${done}\n${proposal}`;
  }).pipe(
    Effect.catchTags({
      LineNotFound: () => Effect.fail(UNKNOWN_LINE(handle)),
      LineNotClassifiable: (refused) =>
        Effect.fail(
          new ToolRefusal({
            message: NOT_CLASSIFIABLE[refused.reason],
            example: call({
              action: refused.reason === "transfer" ? "unpair" : "show",
              line: handle,
            }),
          }),
        ),
      CategoryKindMismatch: (mismatch) =>
        Effect.fail(
          new ToolRefusal({
            message:
              category === undefined
                ? `This line is ${mismatch.lineKind === "expense" ? "an expense (money out)" : "an income (money in)"}, not ${mismatch.categoryKind === "expense" ? "an expense" : "an income"}: give kind ${mismatch.lineKind}, or one of its categories, as categories list gives them.`
                : `This line is ${mismatch.lineKind === "expense" ? "an expense (money out)" : "an income (money in)"}, and "${category}" is ${mismatch.categoryKind === "expense" ? "an expense" : "an income"} category: choose an ${mismatch.lineKind} category, as categories list gives them.`,
            example: `categories ${JSON.stringify({ action: "list", kind: mismatch.lineKind })}`,
          }),
        ),
      CategoryRefused: (refused) =>
        refused.reason === "archived"
          ? Effect.fail(
              new ToolRefusal({
                message: `"${category}" is archived: it can no longer be chosen. Restore it with categories archive and restore: true, or choose a category in use.`,
                example: `categories ${JSON.stringify({ action: "archive", category, restore: true })}`,
              }),
            )
          : Effect.die(new Error(`A line's category refused: ${refused.reason}.`)),
      // Found by name a moment before: changed in between.
      CategoryNotFound: () =>
        Effect.fail(
          new ToolRefusal({
            message: "The category is gone: list the categories again.",
            example: `categories ${JSON.stringify({ action: "list" })}`,
          }),
        ),
      QueryFailed: Effect.die,
    }),
  );
}

/**
 * The lines family (docs/mcp.md, "Tools"): searched and read; put in a category (#23), paired as
 * transfers (#26) with the write scope.
 */
export const linesTool = defineTool<
  LinesInput,
  typeof LinesInput.Encoded,
  AccountStore | LineStore | CategoryStore | Transfers
>({
  name: "lines",
  title: "Lines",
  description: DESCRIPTION,
  idempotent: true,
  input: LinesInput,
  example: { action: "search", text: "corner cafe", account: "Current account" },
  access: { search: "read", show: "read", pair: "write", classify: "write", unpair: "write" },
  run: (input, caller) => {
    switch (input.action) {
      case "search": {
        if (input.institution !== undefined && input.account === undefined) {
          return Effect.fail(
            new ToolRefusal({
              message:
                "institution only tells apart two accounts of the same name: give account too.",
              example: call({
                action: "search",
                account: "Livret A",
                institution: input.institution,
              }),
            }),
          );
        }

        return Effect.gen(function* () {
          const found = yield* accountOf(caller.userId, input);

          const page = yield* searchLines(caller.userId, {
            text: input.text,
            accountId: found?.id,
            from: input.from,
            to: input.to,
            amountMin: input.amount_min,
            amountMax: input.amount_max,
            toReview: input.to_review,
            after: input.after,
            limit: input.limit ?? DEFAULT_LINES,
          });

          return searchText(page, input, found === undefined ? undefined : named(found));
        }).pipe(
          Effect.catchTags({
            LineSearchRefused: (refused) => {
              const { message, example } = SEARCH_REFUSALS[refused.reason];

              return Effect.fail(
                new ToolRefusal({
                  message,
                  example: call(
                    refused.reason === "cursor"
                      ? { ...searchArguments(input), after: undefined }
                      : example,
                  ),
                }),
              );
            },
            // A failure of the database is Gousset's, not the caller's: the door says so.
            QueryFailed: Effect.die,
          }),
        );
      }

      case "show": {
        const { line } = input;

        if (line === undefined || line.trim() === "") {
          return Effect.fail(
            new ToolRefusal({
              message: "show needs the line's handle, as search gives it after each line.",
              example: call({ action: "search", text: "corner cafe" }),
            }),
          );
        }

        return Effect.all([
          showLine(caller.userId, line.trim()),
          lineTransferOf(caller.userId, line.trim()),
        ]).pipe(
          Effect.map(([detail, transfer]) => showText(detail, transfer)),
          Effect.catchTags({
            LineNotFound: () => Effect.fail(UNKNOWN_LINE(line)),
            QueryFailed: Effect.die,
          }),
        );
      }

      case "pair": {
        return pairRun(input, caller.userId);
      }

      case "classify": {
        if (input.kind !== "transfer") {
          return classifyAction(caller.userId, input, input.kind);
        }

        if (input.category !== undefined) {
          return Effect.fail(
            new ToolRefusal({
              message:
                "A transfer moves money between two of the user's accounts: it has no category. Leave category out, or classify the line as an expense or an income.",
              example: call({
                action: "classify",
                line: input.line ?? "<a handle>",
                kind: "transfer",
              }),
            }),
          );
        }

        if ((input.line?.trim() ?? "") === "") {
          return Effect.fail(
            new ToolRefusal({
              message:
                "classify needs the line's handle and its kind: transfer, with the other side's handle as other (or none for its only candidate).",
              example: call({ action: "classify", line: "<a handle>", kind: "transfer" }),
            }),
          );
        }

        return pairRun(input, caller.userId);
      }

      case "unpair": {
        return unpairRun(input, caller.userId);
      }
    }
  },
});
