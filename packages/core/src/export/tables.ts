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
  /** The columns its rows are ordered by: its id when left out, a table of links having none. */
  readonly orderedBy?: ReadonlyArray<string>;
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
    // Added after the others (v0.3): the database keeps it last.
    {
      name: "balance_category_id",
      holds: "an account kept by its balance: the category (categories.id) its movement goes to",
    },
    {
      name: "top_up_days",
      holds:
        "a benefit account: the days its issuer takes to charge a purchase's rest to a bank card",
    },
    {
      name: "top_up_cap_minor",
      holds: "a benefit account: the most it pays a day, in minor units; empty when unknown",
    },
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
    {
      name: "balance_id",
      holds: "a line made from a balance you noted: that balance (account-balances.id)",
    },
    {
      name: "link_refused",
      holds: "true once you took the line out of an expense: Gousset no longer links it by itself",
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
    // Added after job_id (#130).
    {
      name: "balance_ignored",
      holds: "true when the file's balance of 0 looked empty, its account's lines saying otherwise",
    },
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

export const CATEGORIES: ExportTable = {
  table: "category",
  file: "categories",
  holds: "your expense and income categories, on two levels",
  columns: [
    ID,
    OWNER,
    { name: "parent_id", holds: "the category it is under (categories.id); empty at the top" },
    { name: "kind", holds: "expense or income" },
    { name: "name", holds: "the category's name" },
    { name: "icon", holds: "the key of the icon it is shown with" },
    {
      name: "position",
      holds: "its place among its siblings, which are ordered by it, then by id",
    },
    { name: "archived_at", holds: "when it was archived; empty while in use" },
    {
      name: "benchmark_mode",
      holds: "what its spending is compared with: automatic (the six-month average), fixed or none",
    },
    {
      name: "benchmark_minor",
      holds: "a fixed benchmark, in minor units of your currency",
    },
    {
      name: "is_fallback",
      holds: "true for its kind's fallback (Other), where an entry goes until it is classified",
    },
    CREATED_AT,
    UPDATED_AT,
    // Added after the others (#194): the database keeps it last.
    {
      name: "operation",
      holds:
        "loan, fee or interest: the lines of that operation, which name no merchant, go in it by default; empty for none",
    },
  ],
};

export const ENTRIES: ExportTable = {
  table: "entry",
  file: "entries",
  holds: "what happened: each expense and income, with its category, made of parts of lines",
  columns: [
    ID,
    OWNER,
    { name: "kind", holds: "expense or income" },
    { name: "happened_on", holds: "the day it happened" },
    { name: "category_id", holds: "its category (categories.id)" },
    { name: "note", holds: "your note" },
    {
      name: "classified_by",
      holds:
        "default (not classified yet: in its merchant's default category, or its kind's fallback), rule or user (by you)",
    },
    CREATED_AT,
    UPDATED_AT,
    // Added after the others (#25): the database keeps them last.
    {
      name: "merchant_id",
      holds: "the merchant a rule or you set (merchants.id); empty for none",
    },
    { name: "rule_id", holds: "the rule that classified it (rules.id); empty for none" },
  ],
};

export const ENTRY_PARTS: ExportTable = {
  table: "entry_part",
  file: "entry-parts",
  holds: "which lines pay each entry, or refund it, and by how much",
  columns: [
    ID,
    OWNER,
    { name: "entry_id", holds: "the entry (entries.id)" },
    { name: "line_id", holds: "the line (statement-lines.id)" },
    {
      name: "role",
      holds: "payment (money the entry's way: out for an expense, in for an income) or refund",
    },
    {
      name: "amount_minor",
      holds: "how much of the line, positive, in minor units of its account's currency",
    },
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
    // Added after the others (#23): the database keeps it last.
    {
      name: "default_category_id",
      holds: "the category (categories.id) its entries go in by default; empty for none",
    },
    // Added after the others (#30): the database keeps it last.
    {
      name: "is_intermediary",
      holds: "true for a payment intermediary (PayPal…): who was paid through it is set by hand",
    },
    // Added after the others (#34): the database keeps it last.
    {
      name: "subscription_dismissed",
      holds: "true when you said its payments are no subscription: none is proposed for it",
    },
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
    // Added after the others (#29): the database keeps it last.
    {
      name: "funds_entry_id",
      holds: "the expense (entries.id) a refund from a benefit account funds; empty for none",
    },
  ],
};

export const RULES: ExportTable = {
  table: "rule",
  file: "rules",
  holds: "your rules: what a line must match, and the merchant and category its entry then gets",
  columns: [
    ID,
    OWNER,
    {
      name: "position",
      holds: "its place: rules are tried in this order, the first that matches wins",
    },
    { name: "enabled", holds: "false when it is turned off" },
    {
      name: "conditions",
      holds: "what a line must match, as JSON: label, account, amount, direction, day or date",
    },
    { name: "set_merchant_id", holds: "the merchant it sets (merchants.id); empty for none" },
    { name: "set_category_id", holds: "the category it sets (categories.id); empty for none" },
    { name: "applied_count", holds: "how many lines it classified" },
    {
      name: "created_from",
      holds: "correction (proposed when you corrected a line) or user (written on its screen)",
    },
    CREATED_AT,
    UPDATED_AT,
    // Added after the others (#37): the database keeps it last.
    {
      name: "attach_subject_id",
      holds: "the subject (subjects.id) it attaches its lines' expenses to; empty for none",
    },
  ],
};

export const SUBJECTS: ExportTable = {
  table: "subject",
  file: "subjects",
  holds: "what you spend for (a van, a house, a trip), nested: a subject counts its children's",
  columns: [
    ID,
    OWNER,
    { name: "parent_id", holds: "the subject it is under (subjects.id); empty at the top" },
    { name: "name", holds: "the subject's name" },
    { name: "archived_at", holds: "when it was archived; empty while in use" },
    {
      name: "estimated_value_minor",
      holds: "what it is worth, in minor units of value_currency; empty when it has no value",
    },
    { name: "value_currency", holds: "the ISO 4217 code of its estimated value" },
    { name: "loan_account_id", holds: "the loan (accounts.id) it is bought with; empty for none" },
    { name: "starts_on", holds: "the first day of its period; empty when it has no dates" },
    { name: "ends_on", holds: "the last day of its period; empty while it goes on" },
    CREATED_AT,
    UPDATED_AT,
    // Added after the others (#217): the database keeps them last.
    {
      name: "payback_from",
      holds: "who pays it back, when someone else does; empty when it is not paid back",
    },
    { name: "payback_asked_on", holds: "the day you asked to be paid back; empty for none" },
    {
      name: "payback_settled_on",
      holds: "the day you marked it paid back by hand; empty for none",
    },
  ],
};

export const ENTRY_SUBJECTS: ExportTable = {
  table: "entry_subject",
  file: "entry-subjects",
  holds: "which subjects each expense is for: it counts in full in each",
  columns: [
    { name: "entry_id", holds: "the expense (entries.id)" },
    { name: "subject_id", holds: "one of its subjects (subjects.id)" },
    OWNER,
  ],
  orderedBy: ["entry_id", "subject_id"],
};

export const SUBJECT_ACCOUNTS: ExportTable = {
  table: "subject_account",
  file: "subject-accounts",
  holds: "the accounts linked to each subject (a van's fuel card, say)",
  columns: [
    { name: "subject_id", holds: "the subject (subjects.id)" },
    { name: "account_id", holds: "an account linked to it (accounts.id)" },
    OWNER,
  ],
  orderedBy: ["subject_id", "account_id"],
};

export const SUBJECT_ENTRIES_REFUSED: ExportTable = {
  table: "subject_entry_refused",
  file: "subject-entries-refused",
  holds: "the expenses of a dated subject's period you said are not its: no longer proposed for it",
  columns: [
    { name: "subject_id", holds: "the subject (subjects.id)" },
    { name: "entry_id", holds: "the expense refused for it (entries.id)" },
    OWNER,
  ],
  orderedBy: ["subject_id", "entry_id"],
};

export const SUBJECT_PAYBACKS: ExportTable = {
  table: "subject_payback",
  file: "subject-paybacks",
  holds:
    "the lines coming in that pay back a subject: each is no income, but what came back for it",
  columns: [
    { name: "line_id", holds: "the line that pays it back (statement-lines.id)" },
    { name: "subject_id", holds: "the subject it pays back (subjects.id)" },
    OWNER,
    CREATED_AT,
  ],
  orderedBy: ["line_id"],
};

/** Every table an export writes, in the manifest's order. */
export const EXPORT_TABLES: ReadonlyArray<ExportTable> = [
  ACCOUNTS,
  ACCOUNT_BALANCES,
  STATEMENT_LINES,
  IMPORTS,
  IMPORT_PROFILES,
  CATEGORIES,
  ENTRIES,
  ENTRY_PARTS,
  TRANSFERS,
  MERCHANTS,
  MERCHANT_ALIASES,
  RULES,
  SUBJECTS,
  ENTRY_SUBJECTS,
  SUBJECT_ACCOUNTS,
  SUBJECT_ENTRIES_REFUSED,
  SUBJECT_PAYBACKS,
];

/** Where the files imported go: one folder per import, named by its id. */
export const IMPORT_FILES_FOLDER = "import-files";
