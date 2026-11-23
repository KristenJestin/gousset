import {
  Month,
  SpendingGroup,
  addMonths,
  currentMonth,
  flags,
  importState,
  investments,
  linesToReview,
  monthOverview,
  monthSummary,
  movements,
  spending,
  spendingDays,
} from "@gousset/core";
import type {
  Flag,
  Flags,
  ImportState,
  Investments,
  Ledger,
  LinesToReview,
  Money,
  MonthOutOfRange,
  MonthOverview,
  MonthSummary,
  Movements,
  Spending,
  SpendingDays,
} from "@gousset/core";
import { Effect, Schema } from "effect";

import { ToolRefusal, defineTool } from "../tool";

const MonthInput = Schema.Struct({
  action: Schema.Literals(["summary", "review", "days"]).annotate({
    description:
      "summary: the month's figures and where its money went. review: what is left to check in the month (imports, lines to review, movements, investments, flags). days: one row of summary, day by day, against the month before.",
  }),
  month: Schema.optional(
    Month.annotate({ description: "The month, YYYY-MM (2026-10); the current month if left out." }),
  ),
  by: Schema.optional(
    SpendingGroup.annotate({
      description: "days only: the grouping the row belongs to, as summary groups them.",
    }),
  ),
  row: Schema.optional(
    Schema.String.annotate({
      description: 'days only: the row\'s name, exactly as summary lists it ("Groceries").',
    }),
  ),
});

const DAYS_EXAMPLE = `month ${JSON.stringify({ action: "days", month: "2026-10", by: "category", row: "Groceries" })}`;

const DESCRIPTION = `One month of the user's money, as the monthly review shows it. Three actions, all read only.

summary: what came in (received, and from what), what the expenses cost (spent, against the average of the six months before), what went to savings and investments (set aside) and what is left, with the part of it restricted to benefit accounts; then where the money went, by category, by merchant and by subject, the largest first, each row with its benchmark (its own 6-month average). Expenses whose lines still wait in the review are not in the rows yet: their total is given apart. Use it for "how much did I spend last month, and where?" and any question about a month's totals.

review: what the month still asks of the user: how far its statements were imported, the lines the rules were not sure of (with what they proposed), the movements between the user's accounts and what came in, the investment accounts at the end of the month (today in the month under way), and what is flagged (a subscription whose price changed, an account not imported). Use it for "what is left to check this month?".

days: one row of summary (by category, merchant or subject, named by \`by\` and \`row\`, both required) day by day: what it had cost by each day of the month, against what it had cost by the same day of the month before. Approved expenses only, as the row counts them. A row that summary lists neither in the month nor in the month before is refused, with the month's rows. Use it for "how did my Groceries spending go this month compared with last month?".

\`month\` is written YYYY-MM and is the current month when left out; for last month, work it out from today (in November 2026, last month is 2026-10). A month written another way is refused.

In this version of Gousset every figure comes from made-up example data, and the result says so.

Examples: {"action":"summary","month":"2026-10"}, {"action":"review","month":"2026-10"}, {"action":"days","month":"2026-10","by":"category","row":"Groceries"}`;

/** `1,234.56 EUR`: amounts are kept in minor units and shown with their currency. */
function amount(money: Money): string {
  const units = (money.minor / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return `${units} ${money.currency}`;
}

/** `October 2026` (a month is read within ten years of today: never a year under 100). */
function monthName(month: string): string {
  const [year = 0, number = 1] = month.split("-").map(Number);

  return new Date(Date.UTC(year, number - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The first line of every answer: the month, and that its data is made up when it is. */
const heading = (month: string, madeUp: boolean) =>
  madeUp
    ? `${monthName(month)}, made-up data: this version of Gousset shows example figures, not the user's own.`
    : monthName(month);

/** "Salary and Meal vouchers", "A, B and C". */
const listed = (names: ReadonlyArray<string>) =>
  names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;

function figures(summary: MonthSummary): string {
  const received =
    summary.receivedFrom.length === 0
      ? `Received: ${amount(summary.received)}`
      : `Received: ${amount(summary.received)}, from ${listed(summary.receivedFrom)}`;

  const spent =
    summary.averageSpent === null
      ? `Spent: ${amount(summary.spent)}`
      : `Spent: ${amount(summary.spent)} (6-month average: ${amount(summary.averageSpent)})`;

  const left =
    summary.restricted.minor > 0
      ? `Left: ${amount(summary.left)}, of which ${amount(summary.restricted)} restricted on benefit accounts`
      : `Left: ${amount(summary.left)}`;

  return [received, spent, `Set aside: ${amount(summary.setAside)}`, left].join("\n");
}

/** A grouping's rows, then what still waits in the review; exported for its tests. */
export function breakdown(title: string, spending: Spending): string {
  const rows = spending.rows.map((row) =>
    row.benchmark === null
      ? `- ${row.name}: ${amount(row.amount)}`
      : `- ${row.name}: ${amount(row.amount)} (benchmark ${amount(row.benchmark)})`,
  );

  const pending =
    spending.pending.minor > 0
      ? [`Not counted above until its lines are reviewed: ${amount(spending.pending)}.`]
      : [];

  if (rows.length === 0) {
    return pending.length === 0
      ? `${title} nothing spent.`
      : [`${title} nothing reviewed yet.`, ...pending].join("\n");
  }

  return [title, ...rows, ...pending].join("\n");
}

/** The overview, in Gousset's words: the figures first, then where the money went. */
function summaryText({ summary, byCategory, byMerchant, bySubject }: MonthOverview): string {
  return [
    heading(summary.month, summary.madeUp),
    figures(summary),
    breakdown("By category:", byCategory),
    breakdown("By merchant:", byMerchant),
    breakdown("By subject (an expense counts in full in each of its subjects):", bySubject),
  ].join("\n\n");
}

function importsText(imports: ImportState): string {
  const state = `Imports: ${imports.imported} of ${imports.accounts} accounts imported`;

  if (imports.partial.length === 0) {
    return `${state}.`;
  }

  return `${state}; ${imports.partial.map((partial) => `${partial.account} only up to ${partial.coveredTo}`).join("; ")}.`;
}

function linesText(waiting: LinesToReview): string {
  if (waiting.count === 0) {
    return "Lines to review: none.";
  }

  return [
    `Lines to review (${waiting.count}):`,
    ...waiting.lines.map((line) => {
      const proposed = [
        line.merchant === null ? [] : [`merchant ${line.merchant}`],
        line.category === null ? [] : [`category ${line.category}`],
      ].flat();

      const rules = proposed.length === 0 ? "nothing proposed" : `proposed ${proposed.join(", ")}`;

      return `- ${line.bookedOn} ${line.label}: ${amount(line.amount)} on ${line.account}; ${rules}`;
    }),
  ].join("\n");
}

function movementsText({ movements: moved }: Movements): string {
  if (moved.length === 0) {
    return "Movements: none.";
  }

  return [
    "Movements (what came in, and what moved between the user's own accounts; never an expense):",
    ...moved.map((movement) => {
      const note = movement.note === null ? "" : ` (${movement.note})`;

      const bought =
        movement.bought === null
          ? ""
          : `, then ${movement.bought.name} bought for ${amount(movement.bought.amount)}`;

      return `- ${movement.bookedOn} ${movement.from} → ${movement.to}: ${amount(movement.amount)}${note}${bought}`;
    }),
  ].join("\n");
}

function investmentsText({ asOf, accounts }: Investments): string {
  if (accounts.length === 0) {
    return "Investments: none.";
  }

  return [
    `Investments, on ${asOf}:`,
    ...accounts.map(
      (account) =>
        `- ${account.account}: worth ${amount(account.value)}, put in ${amount(account.netContributions)}, gain ${amount(account.gain)}`,
    ),
  ].join("\n");
}

function flagText(flag: Flag): string {
  switch (flag.kind) {
    case "price-change": {
      return `- ${flag.merchant}: its price went from ${amount(flag.before)} to ${amount(flag.now)}.`;
    }

    case "not-imported": {
      return `- ${flag.account}: its statement stops on ${flag.coveredTo}; import the rest of the month.`;
    }
  }
}

function flagsText({ flags: flagged }: Flags): string {
  return flagged.length === 0
    ? "Flagged: nothing."
    : ["Flagged:", ...flagged.map(flagText)].join("\n");
}

/** The review's other blocks, in the order of the screen's: imports, lines, movements, the rest. */
const reviewText = (
  summary: MonthSummary,
  parts: readonly [ImportState, LinesToReview, Movements, Investments, Flags],
) =>
  [
    heading(summary.month, summary.madeUp),
    importsText(parts[0]),
    linesText(parts[1]),
    movementsText(parts[2]),
    investmentsText(parts[3]),
    flagsText(parts[4]),
  ].join("\n\n");

/** `29th`, `30th`, `31st`: the only days a month before may not have. */
const ordinal = (day: number) => (day === 31 ? "31st" : `${day}th`);

/** A row day by day: its running total, then the month before's by the same day. */
function daysText(madeUp: boolean, { month, by, name, currency, days }: SpendingDays): string {
  const before = monthName(addMonths(month, -1));
  const sum = (minor: number) => amount({ minor, currency });

  const lines = days.map(({ date, current, previous }) => {
    const day = Number(date.slice(8, 10));

    const then =
      previous !== null
        ? sum(previous)
        : day > 28
          ? `nothing (${before} has no ${ordinal(day)})`
          : `nothing (${before} is outside the months Gousset reads)`;

    return `- ${date}: ${current === null ? "not yet" : sum(current)}, against ${then}`;
  });

  return [
    heading(month, madeUp),
    [
      `${name}, by ${by}, day by day in ${monthName(month)}: what it had cost by each day, against what it had cost by the same day of ${before}. Approved expenses only, as the row counts them: lines still waiting in the review are not counted yet.`,
      ...lines,
    ].join("\n"),
  ].join("\n\n");
}

/** How many of a month's rows a refused row name lists. */
const ROWS_NAMED = 8;

const daysCall = (month: string, by: SpendingGroup, row: string) =>
  `month ${JSON.stringify({ action: "days", month, by, row })}`;

/**
 * The row a name means among the rows of summary, this month's and the month before's: the one of
 * that very name, or else the only one of that name in another case.
 */
function rowNamed(name: string, rows: ReadonlyArray<string>): string | undefined {
  if (rows.includes(name)) {
    return name;
  }

  const alike = new Set(rows.filter((row) => row.toLowerCase() === name.toLowerCase()));

  return alike.size === 1 ? [...alike][0] : undefined;
}

/** A name summary does not list: refused, naming the month's rows and a call with the first. */
function unknownRow(month: string, by: SpendingGroup, name: string, rows: ReadonlyArray<string>) {
  const before = monthName(addMonths(month, -1));
  const named = rows.slice(0, ROWS_NAMED).join(", ");
  const more = rows.length > ROWS_NAMED ? `, and ${rows.length - ROWS_NAMED} more` : "";

  const listed =
    rows.length === 0
      ? `${monthName(month)} has no row by ${by} yet.`
      : `Its rows by ${by}, the largest first: ${named}${more}.`;

  return new ToolRefusal({
    message: `${JSON.stringify(name)} is not a row by ${by} in the summary of ${monthName(month)}, nor of ${before}. ${listed} Name a row as summary lists it.`,
    example: daysCall(month, by, rows[0] ?? "Groceries"),
  });
}

const exampleOf = (action: "summary" | "review") =>
  `month ${JSON.stringify({ action, month: "2026-10" })}`;

/** A month outside what Gousset reads: refused, saying which months it reads, with a valid call. */
function refusingOutside(example: string) {
  return <A, R>(answer: Effect.Effect<A, MonthOutOfRange, R>): Effect.Effect<A, ToolRefusal, R> =>
    answer.pipe(
      Effect.catchTag("MonthOutOfRange", (outside) =>
        Effect.fail(
          new ToolRefusal({
            message: `Gousset reads months from ${outside.earliest} to ${outside.latest}: ${outside.month} is outside. Ask for a month in that range.`,
            example,
          }),
        ),
      ),
    );
}

/** The month family (docs/mcp.md, "Tools"): v0.1 reads the made-up month. */
export const monthTool = defineTool<typeof MonthInput.Type, typeof MonthInput.Encoded, Ledger>({
  name: "month",
  title: "Month summary and review",
  description: DESCRIPTION,
  idempotent: true,
  input: MonthInput,
  example: { action: "summary", month: "2026-10" },
  access: { summary: "read", review: "read", days: "read" },
  run: (input, caller) => {
    const wanted = Effect.gen(function* () {
      return input.month ?? (yield* currentMonth);
    });

    switch (input.action) {
      case "summary": {
        return Effect.gen(function* () {
          const month = yield* wanted;

          return summaryText(yield* monthOverview(caller.userId, month));
        }).pipe(refusingOutside(exampleOf(input.action)));
      }

      case "review": {
        return Effect.gen(function* () {
          const month = yield* wanted;
          const { summary } = yield* monthOverview(caller.userId, month);

          const parts = yield* Effect.all([
            importState(caller.userId, month),
            linesToReview(caller.userId, month),
            movements(caller.userId, month),
            investments(caller.userId, month),
            flags(caller.userId, month),
          ]);

          return reviewText(summary, parts);
        }).pipe(refusingOutside(exampleOf(input.action)));
      }

      case "days": {
        const { by, row } = input;

        if (by === undefined || row === undefined) {
          return Effect.fail(
            new ToolRefusal({
              message:
                "The days action needs by (category, merchant or subject) and row (the row's name, exactly as summary lists it).",
              example: DAYS_EXAMPLE,
            }),
          );
        }

        return Effect.gen(function* () {
          const month = yield* wanted;

          const [{ madeUp }, { rows }] = yield* Effect.all([
            monthSummary(caller.userId, month),
            spending(caller.userId, month, by),
          ]).pipe(refusingOutside(DAYS_EXAMPLE));

          // The month before may be out of range: then it has no row.
          const before = yield* spending(caller.userId, addMonths(month, -1), by).pipe(
            Effect.map((previous) => previous.rows),
            Effect.catchTag("MonthOutOfRange", () => Effect.succeed([])),
          );

          const names = rows.map((listed) => listed.name);
          const known = rowNamed(row, [...names, ...before.map((listed) => listed.name)]);

          if (known === undefined) {
            return yield* unknownRow(month, by, row, names);
          }

          const days = yield* spendingDays(caller.userId, month, by, known).pipe(
            refusingOutside(DAYS_EXAMPLE),
          );

          return daysText(madeUp, days);
        });
      }
    }
  },
});
