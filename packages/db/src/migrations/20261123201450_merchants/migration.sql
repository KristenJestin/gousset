CREATE TABLE "merchant" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "merchant_user_id_name_key" UNIQUE("user_id","name")
);
--> statement-breakpoint
ALTER TABLE "merchant" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "merchant_alias" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" text NOT NULL,
	"merchant_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_alias_user_id_alias_key" UNIQUE("user_id","alias")
);
--> statement-breakpoint
ALTER TABLE "merchant_alias" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "merchant_alias_merchant_id_idx" ON "merchant_alias" ("merchant_id");--> statement-breakpoint
ALTER TABLE "merchant" ADD CONSTRAINT "merchant_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "merchant_alias" ADD CONSTRAINT "merchant_alias_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "merchant_alias" ADD CONSTRAINT "merchant_alias_merchant_fk" FOREIGN KEY ("user_id","merchant_id") REFERENCES "merchant"("user_id","id") ON DELETE CASCADE;--> statement-breakpoint
CREATE POLICY "merchant_own_rows_only" ON "merchant" AS PERMISSIVE FOR ALL TO public USING ("user_id" = current_setting('gousset.user_id', true)) WITH CHECK ("user_id" = current_setting('gousset.user_id', true));--> statement-breakpoint
CREATE POLICY "merchant_alias_own_rows_only" ON "merchant_alias" AS PERMISSIVE FOR ALL TO public USING ("user_id" = current_setting('gousset.user_id', true)) WITH CHECK ("user_id" = current_setting('gousset.user_id', true));