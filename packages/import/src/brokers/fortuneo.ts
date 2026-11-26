import type { OperationKind, OperationsProfile } from "../operations-profile";
import type { BrokerColumns, OperationField } from "./columns";

// Fortuneo: the history of operations of a securities account or a PEA, as its site exports it
// (README, "Brokers' operations", "Fortuneo"). Remembered from Fortuneo's public help pages, not
// re-checked here: every name, word and format of this table is a guess until a real export's
// header confirms it, and changing one is a change of this table alone.

export const FORTUNEO = {
  separator: ";",
  encoding: "windows-1252",
  dateFormat: "DD/MM/YYYY",
  decimalMark: ",",
  /** The header the shipped profile shows, in its order. */
  header: [
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
  ],
  /** Each field's column names, the first one the header's; `Montant brut` is read past. */
  names: {
    bookedOn: ["Date", "Date opération"],
    kind: ["Opération"],
    securityName: ["Libellé"],
    label: ["Libellé"],
    isin: ["Code ISIN", "ISIN"],
    quantity: ["Qté", "Quantité"],
    unitPrice: ["Prix d'exé", "Prix d'exécution", "Cours"],
    fees: ["Courtage", "Frais"],
    amount: ["Montant net"],
    amountCurrency: ["Devise"],
  },
  required: ["bookedOn", "kind", "securityName", "isin", "quantity", "unitPrice", "amount"],
  /** The words of the `Opération` column and the kinds they name; any other is refused. */
  kinds: [
    { word: "Achat Comptant", kind: "purchase" },
    { word: "Achat", kind: "purchase" },
    { word: "Vente Comptant", kind: "sale" },
    { word: "Vente", kind: "sale" },
    { word: "Encaissement dividende", kind: "dividend" },
    { word: "Dividende", kind: "dividend" },
    { word: "Coupons", kind: "dividend" },
    { word: "Versement espèces", kind: "deposit" },
    { word: "Versement", kind: "deposit" },
    { word: "Retrait espèces", kind: "withdrawal" },
    { word: "Retrait", kind: "withdrawal" },
    { word: "Droits de garde", kind: "fee" },
    { word: "Frais", kind: "fee" },
    { word: "Taxe sur les transactions financières", kind: "fee" },
  ],
} as const satisfies {
  readonly separator: OperationsProfile["separator"];
  readonly encoding: OperationsProfile["encoding"];
  readonly dateFormat: string;
  readonly decimalMark: OperationsProfile["decimalMark"];
  readonly header: ReadonlyArray<string>;
  readonly names: BrokerColumns["names"];
  readonly required: ReadonlyArray<OperationField>;
  readonly kinds: ReadonlyArray<{ readonly word: string; readonly kind: OperationKind }>;
};

export const FORTUNEO_COLUMNS: BrokerColumns = {
  names: FORTUNEO.names,
  required: FORTUNEO.required,
};

/** The column of the shipped header a field's first name stands in, counted from 1. */
function shippedColumn(field: keyof typeof FORTUNEO.names): number {
  const [name] = FORTUNEO.names[field];

  return FORTUNEO.header.indexOf(name) + 1;
}

/** Fortuneo's profile, as shipped: its columns where its header puts them. */
export const FORTUNEO_PROFILE: OperationsProfile = {
  version: 2,
  reads: "operations",
  separator: FORTUNEO.separator,
  encoding: FORTUNEO.encoding,
  skipRows: 0,
  headerRow: true,
  dateFormat: FORTUNEO.dateFormat,
  decimalMark: FORTUNEO.decimalMark,
  columns: {
    bookedOn: shippedColumn("bookedOn"),
    valueOn: null,
    kind: shippedColumn("kind"),
    isin: shippedColumn("isin"),
    securityName: shippedColumn("securityName"),
    securityCurrency: null,
    quantity: shippedColumn("quantity"),
    unitPrice: shippedColumn("unitPrice"),
    fees: shippedColumn("fees"),
    amount: shippedColumn("amount"),
    label: shippedColumn("label"),
    reference: null,
    amountCurrency: null,
    feesCurrency: null,
    priceCurrency: null,
    value: null,
  },
  kinds: FORTUNEO.kinds,
  referenceUnique: false,
  layout: "fortuneo",
};
