import { exampleStatement } from "./example";
import { writeCsv } from "./formats";
import { encodeWindows1252 } from "./samples";
import type { SampleFile } from "./samples";

const utf8 = new TextEncoder();

function ended(lines: ReadonlyArray<string>, end: string): string {
  return `${lines.join(end)}${end}`;
}

/**
 * As a French bank exports a current account: Windows-1252 (accents, `€`, `°`), CRLF, three lines
 * about the account before the header, a booking and a value date, a debit and a credit column
 * holding amounts without their sign, thousands grouped by a no-break space (`1 234,56`), and a
 * quoted label holding the separator.
 */
const csvDebitCredit = ended(
  [
    "Banque Exemple : relevé de compte",
    "Compte courant n° 00012345678",
    "Période du 01/11/2026 au 30/11/2026",
    "Date;Date de valeur;Libellé;Débit;Crédit",
    '02/11/2026;31/10/2026;"CB PÂTISSERIE DU MARCHÉ 31/10";23,90;',
    '02/11/2026;02/11/2026;"VIR SEPA CAMILLE EXEMPLE";;150,00',
    '05/11/2026;05/11/2026;"PRLV SEPA SCI DES GLYCINES; LOYER";1 234,56;',
    '10/11/2026;10/11/2026;"VIR SEPA ACME CONSEIL SALAIRE";;2 450,00',
    '30/11/2026;30/11/2026;"COTISATION CARTE 2,50 €";2,50;',
  ],
  "\r\n",
);

/**
 * As a US bank exports a checking account: UTF-8 with a byte order mark, commas, dates month
 * first, decimal points, and every way of quoting: a value holding the separator, a quote written
 * twice (`""`), a line break inside a memo, a quoted amount with its thousands grouped.
 */
const csvComma = ended(
  [
    "﻿Transaction Date,Description,Memo,Amount,Transaction ID",
    '10/01/2026,EXAMPLE PROPERTY MANAGEMENT,"October rent, unit 4",-1350.00,TX0001',
    '10/03/2026,"THE ""EXAMPLE"" DINER",,-42.17,TX0002',
    '10/15/2026,EXAMPLE CORP PAYROLL,"Pay period',
    '10/01 - 10/15","2,345.67",TX0003',
    "10/20/2026,EXAMPLE STREAMING SERVICE,,-9.99,TX0004",
  ],
  "\n",
);

/** A card's statement, German style: tabs, no header, `15.10.26`, `-1.234,56`. */
const csvTabNoHeader = ended(
  [
    "01.10.26\tREISEBÜRO BEISPIEL\t-1.234,56",
    "15.10.26\tTANKSTELLE BEISPIEL\t-45,90",
    "31.10.26\tZAHLUNG DANKE\t1.280,46",
  ],
  "\n",
);

/**
 * Pipes, ISO dates, lines ended by a lone CR, the bank's references, a memo, and a debit column
 * that writes its amounts negative beside a credit column, a zero standing for an empty one.
 */
const csvPipe = ended(
  [
    "Booking date|Value date|Reference|Payee|Details|Debit|Credit",
    "2026-11-02|2026-11-02|REF-0001|EXAMPLE BOOKSHOP|Card payment|-25.00|",
    "2026-11-05|2026-11-04|REF-0002|ACME BONUS||  |1000.00",
    "2026-11-12|2026-11-12|REF-0003|CHEQUE 0001234|Cheque|-80.00|0.00",
    "2026-11-30|2026-11-30|REF-0004|INTEREST|Monthly interest||3.10",
  ],
  "\r",
);

/**
 * Invented CSV statements, one per variant an import profile must read (packages/import):
 * separators, quoting, debit and credit columns, date formats, encodings. The accounts, people and
 * banks do not exist.
 */
export const csvSamples = {
  /** UTF-8, semicolons, day first, decimal commas: the example statement as `writeCsv` writes it. */
  csvSemicolon: { fileName: "csv-semicolon.csv", bytes: utf8.encode(writeCsv(exampleStatement)) },
  csvDebitCredit: { fileName: "csv-debit-credit.csv", bytes: encodeWindows1252(csvDebitCredit) },
  csvComma: { fileName: "csv-comma.csv", bytes: utf8.encode(csvComma) },
  csvTabNoHeader: { fileName: "csv-tab-no-header.csv", bytes: utf8.encode(csvTabNoHeader) },
  csvPipe: { fileName: "csv-pipe.csv", bytes: utf8.encode(csvPipe) },
} satisfies { [name: string]: SampleFile };
