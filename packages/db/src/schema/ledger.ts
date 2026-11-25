import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
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

import { authOauthConsent, authUser } from "./auth";

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

/** Whether the monthly review still lists a line (v0.3): until the user, or a sure rule, says. */
export const reviewState = pgEnum("review_state", ["to_review", "done"]);

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

// v0.3, Classify (#23): what happened, outside the line. A category's kind is the entry's own enum,
// since a foreign key compares the two.
export const entryKind = pgEnum("entry_kind", ["expense", "income"]);

export const benchmarkMode = pgEnum("benchmark_mode", ["automatic", "fixed", "none"]);

// `default`: put in its kind's fallback category by the import, the backfill or sign-up, nothing
// decided yet; `rule`: by a rule (#25); `user`: by the user, which no rule overwrites unasked.
export const classifiedBy = pgEnum("classified_by", ["default", "rule", "user"]);

export const entryPartRole = pgEnum("entry_part_role", ["payment", "refund"]);

/** Where a rule comes from (#25): proposed by a correction of a line, or written from its screen. */
export const ruleOrigin = pgEnum("rule_origin", ["correction", "user"]);

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
    // Added by v0.3 (#31), after the others: the category a balance-mode account's movement goes
    // to. Its key (`on delete set null (balance_category_id)`, which Drizzle cannot write) is in the
    // custom migration `*_balance_lines_keys`.
    balanceCategoryId: uuid("balance_category_id"),
    // Read for a benefit account only (#28): how many days after its own line the issuer charges
    // the rest of a purchase to a linked bank card, and the most the card pays a day, when known.
    topUpDays: integer("top_up_days").default(3).notNull(),
    topUpCapMinor: minor("top_up_cap_minor"),
  },
  (table) => [
    unique("account_user_id_id_key").on(table.userId, table.id),
    check("account_top_up_days_range", sql`${table.topUpDays} between 0 and 7`),
    check("account_top_up_cap_positive", sql`${table.topUpCapMinor} > 0`),
    // A merge of categories moves it, and a deleted category clears it.
    index("account_balance_category_id_idx").on(table.balanceCategoryId),
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
    // The file stated a balance of zero that the account's lines contradict on its day: it looked
    // empty and was not recorded (#130).
    balanceIgnored: boolean("balance_ignored").default(false).notNull(),
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

/**
 * A statement file on its way in from an agent's shell (#129): `imports` `create_upload` makes it,
 * the upload address fills it, in one part or several, and `imports` `upload` imports it once,
 * deleting it in the same transaction. Expired, it is deleted by the sweep job.
 */
export const importUpload = pgTable.withRLS(
  "import_upload",
  {
    id: id(),
    userId: owner(),
    // The MCP grant that made it: only that grant fills or imports it, and revoking the client,
    // a ban or a new password (each deletes the grant) deletes it at once.
    grantId: text("grant_id")
      .notNull()
      .references(() => authOauthConsent.id, { onDelete: "cascade" }),
    // The SHA-256 of the upload address's secret, in hexadecimal: the secret is never kept.
    secretSha256: text("secret_sha256").notNull(),
    // As the agent named it, for the user only: never in a log nor in telemetry.
    fileName: text("file_name").notNull(),
    // The size the agent declared, in bytes: the parts must add up to it exactly.
    size: integer("size").notNull(),
    parts: integer("parts").notNull(),
    partsReceived: integer("parts_received").default(0).notNull(),
    // The parts received, one after the other.
    content: bytea("content")
      .default(sql`''::bytea`)
      .notNull(),
    accountId: uuid("account_id"),
    format: importFormat("format"),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    foreignKey({
      name: "import_upload_account_fk",
      columns: [table.userId, table.accountId],
      foreignColumns: [account.userId, account.id],
    }).onDelete("cascade"),
    index("import_upload_grant_id_idx").on(table.grantId),
    check("import_upload_size", sql`${table.size} > 0`),
    check(
      "import_upload_parts",
      sql`${table.parts} > 0 and ${table.partsReceived} between 0 and ${table.parts}`,
    ),
    check("import_upload_content_size", sql`octet_length(${table.content}) <= ${table.size}`),
    ownRowsOnly("import_upload"),
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
    // What a line made from a noted balance points to (v0.3, #31).
    unique("account_balance_user_id_id_key").on(table.userId, table.id),
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
    // Added by v0.3 (#26), after the others: every line of v0.2 starts to review, which it is.
    reviewState: reviewState("review_state").default("to_review").notNull(),
    // The user said this line is no transfer (unpaired it): the automatic pairing leaves it alone
    // until the user pairs it by hand (#26).
    transferRefused: boolean("transfer_refused").default(false).notNull(),
    // A line made from a noted balance (#31): the balance it was made from, which it goes with.
    balanceId: uuid("balance_id"),
    // The user took this line out of an expense of several lines (#28): the automatic matching of
    // top-ups leaves it alone until the user links it by hand.
    linkRefused: boolean("link_refused").default(false).notNull(),
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
    // One line per noted balance, deleted with it.
    unique("statement_line_balance_id_key").on(table.balanceId),
    foreignKey({
      name: "statement_line_balance_fk",
      columns: [table.userId, table.balanceId],
      foreignColumns: [accountBalance.userId, accountBalance.id],
    }).onDelete("cascade"),
    check(
      "statement_line_balance_has_balance",
      sql`(${table.source} = 'balance') = (${table.balanceId} is not null)`,
    ),
    // Lines are ordered by booking date, then by id.
    index("statement_line_account_id_booked_on_id_idx").on(
      table.accountId,
      table.bookedOn,
      table.id,
    ),
    // Every line of every account in order, as the operations page lists them (#21).
    index("statement_line_user_id_booked_on_id_idx").on(table.userId, table.bookedOn, table.id),
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

/** Who was paid, cleaned from the raw labels (#24); each user's own. */
export const merchant = pgTable.withRLS(
  "merchant",
  {
    id: id(),
    userId: owner(),
    // Unique per user: a rule, a merge and the MCP door name a merchant by it.
    name: text("name").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // Added with the categories (#23), after the others: the category its entries go in by default.
    // Its key (`on delete set null (default_category_id)`, which Drizzle cannot write) is in the
    // custom migration `*_merchant_default_category_key`.
    defaultCategoryId: uuid("default_category_id"),
    // Added with the payment intermediaries (#30): a label naming it hides who was paid, which the
    // user sets on the line's entry (`entry.merchant_id`).
    isIntermediary: boolean("is_intermediary").default(false).notNull(),
    // Added with the subscriptions (#34): the user said its payments are no subscription, so that
    // none of its series is proposed again until the user takes it back. Subscriptions themselves
    // are computed on read, never stored (docs/data-model.md, v0.4).
    subscriptionDismissed: boolean("subscription_dismissed").default(false).notNull(),
  },
  (table) => [
    unique("merchant_user_id_id_key").on(table.userId, table.id),
    unique("merchant_user_id_name_key").on(table.userId, table.name),
    // A merge of categories moves the defaults, and a deleted category clears them.
    index("merchant_default_category_id_idx").on(table.defaultCategoryId),
    ownRowsOnly("merchant"),
  ],
);

/**
 * A cleaned label that names a merchant (packages/core, `merchantKey`): a line whose label cleans
 * to it is that merchant's. One cleaned label names one merchant.
 */
export const merchantAlias = pgTable.withRLS(
  "merchant_alias",
  {
    id: id(),
    userId: owner(),
    merchantId: uuid("merchant_id").notNull(),
    alias: text("alias").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique("merchant_alias_user_id_alias_key").on(table.userId, table.alias),
    foreignKey({
      name: "merchant_alias_merchant_fk",
      columns: [table.userId, table.merchantId],
      foreignColumns: [merchant.userId, merchant.id],
    }).onDelete("cascade"),
    // A merchant's aliases, for its page, a merge and the cascade.
    index("merchant_alias_merchant_id_idx").on(table.merchantId),
    ownRowsOnly("merchant_alias"),
  ],
);

/**
 * An expense or income category, on two levels (#23). Its parent, and an entry's category, are
 * kept references (`on delete no action deferrable initially deferred`, which Drizzle cannot
 * write): they are in the custom migration `*_categories_isolation`.
 */
export const category = pgTable.withRLS(
  "category",
  {
    id: id(),
    userId: owner(),
    // Null for a top-level category. A third level is refused by packages/core.
    parentId: uuid("parent_id"),
    kind: entryKind("kind").notNull(),
    name: text("name").notNull(),
    // A key of the category icons (packages/core, `category-looks.ts`), drawn by packages/ui.
    icon: text("icon"),
    // Siblings are ordered by (position, id); not unique, so a move writes the moved row only.
    position: integer("position").default(0).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    benchmarkMode: benchmarkMode("benchmark_mode").default("automatic").notNull(),
    // A fixed benchmark, in minor units of the user's currency.
    benchmarkMinor: minor("benchmark_minor"),
    // Where an entry goes until it is classified: one per kind, never archived nor merged away.
    isFallback: boolean("is_fallback").default(false).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // Added with the category's look (#205): a key of the palette (packages/core,
    // `category-looks.ts`), drawn by packages/ui. Null: its parent's, or none at the top.
    color: text("color"),
  },
  (table) => [
    unique("category_user_id_id_key").on(table.userId, table.id),
    // What the kept references point to: a child shares its parent's kind, an entry its category's.
    unique("category_user_id_id_kind_key").on(table.userId, table.id, table.kind),
    // Two top-level categories of a kind cannot share a name either.
    unique("category_user_id_kind_parent_id_name_key")
      .on(table.userId, table.kind, table.parentId, table.name)
      .nullsNotDistinct(),
    uniqueIndex("category_one_fallback_per_kind")
      .on(table.userId, table.kind)
      .where(sql`${table.isFallback}`),
    check(
      "category_fixed_benchmark_has_amount",
      sql`(${table.benchmarkMode} = 'fixed') = (${table.benchmarkMinor} is not null)`,
    ),
    ownRowsOnly("category"),
  ],
);

/**
 * What happened: an expense or an income, with one category, made of parts of lines. Its merchant
 * and rule come with #25, its subscription with v0.4; an intermediary is read from its line's label
 * (#30).
 */
export const entry = pgTable.withRLS(
  "entry",
  {
    id: id(),
    userId: owner(),
    kind: entryKind("kind").notNull(),
    // The day it happened: its first payment's booking date, until moved.
    happenedOn: day("happened_on").notNull(),
    categoryId: uuid("category_id").notNull(),
    note: text("note"),
    classifiedBy: classifiedBy("classified_by").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // Added with the rules (#25), after the others: the merchant a rule set (or the user, behind an
    // intermediary, #30), and the rule that classified it. Their keys (`on delete set null
    // (<column>)`, which Drizzle cannot write) are in the custom migration `*_rules_isolation`.
    merchantId: uuid("merchant_id"),
    ruleId: uuid("rule_id"),
  },
  (table) => [
    unique("entry_user_id_id_key").on(table.userId, table.id),
    // The month, by the day the expense happened.
    index("entry_user_id_happened_on_idx").on(table.userId, table.happenedOn),
    // The breakdowns and the merges.
    index("entry_category_id_idx").on(table.categoryId),
    index("entry_merchant_id_idx").on(table.merchantId),
    // A rule deleted clears its entries' `rule_id`.
    index("entry_rule_id_idx").on(table.ruleId),
    ownRowsOnly("entry"),
  ],
);

/** A part of a line paying an entry, or refunding it; positive, the role says which way. */
export const entryPart = pgTable.withRLS(
  "entry_part",
  {
    id: id(),
    userId: owner(),
    entryId: uuid("entry_id").notNull(),
    lineId: uuid("line_id").notNull(),
    role: entryPartRole("role").notNull(),
    amountMinor: minor("amount_minor").notNull(),
  },
  (table) => [
    unique("entry_part_entry_id_line_id_role_key").on(table.entryId, table.lineId, table.role),
    foreignKey({
      name: "entry_part_entry_fk",
      columns: [table.userId, table.entryId],
      foreignColumns: [entry.userId, entry.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "entry_part_line_fk",
      columns: [table.userId, table.lineId],
      foreignColumns: [statementLine.userId, statementLine.id],
    }).onDelete("cascade"),
    index("entry_part_line_id_idx").on(table.lineId),
    check("entry_part_amount_positive", sql`${table.amountMinor} > 0`),
    ownRowsOnly("entry_part"),
  ],
);

/**
 * A rule (#25): when a line matches its conditions, its entry gets the merchant and the category the
 * rule sets. The conditions are a query of qnot's shape, decoded by packages/core (`rules`); what it
 * sets are columns, so that a merge moves them and a deletion clears them. Their keys
 * (`on delete set null (<column>)`, which Drizzle cannot write) are in the custom migration
 * `*_rules_isolation`.
 */
export const rule = pgTable.withRLS(
  "rule",
  {
    id: id(),
    userId: owner(),
    // Rules are tried in (position, id) order, the first that matches wins. Not unique, so a move
    // writes the moved row only.
    position: integer("position").default(0).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    conditions: jsonb("conditions").notNull(),
    setMerchantId: uuid("set_merchant_id"),
    setCategoryId: uuid("set_category_id"),
    // How many lines it classified, at import and applied to the past.
    appliedCount: integer("applied_count").default(0).notNull(),
    createdFrom: ruleOrigin("created_from").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("rule_user_id_id_key").on(table.userId, table.id),
    // A merge of merchants or categories moves them, and a deletion clears them.
    index("rule_set_merchant_id_idx").on(table.setMerchantId),
    index("rule_set_category_id_idx").on(table.setCategoryId),
    ownRowsOnly("rule"),
  ],
);
