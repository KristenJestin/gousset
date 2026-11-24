CREATE TABLE "import_upload" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" text NOT NULL,
	"grant_id" text NOT NULL,
	"secret_sha256" text NOT NULL,
	"file_name" text NOT NULL,
	"size" integer NOT NULL,
	"parts" integer NOT NULL,
	"parts_received" integer DEFAULT 0 NOT NULL,
	"content" bytea DEFAULT '' NOT NULL,
	"account_id" uuid,
	"format" "import_format",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "import_upload_size" CHECK ("size" > 0),
	CONSTRAINT "import_upload_parts" CHECK ("parts" > 0 and "parts_received" between 0 and "parts"),
	CONSTRAINT "import_upload_content_size" CHECK (octet_length("content") <= "size")
);
--> statement-breakpoint
ALTER TABLE "import_upload" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "import_upload_grant_id_idx" ON "import_upload" ("grant_id");--> statement-breakpoint
ALTER TABLE "import_upload" ADD CONSTRAINT "import_upload_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "import_upload" ADD CONSTRAINT "import_upload_grant_id_auth_oauth_consent_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "auth_oauth_consent"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "import_upload" ADD CONSTRAINT "import_upload_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "account"("user_id","id") ON DELETE CASCADE;--> statement-breakpoint
CREATE POLICY "import_upload_own_rows_only" ON "import_upload" AS PERMISSIVE FOR ALL TO public USING ("user_id" = current_setting('gousset.user_id', true)) WITH CHECK ("user_id" = current_setting('gousset.user_id', true));--> statement-breakpoint
-- A user's table (docs/data-model.md, "Ownership and isolation"): granted to `gousset_user` alone,
-- its policy binding the tables' owner too. Both are idempotent, as Drizzle writes neither.
GRANT SELECT, INSERT, UPDATE, DELETE ON "import_upload" TO gousset_user;--> statement-breakpoint
ALTER TABLE "import_upload" FORCE ROW LEVEL SECURITY;