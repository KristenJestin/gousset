import {
  MIN_CHARGES,
  Month,
  currentMonth,
  lastDayOf,
  monthBenchmarks,
  monthReview,
  monthSpending,
  monthSubjectSpending,
  monthSubscriptions,
  pathOf as subjectPathOf,
  spendingDays,
} from "@gousset/core";
import type {
  CategoryInMonth,
  CategorySpending,
  CategoryStore,
  Expenses,
  FutureMonthRefused,
  LineStore,
  MerchantSpending,
  Merchants,
  MonthBenchmark,
  MonthBenchmarks,
  MonthFacts,
  MonthFlag,
  MonthReview,
  MonthSpending,
  MonthSubscriptionsRead,
  SpendingDays,
  SubjectSpending,
  SubjectSpendingRead,
  Subscriptions,
  Transfers,
} from "@gousset/core";
import { Effect, Schema } from "effect";

import { ToolRefusal, defineTool } from "../tool";
import { amount } from "./accounts";
import { benchmarkCurrency } from "./categories";

const MonthInput = Schema.Struct({
  action: Schema.Literals(["summary", "spending", "days", "subscriptions", "benchmarks"]).annotate({
    description: "See the description.",
  }),
  month: Schema.optional(
    Month.annotate({ description: "YYYY-MM; the current month if left out." }),
  ),
  by: Schema.optional(
    Schema.Literals(["category", "merchant", "subject"]).annotate({
      description:
        "spending, days: category (default), merchant or subject. By subject, an expense counts whole in each of its subjects and once in a parent: the rows never add up.",
    }),
  ),
  name: Schema.optional(
    Schema.String.annotate({
      description: "days: a row as spending names it.",
    }),
  ),
});

type MonthInput = typeof MonthInput.Type;

type Encoded = typeof MonthInput.Encoded;

/** The row of the expenses that name several merchants or none, as `days` takes it. */
const NO_MERCHANT = "no merchant";

/** The row `days` writes in its example when the month has none to name. */
const FALLBACK_ROWS = { category: "Groceries", merchant: NO_MERCHANT, subject: "Van" } as const;

/** How many merchants `spending` lists; the others are summed, and read with `lines`. */
const MERCHANTS_LISTED = 100;

/** How many movements `summary` lists; the others are read with `lines`. */
const MOVEMENTS_LISTED = 60;

const DESCRIPTION = `The user's own monthly review, in their currency (others apart, never converted). Read only. month: YYYY-MM, the current one if left out; summary, spending, days and subscriptions refuse a month to come.

\`summary\`, for "how did my month go?" or "what is left?": received, spent against the average and the previous month, set aside (net transfers onto savings and investments), left (received less spent and set aside) and its part restricted to benefit accounts, incomes and transfers, lines to review (review settles them), imports, flags.

\`spending\`, by category (default) or merchant: each row at net cost, on the day it happened, against its average and the previous month; a transfer is never spending. Categories with children, benchmark and drift. A merchant is who was paid, else a payment intermediary (PayPal) when nothing better is known; "${NO_MERCHANT}" holds expenses naming several or none, last. By subject: each subject with an expense in the month, by path, a parent with its children's expenses, each once; an expense counts whole in each of its subjects, so rows never add up.

\`days\`, with by and name (a row as spending names it): its running total by day against the previous month.

\`subscriptions\`, with \`month\` (YYYY-MM, the current one if left out; a month to come is refused): the payments that recur (merchant, weekly, monthly or yearly, usual price, last paid day and amount, next expected day), those that stopped (the expected day that did not come) and the prices that rose (from, to). Detected on read from the user's own expenses of the three years up to the month's end (today, in the current month): one merchant paid at a steady rhythm and price, at least ${MIN_CHARGES.weekly} times weekly, ${MIN_CHARGES.monthly} monthly or ${MIN_CHARGES.yearly} yearly; a bill that varies is none. A merchant the user says is no subscription is never proposed: merchants edit with subscription false; true proposes it again.

\`benchmarks\`, with \`month\` (the current one if left out): every expense category's spending against its benchmark, the categories that drift above it first. Use it for "am I spending more than usual?" or "which categories went over?". Each category: what its expenses cost in the month, each at its net cost (payments less refunds; a split line counts its share in each category; transfers are no spending), a top-level category with its children's; then its benchmark: the monthly average of the six months before (automatic), an amount the user set (set), or none. An automatic benchmark counts only the full months from the user's first entry on, so a new user's is the average of fewer months; there is none yet for a category with nothing spent, net, in those months. A category drifts when it cost more than its benchmark, by any amount; one without a benchmark never drifts. Amounts are in the user's currency; spending on accounts of another currency is shown apart, never converted nor compared. Archived categories show only when they had spending that month. To change a benchmark, use categories edit.

For balances or one payment, use accounts or lines: "how much do I have?", "what did I pay at the bakery last month?".

Examples: {"action":"summary"} · {"action":"spending","by":"merchant","month":"2026-10"} · {"action":"days","name":"Groceries > Bakery"} · {"action":"benchmarks"}`;

const CADENCES = { weekly: "weekly", monthly: "monthly", yearly: "yearly" } as const;

const money = (minor: number, currency: string) => amount({ minor, currency });

/** The month's subscriptions as text: names, not ids, and how to dismiss one. */
function subscriptionsText(read: MonthSubscriptionsRead): string {
  const header = `Subscriptions of ${read.month}, detected from the user's expenses up to ${read.asOf}.`;

  const recurring =
    read.recurring.length === 0
      ? ["No recurring payment detected."]
      : [
          `Recurring payments (${read.recurring.length}; merchant: rhythm, usual price; last paid; next expected):`,
          ...read.recurring.map(
            (each) =>
              `- ${each.merchant}: ${CADENCES[each.cadence]}, usually ${money(each.usualMinor, each.currency)}; last paid ${each.lastOn}, ${money(each.lastMinor, each.currency)}; next expected ${each.nextOn}.`,
          ),
        ];

  const stopped =
    read.stopped.length === 0
      ? []
      : [
          `Stopped (${read.stopped.length}; the expected payment did not come):`,
          ...read.stopped.map(
            (each) =>
              `- ${each.merchant}: ${CADENCES[each.cadence]}, expected ${each.stoppedOn ?? each.nextOn}, did not come; last paid ${each.lastOn}, ${money(each.lastMinor, each.currency)}.`,
          ),
        ];

  const rises =
    read.rises.length === 0
      ? []
      : [
          `Price rises (${read.rises.length}):`,
          ...read.rises.flatMap((each) =>
            each.priceRise === null
              ? []
              : [
                  `- ${each.merchant}: from ${money(each.priceRise.fromMinor, each.currency)} to ${money(each.priceRise.toMinor, each.currency)}.`,
                ],
          ),
        ];

  const [first] = [...read.recurring, ...read.stopped];

  const dismiss = `A merchant whose payments are no subscription is never proposed again with merchants ${JSON.stringify({ action: "edit", merchant: first?.merchant ?? "Streamly", subscription: false })}; subscription true proposes it again.`;

  return [header, recurring.join("\n"), stopped.join("\n"), rises.join("\n"), dismiss]
    .filter((part) => part !== "")
    .join("\n\n");
}

function subscriptions(owner: string, input: MonthInput) {
  return Effect.gen(function* () {
    const month = input.month ?? (yield* currentMonth);

    return subscriptionsText(yield* monthSubscriptions(owner, month));
  }).pipe(
    Effect.catchTags({
      FutureMonthRefused: (refused) =>
        Effect.fail(
          new ToolRefusal({
            message: `${refused.month} is a month to come: subscriptions are detected from what was paid up to today. Ask for ${refused.current} or a month before it.`,
            example: `month ${JSON.stringify({ action: "subscriptions", month: refused.current } satisfies Encoded)}`,
          }),
        ),
      QueryFailed: Effect.die,
    }),
  );
}

function benchmarkText(row: { readonly benchmark: MonthBenchmark }): string {
  switch (row.benchmark.mode) {
    case "automatic": {
      return row.benchmark.amount === null
        ? "benchmark: none yet (automatic, nothing spent in it in those months)"
        : `benchmark ${amount(row.benchmark.amount)} (automatic)`;
    }

    case "fixed": {
      return `benchmark ${amount(row.benchmark.amount)} (set)`;
    }

    case "none": {
      return "no benchmark";
    }
  }
}

/** How far above its benchmark a drifting row is. */
function aboveText(row: Pick<CategoryInMonth, "spent" | "benchmark">): string {
  const mark = row.benchmark.mode === "none" ? null : row.benchmark.amount;

  return mark === null
    ? ""
    : `${amount({ minor: row.spent.minor - mark.minor, currency: mark.currency })} above`;
}

function rowText(row: CategoryInMonth, indent: string): string {
  const archived = row.archived ? " (archived)" : "";

  const elsewhere =
    row.elsewhere.length === 0
      ? ""
      : `, and ${row.elsewhere.map(amount).join(" + ")} in another currency, not compared`;

  const drifts = row.drifts ? `; DRIFTS, ${aboveText(row)}` : "";

  return `${indent}- ${row.name}${archived}: spent ${amount(row.spent)}${elsewhere}; ${benchmarkText(row)}${drifts}`;
}

const pathOf = (row: CategoryInMonth, all: ReadonlyArray<CategoryInMonth>) => {
  const parent = all.find((each) => each.id === row.parentId);

  return parent === undefined ? row.name : `${parent.name} > ${row.name}`;
};

function benchmarksText(result: MonthBenchmarks): string {
  const averaged =
    result.monthsAveraged === 0
      ? `no automatic benchmark can be read yet: no full month from ${result.averageFrom} to ${result.averageTo} holds the user's data`
      : `automatic benchmarks average ${result.monthsAveraged} month(s) of ${result.averageFrom} to ${result.averageTo}, from the user's first entry on`;

  const drifting =
    result.drifting.length === 0
      ? "Nothing drifts above its benchmark."
      : `Drifting above their benchmark: ${result.drifting.map((row) => `${pathOf(row, result.categories)} (${amount(row.spent)}, ${aboveText(row)})`).join(", ")}.`;

  const rows = result.categories.flatMap((top) => [
    rowText(top, ""),
    ...top.children.map((child) => rowText(child, "  ")),
  ]);

  return [
    `Benchmarks of ${result.month}, in ${result.currency}: ${averaged}. A category drifts when it spent more than its benchmark; a top-level category counts its children's spending.`,
    drifting,
    rows.length === 0
      ? "The user has no expense category."
      : `Expense categories (children indented):\n${rows.join("\n")}`,
  ].join("\n\n");
}

const benchmarks = (input: MonthInput, owner: string, currency: string) =>
  Effect.gen(function* () {
    const month = input.month ?? (yield* currentMonth);

    return benchmarksText(yield* monthBenchmarks(owner, month, currency));
  }).pipe(Effect.catchTag("QueryFailed", Effect.die));

/** A month to come, refused with a valid call of the same action. */
const toCome = (input: MonthInput) => (refused: FutureMonthRefused) =>
  Effect.fail(
    new ToolRefusal({
      message: `${refused.month} is a month to come: a month's figures are read from what happened up to today. Ask for ${refused.current} or a month before it.`,
      example: `month ${JSON.stringify({ ...input, month: refused.current } satisfies Encoded)}`,
    }),
  );

/** What a month is held against, in words. */
function againstText(read: MonthSpending | SubjectSpendingRead | MonthReview["summary"]): string {
  const average =
    read.monthsAveraged === 0
      ? `no average yet: no full month of the user's data from ${read.averageFrom} to ${read.averageTo}`
      : `averages over ${read.monthsAveraged} month(s) of ${read.averageFrom} to ${read.averageTo}`;

  const previous = read.previousCounted
    ? `the previous month is ${read.previousMonth}`
    : `no previous month: ${read.previousMonth} is before the user's data`;

  return `${average}; ${previous}`;
}

/** A row's spending, against its average and the previous month. */
function figuresText(row: CategorySpending | MerchantSpending | SubjectSpending): string {
  const elsewhere =
    row.elsewhere.length === 0
      ? ""
      : `, and ${row.elsewhere.map(amount).join(" + ")} in another currency, not compared`;

  const average = row.average === null ? "" : `; average ${amount(row.average)}`;
  const previous = row.previous === null ? "" : `; previous month ${amount(row.previous)}`;

  return `spent ${amount(row.spent)}${elsewhere}${average}${previous}`;
}

function flagText(flag: MonthFlag): string {
  switch (flag.kind) {
    case "drift": {
      return `${flag.name} drifts above its benchmark: spent ${amount(flag.spent)}, benchmark ${amount(flag.benchmark)}.`;
    }

    case "price-rise": {
      return `${flag.merchant}'s price rose from ${amount(flag.from)} to ${amount(flag.to)}.`;
    }

    case "stopped": {
      return `${flag.merchant} stopped: expected ${flag.expectedOn}, did not come; last paid ${flag.lastOn}, ${amount(flag.last)}.`;
    }

    case "expiring": {
      return `${flag.account}: ${amount(flag.amount)} of benefit credits expire on ${flag.day}.`;
    }

    case "not-imported": {
      return flag.reached === null
        ? `${flag.account}: no statement imported.`
        : `${flag.account}: its statements reach ${flag.reached} only.`;
    }
  }
}

const nonEmpty = (parts: ReadonlyArray<string>) => parts.filter((part) => part !== "");

/** The figures of the month: received, spent, set aside, left, the other currencies apart. */
function figuresOf(summary: MonthReview["summary"]): string {
  const from =
    summary.receivedFrom.length === 0
      ? ""
      : `, from ${summary.receivedFrom.map((each) => `${each.name} ${amount(each.amount)}`).join(", ")}`;

  const average =
    summary.averageSpent === null ? "no average yet" : `average ${amount(summary.averageSpent)}`;

  const previous =
    summary.previousSpent === null
      ? "no previous month"
      : `previous month ${amount(summary.previousSpent)}`;

  const restricted =
    summary.restricted.minor === 0
      ? ""
      : `, of which ${amount(summary.restricted)} restricted, on benefit accounts`;

  const elsewhere =
    summary.elsewhere.length === 0
      ? ""
      : `In other currencies, never converted: ${summary.elsewhere.map((each) => `${each.currency}: received ${amount(each.received)}, spent ${amount(each.spent)}, set aside ${amount(each.setAside)}, left ${amount(each.left)}`).join("; ")}.`;

  return nonEmpty([
    `Received ${amount(summary.received)}${from}.`,
    `Spent ${amount(summary.spent)}; ${average}; ${previous}.`,
    `Set aside ${amount(summary.setAside)} (net, onto savings and investment accounts).`,
    `Left ${amount(summary.left)}${restricted}.`,
    elsewhere,
  ]).join("\n");
}

function movementsOf(review: MonthReview): string {
  const { movements } = review.movements;

  if (movements.length === 0) {
    return "No income and no transfer came in this month.";
  }

  const shown = movements.slice(0, MOVEMENTS_LISTED);
  const search = { action: "search", from: `${review.month}-01`, to: review.linesToReview.to };

  const more =
    movements.length > shown.length
      ? [
          `And ${movements.length - shown.length} more: read the month's lines with lines ${JSON.stringify(search)}.`,
        ]
      : [];

  return [
    `Incomes and transfers in (${movements.length}, oldest first):`,
    ...shown.map((each) => {
      const note = each.note === null ? "" : ` (${each.note})`;

      return `- ${each.day}, ${each.kind}: ${each.from} → ${each.to}, ${amount(each.amount)}${note}`;
    }),
    ...more,
  ].join("\n");
}

function toReviewOf(review: MonthReview): string {
  const { linesToReview } = review;

  if (linesToReview.count === 0) {
    return "No line of the month waits to be reviewed.";
  }

  return [
    `Lines to review: ${linesToReview.count} booked in the month; the newest:`,
    ...linesToReview.lines.map((line) => {
      const category =
        line.category === null
          ? ""
          : `, in ${line.category.parentName === null ? "" : `${line.category.parentName} > `}${line.category.name}`;

      return `- ${line.day}, ${line.account.name}: "${line.label}", ${amount(line.amount)}${category}`;
    }),
    // `review list` takes no period: it gives every month's lines to review, newest first.
    `List them with their proposals, to accept or correct each: review ${JSON.stringify({ action: "list" })} (every month's, newest first).`,
  ].join("\n");
}

function importedOf(review: MonthReview): string {
  const state = review.importState;

  if (state.accounts === 0) {
    return "Imported: no account that expects statements was open in the month; one kept by hand, never imported, expects none.";
  }

  return [
    `Imported: ${state.imported} of ${state.accounts} account(s) have statements reaching ${state.expected}.`,
    ...state.partial.map(
      (each) =>
        `- ${each.account}: ${each.reached === null ? "no statement imported" : `reaches ${each.reached}`}.`,
    ),
  ].join("\n");
}

function summaryText(review: MonthReview): string {
  const { flags } = review.flags;

  const flagged =
    flags.length === 0
      ? "Nothing flagged."
      : [`Flagged (${flags.length}):`, ...flags.map((flag) => `- ${flagText(flag)}`)].join("\n");

  return [
    `The month ${review.month}, in ${review.currency}, read on ${review.today}: ${againstText(review.summary)}.`,
    figuresOf(review.summary),
    movementsOf(review),
    toReviewOf(review),
    importedOf(review),
    flagged,
    `Where the money went: month ${JSON.stringify({ action: "spending", month: review.month })}, or by merchant.`,
  ].join("\n\n");
}

/** Nothing spent, and nothing to hold it against: left out of the list. */
const quiet = (row: CategorySpending) =>
  row.spent.minor === 0 &&
  row.elsewhere.length === 0 &&
  (row.previous?.minor ?? 0) === 0 &&
  (row.average?.minor ?? 0) === 0;

function categoryLine(row: CategorySpending, indent: string): string {
  const archived = row.archived ? " (archived)" : "";
  const drifts = row.drifts ? `; DRIFTS, ${aboveText(row)}` : "";

  return `${indent}- ${row.name}${archived}: ${figuresText(row)}; ${benchmarkText(row)}${drifts}`;
}

function categoriesText(rows: ReadonlyArray<CategorySpending>): ReadonlyArray<string> {
  let leftOut = 0;
  const lines: Array<string> = [];

  for (const top of rows) {
    const children = top.children.filter((child) => !quiet(child));

    leftOut += top.children.length - children.length;

    if (quiet(top) && children.length === 0) {
      leftOut += 1;
    } else {
      lines.push(categoryLine(top, ""), ...children.map((child) => categoryLine(child, "  ")));
    }
  }

  return [
    lines.length === 0
      ? "Nothing was spent in these months."
      : `Expense categories, the largest first (children indented; a top-level category counts its children's spending; a category drifts when it spent more than its benchmark):\n${lines.join("\n")}`,
    leftOut === 0
      ? ""
      : `${leftOut} categor${leftOut === 1 ? "y" : "ies"} with nothing spent in these months left out.`,
  ];
}

function merchantLine(row: MerchantSpending): string {
  const intermediary = row.intermediary
    ? " (a payment intermediary: who was paid behind it is not known)"
    : "";

  return `- ${row.name ?? NO_MERCHANT}${intermediary}: ${figuresText(row)}`;
}

function merchantsText(read: MonthSpending, rows: ReadonlyArray<MerchantSpending>) {
  const named = rows.filter((row) => row.id !== null);
  const listed = named.slice(0, MERCHANTS_LISTED);
  const rest = named.slice(MERCHANTS_LISTED);
  const none = rows.find((row) => row.id === null);
  const search = { action: "search", from: `${read.month}-01`, to: lastDayOf(read.month) };
  const restMinor = rest.reduce((sum, row) => sum + row.spent.minor, 0);

  return [
    named.length === 0 && none === undefined ? "Nothing was spent in the month." : "",
    listed.length === 0
      ? ""
      : `Merchants, the largest first:\n${listed.map(merchantLine).join("\n")}`,
    rest.length === 0
      ? ""
      : `And ${rest.length} more merchants, ${amount({ minor: restMinor, currency: read.currency })} in all, each ${amount(rest[0]?.spent ?? { minor: 0, currency: read.currency })} or less: read their lines with lines ${JSON.stringify(search)}.`,
    none === undefined ? "" : `${merchantLine(none)} (expenses naming several merchants, or none)`,
  ];
}

/** Each row of `spending` by the name `days` takes, children as "Parent > Child". */
function namedRows(read: MonthSpending): ReadonlyArray<{ id: string | null; name: string }> {
  return read.by === "category"
    ? read.rows.flatMap((top) => [
        { id: top.id, name: top.name },
        ...top.children.map((child) => ({ id: child.id, name: `${top.name} > ${child.name}` })),
      ])
    : read.rows.map((row) => ({ id: row.id, name: row.name ?? NO_MERCHANT }));
}

function spendingText(read: MonthSpending): string {
  const [first] = namedRows(read);

  const rows = read.by === "category" ? categoriesText(read.rows) : merchantsText(read, read.rows);

  const daysCall = {
    action: "days",
    by: read.by,
    name: first?.name ?? "Groceries",
    month: read.month,
  };

  return nonEmpty([
    `Where the money went in ${read.month}, by ${read.by}, in ${read.currency}, each at its net cost: ${againstText(read)}.`,
    ...rows,
    `One row day by day: month ${JSON.stringify(daysCall)}.`,
  ]).join("\n\n");
}

/** Each row of `spending` by subject by its path, the name `days` takes. */
const subjectRows = (read: SubjectSpendingRead) =>
  read.rows.map((row) => ({ id: row.id, name: subjectPathOf(read.rows, row.id) }));

function subjectSpendingText(read: SubjectSpendingRead): string {
  const [first] = subjectRows(read);

  const lines = read.rows.map(
    (row) =>
      `- ${subjectPathOf(read.rows, row.id)}${row.archived ? " (archived)" : ""}: ${figuresText(row)}`,
  );

  return nonEmpty([
    `Where the money went in ${read.month}, by subject, in ${read.currency}, each at its net cost: ${againstText(read)}.`,
    lines.length === 0
      ? "No expense of the month is attached to a subject."
      : `Subjects with an expense in the month, by path, each parent before its children. A parent counts its children's expenses with its own, each once; an expense on several subjects counts whole in each, and most have none: these rows never add up, nor make the month's spending.\n${lines.join("\n")}`,
    first === undefined
      ? ""
      : `One row day by day: month ${JSON.stringify({ action: "days", by: "subject", name: first.name, month: read.month } satisfies Encoded)}.`,
  ]).join("\n\n");
}

function daysText(read: SpendingDays, name: string): string {
  const inCurrency = (minor: number) => money(minor, read.currency);
  const lines: Array<string> = [];
  let firstToCome: string | null = null;

  for (const day of read.days) {
    if (day.current === null) {
      firstToCome ??= day.date;
    } else {
      const previous = day.previous === null ? "" : `; previous month ${inCurrency(day.previous)}`;

      lines.push(`${day.date}: ${inCurrency(day.current)}${previous}`);
    }
  }

  return nonEmpty([
    `${name} (${read.by}) in ${read.month}, in ${read.currency}: its spending as a running total, day by day, against the previous month's on the same day.`,
    lines.join("\n"),
    firstToCome === null ? "" : `From ${firstToCome} on: days to come.`,
  ]).join("\n\n");
}

/** Names as `days` compares them: any case, one space around ">". */
const comparable = (name: string) =>
  name
    .split(">")
    .map((part) => part.trim().replaceAll(/\s+/g, " ").toLowerCase())
    .join(" > ");

const summary = (input: MonthInput, owner: string, currency: string) =>
  Effect.gen(function* () {
    const month = input.month ?? (yield* currentMonth);

    return summaryText(yield* monthReview(owner, month, currency));
  }).pipe(Effect.catchTags({ FutureMonthRefused: toCome(input), QueryFailed: Effect.die }));

const spending = (input: MonthInput, owner: string, currency: string) =>
  Effect.gen(function* () {
    const month = input.month ?? (yield* currentMonth);

    const by = input.by ?? "category";

    return by === "subject"
      ? subjectSpendingText(yield* monthSubjectSpending(owner, month, currency))
      : spendingText(yield* monthSpending(owner, month, currency, by));
  }).pipe(Effect.catchTags({ FutureMonthRefused: toCome(input), QueryFailed: Effect.die }));

const days = (input: MonthInput, owner: string, currency: string) =>
  Effect.gen(function* () {
    const month = input.month ?? (yield* currentMonth);
    const by = input.by ?? "category";
    const wanted = comparable(input.name ?? "");

    if (wanted === "") {
      return yield* new ToolRefusal({
        message: `days needs name: a row of month spending by ${by}, as it names it.`,
        example: `month ${JSON.stringify({ action: "days", by, name: "Groceries" } satisfies Encoded)}`,
      });
    }

    const rows =
      by === "subject"
        ? subjectRows(yield* monthSubjectSpending(owner, month, currency))
        : namedRows(yield* monthSpending(owner, month, currency, by));

    const found = rows.find((row) => comparable(row.name) === wanted);

    if (found === undefined) {
      const names = rows.slice(0, 30).map((row) => row.name);
      const [first = FALLBACK_ROWS[by]] = names;

      return yield* new ToolRefusal({
        message: `No row of ${month} by ${by} is named "${input.name ?? ""}". ${names.length === 0 ? "The month has none." : `Its rows: ${names.join(", ")}${rows.length > names.length ? ", … (month spending lists them all)" : ""}.`}`,
        example: `month ${JSON.stringify({ action: "days", by, name: first, month } satisfies Encoded)}`,
      });
    }

    return daysText(yield* spendingDays(owner, month, currency, by, found.id), found.name);
  }).pipe(Effect.catchTags({ FutureMonthRefused: toCome(input), QueryFailed: Effect.die }));

/** The month family (docs/mcp.md, "Tools"): the monthly review, read from the user's own data. */
export const monthTool = defineTool<
  MonthInput,
  Encoded,
  // The summary's lines to review are #35's queue, whose proposals read transfers, refunds, merchants.
  Subscriptions | CategoryStore | MonthFacts | LineStore | Transfers | Expenses | Merchants
>({
  name: "month",
  title: "Monthly review (summary, spending, days, subscriptions, benchmarks)",
  description: DESCRIPTION,
  idempotent: true,
  input: MonthInput,
  example: { action: "subscriptions" },
  access: {
    summary: "read",
    spending: "read",
    days: "read",
    subscriptions: "read",
    benchmarks: "read",
  },
  run: (input, caller) => {
    switch (input.action) {
      case "summary": {
        return summary(input, caller.userId, benchmarkCurrency(caller));
      }

      case "spending": {
        return spending(input, caller.userId, benchmarkCurrency(caller));
      }

      case "days": {
        return days(input, caller.userId, benchmarkCurrency(caller));
      }

      case "subscriptions": {
        return subscriptions(caller.userId, input);
      }

      case "benchmarks": {
        return benchmarks(input, caller.userId, benchmarkCurrency(caller));
      }
    }
  },
});
