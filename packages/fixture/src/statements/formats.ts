import { closingBalanceMinor, dayParts, formatMinor } from "./statement";
import type { Statement } from "./statement";

/** The statement formats Gousset imports (docs/architecture.md, "Packages"). */
export const statementFormats = ["ofx", "qif", "camt053", "mt940", "csv"] as const;

export type StatementFormat = (typeof statementFormats)[number];

/** A statement written in one format, as a bank would hand it over. */
export type StatementFile = {
  format: StatementFormat;
  fileName: string;
  contents: string;
};

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function compactDay(day: string): string {
  return day.replaceAll("-", "");
}

/** OFX 2.2 (XML), a bank statement response with its ledger balance. */
export function writeOfx(statement: Statement): string {
  const transactions = statement.lines.map((line) =>
    [
      "<STMTTRN>",
      `<TRNTYPE>${line.amountMinor < 0 ? "DEBIT" : "CREDIT"}</TRNTYPE>`,
      `<DTPOSTED>${compactDay(line.bookedOn)}</DTPOSTED>`,
      `<TRNAMT>${formatMinor(line.amountMinor, ".")}</TRNAMT>`,
      `<FITID>${escapeXml(line.reference)}</FITID>`,
      // OFX caps NAME at 32 characters; the whole label goes in MEMO, as banks do.
      `<NAME>${escapeXml(line.label.slice(0, 32))}</NAME>`,
      `<MEMO>${escapeXml(line.label)}</MEMO>`,
      "</STMTTRN>",
    ].join("\n"),
  );

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<?OFX OFXHEADER="200" VERSION="220" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>',
    "<OFX>",
    "<SIGNONMSGSRSV1><SONRS>",
    "<STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>",
    `<DTSERVER>${compactDay(statement.to)}</DTSERVER>`,
    "<LANGUAGE>FRA</LANGUAGE>",
    "</SONRS></SIGNONMSGSRSV1>",
    "<BANKMSGSRSV1><STMTTRNRS>",
    "<TRNUID>1</TRNUID>",
    "<STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>",
    "<STMTRS>",
    `<CURDEF>${statement.account.currency}</CURDEF>`,
    "<BANKACCTFROM>",
    `<BANKID>${statement.bank.code}</BANKID>`,
    `<ACCTID>${statement.account.number}</ACCTID>`,
    "<ACCTTYPE>CHECKING</ACCTTYPE>",
    "</BANKACCTFROM>",
    "<BANKTRANLIST>",
    `<DTSTART>${compactDay(statement.from)}</DTSTART>`,
    `<DTEND>${compactDay(statement.to)}</DTEND>`,
    ...transactions,
    "</BANKTRANLIST>",
    "<LEDGERBAL>",
    `<BALAMT>${formatMinor(closingBalanceMinor(statement), ".")}</BALAMT>`,
    `<DTASOF>${compactDay(statement.to)}</DTASOF>`,
    "</LEDGERBAL>",
    "</STMTRS>",
    "</STMTTRNRS></BANKMSGSRSV1>",
    "</OFX>",
    "",
  ].join("\n");
}

/** QIF, a bank account; dates are day first (`DD/MM/YYYY`), as French banks write them. */
export function writeQif(statement: Statement): string {
  const entries = statement.lines.map((line) => {
    const { year, month, date } = dayParts(line.bookedOn);

    return [
      `D${date}/${month}/${year}`,
      `T${formatMinor(line.amountMinor, ".")}`,
      `P${line.label}`,
      `N${line.reference}`,
      "^",
    ].join("\n");
  });

  return ["!Type:Bank", ...entries, ""].join("\n");
}

function camtBalance(code: "OPBD" | "CLBD", amountMinor: number, day: string, currency: string) {
  return [
    "<Bal>",
    `<Tp><CdOrPrtry><Cd>${code}</Cd></CdOrPrtry></Tp>`,
    `<Amt Ccy="${currency}">${formatMinor(Math.abs(amountMinor), ".")}</Amt>`,
    `<CdtDbtInd>${amountMinor < 0 ? "DBIT" : "CRDT"}</CdtDbtInd>`,
    `<Dt><Dt>${day}</Dt></Dt>`,
    "</Bal>",
  ].join("\n");
}

/** ISO 20022 CAMT.053 (version 001.08), one statement with its opening and closing balances. */
export function writeCamt053(statement: Statement): string {
  const { currency } = statement.account;

  const entries = statement.lines.map((line) =>
    [
      "<Ntry>",
      `<NtryRef>${escapeXml(line.reference)}</NtryRef>`,
      `<Amt Ccy="${currency}">${formatMinor(Math.abs(line.amountMinor), ".")}</Amt>`,
      `<CdtDbtInd>${line.amountMinor < 0 ? "DBIT" : "CRDT"}</CdtDbtInd>`,
      "<Sts><Cd>BOOK</Cd></Sts>",
      `<BookgDt><Dt>${line.bookedOn}</Dt></BookgDt>`,
      `<ValDt><Dt>${line.bookedOn}</Dt></ValDt>`,
      `<AcctSvcrRef>${escapeXml(line.reference)}</AcctSvcrRef>`,
      "<BkTxCd><Prtry><Cd>NOTPROVIDED</Cd></Prtry></BkTxCd>",
      "<NtryDtls><TxDtls>",
      `<RmtInf><Ustrd>${escapeXml(line.label)}</Ustrd></RmtInf>`,
      "</TxDtls></NtryDtls>",
      "</Ntry>",
    ].join("\n"),
  );

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">',
    "<BkToCstmrStmt>",
    "<GrpHdr>",
    `<MsgId>EX-${compactDay(statement.to)}</MsgId>`,
    `<CreDtTm>${statement.to}T23:00:00</CreDtTm>`,
    "</GrpHdr>",
    "<Stmt>",
    `<Id>EX-${statement.from}</Id>`,
    `<CreDtTm>${statement.to}T23:00:00</CreDtTm>`,
    `<FrToDt><FrDtTm>${statement.from}T00:00:00</FrDtTm><ToDtTm>${statement.to}T23:59:59</ToDtTm></FrToDt>`,
    "<Acct>",
    `<Id><IBAN>${statement.account.iban}</IBAN></Id>`,
    `<Ccy>${currency}</Ccy>`,
    `<Ownr><Nm>${escapeXml(statement.account.holder)}</Nm></Ownr>`,
    `<Svcr><FinInstnId><BICFI>${statement.bank.bic}</BICFI><Nm>${escapeXml(statement.bank.name)}</Nm></FinInstnId></Svcr>`,
    "</Acct>",
    camtBalance("OPBD", statement.openingBalanceMinor, statement.from, currency),
    camtBalance("CLBD", closingBalanceMinor(statement), statement.to, currency),
    ...entries,
    "</Stmt>",
    "</BkToCstmrStmt>",
    "</Document>",
    "",
  ].join("\n");
}

function mt940Day(day: string): string {
  const { year, month, date } = dayParts(day);

  return `${year.slice(2)}${month}${date}`;
}

function mt940Balance(tag: "60F" | "62F", amountMinor: number, day: string, currency: string) {
  const sign = amountMinor < 0 ? "D" : "C";

  return `:${tag}:${sign}${mt940Day(day)}${currency}${formatMinor(Math.abs(amountMinor), ",")}`;
}

/** SWIFT MT940, the text block alone (`:20:` to `:62F:`), lines ending in CRLF as banks send it. */
export function writeMt940(statement: Statement): string {
  const { currency } = statement.account;

  const entries = statement.lines.flatMap((line) => {
    const { month, date } = dayParts(line.bookedOn);
    const mark = line.amountMinor < 0 ? "D" : "C";
    const amount = formatMinor(Math.abs(line.amountMinor), ",");

    return [
      `:61:${mt940Day(line.bookedOn)}${month}${date}${mark}${amount}NTRF${line.reference}//${line.reference}`,
      `:86:${line.label}`,
    ];
  });

  return [
    `:20:EX${compactDay(statement.to)}`,
    `:25:${statement.account.iban}`,
    ":28C:00001/001",
    mt940Balance("60F", statement.openingBalanceMinor, statement.from, currency),
    ...entries,
    mt940Balance("62F", closingBalanceMinor(statement), statement.to, currency),
    "",
  ].join("\r\n");
}

function csvField(text: string): string {
  return `"${text.replaceAll('"', '""')}"`;
}

/**
 * CSV as a French bank exports it: semicolons, day-first dates and decimal commas. Later CSV
 * profiles add their own writers next to this one.
 */
export function writeCsv(statement: Statement): string {
  const rows = statement.lines.map((line) => {
    const { year, month, date } = dayParts(line.bookedOn);

    return [
      `${date}/${month}/${year}`,
      csvField(line.label),
      formatMinor(line.amountMinor, ","),
      statement.account.currency,
      line.reference,
    ].join(";");
  });

  return ["Date;Libelle;Montant;Devise;Reference", ...rows, ""].join("\n");
}

const extensions = {
  ofx: "ofx",
  qif: "qif",
  camt053: "xml",
  mt940: "sta",
  csv: "csv",
} satisfies { [format in StatementFormat]: string };

export function writeStatement(format: StatementFormat, statement: Statement): StatementFile {
  const fileName = `statement-${statement.from.slice(0, 7)}-${format}.${extensions[format]}`;

  switch (format) {
    case "ofx":
      return { format, fileName, contents: writeOfx(statement) };
    case "qif":
      return { format, fileName, contents: writeQif(statement) };
    case "camt053":
      return { format, fileName, contents: writeCamt053(statement) };
    case "mt940":
      return { format, fileName, contents: writeMt940(statement) };
    case "csv":
      return { format, fileName, contents: writeCsv(statement) };
  }
}
