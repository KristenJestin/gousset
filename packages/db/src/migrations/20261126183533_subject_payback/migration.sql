-- The migrator runs every pending migration in one transaction: an earlier one may leave checks of
-- deferred keys waiting (`subject`'s parent, `entry`'s), and Postgres refuses to alter a table while
-- they wait, as `*_subjects` says. They are run now; it changes nothing the second time.
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
CREATE TABLE "subject_payback" (
	"line_id" uuid PRIMARY KEY,
	"subject_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subject_payback" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subject" ADD COLUMN "payback_from" text;--> statement-breakpoint
ALTER TABLE "subject" ADD COLUMN "payback_asked_on" date;--> statement-breakpoint
ALTER TABLE "subject" ADD COLUMN "payback_settled_on" date;--> statement-breakpoint
CREATE INDEX "subject_payback_subject_id_idx" ON "subject_payback" ("subject_id");--> statement-breakpoint
ALTER TABLE "subject_payback" ADD CONSTRAINT "subject_payback_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "subject_payback" ADD CONSTRAINT "subject_payback_line_fk" FOREIGN KEY ("user_id","line_id") REFERENCES "statement_line"("user_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "subject_payback" ADD CONSTRAINT "subject_payback_subject_fk" FOREIGN KEY ("user_id","subject_id") REFERENCES "subject"("user_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "subject" ADD CONSTRAINT "subject_payback_days_need_payer" CHECK ("payback_from" is not null or ("payback_asked_on" is null and "payback_settled_on" is null));--> statement-breakpoint
CREATE POLICY "subject_payback_own_rows_only" ON "subject_payback" AS PERMISSIVE FOR ALL TO public USING ("user_id" = current_setting('gousset.user_id', true)) WITH CHECK ("user_id" = current_setting('gousset.user_id', true));