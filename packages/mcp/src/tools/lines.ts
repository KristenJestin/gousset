import {
  accountNamed,
  lineTransferOf,
  pairEveryLine,
  pairLines,
  searchLines,
  showLine,
  unpairLine,
} from "@gousset/core";
import type {
  AccountStore,
  LineDetail,
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
import { amount, named } from "./accounts";

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
      description: "search: one account's lines, by its name as accounts lists it (any case).",
    }),
  ),
  institution: Schema.optional(
    Schema.String.annotate({
      description: "search: the account's bank or issuer, when two accounts share the name.",
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
        "search: true for the lines to review only: near duplicates held, and lines whose transfer's other side the user chooses among several.",
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
    Schema.Literals(["transfer"]).annotate({
      description:
        "classify: what the line is: transfer (one side of money moved between two of the user's accounts).",
    }),
  ),
});

type LinesInput = typeof LinesInput.Type;

const DESCRIPTION = `Every line of the user's accounts, as the bank wrote it: search across accounts, then read one. \`search\` finds lines by a piece of their label, memo or counterparty (\`text\`, any case), one account (\`account\`), a period (\`from\`, \`to\`, YYYY-MM-DD, both included), an amount range (\`amount_min\`, \`amount_max\`), or the lines to review (\`to_review\`: near duplicates and unsure transfers, listed only then); newest first, with how many match in all and each line's handle. \`show\` gives one line by that handle: its account, days, amount (and the amount in another currency), label, memo, counterparty, expiry, the line a held one looks like, its transfer, and the import it came from or how it was made.

Use it for "when did I pay this shop?", "what was this 42.90?", "which import brought this line?". Use \`accounts\` instead for balances and one account's latest lines, \`month\` for where the money went. search and show only read.

Writes: \`pair\` pairs \`line\` and \`other\` as one transfer, never spending; \`line\` alone: its only candidate; neither: every clear pair. \`classify\` \`kind\` "transfer" is the same; \`unpair\` undoes it. Refused: lines of one account or direction, a paired line, several candidates.

\`account\` is the name as \`accounts\` lists it (any case); add \`institution\` when two accounts share it. An unknown or ambiguous name is refused with the names to choose from. Amounts are decimal strings in each account's own currency, without sign or currency, compared with the line's absolute amount: a -42.90 EUR payment matches "amount_min":"40". A period that ends before it starts, an amount that is no decimal, or an \`after\` no result gave is refused. \`limit\` is 1 to ${MAX_LINES} lines, ${DEFAULT_LINES} by default; when more remain, the result writes the exact next call with \`after\`: copy it.

Examples: {"action":"search","text":"corner cafe","account":"Current account","institution":"Riverside Bank","from":"2026-10-01"} · {"action":"search","amount_min":"40","amount_max":"45.50"} · {"action":"show","line":"<a handle search gave>"}`;

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
      ? "to review (near duplicates held, and transfers whose other side the user chooses)"
      : "counted (add to_review: true for the lines to review)";

  return filters.length === 0 ? `every line ${kind}` : `lines ${kind}, ${filters.join(", ")}`;
}

function rowText(line: LineRow): string {
  const held = line.toReview ? ", to review" : "";

  return `- ${line.bookedOn}, ${named(line.account)}: ${amount(line.amount)}, ${quoted(line.label)}${held}; line: ${line.id}`;
}

/** A page of the search: how many match, the filters, the lines, and the call that reads on. */
function searchText(page: LinePage, input: LinesInput, account: string | undefined): string {
  const header = `${page.total} line(s) match: ${filtersText(input, account)}. Lines booked after today are not shown.`;

  if (page.lines.length === 0) {
    return `${header}\n\nNo line on this page.`;
  }

  const lines = [
    `These ${page.lines.length}, newest first (booked on, account: amount, label; the handle show takes):`,
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
    `Label: ${quoted(detail.label)}`,
    ...(detail.memo === null ? [] : [`Memo: ${detail.memo}`]),
    ...(detail.counterpartyName === null ? [] : [`Counterparty: ${detail.counterpartyName}`]),
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
    "Both lines are on the same account: a transfer moves money between two of the user's accounts.",
  same_sign:
    "Both lines move money the same way: a transfer is one line out (negative) and one line in (positive).",
  zero_amount: "A line of no amount moves no money: it is no side of a transfer.",
  not_counted:
    "The line {line} is held for review as a near duplicate (or thrown away): it is not counted, so it cannot be paired.",
  already_paired:
    "The line {line} is already a side of a transfer: unpair it first if that pairing is wrong.",
  no_candidate:
    "No line of another of the user's accounts has the opposite amount within a few days: name the other side with other (across currencies too).",
  several_candidates:
    "Several lines may be the other side of this transfer: show the line to list them, then pair it with other.",
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

/** `pair` and `classify` as a transfer: two lines, one line and its only candidate, or every line. */
function pairRun(input: LinesInput, owner: string) {
  const line = input.line?.trim() ?? "";
  const other = input.other?.trim() ?? "";

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
    Effect.map((other) =>
      other.madeByApp
        ? `No longer a transfer. Its other side, made by Gousset, is deleted; the line counts as an expense or an income again.`
        : `No longer a transfer: the line and ${sideText(other)} are two separate lines again, each an expense or an income.`,
    ),
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

/**
 * The lines family (docs/mcp.md, "Tools"): searched and read; paired as transfers with the write
 * scope (#26).
 */
export const linesTool = defineTool<
  LinesInput,
  typeof LinesInput.Encoded,
  AccountStore | LineStore | Transfers
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
            LineNotFound: () =>
              Effect.fail(
                new ToolRefusal({
                  message: `No line of the user's has the handle "${line.slice(0, 80)}". Handles come from search: search for the line, then show it with the handle its result gives.`,
                  example: call({ action: "search", text: "corner cafe" }),
                }),
              ),
            QueryFailed: Effect.die,
          }),
        );
      }

      case "pair": {
        return pairRun(input, caller.userId);
      }

      case "classify": {
        if (input.kind === undefined || (input.line?.trim() ?? "") === "") {
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
