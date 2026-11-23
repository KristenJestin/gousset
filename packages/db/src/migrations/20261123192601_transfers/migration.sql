CREATE TYPE "review_state" AS ENUM('to_review', 'done');--> statement-breakpoint
CREATE TYPE "paired_by" AS ENUM('import', 'rule', 'user');--> statement-breakpoint
CREATE TABLE "transfer" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" text NOT NULL,
	"out_line_id" uuid NOT NULL CONSTRAINT "transfer_out_line_id_key" UNIQUE,
	"in_line_id" uuid NOT NULL CONSTRAINT "transfer_in_line_id_key" UNIQUE,
	"paired_by" "paired_by" NOT NULL,
	CONSTRAINT "transfer_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "transfer_two_lines" CHECK ("out_line_id" <> "in_line_id")
);
--> statement-breakpoint
ALTER TABLE "transfer" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "statement_line" ADD COLUMN "review_state" "review_state" DEFAULT 'to_review'::"review_state" NOT NULL;--> statement-breakpoint
ALTER TABLE "transfer" ADD CONSTRAINT "transfer_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "transfer" ADD CONSTRAINT "transfer_out_line_fk" FOREIGN KEY ("user_id","out_line_id") REFERENCES "statement_line"("user_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "transfer" ADD CONSTRAINT "transfer_in_line_fk" FOREIGN KEY ("user_id","in_line_id") REFERENCES "statement_line"("user_id","id") ON DELETE CASCADE;--> statement-breakpoint
CREATE POLICY "transfer_own_rows_only" ON "transfer" AS PERMISSIVE FOR ALL TO public USING ("user_id" = current_setting('gousset.user_id', true)) WITH CHECK ("user_id" = current_setting('gousset.user_id', true));--> statement-breakpoint
-- A user's table (docs/data-model.md, "Ownership and isolation"): its policy binds the tables'
-- owner too, and only a user's transaction (`gousset_user`) reaches it, never the app's own role.
ALTER TABLE "transfer" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "transfer" TO gousset_user;