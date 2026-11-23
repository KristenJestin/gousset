import {
  DataExport,
  FixtureLedger,
  Imports,
  Ledger,
  flags,
  importState,
  investments,
  linesToReview,
  monthOverview,
  movements,
  spending,
  spendingDays,
} from "@gousset/core";
import { Effect, Exit, Layer } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, test } from "vite-plus/test";

import { goussetServer } from "../gousset";
import { RESULT_LIMIT } from "../results";
import { breakdown } from "./month";
import { callText, connectInProcess } from "../test-client";
import type { Runner } from "../tool";

const TODAY = "2026-11-22";

/** A ledger, the made-up one by default, on a fixed day, as the app's runtime provides it. */
function onDay(
  day: string,
  ledger: Layer.Layer<Ledger> = FixtureLedger,
): Runner<Ledger | Imports | DataExport> {
  return (effect) =>
    Effect.runPromiseExit(
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse(`${day}T12:00:00Z`));

        return yield* effect;
      }).pipe(
        // month never reaches the imports nor the export.
        Effect.provide(
          Layer.mergeAll(
            ledger,
            Layer.mock(Imports, {}),
            Layer.mock(DataExport, {}),
            TestClock.layer(),
          ),
        ),
      ),
    );
}

const reader = { userId: "ada", canWrite: false };

async function month(
  args: { [key: string]: string },
  day = TODAY,
  ledger: Layer.Layer<Ledger> = FixtureLedger,
) {
  const client = await connectInProcess(
    goussetServer,
    { run: onDay(day, ledger) },
    reader,
    "2025-11-25",
  );

  return callText(client, "month", args);
}

/** What the packages answer, on the test's day. */
async function computed<A, E>(effect: Effect.Effect<A, E, Ledger>) {
  const exit = await onDay(TODAY)(effect);

  if (Exit.isFailure(exit)) {
    throw new Error("The made-up ledger did not answer.");
  }

  return exit.value;
}

/** What the packages compute for the month, in the tool's words (`1,234.56 EUR`). */
const expected = (wanted: string) => computed(monthOverview(reader.userId, wanted));

const euros = (minor: number) =>
  `${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;

describe("month summary", () => {
  test("answers how much was received, spent, set aside and left, from the packages", async () => {
    const { text, isError } = await month({ action: "summary", month: "2026-10" });
    const overview = await expected("2026-10");

    expect(isError).toBe(false);
    expect(text).toContain("October 2026");
    expect(text).toContain(`Received: ${euros(overview.summary.received.minor)}`);
    expect(text).toContain(`Spent: ${euros(overview.summary.spent.minor)}`);
    expect(text).toContain(`Set aside: ${euros(overview.summary.setAside.minor)}`);
    expect(text).toContain(`Left: ${euros(overview.summary.left.minor)}`);
  });

  test("says where the money went, by category and by merchant, the largest first", async () => {
    const { text } = await month({ action: "summary", month: "2026-10" });
    const overview = await expected("2026-10");
    const [topCategory] = overview.byCategory.rows;
    const [topMerchant] = overview.byMerchant.rows;

    expect(text).toContain("By category:");
    expect(text).toContain(`- ${topCategory?.name}: ${euros(topCategory?.amount.minor ?? 0)}`);
    expect(text).toContain("By merchant:");
    expect(text).toContain(`- ${topMerchant?.name}: ${euros(topMerchant?.amount.minor ?? 0)}`);

    for (const row of overview.byCategory.rows) {
      expect(text).toContain(`- ${row.name}: ${euros(row.amount.minor)}`);
    }
  });

  test("refuses a month too far from today, saying which months it reads", async () => {
    const { text, isError } = await month({ action: "summary", month: "0042-03" });

    expect(isError).toBe(true);
    expect(text).toContain("0042-03");
    expect(text).toContain("2016-11");
    expect(text).toContain("2036-11");
    expect(text).toContain('A valid call: month {"action":"summary","month":"2026-10"}');
  });

  test("labels the made-up data as such", async () => {
    const { text } = await month({ action: "summary", month: "2026-10" });

    expect(text).toContain("made-up");
  });

  test("reads the current month when none is given", async () => {
    const { text } = await month({ action: "summary" }, "2026-11-22");

    expect(text).toContain("November 2026");
  });

  test("refuses a month written another way, with a valid call", async () => {
    const { text, isError } = await month({ action: "summary", month: "October" });

    expect(isError).toBe(true);
    expect(text).toContain("YYYY-MM");
    expect(text).toContain('A valid call: month {"action":"summary","month":"2026-10"}');
  });

  test("every month of the made-up data answers in one part, under the limit", async () => {
    // Every month a user reads in v0.1: the year before today, and today's month.
    const months = Array.from({ length: 13 }, (_, index) => {
      const date = new Date(Date.UTC(2025, 10 + index, 1));

      return date.toISOString().slice(0, 7);
    });

    for (const wanted of months) {
      for (const action of ["summary", "review"]) {
        const { text, isError } = await month({ action, month: wanted });

        expect(isError, `${action} ${wanted}`).toBe(false);
        expect(text.length, `${action} ${wanted}`).toBeLessThan(RESULT_LIMIT);
        expect(text, `${action} ${wanted}`).not.toContain("Part 1 of");
      }
    }
  });

  test("says where the money came from, against the six months before, and what is restricted", async () => {
    // A month whose part left sits partly on the meal voucher card.
    const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
    const overviews = await Promise.all(months.map(async (wanted) => expected(wanted)));
    const restricted = overviews.find((overview) => overview.summary.restricted.minor > 0);

    expect(restricted).toBeDefined();

    const summary = restricted?.summary ?? overviews[0]?.summary;

    if (summary === undefined) {
      return;
    }

    const { text } = await month({ action: "summary", month: summary.month });

    expect(text).toContain(
      `Received: ${euros(summary.received.minor)}, from ${summary.receivedFrom.join(" and ")}`,
    );
    expect(text).toContain(
      `Spent: ${euros(summary.spent.minor)} (6-month average: ${euros(summary.averageSpent?.minor ?? 0)})`,
    );
    expect(text).toContain(
      `Left: ${euros(summary.left.minor)}, of which ${euros(summary.restricted.minor)} restricted on benefit accounts`,
    );
  });

  test("gives each row its benchmark, what still waits in the review, and the subjects", async () => {
    const { text } = await month({ action: "summary", month: "2026-10" });
    const { byCategory, bySubject } = await expected("2026-10");
    const benchmarked = byCategory.rows.find((row) => row.benchmark !== null);

    expect(text).toContain(
      `- ${benchmarked?.name}: ${euros(benchmarked?.amount.minor ?? 0)} (benchmark ${euros(benchmarked?.benchmark?.minor ?? 0)})`,
    );
    expect(byCategory.pending.minor).toBeGreaterThan(0);
    expect(text).toContain(
      `Not counted above until its lines are reviewed: ${euros(byCategory.pending.minor)}.`,
    );
    expect(text).toContain("By subject");

    for (const row of bySubject.rows) {
      expect(text).toContain(`- ${row.name}: ${euros(row.amount.minor)}`);
    }
  });
});

describe("an empty grouping", () => {
  const empty = {
    month: "2026-10",
    by: "subject" as const,
    rows: [],
    pending: { minor: 0, currency: "EUR" },
    total: { minor: 0, currency: "EUR" },
  };

  test("says nothing was spent when nothing waits either", () => {
    expect(breakdown("By subject:", empty)).toBe("By subject: nothing spent.");
  });

  test("says nothing is reviewed yet when something waits", () => {
    expect(breakdown("By subject:", { ...empty, pending: { minor: 4146, currency: "EUR" } })).toBe(
      "By subject: nothing reviewed yet.\nNot counted above until its lines are reviewed: 41.46 EUR.",
    );
  });
});

describe("month review", () => {
  const OCTOBER = "2026-10";

  test("refuses a month too far from today with a valid call of the same action", async () => {
    const { text, isError } = await month({ action: "review", month: "0042-03" });

    expect(isError).toBe(true);
    expect(text).toContain('A valid call: month {"action":"review","month":"2026-10"}');
  });

  test("tells the imports, the lines to review, the movements, the investments and the flags", async () => {
    const { text, isError } = await month({ action: "review", month: OCTOBER });
    const user = reader.userId;
    const imports = await computed(importState(user, OCTOBER));
    const waiting = await computed(linesToReview(user, OCTOBER));
    const moved = await computed(movements(user, OCTOBER));
    const invested = await computed(investments(user, OCTOBER));
    const flagged = await computed(flags(user, OCTOBER));

    expect(isError).toBe(false);
    expect(text).toContain("October 2026, made-up data");
    expect(text).toContain(`Imports: ${imports.imported} of ${imports.accounts} accounts imported`);
    expect(text).toContain(`Lines to review (${waiting.count}):`);

    for (const line of waiting.lines) {
      expect(text).toContain(`${line.bookedOn} ${line.label}: ${euros(line.amount.minor)}`);
    }

    for (const movement of moved.movements) {
      expect(text).toContain(`${movement.from} → ${movement.to}: ${euros(movement.amount.minor)}`);
    }

    expect(text).toContain("Investments, on 2026-10-31:");

    for (const account of invested.accounts) {
      expect(text).toContain(
        `- ${account.account}: worth ${euros(account.value.minor)}, put in ${euros(account.netContributions.minor)}`,
      );
    }

    expect(flagged.flags.length).toBeGreaterThan(0);
    expect(text).toContain("Streamly: its price went from 8.99 EUR to 9.49 EUR.");
  });

  test("gives the investments as they stand today in the month under way", async () => {
    const { text } = await month({ action: "review", month: "2026-11" });

    expect(text).toContain(`Investments, on ${TODAY}:`);
  });

  test("names accounts and merchants, never an id", async () => {
    const { text } = await month({ action: "review", month: OCTOBER });
    const waiting = await computed(linesToReview(reader.userId, OCTOBER));

    for (const line of waiting.lines) {
      expect(text).not.toContain(line.id);
    }
  });

  test("pages a month with hundreds of lines to review, the next call written in each part", async () => {
    const many = Array.from({ length: 400 }, (_, index) => ({
      id: `${OCTOBER}-x${index}`,
      accountId: "current",
      bookedOn: `${OCTOBER}-20`,
      amountMinor: -1000,
      label: `CB CORNER SHOP ${index}`,
      kind: "expense" as const,
      merchant: null,
      category: null,
      counterpartLineId: null,
      reviewed: false,
    }));

    // The made-up ledger, October given 400 more lines the rules were not sure of.
    const crowded = Layer.effect(
      Ledger,
      Effect.gen(function* () {
        const made = yield* Ledger;

        return {
          month: (owner: string, wanted: string) =>
            Effect.map(made.month(owner, wanted), (data) =>
              wanted === OCTOBER ? { ...data, lines: [...data.lines, ...many] } : data,
            ),
          markReviewed: made.markReviewed,
        };
      }),
    ).pipe(Layer.provide(FixtureLedger));

    const first = await month({ action: "review", month: OCTOBER }, TODAY, crowded);

    expect(first.isError).toBe(false);
    expect(first.text.length).toBeLessThanOrEqual(RESULT_LIMIT);
    expect(first.text).toContain(
      `Read on with: month {"action":"review","month":"${OCTOBER}","cursor":"2"})`,
    );

    const parts = [first.text];

    for (let part = 2; !(parts.at(-1) ?? "").includes(", the last.)"); part++) {
      const next = await month(
        { action: "review", month: OCTOBER, cursor: String(part) },
        TODAY,
        crowded,
      );

      expect(next.isError).toBe(false);
      expect(next.text.length).toBeLessThanOrEqual(RESULT_LIMIT);
      parts.push(next.text);
    }

    const whole = parts.join("\n");

    expect(parts.length).toBeGreaterThan(1);

    for (const line of many) {
      expect(whole).toContain(`${line.label}: -10.00 EUR on Current account`);
    }

    expect(whole).toContain("Flagged:");
  });
});

describe("month days", () => {
  const OCTOBER = "2026-10";

  test("gives a row's running total by day, against the month before by the same day", async () => {
    const { text, isError } = await month({
      action: "days",
      month: OCTOBER,
      by: "category",
      row: "Housing",
    });

    const { days } = await computed(spendingDays(reader.userId, OCTOBER, "category", "Housing"));

    expect(isError).toBe(false);
    expect(text).toContain("October 2026, made-up data");
    expect(text).toContain("Housing, by category, day by day in October 2026");
    expect(text).toContain("September 2026");
    // The rent is paid on the 5th, every month.
    expect(text).toContain("- 2026-10-05: 690.00 EUR, against 690.00 EUR");

    for (const { date, current, previous } of days) {
      if (current !== null && previous !== null) {
        expect(text).toContain(`- ${date}: ${euros(current)}, against ${euros(previous)}`);
      }
    }

    expect(text).toContain(
      "- 2026-10-31: 690.00 EUR, against nothing (September 2026 has no 31st)",
    );
  });

  test("says a day the month before does not have, and a day not come yet", async () => {
    const { text } = await month({
      action: "days",
      month: "2026-12",
      by: "category",
      row: "Housing",
    });

    const { text: underWay } = await month({
      action: "days",
      month: "2026-11",
      by: "category",
      row: "Housing",
    });

    // November has no 31st; on the 22nd of November, the 23rd has not come.
    expect(text).toContain("- 2026-12-31: not yet, against nothing (November 2026 has no 31st)");
    expect(underWay).toContain("- 2026-11-23: not yet, against 690.00 EUR");
    expect(underWay).toContain("- 2026-11-22: 690.00 EUR, against 690.00 EUR");
  });

  test("reads a row named in another case, when only one row has that name", async () => {
    const { text, isError } = await month({
      action: "days",
      month: OCTOBER,
      by: "category",
      row: "housing",
    });

    expect(isError).toBe(false);
    expect(text).toContain("Housing, by category, day by day in October 2026");
  });

  test("refuses a row the month's summary does not list, naming the rows it has", async () => {
    // A merchant, asked under the categories.
    const { text, isError } = await month({
      action: "days",
      month: OCTOBER,
      by: "category",
      row: "Fuelstop",
    });

    const { rows } = await computed(spending(reader.userId, OCTOBER, "category"));

    expect(isError).toBe(true);
    expect(text).toContain(
      '"Fuelstop" is not a row by category in the summary of October 2026, nor of September 2026.',
    );

    for (const row of rows.slice(0, 8)) {
      expect(text).toContain(row.name);
    }

    expect(text).toContain(
      `A valid call: month {"action":"days","month":"2026-10","by":"category","row":"${rows[0]?.name}"}`,
    );
    expect(text.length).toBeLessThan(2000);
  });

  test("names eight rows at most, and how many more there are", async () => {
    const { text } = await month({
      action: "days",
      month: OCTOBER,
      by: "merchant",
      row: "Nowhere",
    });

    const { rows } = await computed(spending(reader.userId, OCTOBER, "merchant"));

    expect(rows.length).toBeGreaterThan(8);
    expect(text).toContain(`${rows[7]?.name}, and ${rows.length - 8} more.`);
    expect(text).not.toContain(`${rows[8]?.name}`);
  });

  test("refuses a call without its grouping or its row, with a valid call", async () => {
    const calls: ReadonlyArray<{ [key: string]: string }> = [
      { action: "days", month: OCTOBER, by: "category" },
      { action: "days", month: OCTOBER, row: "Housing" },
    ];

    for (const args of calls) {
      const { text, isError } = await month(args);

      expect(isError).toBe(true);
      expect(text).toContain("by (category, merchant or subject) and row");
      expect(text).toContain(
        'A valid call: month {"action":"days","month":"2026-10","by":"category","row":"Groceries"}',
      );
    }
  });

  test("refuses a month too far from today with a valid call of the same action", async () => {
    const { text, isError } = await month({
      action: "days",
      month: "0042-03",
      by: "category",
      row: "Housing",
    });

    expect(isError).toBe(true);
    expect(text).toContain(
      'A valid call: month {"action":"days","month":"2026-10","by":"category","row":"Groceries"}',
    );
  });
});
