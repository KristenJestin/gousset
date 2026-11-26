-- The migrator runs every pending migration in one transaction: an earlier one may leave checks of
-- deferred keys waiting (`category`'s, `entry`'s), and Postgres refuses to alter a table while they
-- wait, as `*_rules` says. They are run now; it changes nothing the second time.
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
CREATE TABLE "entry_subject" (
	"entry_id" uuid,
	"subject_id" uuid,
	"user_id" text NOT NULL,
	CONSTRAINT "entry_subject_pkey" PRIMARY KEY("entry_id","subject_id")
);
--> statement-breakpoint
ALTER TABLE "entry_subject" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subject" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" text NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"estimated_value_minor" bigint,
	"value_currency" text,
	"loan_account_id" uuid,
	"starts_on" date,
	"ends_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subject_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "subject_user_id_parent_id_name_key" UNIQUE NULLS NOT DISTINCT("user_id","parent_id","name"),
	CONSTRAINT "subject_value_and_currency" CHECK (("estimated_value_minor" is null) = ("value_currency" is null)),
	CONSTRAINT "subject_value_currency_iso_4217" CHECK ("value_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "subject_ends_after_start" CHECK ("ends_on" >= "starts_on")
);
--> statement-breakpoint
ALTER TABLE "subject" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subject_account" (
	"subject_id" uuid,
	"account_id" uuid,
	"user_id" text NOT NULL,
	CONSTRAINT "subject_account_pkey" PRIMARY KEY("subject_id","account_id")
);
--> statement-breakpoint
ALTER TABLE "subject_account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subject_entry_refused" (
	"subject_id" uuid,
	"entry_id" uuid,
	"user_id" text NOT NULL,
	CONSTRAINT "subject_entry_refused_pkey" PRIMARY KEY("subject_id","entry_id")
);
--> statement-breakpoint
ALTER TABLE "subject_entry_refused" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rule" ADD COLUMN "attach_subject_id" uuid;--> statement-breakpoint
CREATE INDEX "entry_subject_subject_id_idx" ON "entry_subject" ("subject_id");--> statement-breakpoint
CREATE INDEX "rule_attach_subject_id_idx" ON "rule" ("attach_subject_id");--> statement-breakpoint
CREATE INDEX "subject_loan_account_id_idx" ON "subject" ("loan_account_id");--> statement-breakpoint
CREATE INDEX "subject_entry_refused_entry_id_idx" ON "subject_entry_refused" ("entry_id");--> statement-breakpoint
ALTER TABLE "entry_subject" ADD CONSTRAINT "entry_subject_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "entry_subject" ADD CONSTRAINT "entry_subject_entry_fk" FOREIGN KEY ("user_id","entry_id") REFERENCES "entry"("user_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "entry_subject" ADD CONSTRAINT "entry_subject_subject_fk" FOREIGN KEY ("user_id","subject_id") REFERENCES "subject"("user_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "subject" ADD CONSTRAINT "subject_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "subject_account" ADD CONSTRAINT "subject_account_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "subject_account" ADD CONSTRAINT "subject_account_subject_fk" FOREIGN KEY ("user_id","subject_id") REFERENCES "subject"("user_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "subject_account" ADD CONSTRAINT "subject_account_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "account"("user_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "subject_entry_refused" ADD CONSTRAINT "subject_entry_refused_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "subject_entry_refused" ADD CONSTRAINT "subject_entry_refused_subject_fk" FOREIGN KEY ("user_id","subject_id") REFERENCES "subject"("user_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "subject_entry_refused" ADD CONSTRAINT "subject_entry_refused_entry_fk" FOREIGN KEY ("user_id","entry_id") REFERENCES "entry"("user_id","id") ON DELETE CASCADE;--> statement-breakpoint
CREATE POLICY "entry_subject_own_rows_only" ON "entry_subject" AS PERMISSIVE FOR ALL TO public USING ("user_id" = current_setting('gousset.user_id', true)) WITH CHECK ("user_id" = current_setting('gousset.user_id', true));--> statement-breakpoint
CREATE POLICY "subject_own_rows_only" ON "subject" AS PERMISSIVE FOR ALL TO public USING ("user_id" = current_setting('gousset.user_id', true)) WITH CHECK ("user_id" = current_setting('gousset.user_id', true));--> statement-breakpoint
CREATE POLICY "subject_account_own_rows_only" ON "subject_account" AS PERMISSIVE FOR ALL TO public USING ("user_id" = current_setting('gousset.user_id', true)) WITH CHECK ("user_id" = current_setting('gousset.user_id', true));--> statement-breakpoint
CREATE POLICY "subject_entry_refused_own_rows_only" ON "subject_entry_refused" AS PERMISSIVE FOR ALL TO public USING ("user_id" = current_setting('gousset.user_id', true)) WITH CHECK ("user_id" = current_setting('gousset.user_id', true));