-- The subjects (v0.5, #37) kept apart as every user's table is (docs/data-model.md, "Ownership and
-- isolation"): row-level security forced, so that the policy binds the tables' owner too, and the
-- grants to `gousset_user` alone, never to `gousset_app`. The keys Drizzle cannot write are here,
-- composite on `user_id` as every reference of a user's row: a subject's parent is kept (a subject
-- with children is not deleted; checked at commit, so that a user's deletion still cascades), and
-- a subject's loan and a rule's subject are cleared on their own column when the row they name is
-- deleted (`on delete set null (<column>)`), which never touches `user_id`. Each statement does
-- nothing more the second time.
GRANT SELECT, INSERT, UPDATE, DELETE ON "subject", "entry_subject", "subject_account", "subject_entry_refused" TO gousset_user;--> statement-breakpoint
ALTER TABLE "subject" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entry_subject" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subject_account" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subject_entry_refused" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "subject" ADD CONSTRAINT "subject_parent_fk" FOREIGN KEY ("user_id","parent_id") REFERENCES "subject"("user_id","id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "subject" ADD CONSTRAINT "subject_loan_account_fk" FOREIGN KEY ("user_id","loan_account_id") REFERENCES "account"("user_id","id") ON DELETE SET NULL ("loan_account_id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "rule" ADD CONSTRAINT "rule_attach_subject_fk" FOREIGN KEY ("user_id","attach_subject_id") REFERENCES "subject"("user_id","id") ON DELETE SET NULL ("attach_subject_id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
