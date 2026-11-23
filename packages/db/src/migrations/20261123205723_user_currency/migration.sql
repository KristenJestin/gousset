ALTER TABLE "auth_user" ADD COLUMN "currency" text DEFAULT 'EUR' NOT NULL;--> statement-breakpoint
-- An ISO 4217 code, as every currency of the data is (docs/data-model.md). Kept out of the Drizzle
-- schema on purpose: packages/db/src/schema/auth.ts is rewritten by `pnpm auth:generate`, which
-- knows nothing of it. Added only when missing, so that running this again changes nothing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'auth_user_currency_iso' AND conrelid = 'public.auth_user'::regclass
  ) THEN
    ALTER TABLE "auth_user" ADD CONSTRAINT "auth_user_currency_iso" CHECK ("currency" ~ '^[A-Z]{3}$');
  END IF;
END
$$;
