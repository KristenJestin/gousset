CREATE TYPE "operation_kind" AS ENUM('deposit', 'withdrawal', 'purchase', 'sale', 'dividend', 'fee');--> statement-breakpoint
CREATE TABLE "investment_operation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" text NOT NULL,
	"line_id" uuid NOT NULL CONSTRAINT "investment_operation_line_id_key" UNIQUE,
	"kind" "operation_kind" NOT NULL,
	"security_id" uuid,
	"quantity" numeric,
	"unit_price" numeric,
	"fees_minor" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_operation_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "investment_operation_quantity_positive" CHECK ("quantity" > 0),
	CONSTRAINT "investment_operation_unit_price_not_negative" CHECK ("unit_price" >= 0),
	CONSTRAINT "investment_operation_fees_not_negative" CHECK ("fees_minor" >= 0),
	CONSTRAINT "investment_operation_quantity_of_trades" CHECK (("kind" in ('purchase', 'sale')) = ("quantity" is not null)),
	CONSTRAINT "investment_operation_unit_price_of_trades" CHECK (("kind" in ('purchase', 'sale')) = ("unit_price" is not null)),
	CONSTRAINT "investment_operation_security_of_trades" CHECK ("kind" not in ('purchase', 'sale', 'dividend') or "security_id" is not null),
	CONSTRAINT "investment_operation_no_security_of_cash" CHECK ("kind" not in ('deposit', 'withdrawal') or "security_id" is null)
);
--> statement-breakpoint
ALTER TABLE "investment_operation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "security" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" text NOT NULL,
	"isin" text,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "security_user_id_isin_key" UNIQUE("user_id","isin"),
	CONSTRAINT "security_isin_format" CHECK ("isin" ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'),
	CONSTRAINT "security_currency_iso_4217" CHECK ("currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "security" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "investment_operation_security_id_idx" ON "investment_operation" ("security_id");--> statement-breakpoint
ALTER TABLE "investment_operation" ADD CONSTRAINT "investment_operation_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "investment_operation" ADD CONSTRAINT "investment_operation_line_fk" FOREIGN KEY ("user_id","line_id") REFERENCES "statement_line"("user_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "security" ADD CONSTRAINT "security_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE POLICY "investment_operation_own_rows_only" ON "investment_operation" AS PERMISSIVE FOR ALL TO public USING ("user_id" = current_setting('gousset.user_id', true)) WITH CHECK ("user_id" = current_setting('gousset.user_id', true));--> statement-breakpoint
CREATE POLICY "security_own_rows_only" ON "security" AS PERMISSIVE FOR ALL TO public USING ("user_id" = current_setting('gousset.user_id', true)) WITH CHECK ("user_id" = current_setting('gousset.user_id', true));