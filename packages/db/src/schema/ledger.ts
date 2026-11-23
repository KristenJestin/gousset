import { sql } from "drizzle-orm";
import {
  bigint,
  bytea,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { authUser } from "./auth";

// A user's money: accounts, their balances and lines, the imports that read them and the CSV
// profiles that read a bank's files (docs/data-model.md, v0.2).
//
// Every table carries `user_id` and keeps its rows apart with row-level security: one policy per
// table, for every command, lets a transaction see and write only the rows of the user it was
// opened for (`gousset.user_id`, set by `UserData`, ./user-data.ts). The role that policy binds,
// `gousset_user`, its grants, and the optional references cleared with their own column
// (`on delete set null (<column>)`, which Drizzle cannot write) live in the custom migration
// `*_user_data_isolation`, which regenerating this schema never drops.

/** Gousset's own ids: ordered by creation, revealing neither counts nor order of other users. */
const id = () =>
  uuid("id")
    .primaryKey()
    .default(sql`uuidv7()`);

/** The owner of a row; deleting the user deletes their data. */
const owner = () =>
  text("user_id")
    .notNull()
    .references(() => authUser.id, { onDelete: "cascade" });

const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();

/** An amount in minor units of the account's currency, exact up to 2⁵³. */
const minor = (name: string) => bigint(name, { mode: "number" });

/** A day of a bank's calendar, `YYYY-MM-DD`, with no time and no time zone. */
const day = (name: string) => date(name, { mode: "string" });

/**
 * A transaction opened for a user sees and writes that user's rows only. With no user set, the
 * setting is empty and no row matches: it fails closed.
 */
const ownRowsOnly = (table: string) =>
  pgPolicy(`${table}_own_rows_only`, {
    as: "permissive",
    for: "all",
    using: sql`"user_id" = current_setting('gousset.user_id', true)`,
    withCheck: sql`"user_id" = current_setting('gousset.user_id', true)`,
  });

export const accountKind = pgEnum("account_kind", [
  "current",
  "savings",
  "card",
  "investment",
  "loan",
  "benefit",
]);

export const accountEnvelope = pgEnum("account_envelope", [
  "pea",
  "life_insurance",
  "livret_a",
  "other",
]);

export const accountMode = pgEnum("account_mode", ["lines", "balance"]);

export const creditOrder = pgEnum("credit_order", ["oldest_first", "expiring_first"]);

export const balanceSource = pgEnum("balance_source", ["statement", "noted"]);

export const lineSource = pgEnum("line_source", ["import", "manual", "balance", "counterpart"]);

export const lineState = pgEnum("line_state", ["counted", "held", "discarded"]);

export const importFormat = pgEnum("import_format", [
  "ofx",
  "qfx",
  "qif",
  "camt053",
  "mt940",
  "csv",
]);

export const importStatus = pgEnum("import_status", [
  "queued",
  "reading",
  "waiting",
  "saving",
  "done",
  "failed",
  "undone",
]);

export const importProfileKind = pgEnum("import_profile_kind", ["statement", "operations"]);

/** One account the user follows, of every kind. */
export const account = pgTable.withRLS(
  "account",
  {
    id: id(),
    userId: owner(),
    name: text("name").notNull(),
    kind: accountKind("kind").notNull(),
    envelope: accountEnvelope("envelope"),
    institution: text("institution"),
    // ISO 4217; fixed once the account has a line.
    currency: text("currency").notNull(),
    mode: accountMode("mode").default("lines").notNull(),
    openingBalanceMinor: minor("opening_balance_minor").default(0).notNull(),
    openedOn: day("opened_on"),
    closedOn: day("closed_on"),
    // How a statement names the account (CAMT and MT940 an IBAN, OFX a number). The IBAN is upper
    // case without spaces. The number is not unique: an OFX `ACCTID` is unique only with its
    // `BANKID`, and a file whose number matches several accounts waits for the user's choice.
    iban: text("iban"),
    number: text("number"),
    // A deferred-debit card: the current account it is debited from. Its foreign key, cleared on
    // its own when that account is deleted, is in the custom migration.
    settlesIntoAccountId: uuid("settles_into_account_id"),
    // Read for a benefit account only.
    creditOrder: creditOrder("credit_order").default("oldest_first").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("account_user_id_id_key").on(table.userId, table.id),
    unique("account_user_id_iban_key").on(table.userId, table.iban),
    check("account_currency_iso_4217", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    // One written form, so that the unique key compares like with like.
    check("account_iban_format", sql`${table.iban} ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'`),
    check(
      "account_only_a_card_settles",
      sql`${table.settlesIntoAccountId} is null or ${table.kind} = 'card'`,
    ),
    ownRowsOnly("account"),
  ],
);

/** A CSV profile: how to read one bank's or broker's files. Its `definition` is packages/import's. */
export const importProfile = pgTable.withRLS(
  "import_profile",
  {
    id: id(),
    userId: owner(),
    name: text("name").notNull(),
    institution: text("institution"),
    kind: importProfileKind("kind").default("statement").notNull(),
    definition: jsonb("definition").notNull(),
    // The file's header row, normalised, to recognise a file the profile reads.
    header: text("header"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("import_profile_user_id_id_key").on(table.userId, table.id),
    ownRowsOnly("import_profile"),
  ],
);

/** One file dropped, from upload to summary. */
export const statementImport = pgTable.withRLS(
  "import",
  {
    id: id(),
    userId: owner(),
    // Null until the account is recognised or chosen.
    accountId: uuid("account_id"),
    // As dropped, for the user only: never in a log nor in telemetry.
    fileName: text("file_name").notNull(),
    fileSha256: text("file_sha256").notNull(),
    format: importFormat("format").notNull(),
    // One of the user's CSV profiles (its foreign key is in the custom migration), or one shipped
    // with Gousset, by its key.
    profileId: uuid("profile_id"),
    shippedProfile: text("shipped_profile"),
    status: importStatus("status").default("queued").notNull(),
    periodFrom: day("period_from"),
    periodTo: day("period_to"),
    linesRead: integer("lines_read").default(0).notNull(),
    linesAdded: integer("lines_added").default(0).notNull(),
    linesDuplicate: integer("lines_duplicate").default(0).notNull(),
    linesHeld: integer("lines_held").default(0).notNull(),
    // Why it failed, as a code; never the file's content.
    errorCode: text("error_code"),
    // The pg-boss job that runs it, so that the import screen follows it again after a reload. No
    // foreign key: pg-boss keeps its tables in a schema of its own, and purges old jobs.
    jobId: uuid("job_id"),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
  },
  (table) => [
    unique("import_user_id_id_key").on(table.userId, table.id),
    foreignKey({
      name: "import_account_fk",
      columns: [table.userId, table.accountId],
      foreignColumns: [account.userId, account.id],
    }).onDelete("cascade"),
    index("import_account_id_idx").on(table.accountId),
    index("import_user_id_file_sha256_idx").on(table.userId, table.fileSha256),
    check("import_one_profile", sql`${table.profileId} is null or ${table.shippedProfile} is null`),
    ownRowsOnly("import"),
  ],
);

/** An import's file, apart so that listing imports never reads it; deleted when undone. */
export const importFile = pgTable.withRLS(
  "import_file",
  {
    importId: uuid("import_id").notNull(),
    userId: owner(),
    content: bytea("content").notNull(),
  },
  (table) => [
    primaryKey({ name: "import_file_pkey", columns: [table.importId] }),
    foreignKey({
      name: "import_file_import_fk",
      columns: [table.userId, table.importId],
      foreignColumns: [statementImport.userId, statementImport.id],
    }).onDelete("cascade"),
    ownRowsOnly("import_file"),
  ],
);

/** A balance given for a day, at the end of that day, by a statement or by the user. */
export const accountBalance = pgTable.withRLS(
  "account_balance",
  {
    id: id(),
    userId: owner(),
    accountId: uuid("account_id").notNull(),
    day: day("day").notNull(),
    balanceMinor: minor("balance_minor").notNull(),
    source: balanceSource("source").notNull(),
    // The import it was read from, for a statement's balance.
    importId: uuid("import_id"),
  },
  (table) => [
    foreignKey({
      name: "account_balance_account_fk",
      columns: [table.userId, table.accountId],
      foreignColumns: [account.userId, account.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "account_balance_import_fk",
      columns: [table.userId, table.importId],
      foreignColumns: [statementImport.userId, statementImport.id],
    }).onDelete("cascade"),
    index("account_balance_account_id_day_idx").on(table.accountId, table.day),
    index("account_balance_import_id_idx").on(table.importId),
    // One noted balance a day: balance mode makes one line from each noted balance and the one
    // before it, which two on a day would leave ambiguous.
    uniqueIndex("account_balance_one_noted_a_day")
      .on(table.accountId, table.day)
      .where(sql`${table.source} = 'noted'`),
    check(
      "account_balance_statement_has_import",
      sql`(${table.source} = 'statement') = (${table.importId} is not null)`,
    ),
    ownRowsOnly("account_balance"),
  ],
);

/** One line of an account, as the bank wrote it; what it is, v0.3's tables say. */
export const statementLine = pgTable.withRLS(
  "statement_line",
  {
    id: id(),
    userId: owner(),
    accountId: uuid("account_id").notNull(),
    // The import that read it; null for a line entered or made by the app.
    importId: uuid("import_id"),
    source: lineSource("source").notNull(),
    state: lineState("state").default("counted").notNull(),
    bookedOn: day("booked_on").notNull(),
    valueOn: day("value_on"),
    amountMinor: minor("amount_minor").notNull(),
    originalAmountMinor: minor("original_amount_minor"),
    originalCurrency: text("original_currency"),
    label: text("label").notNull(),
    memo: text("memo"),
    counterpartyName: text("counterparty_name"),
    counterpartyIban: text("counterparty_iban"),
    // The bank's own reference, unique or not: OFX's and QFX's FITID, QIF's N, CAMT.053's
    // `Ntry/AcctSvcrRef` (never `NtryRef`), MT940's references.
    bankId: text("bank_id"),
    dedupKey: text("dedup_key"),
    // A held line: the line it looks like. Its foreign key, cleared on its own when that line is
    // deleted, is in the custom migration.
    duplicateOfLineId: uuid("duplicate_of_line_id"),
    expiresOn: day("expires_on"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("statement_line_user_id_id_key").on(table.userId, table.id),
    // Decides what an import adds: it inserts with `on conflict do nothing`.
    unique("statement_line_account_id_dedup_key_key").on(table.accountId, table.dedupKey),
    foreignKey({
      name: "statement_line_account_fk",
      columns: [table.userId, table.accountId],
      foreignColumns: [account.userId, account.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "statement_line_import_fk",
      columns: [table.userId, table.importId],
      foreignColumns: [statementImport.userId, statementImport.id],
    }).onDelete("cascade"),
    // Lines are ordered by booking date, then by id.
    index("statement_line_account_id_booked_on_id_idx").on(
      table.accountId,
      table.bookedOn,
      table.id,
    ),
    index("statement_line_import_id_idx").on(table.importId),
    index("statement_line_duplicate_of_line_id_idx").on(table.duplicateOfLineId),
    check(
      "statement_line_imported_has_import",
      sql`(${table.source} = 'import') = (${table.importId} is not null)`,
    ),
    // Every imported line takes part in deduplication.
    check(
      "statement_line_imported_has_dedup_key",
      sql`(${table.source} = 'import') = (${table.dedupKey} is not null)`,
    ),
    check(
      "statement_line_original_amount_and_currency",
      sql`(${table.originalAmountMinor} is null) = (${table.originalCurrency} is null)`,
    ),
    check(
      "statement_line_original_currency_iso_4217",
      sql`${table.originalCurrency} ~ '^[A-Z]{3}$'`,
    ),
    ownRowsOnly("statement_line"),
  ],
);
