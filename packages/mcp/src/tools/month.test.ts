import {
  DataExport,
  Expenses,
  ImportProfiles,
  Imports,
  Merchants,
  RuleJobs,
  Subscriptions,
  Today,
  Transfers,
  memoryAccountStore,
  memoryCategoryStore,
  memoryLineStore,
} from "@gousset/core";
import type { Charge } from "@gousset/core";
import { UserData } from "@gousset/db/user-data";
import { Effect, Layer } from "effect";
import { describe, expect, test } from "vite-plus/test";

import { goussetServer } from "../gousset";
import { ERROR_LIMIT } from "../results";
import { callText, connectInProcess } from "../test-client";
import type { Caller } from "../tool";

// The month tool: its subscriptions, detected from the charges `Subscriptions` reads (core's tests
// hold the detection's own rules), and, until the review reads the user's own lines (v0.4), the
// other actions answering that they are not available yet, with no figure and no name (#126).

const TODAY = "2026-11-24";
const reader: Caller = { userId: "ada", canWrite: false, currency: "EUR" };

let made = 0;

function charge(merchant: string, day: string, amountMinor: number): Charge {
  made += 1;

  return {
    id: `00000000-0000-4000-8000-${String(made).padStart(12, "0")}`,
    merchantId: `merchant-${merchant}`,
    merchant,
    day,
    amountMinor,
    currency: "EUR",
  };
}

/** Made-up charges: a monthly price that rose this month, one that stopped, a bill that varies. */
const CHARGES: ReadonlyArray<Charge> = [
  ...["2026-07-08", "2026-08-08", "2026-09-08", "2026-10-08"].map((day) =>
    charge("Streamly", day, 949),
  ),
  charge("Streamly", "2026-11-08", 1099),
  ...["2026-07-03", "2026-08-03", "2026-09-03", "2026-10-03"].map((day) =>
    charge("Fitclub", day, 2900),
  ),
  charge("Wavely Mobile", "2026-08-30", 1600),
  charge("Wavely Mobile", "2026-09-30", 2340),
  charge("Wavely Mobile", "2026-10-30", 1875),
];

type Range = { readonly from: string; readonly to: string };

/** A client of the server on `charges`, each range they are read over pushed to `asked`. */
function connect(charges: ReadonlyArray<Charge> = CHARGES, asked: Array<Range> = []) {
  return connectInProcess(
    goussetServer,
    {
      run: (effect) =>
        Effect.runPromiseExit(
          Effect.provide(
            effect,
            Layer.mergeAll(
              memoryAccountStore(),
              memoryLineStore(),
              memoryCategoryStore(),
              Layer.mock(Imports, {}),
              Layer.mock(ImportProfiles, {}),
              Layer.mock(DataExport, {}),
              Layer.mock(Merchants, {}),
              Layer.mock(Transfers, {}),
              Layer.mock(Expenses, {}),
              Layer.mock(UserData, {}),
              Layer.mock(RuleJobs, {}),
              Layer.succeed(Subscriptions, {
                charges: (_owner, range) =>
                  Effect.sync(() => {
                    asked.push(range);

                    return charges.filter((each) => each.day >= range.from && each.day <= range.to);
                  }),
              }),
              Layer.succeed(Today, { day: Effect.succeed(TODAY) }),
            ),
          ),
        ),
    },
    reader,
    "2025-11-25",
  );
}

async function month(
  args: { [key: string]: string },
  charges: ReadonlyArray<Charge> = CHARGES,
  asked: Array<Range> = [],
) {
  return callText(await connect(charges, asked), "month", args);
}

describe("month subscriptions", () => {
  test("gives the month's recurring payments, those that stopped and the prices that rose, by name", async () => {
    const { text, isError } = await month({ action: "subscriptions", month: "2026-11" });

    expect(isError, text).toBe(false);
    expect(text).toContain(
      "Subscriptions of 2026-11, detected from the user's expenses up to 2026-11-24.",
    );
    expect(text).toContain(
      "- Streamly: monthly, usually 9.49 EUR; last paid 2026-11-08, 10.99 EUR; next expected 2026-12-08.",
    );
    expect(text).toContain(
      "- Fitclub: monthly, expected 2026-11-03, did not come; last paid 2026-10-03, 29.00 EUR.",
    );
    expect(text).toContain("Price rises (1):\n- Streamly: from 9.49 EUR to 10.99 EUR.");
    expect(text).not.toContain("Wavely Mobile");
    expect(text).not.toContain("merchant-");
    expect(text).not.toContain("00000000-");
    expect(text).toContain(
      'merchants {"action":"edit","merchant":"Streamly","subscription":false}; subscription true proposes it again.',
    );
  });

  test("reads the current month when none is given, from the three years of charges up to today", async () => {
    const asked: Array<Range> = [];
    const { text, isError } = await month({ action: "subscriptions" }, CHARGES, asked);

    expect(isError, text).toBe(false);
    expect(text).toContain("Subscriptions of 2026-11");
    expect(asked).toEqual([{ from: "2023-11-24", to: TODAY }]);
  });

  test("reads a month gone by as it stood on its last day", async () => {
    const asked: Array<Range> = [];

    const { text, isError } = await month(
      { action: "subscriptions", month: "2026-10" },
      CHARGES,
      asked,
    );

    expect(isError, text).toBe(false);
    expect(text).toContain("up to 2026-10-31.");
    expect(text).toContain(
      "- Streamly: monthly, usually 9.49 EUR; last paid 2026-10-08, 9.49 EUR; next expected 2026-11-08.",
    );
    expect(text).toContain("- Fitclub: monthly, usually 29.00 EUR");
    expect(text).not.toContain("Price rises");
    expect(text).not.toContain("Stopped");
    expect(asked).toEqual([{ from: "2023-10-31", to: "2026-10-31" }]);
  });

  test("says when nothing recurs", async () => {
    const { text, isError } = await month({ action: "subscriptions" }, []);

    expect(isError, text).toBe(false);
    expect(text).toContain("No recurring payment detected.");
  });

  test("refuses a month to come, with a valid call", async () => {
    const { text, isError } = await month({ action: "subscriptions", month: "2026-12" });

    expect(isError).toBe(true);
    expect(text).toContain("2026-12 is a month to come");
    expect(text).toContain('A valid call: month {"action":"subscriptions","month":"2026-11"}');
    expect(text.length).toBeLessThan(ERROR_LIMIT);

    const answered = await month({ action: "subscriptions", month: "2026-11" });

    expect(answered.isError).toBe(false);
  });

  test("refuses a month not written YYYY-MM, with a valid call", async () => {
    const { text, isError } = await month({ action: "subscriptions", month: "November" });

    expect(isError).toBe(true);
    expect(text).toContain("The arguments of month are not valid");
    expect(text).toContain('A valid call: month {"action":"subscriptions"}');
  });
});

describe("month, until the rest of the review ships", () => {
  test.each(["summary", "review", "days"])(
    "%s says the review is not available yet, and where the user's money is read today",
    async (action) => {
      const { text, isError } = await month({ action });

      expect(isError).toBe(false);
      expect(text).toContain("The monthly review is not available yet");
      expect(text).toContain('accounts {"action":"list"}');
      expect(text).toContain('lines {"action":"search"');
      expect(text).toContain('month {"action":"subscriptions"}');
    },
  );

  test("gives no figure and no name, whatever the month or the row asked for", async () => {
    const { text, isError } = await month({
      action: "days",
      month: "2026-10",
      by: "category",
      row: "Groceries",
    });

    expect(isError).toBe(false);
    expect(text).not.toMatch(/\d+\.\d\d/);
    expect(text).not.toContain("EUR");
    expect(text).not.toContain("Groceries");
    expect(text).not.toContain("October");
  });

  test("an unknown action is refused with a valid call", async () => {
    const { text, isError } = await month({ action: "forecast" });

    expect(isError).toBe(true);
    expect(text).toContain('month {"action":"subscriptions"}');
  });

  test("reads only, says so, and comes first in the fixed order", async () => {
    const { tools } = await (await connect()).listTools();
    const [first] = tools;

    expect(first?.name).toBe("month");
    expect(first?.title).toBe("Monthly review (subscriptions; the rest not available yet)");
    expect(first?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });
});
