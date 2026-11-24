import {
  closingBalanceMinor,
  exampleStatement,
  statementSamples,
  writeCamt053,
} from "@gousset/fixture";
import type { Statement as MadeUpStatement } from "@gousset/fixture";
import { Effect } from "effect";
import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

import { readCamt053 } from "./camt053";
import { dayBefore } from "./dates";
import {
  InvalidField,
  MalformedFile,
  MissingField,
  NotAStatement,
  UnsupportedContent,
} from "./errors";
import type { Statement } from "./statement";
import { madeUpStatements } from "./testing";

const read = (bytes: Uint8Array) => Effect.runSync(readCamt053(bytes));

const refusal = (text: string) =>
  Effect.runSync(Effect.flip(readCamt053(new TextEncoder().encode(text))));

const IBAN = "DE39999999990012345678";

/** The samples' account (`Acct/Id/IBAN`). */
const ACCOUNT = { iban: "FR7699999000010001234567809", number: null };

/**
 * What `writeCamt053` writes: the label as `Ustrd`, the reference as `AcctSvcrRef`, the value date
 * the booking date, the opening balance (`OPBD`) on the first day.
 */
function writtenByWriteCamt053(statement: MadeUpStatement): Statement {
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
    openingBalance: { amountMinor: statement.openingBalanceMinor, on: dayBefore(statement.from) },
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

// One test per sample file: the lines read are the lines the file holds.
describe("reading CAMT.053 files", () => {
  test("reads camt053-version-08.xml (001.08, the example statement)", () => {
    expect(read(statementSamples.camt053Version08.bytes)).toEqual(
      writtenByWriteCamt053(exampleStatement),
    );
  });

  test("reads camt053-version-02.xml (001.02, bank labels, parties, a reversal, PRCD)", () => {
    expect(read(statementSamples.camt053Version02.bytes)).toEqual({
      account: ACCOUNT,
      currency: "EUR",
      lines: [
        {
          ...line("2026-11-02", -2390, "CB PÂTISSERIE DU MARCHÉ 31/10", "EX2026110201"),
          valueOn: "2026-10-31",
        },
        {
          ...line("2026-11-03", 15_000, "VIR SEPA RECU /DE CAMILLE EXEMPLE", "EX2026110301"),
          memo: "REMBOURSEMENT NOËL PART DU CADEAU",
          counterparty: { name: "CAMILLE EXEMPLE", iban: IBAN },
        },
        {
          ...line("2026-11-05", -6412, "PRLV SEPA ÉLEC & GAZ EXEMPLE", "EX2026110501"),
          memo: "ECHEANCE NOVEMBRE",
          counterparty: { name: "ÉLEC & GAZ EXEMPLE", iban: null },
        },
        {
          ...line("2026-11-09", 6412, "RETOUR PRLV SEPA ÉLEC & GAZ EXEMPLE", "EX2026110901"),
          valueOn: "2026-11-05",
          counterparty: { name: "ÉLEC & GAZ EXEMPLE", iban: null },
        },
      ],
      openingBalance: { amountMinor: 152_030, on: "2026-10-31" },
      balance: { amountMinor: 164_640, on: "2026-11-30" },
    });
  });

  test("reads camt053-batch.xml (001.04, a batch entry, an overdrawn opening balance)", () => {
    expect(read(statementSamples.camt053Batch.bytes)).toEqual({
      account: ACCOUNT,
      currency: "EUR",
      lines: [
        {
          ...line("2026-11-02", 180_000, "SALAIRE NOVEMBRE 2026", "EX2026110201"),
          counterparty: { name: "ACME CONSEIL", iban: IBAN },
        },
        line("2026-11-05", -12_000, "PRLV SEPA REMISE DE 2 OPERATIONS", "EX2026110501"),
        {
          ...line("2026-11-12", -1890, "LIBRAIRIE EXEMPLE", "EX2026111201"),
          valueOn: null,
          counterparty: { name: "LIBRAIRIE EXEMPLE", iban: null },
        },
        { ...line("2026-11-20", -4500, "FACTURE 2026-0042", "EX2026112001"), valueOn: null },
        { ...line("2026-11-30", -250, "FRAIS TENUE DE COMPTE", null), valueOn: null },
      ],
      openingBalance: { amountMinor: -3520, on: "2026-10-31" },
      balance: { amountMinor: 157_840, on: "2026-11-30" },
    });
  });

  test("reads camt053-daily.xml (001.10, prefixed, two daily statements of one account)", () => {
    expect(read(statementSamples.camt053Daily.bytes)).toEqual({
      account: ACCOUNT,
      currency: "EUR",
      lines: [
        {
          ...line("2026-12-01", 2500, "REMBOURSEMENT CINÉMA & POP-CORN", "EX2026120101"),
          counterparty: { name: "CAMILLE EXEMPLE", iban: IBAN },
        },
        {
          ...line("2026-12-02", -420, "CB LE FOURNIL DES TILLEULS 01/12", "EX2026120201"),
          valueOn: "2026-12-01",
          counterparty: { name: "LE FOURNIL DES TILLEULS", iban: null },
        },
        {
          ...line("2026-12-02", -85_000, "PRLV SEPA SCI DES GLYCINES", "EX2026120202"),
          memo: "LOYER DECEMBRE",
          counterparty: { name: "SCI DES GLYCINES", iban: null },
        },
      ],
      openingBalance: { amountMinor: 50_000, on: "2026-11-30" },
      balance: { amountMinor: -32_920, on: "2026-12-02" },
    });
  });

  test("reads camt053-double-encoded.xml (entities encoded twice, and once) as the bank meant them", () => {
    expect(read(statementSamples.camt053DoubleEncoded.bytes)).toEqual({
      account: ACCOUNT,
      currency: "EUR",
      lines: [
        {
          ...line("2026-11-02", -450, "CB CAFE DE L'EXEMPLE", null),
          valueOn: null,
          memo: "TICKET L'EXEMPLE",
          counterparty: { name: "CAFE DE L'EXEMPLE & FILS", iban: null },
        },
        { ...line("2026-11-06", -890, "LIBRAIRIE L'ENCRE EXEMPLE", null), valueOn: null },
      ],
      openingBalance: null,
      balance: { amountMinor: 50_000, on: "2026-11-30" },
    });
  });

  test("reads the account's IBAN spaced and lower case, or its other identifier", () => {
    const spaced = camt().replace(
      "FR7699999000010001234567809",
      "fr76 9999 9000 0100 0123 4567 809",
    );

    expect(read(new TextEncoder().encode(spaced)).account).toEqual(ACCOUNT);

    const other = camt().replace(
      "<IBAN>FR7699999000010001234567809</IBAN>",
      "<Othr><Id> 00012345678 </Id></Othr>",
    );

    expect(read(new TextEncoder().encode(other)).account).toEqual({
      iban: null,
      number: "00012345678",
    });
  });

  test("reads back any statement writeCamt053 writes", () => {
    fc.assert(
      fc.property(madeUpStatements, (statement) => {
        const bytes = new TextEncoder().encode(writeCamt053(statement));

        expect(read(bytes)).toEqual(writtenByWriteCamt053(statement));
      }),
    );
  });
});

/** A statement of one account in euros whose entries start on line 6. */
function camt(...entries: ReadonlyArray<ReadonlyArray<string>>): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">',
    "<BkToCstmrStmt>",
    "<Stmt>",
    "<Acct><Id><IBAN>FR7699999000010001234567809</IBAN></Id><Ccy>EUR</Ccy></Acct>",
    ...entries.flat(),
    "</Stmt>",
    "</BkToCstmrStmt>",
    "</Document>",
  ].join("\n");
}

/** An entry on lines 6 to 10: its amount on line 7, its indicator on 8, its date on 9. */
function entry(amount: string, indicator: string, date: string): Array<string> {
  return [
    "<Ntry>",
    `<Amt Ccy="EUR">${amount}</Amt>`,
    `<CdtDbtInd>${indicator}</CdtDbtInd>`,
    `<BookgDt><Dt>${date}</Dt></BookgDt>`,
    "</Ntry>",
  ];
}

describe("refusing a CAMT.053 file", () => {
  test("refuses a file that is no CAMT.053 statement", () => {
    expect(refusal("Date;Label;Amount\n02/10/2026;CB;-4,20\n")).toEqual(
      new NotAStatement({ format: "camt053" }),
    );

    expect(refusal("<OFX><SIGNONMSGSRSV1/></OFX>")).toEqual(
      new NotAStatement({ format: "camt053" }),
    );
  });

  test("refuses an account report and a notification, which are no statement", () => {
    expect(refusal("<Document>\n<BkToCstmrAcctRpt/>\n</Document>")).toEqual(
      new UnsupportedContent({
        line: 2,
        problem: "A camt.052 account report: Gousset reads camt.053 statements.",
      }),
    );
  });

  test("names the line of an amount it cannot read", () => {
    expect(refusal(camt(entry("12,30", "DBIT", "2026-10-02")))).toEqual(
      new InvalidField({
        line: 7,
        field: "Amt",
        text: "12,30",
        expected: "an amount such as 1234.56",
      }),
    );

    expect(refusal(camt(entry("-12.30", "DBIT", "2026-10-02")))).toEqual(
      new InvalidField({
        line: 7,
        field: "Amt",
        text: "-12.30",
        expected: "an amount such as 1234.56",
      }),
    );
  });

  test("names the line of an indicator that is neither CRDT nor DBIT", () => {
    expect(refusal(camt(entry("12.30", "DEBIT", "2026-10-02")))).toEqual(
      new InvalidField({
        line: 8,
        field: "CdtDbtInd",
        text: "DEBIT",
        expected: "CRDT (money in) or DBIT (money out)",
      }),
    );
  });

  test("names the line of a date that is not a day", () => {
    expect(refusal(camt(entry("12.30", "DBIT", "2026-02-30")))).toEqual(
      new InvalidField({
        line: 9,
        field: "Dt",
        text: "2026-02-30",
        expected: "a date such as 2026-10-02 or 2026-10-02T10:30:00+01:00",
      }),
    );
  });

  test("names the entry that lacks its booking date or its indicator", () => {
    expect(
      refusal(
        camt(["<Ntry>", '<Amt Ccy="EUR">1.00</Amt>', "<CdtDbtInd>DBIT</CdtDbtInd>", "</Ntry>"]),
      ),
    ).toEqual(new MissingField({ line: 6, field: "BookgDt" }));

    expect(refusal(camt(["<Ntry>", '<Amt Ccy="EUR">1.00</Amt>', "</Ntry>"]))).toEqual(
      new MissingField({ line: 6, field: "CdtDbtInd" }),
    );
  });

  test("refuses an amount in another currency than the account's", () => {
    const text = camt(entry("12.30", "DBIT", "2026-10-02")).replace('Ccy="EUR"', 'Ccy="USD"');

    expect(refusal(text)).toEqual(
      new UnsupportedContent({
        line: 7,
        problem: 'An amount in "USD", while the account is in EUR.',
      }),
    );
  });

  test("refuses a second account's statement", () => {
    const text = camt().replace(
      "</Stmt>",
      `</Stmt>\n<Stmt>\n<Acct><Id><IBAN>${IBAN}</IBAN></Id><Ccy>EUR</Ccy></Acct>\n</Stmt>`,
    );

    expect(refusal(text)).toEqual(
      new UnsupportedContent({
        line: 7,
        problem: "A second account's statement: export one account per file.",
      }),
    );
  });

  test("refuses a document type declaration, so that no entity is ever expanded", () => {
    const text = camt().replace(
      "<Document",
      '<!DOCTYPE Document [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]>\n<Document',
    );

    expect(refusal(text)).toEqual(
      new UnsupportedContent({
        line: 2,
        problem:
          "A document type declaration (`<!DOCTYPE`): no statement has one, and none is read.",
      }),
    );
  });

  test("refuses elements nested deeper than any statement, with a typed error", () => {
    const deep = `<Document>${"<A>".repeat(10_000)}${"</A>".repeat(10_000)}</Document>`;

    expect(refusal(deep)).toEqual(
      new MalformedFile({
        line: 1,
        problem: "Elements nested more than 64 deep: no statement is.",
      }),
    );
  });

  test("reads a great many elements on one line in linear time", () => {
    const wide = `<Document><BkToCstmrStmt>${"<X/>".repeat(200_000)}</BkToCstmrStmt></Document>`;

    expect(refusal(wide)).toEqual(new MissingField({ line: 1, field: "Stmt" }));
  });

  test("reads a tag of a million characters without an attribute in linear time", () => {
    expect(refusal(`<Document x${"b".repeat(1_000_000)}/>`)).toEqual(
      new NotAStatement({ format: "camt053" }),
    );
  });

  test("reads attributes in either quotes, a > inside a value, and past what is no attribute", () => {
    const text = camt(entry("12.30", "DBIT", "2026-10-02")).replace(
      'Ccy="EUR"',
      "stray = Note='a > b' Ccy = 'USD'",
    );

    expect(refusal(text)).toEqual(
      new UnsupportedContent({
        line: 7,
        problem: 'An amount in "USD", while the account is in EUR.',
      }),
    );
  });

  test("refuses more elements than any statement holds before reading them, with a typed error", () => {
    expect(refusal(`<Document>${"<a/>".repeat(1_000_001)}</Document>`)).toEqual(
      new UnsupportedContent({
        line: 1,
        problem: "More than a million elements: no statement holds that many.",
      }),
    );
  });

  test("names the line of a closing tag that closes another element", () => {
    expect(refusal(camt(["<Ntry>", '<Amt Ccy="EUR">1.00</Ntry>']))).toEqual(
      new MalformedFile({
        line: 7,
        problem: '"</Ntry>" where "</Amt>" was expected, for the element opened on line 7.',
      }),
    );
  });

  test("refuses a file cut short, and text outside the document", () => {
    const text = camt();

    expect(refusal(text.slice(0, text.indexOf("</Stmt>")))).toEqual(
      new MalformedFile({
        line: 6,
        problem: 'The file ends before "</Stmt>": it may have been cut short.',
      }),
    );

    expect(refusal(`${text}\ntrailing`)).toEqual(
      new MalformedFile({ line: 9, problem: "Text outside the document's element." }),
    );
  });
});
