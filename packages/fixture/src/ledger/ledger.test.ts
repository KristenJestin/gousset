import { describe, expect, test } from "vite-plus/test";

import { FIXTURE_SEED, madeUpAccounts, madeUpMonth } from "./ledger";

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

  test("refuses a month that is not YYYY-MM", () => {
    expect(() => madeUpMonth("2026-13")).toThrow(/YYYY-MM/);
    expect(() => madeUpMonth("October")).toThrow(/YYYY-MM/);
  });
});
