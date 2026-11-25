CREATE TYPE "category_operation" AS ENUM('loan', 'fee', 'interest');--> statement-breakpoint
ALTER TABLE "category" ADD COLUMN "operation" "category_operation";--> statement-breakpoint
CREATE UNIQUE INDEX "category_one_per_operation" ON "category" ("user_id","kind","operation") WHERE "operation" is not null;