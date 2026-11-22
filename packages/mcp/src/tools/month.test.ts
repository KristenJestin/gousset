import { FixtureLedger, monthOverview } from "@gousset/core";
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

/** What the packages compute for the month, in the tool's words (`1,234.56 EUR`). */
async function expected(wanted: string) {
  const exit = await onDay(TODAY)(monthOverview(reader.userId, wanted));

  if (Exit.isFailure(exit)) {
    throw new Error("The made-up ledger did not answer.");
  }

  return exit.value;
}

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

  test("names a month of a year under 100 by its own year", async () => {
    const { text, isError } = await month({ action: "summary", month: "0042-03" });

    expect(isError).toBe(false);
    expect(text).toMatch(/^March 42,/);
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
      const { text, isError } = await month({ action: "summary", month: wanted });

      expect(isError, wanted).toBe(false);
      expect(text.length, wanted).toBeLessThan(RESULT_LIMIT);
      expect(text, wanted).not.toContain("Part 1 of");
    }
  });
});
