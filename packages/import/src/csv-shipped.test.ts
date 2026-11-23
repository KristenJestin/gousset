import { csvSamples, encodeWindows1252 } from "@gousset/fixture";
import { Effect, Exit, Schema } from "effect";
import { describe, expect, test } from "vite-plus/test";

import { matchCsvHeader, readCsv, testReadCsv } from "./csv";
import { detectCsvProfile } from "./csv-detect";
import { CsvProfile } from "./csv-profile";
import { SHIPPED_PROFILES, shippedProfile } from "./csv-shipped";

const utf8 = new TextEncoder();

function ended(lines: ReadonlyArray<string>, end: string): string {
  return `${lines.join(end)}${end}`;
}

/** A shipped profile by its key, or a failed test. */
function shipped(key: string) {
  const found = shippedProfile(key);

  if (found === undefined) {
    throw new Error(`No profile is shipped as ${key}.`);
  }

  return found;
}

const read = (bytes: Uint8Array, profile: CsvProfile, currency = "EUR") =>
  Effect.runSync(readCsv(bytes, profile, { currency })).lines;

const matched = (bytes: Uint8Array) => Effect.runSync(matchCsvHeader(bytes, SHIPPED_PROFILES))?.key;

const unsure = (bytes: Uint8Array) => Effect.runSync(detectCsvProfile(bytes)).unsure;

const passes = (bytes: Uint8Array, profile: CsvProfile, currency: string | null) =>
  Exit.isSuccess(Effect.runSyncExit(testReadCsv(bytes, profile, currency)));

function line(bookedOn: string, valueOn: string | null, amountMinor: number, label: string) {
  return { bookedOn, valueOn, amountMinor, label, memo: null, bankId: null, counterparty: null };
}

// Invented exports, one per shipped profile, each in a style detection alone cannot settle: every
// day of them is the 12th or before, so the day's place is a guess, and their amount columns say
// little. A shipped profile reads them at once, with the right days, signs and amounts.
describe("the profiles shipped with Gousset", () => {
  test("reads a French export: lines above the table, Windows-1252, debit and credit", () => {
    const bytes = encodeWindows1252(
      ended(
        [
          "Relevé de compte",
          "Compte courant",
          "Période du 01/12/2026 au 12/12/2026",
          "Date;Date de valeur;Libellé;Débit;Crédit",
          '01/12/2026;01/12/2026;"CB MARCHÉ DES HALLES 29/11";18,40;',
          '03/12/2026;03/12/2026;"VIR SEPA DOMINIQUE EXEMPLE";;75,00',
          '05/12/2026;05/12/2026;"PRLV SEPA ÉNERGIE EXEMPLE";62;',
          '10/12/2026;11/12/2026;"VIR SEPA SALAIRE EXEMPLE SARL";;2100,00',
        ],
        "\r\n",
      ),
    );

    const profile = shipped("fr-debit-credit");

    expect(matched(bytes)).toBe("fr-debit-credit");
    expect(unsure(bytes)).toContain("dateFormat");
    expect(read(bytes, profile.profile)).toEqual([
      line("2026-12-01", "2026-12-01", -1840, "CB MARCHÉ DES HALLES 29/11"),
      line("2026-12-03", "2026-12-03", 7500, "VIR SEPA DOMINIQUE EXEMPLE"),
      line("2026-12-05", "2026-12-05", -6200, "PRLV SEPA ÉNERGIE EXEMPLE"),
      line("2026-12-10", "2026-12-11", 210_000, "VIR SEPA SALAIRE EXEMPLE SARL"),
    ]);
  });

  test("reads a German export: day.month.year, a value date, one signed amount", () => {
    const bytes = encodeWindows1252(
      ended(
        [
          "Buchungstag;Wertstellung;Verwendungszweck;Betrag;Währung",
          "01.12.2026;01.12.2026;KARTENZAHLUNG BÄCKEREI BEISPIEL;-7,35;EUR",
          "02.12.2026;03.12.2026;MIETE DEZEMBER BEISPIELSTRASSE 1;-1.150,00;EUR",
          "11.12.2026;11.12.2026;GEHALT BEISPIEL GMBH;3.204,18;EUR",
        ],
        "\n",
      ),
    );

    const profile = shipped("de-signed");

    expect(matched(bytes)).toBe("de-signed");
    expect(unsure(bytes)).toContain("dateFormat");
    expect(read(bytes, profile.profile)).toEqual([
      line("2026-12-01", "2026-12-01", -735, "KARTENZAHLUNG BÄCKEREI BEISPIEL"),
      line("2026-12-02", "2026-12-03", -115_000, "MIETE DEZEMBER BEISPIELSTRASSE 1"),
      line("2026-12-11", "2026-12-11", 320_418, "GEHALT BEISPIEL GMBH"),
    ]);
  });

  test("reads a British export: paid out and paid in, a balance left aside", () => {
    const bytes = utf8.encode(
      ended(
        [
          "Date,Type,Description,Paid out,Paid in,Balance",
          "02/12/2026,DEB,EXAMPLE GROCER LTD,23.15,,976.85",
          "04/12/2026,BGC,EXAMPLE EMPLOYER PAYROLL,,1850.00,2826.85",
          "07/12/2026,DD,EXAMPLE COUNCIL TAX,121.00,,2705.85",
        ],
        "\r\n",
      ),
    );

    const profile = shipped("uk-paid-out-in");

    expect(matched(bytes)).toBe("uk-paid-out-in");
    expect(unsure(bytes)).toEqual(expect.arrayContaining(["dateFormat", "amount"]));
    expect(read(bytes, profile.profile, "GBP")).toEqual([
      line("2026-12-02", null, -2315, "EXAMPLE GROCER LTD"),
      line("2026-12-04", null, 185_000, "EXAMPLE EMPLOYER PAYROLL"),
      line("2026-12-07", null, -12_100, "EXAMPLE COUNCIL TAX"),
    ]);
  });

  test("reads a US export: month first, one signed amount beside a running balance", () => {
    const bytes = utf8.encode(
      ended(
        [
          "Date,Description,Amount,Running Bal.",
          "12/01/2026,EXAMPLE COFFEE ROASTERS,-6.50,1243.50",
          "12/03/2026,EXAMPLE PAYROLL INC,2400.00,3643.50",
          "12/09/2026,EXAMPLE ELECTRIC CO,-88.21,3555.29",
        ],
        "\n",
      ),
    );

    const profile = shipped("us-signed");

    expect(matched(bytes)).toBe("us-signed");
    // Day first, detection would read the 1st of December as the 12th of January.
    expect(unsure(bytes)).toContain("dateFormat");
    expect(read(bytes, profile.profile, "USD")).toEqual([
      line("2026-12-01", null, -650, "EXAMPLE COFFEE ROASTERS"),
      line("2026-12-03", null, 240_000, "EXAMPLE PAYROLL INC"),
      line("2026-12-09", null, -8821, "EXAMPLE ELECTRIC CO"),
    ]);
  });

  test("are valid profiles, each with a key and a header of its own", () => {
    const decode = Schema.decodeUnknownSync(CsvProfile);
    const keys = SHIPPED_PROFILES.map((each) => each.key);
    const headers = SHIPPED_PROFILES.map((each) => each.header);

    for (const each of SHIPPED_PROFILES) {
      expect(decode(each.profile)).toEqual(each.profile);
      expect(each.kind).toBe("statement");
      expect(each.name).not.toBe("");
    }

    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(headers).size).toBe(headers.length);
    expect(shippedProfile("no-such-profile")).toBeUndefined();
  });

  test("match no file whose header is another's", () => {
    const { csvDebitCredit, ...others } = csvSamples;

    // The sample French export is in the French style.
    expect(matched(csvDebitCredit.bytes)).toBe("fr-debit-credit");

    for (const sample of Object.values(others)) {
      expect(matched(sample.bytes), sample.fileName).toBeUndefined();
    }
  });
});

describe("matching a file's header", () => {
  const french = shipped("fr-debit-credit");

  test("takes the first candidate whose header the file has, read as its profile reads it", () => {
    const sameHeader = { key: "mine", header: french.header, profile: french.profile };
    const bytes = csvSamples.csvDebitCredit.bytes;

    expect(Effect.runSync(matchCsvHeader(bytes, [sameHeader, french]))?.key).toBe("mine");
  });

  test("skips a candidate with no header, or whose profile cannot read the file", () => {
    const utf8Profile: CsvProfile = { ...french.profile, encoding: "utf8" };
    const noHeader = { key: "none", header: null, profile: french.profile };
    const notUtf8 = { key: "utf8", header: french.header, profile: utf8Profile };
    const bytes = csvSamples.csvDebitCredit.bytes;

    expect(Effect.runSync(matchCsvHeader(bytes, [noHeader, notUtf8]))).toBeUndefined();
  });
});

describe("a test read of a file's top", () => {
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

  test("succeeds where the profile reads the file, and fails where it does not", () => {
    expect(passes(csvSamples.csvTabNoHeader.bytes, tabNoHeader, "EUR")).toBe(true);
    expect(passes(csvSamples.csvComma.bytes, tabNoHeader, "EUR")).toBe(false);
  });

  test("with no account's currency, reads amounts and leaves the currency column unchecked", () => {
    const semicolon: CsvProfile = {
      ...tabNoHeader,
      separator: ";",
      headerRow: true,
      dateFormat: "DD/MM/YYYY",
      columns: { ...tabNoHeader.columns, label: 2, bankId: 5, currency: 4 },
    };

    expect(passes(csvSamples.csvSemicolon.bytes, semicolon, null)).toBe(true);
    expect(passes(csvSamples.csvSemicolon.bytes, semicolon, "USD")).toBe(false);
  });

  test("reads the top of the file only: a wrong line further down does not count", () => {
    const top = Array.from({ length: 60 }, (_, n) => `0${String((n % 9) + 1)}.10.26\tA\t-1,00`);
    const bytes = utf8.encode(ended([...top, "oops\tB\t-1,00"], "\n"));

    expect(passes(bytes, tabNoHeader, "EUR")).toBe(true);
  });
});
