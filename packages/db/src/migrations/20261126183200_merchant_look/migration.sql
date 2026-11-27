CREATE TABLE "merchant_logo" (
	"merchant_id" uuid PRIMARY KEY,
	"user_id" text NOT NULL,
	"media_type" text NOT NULL,
	"content" bytea NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_logo_media_type" CHECK ("media_type" in ('image/png', 'image/jpeg', 'image/webp')),
	CONSTRAINT "merchant_logo_size" CHECK (octet_length("content") between 1 and 262144)
);
--> statement-breakpoint
ALTER TABLE "merchant_logo" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "merchant" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "merchant_logo" ADD CONSTRAINT "merchant_logo_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "merchant_logo" ADD CONSTRAINT "merchant_logo_merchant_fk" FOREIGN KEY ("user_id","merchant_id") REFERENCES "merchant"("user_id","id") ON DELETE CASCADE;--> statement-breakpoint
CREATE POLICY "merchant_logo_own_rows_only" ON "merchant_logo" AS PERMISSIVE FOR ALL TO public USING ("user_id" = current_setting('gousset.user_id', true)) WITH CHECK ("user_id" = current_setting('gousset.user_id', true));