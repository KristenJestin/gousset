ALTER TABLE "merchant" ADD COLUMN "default_category_id" uuid;--> statement-breakpoint
CREATE INDEX "merchant_default_category_id_idx" ON "merchant" ("default_category_id");