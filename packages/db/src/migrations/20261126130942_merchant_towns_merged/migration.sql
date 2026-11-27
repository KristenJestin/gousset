-- #193: whether the merchants made one per town of a shop's card labels were merged. A user made
-- before has some, and is marked false, for the next boot's merchants job to merge theirs once; a
-- user made from now on has none, and is marked true. Drizzle writes the column with its final
-- default, true, which would mark every existing user too: the column is added false, then its
-- default set to true, which is safe to run again.
ALTER TABLE "auth_user" ADD COLUMN "merchant_towns_merged" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_user" ALTER COLUMN "merchant_towns_merged" SET DEFAULT true;
