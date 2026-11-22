import { exampleStatement, statementSamples, writeQif } from "@gousset/fixture";
import type { Statement as MadeUpStatement } from "@gousset/fixture";
import { Effect } from "effect";
import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

import { InvalidField, MissingField, NotAStatement, UnsupportedContent } from "./errors";
import { readQif } from "./qif";
import type { QifOptions, QifStatement } from "./qif";
import { madeUpStatements } from "./testing";

const read = (bytes: Uint8Array, options: QifOptions) => Effect.runSync(readQif(bytes, options));

const refusal = (text: string) =>
  Effect.runSync(Effect.flip(readQif(new TextEncoder().encode(text), { currency: "EUR" })));

/** What `writeQif` writes: the label as `P`, the reference as `N`, no memo and no balance. */
function writtenByWriteQif(statement: MadeUpStatement): Omit<QifStatement, "dateOrder"> {
  return {
    currency: statement.account.currency,
    lines: statement.lines.map((madeUp) => ({
      bookedOn: madeUp.bookedOn,
      valueOn: null,
      amountMinor: madeUp.amountMinor,
      label: madeUp.label,
      memo: null,
      bankId: madeUp.reference,
    })),
    balance: null,
  };
}

function line(bookedOn: string, amountMinor: number, label: string) {
  return { bookedOn, valueOn: null, amountMinor, label, memo: null, bankId: null };
}

// One test per sample file: the lines read are the lines the file holds.
describe("reading QIF files", () => {
  test("reads qif-day-first.qif (UTF-8, day first, decided by the file)", () => {
    expect(read(statementSamples.qifDayFirst.bytes, { currency: "EUR" })).toEqual({
      ...writtenByWriteQif(exampleStatement),
      dateOrder: { order: "day-first", decidedBy: "file" },
    });
  });

  test("reads qif-quicken.qif (month first, Quicken's years, grouped thousands, a balance)", () => {
    expect(read(statementSamples.qifQuicken.bytes, { currency: "USD" })).toEqual({
      currency: "USD",
      lines: [
        {
          ...line("2026-10-01", -135_000, "Example Property Management"),
          memo: "October rent",
          bankId: "1001",
        },
        line("2026-10-03", -8645, "Example Grocery"),
        line("2026-10-15", 234_567, "Example Corp Payroll"),
      ],
      balance: { amountMinor: 210_922, on: "2026-10-15" },
      dateOrder: { order: "month-first", decidedBy: "file" },
    });
  });

  test("reads qif-windows-1252.qif (Windows-1252, decimal commas, two-digit years)", () => {
    expect(read(statementSamples.qifWindows1252.bytes, { currency: "EUR" })).toEqual({
      currency: "EUR",
      lines: [
        {
          ...line("2026-11-03", -8500, "PRLV SEPA ÉCOLE DE MUSIQUE"),
          memo: "Cotisation trimestrielle",
        },
        line("2026-11-04", -1240, "CB L’ÉPICERIE DU COIN 03/11"),
        {
          ...line("2026-11-10", 245_000, "VIR SEPA ACME CONSEIL SALAIRE"),
          bankId: "EX2026111001",
        },
        {
          ...line("2026-11-12", -123_456, "PRLV SEPA SCI DES GLYCINES LOYER"),
          memo: "Échéance de novembre",
        },
      ],
      balance: null,
      dateOrder: { order: "day-first", decidedBy: "default" },
    });
  });

  test("reads qif-windows-1252.qif month first when the caller says so", () => {
    const statement = read(statementSamples.qifWindows1252.bytes, {
      currency: "EUR",
      dateOrder: "month-first",
    });

    expect(statement.lines.map((entry) => entry.bookedOn)).toEqual([
      "2026-03-11",
      "2026-04-11",
      "2026-10-11",
      "2026-12-11",
    ]);

    expect(statement.dateOrder).toEqual({ order: "month-first", decidedBy: "option" });
  });

  test("reads qif-dot-dates.qif (a card, dates with dots, 1.234,56)", () => {
    expect(read(statementSamples.qifDotDates.bytes, { currency: "EUR" })).toEqual({
      currency: "EUR",
      lines: [
        line("2026-10-01", -123_456, "REISEBÜRO BEISPIEL"),
        line("2026-10-15", -4590, "TANKSTELLE BEISPIEL"),
        { ...line("2026-10-31", 128_046, "ZAHLUNG DANKE"), memo: "Ausgleich Kartenkonto" },
      ],
      balance: null,
      dateOrder: { order: "day-first", decidedBy: "file" },
    });
  });

  test("reads back any statement writeQif writes", () => {
    fc.assert(
      fc.property(madeUpStatements, (statement) => {
        const bytes = new TextEncoder().encode(writeQif(statement));
        const options: QifOptions = { currency: "EUR", dateOrder: "day-first" };

        expect(read(bytes, options)).toEqual({
          ...writtenByWriteQif(statement),
          dateOrder: { order: "day-first", decidedBy: "option" },
        });
      }),
    );
  });
});

const DATE_EXAMPLE = "a date such as 03/10/2026, 10/3'26, 03.10.2026 or 2026-10-03";

describe("refusing a QIF file", () => {
  test("refuses a file with no QIF header", () => {
    expect(refusal("D03/10/2026\nT-4.20\n^\n")).toEqual(new NotAStatement({ format: "qif" }));
    expect(refusal("")).toEqual(new NotAStatement({ format: "qif" }));
  });

  test("names the line of a date it cannot read", () => {
    expect(refusal("!Type:Bank\nD03/10/2026\nT-4.20\n^\nDyesterday\nT-1.00\n^\n")).toEqual(
      new InvalidField({ line: 5, field: "D", text: "yesterday", expected: DATE_EXAMPLE }),
    );
  });

  test("names the line of a date that is no day in either order", () => {
    expect(refusal("!Type:Bank\nD31/02/2026\nT-4.20\n^\n")).toEqual(
      new InvalidField({
        line: 2,
        field: "D",
        text: "31/02/2026",
        expected: `${DATE_EXAMPLE}, read day-first`,
      }),
    );
  });

  test("names the line of an amount it cannot read", () => {
    expect(refusal("!Type:Bank\nD03/10/2026\nT-4.20\n^\nD04/10/2026\nT12,345\n^\n")).toEqual(
      new InvalidField({
        line: 6,
        field: "T",
        text: "12,345",
        expected:
          'an amount such as -1,234.56, -1.234,56 or -1234,56: "12,345" may be a thousand or a fraction',
      }),
    );
  });

  test("names the record that lacks its amount", () => {
    expect(refusal("!Type:Bank\n\nD03/10/2026\nPNo amount\n^\n")).toEqual(
      new MissingField({ line: 3, field: "T" }),
    );
  });

  test("refuses an investment account, two accounts, and a section it does not know", () => {
    expect(refusal("!Type:Invst\nD03/10/2026\n^\n")).toEqual(
      new UnsupportedContent({
        line: 1,
        problem: "An investment account: Gousset reads bank and card accounts.",
      }),
    );

    expect(refusal("!Type:Bank\nD03/10/2026\nT-1.00\n^\n!Type:CCard\nD03/10/2026\n")).toEqual(
      new UnsupportedContent({
        line: 5,
        problem: "A second account's transactions: export one account per file.",
      }),
    );

    expect(refusal("!Type:Bank\n^\n!Type:Diary\n")).toEqual(
      new UnsupportedContent({ line: 3, problem: 'A section "Type:Diary".' }),
    );
  });
});
