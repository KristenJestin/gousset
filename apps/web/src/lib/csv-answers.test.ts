import type { CsvProfile } from "@gousset/import";
import { describe, expect, test } from "vite-plus/test";

import { answeredProfile } from "./csv-answers";

/** A French bank's export, as detection proposes it: a debit and a credit column. */
const debitCredit: CsvProfile = {
  version: 1,
  separator: ";",
  encoding: "utf8",
  skipRows: 0,
  headerRow: true,
  dateFormat: "DD/MM/YYYY",
  decimalMark: ",",
  columns: {
    bookedOn: 1,
    valueOn: null,
    amount: { kind: "debit-credit", debit: 3, credit: 4 },
    label: 2,
    memo: null,
    bankId: null,
    currency: null,
  },
};

const none = { dates: null, decimal: null, amount: null, credit: null };

describe("a CSV's answered questions", () => {
  test("keep the amount's columns detection was sure of when only the dates were asked", () => {
    const answered = answeredProfile(debitCredit, ["dateFormat"], { ...none, dates: "day" });

    expect(answered.columns.amount).toEqual({ kind: "debit-credit", debit: 3, credit: 4 });
    expect(answered.dateFormat).toBe("DD/MM/YYYY");
  });

  test("read the dates month first when the user says so", () => {
    const answered = answeredProfile(debitCredit, ["dateFormat"], { ...none, dates: "month" });

    expect(answered.dateFormat).toBe("MM/DD/YYYY");
  });

  test("take the decimal mark the user chose", () => {
    const answered = answeredProfile(debitCredit, ["decimalMark"], { ...none, decimal: "." });

    expect(answered.decimalMark).toBe(".");
    expect(answered.columns.amount).toEqual(debitCredit.columns.amount);
  });

  test("take the amount's columns the user chose when they were asked", () => {
    expect(
      answeredProfile(debitCredit, ["amount"], { ...none, amount: 5, credit: null }).columns.amount,
    ).toEqual({ kind: "signed", column: 5 });
    expect(
      answeredProfile(debitCredit, ["amount"], { ...none, amount: 4, credit: 3 }).columns.amount,
    ).toEqual({ kind: "debit-credit", debit: 4, credit: 3 });
  });

  test("change nothing that was not asked", () => {
    expect(
      answeredProfile(debitCredit, [], { dates: "month", decimal: ".", amount: 9, credit: 8 }),
    ).toEqual(debitCredit);
  });
});
