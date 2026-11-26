import type { OperationsProfile } from "../operations-profile";
import type { BrokerColumns } from "./columns";

// Degiro: its `Transactions.csv`, one row per execution of an order, purchases and sales only
// (README, "Brokers' operations", "Degiro"). Remembered from Degiro's public help pages, not
// re-checked here. Its amounts carry their currency in the column after them, which has no name;
// a sale's quantity is negative, which is how a row says it was sold.

export const DEGIRO = {
  separator: ",",
  encoding: "utf8",
  dateFormat: "DD-MM-YYYY",
  decimalMark: ".",
  /** The header of an export in English, in its order. */
  header: [
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
  ],
} as const;

export const DEGIRO_COLUMNS: BrokerColumns = {
  names: {
    bookedOn: ["Date"],
    securityName: ["Product"],
    label: ["Product"],
    isin: ["ISIN"],
    quantity: ["Quantity"],
    unitPrice: ["Price"],
    value: ["Value"],
    fees: ["Transaction and/or third", "Transaction and/or third party fees", "Transaction costs"],
    amount: ["Total"],
    reference: ["Order ID"],
  },
  required: ["bookedOn", "securityName", "isin", "quantity", "unitPrice", "value", "amount"],
  currencyAfter: {
    priceCurrency: "unitPrice",
    // The price's currency is the one the product is quoted in.
    securityCurrency: "unitPrice",
    amountCurrency: "amount",
    feesCurrency: "fees",
  },
};

/** Degiro's profile, as shipped: its columns where its header puts them. */
export const DEGIRO_PROFILE: OperationsProfile = {
  version: 2,
  reads: "operations",
  separator: DEGIRO.separator,
  encoding: DEGIRO.encoding,
  skipRows: 0,
  headerRow: true,
  dateFormat: DEGIRO.dateFormat,
  decimalMark: DEGIRO.decimalMark,
  columns: {
    bookedOn: 1,
    valueOn: null,
    // A purchase or a sale, by the sign of the quantity.
    kind: null,
    isin: 4,
    securityName: 3,
    securityCurrency: 9,
    quantity: 7,
    unitPrice: 8,
    fees: 15,
    amount: 17,
    label: 3,
    // An order executed in several parts gives each its row, with the same id: not unique.
    reference: 19,
    amountCurrency: null,
    feesCurrency: null,
    priceCurrency: null,
    value: null,
  },
  kinds: [],
  referenceUnique: false,
  layout: "degiro-transactions",
};
