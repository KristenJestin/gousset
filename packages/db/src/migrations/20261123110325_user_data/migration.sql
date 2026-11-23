CREATE TYPE "account_envelope" AS ENUM('pea', 'life_insurance', 'livret_a', 'other');--> statement-breakpoint
CREATE TYPE "account_kind" AS ENUM('current', 'savings', 'card', 'investment', 'loan', 'benefit');--> statement-breakpoint
CREATE TYPE "account_mode" AS ENUM('lines', 'balance');--> statement-breakpoint
CREATE TYPE "balance_source" AS ENUM('statement', 'noted');--> statement-breakpoint
CREATE TYPE "credit_order" AS ENUM('oldest_first', 'expiring_first');--> statement-breakpoint
CREATE TYPE "import_format" AS ENUM('ofx', 'qfx', 'qif', 'camt053', 'mt940', 'csv');--> statement-breakpoint
CREATE TYPE "import_profile_kind" AS ENUM('statement', 'operations');--> statement-breakpoint
CREATE TYPE "import_status" AS ENUM('queued', 'reading', 'waiting', 'saving', 'done', 'failed', 'undone');--> statement-breakpoint
CREATE TYPE "line_source" AS ENUM('import', 'manual', 'balance', 'counterpart');--> statement-breakpoint
CREATE TYPE "line_state" AS ENUM('counted', 'held', 'discarded');--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" "account_kind" NOT NULL,
	"envelope" "account_envelope",
	"institution" text,
	"currency" text NOT NULL,
	"mode" "account_mode" DEFAULT 'lines'::"account_mode" NOT NULL,
	"opening_balance_minor" bigint DEFAULT 0 NOT NULL,
	"opened_on" date,
	"closed_on" date,
	"iban" text,
	"number" text,
	"settles_into_account_id" uuid,
	"credit_order" "credit_order" DEFAULT 'oldest_first'::"credit_order" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "account_user_id_iban_key" UNIQUE("user_id","iban"),
	CONSTRAINT "account_currency_iso_4217" CHECK ("currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "account_iban_format" CHECK ("iban" ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
	CONSTRAINT "account_only_a_card_settles" CHECK ("settles_into_account_id" is null or "kind" = 'card')
);
--> statement-breakpoint
ALTER TABLE "account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "account_balance" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"day" date NOT NULL,
	"balance_minor" bigint NOT NULL,
	"source" "balance_source" NOT NULL,
	"import_id" uuid,
	CONSTRAINT "account_balance_statement_has_import" CHECK (("source" = 'statement') = ("import_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "account_balance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "import_file" (
	"import_id" uuid PRIMARY KEY,
	"user_id" text NOT NULL,
	"content" bytea NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_file" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "import_profile" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"institution" text,
	"kind" "import_profile_kind" DEFAULT 'statement'::"import_profile_kind" NOT NULL,
	"definition" jsonb NOT NULL,
	"header" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_profile_user_id_id_key" UNIQUE("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "import_profile" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "import" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" text NOT NULL,
	"account_id" uuid,
	"file_name" text NOT NULL,
	"file_sha256" text NOT NULL,
	"format" "import_format" NOT NULL,
	"profile_id" uuid,
	"shipped_profile" text,
	"status" "import_status" DEFAULT 'queued'::"import_status" NOT NULL,
	"period_from" date,
	"period_to" date,
	"lines_read" integer DEFAULT 0 NOT NULL,
	"lines_added" integer DEFAULT 0 NOT NULL,
	"lines_duplicate" integer DEFAULT 0 NOT NULL,
	"lines_held" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"undone_at" timestamp with time zone,
	CONSTRAINT "import_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "import_one_profile" CHECK ("profile_id" is null or "shipped_profile" is null)
);
--> statement-breakpoint
ALTER TABLE "import" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "statement_line" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"import_id" uuid,
	"source" "line_source" NOT NULL,
	"state" "line_state" DEFAULT 'counted'::"line_state" NOT NULL,
	"booked_on" date NOT NULL,
	"value_on" date,
	"amount_minor" bigint NOT NULL,
	"original_amount_minor" bigint,
	"original_currency" text,
	"label" text NOT NULL,
	"memo" text,
	"counterparty_name" text,
	"counterparty_iban" text,
	"bank_id" text,
	"dedup_key" text,
	"duplicate_of_line_id" uuid,
	"expires_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "statement_line_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "statement_line_account_id_dedup_key_key" UNIQUE("account_id","dedup_key"),
	CONSTRAINT "statement_line_imported_has_import" CHECK (("source" = 'import') = ("import_id" is not null)),
	CONSTRAINT "statement_line_imported_has_dedup_key" CHECK (("source" = 'import') = ("dedup_key" is not null)),
	CONSTRAINT "statement_line_original_amount_and_currency" CHECK (("original_amount_minor" is null) = ("original_currency" is null)),
	CONSTRAINT "statement_line_original_currency_iso_4217" CHECK ("original_currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "statement_line" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "account_balance_account_id_day_idx" ON "account_balance" ("account_id","day");--> statement-breakpoint
CREATE INDEX "account_balance_import_id_idx" ON "account_balance" ("import_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_balance_one_noted_a_day" ON "account_balance" ("account_id","day") WHERE "source" = 'noted';--> statement-breakpoint
CREATE INDEX "import_account_id_idx" ON "import" ("account_id");--> statement-breakpoint
CREATE INDEX "import_user_id_file_sha256_idx" ON "import" ("user_id","file_sha256");--> statement-breakpoint
CREATE INDEX "statement_line_account_id_booked_on_id_idx" ON "statement_line" ("account_id","booked_on","id");--> statement-breakpoint
CREATE INDEX "statement_line_import_id_idx" ON "statement_line" ("import_id");--> statement-breakpoint
CREATE INDEX "statement_line_duplicate_of_line_id_idx" ON "statement_line" ("duplicate_of_line_id");--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account_balance" ADD CONSTRAINT "account_balance_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account_balance" ADD CONSTRAINT "account_balance_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "account"("user_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account_balance" ADD CONSTRAINT "account_balance_import_fk" FOREIGN KEY ("user_id","import_id") REFERENCES "import"("user_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "import_file" ADD CONSTRAINT "import_file_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "import_file" ADD CONSTRAINT "import_file_import_fk" FOREIGN KEY ("user_id","import_id") REFERENCES "import"("user_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "import_profile" ADD CONSTRAINT "import_profile_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "import" ADD CONSTRAINT "import_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "import" ADD CONSTRAINT "import_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "account"("user_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "statement_line" ADD CONSTRAINT "statement_line_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "statement_line" ADD CONSTRAINT "statement_line_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "account"("user_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "statement_line" ADD CONSTRAINT "statement_line_import_fk" FOREIGN KEY ("user_id","import_id") REFERENCES "import"("user_id","id") ON DELETE CASCADE;--> statement-breakpoint
CREATE POLICY "account_own_rows_only" ON "account" AS PERMISSIVE FOR ALL TO public USING ("user_id" = current_setting('gousset.user_id', true)) WITH CHECK ("user_id" = current_setting('gousset.user_id', true));--> statement-breakpoint
CREATE POLICY "account_balance_own_rows_only" ON "account_balance" AS PERMISSIVE FOR ALL TO public USING ("user_id" = current_setting('gousset.user_id', true)) WITH CHECK ("user_id" = current_setting('gousset.user_id', true));--> statement-breakpoint
CREATE POLICY "import_file_own_rows_only" ON "import_file" AS PERMISSIVE FOR ALL TO public USING ("user_id" = current_setting('gousset.user_id', true)) WITH CHECK ("user_id" = current_setting('gousset.user_id', true));--> statement-breakpoint
CREATE POLICY "import_profile_own_rows_only" ON "import_profile" AS PERMISSIVE FOR ALL TO public USING ("user_id" = current_setting('gousset.user_id', true)) WITH CHECK ("user_id" = current_setting('gousset.user_id', true));--> statement-breakpoint
CREATE POLICY "import_own_rows_only" ON "import" AS PERMISSIVE FOR ALL TO public USING ("user_id" = current_setting('gousset.user_id', true)) WITH CHECK ("user_id" = current_setting('gousset.user_id', true));--> statement-breakpoint
CREATE POLICY "statement_line_own_rows_only" ON "statement_line" AS PERMISSIVE FOR ALL TO public USING ("user_id" = current_setting('gousset.user_id', true)) WITH CHECK ("user_id" = current_setting('gousset.user_id', true));