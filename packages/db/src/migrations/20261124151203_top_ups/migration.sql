ALTER TABLE "account" ADD COLUMN "top_up_days" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "top_up_cap_minor" bigint;--> statement-breakpoint
ALTER TABLE "statement_line" ADD COLUMN "link_refused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_top_up_days_range" CHECK ("top_up_days" between 0 and 7);--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_top_up_cap_positive" CHECK ("top_up_cap_minor" > 0);