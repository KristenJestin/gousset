CREATE TYPE "rule_origin" AS ENUM('correction', 'user');--> statement-breakpoint
CREATE TABLE "rule" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"conditions" jsonb NOT NULL,
	"set_merchant_id" uuid,
	"set_category_id" uuid,
	"applied_count" integer DEFAULT 0 NOT NULL,
	"created_from" "rule_origin" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rule_user_id_id_key" UNIQUE("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "rule" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entry" ADD COLUMN "merchant_id" uuid;--> statement-breakpoint
ALTER TABLE "entry" ADD COLUMN "rule_id" uuid;--> statement-breakpoint
CREATE INDEX "entry_merchant_id_idx" ON "entry" ("merchant_id");--> statement-breakpoint
CREATE INDEX "entry_rule_id_idx" ON "entry" ("rule_id");--> statement-breakpoint
CREATE INDEX "rule_set_merchant_id_idx" ON "rule" ("set_merchant_id");--> statement-breakpoint
CREATE INDEX "rule_set_category_id_idx" ON "rule" ("set_category_id");--> statement-breakpoint
ALTER TABLE "rule" ADD CONSTRAINT "rule_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE POLICY "rule_own_rows_only" ON "rule" AS PERMISSIVE FOR ALL TO public USING ("user_id" = current_setting('gousset.user_id', true)) WITH CHECK ("user_id" = current_setting('gousset.user_id', true));