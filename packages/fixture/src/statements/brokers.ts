import { encodeWindows1252 } from "./samples";

// Invented exports of two brokers' operations (#250), as their public help pages were remembered
// when Gousset's profiles for them were written (`packages/import/profiles/`): guessed, never a
// real export. Every amount and reference is made up, and the ISINs are in the country code XX,
// which no country has, each with a check digit that holds.

/** Invented ISINs: `XX`, nine digits, and the check digit ISO 6166 gives them. */
export const BROKER_ISINS = {
  fund: "XX0000000002",
  share: "XX0000000010",
  bond: "XX0000000028",
} as const;

/** Fortuneo's history of operations, its header as guessed: `;`, Windows-1252. */
export const FORTUNEO_HEADER: ReadonlyArray<string> = [
  "Date",
  "Opération",
  "Libellé",
  "Code ISIN",
  "Qté",
  "Prix d'exé",
  "Montant brut",
  "Courtage",
  "Montant net",
  "Devise",
];

/** A Fortuneo export of these rows under this header, CRLF, in Windows-1252. */
export function fortuneoExport(
  rows: ReadonlyArray<ReadonlyArray<string>>,
  header: ReadonlyArray<string> = FORTUNEO_HEADER,
): Uint8Array {
  const text = [header, ...rows].map((row) => row.join(";")).join("\r\n");

  return encodeWindows1252(`${text}\r\n`);
}

/** A Fortuneo row in its header's order, from the fields it fills (`Montant brut` left empty). */
export function fortuneoRow(fields: {
  readonly date: string;
  readonly kind: string;
  readonly name: string;
  readonly isin?: string;
  readonly quantity?: string;
  readonly price?: string;
  readonly fees?: string;
  readonly amount: string;
  readonly currency?: string;
}): Array<string> {
  return [
    fields.date,
    fields.kind,
    fields.name,
    fields.isin ?? "",
    fields.quantity ?? "",
    fields.price ?? "",
    "",
    fields.fees ?? "",
    fields.amount,
    fields.currency ?? "EUR",
  ];
}

/**
 * October and November 2026 on a Fortuneo PEA: a deposit, a purchase, a dividend whose withholding
 * tax is its fees, a sale, a custody fee. The fees are written with a minus and without.
 */
export const FORTUNEO_ROWS: ReadonlyArray<ReadonlyArray<string>> = [
  fortuneoRow({
    date: "05/10/2026",
    kind: "Versement espèces",
    name: "VIREMENT",
    amount: "1 000,00",
  }),
  fortuneoRow({
    date: "06/10/2026",
    kind: "Achat Comptant",
    name: "NORTHWIND WORLD ETF",
    isin: BROKER_ISINS.fund,
    quantity: "10",
    price: "25,1234",
    fees: "-1,95",
    amount: "-253,18",
  }),
  fortuneoRow({
    date: "20/10/2026",
    kind: "Encaissement dividende",
    name: "NORTHWIND WORLD ETF",
    isin: BROKER_ISINS.fund,
    // A dividend's count of shares is no trade's quantity: read past.
    quantity: "10",
    fees: "0,63",
    amount: "3,57",
  }),
  fortuneoRow({
    date: "03/11/2026",
    kind: "Vente Comptant",
    name: "NORTHWIND WORLD ETF",
    isin: BROKER_ISINS.fund,
    quantity: "4",
    price: "27,50",
    fees: "1,95",
    amount: "108,05",
  }),
  fortuneoRow({
    date: "30/11/2026",
    kind: "Droits de garde",
    name: "DROITS DE GARDE",
    amount: "2,00",
  }),
];

/**
 * Degiro's `Transactions.csv` in English, its header as guessed: each amount followed by a column
 * with no name holding its currency, `,`, UTF-8.
 */
export const DEGIRO_HEADER: ReadonlyArray<string> = [
  "Date",
  "Time",
  "Product",
  "ISIN",
  "Reference exchange",
  "Venue",
  "Quantity",
  "Price",
  "",
  "Local value",
  "",
  "Value",
  "",
  "Exchange rate",
  "Transaction and/or third",
  "",
  "Total",
  "",
  "Order ID",
];

/** A Degiro export of these rows, every value quoted as Degiro writes them, LF, in UTF-8. */
export function degiroExport(rows: ReadonlyArray<ReadonlyArray<string>>): Uint8Array {
  const quoted = [DEGIRO_HEADER, ...rows].map((row) => row.map((value) => `"${value}"`).join(","));

  return new TextEncoder().encode(`${quoted.join("\n")}\n`);
}

/**
 * Three executions on a Degiro account in euros: a fund bought in euros, a share bought in
 * dollars (its value in euros beside its price), and a sale, whose quantity is negative. In the
 * header's order: Date, Time, Product, ISIN, Reference exchange, Venue, Quantity, Price, its
 * currency, Local value, its currency, Value, its currency, Exchange rate, the fees, their
 * currency, Total, its currency, Order ID.
 */
export const DEGIRO_ROWS: ReadonlyArray<ReadonlyArray<string>> = [
  [
    "06-10-2026",
    "09:05",
    "NORTHWIND WORLD ETF",
    BROKER_ISINS.fund,
    "EAM",
    "XAMS",
    "3",
    "99.5000",
    "EUR",
    "-298.50",
    "EUR",
    "-298.50",
    "EUR",
    "",
    "-2.00",
    "EUR",
    "-300.50",
    "EUR",
    "a1b2c3d4-0000-4000-8000-000000000001",
  ],
  [
    "07-10-2026",
    "15:31",
    "SOUTHWIND HOLDINGS",
    BROKER_ISINS.share,
    "NDQ",
    "XNAS",
    "2",
    "150.00",
    "USD",
    "-300.00",
    "USD",
    "-275.03",
    "EUR",
    "1.0908",
    "-1.00",
    "EUR",
    "-276.03",
    "EUR",
    "a1b2c3d4-0000-4000-8000-000000000002",
  ],
  [
    "03-11-2026",
    "10:12",
    "NORTHWIND WORLD ETF",
    BROKER_ISINS.fund,
    "EAM",
    "XAMS",
    "-1",
    "101.2500",
    "EUR",
    "101.25",
    "EUR",
    "101.25",
    "EUR",
    "",
    "-2.00",
    "EUR",
    "99.25",
    "EUR",
    "a1b2c3d4-0000-4000-8000-000000000003",
  ],
];
