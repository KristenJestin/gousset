import {
  closingBalanceMinor,
  exampleStatement,
  statementSamples,
  writeOfx,
} from "@gousset/fixture";
import type { Statement as MadeUpStatement } from "@gousset/fixture";
import { Effect } from "effect";
import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

import {
  InvalidField,
  MalformedFile,
  MissingField,
  NotAStatement,
  UnsupportedContent,
} from "./errors";
import { readOfx } from "./ofx";
import type { Statement } from "./statement";
import { madeUpStatements } from "./testing";

const read = (bytes: Uint8Array) => Effect.runSync(readOfx(bytes));

const refusal = (text: string) =>
  Effect.runSync(Effect.flip(readOfx(new TextEncoder().encode(text))));

/** What `writeOfx` writes: `NAME` the label cut to 32 characters, `MEMO` the whole label. */
function writtenByWriteOfx(statement: MadeUpStatement): Statement {
  return {
    currency: statement.account.currency,
    lines: statement.lines.map((line) => ({
      bookedOn: line.bookedOn,
      valueOn: null,
      amountMinor: line.amountMinor,
      label: line.label.slice(0, 32).trim(),
      memo: line.label,
      bankId: line.reference,
    })),
    balance: { amountMinor: closingBalanceMinor(statement), on: statement.to },
  };
}

/** A line with neither value date nor memo. */
function bare(bookedOn: string, amountMinor: number, label: string, bankId: string) {
  return { bookedOn, valueOn: null, amountMinor, label, memo: null, bankId };
}

// One test per sample file: the lines read are the lines the file holds.
describe("reading OFX and QFX files", () => {
  test("reads ofx-xml.ofx (OFX 2.2, XML, UTF-8)", () => {
    expect(read(statementSamples.ofxXml.bytes)).toEqual(writtenByWriteOfx(exampleStatement));
  });

  test("reads ofx-sgml-windows-1252.ofx (OFX 1.02, SGML, Windows-1252, value dates)", () => {
    expect(read(statementSamples.ofxSgmlWindows1252.bytes)).toEqual({
      currency: "EUR",
      lines: [
        {
          bookedOn: "2026-11-02",
          valueOn: "2026-10-31",
          amountMinor: -2390,
          label: "CB PÂTISSERIE DU MARCHÉ 31/10",
          memo: "PAIEMENT PAR CARTE",
          bankId: "EX2026110201",
        },
        {
          bookedOn: "2026-11-02",
          valueOn: "2026-11-02",
          amountMinor: 15_000,
          label: "VIR SEPA CAMILLE EXEMPLE",
          memo: "REMBOURSEMENT NOËL",
          bankId: "EX2026110202",
        },
        {
          bookedOn: "2026-11-03",
          valueOn: null,
          amountMinor: -6412,
          label: "PRLV SEPA ÉLEC & GAZ EXEMPLE",
          memo: null,
          bankId: "EX2026110301",
        },
        {
          bookedOn: "2026-11-04",
          valueOn: null,
          amountMinor: -250,
          label: "COTISATION CARTE 2,50 €",
          memo: "FRAIS",
          bankId: "EX2026110401",
        },
      ],
      balance: { amountMinor: 123_456, on: "2026-11-04" },
    });
  });

  test("reads ofx-sgml-dates.ofx (decimal commas, times and zones, a payee, no balance)", () => {
    expect(read(statementSamples.ofxSgmlDates.bytes)).toEqual({
      currency: "EUR",
      lines: [
        {
          bookedOn: "2026-10-05",
          valueOn: null,
          amountMinor: -123_456,
          label: "PRLV SEPA SCI DES GLYCINES",
          memo: "LOYER OCTOBRE ÉCHÉANCE 10",
          bankId: "EX2026100501",
        },
        {
          bookedOn: "2026-10-06",
          valueOn: null,
          amountMinor: 4500,
          label: "CAMILLE EXEMPLE",
          memo: "PART DU CADEAU",
          bankId: null,
        },
        {
          bookedOn: "2026-10-07",
          valueOn: null,
          amountMinor: -99,
          label: "CB APPLI EXEMPLE",
          memo: null,
          bankId: "EX2026100701",
        },
        {
          bookedOn: "2026-10-08",
          valueOn: null,
          amountMinor: 1200,
          label: "REMISE CHEQUE R&D EXEMPLE",
          memo: null,
          bankId: "EX2026100801",
        },
      ],
      balance: null,
    });
  });

  test("reads ofx-unsigned.ofx (amounts without their sign, signed by their type)", () => {
    expect(read(statementSamples.ofxUnsigned.bytes)).toEqual({
      currency: "EUR",
      lines: [
        bare("2026-11-03", -2500, "CB LIBRAIRIE EXEMPLE", "EX2026110301"),
        bare("2026-11-05", 100_000, "VIR SEPA ACME PRIME", "EX2026110501"),
        bare("2026-11-12", -8000, "CHEQUE 0001234", "EX2026111201"),
        bare("2026-11-30", 310, "INTÉRÊTS", "EX2026113001"),
        bare("2026-11-30", -300, "FRAIS DE TENUE DE COMPTE", "EX2026113002"),
      ],
      balance: { amountMinor: 432_109, on: "2026-11-30" },
    });
  });

  test("reads qfx-credit-card.qfx (QFX, a card in US dollars, what is owed)", () => {
    expect(read(statementSamples.qfxCreditCard.bytes)).toEqual({
      currency: "USD",
      lines: [
        {
          bookedOn: "2026-10-04",
          valueOn: null,
          amountMinor: -4217,
          label: "EXAMPLE GROCERY MARKET",
          memo: null,
          bankId: "2026100401EXAMPLE",
        },
        {
          bookedOn: "2026-10-12",
          valueOn: null,
          amountMinor: 20_000,
          label: "PAYMENT - THANK YOU",
          memo: null,
          bankId: "2026101201EXAMPLE",
        },
        {
          bookedOn: "2026-10-20",
          valueOn: null,
          amountMinor: -999,
          label: "EXAMPLE STREAMING SERVICE",
          memo: "MONTHLY PLAN",
          bankId: "2026102001EXAMPLE",
        },
      ],
      balance: { amountMinor: -31_240, on: "2026-10-31" },
    });
  });

  test("reads back any statement writeOfx writes", () => {
    fc.assert(
      fc.property(madeUpStatements, (statement) => {
        const bytes = new TextEncoder().encode(writeOfx(statement));

        expect(read(bytes)).toEqual(writtenByWriteOfx(statement));
      }),
    );
  });
});

/** A bank statement whose transactions start on line 9. */
function ofx(...transactions: ReadonlyArray<ReadonlyArray<string>>): string {
  return [
    "OFXHEADER:100",
    "",
    "<OFX>",
    "<BANKMSGSRSV1>",
    "<STMTTRNRS>",
    "<STMTRS>",
    "<CURDEF>EUR",
    "<BANKTRANLIST>",
    ...transactions.flat(),
    "</BANKTRANLIST>",
    "</STMTRS>",
    "</STMTTRNRS>",
    "</BANKMSGSRSV1>",
    "</OFX>",
  ].join("\n");
}

const DATE_EXAMPLE = "a date such as 20261002 or 20261002120000[+1:CET]";

describe("refusing an OFX file", () => {
  test("refuses a file with no OFX in it", () => {
    expect(refusal("Date;Label;Amount\n02/10/2026;CB;-4,20\n")).toEqual(
      new NotAStatement({ format: "ofx" }),
    );
  });

  test("names the line of an amount it cannot read", () => {
    const error = refusal(ofx(["<STMTTRN>", "<DTPOSTED>20261002", "<TRNAMT>12.3.4", "</STMTTRN>"]));

    expect(error).toEqual(
      new InvalidField({
        line: 11,
        field: "TRNAMT",
        text: "12.3.4",
        expected: "an amount such as -1234.56 or -1234,56",
      }),
    );
  });

  test("names the line of a date that is not a day", () => {
    const error = refusal(ofx(["<STMTTRN>", "<DTPOSTED>20260230", "<TRNAMT>-1.00", "</STMTTRN>"]));

    expect(error).toEqual(
      new InvalidField({ line: 10, field: "DTPOSTED", text: "20260230", expected: DATE_EXAMPLE }),
    );
  });

  test("names the transaction that lacks its date", () => {
    const error = refusal(ofx(["<STMTTRN>", "<TRNAMT>-1.00", "</STMTTRN>"]));

    expect(error).toEqual(new MissingField({ line: 9, field: "DTPOSTED" }));
  });

  test("refuses a file cut short", () => {
    const text = ofx(["<STMTTRN>", "<DTPOSTED>20261002", "<TRNAMT>-1.00", "</STMTTRN>"]);
    const cut = text.slice(0, text.indexOf("</BANKTRANLIST>"));

    expect(refusal(cut)).toEqual(
      new MalformedFile({
        line: 13,
        problem: "The file ends before </OFX>: it may have been cut short.",
      }),
    );
  });

  test("refuses a closing tag that closes nothing", () => {
    const error = refusal(ofx(["<STMTTRN>", "<DTPOSTED>20261002", "</STMTTRN>", "</STMTTRN>"]));

    expect(error).toEqual(
      new MalformedFile({ line: 12, problem: "</STMTTRN> closes no open element." }),
    );
  });

  test("refuses a line in another currency than the account's", () => {
    const error = refusal(
      ofx([
        "<STMTTRN>",
        "<DTPOSTED>20261002",
        "<TRNAMT>-10.00",
        "<CURRENCY>",
        "<CURRATE>1.08",
        "<CURSYM>USD",
        "</CURRENCY>",
        "</STMTTRN>",
      ]),
    );

    expect(error).toEqual(
      new UnsupportedContent({ line: 14, problem: "A line in USD, while the account is in EUR." }),
    );
  });

  test("refuses an unsigned amount whose type does not say which way the money went", () => {
    const error = refusal(
      ofx(
        ["<STMTTRN>", "<TRNTYPE>DEBIT", "<DTPOSTED>20261002", "<TRNAMT>10.00", "</STMTTRN>"],
        ["<STMTTRN>", "<TRNTYPE>POS", "<DTPOSTED>20261003", "<TRNAMT>4.20", "</STMTTRN>"],
      ),
    );

    expect(error).toEqual(
      new UnsupportedContent({
        line: 15,
        problem:
          'The file\'s amounts carry no sign, and the type "POS" does not say whether the money went out or came in.',
      }),
    );
  });

  test("refuses two accounts in one file, and an investment statement", () => {
    const twice = ofx([]).replace("</OFX>", "<STMTRS></STMTRS>\n$&");

    expect(refusal(twice)).toEqual(
      new UnsupportedContent({
        line: 13,
        problem: "A second account's statement: export one account per file.",
      }),
    );

    const investment = ofx([]).replaceAll("STMTRS>", "INVSTMTRS>");

    expect(refusal(investment)).toEqual(
      new UnsupportedContent({
        line: 6,
        problem: "An investment statement: Gousset reads bank and card statements.",
      }),
    );
  });
});
