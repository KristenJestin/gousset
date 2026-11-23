import {
  csvSamples,
  encodeWindows1252,
  exampleStatement,
  statementSamples,
  writeCsv,
} from "@gousset/fixture";
import { Effect, Schema } from "effect";
import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

import { readCsv, readCsvHeader } from "./csv";
import { detectCsvProfile } from "./csv-detect";
import { CsvProfile, dayReader } from "./csv-profile";
import {
  InvalidField,
  InvalidOption,
  MalformedFile,
  MissingField,
  NotAStatement,
  UnsupportedContent,
} from "./errors";
import { madeUpStatements } from "./testing";

const utf8 = new TextEncoder();

/** The profile of `csvSemicolon`, as `writeCsv` writes: `Date;Libelle;Montant;Devise;Reference`. */
const semicolon: CsvProfile = {
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
    amount: { kind: "signed", column: 3 },
    label: 2,
    memo: null,
    bankId: 5,
    currency: 4,
  },
};

const debitCredit: CsvProfile = {
  version: 1,
  separator: ";",
  encoding: "windows-1252",
  skipRows: 3,
  headerRow: true,
  dateFormat: "DD/MM/YYYY",
  decimalMark: ",",
  columns: {
    bookedOn: 1,
    valueOn: 2,
    amount: { kind: "debit-credit", debit: 4, credit: 5 },
    label: 3,
    memo: null,
    bankId: null,
    currency: null,
  },
};

const comma: CsvProfile = {
  version: 1,
  separator: ",",
  encoding: "utf8",
  skipRows: 0,
  headerRow: true,
  dateFormat: "MM/DD/YYYY",
  decimalMark: ".",
  columns: {
    bookedOn: 1,
    valueOn: null,
    amount: { kind: "signed", column: 4 },
    label: 2,
    memo: 3,
    bankId: 5,
    currency: null,
  },
};

const tabNoHeader: CsvProfile = {
  version: 1,
  separator: "\t",
  encoding: "utf8",
  skipRows: 0,
  headerRow: false,
  dateFormat: "DD.MM.YY",
  decimalMark: ",",
  columns: {
    bookedOn: 1,
    valueOn: null,
    amount: { kind: "signed", column: 3 },
    label: 2,
    memo: null,
    bankId: null,
    currency: null,
  },
};

const pipe: CsvProfile = {
  version: 1,
  separator: "|",
  encoding: "utf8",
  skipRows: 0,
  headerRow: true,
  dateFormat: "YYYY-MM-DD",
  decimalMark: ".",
  columns: {
    bookedOn: 1,
    valueOn: 2,
    amount: { kind: "debit-credit", debit: 6, credit: 7 },
    label: 4,
    memo: 5,
    bankId: 3,
    currency: null,
  },
};

const read = (bytes: Uint8Array, profile: CsvProfile, currency = "EUR") =>
  Effect.runSync(readCsv(bytes, profile, { currency }));

const refusal = (text: string, profile: CsvProfile = semicolon) =>
  Effect.runSync(Effect.flip(readCsv(utf8.encode(text), profile, { currency: "EUR" })));

const detect = (bytes: Uint8Array) => Effect.runSync(detectCsvProfile(bytes));

const detectText = (text: string) => detect(utf8.encode(text));

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

const HEADER = "Date;Libelle;Montant;Devise;Reference";

/** The days of a line that gives both. */
function days(bookedOn: string, valueOn: string) {
  return { bookedOn, valueOn };
}

/** `debitCredit` over UTF-8 text with no lines to skip, for the refusals. */
const debitCreditInline = { ...debitCredit, encoding: "utf8", skipRows: 0 } satisfies CsvProfile;

const DEBIT_CREDIT_HEADER = "Date;Valeur;Libellé;Débit;Crédit";

// One test per sample file: the lines read are the lines the file holds.
describe("reading CSV files with a profile", () => {
  test("reads csv-semicolon.csv (UTF-8, semicolons, a currency column, the bank's ids)", () => {
    expect(read(csvSamples.csvSemicolon.bytes, semicolon)).toEqual({
      account: null,
      currency: "EUR",
      lines: exampleStatement.lines.map((madeUp) => ({
        ...line(madeUp.bookedOn, madeUp.amountMinor, madeUp.label),
        bankId: madeUp.reference,
      })),
      openingBalance: null,
      balance: null,
    });
  });

  test("reads csv-debit-credit.csv (Windows-1252, lines skipped, debit and credit, value dates)", () => {
    expect(read(csvSamples.csvDebitCredit.bytes, debitCredit)).toEqual({
      account: null,
      currency: "EUR",
      lines: [
        { ...line("2026-11-02", -2390, "CB PÂTISSERIE DU MARCHÉ 31/10"), valueOn: "2026-10-31" },
        { ...line("2026-11-02", 15_000, "VIR SEPA CAMILLE EXEMPLE"), valueOn: "2026-11-02" },
        {
          ...line("2026-11-05", -123_456, "PRLV SEPA SCI DES GLYCINES; LOYER"),
          valueOn: "2026-11-05",
        },
        { ...line("2026-11-10", 245_000, "VIR SEPA ACME CONSEIL SALAIRE"), valueOn: "2026-11-10" },
        { ...line("2026-11-30", -250, "COTISATION CARTE 2,50 €"), valueOn: "2026-11-30" },
      ],
      openingBalance: null,
      balance: null,
    });
  });

  test("reads csv-comma.csv (a byte order mark, month first, quotes, a line break in a memo)", () => {
    expect(read(csvSamples.csvComma.bytes, comma, "USD")).toEqual({
      account: null,
      currency: "USD",
      lines: [
        {
          ...line("2026-10-01", -135_000, "EXAMPLE PROPERTY MANAGEMENT"),
          memo: "October rent, unit 4",
          bankId: "TX0001",
        },
        { ...line("2026-10-03", -4217, 'THE "EXAMPLE" DINER'), bankId: "TX0002" },
        {
          ...line("2026-10-15", 234_567, "EXAMPLE CORP PAYROLL"),
          memo: "Pay period 10/01 - 10/15",
          bankId: "TX0003",
        },
        { ...line("2026-10-20", -999, "EXAMPLE STREAMING SERVICE"), bankId: "TX0004" },
      ],
      openingBalance: null,
      balance: null,
    });
  });

  test("reads csv-tab-no-header.csv (tabs, no header, two-digit years, 1.234,56)", () => {
    expect(read(csvSamples.csvTabNoHeader.bytes, tabNoHeader)).toEqual({
      account: null,
      currency: "EUR",
      lines: [
        line("2026-10-01", -123_456, "REISEBÜRO BEISPIEL"),
        line("2026-10-15", -4590, "TANKSTELLE BEISPIEL"),
        line("2026-10-31", 128_046, "ZAHLUNG DANKE"),
      ],
      openingBalance: null,
      balance: null,
    });
  });

  test("reads csv-pipe.csv (pipes, ISO dates, lone CRs, negative debits, a zero credit)", () => {
    expect(read(csvSamples.csvPipe.bytes, pipe)).toEqual({
      account: null,
      currency: "EUR",
      lines: [
        {
          ...days("2026-11-02", "2026-11-02"),
          amountMinor: -2500,
          label: "EXAMPLE BOOKSHOP",
          memo: "Card payment",
          bankId: "REF-0001",
          counterparty: null,
        },
        {
          ...days("2026-11-05", "2026-11-04"),
          amountMinor: 100_000,
          label: "ACME BONUS",
          memo: null,
          bankId: "REF-0002",
          counterparty: null,
        },
        {
          ...days("2026-11-12", "2026-11-12"),
          amountMinor: -8000,
          label: "CHEQUE 0001234",
          memo: "Cheque",
          bankId: "REF-0003",
          counterparty: null,
        },
        {
          ...days("2026-11-30", "2026-11-30"),
          amountMinor: 310,
          label: "INTEREST",
          memo: "Monthly interest",
          bankId: "REF-0004",
          counterparty: null,
        },
      ],
      openingBalance: null,
      balance: null,
    });
  });

  test("reads back any statement writeCsv writes", () => {
    fc.assert(
      fc.property(madeUpStatements, (statement) => {
        expect(read(utf8.encode(writeCsv(statement)), semicolon)).toEqual({
          account: null,
          currency: "EUR",
          lines: statement.lines.map((madeUp) => ({
            ...line(madeUp.bookedOn, madeUp.amountMinor, madeUp.label),
            bankId: madeUp.reference,
          })),
          openingBalance: null,
          balance: null,
        });
      }),
    );
  });

  test("reads every date format a profile can name", () => {
    const day = "2026-10-03";

    const formats = {
      "DD/MM/YYYY": "03/10/2026",
      "MM/DD/YYYY": "10/3/2026",
      "DD.MM.YY": "3.10.26",
      "MM-DD-YY": "10-03-26",
      "YYYY-MM-DD": "2026-10-03",
      "YYYY/MM/DD": "2026/10/3",
      "DD MM YYYY": "03 10 2026",
      YYYYMMDD: "20261003",
      DDMMYY: "031026",
    };

    for (const [format, text] of Object.entries(formats)) {
      expect([format, dayReader(format)(text)]).toEqual([format, day]);
    }

    expect(dayReader("YYYYMMDD")("2026103")).toBeUndefined();
    expect(dayReader("DD/MM/YYYY")("30/02/2026")).toBeUndefined();
    expect(dayReader("DD/MM/YY")("03/10/71")).toBe("1971-10-03");
  });

  test("gives the normalised header a profile keeps to recognise its files", () => {
    expect(Effect.runSync(readCsvHeader(csvSamples.csvDebitCredit.bytes, debitCredit))).toBe(
      "date;date de valeur;libellé;débit;crédit",
    );

    expect(Effect.runSync(readCsvHeader(csvSamples.csvTabNoHeader.bytes, tabNoHeader))).toBeNull();
  });
});

describe("an import profile as a file", () => {
  const decode = Schema.decodeUnknownSync(Schema.fromJsonString(CsvProfile));

  test("reads back every profile written as JSON, to be shared", () => {
    for (const profile of [semicolon, debitCredit, comma, tabNoHeader, pipe]) {
      expect(decode(JSON.stringify(profile))).toEqual(profile);
    }
  });

  test("refuses a profile that names no column, a date format it cannot read or a version", () => {
    const columns = { ...semicolon.columns, label: 0 };

    for (const wrong of [
      { ...semicolon, columns },
      { ...semicolon, dateFormat: "DD/DD/YYYY" },
      { ...semicolon, dateFormat: "DD/MM-YYYY" },
      { ...semicolon, separator: "#" },
      { ...semicolon, version: 2 },
    ]) {
      expect(() => decode(JSON.stringify(wrong))).toThrow();
    }
  });
});

describe("refusing a CSV file", () => {
  test("names the line and the column of a date it cannot read", () => {
    expect(refusal(`${HEADER}\n02/10/2026;A;1,00;EUR;R1\n2026-10-03;B;2,00;EUR;R2\n`)).toEqual(
      new InvalidField({
        line: 3,
        column: 1,
        field: "bookedOn",
        text: "2026-10-03",
        expected: "a date written DD/MM/YYYY, such as 03/10/2026",
      }),
    );
  });

  test("names the line and the column of an amount it cannot read", () => {
    expect(refusal(`${HEADER}\n02/10/2026;A;12.34;EUR;R1\n`)).toEqual(
      new InvalidField({
        line: 2,
        column: 3,
        field: "amount",
        text: "12.34",
        expected: "an amount such as -1234,56 or -1 234,56",
      }),
    );
  });

  test("names the line and the column of a missing date or amount", () => {
    expect(refusal(`${HEADER}\n;A;1,00;EUR;R1\n`)).toEqual(
      new MissingField({ line: 2, column: 1, field: "bookedOn" }),
    );

    expect(refusal(`${HEADER}\n02/10/2026;A\n`)).toEqual(
      new MissingField({ line: 2, column: 3, field: "amount" }),
    );
  });

  test("counts lines past the skipped ones and the line breaks inside quoted values", () => {
    const text = `Account\nPeriod\n${HEADER}\n02/10/2026;"two\r\nlines";1,00;EUR;R1\n03/10/2026;B;oops;EUR;R2\n`;

    expect(refusal(text, { ...semicolon, skipRows: 2 })).toEqual(
      new InvalidField({
        line: 6,
        column: 3,
        field: "amount",
        text: "oops",
        expected: "an amount such as -1234,56 or -1 234,56",
      }),
    );
  });

  test("refuses a line in another currency than the account's", () => {
    expect(refusal(`${HEADER}\n02/10/2026;A;1,00;eur;R1\n02/10/2026;B;1,00;USD;R2\n`)).toEqual(
      new UnsupportedContent({
        line: 3,
        column: 4,
        problem: 'A line in "USD", in a file read for an account in EUR.',
      }),
    );
  });

  test("refuses a header with fewer columns than the profile reads: another separator", () => {
    expect(refusal('Date,Libelle,Montant,Devise,Reference\n02/10/2026,A,"1,00",EUR,R1\n')).toEqual(
      new MalformedFile({
        line: 1,
        problem:
          "Column 5 is past the header's last (column 1): the file may be another bank's, or its separator another.",
      }),
    );
  });

  test("refuses a file with no header row where the profile reads one", () => {
    const none = new MalformedFile({
      line: 1,
      problem: "No header row: the file holds nothing past the lines the profile skips.",
    });

    expect(refusal("")).toEqual(none);

    // A file of line breaks alone builds no row (README, "Errors"), however large it is.
    const blank = new Uint8Array(8 * 1024 * 1024).fill(0x0a);

    expect(Effect.runSync(Effect.flip(readCsv(blank, semicolon, { currency: "EUR" })))).toEqual(
      none,
    );
  });

  test("names the line and the column of a quoted value that never ends", () => {
    expect(refusal(`${HEADER}\n02/10/2026;"A;1,00;EUR;R1\n03/10/2026;B;1,00;EUR;R2\n`)).toEqual(
      new MalformedFile({
        line: 2,
        column: 2,
        problem: "A quoted value that never ends: the file may be cut short.",
      }),
    );
  });

  test("names the line and the column of text after a closing quote", () => {
    expect(refusal(`${HEADER}\n02/10/2026;"A"B;1,00;EUR;R1\n`)).toEqual(
      new MalformedFile({
        line: 2,
        column: 2,
        problem:
          'Text after a quoted value\'s closing quote: a quote inside a value is written twice ("").',
      }),
    );
  });

  test("names the line of bytes that are not UTF-8 in a file said to be", () => {
    const bytes = encodeWindows1252(
      `${HEADER}\r\n02/10/2026;A;1,00;EUR;R1\r\n03/10/2026;É;1,00;EUR;R2\r\n`,
    );

    expect(Effect.runSync(Effect.flip(readCsv(bytes, semicolon, { currency: "EUR" })))).toEqual(
      new MalformedFile({
        line: 3,
        problem: "Bytes that are not UTF-8, in a file the profile says is: it may be Windows-1252.",
      }),
    );
  });

  test("refuses a line with both a debit and a credit, or neither", () => {
    const profile = debitCreditInline;
    const header = DEBIT_CREDIT_HEADER;

    expect(refusal(`${header}\n02/11/2026;02/11/2026;A;1,00;2,00\n`, profile)).toEqual(
      new UnsupportedContent({
        line: 2,
        column: 5,
        problem:
          "A debit (column 4) and a credit (column 5) on one line: a line fills one of them.",
      }),
    );

    expect(refusal(`${header}\n02/11/2026;02/11/2026;A;;\n`, profile)).toEqual(
      new MissingField({ line: 2, column: 4, field: "debit" }),
    );
  });

  test("refuses debits signed both ways, and a negative credit", () => {
    const profile = debitCreditInline;
    const header = DEBIT_CREDIT_HEADER;

    expect(
      refusal(
        `${header}\n02/11/2026;;A;1,00;\n03/11/2026;;B;;1,00\n04/11/2026;;C;-2,00;\n`,
        profile,
      ),
    ).toEqual(
      new UnsupportedContent({
        line: 4,
        column: 4,
        problem:
          "A debit signed otherwise than the one at line 2: which way the money went cannot be told.",
      }),
    );

    expect(refusal(`${header}\n02/11/2026;;A;;-1,00\n`, profile)).toEqual(
      new InvalidField({
        line: 2,
        column: 5,
        field: "credit",
        text: "-1,00",
        expected: "a credit without a minus sign: money that came in",
      }),
    );
  });

  test("names the value's own line in a row that a quoted line break spreads over two", () => {
    expect(refusal(`${HEADER}\n02/10/2026;"two\nlines";;EUR;R1\n`)).toEqual(
      new MissingField({ line: 3, column: 3, field: "amount" }),
    );

    expect(refusal(`${HEADER}\n02/10/2026;"two\nlines";1,00;USD;R1\n`)).toEqual(
      new UnsupportedContent({
        line: 3,
        column: 4,
        problem: 'A line in "USD", in a file read for an account in EUR.',
      }),
    );

    expect(
      refusal(`${DEBIT_CREDIT_HEADER}\n02/11/2026;;"two\nlines";1,00;2,00\n`, debitCreditInline),
    ).toEqual(
      new UnsupportedContent({
        line: 3,
        column: 5,
        problem:
          "A debit (column 4) and a credit (column 5) on one line: a line fills one of them.",
      }),
    );

    expect(
      refusal(`${DEBIT_CREDIT_HEADER}\n02/11/2026;;"two\nlines";;\n`, debitCreditInline),
    ).toEqual(new MissingField({ line: 3, column: 4, field: "debit" }));
  });

  test("refuses a currency that is no ISO 4217 code", () => {
    const bytes = csvSamples.csvSemicolon.bytes;

    expect(Effect.runSync(Effect.flip(readCsv(bytes, semicolon, { currency: "euro" })))).toEqual(
      new InvalidOption({
        option: "currency",
        text: "euro",
        expected: "a currency's ISO 4217 code, such as EUR",
      }),
    );
  });
});

// One test per sample file: detection proposes the profile that reads it.
describe("proposing a profile from a CSV file", () => {
  test("proposes the profile of csv-semicolon.csv", () => {
    expect(detect(csvSamples.csvSemicolon.bytes)).toEqual({
      profile: semicolon,
      header: "date;libelle;montant;devise;reference",
      unsure: [],
    });
  });

  test("proposes the profile of csv-debit-credit.csv", () => {
    expect(detect(csvSamples.csvDebitCredit.bytes)).toEqual({
      profile: debitCredit,
      header: "date;date de valeur;libellé;débit;crédit",
      unsure: [],
    });
  });

  test("proposes the profile of csv-comma.csv", () => {
    expect(detect(csvSamples.csvComma.bytes)).toEqual({
      profile: comma,
      header: "transaction date;description;memo;amount;transaction id",
      unsure: [],
    });
  });

  test("proposes the profile of csv-tab-no-header.csv", () => {
    expect(detect(csvSamples.csvTabNoHeader.bytes)).toEqual({
      profile: tabNoHeader,
      header: null,
      unsure: [],
    });
  });

  test("proposes the profile of csv-pipe.csv", () => {
    expect(detect(csvSamples.csvPipe.bytes)).toEqual({
      profile: pipe,
      header: "booking date;value date;reference;payee;details;debit;credit",
      unsure: [],
    });
  });

  test("says what the file does not decide: the day's place, the decimal mark", () => {
    const proposal = detect(
      utf8.encode("Date;Libellé;Montant\n03/04/2026;A;-12\n05/04/2026;B;+5\n"),
    );

    expect(proposal.profile.dateFormat).toBe("DD/MM/YYYY");
    expect(proposal.profile.decimalMark).toBe(",");
    expect(proposal.unsure).toEqual(["dateFormat", "decimalMark"]);
  });

  test("says which of two unnamed amount columns is the debit only when their signs tell", () => {
    const unnamed = "Date;Label;Out;In\n02/11/2026;A;12,00;\n13/11/2026;B;;3,00\n";
    const signed = "Date;Label;Out;In\n02/11/2026;A;-12,00;\n13/11/2026;B;;3,00\n";

    expect(detectText(unnamed).profile.columns.amount).toEqual({
      kind: "debit-credit",
      debit: 3,
      credit: 4,
    });

    expect(detectText(unnamed).unsure).toEqual(["amount"]);
    expect(detectText(signed).unsure).toEqual([]);
  });

  test("proposes no profile for a file that holds no table of dates and amounts", () => {
    for (const bytes of [
      statementSamples.ofxXml.bytes,
      statementSamples.qifDayFirst.bytes,
      utf8.encode("Name;Town\nA;B\nC;D\n"),
      utf8.encode("Date;Amount\n02/11/2026;-12,50\n"),
      utf8.encode(""),
      new Uint8Array(2 * 1024 * 1024).fill(0x0a),
    ]) {
      expect(Effect.runSync(Effect.flip(detectCsvProfile(bytes)))).toEqual(
        new NotAStatement({ format: "csv" }),
      );
    }
  });

  test("takes three capital letters for a currency only under a header that says so", () => {
    const types = "Date;Type;Libellé;Montant\n02/11/2026;VIR;A;12,00\n03/11/2026;PRL;B;-3,00\n";
    const currencies = "Date;Devise;Libellé;Montant\n02/11/2026;EUR;A;12,00\n";

    expect(detectText(types).profile.columns.currency).toBeNull();
    expect(detectText(currencies).profile.columns.currency).toBe(2);
  });

  test("refuses a file of more than 64 MiB before decoding it", () => {
    const bytes = new Uint8Array(64 * 1024 * 1024 + 1).fill(0x41);

    expect(Effect.runSync(Effect.flip(detectCsvProfile(bytes)))).toEqual(
      new UnsupportedContent({
        line: 1,
        problem: "A file of more than 64 MiB: no statement is that large.",
      }),
    );
  });

  test("takes a column a header calls Debit or Credit for an amount, empty or in whole units", () => {
    const emptyCredit =
      "Date;Libellé;Débit;Crédit\n13/10/2026;CB Shop;23,90;\n14/10/2026;CB Books;12,00;\n";

    const wholeUnits = "Date;Libellé;Débit;Crédit\n13/10/2026;CB Shop;23;\n14/10/2026;VIR;;100\n";
    const debitCredit = { kind: "debit-credit", debit: 3, credit: 4 };
    const proposed = detectText(emptyCredit);

    expect(proposed.profile.columns.amount).toEqual(debitCredit);
    expect(proposed.unsure).toEqual([]);

    expect(
      read(utf8.encode(emptyCredit), proposed.profile).lines.map((entry) => entry.amountMinor),
    ).toEqual([-2390, -1200]);

    expect(detectText(wholeUnits).profile.columns.amount).toEqual(debitCredit);
    expect(detectText(wholeUnits).unsure).toEqual(["decimalMark"]);
  });

  test("is unsure of the amount when a header names one side alone, or both at once", () => {
    const debitAlone =
      "Date;Libellé;Débit;Note\n13/10/2026;CB Shop;23,90;x\n14/10/2026;CB Books;12,00;y\n";

    const both = "Date;Libellé;Débit/Crédit\n02/11/2026;A;-12,00\n13/11/2026;B;5,00\n";

    expect(detectText(debitAlone).profile.columns.amount).toEqual({ kind: "signed", column: 3 });
    expect(detectText(debitAlone).unsure).toEqual(["amount"]);
    expect(detectText(both).profile.columns.amount).toEqual({ kind: "signed", column: 3 });
    expect(detectText(both).unsure).toEqual(["amount"]);
  });

  test("is unsure of the amount among several signed columns, named or not", () => {
    const named =
      "Date;Libellé;Montant devise;Montant EUR\n02/11/2026;A;-12,00;-11,50\n13/11/2026;B;-3,00;-2,80\n";

    const unnamed = "Date;Libellé;X;Y\n02/11/2026;A;-12,00;-11,50\n13/11/2026;B;-3,00;-2,80\n";

    for (const text of [named, unnamed]) {
      expect(detectText(text).profile.columns.amount).toEqual({ kind: "signed", column: 3 });
      expect(detectText(text).unsure).toEqual(["amount"]);
    }
  });

  test("takes no column of digits alone for an amount: it may be a reference", () => {
    const text =
      "Date;Libellé;Montant;Numéro\n02/11/2026;A;-12,00;123456\n13/11/2026;B;5,00;123457\n";

    expect(detectText(text).profile.columns.amount).toEqual({ kind: "signed", column: 3 });
    expect(detectText(text).unsure).toEqual([]);
  });

  test("takes the longest text for the label when no header names it", () => {
    const text =
      "02/11/2026;CB;CARTE BOULANGERIE DU COIN;-4,20\n03/11/2026;VIR;VIREMENT SALAIRE ACME;2000,00\n";

    expect(detectText(text).profile.columns.label).toBe(3);
  });

  test("reads German headers", () => {
    const text =
      "Buchungstag;Wertstellung;Verwendungszweck;Betrag\n01.10.2026;02.10.2026;REISEBÜRO BEISPIEL;-1.234,56\n15.10.2026;15.10.2026;TANKSTELLE;-45,90\n";

    expect(detectText(text)).toEqual({
      profile: {
        ...semicolon,
        dateFormat: "DD.MM.YYYY",
        columns: {
          bookedOn: 1,
          valueOn: 2,
          amount: { kind: "signed", column: 4 },
          label: 3,
          memo: null,
          bankId: null,
          currency: null,
        },
      },
      header: "buchungstag;wertstellung;verwendungszweck;betrag",
      unsure: [],
    });
  });

  test("takes the widest table when two separators cut as many rows", () => {
    const text = "01.10.26\tAB\t-1,00\n02.10.26\tCD\t-2,00\n";

    expect(detectText(text).profile.separator).toBe("\t");
  });

  test("reads the first 2,000 lines at most", () => {
    const table = "Date;Libellé;Montant\n13/11/2026;A;-12,00\n";

    expect(detectText(`${"\n".repeat(1990)}${table}`).profile.skipRows).toBe(1990);

    expect(
      Effect.runSync(Effect.flip(detectCsvProfile(utf8.encode(`${";\n".repeat(2000)}${table}`)))),
    ).toEqual(new NotAStatement({ format: "csv" }));
  });
});
