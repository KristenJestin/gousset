import {
  FixtureLedger,
  flags,
  importState,
  investments,
  linesToReview,
  monthOverview,
  movements,
} from "@gousset/core";
import type { Ledger } from "@gousset/core";
import { Effect, Exit, Layer } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, test } from "vite-plus/test";

import { goussetServer } from "../gousset";
import { RESULT_LIMIT } from "../results";
import { callText, connectInProcess } from "../test-client";
import type { Runner } from "../tool";

const TODAY = "2026-11-22";

/** The made-up ledger, on a fixed day, as the app's runtime provides it. */
function onDay(day: string): Runner<Ledger> {
  return (effect) =>
    Effect.runPromiseExit(
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse(`${day}T12:00:00Z`));

        return yield* effect;
      }).pipe(Effect.provide(Layer.mergeAll(FixtureLedger, TestClock.layer()))),
    );
}

const reader = { userId: "ada", canWrite: false };

async function month(args: { [key: string]: string }, day = TODAY) {
  const client = await connectInProcess(goussetServer, { run: onDay(day) }, reader, "2025-11-25");

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
    for (const wanted of ["2025-11", "2026-01", "2026-06", "2026-10", "2026-11"]) {
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

describe("month review", () => {
  const OCTOBER = "2026-10";

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

    for (const account of invested.accounts) {
      expect(text).toContain(
        `- ${account.account}: worth ${euros(account.value.minor)}, put in ${euros(account.netContributions.minor)}`,
      );
    }

    expect(flagged.flags.length).toBeGreaterThan(0);
    expect(text).toContain("Streamly: its price went from 8.99 EUR to 9.49 EUR.");
  });

  test("names accounts and merchants, never an id", async () => {
    const { text } = await month({ action: "review", month: OCTOBER });
    const waiting = await computed(linesToReview(reader.userId, OCTOBER));

    for (const line of waiting.lines) {
      expect(text).not.toContain(line.id);
    }
  });
});
