-- The migrator runs every pending migration in one transaction: an earlier one may leave checks of
-- deferred keys waiting, and Postgres refuses to add a key to `statement_line` while they wait, as
-- `*_subjects` says. They are run now; it changes nothing the second time.
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
CREATE TYPE "line_attachment_media_type" AS ENUM('application/pdf', 'image/jpeg', 'image/png', 'image/heic');--> statement-breakpoint
CREATE TABLE "line_attachment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" text NOT NULL,
	"line_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"media_type" "line_attachment_media_type" NOT NULL,
	"size" bigint NOT NULL,
	"stored_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "line_attachment_user_id_stored_name_key" UNIQUE("user_id","stored_name"),
	CONSTRAINT "line_attachment_size" CHECK ("size" > 0),
	CONSTRAINT "line_attachment_stored_name" CHECK ("stored_name" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
);
--> statement-breakpoint
ALTER TABLE "line_attachment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "line_attachment_line_id_idx" ON "line_attachment" ("line_id");--> statement-breakpoint
ALTER TABLE "line_attachment" ADD CONSTRAINT "line_attachment_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "line_attachment" ADD CONSTRAINT "line_attachment_line_fk" FOREIGN KEY ("user_id","line_id") REFERENCES "statement_line"("user_id","id") ON DELETE CASCADE;--> statement-breakpoint
CREATE POLICY "line_attachment_own_rows_only" ON "line_attachment" AS PERMISSIVE FOR ALL TO public USING ("user_id" = current_setting('gousset.user_id', true)) WITH CHECK ("user_id" = current_setting('gousset.user_id', true));