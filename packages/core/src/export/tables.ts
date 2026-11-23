// What an export holds (#22): each table of a user's data, the file it goes to, and what each of
// its columns means, as the manifest says it to whoever reads the archive without Gousset. A table
// added later (docs/data-model.md, "What later milestones add") is one more entry here; the
// end-to-end test of the export checks that every column of every user table is described.

/** A column of an exported table: its name in the files, and what it holds. */
export type ExportColumn = { readonly name: string; readonly holds: string };

/** A table of a user's data as an export writes it: `<file>.json` and `<file>.csv`. */
export type ExportTable = {
  /** The database's table: one query reads it whole. */
  readonly table: string;
  /** The files' name, without extension. */
  readonly file: string;
  readonly holds: string;
  /** In the order the CSV file gives them. */
  readonly columns: ReadonlyArray<ExportColumn>;
};

const ID = { name: "id", holds: "the row's id (a uuid), which other files refer to" };
const OWNER = { name: "user_id", holds: "the user the row belongs to: you" };
const CREATED_AT = { name: "created_at", holds: "when the row was made" };
const UPDATED_AT = { name: "updated_at", holds: "when the row was last changed" };

export const ACCOUNTS: ExportTable = {
  table: "account",
  file: "accounts",
  holds: "every account you follow, of every kind",
  columns: [
    ID,
    OWNER,
    { name: "name", holds: "the account's name, as you call it" },
    { name: "kind", holds: "current, savings, card, investment, loan or benefit" },
    { name: "envelope", holds: "its tax envelope: pea, life_insurance, livret_a, other, or empty" },
    { name: "institution", holds: "the bank, broker or issuer" },
    { name: "currency", holds: "the ISO 4217 code every amount of the account is in" },
    { name: "mode", holds: "lines (kept by its lines) or balance (kept by a balance noted)" },
    { name: "opening_balance_minor", holds: "the balance before its first line, in minor units" },
    { name: "opened_on", holds: "the day it was opened at the bank, when known" },
    { name: "closed_on", holds: "the day it was closed; empty while open" },
    { name: "iban", holds: "its IBAN, upper case without spaces" },
    { name: "number", holds: "the account number an OFX or QFX file gives" },
    {
      name: "settles_into_account_id",
      holds: "a deferred-debit card: the account (accounts.id) it is debited from",
    },
    {
      name: "credit_order",
      holds: "a benefit account: which credits are used first, oldest_first or expiring_first",
    },
    CREATED_AT,
    UPDATED_AT,
  ],
};

export const ACCOUNT_BALANCES: ExportTable = {
  table: "account_balance",
  file: "account-balances",
  holds: "the balances statements gave and the ones you noted, each at the end of its day",
  columns: [
    ID,
    OWNER,
    { name: "account_id", holds: "the account (accounts.id)" },
    { name: "day", holds: "the balance is the one at the end of this day" },
    { name: "balance_minor", holds: "the balance, in minor units of the account's currency" },
    { name: "source", holds: "statement (read from a file) or noted (entered by you)" },
    { name: "import_id", holds: "the import it was read from (imports.id)" },
  ],
};

export const STATEMENT_LINES: ExportTable = {
  table: "statement_line",
  file: "statement-lines",
  holds: "every line of every account, as the bank wrote it",
  columns: [
    ID,
    OWNER,
    { name: "account_id", holds: "the account (accounts.id)" },
    { name: "import_id", holds: "the import that read it (imports.id); empty when entered" },
    { name: "source", holds: "import, manual, balance or counterpart" },
    {
      name: "state",
      holds: "counted, held (a near duplicate set aside for review) or discarded",
    },
    { name: "booked_on", holds: "the day the bank booked it" },
    { name: "value_on", holds: "its value date, when the bank gives one" },
    {
      name: "amount_minor",
      holds: "signed (negative: money leaving), in minor units of the account's currency",
    },
    { name: "original_amount_minor", holds: "what was paid in another currency, in its units" },
    { name: "original_currency", holds: "that currency's ISO 4217 code" },
    { name: "label", holds: "the bank's label" },
    { name: "memo", holds: "the rest of the bank's text, when the file has it" },
    { name: "counterparty_name", holds: "who paid or was paid, when the file names them" },
    { name: "counterparty_iban", holds: "their IBAN, when given" },
    { name: "bank_id", holds: "the bank's own reference for the line" },
    { name: "dedup_key", holds: "the key that recognises the line in a later import" },
    {
      name: "duplicate_of_line_id",
      holds: "a held line: the line it looks like (statement-lines.id)",
    },
    { name: "expires_on", holds: "a credit of a benefit account: the day it expires" },
    CREATED_AT,
    UPDATED_AT,
    // Added after the others (v0.3): the database keeps it last.
    {
      name: "review_state",
      holds: "to_review (the monthly review lists it) or done (you, or a sure rule, settled it)",
    },
    {
      name: "transfer_refused",
      holds: "true once you said the line is no transfer: Gousset no longer pairs it by itself",
    },
  ],
};

export const IMPORTS: ExportTable = {
  table: "import",
  file: "imports",
  holds: "every statement file you imported, with its summary",
  columns: [
    ID,
    OWNER,
    { name: "account_id", holds: "the account it went to (accounts.id)" },
    { name: "file_name", holds: "the file's name, as dropped" },
    { name: "file_sha256", holds: "the file's SHA-256, in hexadecimal" },
    { name: "format", holds: "ofx, qfx, qif, camt053, mt940 or csv" },
    { name: "profile_id", holds: "the CSV profile that read it (import-profiles.id)" },
    { name: "shipped_profile", holds: "or the key of a CSV profile shipped with Gousset" },
    { name: "status", holds: "queued, reading, waiting, saving, done, failed or undone" },
    { name: "period_from", holds: "the first day the file covers" },
    { name: "period_to", holds: "the last day the file covers" },
    { name: "lines_read", holds: "lines the file held" },
    { name: "lines_added", holds: "lines it added" },
    { name: "lines_duplicate", holds: "lines already known, not added again" },
    { name: "lines_held", holds: "lines held for review as near duplicates" },
    { name: "error_code", holds: "why it failed, as a code" },
    { name: "created_at", holds: "when the file was dropped" },
    { name: "finished_at", holds: "when the import ended" },
    { name: "undone_at", holds: "when it was undone" },
    // Added after the others (#20): the database keeps it last.
    { name: "job_id", holds: "the background job that ran it" },
  ],
};

export const IMPORT_PROFILES: ExportTable = {
  table: "import_profile",
  file: "import-profiles",
  holds: "your CSV profiles: how to read one bank's or broker's CSV files",
  columns: [
    ID,
    OWNER,
    { name: "name", holds: "the profile's name" },
    { name: "institution", holds: "the bank or broker it reads" },
    { name: "kind", holds: "statement (an account's lines) or operations (a broker's)" },
    {
      name: "definition",
      holds: "how to read the file (separator, columns, formats), as JSON with its version",
    },
    { name: "header", holds: "the file's header row, to recognise a file the profile reads" },
    CREATED_AT,
    UPDATED_AT,
  ],
};

export const MERCHANTS: ExportTable = {
  table: "merchant",
  file: "merchants",
  holds: "who you paid or were paid by, cleaned from the banks' labels",
  columns: [
    ID,
    OWNER,
    { name: "name", holds: "the merchant's name, as you see it" },
    CREATED_AT,
    UPDATED_AT,
  ],
};

export const MERCHANT_ALIASES: ExportTable = {
  table: "merchant_alias",
  file: "merchant-aliases",
  holds: "the cleaned labels that name each merchant: a line whose label cleans to one is its",
  columns: [
    ID,
    OWNER,
    { name: "merchant_id", holds: "the merchant it names (merchants.id)" },
    { name: "alias", holds: "the cleaned label, upper case" },
    CREATED_AT,
  ],
};

export const TRANSFERS: ExportTable = {
  table: "transfer",
  file: "transfers",
  holds: "money moved between two of your accounts: the two lines paired as one transfer",
  columns: [
    ID,
    OWNER,
    { name: "out_line_id", holds: "the line money left by (statement-lines.id)" },
    { name: "in_line_id", holds: "the line it came in by (statement-lines.id)" },
    { name: "paired_by", holds: "who paired them: import (found by Gousset), rule or user" },
  ],
};

/** Every table an export writes, in the manifest's order. */
export const EXPORT_TABLES: ReadonlyArray<ExportTable> = [
  ACCOUNTS,
  ACCOUNT_BALANCES,
  STATEMENT_LINES,
  IMPORTS,
  IMPORT_PROFILES,
  TRANSFERS,
  MERCHANTS,
  MERCHANT_ALIASES,
];

/** Where the files imported go: one folder per import, named by its id. */
export const IMPORT_FILES_FOLDER = "import-files";
