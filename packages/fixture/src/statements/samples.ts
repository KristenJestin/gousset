import { exampleStatement } from "./example";
import { writeCamt053, writeMt940, writeOfx, writeQif } from "./formats";

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
 * OFX 1.02, SGML, from a bank that writes every amount without its sign, with no line typed
 * `DEBIT`: a cheque (`CHECK`) and a fee (`FEE`) say the money went out, a `CREDIT` and interest
 * (`INT`) that it came in.
 */
const ofxUnsignedNoDebit = lf([
  ...sgmlHeader("102"),
  "<OFX>",
  ...sgmlSignOn("20261130", "FRA"),
  "<BANKMSGSRSV1>",
  "<STMTTRNRS>",
  "<TRNUID>1",
  "<STATUS>",
  "<CODE>0",
  "<SEVERITY>INFO",
  "</STATUS>",
  "<STMTRS>",
  "<CURDEF>EUR",
  ...bankAccountSgml,
  "<BANKTRANLIST>",
  "<DTSTART>20261101",
  "<DTEND>20261130",
  "<STMTTRN>",
  "<TRNTYPE>CREDIT",
  "<DTPOSTED>20261102",
  "<TRNAMT>1800.00",
  "<FITID>EX2026110201",
  "<NAME>VIR SEPA ACME SALAIRE",
  "</STMTTRN>",
  "<STMTTRN>",
  "<TRNTYPE>CHECK",
  "<DTPOSTED>20261109",
  "<TRNAMT>45.00",
  "<FITID>EX2026110901",
  "<CHECKNUM>0000042",
  "<NAME>CHEQUE 0000042",
  "</STMTTRN>",
  "<STMTTRN>",
  "<TRNTYPE>INT",
  "<DTPOSTED>20261130",
  "<TRNAMT>1.25",
  "<FITID>EX2026113001",
  "<NAME>INTERETS",
  "</STMTTRN>",
  "<STMTTRN>",
  "<TRNTYPE>FEE",
  "<DTPOSTED>20261130",
  "<TRNAMT>8.00",
  "<FITID>EX2026113002",
  "<NAME>COTISATION CARTE",
  "</STMTTRN>",
  "</BANKTRANLIST>",
  "<LEDGERBAL>",
  "<BALAMT>2500.00",
  "<DTASOF>20261130",
  "</LEDGERBAL>",
  "</STMTRS>",
  "</STMTTRNRS>",
  "</BANKMSGSRSV1>",
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

/** A CAMT.053 entry, indented as a bank writes it, around what tells it apart. */
function camtEntry(amount: string, indicator: "CRDT" | "DBIT", inside: ReadonlyArray<string>) {
  return [
    "      <Ntry>",
    `        <Amt Ccy="EUR">${amount}</Amt>`,
    `        <CdtDbtInd>${indicator}</CdtDbtInd>`,
    ...inside.map((line) => `        ${line}`),
    "      </Ntry>",
  ];
}

function camtBalance(code: string, amount: string, indicator: "CRDT" | "DBIT", date: string) {
  return [
    "      <Bal>",
    `        <Tp><CdOrPrtry><Cd>${code}</Cd></CdOrPrtry></Tp>`,
    `        <Amt Ccy="EUR">${amount}</Amt>`,
    `        <CdtDbtInd>${indicator}</CdtDbtInd>`,
    `        <Dt>${date}</Dt>`,
    "      </Bal>",
  ];
}

const camtAccount = [
  "      <Acct>",
  "        <Id><IBAN>FR7699999000010001234567809</IBAN></Id>",
  "        <Ccy>EUR</Ccy>",
  "        <Ownr><Nm>Dominique Exemple</Nm></Ownr>",
  "      </Acct>",
];

/**
 * CAMT.053 version 001.02 as a French bank writes it: the status as text (`<Sts>BOOK</Sts>`), the
 * bank's label in `AddtlNtryInf` and the remittance information beside it, a debtor's name and
 * spaced IBAN (`Dbtr/Nm`), a creditor named without an account, a reversed direct debit
 * (`RvslInd`), a booking date with a time, a pending entry, the opening balance as the previous
 * closing one (`PRCD`) and an available balance beside the booked ones.
 */
const camt053Version02 = lf([
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
  "  <BkToCstmrStmt>",
  "    <GrpHdr>",
  "      <MsgId>EX20261130</MsgId>",
  "      <CreDtTm>2026-11-30T22:00:00+01:00</CreDtTm>",
  "    </GrpHdr>",
  "    <Stmt>",
  "      <Id>EX-2026-11</Id>",
  "      <CreDtTm>2026-11-30T22:00:00+01:00</CreDtTm>",
  "      <FrToDt><FrDtTm>2026-11-01T00:00:00+01:00</FrDtTm><ToDtTm>2026-11-30T23:59:59+01:00</ToDtTm></FrToDt>",
  ...camtAccount,
  ...camtBalance("PRCD", "1520.30", "CRDT", "<Dt>2026-10-31</Dt>"),
  ...camtBalance("CLBD", "1646.40", "CRDT", "<DtTm>2026-11-30T23:59:59+01:00</DtTm>"),
  ...camtBalance("CLAV", "1600.00", "CRDT", "<Dt>2026-11-30</Dt>"),
  ...camtEntry("23.90", "DBIT", [
    "<Sts>BOOK</Sts>",
    "<BookgDt><Dt>2026-11-02</Dt></BookgDt>",
    "<ValDt><Dt>2026-10-31</Dt></ValDt>",
    "<AcctSvcrRef>EX2026110201</AcctSvcrRef>",
    "<BkTxCd><Domn><Cd>PMNT</Cd><Fmly><Cd>CCRD</Cd><SubFmlyCd>POSD</SubFmlyCd></Fmly></Domn></BkTxCd>",
    "<NtryDtls><TxDtls><Refs><EndToEndId>NOTPROVIDED</EndToEndId></Refs></TxDtls></NtryDtls>",
    "<AddtlNtryInf>CB PÂTISSERIE DU MARCHÉ 31/10</AddtlNtryInf>",
  ]),
  ...camtEntry("150.00", "CRDT", [
    "<Sts>BOOK</Sts>",
    "<BookgDt><DtTm>2026-11-03T09:12:00+01:00</DtTm></BookgDt>",
    "<ValDt><Dt>2026-11-03</Dt></ValDt>",
    "<AcctSvcrRef>EX2026110301</AcctSvcrRef>",
    "<NtryDtls>",
    "  <TxDtls>",
    "    <Refs><EndToEndId>EX-E2E-0001</EndToEndId></Refs>",
    "    <RltdPties>",
    "      <Dbtr><Nm>CAMILLE EXEMPLE</Nm></Dbtr>",
    "      <DbtrAcct><Id><IBAN>DE39 9999 9999 0012 3456 78</IBAN></Id></DbtrAcct>",
    "    </RltdPties>",
    "    <RmtInf><Ustrd>REMBOURSEMENT NOËL</Ustrd><Ustrd>PART DU CADEAU</Ustrd></RmtInf>",
    "  </TxDtls>",
    "</NtryDtls>",
    "<AddtlNtryInf>VIR SEPA RECU /DE CAMILLE EXEMPLE</AddtlNtryInf>",
  ]),
  ...camtEntry("64.12", "DBIT", [
    "<Sts>BOOK</Sts>",
    "<BookgDt><Dt>2026-11-05</Dt></BookgDt>",
    "<ValDt><Dt>2026-11-05</Dt></ValDt>",
    "<AcctSvcrRef>EX2026110501</AcctSvcrRef>",
    "<NtryDtls><TxDtls>",
    "  <RltdPties><Cdtr><Nm>ÉLEC &amp; GAZ EXEMPLE</Nm></Cdtr></RltdPties>",
    "  <RmtInf><Ustrd>ECHEANCE NOVEMBRE</Ustrd></RmtInf>",
    "</TxDtls></NtryDtls>",
    "<AddtlNtryInf>PRLV SEPA ÉLEC &amp; GAZ EXEMPLE</AddtlNtryInf>",
  ]),
  ...camtEntry("64.12", "CRDT", [
    "<RvslInd>true</RvslInd>",
    "<Sts>BOOK</Sts>",
    "<BookgDt><Dt>2026-11-09</Dt></BookgDt>",
    "<ValDt><Dt>2026-11-05</Dt></ValDt>",
    "<AcctSvcrRef>EX2026110901</AcctSvcrRef>",
    "<NtryDtls><TxDtls>",
    "  <RltdPties><Cdtr><Nm>ÉLEC &amp; GAZ EXEMPLE</Nm></Cdtr></RltdPties>",
    "</TxDtls></NtryDtls>",
    "<AddtlNtryInf>RETOUR PRLV SEPA ÉLEC &amp; GAZ EXEMPLE</AddtlNtryInf>",
  ]),
  ...camtEntry("9.99", "DBIT", [
    "<Sts>PDNG</Sts>",
    "<ValDt><Dt>2026-12-01</Dt></ValDt>",
    "<AddtlNtryInf>CB STREAMFLIX</AddtlNtryInf>",
  ]),
  "    </Stmt>",
  "  </BkToCstmrStmt>",
  "</Document>",
]);

/**
 * CAMT.053 version 001.04 with an overdrawn opening balance (`OPBD` and `DBIT`): a batch entry of
 * two direct debits booked as one line (`Btch`, two `TxDtls`), a salary with its remittance
 * information and no bank label, a payment whose only text is its creditor's name, a structured
 * reference (`Strd`) alone, and a fee with no details at all.
 */
const camt053Batch = lf([
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.04">',
  "  <BkToCstmrStmt>",
  "    <GrpHdr><MsgId>EX20261130B</MsgId><CreDtTm>2026-11-30T20:00:00</CreDtTm></GrpHdr>",
  "    <Stmt>",
  "      <Id>EX-2026-11-B</Id>",
  "      <CreDtTm>2026-11-30T20:00:00</CreDtTm>",
  ...camtAccount,
  ...camtBalance("OPBD", "35.20", "DBIT", "<Dt>2026-11-01</Dt>"),
  ...camtBalance("CLBD", "1578.40", "CRDT", "<Dt>2026-11-30</Dt>"),
  ...camtEntry("1800.00", "CRDT", [
    "<Sts>BOOK</Sts>",
    "<BookgDt><Dt>2026-11-02</Dt></BookgDt>",
    "<ValDt><Dt>2026-11-02</Dt></ValDt>",
    "<AcctSvcrRef>EX2026110201</AcctSvcrRef>",
    "<NtryDtls><TxDtls>",
    "  <RltdPties>",
    "    <Dbtr><Nm>ACME CONSEIL</Nm></Dbtr>",
    "    <DbtrAcct><Id><IBAN>DE39999999990012345678</IBAN></Id></DbtrAcct>",
    "  </RltdPties>",
    "  <RmtInf><Ustrd>SALAIRE NOVEMBRE 2026</Ustrd></RmtInf>",
    "</TxDtls></NtryDtls>",
  ]),
  ...camtEntry("120.00", "DBIT", [
    "<Sts>BOOK</Sts>",
    "<BookgDt><Dt>2026-11-05</Dt></BookgDt>",
    "<ValDt><Dt>2026-11-05</Dt></ValDt>",
    "<AcctSvcrRef>EX2026110501</AcctSvcrRef>",
    "<NtryDtls>",
    "  <Btch><NbOfTxs>2</NbOfTxs></Btch>",
    "  <TxDtls>",
    '    <Amt Ccy="EUR">80.00</Amt><CdtDbtInd>DBIT</CdtDbtInd>',
    "    <RltdPties><Cdtr><Nm>ÉCOLE DE MUSIQUE EXEMPLE</Nm></Cdtr></RltdPties>",
    "    <RmtInf><Ustrd>COTISATION TRIMESTRIELLE</Ustrd></RmtInf>",
    "  </TxDtls>",
    "  <TxDtls>",
    '    <Amt Ccy="EUR">40.00</Amt><CdtDbtInd>DBIT</CdtDbtInd>',
    "    <RltdPties><Cdtr><Nm>CLUB DE SPORT EXEMPLE</Nm></Cdtr></RltdPties>",
    "    <RmtInf><Ustrd>ABONNEMENT NOVEMBRE</Ustrd></RmtInf>",
    "  </TxDtls>",
    "</NtryDtls>",
    "<AddtlNtryInf>PRLV SEPA REMISE DE 2 OPERATIONS</AddtlNtryInf>",
  ]),
  ...camtEntry("18.90", "DBIT", [
    "<Sts>BOOK</Sts>",
    "<BookgDt><Dt>2026-11-12</Dt></BookgDt>",
    "<AcctSvcrRef>EX2026111201</AcctSvcrRef>",
    "<NtryDtls><TxDtls>",
    "  <RltdPties><Cdtr><Nm>LIBRAIRIE EXEMPLE</Nm></Cdtr></RltdPties>",
    "</TxDtls></NtryDtls>",
  ]),
  ...camtEntry("45.00", "DBIT", [
    "<Sts>BOOK</Sts>",
    "<BookgDt><Dt>2026-11-20</Dt></BookgDt>",
    "<AcctSvcrRef>EX2026112001</AcctSvcrRef>",
    "<NtryDtls><TxDtls>",
    "  <RmtInf><Strd><CdtrRefInf><Ref>FACTURE 2026-0042</Ref></CdtrRefInf></Strd></RmtInf>",
    "</TxDtls></NtryDtls>",
  ]),
  ...camtEntry("2.50", "DBIT", [
    "<Sts>BOOK</Sts>",
    "<BookgDt><Dt>2026-11-30</Dt></BookgDt>",
    "<NtryRef>EX-FRAIS-11</NtryRef>",
    "<AddtlNtryInf>FRAIS TENUE DE COMPTE</AddtlNtryInf>",
  ]),
  "    </Stmt>",
  "  </BkToCstmrStmt>",
  "</Document>",
]);

/**
 * CAMT.053 version 001.10, its elements under a namespace prefix (`camt:`), with two daily
 * statements of the same account: the status as a code (`Sts/Cd`), the parties' names under `Pty`,
 * a comment, a CDATA section and a closing balance that is owed.
 */
/** CAMT.053's elements under the namespace prefix `camt:`, as some banks write them. */
function prefixed(lines: ReadonlyArray<string>): Array<string> {
  return lines.map((line) => line.replaceAll(/<(\/?)(?=[A-Z])/g, "<$1camt:"));
}

const camt053Daily = lf([
  '<?xml version="1.0" encoding="UTF-8"?>',
  ...prefixed([
    '<Document xmlns:camt="urn:iso:std:iso:20022:tech:xsd:camt.053.001.10">',
    "  <BkToCstmrStmt>",
    "    <GrpHdr><MsgId>EX20261202</MsgId><CreDtTm>2026-12-02T21:00:00Z</CreDtTm></GrpHdr>",
    "    <Stmt>",
    "      <Id>EX-2026-12-01</Id>",
    ...camtAccount,
    "      <!-- Opening and closing booked balances of the day. -->",
    ...camtBalance("OPBD", "500.00", "CRDT", "<Dt>2026-12-01</Dt>"),
    ...camtBalance("CLBD", "525.00", "CRDT", "<Dt>2026-12-01</Dt>"),
    ...camtEntry("25.00", "CRDT", [
      "<Sts><Cd>BOOK</Cd></Sts>",
      "<BookgDt><Dt>2026-12-01</Dt></BookgDt>",
      "<ValDt><Dt>2026-12-01</Dt></ValDt>",
      "<AcctSvcrRef>EX2026120101</AcctSvcrRef>",
      "<NtryDtls><TxDtls>",
      "  <RltdPties>",
      "    <Dbtr><Pty><Nm>CAMILLE EXEMPLE</Nm></Pty></Dbtr>",
      "    <DbtrAcct><Id><IBAN>DE39999999990012345678</IBAN></Id></DbtrAcct>",
      "  </RltdPties>",
      "  <RmtInf><Ustrd><![CDATA[REMBOURSEMENT CINÉMA & POP-CORN]]></Ustrd></RmtInf>",
      "</TxDtls></NtryDtls>",
    ]),
    "    </Stmt>",
    "    <Stmt>",
    "      <Id>EX-2026-12-02</Id>",
    ...camtAccount,
    "      <!-- Opening and closing booked balances of the day. -->",
    ...camtBalance("OPBD", "525.00", "CRDT", "<Dt>2026-12-02</Dt>"),
    ...camtBalance("CLBD", "329.20", "DBIT", "<Dt>2026-12-02</Dt>"),
    ...camtEntry("4.20", "DBIT", [
      "<Sts><Cd>BOOK</Cd></Sts>",
      "<BookgDt><Dt>2026-12-02</Dt></BookgDt>",
      "<ValDt><Dt>2026-12-01</Dt></ValDt>",
      "<AcctSvcrRef>EX2026120201</AcctSvcrRef>",
      "<NtryDtls><TxDtls>",
      "  <RltdPties><Cdtr><Pty><Nm>LE FOURNIL DES TILLEULS</Nm></Pty></Cdtr></RltdPties>",
      "</TxDtls></NtryDtls>",
      "<AddtlNtryInf>CB LE FOURNIL DES TILLEULS 01/12</AddtlNtryInf>",
    ]),
    ...camtEntry("850.00", "DBIT", [
      "<Sts><Cd>BOOK</Cd></Sts>",
      "<BookgDt><Dt>2026-12-02</Dt></BookgDt>",
      "<ValDt><Dt>2026-12-02</Dt></ValDt>",
      "<AcctSvcrRef>EX2026120202</AcctSvcrRef>",
      "<NtryDtls><TxDtls>",
      "  <RltdPties><Cdtr><Pty><Nm>SCI DES GLYCINES</Nm></Pty></Cdtr></RltdPties>",
      "  <RmtInf><Ustrd>LOYER DECEMBRE</Ustrd></RmtInf>",
      "</TxDtls></NtryDtls>",
      "<AddtlNtryInf>PRLV SEPA SCI DES GLYCINES</AddtlNtryInf>",
    ]),
    "    </Stmt>",
    "  </BkToCstmrStmt>",
    "</Document>",
  ]),
]);

/**
 * MT940 in SWIFT's blocks (`{1:…}{2:…}{4:` to `-}`), LF: a line without entry date, funds codes
 * (`CR`, `DR`), a reversed debit and a reversed credit (`RD`, `RC`), an amount without decimals
 * (`150,`), supplementary details, an owner's reference alone and `NONREF`, a free-text `:86:` on
 * two lines, the available and forward balances and the statement's own `:86:`.
 */
const mt940SwiftBlocks = lf([
  "{1:F01BEXAFRPPAXXX0000000000}{2:O9401200261105BEXAFRPPAXXX00000000002611051200N}{3:{108:EX0001}}{4:",
  ":20:EX20261105",
  ":25:FR7699999000010001234567809",
  ":28C:00042/001",
  ":60F:C261031EUR1520,30",
  ":61:261102D23,90NMSCNONREF",
  ":86:CB PATISSERIE DU MARCHE 31/10",
  ":61:2611021103CR150,NTRFNONREF//EX2026110301",
  "/OCMT/EUR150,00/",
  ":86:VIR SEPA RECU DE CAMILLE EXEMPLE",
  "REMBOURSEMENT NOEL",
  ":61:2611031103DR64,12NDDTPRLV-EX-0042//EX2026110302",
  ":86:PRLV SEPA ELEC ET GAZ EXEMPLE",
  ":61:2611051105RD64,12NDDTPRLV-EX-0042//EX2026110501",
  ":86:RETOUR PRLV SEPA ELEC ET GAZ EXEMPLE",
  ":61:2611051105RC150,00NTRFVIR-EX-0007",
  ":86:ANNULATION VIR SEPA CAMILLE EXEMPLE",
  ":62F:C261105EUR1496,40",
  ":64:C261105EUR1496,40",
  ":65:C261106EUR1496,40",
  ":86:SOLDE AU 05/11",
  "-}{5:{CHK:0123456789AB}}",
]);

/**
 * MT940 as a German bank writes it: Windows-1252, CRLF, a domestic account (`:25:` bank code and
 * number), `:86:` in `?` subfields cut anywhere (`Tan` then `kstelle`, a line break inside a name),
 * a counterparty's IBAN and a
 * domestic account number, entry dates across the year's end (value 31 December, entry 2 January,
 * and the other way round).
 */
const mt940Structured = crlf([
  ":20:STARTUMSE",
  ":25:99999999/0012345678",
  ":28C:00012/001",
  ":60F:C261230EUR2000,00",
  ":61:2612301230DR45,90NDDTNONREF//EX2026123001",
  ":86:105?00LASTSCHRIFT?100123?20SVWZ+Rechnung 2026-12 Tan",
  "?21kstelle Beispiel?30BEXADEFFXXX?31DE39999999990012345678?32TANKSTELLE BEI",
  "SPIEL G?33MBH",
  ":61:2612310102CR2450,00NTRFNONREF//EX2027010201",
  ":86:166?00GUTSCHRIFT?20Gehalt Dezember?3099999999?310012345678?32ACME BERATUNG",
  ":61:2701021231DR12,50NMSCNONREF",
  ":86:806?00GEBÜHREN?20Kontoführung Dezember",
  ":62F:C270102EUR4391,60",
  "-",
]);

/**
 * MT940 with three messages for two days: the first day's statement on two pages (`:62M:` then
 * `:60M:`), each message ended by `-`; `:86:` in the `/CODE/` form, cut in the middle of a name,
 * with the counterparty as `/NAME/` and `/IBAN/` or as `/CNTP/`, and `/REMI/` with or without
 * `USTD//`.
 */
const mt940MultiStatement = lf([
  ":20:EX20261201",
  ":25:FR7699999000010001234567809EUR",
  ":28C:00340/001",
  ":60F:C261130EUR500,00",
  ":61:2612011201C25,00NTRFNONREF//EX2026120101",
  ":86:/TRTP/SEPA CREDIT TRANSFER/IBAN/DE39999999990012345678/BIC/BEXADEFFXXX/NAME/CAMILLE EXEM",
  "PLE/REMI/USTD//REMBOURSEMENT CINEMA/EREF/NOTPROVIDED",
  ":62M:C261201EUR525,00",
  "-",
  ":20:EX20261201",
  ":25:FR7699999000010001234567809EUR",
  ":28C:00340/002",
  ":60M:C261201EUR525,00",
  ":61:2612011201D4,20NMSCNONREF//EX2026120102",
  ":86:/CNTP/DE39999999990012345678/BEXADEFFXXX/LE FOURNIL DES TILLEULS/EXEMPLEVILLE///REMI/USTD//CB LE FOURNIL 01/12/",
  ":62F:C261201EUR520,80",
  "-",
  ":20:EX20261202",
  ":25:FR7699999000010001234567809EUR",
  ":28C:00341/001",
  ":60F:C261201EUR520,80",
  ":61:2612021202D850,00NDDTNONREF//EX2026120201",
  ":86:/TRTP/SEPA DIRECT DEBIT/NAME/SCI DES GLYCINES/REMI/LOYER DECEMBRE/",
  ":62F:D261202EUR329,20",
  "-",
]);

/**
 * Invented statement files, one per variant the readers meet (packages/import): encodings, sign
 * conventions, date formats, SGML and XML OFX, QFX, QIF, CAMT.053's versions and MT940's forms.
 * The accounts, people and banks do not exist.
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
  ofxUnsignedNoDebit: {
    fileName: "ofx-unsigned-no-debit.ofx",
    bytes: utf8.encode(ofxUnsignedNoDebit),
  },
  qfxCreditCard: { fileName: "qfx-credit-card.qfx", bytes: utf8.encode(qfxCreditCard) },
  /** QIF, UTF-8, day first: the example statement as `writeQif` writes it. */
  qifDayFirst: { fileName: "qif-day-first.qif", bytes: utf8.encode(writeQif(exampleStatement)) },
  qifQuicken: { fileName: "qif-quicken.qif", bytes: utf8.encode(qifQuicken) },
  qifWindows1252: { fileName: "qif-windows-1252.qif", bytes: encodeWindows1252(qifWindows1252) },
  qifDotDates: { fileName: "qif-dot-dates.qif", bytes: utf8.encode(qifDotDates) },
  /** CAMT.053 001.08: the example statement as `writeCamt053` writes it. */
  camt053Version08: {
    fileName: "camt053-version-08.xml",
    bytes: utf8.encode(writeCamt053(exampleStatement)),
  },
  camt053Version02: { fileName: "camt053-version-02.xml", bytes: utf8.encode(camt053Version02) },
  camt053Batch: { fileName: "camt053-batch.xml", bytes: utf8.encode(camt053Batch) },
  camt053Daily: { fileName: "camt053-daily.xml", bytes: utf8.encode(camt053Daily) },
  /** MT940, CRLF, free-text `:86:`: the example statement as `writeMt940` writes it. */
  mt940Plain: { fileName: "mt940-plain.sta", bytes: utf8.encode(writeMt940(exampleStatement)) },
  mt940SwiftBlocks: { fileName: "mt940-swift-blocks.sta", bytes: utf8.encode(mt940SwiftBlocks) },
  mt940Structured: {
    fileName: "mt940-structured.sta",
    bytes: encodeWindows1252(mt940Structured),
  },
  mt940MultiStatement: {
    fileName: "mt940-multi-statement.sta",
    bytes: utf8.encode(mt940MultiStatement),
  },
};
