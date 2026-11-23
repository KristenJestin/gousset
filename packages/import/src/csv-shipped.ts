import type { CsvProfile } from "./csv-profile";

// The import profiles shipped with Gousset (docs/data-model.md, "Import profiles"): a few common
// styles of bank export, in code, so that a fix to one arrives with an update. Each is named by a
// style, never by a bank, and recognises its files by their header alone. They are the styles
// detection cannot settle by itself: a statement whose days are all the 12th or before reads both
// day first and month first, and columns named "Paid out" and "Paid in" say no direction detection
// knows. A file in a style detection settles needs no shipped profile.

/** A profile shipped with Gousset, in the shape a user's own profile has. */
export type ShippedProfile = {
  /** Stable: an import keeps it (`import.shipped_profile`) to say which profile read its file. */
  readonly key: string;
  readonly name: string;
  readonly kind: "statement";
  /** The header row of its files, normalised (`normalizeHeader`), past the lines it skips. */
  readonly header: string;
  readonly profile: CsvProfile;
};

/** The styles shipped, in the order a file is matched against them. */
export const SHIPPED_PROFILES: ReadonlyArray<ShippedProfile> = [
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
];

/** The profile shipped under `key`, or `undefined` when none is (an older release's key, say). */
export function shippedProfile(key: string): ShippedProfile | undefined {
  return SHIPPED_PROFILES.find((each) => each.key === key);
}
