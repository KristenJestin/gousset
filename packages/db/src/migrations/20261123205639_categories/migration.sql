CREATE TYPE "benchmark_mode" AS ENUM('automatic', 'fixed', 'none');--> statement-breakpoint
CREATE TYPE "classified_by" AS ENUM('default', 'rule', 'user');--> statement-breakpoint
CREATE TYPE "entry_kind" AS ENUM('expense', 'income');--> statement-breakpoint
CREATE TYPE "entry_part_role" AS ENUM('payment', 'refund');--> statement-breakpoint
CREATE TABLE "category" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" text NOT NULL,
	"parent_id" uuid,
	"kind" "entry_kind" NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"benchmark_mode" "benchmark_mode" DEFAULT 'automatic'::"benchmark_mode" NOT NULL,
	"benchmark_minor" bigint,
	"is_fallback" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_user_id_id_key" UNIQUE("user_id","id"),
	CONSTRAINT "category_user_id_id_kind_key" UNIQUE("user_id","id","kind"),
	CONSTRAINT "category_user_id_kind_parent_id_name_key" UNIQUE NULLS NOT DISTINCT("user_id","kind","parent_id","name"),
	CONSTRAINT "category_fixed_benchmark_has_amount" CHECK (("benchmark_mode" = 'fixed') = ("benchmark_minor" is not null))
);
--> statement-breakpoint
ALTER TABLE "category" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "entry" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" text NOT NULL,
	"kind" "entry_kind" NOT NULL,
	"happened_on" date NOT NULL,
	"category_id" uuid NOT NULL,
	"note" text,
	"classified_by" "classified_by" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_user_id_id_key" UNIQUE("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "entry" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "entry_part" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"user_id" text NOT NULL,
	"entry_id" uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"role" "entry_part_role" NOT NULL,
	"amount_minor" bigint NOT NULL,
	CONSTRAINT "entry_part_entry_id_line_id_role_key" UNIQUE("entry_id","line_id","role"),
	CONSTRAINT "entry_part_amount_positive" CHECK ("amount_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "entry_part" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "category_one_fallback_per_kind" ON "category" ("user_id","kind") WHERE "is_fallback";--> statement-breakpoint
CREATE INDEX "entry_user_id_happened_on_idx" ON "entry" ("user_id","happened_on");--> statement-breakpoint
CREATE INDEX "entry_category_id_idx" ON "entry" ("category_id");--> statement-breakpoint
CREATE INDEX "entry_part_line_id_idx" ON "entry_part" ("line_id");--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "entry" ADD CONSTRAINT "entry_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "entry_part" ADD CONSTRAINT "entry_part_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "entry_part" ADD CONSTRAINT "entry_part_entry_fk" FOREIGN KEY ("user_id","entry_id") REFERENCES "entry"("user_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "entry_part" ADD CONSTRAINT "entry_part_line_fk" FOREIGN KEY ("user_id","line_id") REFERENCES "statement_line"("user_id","id") ON DELETE CASCADE;--> statement-breakpoint
CREATE POLICY "category_own_rows_only" ON "category" AS PERMISSIVE FOR ALL TO public USING ("user_id" = current_setting('gousset.user_id', true)) WITH CHECK ("user_id" = current_setting('gousset.user_id', true));--> statement-breakpoint
CREATE POLICY "entry_own_rows_only" ON "entry" AS PERMISSIVE FOR ALL TO public USING ("user_id" = current_setting('gousset.user_id', true)) WITH CHECK ("user_id" = current_setting('gousset.user_id', true));--> statement-breakpoint
CREATE POLICY "entry_part_own_rows_only" ON "entry_part" AS PERMISSIVE FOR ALL TO public USING ("user_id" = current_setting('gousset.user_id', true)) WITH CHECK ("user_id" = current_setting('gousset.user_id', true));