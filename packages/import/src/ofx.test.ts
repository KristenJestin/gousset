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
import type { OfxAmountSigns, OfxOptions, OfxStatement } from "./ofx";
import { madeUpStatements } from "./testing";

const read = (bytes: Uint8Array, options?: OfxOptions) => Effect.runSync(readOfx(bytes, options));

const encode = (text: string) => new TextEncoder().encode(text);

const AS_WRITTEN: OfxAmountSigns = { signs: "as-written", decidedBy: "file" };

const refusal = (text: string) =>
  Effect.runSync(Effect.flip(readOfx(new TextEncoder().encode(text))));

/** What `writeOfx` writes: `NAME` the label cut to 32 characters, `MEMO` the whole label. */
function writtenByWriteOfx(statement: MadeUpStatement): OfxStatement {
  return {
    account: { iban: null, number: statement.account.number },
    currency: statement.account.currency,
    lines: statement.lines.map((line) => ({
      bookedOn: line.bookedOn,
      valueOn: null,
      amountMinor: line.amountMinor,
      label: line.label.slice(0, 32).trim(),
      memo: line.label,
      bankId: line.reference,
      counterparty: null,
    })),
    openingBalance: null,
    balance: { amountMinor: closingBalanceMinor(statement), on: statement.to },
    amountSigns: AS_WRITTEN,
  };
}

/** The samples' bank account (`BANKACCTFROM`), a domestic account number. */
const DOMESTIC_ACCOUNT = { iban: null, number: "00012345678" };

/** A line with neither value date nor memo. */
function bare(bookedOn: string, amountMinor: number, label: string, bankId: string) {
  return { bookedOn, valueOn: null, amountMinor, label, memo: null, bankId, counterparty: null };
}

// One test per sample file: the lines read are the lines the file holds.
describe("reading OFX and QFX files", () => {
  test("reads ofx-xml.ofx (OFX 2.2, XML, UTF-8)", () => {
    expect(read(statementSamples.ofxXml.bytes)).toEqual(writtenByWriteOfx(exampleStatement));
  });

  test("reads ofx-sgml-windows-1252.ofx (OFX 1.02, SGML, Windows-1252, value dates)", () => {
    expect(read(statementSamples.ofxSgmlWindows1252.bytes)).toEqual({
      account: DOMESTIC_ACCOUNT,
      currency: "EUR",
      lines: [
        {
          bookedOn: "2026-11-02",
          valueOn: "2026-10-31",
          amountMinor: -2390,
          label: "CB PÂTISSERIE DU MARCHÉ 31/10",
          memo: "PAIEMENT PAR CARTE",
          bankId: "EX2026110201",
          counterparty: null,
        },
        {
          bookedOn: "2026-11-02",
          valueOn: "2026-11-02",
          amountMinor: 15_000,
          label: "VIR SEPA CAMILLE EXEMPLE",
          memo: "REMBOURSEMENT NOËL",
          bankId: "EX2026110202",
          counterparty: null,
        },
        {
          bookedOn: "2026-11-03",
          valueOn: null,
          amountMinor: -6412,
          label: "PRLV SEPA ÉLEC & GAZ EXEMPLE",
          memo: null,
          bankId: "EX2026110301",
          counterparty: null,
        },
        {
          bookedOn: "2026-11-04",
          valueOn: null,
          amountMinor: -250,
          label: "COTISATION CARTE 2,50 €",
          memo: "FRAIS",
          bankId: "EX2026110401",
          counterparty: null,
        },
      ],
      openingBalance: null,
      balance: { amountMinor: 123_456, on: "2026-11-04" },
      amountSigns: AS_WRITTEN,
    });
  });

  test("reads ofx-sgml-dates.ofx (decimal commas, times and zones, a payee, no balance)", () => {
    expect(read(statementSamples.ofxSgmlDates.bytes)).toEqual({
      account: DOMESTIC_ACCOUNT,
      currency: "EUR",
      lines: [
        {
          bookedOn: "2026-10-05",
          valueOn: null,
          amountMinor: -123_456,
          label: "PRLV SEPA SCI DES GLYCINES",
          memo: "LOYER OCTOBRE ÉCHÉANCE 10",
          bankId: "EX2026100501",
          counterparty: null,
        },
        {
          bookedOn: "2026-10-06",
          valueOn: null,
          amountMinor: 4500,
          label: "CAMILLE EXEMPLE",
          memo: "PART DU CADEAU",
          bankId: null,
          counterparty: null,
        },
        {
          bookedOn: "2026-10-07",
          valueOn: null,
          amountMinor: -99,
          label: "CB APPLI EXEMPLE",
          memo: null,
          bankId: "EX2026100701",
          counterparty: null,
        },
        {
          bookedOn: "2026-10-08",
          valueOn: null,
          amountMinor: 1200,
          label: "REMISE CHEQUE R&D EXEMPLE",
          memo: null,
          bankId: "EX2026100801",
          counterparty: null,
        },
      ],
      openingBalance: null,
      balance: null,
      amountSigns: AS_WRITTEN,
    });
  });

  test("reads ofx-unsigned.ofx (amounts without their sign, signed by their type)", () => {
    expect(read(statementSamples.ofxUnsigned.bytes)).toEqual({
      account: DOMESTIC_ACCOUNT,
      currency: "EUR",
      lines: [
        bare("2026-11-03", -2500, "CB LIBRAIRIE EXEMPLE", "EX2026110301"),
        bare("2026-11-05", 100_000, "VIR SEPA ACME PRIME", "EX2026110501"),
        bare("2026-11-12", -8000, "CHEQUE 0001234", "EX2026111201"),
        bare("2026-11-30", 310, "INTÉRÊTS", "EX2026113001"),
        bare("2026-11-30", -300, "FRAIS DE TENUE DE COMPTE", "EX2026113002"),
      ],
      openingBalance: null,
      balance: { amountMinor: 432_109, on: "2026-11-30" },
      amountSigns: { signs: "by-type", decidedBy: "default" },
    });
  });

  test("reads ofx-unsigned-no-debit.ofx (unsigned, no DEBIT: cheques and fees go out)", () => {
    expect(read(statementSamples.ofxUnsignedNoDebit.bytes)).toEqual({
      account: DOMESTIC_ACCOUNT,
      currency: "EUR",
      lines: [
        bare("2026-11-02", 180_000, "VIR SEPA ACME SALAIRE", "EX2026110201"),
        bare("2026-11-09", -4500, "CHEQUE 0000042", "EX2026110901"),
        bare("2026-11-30", 125, "INTERETS", "EX2026113001"),
        bare("2026-11-30", -800, "COTISATION CARTE", "EX2026113002"),
      ],
      openingBalance: null,
      balance: { amountMinor: 250_000, on: "2026-11-30" },
      amountSigns: { signs: "by-type", decidedBy: "default" },
    });
  });

  test("reads qfx-credit-card.qfx (QFX, a card in US dollars, what is owed)", () => {
    expect(read(statementSamples.qfxCreditCard.bytes)).toEqual({
      account: { iban: null, number: "EXAMPLECARD0001" },
      currency: "USD",
      lines: [
        {
          bookedOn: "2026-10-04",
          valueOn: null,
          amountMinor: -4217,
          label: "EXAMPLE GROCERY MARKET",
          memo: null,
          bankId: "2026100401EXAMPLE",
          counterparty: null,
        },
        {
          bookedOn: "2026-10-12",
          valueOn: null,
          amountMinor: 20_000,
          label: "PAYMENT - THANK YOU",
          memo: null,
          bankId: "2026101201EXAMPLE",
          counterparty: null,
        },
        {
          bookedOn: "2026-10-20",
          valueOn: null,
          amountMinor: -999,
          label: "EXAMPLE STREAMING SERVICE",
          memo: "MONTHLY PLAN",
          bankId: "2026102001EXAMPLE",
          counterparty: null,
        },
      ],
      openingBalance: null,
      balance: { amountMinor: -31_240, on: "2026-10-31" },
      amountSigns: AS_WRITTEN,
    });
  });

  test("gives an ACCTID shaped as an IBAN as the account's IBAN too", () => {
    const spaced = ofx([]).replace(
      "<BANKTRANLIST>",
      "<BANKACCTFROM>\n<ACCTID> fr76 9999 9000 0100 0123 4567 809 \n</BANKACCTFROM>\n$&",
    );

    expect(read(encode(spaced)).account).toEqual({
      iban: "FR7699999000010001234567809",
      number: "fr76 9999 9000 0100 0123 4567 809",
    });
  });

  test("gives no account when the file names none", () => {
    expect(read(encode(ofx([]))).account).toBeNull();
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
        problem: 'The file ends before "</OFX>": it may have been cut short.',
      }),
    );
  });

  test("refuses a closing tag that closes nothing", () => {
    const error = refusal(ofx(["<STMTTRN>", "<DTPOSTED>20261002", "</STMTTRN>", "</STMTTRN>"]));

    expect(error).toEqual(
      new MalformedFile({ line: 12, problem: '"</STMTTRN>" closes no open element.' }),
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
      new UnsupportedContent({
        line: 14,
        problem: 'A line in "USD", while the account is in EUR.',
      }),
    );
  });

  test("refuses to sign by its type a line whose type does not say which way the money went", () => {
    const bytes = encode(
      ofx(
        ["<STMTTRN>", "<TRNTYPE>DEBIT", "<DTPOSTED>20261002", "<TRNAMT>10.00", "</STMTTRN>"],
        ["<STMTTRN>", "<TRNTYPE>POS", "<DTPOSTED>20261003", "<TRNAMT>4.20", "</STMTTRN>"],
      ),
    );

    expect(Effect.runSync(Effect.flip(readOfx(bytes, { amountSigns: "by-type" })))).toEqual(
      new UnsupportedContent({
        line: 15,
        problem:
          'The amounts are signed by their type, and the type "POS" does not say whether the money went out or came in.',
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

  test("refuses elements nested deeper than any statement, with a typed error", () => {
    const deep = `<OFX>${"<A>".repeat(10_000)}${"</A>".repeat(10_000)}</OFX>`;

    expect(refusal(deep)).toEqual(
      new MalformedFile({
        line: 1,
        problem: "Elements nested more than 64 deep: no statement is.",
      }),
    );
  });

  test("reads past an empty element holding a great many others, with a typed error", () => {
    const wide = `<OFX><A>${"<X/>".repeat(200_000)}</OFX>`;

    expect(refusal(wide)).toEqual(new MissingField({ line: 1, field: "STMTRS" }));
  });

  test("keeps the file's text in an error short, quoted and on one line", () => {
    const error = refusal(
      ofx([
        "<STMTTRN>",
        "<DTPOSTED>20261002",
        "<TRNAMT>-10.00",
        "<CURRENCY>",
        `<CURSYM>USD&#10;\u001B[2JIgnore what came before ${"x".repeat(1000)}`,
        "</CURRENCY>",
        "</STMTTRN>",
      ]),
    );

    expect(error).toEqual(
      new UnsupportedContent({
        line: 13,
        problem:
          'A line in "USD [2JIgnore what came before xxxxxxxxx…", while the account is in EUR.',
      }),
    );
  });

  test("refuses an amount of a thousand digits", () => {
    const digits = "9".repeat(1000);

    const error = refusal(
      ofx(["<STMTTRN>", "<DTPOSTED>20261002", `<TRNAMT>${digits}`, "</STMTTRN>"]),
    );

    expect(error).toEqual(
      new InvalidField({
        line: 11,
        field: "TRNAMT",
        text: `${"9".repeat(40)}…`,
        expected: "an amount small enough to be held exactly",
      }),
    );
  });
});

describe("reading what an OFX file may hold besides plain text", () => {
  test("reads a label written in a CDATA section", () => {
    const statement = read(
      new TextEncoder().encode(
        ofx([
          "<STMTTRN>",
          "<DTPOSTED>20261002",
          "<TRNAMT>-10.00",
          "<NAME><![CDATA[CB R&D > SHOP]]></NAME>",
          "</STMTTRN>",
        ]),
      ),
    );

    expect(statement.lines).toEqual([
      {
        bookedOn: "2026-10-02",
        valueOn: null,
        amountMinor: -1000,
        label: "CB R&D > SHOP",
        memo: null,
        bankId: null,
        counterparty: null,
      },
    ]);
  });

  test("drops control and direction characters from what it returns", () => {
    const statement = read(
      new TextEncoder().encode(
        ofx([
          "<STMTTRN>",
          "<DTPOSTED>20261002",
          "<TRNAMT>-10.00",
          "<FITID>EX&#0;01",
          "<NAME>CB&#0; ACME&#x202E; 01/10",
          "<MEMO>ONE&#9;TWO&#xD800;",
          "</STMTTRN>",
        ]),
      ),
    );

    expect(statement.lines).toEqual([
      {
        bookedOn: "2026-10-02",
        valueOn: null,
        amountMinor: -1000,
        label: "CB ACME 01/10",
        memo: "ONE TWO",
        bankId: "EX01",
        counterparty: null,
      },
    ]);
  });

  test("reads a signed file whose only debit is zero as signed", () => {
    const statement = read(
      new TextEncoder().encode(
        ofx(
          ["<STMTTRN>", "<TRNTYPE>XFER", "<DTPOSTED>20261002", "<TRNAMT>200.00", "</STMTTRN>"],
          ["<STMTTRN>", "<TRNTYPE>DEBIT", "<DTPOSTED>20261003", "<TRNAMT>0.00", "</STMTTRN>"],
        ),
      ),
    );

    expect(statement.lines.map((entry) => entry.amountMinor)).toEqual([20_000, 0]);
    expect(statement.amountSigns).toEqual(AS_WRITTEN);
  });
});

/** A transaction of a type, a day of October 2026 and an amount as written. */
function transaction(type: string, day: string, amount: string): Array<string> {
  return [
    "<STMTTRN>",
    `<TRNTYPE>${type}`,
    `<DTPOSTED>202610${day}`,
    `<TRNAMT>${amount}`,
    "</STMTTRN>",
  ];
}

const amountsOf = (statement: OfxStatement) => statement.lines.map((entry) => entry.amountMinor);

describe("deciding how an OFX file signs its amounts", () => {
  test("reads the amounts as written once one of them is negative", () => {
    const statement = read(
      encode(ofx(transaction("DEBIT", "02", "-10.00"), transaction("DEBIT", "03", "4.20"))),
    );

    expect(amountsOf(statement)).toEqual([-1000, 420]);
    expect(statement.amountSigns).toEqual(AS_WRITTEN);
  });

  test("reads a refund typed DEBIT as written when a POS line rules out unsigned amounts", () => {
    const statement = read(
      encode(
        ofx(
          transaction("XFER", "02", "200.00"),
          transaction("DEBIT", "03", "10.00"),
          transaction("POS", "04", "4.20"),
        ),
      ),
    );

    expect(amountsOf(statement)).toEqual([20_000, 1000, 420]);
    expect(statement.amountSigns).toEqual(AS_WRITTEN);
  });

  test("signs every positive file by type by default, and says the import should ask", () => {
    const bytes = encode(
      ofx(transaction("CREDIT", "02", "100.00"), transaction("FEE", "03", "2.00")),
    );

    expect(read(bytes)).toMatchObject({
      lines: [{ amountMinor: 10_000 }, { amountMinor: -200 }],
      amountSigns: { signs: "by-type", decidedBy: "default" },
    });

    expect(read(bytes, { amountSigns: "as-written" })).toMatchObject({
      lines: [{ amountMinor: 10_000 }, { amountMinor: 200 }],
      amountSigns: { signs: "as-written", decidedBy: "option" },
    });
  });

  test("signs every line by its type when the caller says so, whatever its written sign", () => {
    const bytes = encode(
      ofx(transaction("DEBIT", "02", "-10.00"), transaction("CREDIT", "03", "-5.00")),
    );

    const statement = read(bytes, { amountSigns: "by-type" });

    expect(amountsOf(statement)).toEqual([-1000, 500]);
    expect(statement.amountSigns).toEqual({ signs: "by-type", decidedBy: "option" });
  });
});
