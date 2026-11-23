import {
  closingBalanceMinor,
  exampleStatement,
  statementSamples,
  writeMt940,
} from "@gousset/fixture";
import type { Statement as MadeUpStatement } from "@gousset/fixture";
import { Effect } from "effect";
import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

import { dayBefore } from "./dates";
import { InvalidField, MissingField, NotAStatement, UnsupportedContent } from "./errors";
import { readMt940 } from "./mt940";
import type { Statement } from "./statement";
import { madeUpStatements } from "./testing";

const read = (bytes: Uint8Array) => Effect.runSync(readMt940(bytes));

const refusal = (text: string) =>
  Effect.runSync(Effect.flip(readMt940(new TextEncoder().encode(text))));

const IBAN = "DE39999999990012345678";

/** The samples' account (`:25:`), an IBAN. */
const ACCOUNT = { iban: "FR7699999000010001234567809", number: null };

/**
 * What `writeMt940` writes: the label as `:86:`, the reference as the bank's, the value date the
 * entry date, `:60F:` on the first day: the end of the day before when a line is booked on it or
 * earlier.
 */
function writtenByWriteMt940(statement: MadeUpStatement): Statement {
  const startOfFirstDay = statement.lines.some((line) => line.bookedOn <= statement.from);

  return {
    account: { iban: statement.account.iban, number: null },
    currency: statement.account.currency,
    lines: statement.lines.map((line) => ({
      bookedOn: line.bookedOn,
      valueOn: line.bookedOn,
      amountMinor: line.amountMinor,
      label: line.label,
      memo: null,
      bankId: line.reference,
      counterparty: null,
    })),
    openingBalance: {
      amountMinor: statement.openingBalanceMinor,
      on: startOfFirstDay ? dayBefore(statement.from) : statement.from,
    },
    balance: { amountMinor: closingBalanceMinor(statement), on: statement.to },
  };
}

type Line = Statement["lines"][number];

/** A line with neither memo nor counterparty, booked and valued on the same day. */
function line(bookedOn: string, amountMinor: number, label: string, bankId: string | null): Line {
  return {
    bookedOn,
    valueOn: bookedOn,
    amountMinor,
    label,
    memo: null,
    bankId,
    counterparty: null,
  };
}

/** MT940 writes two-digit years: 1970 to 2069. */
const inTwoDigitYears = madeUpStatements.filter((statement) =>
  [statement.to, ...statement.lines.map((entry) => entry.bookedOn)].every(
    (day) => day >= "1970-01-01" && day <= "2069-12-31",
  ),
);

describe("reading what an MT940 file may hold besides plain text", () => {
  test("keeps a field whole when its value holds a line or paragraph separator", () => {
    const statement = read(
      new TextEncoder().encode(
        mt940(
          ":61:261002D10,00NTRFNONREF//A",
          ":86:one",
          ":61:261003D20,00NTRFNONREF X//B",
          ":86:166?00GUTSCHRIFT?20Rent Oct?32ACME",
        ),
      ),
    );

    expect(statement.lines).toEqual([
      line("2026-10-02", -1000, "one", "A"),
      {
        ...line("2026-10-03", -2000, "Rent Oct", "B"),
        memo: "GUTSCHRIFT",
        counterparty: { name: "ACME", iban: null },
      },
    ]);
  });

  test("reads :60F: as SWIFT dates it when only a back-valued line, without entry date, is before it", () => {
    const text = [
      ":20:S1",
      `:25:${IBAN}`,
      ":60F:C261001EUR1000,00",
      ":61:261002D10,00NTRFNONREF//A",
      ":61:260929D5,00NMSCNONREF//B",
      ":62F:C261002EUR985,00",
    ].join("\n");

    expect(read(new TextEncoder().encode(text)).openingBalance).toEqual({
      amountMinor: 100_000,
      on: "2026-10-01",
    });
  });
});

// One test per sample file: the lines read are the lines the file holds.
describe("reading MT940 files", () => {
  test("reads mt940-plain.sta (CRLF, free text, the example statement)", () => {
    expect(read(statementSamples.mt940Plain.bytes)).toEqual(writtenByWriteMt940(exampleStatement));
  });

  test("reads mt940-swift-blocks.sta (SWIFT blocks, reversals, funds codes, NONREF)", () => {
    expect(read(statementSamples.mt940SwiftBlocks.bytes)).toEqual({
      account: ACCOUNT,
      currency: "EUR",
      lines: [
        line("2026-11-02", -2390, "CB PATISSERIE DU MARCHE 31/10", null),
        {
          ...line(
            "2026-11-03",
            15_000,
            "VIR SEPA RECU DE CAMILLE EXEMPLE REMBOURSEMENT NOEL",
            "EX2026110301",
          ),
          valueOn: "2026-11-02",
        },
        line("2026-11-03", -6412, "PRLV SEPA ELEC ET GAZ EXEMPLE", "EX2026110302"),
        line("2026-11-05", 6412, "RETOUR PRLV SEPA ELEC ET GAZ EXEMPLE", "EX2026110501"),
        line("2026-11-05", -15_000, "ANNULATION VIR SEPA CAMILLE EXEMPLE", "VIR-EX-0007"),
      ],
      openingBalance: { amountMinor: 152_030, on: "2026-10-31" },
      balance: { amountMinor: 149_640, on: "2026-11-05" },
    });
  });

  test("reads mt940-structured.sta (Windows-1252, ? subfields, across the year's end)", () => {
    expect(read(statementSamples.mt940Structured.bytes)).toEqual({
      // `:25:` is the bank's code, then the account's number.
      account: { iban: null, number: "0012345678" },
      currency: "EUR",
      lines: [
        {
          ...line("2026-12-30", -4590, "SVWZ+Rechnung 2026-12 Tankstelle Beispiel", "EX2026123001"),
          memo: "LASTSCHRIFT",
          counterparty: { name: "TANKSTELLE BEISPIEL GMBH", iban: IBAN },
        },
        {
          ...line("2027-01-02", 245_000, "Gehalt Dezember", "EX2027010201"),
          valueOn: "2026-12-31",
          memo: "GUTSCHRIFT",
          counterparty: { name: "ACME BERATUNG", iban: null },
        },
        {
          ...line("2026-12-31", -1250, "Kontoführung Dezember", null),
          valueOn: "2027-01-02",
          memo: "GEBÜHREN",
        },
      ],
      // `:60F:` is dated 30 December, a day with a line: the balance at its start.
      openingBalance: { amountMinor: 200_000, on: "2026-12-29" },
      balance: { amountMinor: 439_160, on: "2027-01-02" },
    });
  });

  test("reads mt940-multi-statement.sta (three messages, pages, /CODE/ information)", () => {
    expect(read(statementSamples.mt940MultiStatement.bytes)).toEqual({
      // `:25:` is the IBAN followed by the account's currency.
      account: ACCOUNT,
      currency: "EUR",
      lines: [
        {
          ...line("2026-12-01", 2500, "REMBOURSEMENT CINEMA", "EX2026120101"),
          memo: "SEPA CREDIT TRANSFER",
          counterparty: { name: "CAMILLE EXEMPLE", iban: IBAN },
        },
        {
          ...line("2026-12-01", -420, "CB LE FOURNIL 01/12", "EX2026120102"),
          counterparty: { name: "LE FOURNIL DES TILLEULS", iban: IBAN },
        },
        {
          ...line("2026-12-02", -85_000, "LOYER DECEMBRE", "EX2026120201"),
          memo: "SEPA DIRECT DEBIT",
          counterparty: { name: "SCI DES GLYCINES", iban: null },
        },
      ],
      openingBalance: { amountMinor: 50_000, on: "2026-11-30" },
      balance: { amountMinor: -32_920, on: "2026-12-02" },
    });
  });

  test("reads :25: as a BIC and an account, or an account alone, spaced or not", () => {
    expect(withAccount("BEXAFRPPXXX/FR7699999000010001234567809")).toEqual(ACCOUNT);
    expect(withAccount("fr76 9999 9000 0100 0123 4567 809")).toEqual(ACCOUNT);
    expect(withAccount("12345678")).toEqual({ iban: null, number: "12345678" });
    expect(withAccount("BEXAFRPPXXX/12345678")).toEqual({ iban: null, number: "12345678" });
  });

  test("reads back any statement writeMt940 writes", () => {
    fc.assert(
      fc.property(inTwoDigitYears, (statement) => {
        const bytes = new TextEncoder().encode(writeMt940(statement));

        expect(read(bytes)).toEqual(writtenByWriteMt940(statement));
      }),
    );
  });
});

/** The account read from `mt940()`'s statement with `:25:` holding `account`. */
function withAccount(account: string) {
  const text = mt940().replace(":25:FR7699999000010001234567809", `:25:${account}`);

  return read(new TextEncoder().encode(text)).account;
}

/** A statement in euros whose lines start on line 4. */
function mt940(...lines: ReadonlyArray<string>): string {
  return [
    ":20:EX01",
    ":25:FR7699999000010001234567809",
    ":60F:C261001EUR100,00",
    ...lines,
    ":62F:C261031EUR100,00",
  ].join("\r\n");
}

describe("refusing an MT940 file", () => {
  test("refuses more fields than any statement holds, wherever they start, with a typed error", () => {
    const tooMany = new UnsupportedContent({
      line: 1,
      problem: "More than a million fields and lines: no statement holds that many.",
    });

    expect(refusal(":20:EX\n".repeat(1_000_001))).toEqual(tooMany);
    expect(refusal("{4::20:\n".repeat(1_000_001))).toEqual(tooMany);
  });

  test("refuses a field longer than any bank writes, before splitting it", () => {
    const text = mt940(":61:261002D4,20NTRFNONREF", `:86:${"/BIC/".repeat(2001)}`);

    expect(refusal(text)).toEqual(
      new UnsupportedContent({
        line: 5,
        problem: "A :86: field of more than 10,000 characters: no statement writes one.",
      }),
    );

    expect(
      refusal(
        mt940(":61:261002D4,20NTRFNONREF", ":86:x", ...Array.from({ length: 5001 }, () => "a")),
      ),
    ).toEqual(
      new UnsupportedContent({
        line: 5,
        problem: "A :86: field of more than 10,000 characters: no statement writes one.",
      }),
    );
  });

  test("refuses a file with no :20: field", () => {
    expect(refusal("Date;Label;Amount\n02/10/2026;CB;-4,20\n")).toEqual(
      new NotAStatement({ format: "mt940" }),
    );
  });

  test("names the line of a statement line it cannot read", () => {
    expect(refusal(mt940(":61:2610XXD4,20NTRFNONREF"))).toEqual(
      new InvalidField({
        line: 4,
        field: ":61:",
        text: "2610XXD4,20NTRFNONREF",
        expected: "a statement line such as 2610031003D4,20NTRFNONREF//EX2026100301",
      }),
    );
  });

  test("names the line of a value date that is not a day", () => {
    expect(refusal(mt940(":61:260230D4,20NTRFNONREF"))).toEqual(
      new InvalidField({
        line: 4,
        field: ":61:",
        text: "260230",
        expected: "a value date such as 261003 (YYMMDD)",
      }),
    );
  });

  test("names the line of an amount with more decimals than the currency has", () => {
    expect(refusal(mt940(":61:261002D4,205NTRFNONREF"))).toEqual(
      new InvalidField({
        line: 4,
        field: ":61:",
        text: "4,205",
        expected: "an amount with at most 2 decimals, as EUR has",
      }),
    );
  });

  test("names the line of a balance it cannot read", () => {
    expect(refusal(mt940().replace(":60F:C261001EUR100,00", ":60F:C2610EUR100"))).toEqual(
      new InvalidField({
        line: 3,
        field: ":60F:",
        text: "C2610EUR100",
        expected: "a balance such as C261031EUR1234,56",
      }),
    );
  });

  test("names the statement that lacks its closing balance, as a file cut short does", () => {
    const text = mt940(":61:261002D4,20NTRFNONREF", ":86:CB EXEMPLE");

    expect(refusal(text.slice(0, text.indexOf(":62F:")))).toEqual(
      new MissingField({ line: 1, field: ":62F:" }),
    );
  });

  test("refuses a second account's statement, and a balance in another currency", () => {
    const second = `${mt940()}\r\n:20:EX02\r\n:25:${IBAN}\r\n:60F:C261001EUR1,00\r\n:62F:C261031EUR1,00`;

    expect(refusal(second)).toEqual(
      new UnsupportedContent({
        line: 5,
        problem: "A second account's statement: export one account per file.",
      }),
    );

    expect(refusal(mt940().replace(":62F:C261031EUR", ":62F:C261031USD"))).toEqual(
      new UnsupportedContent({
        line: 4,
        problem: "A balance in USD, while the account is in EUR.",
      }),
    );
  });
});
