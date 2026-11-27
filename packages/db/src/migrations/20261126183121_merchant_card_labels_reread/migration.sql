-- #243: whether the merchants made from the `CARD` of an English card label (`CARD 12/03 PIZZA
-- NOVA`, cleaned to `CARD` before) were read again. A user made before may have one, and is marked
-- false, for the next boot's merchants job to read theirs again once; a user made from now on has
-- none, and is marked true. Drizzle writes the column with its final default, true, which would mark
-- every existing user too: the column is added false, then its default set to true, which is safe
-- to run again.
ALTER TABLE "auth_user" ADD COLUMN "merchant_card_labels_reread" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_user" ALTER COLUMN "merchant_card_labels_reread" SET DEFAULT true;
