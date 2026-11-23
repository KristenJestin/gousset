import { encodeWindows1252, exampleStatement, statementSamples, writeQif } from "@gousset/fixture";
import type { Statement as MadeUpStatement } from "@gousset/fixture";
import { Effect } from "effect";
import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

import {
  InvalidField,
  InvalidOption,
  MissingField,
  NotAStatement,
  UnsupportedContent,
} from "./errors";
import { readQif } from "./qif";
import type { QifOptions, QifStatement } from "./qif";
import { madeUpStatements } from "./testing";

const read = (bytes: Uint8Array, options: QifOptions) => Effect.runSync(readQif(bytes, options));

const refusal = (text: string) =>
  Effect.runSync(Effect.flip(readQif(new TextEncoder().encode(text), { currency: "EUR" })));

/** What `writeQif` writes: the label as `P`, the reference as `N`, no memo and no balance. */
function writtenByWriteQif(statement: MadeUpStatement): Omit<QifStatement, "dateOrder"> {
  return {
    account: null,
    currency: statement.account.currency,
    lines: statement.lines.map((madeUp) => ({
      bookedOn: madeUp.bookedOn,
      valueOn: null,
      amountMinor: madeUp.amountMinor,
      label: madeUp.label,
      memo: null,
      bankId: madeUp.reference,
      counterparty: null,
    })),
    openingBalance: null,
    balance: null,
  };
}

function line(bookedOn: string, amountMinor: number, label: string) {
  return {
    bookedOn,
    valueOn: null,
    amountMinor,
    label,
    memo: null,
    bankId: null,
    counterparty: null,
  };
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
      account: null,
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
      openingBalance: null,
      balance: { amountMinor: 210_922, on: "2026-10-15" },
      dateOrder: { order: "month-first", decidedBy: "file" },
    });
  });

  test("reads qif-windows-1252.qif (Windows-1252, decimal commas, two-digit years)", () => {
    expect(read(statementSamples.qifWindows1252.bytes, { currency: "EUR" })).toEqual({
      account: null,
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
      openingBalance: null,
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
      account: null,
      currency: "EUR",
      lines: [
        line("2026-10-01", -123_456, "REISEBÜRO BEISPIEL"),
        line("2026-10-15", -4590, "TANKSTELLE BEISPIEL"),
        { ...line("2026-10-31", 128_046, "ZAHLUNG DANKE"), memo: "Ausgleich Kartenkonto" },
      ],
      openingBalance: null,
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

  test("refuses a currency that is no ISO 4217 code, and takes one in lowercase", () => {
    const bytes = new TextEncoder().encode("!Type:Bank\nD03/10/2026\nT-4.20\n^\n");

    expect(Effect.runSync(Effect.flip(readQif(bytes, { currency: "EURO" })))).toEqual(
      new InvalidOption({
        option: "currency",
        text: "EURO",
        expected: "a currency's ISO 4217 code, such as EUR",
      }),
    );

    expect(read(bytes, { currency: "eur" }).currency).toBe("EUR");
  });

  test("refuses a balance too large to be held exactly, naming the line that makes it so", () => {
    const text = [
      "!Type:Bank",
      "D09/30/2026",
      "T90071992547409.91",
      "POpening Balance",
      "L[Checking]",
      "^",
      "D10/01/2026",
      "T0.01",
      "PInterest",
      "^",
    ].join("\n");

    expect(refusal(text)).toEqual(
      new UnsupportedContent({
        line: 7,
        problem:
          "The balance, the opening balance plus every line up to this one, is too large to be held exactly.",
      }),
    );
  });
});

describe("reading what a QIF file may hold besides plain text", () => {
  test("reads a Windows-1252 file that starts with a UTF-8 byte order mark", () => {
    const text = encodeWindows1252("!Type:Bank\nD03/10/2026\nT-4,20\nPCAFÉ EXEMPLE\n^\n");
    const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, ...text]);

    expect(read(bytes, { currency: "EUR" }).lines).toEqual([
      line("2026-10-03", -420, "CAFÉ EXEMPLE"),
    ]);
  });

  test("drops control and direction characters from what it returns", () => {
    const bytes = new TextEncoder().encode(
      "!Type:Bank\nD03/10/2026\nT-4.20\nPCB\u0000 ACME‮ 01/10\nMONE\tTWO\nNEX\u000001\n^\n",
    );

    expect(read(bytes, { currency: "EUR" }).lines).toEqual([
      { ...line("2026-10-03", -420, "CB ACME 01/10"), memo: "ONE TWO", bankId: "EX01" },
    ]);
  });
});
