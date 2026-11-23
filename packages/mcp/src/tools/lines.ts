import { accountNamed, searchLines, showLine } from "@gousset/core";
import type { AccountStore, LineDetail, LinePage, LineRow, LineStore } from "@gousset/core";
import { Effect, Schema } from "effect";

import { ToolRefusal, defineTool } from "../tool";
import { amount, named } from "./accounts";

/** The lines `search` gives when none are asked for, and the most: 100 fit the result's budget. */
const DEFAULT_LINES = 50;
const MAX_LINES = 100;

const LinesInput = Schema.Struct({
  action: Schema.Literals(["search", "show"]).annotate({
    description:
      "search: the lines that match, across accounts, newest first. show: one line, all that is known of it.",
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
        "search: true for the lines held for review only (near duplicates waiting for the user).",
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
    Schema.String.annotate({ description: "show: the line's handle, as search gives it." }),
  ),
});

type LinesInput = typeof LinesInput.Type;

const DESCRIPTION = `Every line of the user's accounts, as the bank wrote it: search across accounts, then read one. \`search\` finds lines by a piece of their label, memo or counterparty (\`text\`, any case), one account (\`account\`), a period (\`from\`, \`to\`, YYYY-MM-DD, both included), an amount range (\`amount_min\`, \`amount_max\`), or the lines held for review (\`to_review\`: near duplicates waiting for the user, listed only then); newest first, with how many match in all and each line's handle. \`show\` gives one line by that handle: its account, days, amount (and the amount in another currency), label, memo, counterparty, expiry, the line a held one looks like, and the import it came from or how it was made.

Use it for "when did I pay this shop?", "what was this 42.90?", "which import brought this line?". Use \`accounts\` instead for balances and one account's latest lines, \`month\` for where the money went. Both actions only read.

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
      ? "held for review (near duplicates waiting for the user)"
      : "counted (add to_review: true for the lines held for review)";

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

/** One line, in Gousset's words: where and when, how much, what the bank said, where it came from. */
function showText(detail: LineDetail): string {
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
    originText(detail),
  ].join("\n");
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

/** The lines family (docs/mcp.md, "Tools"): read only. */
export const linesTool = defineTool<
  LinesInput,
  typeof LinesInput.Encoded,
  AccountStore | LineStore
>({
  name: "lines",
  title: "Lines",
  description: DESCRIPTION,
  idempotent: true,
  input: LinesInput,
  example: { action: "search", text: "corner cafe", account: "Current account" },
  access: { search: "read", show: "read" },
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

        return showLine(caller.userId, line.trim()).pipe(
          Effect.map(showText),
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
    }
  },
});
