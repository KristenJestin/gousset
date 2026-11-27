import { describe, expect, test } from "vite-plus/test";

import { FIXTURE_SEED, madeUpAccounts, madeUpMonth, madeUpSecurities } from "./ledger";

/** What the made-up subscription cost in a month: negative, money out. */
const subscriptionPrice = (month: string) =>
  madeUpMonth(month).lines.find((line) => line.merchant === "Streamly")?.amountMinor;

describe("madeUpMonth", () => {
  test("gives the same month for the same seed", () => {
    expect(madeUpMonth("2026-10")).toEqual(madeUpMonth("2026-10", FIXTURE_SEED));
  });

  test("gives another month for another seed", () => {
    expect(madeUpMonth("2026-10", 1)).not.toEqual(madeUpMonth("2026-10", 2));
  });

  test("gives each month lines of its own, booked within it", () => {
    const october = madeUpMonth("2026-10");
    const november = madeUpMonth("2026-11");

    expect(october.lines.every((line) => line.bookedOn.startsWith("2026-10-"))).toBe(true);
    expect(november.lines.every((line) => line.bookedOn.startsWith("2026-11-"))).toBe(true);
    expect(october.lines).not.toEqual(november.lines);
  });

  test("books every line on a day that exists", () => {
    for (const month of ["2026-02", "2028-02", "2026-04", "2026-12"]) {
      for (const line of madeUpMonth(month).lines) {
        const day = new Date(`${line.bookedOn}T00:00:00Z`);

        expect(day.toISOString().slice(0, 10)).toBe(line.bookedOn);
      }
    }
  });

  test("keeps amounts in whole minor units, never zero", () => {
    for (const line of madeUpMonth("2026-10").lines) {
      expect(Number.isInteger(line.amountMinor)).toBe(true);
      expect(line.amountMinor).not.toBe(0);
    }
  });

  test("gives every line an id unique across months", () => {
    const ids = ["2026-09", "2026-10", "2026-11"].flatMap((month) =>
      madeUpMonth(month).lines.map((line) => line.id),
    );

    expect(new Set(ids).size).toBe(ids.length);
  });

  test("books lines only on the made-up accounts", () => {
    const accounts = new Set(madeUpAccounts.map((account) => account.id));

    for (const line of madeUpMonth("2026-10").lines) {
      expect(accounts.has(line.accountId)).toBe(true);
    }
  });

  test("pairs every transfer with its other side, on another account", () => {
    const { lines } = madeUpMonth("2026-10");

    for (const line of lines) {
      if (line.kind !== "transfer") {
        continue;
      }

      const other = lines.find((candidate) => candidate.id === line.counterpartLineId);

      expect(other?.counterpartLineId).toBe(line.id);
      expect(other?.amountMinor).toBe(-line.amountMinor);
      expect(other?.accountId).not.toBe(line.accountId);
    }
  });

  test("makes each expense of its payments and refunds, at its net cost", () => {
    const { lines, expenses } = madeUpMonth("2026-10");
    const amountOf = (id: string) => lines.find((line) => line.id === id)?.amountMinor ?? 0;

    expect(expenses.some((expense) => expense.refundLineIds.length > 0)).toBe(true);

    for (const expense of expenses) {
      const paid = expense.paymentLineIds.reduce((sum, id) => sum + amountOf(id), 0);
      const refunded = expense.refundLineIds.reduce((sum, id) => sum + amountOf(id), 0);

      expect(expense.netMinor).toBe(-(paid + refunded));
      expect(expense.netMinor).toBeGreaterThan(0);
    }
  });

  test("leaves lines to review every month, and at least six categories spent in", () => {
    for (const month of ["2026-01", "2026-10", "2027-06"]) {
      const { lines, expenses } = madeUpMonth(month);

      expect(lines.filter((line) => !line.reviewed)).toHaveLength(6);
      expect(new Set(expenses.map((expense) => expense.category)).size).toBeGreaterThanOrEqual(6);
    }
  });

  test("gives some expenses subjects, the same for the same merchant", () => {
    const { expenses } = madeUpMonth("2026-10");

    const subjectsOf = (merchant: string) =>
      expenses.find((expense) => expense.merchant === merchant)?.subjects;

    expect(subjectsOf("Fuelstop")).toEqual(["Van"]);
    expect(subjectsOf("Glycine Homes")).toEqual(["Home"]);
    expect(subjectsOf("Streamly")).toEqual([]);
  });

  test("raises the subscription's price in October 2026", () => {
    expect(subscriptionPrice("2026-09")).toBe(-899);
    expect(subscriptionPrice("2026-10")).toBe(-949);
    expect(subscriptionPrice("2026-11")).toBe(-949);
  });

  test("says up to which day each account's statement was imported", () => {
    const { statements, lines } = madeUpMonth("2026-10");

    const lastMealCardLine = lines
      .filter((line) => line.accountId === "mealcard")
      .map((line) => line.bookedOn)
      .toSorted()
      .at(-1);

    expect(statements.map((statement) => statement.accountId)).toEqual(
      madeUpAccounts.map((account) => account.id),
    );
    expect(statements.find((statement) => statement.accountId === "current")?.coveredTo).toBe(
      "2026-10-31",
    );
    // The benefit account's statement stops at its last line: it was downloaded that day.
    expect(statements.find((statement) => statement.accountId === "mealcard")?.coveredTo).toBe(
      lastMealCardLine,
    );
  });

  test("gives every line of the PEA its operation, and no other line one", () => {
    const { lines } = madeUpMonth("2026-09");
    const pea = lines.filter((line) => line.accountId === "pea");
    const isins = new Set(madeUpSecurities.map((security) => security.isin));

    expect(
      lines.filter((line) => line.accountId !== "pea").every((line) => line.operation === null),
    ).toBe(true);

    // September ends a quarter: a dividend comes with the deposit, the two purchases and the fee.
    const kinds = pea.map((line) => line.operation?.kind ?? "");

    expect(kinds.toSorted((a, b) => a.localeCompare(b))).toEqual([
      "deposit",
      "dividend",
      "fee",
      "purchase",
      "purchase",
    ]);

    for (const line of pea) {
      const kind = line.operation?.kind;
      const out = kind === "purchase" || kind === "fee" || kind === "withdrawal";

      expect(line.amountMinor < 0, line.label).toBe(out);
      expect(
        line.operation?.isin === null || isins.has(line.operation?.isin ?? ""),
        line.label,
      ).toBe(true);
    }

    // The ETFs are bought in fractions of a unit, at a price of four places.
    for (const line of pea.filter((each) => each.operation?.kind === "purchase")) {
      expect(line.operation?.quantity, line.label).toMatch(/^0\.\d{4}$|^[1-9]\d*\.\d{4}$/);
      expect(line.operation?.quantity?.endsWith(".0000"), line.label).toBe(false);
      expect(line.operation?.unitPrice, line.label).toMatch(/^\d+\.\d{4}$/);
    }

    // Only a quarter's last month has a dividend.
    expect(madeUpMonth("2026-10").lines.some((line) => line.operation?.kind === "dividend")).toBe(
      false,
    );
  });

  test("keeps the PEA's cash from going below zero", () => {
    let cash = 0;

    for (const month of ["2025-01", "2025-02", "2025-03", "2026-09", "2026-10", "2027-06"]) {
      for (const line of madeUpMonth(month).lines.filter((each) => each.accountId === "pea")) {
        cash += line.amountMinor;

        expect(cash, `${month} ${line.label}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("refuses a month that is not YYYY-MM", () => {
    expect(() => madeUpMonth("2026-13")).toThrow(/YYYY-MM/);
    expect(() => madeUpMonth("October")).toThrow(/YYYY-MM/);
  });
});
