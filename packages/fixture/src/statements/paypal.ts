import type { SampleFile } from "./samples";

// Invented exports of PayPal's activity (#201), as PayPal's public description of its Activity
// Download report shapes them (docs/data-model.md, "PayPal's activity"): a header row naming the
// columns, every value quoted, commas, UTF-8 with a byte order mark, one row per movement of the
// balance in each of its currencies, and the rows that go with a payment pointing to it by their
// reference. Every name, address, amount and transaction id is made up.

/** One row of the activity, in the account holder's words, before a language writes it. */
type Row = {
  readonly day: string;
  readonly time: string;
  readonly name: string;
  readonly type: string;
  readonly status: "completed" | "pending";
  readonly currency: string;
  readonly gross: string;
  readonly fee: string;
  readonly net: string;
  readonly from: string;
  readonly to: string;
  readonly id: string;
  readonly item: string;
  readonly reference: string;
  readonly balance: string;
  readonly impact: "debit" | "credit" | "memo";
};

const YOU = "noa@example.com";

/** An invented transaction id, of PayPal's 17 characters. */
const id = (n: number) => `0PPEXAMPLE${String(n).padStart(7, "0")}`;

/**
 * October 2026 on a PayPal account in euros: a purchase the bank funds; a purchase in dollars,
 * converted, which a card funds; money received from a person, a fee taken; a purchase paid from
 * the balance, then refunded; a payment still pending and an authorisation voided, which move no
 * money. The types are named in English; `TYPES_FR` names them in French.
 */
const ROWS: ReadonlyArray<Row> = [
  {
    day: "03/10/2026",
    time: "14:05:10",
    name: "Pixel Play Games",
    type: "Express Checkout Payment",
    status: "completed",
    currency: "EUR",
    gross: "-19.99",
    fee: "0.00",
    net: "-19.99",
    from: YOU,
    to: "pixelplay@example.org",
    id: id(1),
    item: "Starter pack",
    reference: "",
    balance: "-19.99",
    impact: "debit",
  },
  {
    day: "03/10/2026",
    time: "14:05:10",
    name: "",
    type: "Bank Deposit to PP Account",
    status: "completed",
    currency: "EUR",
    gross: "19.99",
    fee: "0.00",
    net: "19.99",
    from: "",
    to: YOU,
    id: id(2),
    item: "",
    reference: id(1),
    balance: "0.00",
    impact: "credit",
  },
  {
    day: "05/10/2026",
    time: "19:41:02",
    name: "Example Travel Ltd",
    type: "Express Checkout Payment",
    status: "completed",
    currency: "USD",
    gross: "-30.00",
    fee: "0.00",
    net: "-30.00",
    from: YOU,
    to: "travel@example.org",
    id: id(3),
    item: "City pass",
    reference: "",
    balance: "-30.00",
    impact: "debit",
  },
  {
    day: "05/10/2026",
    time: "19:41:02",
    name: "",
    type: "General Currency Conversion",
    status: "completed",
    currency: "USD",
    gross: "30.00",
    fee: "0.00",
    net: "30.00",
    from: "",
    to: "",
    id: id(4),
    item: "",
    reference: id(3),
    balance: "0.00",
    impact: "credit",
  },
  {
    day: "05/10/2026",
    time: "19:41:02",
    name: "",
    type: "General Currency Conversion",
    status: "completed",
    currency: "EUR",
    gross: "-27.60",
    fee: "0.00",
    net: "-27.60",
    from: "",
    to: "",
    id: id(5),
    item: "",
    reference: id(3),
    balance: "-27.60",
    impact: "debit",
  },
  {
    day: "05/10/2026",
    time: "19:41:02",
    name: "",
    type: "General Card Deposit",
    status: "completed",
    currency: "EUR",
    gross: "27.60",
    fee: "0.00",
    net: "27.60",
    from: "",
    to: YOU,
    id: id(6),
    item: "",
    reference: id(3),
    balance: "0.00",
    impact: "credit",
  },
  {
    day: "08/10/2026",
    time: "08:15:33",
    name: "Camille Example",
    type: "General Payment",
    status: "completed",
    currency: "EUR",
    gross: "50.00",
    fee: "-1.75",
    net: "48.25",
    from: "camille@example.com",
    to: YOU,
    id: id(7),
    item: "Second-hand lamp",
    reference: "",
    balance: "48.25",
    impact: "credit",
  },
  {
    day: "12/10/2026",
    time: "12:02:47",
    name: "Brightread Books",
    type: "Express Checkout Payment",
    status: "completed",
    currency: "EUR",
    gross: "-12.50",
    fee: "0.00",
    net: "-12.50",
    from: YOU,
    to: "brightread@example.org",
    id: id(8),
    item: "Paperback",
    reference: "",
    balance: "35.75",
    impact: "debit",
  },
  {
    day: "21/10/2026",
    time: "10:30:00",
    name: "Brightread Books",
    type: "Payment Refund",
    status: "completed",
    currency: "EUR",
    gross: "12.50",
    fee: "0.00",
    net: "12.50",
    from: "brightread@example.org",
    to: YOU,
    id: id(9),
    item: "Paperback",
    reference: id(8),
    balance: "48.25",
    impact: "credit",
  },
  {
    day: "23/10/2026",
    time: "17:20:05",
    name: "Corner Bakery Online",
    type: "Express Checkout Payment",
    status: "pending",
    currency: "EUR",
    gross: "-8.40",
    fee: "0.00",
    net: "-8.40",
    from: YOU,
    to: "bakery@example.org",
    id: id(10),
    item: "Weekend box",
    reference: "",
    balance: "48.25",
    impact: "debit",
  },
  {
    day: "24/10/2026",
    time: "09:00:12",
    name: "Corner Bakery Online",
    type: "Void of Authorization",
    status: "completed",
    currency: "EUR",
    gross: "8.40",
    fee: "0.00",
    net: "8.40",
    from: "bakery@example.org",
    to: YOU,
    id: id(11),
    item: "",
    reference: id(10),
    balance: "48.25",
    impact: "memo",
  },
];

/** The types above, as a French account's export names them. */
const TYPES_FR: ReadonlyMap<string, string> = new Map([
  ["Express Checkout Payment", "Paiement Express Checkout"],
  ["Bank Deposit to PP Account", "Approvisionnement bancaire du compte PayPal"],
  ["General Currency Conversion", "Conversion de devise générale"],
  ["General Card Deposit", "Approvisionnement général par carte"],
  ["General Payment", "Paiement général"],
  ["Payment Refund", "Remboursement de paiement"],
  ["Void of Authorization", "Annulation d'autorisation"],
]);

/**
 * The columns of these exports: the report's mandatory ones, with three it selects by default
 * (`Item Title`, `Balance`, `Balance Impact`), in the order the report places them.
 */
const HEADER_EN = [
  "Date",
  "Time",
  "TimeZone",
  "Name",
  "Type",
  "Status",
  "Currency",
  "Gross",
  "Fee",
  "Net",
  "From Email Address",
  "To Email Address",
  "Transaction ID",
  "Item Title",
  "Reference Txn ID",
  "Receipt ID",
  "Balance",
  "Balance Impact",
];

/** The same columns in a French account's export. Not checked against a real one: invented. */
const HEADER_FR = [
  "Date",
  "Heure",
  "Fuseau horaire",
  "Nom",
  "Type",
  "État",
  "Devise",
  "Brut",
  "Frais",
  "Net",
  "De l'adresse email",
  "À l'adresse email",
  "Numéro de transaction",
  "Titre de l'objet",
  "Numéro de transaction de référence",
  "Numéro de reçu",
  "Solde",
  "Impact sur le solde",
];

const WORDS_EN = {
  completed: "Completed",
  pending: "Pending",
  debit: "Debit",
  credit: "Credit",
  memo: "Memo",
};

const WORDS_FR = {
  completed: "Terminé",
  pending: "En attente",
  debit: "Débit",
  credit: "Crédit",
  memo: "Mémo",
};

const quoted = (values: ReadonlyArray<string>) => values.map((value) => `"${value}"`).join(",");

/** A row's values in the header's order, in English or in French. */
function cells(row: Row, french: boolean): Array<string> {
  const words = french ? WORDS_FR : WORDS_EN;
  const amount = (text: string) => (french ? text.replace(".", ",") : text);
  const timeZone = french ? "Europe/Paris" : "CEST";

  return [
    row.day,
    row.time,
    timeZone,
    row.name,
    french ? (TYPES_FR.get(row.type) ?? row.type) : row.type,
    words[row.status],
    row.currency,
    amount(row.gross),
    amount(row.fee),
    amount(row.net),
    row.from,
    row.to,
    row.id,
    row.item,
    row.reference,
    "",
    amount(row.balance),
    words[row.impact],
  ];
}

const utf8 = new TextEncoder();

function exported(header: ReadonlyArray<string>, french: boolean): Uint8Array {
  const lines = [quoted(header), ...ROWS.map((row) => quoted(cells(row, french)))];

  return utf8.encode(`﻿${lines.join("\r\n")}\r\n`);
}

/**
 * Invented PayPal activity exports of October 2026 for an account in euros, in English and in
 * French, day first: the same eleven rows, of which seven move the euro balance (#201).
 */
export const paypalActivity = {
  english: { fileName: "Download.CSV", bytes: exported(HEADER_EN, false) },
  french: { fileName: "Download.CSV", bytes: exported(HEADER_FR, true) },
} satisfies { [language: string]: SampleFile };
