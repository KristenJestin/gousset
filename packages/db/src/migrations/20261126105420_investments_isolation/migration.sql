-- The investments (#250) kept apart as every user's table is (docs/data-model.md, "Ownership and
-- isolation"): row-level security forced, so that the policy binds the tables' owner too, and the
-- grants to `gousset_user` alone, never to `gousset_app`. An operation's security is a kept
-- reference (`on delete no action deferrable initially deferred`, docs/data-model.md,
-- "Conventions"): a security with operations is not deleted, and deleting a user, which cascades
-- into both tables at once, is checked at commit. Drizzle writes neither. Each statement does
-- nothing more the second time.
GRANT SELECT, INSERT, UPDATE, DELETE ON "security", "investment_operation" TO gousset_user;--> statement-breakpoint
ALTER TABLE "security" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "investment_operation" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "investment_operation" ADD CONSTRAINT "investment_operation_security_fk" FOREIGN KEY ("user_id","security_id") REFERENCES "security"("user_id","id") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
