import { exampleStatement } from "./example";
import { writeOfx, writeQif } from "./formats";

/** A statement file as a bank hands it over: its name and its bytes, in its own encoding. */
export type SampleFile = { fileName: string; bytes: Uint8Array };

/** The characters of Windows-1252's 0x80 to 0x9F that the samples use; Latin-1 has none of them. */
const WINDOWS_1252_EXTRAS = new Map([
  ["€", 0x80],
  ["’", 0x92],
  ["Œ", 0x8c],
  ["œ", 0x9c],
]);

/** Text as Windows-1252 bytes, as many French banks still write their files. */
export function encodeWindows1252(text: string): Uint8Array {
  return Uint8Array.from(text, (character) => {
    const extra = WINDOWS_1252_EXTRAS.get(character);
    const code = character.codePointAt(0) ?? 0;

    if (extra !== undefined) {
      return extra;
    }

    if (code > 0xff || (code >= 0x80 && code < 0xa0)) {
      throw new RangeError(`Windows-1252 has no ${character}.`);
    }

    return code;
  });
}

const utf8 = new TextEncoder();

function crlf(lines: ReadonlyArray<string>): string {
  return `${lines.join("\r\n")}\r\n`;
}

function lf(lines: ReadonlyArray<string>): string {
  return `${lines.join("\n")}\n`;
}

/** The OFX 1.x header, SGML, the lines before `<OFX>`. */
function sgmlHeader(version: string): Array<string> {
  return [
    "OFXHEADER:100",
    "DATA:OFXSGML",
    `VERSION:${version}`,
    "SECURITY:NONE",
    "ENCODING:USASCII",
    "CHARSET:1252",
    "COMPRESSION:NONE",
    "OLDFILEUID:NONE",
    "NEWFILEUID:NONE",
    "",
  ];
}

/** A signon block, SGML, each value left without its closing tag. */
function sgmlSignOn(server: string, language: string): Array<string> {
  return [
    "<SIGNONMSGSRSV1>",
    "<SONRS>",
    "<STATUS>",
    "<CODE>0",
    "<SEVERITY>INFO",
    "</STATUS>",
    `<DTSERVER>${server}`,
    `<LANGUAGE>${language}`,
    "</SONRS>",
    "</SIGNONMSGSRSV1>",
  ];
}

const bankAccountSgml = [
  "<BANKACCTFROM>",
  "<BANKID>99999",
  "<BRANCHID>00001",
  "<ACCTID>00012345678",
  "<ACCTTYPE>CHECKING",
  "</BANKACCTFROM>",
];

/**
 * OFX 1.02, SGML, as a French bank writes it: Windows-1252 (accents, `€`), CRLF, values without
 * closing tags, an entity (`&amp;`), value dates (`DTAVAIL`) and the ledger balance.
 */
const ofxSgmlWindows1252 = crlf([
  ...sgmlHeader("102"),
  "<OFX>",
  ...sgmlSignOn("20261104", "FRA"),
  "<BANKMSGSRSV1>",
  "<STMTTRNRS>",
  "<TRNUID>00000000",
  "<STATUS>",
  "<CODE>0",
  "<SEVERITY>INFO",
  "</STATUS>",
  "<STMTRS>",
  "<CURDEF>EUR",
  ...bankAccountSgml,
  "<BANKTRANLIST>",
  "<DTSTART>20261101",
  "<DTEND>20261104",
  "<STMTTRN>",
  "<TRNTYPE>DEBIT",
  "<DTPOSTED>20261102",
  "<DTUSER>20261031",
  "<DTAVAIL>20261031",
  "<TRNAMT>-23.90",
  "<FITID>EX2026110201",
  "<NAME>CB PÂTISSERIE DU MARCHÉ 31/10",
  "<MEMO>PAIEMENT PAR CARTE",
  "</STMTTRN>",
  "<STMTTRN>",
  "<TRNTYPE>CREDIT",
  "<DTPOSTED>20261102",
  "<DTAVAIL>20261102",
  "<TRNAMT>150.00",
  "<FITID>EX2026110202",
  "<NAME>VIR SEPA CAMILLE EXEMPLE",
  "<MEMO>REMBOURSEMENT NOËL",
  "</STMTTRN>",
  "<STMTTRN>",
  "<TRNTYPE>DIRECTDEBIT",
  "<DTPOSTED>20261103",
  "<TRNAMT>-64.12",
  "<FITID>EX2026110301",
  "<NAME>PRLV SEPA ÉLEC &amp; GAZ EXEMPLE",
  "</STMTTRN>",
  "<STMTTRN>",
  "<TRNTYPE>FEE",
  "<DTPOSTED>20261104",
  "<TRNAMT>-2.50",
  "<FITID>EX2026110401",
  "<NAME>COTISATION CARTE 2,50 €",
  "<MEMO>FRAIS",
  "</STMTTRN>",
  "</BANKTRANLIST>",
  "<LEDGERBAL>",
  "<BALAMT>1234.56",
  "<DTASOF>20261104",
  "</LEDGERBAL>",
  "</STMTRS>",
  "</STMTTRNRS>",
  "</BANKMSGSRSV1>",
  "</OFX>",
]);

/**
 * OFX 1.51, SGML, its header declaring Windows-1252 over UTF-8 bytes. Decimal commas (`-1234,56`,
 * `-,99`, `12`), dates with a time and a zone (`20261005120000.000[+1:CET]`, `202610071530`), some
 * values closed and some not, a payee given as an aggregate, a line with no `FITID`, an empty
 * `MEMO`, a bare `&`, and no ledger balance (only the available one).
 */
const ofxSgmlDates = lf([
  ...sgmlHeader("151"),
  "<OFX>",
  ...sgmlSignOn("20261009083000", "FRA"),
  "<BANKMSGSRSV1>",
  "<STMTTRNRS>",
  "<TRNUID>20261009083000",
  "<STATUS>",
  "<CODE>0",
  "<SEVERITY>INFO",
  "</STATUS>",
  "<STMTRS>",
  "<CURDEF>EUR",
  ...bankAccountSgml,
  "<BANKTRANLIST>",
  "<DTSTART>20261001",
  "<DTEND>20261009",
  "<STMTTRN>",
  "<TRNTYPE>DEBIT",
  "<DTPOSTED>20261005120000.000[+1:CET]",
  "<TRNAMT>-1234,56",
  "<FITID>EX2026100501",
  "<NAME>PRLV SEPA SCI DES GLYCINES</NAME>",
  "<MEMO>LOYER OCTOBRE ÉCHÉANCE 10</MEMO>",
  "</STMTTRN>",
  "<STMTTRN>",
  "<TRNTYPE>CREDIT",
  "<DTPOSTED>20261006000000[-5:EST]",
  "<TRNAMT>+45,00",
  "<PAYEE>",
  "<NAME>CAMILLE EXEMPLE",
  "<ADDR1>1 RUE DE L'EXEMPLE",
  "<CITY>EXEMPLEVILLE",
  "<POSTALCODE>99999",
  "</PAYEE>",
  "<MEMO>PART DU CADEAU",
  "</STMTTRN>",
  "<STMTTRN>",
  "<TRNTYPE>POS",
  "<DTPOSTED>202610071530",
  "<TRNAMT>-,99",
  "<FITID>EX2026100701",
  "<NAME>CB APPLI EXEMPLE",
  "<MEMO>",
  "</STMTTRN>",
  "<STMTTRN>",
  "<TRNTYPE>DEP",
  "<DTPOSTED>20261008",
  "<TRNAMT>12",
  "<FITID>EX2026100801",
  "<NAME>REMISE CHEQUE R&D EXEMPLE",
  "</STMTTRN>",
  "</BANKTRANLIST>",
  "<AVAILBAL>",
  "<BALAMT>2500,00",
  "<DTASOF>20261009",
  "</AVAILBAL>",
  "</STMTRS>",
  "</STMTTRNRS>",
  "</BANKMSGSRSV1>",
  "</OFX>",
]);

function xmlTransaction(type: string, day: string, amount: string, id: string, name: string) {
  return [
    "<STMTTRN>",
    `<TRNTYPE>${type}</TRNTYPE>`,
    `<DTPOSTED>${day}</DTPOSTED>`,
    `<TRNAMT>${amount}</TRNAMT>`,
    `<FITID>${id}</FITID>`,
    `<NAME>${name}</NAME>`,
    "</STMTTRN>",
  ];
}

/**
 * OFX 2.11, XML, indented, from a bank that writes every amount without its sign and lets the
 * type (`DEBIT`, `CREDIT`, `CHECK`, `INT`, `FEE`) say which way the money went. A comment,
 * numeric entities (`&#201;`) and an empty `<MEMO></MEMO>`.
 */
const ofxUnsigned = lf([
  '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
  '<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>',
  "<OFX>",
  "  <!-- Exported by Banque Exemple: amounts are unsigned, TRNTYPE gives the direction. -->",
  "  <SIGNONMSGSRSV1>",
  "    <SONRS>",
  "      <STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>",
  "      <DTSERVER>20261130</DTSERVER>",
  "      <LANGUAGE>FRA</LANGUAGE>",
  "    </SONRS>",
  "  </SIGNONMSGSRSV1>",
  "  <BANKMSGSRSV1>",
  "    <STMTTRNRS>",
  "      <TRNUID>1</TRNUID>",
  "      <STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>",
  "      <STMTRS>",
  "        <CURDEF>EUR</CURDEF>",
  "        <BANKACCTFROM>",
  "          <BANKID>99999</BANKID>",
  "          <ACCTID>00012345678</ACCTID>",
  "          <ACCTTYPE>SAVINGS</ACCTTYPE>",
  "        </BANKACCTFROM>",
  "        <BANKTRANLIST>",
  "          <DTSTART>20261101</DTSTART>",
  "          <DTEND>20261130</DTEND>",
  ...xmlTransaction("DEBIT", "20261103", "25.00", "EX2026110301", "CB LIBRAIRIE EXEMPLE"),
  ...xmlTransaction("CREDIT", "20261105", "1000.00", "EX2026110501", "VIR SEPA ACME PRIME"),
  ...xmlTransaction("CHECK", "20261112", "80.00", "EX2026111201", "CHEQUE 0001234"),
  ...xmlTransaction("INT", "20261130", "3.10", "EX2026113001", "INT&#201;R&#202;TS"),
  "          <STMTTRN>",
  "            <TRNTYPE>FEE</TRNTYPE>",
  "            <DTPOSTED>20261130</DTPOSTED>",
  "            <TRNAMT>3.00</TRNAMT>",
  "            <FITID>EX2026113002</FITID>",
  "            <NAME>FRAIS DE TENUE DE COMPTE</NAME>",
  "            <MEMO></MEMO>",
  "          </STMTTRN>",
  "        </BANKTRANLIST>",
  "        <LEDGERBAL><BALAMT>4321.09</BALAMT><DTASOF>20261130</DTASOF></LEDGERBAL>",
  "      </STMTRS>",
  "    </STMTTRNRS>",
  "  </BANKMSGSRSV1>",
  "</OFX>",
]);

/**
 * QFX, a card's statement in US dollars as Quicken downloads it: OFX 1.02 SGML with Intuit's
 * `<INTU.BID>`, a card account (`CCSTMTRS`), dates at noon GMT, charges negative and a negative
 * ledger balance (what is owed).
 */
const qfxCreditCard = lf([
  ...sgmlHeader("102"),
  "<OFX>",
  "<SIGNONMSGSRSV1>",
  "<SONRS>",
  "<STATUS>",
  "<CODE>0",
  "<SEVERITY>INFO",
  "</STATUS>",
  "<DTSERVER>20261031120000[0:GMT]",
  "<LANGUAGE>ENG",
  "<INTU.BID>99999",
  "</SONRS>",
  "</SIGNONMSGSRSV1>",
  "<CREDITCARDMSGSRSV1>",
  "<CCSTMTTRNRS>",
  "<TRNUID>0",
  "<STATUS>",
  "<CODE>0",
  "<SEVERITY>INFO",
  "</STATUS>",
  "<CCSTMTRS>",
  "<CURDEF>USD",
  "<CCACCTFROM>",
  "<ACCTID>EXAMPLECARD0001",
  "</CCACCTFROM>",
  "<BANKTRANLIST>",
  "<DTSTART>20261001120000[0:GMT]",
  "<DTEND>20261031120000[0:GMT]",
  "<STMTTRN>",
  "<TRNTYPE>DEBIT",
  "<DTPOSTED>20261004120000[0:GMT]",
  "<TRNAMT>-42.17",
  "<FITID>2026100401EXAMPLE",
  "<NAME>EXAMPLE GROCERY MARKET",
  "</STMTTRN>",
  "<STMTTRN>",
  "<TRNTYPE>CREDIT",
  "<DTPOSTED>20261012120000[0:GMT]",
  "<TRNAMT>200.00",
  "<FITID>2026101201EXAMPLE",
  "<NAME>PAYMENT - THANK YOU",
  "</STMTTRN>",
  "<STMTTRN>",
  "<TRNTYPE>DEBIT",
  "<DTPOSTED>20261020120000[0:GMT]",
  "<TRNAMT>-9.99",
  "<FITID>2026102001EXAMPLE",
  "<NAME>EXAMPLE STREAMING SERVICE",
  "<MEMO>MONTHLY PLAN",
  "</STMTTRN>",
  "</BANKTRANLIST>",
  "<LEDGERBAL>",
  "<BALAMT>-312.40",
  "<DTASOF>20261031120000[0:GMT]",
  "</LEDGERBAL>",
  "<AVAILBAL>",
  "<BALAMT>4687.60",
  "<DTASOF>20261031120000[0:GMT]",
  "</AVAILBAL>",
  "</CCSTMTRS>",
  "</CCSTMTTRNRS>",
  "</CREDITCARDMSGSRSV1>",
  "</OFX>",
]);

/**
 * QIF as Quicken exports a whole US account: CRLF, its account list first, dates month first with
 * `'` before the year and spaces for leading zeros (`10/ 1'26`), thousands grouped (`1,350.00`),
 * `U` beside `T`, a split, a cheque number, and the opening balance record.
 */
const qifQuicken = crlf([
  "!Option:AutoSwitch",
  "!Account",
  "NChecking Example",
  "TBank",
  "^",
  "!Clear:AutoSwitch",
  "!Type:Bank",
  "D 9/30'26",
  "U1,200.00",
  "T1,200.00",
  "CX",
  "POpening Balance",
  "L[Checking Example]",
  "^",
  "D10/ 1'26",
  "U-1,350.00",
  "T-1,350.00",
  "N1001",
  "PExample Property Management",
  "MOctober rent",
  "LHousing:Rent",
  "^",
  "D10/ 3'26",
  "U-86.45",
  "T-86.45",
  "PExample Grocery",
  "LSplit",
  "SFood:Groceries",
  "$-60.00",
  "SHousehold",
  "$-26.45",
  "^",
  "D10/15'26",
  "U2,345.67",
  "T2,345.67",
  "PExample Corp Payroll",
  "LSalary",
  "^",
]);

/**
 * QIF as a French bank exports it: Windows-1252 (accents, `’`), decimal commas, day first with
 * two-digit years (`03/11/26`). Every date also reads month first: the file cannot tell.
 */
const qifWindows1252 = crlf([
  "!Type:Bank",
  "D03/11/26",
  "T-85,00",
  "PPRLV SEPA ÉCOLE DE MUSIQUE",
  "MCotisation trimestrielle",
  "^",
  "D04/11/26",
  "T-12,40",
  "PCB L’ÉPICERIE DU COIN 03/11",
  "^",
  "D10/11/26",
  "T2450,00",
  "PVIR SEPA ACME CONSEIL SALAIRE",
  "NEX2026111001",
  "^",
  "D12/11/26",
  "T-1234,56",
  "PPRLV SEPA SCI DES GLYCINES LOYER",
  "MÉchéance de novembre",
  "^",
]);

/** QIF of a card in euros, German style: dates with dots (`15.10.2026`), `1.234,56`. */
const qifDotDates = lf([
  "!Type:CCard",
  "D01.10.2026",
  "T-1.234,56",
  "PREISEBÜRO BEISPIEL",
  "^",
  "D15.10.2026",
  "T-45,90",
  "PTANKSTELLE BEISPIEL",
  "^",
  "D31.10.2026",
  "T1.280,46",
  "PZAHLUNG DANKE",
  "MAusgleich Kartenkonto",
  "^",
]);

/**
 * Invented statement files, one per variant the readers meet (packages/import): encodings, sign
 * conventions, date formats, SGML and XML OFX, QFX, QIF. The accounts, people and banks do not
 * exist.
 */
export const statementSamples = {
  /** OFX 2.2, XML, UTF-8: the example statement as `writeOfx` writes it. */
  ofxXml: { fileName: "ofx-xml.ofx", bytes: utf8.encode(writeOfx(exampleStatement)) },
  ofxSgmlWindows1252: {
    fileName: "ofx-sgml-windows-1252.ofx",
    bytes: encodeWindows1252(ofxSgmlWindows1252),
  },
  ofxSgmlDates: { fileName: "ofx-sgml-dates.ofx", bytes: utf8.encode(ofxSgmlDates) },
  ofxUnsigned: { fileName: "ofx-unsigned.ofx", bytes: utf8.encode(ofxUnsigned) },
  qfxCreditCard: { fileName: "qfx-credit-card.qfx", bytes: utf8.encode(qfxCreditCard) },
  /** QIF, UTF-8, day first: the example statement as `writeQif` writes it. */
  qifDayFirst: { fileName: "qif-day-first.qif", bytes: utf8.encode(writeQif(exampleStatement)) },
  qifQuicken: { fileName: "qif-quicken.qif", bytes: utf8.encode(qifQuicken) },
  qifWindows1252: { fileName: "qif-windows-1252.qif", bytes: encodeWindows1252(qifWindows1252) },
  qifDotDates: { fileName: "qif-dot-dates.qif", bytes: utf8.encode(qifDotDates) },
};
