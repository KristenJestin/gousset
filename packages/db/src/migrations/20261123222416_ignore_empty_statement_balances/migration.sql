-- #130: some banks' files state a closing balance of 0.00 although the account is not empty. From
-- now on the import treats a statement balance of zero that the account's balance at the end of its
-- day contradicts as not given (packages/core, `looksEmpty`; docs/data-model.md, "account_balance").
-- This drops those that imports recorded before, so that the account page's check no longer shows
-- the false gap, and marks their imports so that their summary says so. The app's balance is the
-- one the check computes: kept by lines, the opening balance plus every counted line booked up to
-- that day; kept by balance, the latest balance noted up to that day, or the opening balance.
-- Run again, it finds nothing more to drop.
--
-- The policies bind the tables' owner when it is no superuser (FORCE ROW LEVEL SECURITY, #66),
-- and no user is set here: they are lifted for this transaction only, and put back below.
ALTER TABLE "account" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account_balance" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "statement_line" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
WITH "empty" AS (
  SELECT b."id", b."import_id"
  FROM "account_balance" b
  JOIN "account" a ON a."id" = b."account_id"
  WHERE b."source" = 'statement'
    AND b."balance_minor" = 0
    AND CASE a."mode"
      WHEN 'lines' THEN a."opening_balance_minor" + coalesce((
        SELECT sum(l."amount_minor")
        FROM "statement_line" l
        WHERE l."account_id" = b."account_id" AND l."state" = 'counted' AND l."booked_on" <= b."day"
      ), 0)
      ELSE coalesce((
        SELECT n."balance_minor"
        FROM "account_balance" n
        WHERE n."account_id" = b."account_id" AND n."source" = 'noted' AND n."day" <= b."day"
        ORDER BY n."day" DESC, n."id" DESC
        LIMIT 1
      ), a."opening_balance_minor")
    END <> 0
), "marked" AS (
  UPDATE "import" SET "balance_ignored" = true
  WHERE "id" IN (SELECT "import_id" FROM "empty")
)
DELETE FROM "account_balance" WHERE "id" IN (SELECT "id" FROM "empty");--> statement-breakpoint
ALTER TABLE "account" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account_balance" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "statement_line" FORCE ROW LEVEL SECURITY;
