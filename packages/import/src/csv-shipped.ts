import { DEGIRO, DEGIRO_PROFILE } from "./brokers/degiro";
import { FORTUNEO, FORTUNEO_PROFILE } from "./brokers/fortuneo";
import { normalizeHeader } from "./csv";
import type { CsvProfile } from "./csv-profile";
import type { OperationsProfile } from "./operations-profile";

// The import profiles shipped with Gousset (docs/data-model.md, "Import profiles"): a few common
// styles of bank export, in code, so that a fix to one arrives with an update. Each is named by a
// style, never by a bank, and recognises its files by their header alone. They are the styles
// detection cannot settle by itself: a statement whose days are all the 12th or before reads both
// day first and month first, and columns named "Paid out" and "Paid in" say no direction detection
// knows. A file in a style detection settles needs no shipped profile. PayPal's activity is the one
// named by its institution (#201): a payment service, not a bank's style, whose export is no table
// of one line per row (`layout`, README, "PayPal's activity"). Brokers' exports of operations are
// named by their broker too (`kind: "operations"`, README, "Brokers' operations"): each broker
// writes its own, and their columns are found by their names.

type Shipped = {
  /** Stable: an import keeps it (`import.shipped_profile`) to say which profile read its file. */
  readonly key: string;
  readonly name: string;
  /** The header row of its files, normalised (`normalizeHeader`), past the lines it skips. */
  readonly header: string;
};

/** A statement's profile shipped with Gousset, in the shape a user's own profile has. */
export type ShippedStatementProfile = Shipped & {
  readonly kind: "statement";
  readonly profile: CsvProfile;
};

/** A broker's operations profile shipped with Gousset. */
export type ShippedOperationsProfile = Shipped & {
  readonly kind: "operations";
  readonly profile: OperationsProfile;
};

export type ShippedProfile = ShippedStatementProfile | ShippedOperationsProfile;

/** The styles shipped, in the order a file is matched against them. */
export const SHIPPED_PROFILES: ReadonlyArray<ShippedStatementProfile> = [
  {
    key: "fr-debit-credit",
    name: "French style: debit and credit columns",
    kind: "statement",
    header: "date;date de valeur;libellé;débit;crédit",
    profile: {
      version: 1,
      separator: ";",
      encoding: "windows-1252",
      // The account's name, its number and the period, above the table.
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
    },
  },
  {
    key: "de-signed",
    name: "German style: one signed amount, value date",
    kind: "statement",
    header: "buchungstag;wertstellung;verwendungszweck;betrag;währung",
    profile: {
      version: 1,
      separator: ";",
      encoding: "windows-1252",
      skipRows: 0,
      headerRow: true,
      dateFormat: "DD.MM.YYYY",
      decimalMark: ",",
      columns: {
        bookedOn: 1,
        valueOn: 2,
        amount: { kind: "signed", column: 4 },
        label: 3,
        memo: null,
        bankId: null,
        currency: 5,
      },
    },
  },
  {
    key: "uk-paid-out-in",
    name: "British style: paid out and paid in columns",
    kind: "statement",
    header: "date;type;description;paid out;paid in;balance",
    profile: {
      version: 1,
      separator: ",",
      encoding: "utf8",
      skipRows: 0,
      headerRow: true,
      dateFormat: "DD/MM/YYYY",
      decimalMark: ".",
      columns: {
        bookedOn: 1,
        valueOn: null,
        amount: { kind: "debit-credit", debit: 4, credit: 5 },
        label: 3,
        memo: null,
        bankId: null,
        currency: null,
      },
    },
  },
  {
    key: "us-signed",
    name: "US style: one signed amount, month first",
    kind: "statement",
    header: "date;description;amount;running bal.",
    profile: {
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
        amount: { kind: "signed", column: 3 },
        label: 2,
        memo: null,
        bankId: null,
        currency: null,
      },
    },
  },
  {
    key: "paypal-activity",
    name: "PayPal activity",
    kind: "statement",
    // The report's mandatory columns, in its order. A file is recognised by its columns' names
    // (`layout`), whichever others its user selected and whatever their language.
    header:
      "date;time;timezone;name;type;status;currency;gross;fee;net;from email address;to email address;transaction id;reference txn id;receipt id",
    profile: {
      version: 1,
      separator: ",",
      encoding: "utf8",
      skipRows: 0,
      headerRow: true,
      // PayPal's documented US format. The layout reads each file's days and amounts as it writes
      // them, from its columns found by name: these say where they are in the header above.
      dateFormat: "MM/DD/YYYY",
      decimalMark: ".",
      columns: {
        bookedOn: 1,
        valueOn: null,
        amount: { kind: "signed", column: 10 },
        label: 4,
        memo: 5,
        bankId: 13,
        currency: 7,
      },
      layout: "paypal-activity",
    },
  },
];

/** The brokers' exports shipped, in the order a file is matched against them, after the styles. */
export const SHIPPED_OPERATIONS_PROFILES: ReadonlyArray<ShippedOperationsProfile> = [
  {
    key: "fortuneo-operations",
    name: "Fortuneo: history of operations",
    kind: "operations",
    // Recognised by its columns' names (`layout`): this header is the one the profile shows.
    header: normalizeHeader(FORTUNEO.header),
    profile: FORTUNEO_PROFILE,
  },
  {
    key: "degiro-transactions",
    name: "Degiro: Transactions.csv",
    kind: "operations",
    header: normalizeHeader(DEGIRO.header),
    profile: DEGIRO_PROFILE,
  },
];

/**
 * The statement profile shipped under `key`, or `undefined` when none is (an older release's key,
 * say).
 */
export function shippedProfile(key: string): ShippedStatementProfile | undefined {
  return SHIPPED_PROFILES.find((each) => each.key === key);
}

/** The broker's operations profile shipped under `key`, or `undefined` when none is. */
export function shippedOperationsProfile(key: string): ShippedOperationsProfile | undefined {
  return SHIPPED_OPERATIONS_PROFILES.find((each) => each.key === key);
}
