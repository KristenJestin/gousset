-- v0.3's categories, entries and their parts kept apart, and every existing line given its entry
-- (#23; docs/data-model.md, "v0.3: Classify"). Kept out of the Drizzle schema on purpose, as
-- `user_data_isolation` and `app_role` are: Drizzle writes neither grants nor a deferred foreign
-- key, and regenerating the schema never drops what is written here. Every statement does nothing
-- the second time.
--
-- A user's transaction acts as `gousset_user`, which alone is granted these tables; the app's own
-- role is not. The policies bind the tables' owner too, should it be no superuser.
GRANT SELECT, INSERT, UPDATE, DELETE ON "category", "entry", "entry_part" TO gousset_user;--> statement-breakpoint
ALTER TABLE "category" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entry" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entry_part" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Kept references: a parent with children, or a category in use, is not deleted. Checked at commit,
-- once every cascade of a user's deletion has run, so that the user can still be deleted.
DO $$
BEGIN
  ALTER TABLE "category" ADD CONSTRAINT "category_parent_fk" FOREIGN KEY ("user_id","parent_id","kind") REFERENCES "category"("user_id","id","kind") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "entry" ADD CONSTRAINT "entry_category_fk" FOREIGN KEY ("user_id","category_id","kind") REFERENCES "category"("user_id","id","kind") ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;--> statement-breakpoint
-- Every user who exists already gets the default set in English (packages/core,
-- src/default-categories.ts, which a unit test keeps equal to the list below), and every counted
-- line with an amount one entry: an expense when money leaves, an income when it comes in, the
-- day it was booked, in its kind's fallback category, with one payment part of the whole line,
-- `classified_by = default`. A line of no amount has none, nor a side of a transfer (#26): it is
-- the transfer, never an expense nor an income. Statement lines already force
-- row-level security: the tables' owner, when it is no superuser, sees a user's rows only with
-- that user set, so each user is set in turn. A user who has categories already, or a line that
-- has a part, is left as it is.
DO $$
DECLARE
  each_user text;
BEGIN
  FOR each_user IN SELECT id FROM auth_user ORDER BY id LOOP
    PERFORM set_config('gousset.user_id', each_user, true);

    IF NOT EXISTS (SELECT 1 FROM category c WHERE c.user_id = each_user) THEN
      WITH default_set (kind, parent, name, "position", is_fallback) AS (
        VALUES
          -- default set: begin
          ('expense', NULL, 'Housing', 0, false),
          ('expense', 'Housing', 'Rent', 0, false),
          ('expense', 'Housing', 'Energy', 1, false),
          ('expense', 'Housing', 'Home insurance', 2, false),
          ('expense', 'Housing', 'Repairs', 3, false),
          ('expense', NULL, 'Groceries', 1, false),
          ('expense', 'Groceries', 'Supermarket', 0, false),
          ('expense', 'Groceries', 'Market', 1, false),
          ('expense', 'Groceries', 'Bakery', 2, false),
          ('expense', NULL, 'Transport', 2, false),
          ('expense', 'Transport', 'Fuel', 0, false),
          ('expense', 'Transport', 'Public transport', 1, false),
          ('expense', 'Transport', 'Car maintenance', 2, false),
          ('expense', 'Transport', 'Parking and tolls', 3, false),
          ('expense', NULL, 'Eating out', 3, false),
          ('expense', 'Eating out', 'Restaurants', 0, false),
          ('expense', 'Eating out', 'Cafés and bars', 1, false),
          ('expense', 'Eating out', 'Takeaway', 2, false),
          ('expense', NULL, 'Health', 4, false),
          ('expense', 'Health', 'Doctor', 0, false),
          ('expense', 'Health', 'Pharmacy', 1, false),
          ('expense', 'Health', 'Health insurance', 2, false),
          ('expense', NULL, 'Leisure', 5, false),
          ('expense', 'Leisure', 'Sport', 0, false),
          ('expense', 'Leisure', 'Culture', 1, false),
          ('expense', 'Leisure', 'Travel', 2, false),
          ('expense', 'Leisure', 'Hobbies', 3, false),
          ('expense', NULL, 'Shopping', 6, false),
          ('expense', 'Shopping', 'Clothing', 0, false),
          ('expense', 'Shopping', 'Electronics', 1, false),
          ('expense', 'Shopping', 'Home and garden', 2, false),
          ('expense', NULL, 'Subscriptions', 7, false),
          ('expense', 'Subscriptions', 'Phone and internet', 0, false),
          ('expense', 'Subscriptions', 'Streaming', 1, false),
          ('expense', 'Subscriptions', 'Software', 2, false),
          ('expense', NULL, 'Family', 8, false),
          ('expense', 'Family', 'Childcare', 0, false),
          ('expense', 'Family', 'Education', 1, false),
          ('expense', 'Family', 'Gifts', 2, false),
          ('expense', NULL, 'Fees and taxes', 9, false),
          ('expense', 'Fees and taxes', 'Bank fees', 0, false),
          ('expense', 'Fees and taxes', 'Taxes', 1, false),
          ('expense', NULL, 'Other', 10, true),
          ('income', NULL, 'Salary', 0, false),
          ('income', 'Salary', 'Pay', 0, false),
          ('income', 'Salary', 'Bonus', 1, false),
          ('income', NULL, 'Benefits', 1, false),
          ('income', 'Benefits', 'Family allowance', 0, false),
          ('income', 'Benefits', 'Housing aid', 1, false),
          ('income', NULL, 'Investment income', 2, false),
          ('income', 'Investment income', 'Interest', 0, false),
          ('income', 'Investment income', 'Dividends', 1, false),
          ('income', NULL, 'Reimbursements', 3, false),
          ('income', 'Reimbursements', 'Health reimbursements', 0, false),
          ('income', 'Reimbursements', 'Expense claims', 1, false),
          ('income', NULL, 'Gifts received', 4, false),
          ('income', NULL, 'Other', 5, true)
          -- default set: end
      ), tops AS (
        INSERT INTO category (user_id, kind, name, "position", is_fallback)
        SELECT each_user, d.kind::entry_kind, d.name, d."position", d.is_fallback
        FROM default_set d WHERE d.parent IS NULL
        RETURNING id, kind, name
      )
      INSERT INTO category (user_id, kind, parent_id, name, "position")
      SELECT each_user, t.kind, t.id, d.name, d."position"
      FROM default_set d JOIN tops t ON t.kind = d.kind::entry_kind AND t.name = d.parent
      WHERE d.parent IS NOT NULL;
    END IF;

    -- `pending` is read twice and calls a volatile function: it is computed once. Both inserts'
    -- foreign keys are checked at the end of the statement, once both are written.
    WITH pending AS MATERIALIZED (
      SELECT uuidv7() AS entry_id, l.id AS line_id, l.booked_on, abs(l.amount_minor) AS amount,
        c.id AS category_id, c.kind
      FROM statement_line l
      JOIN category c ON c.user_id = l.user_id AND c.is_fallback
        AND c.kind = (CASE WHEN l.amount_minor < 0 THEN 'expense' ELSE 'income' END)::entry_kind
      WHERE l.user_id = each_user AND l.state = 'counted' AND l.amount_minor <> 0
        AND NOT EXISTS (SELECT 1 FROM entry_part p WHERE p.line_id = l.id)
        AND NOT EXISTS (SELECT 1 FROM transfer t WHERE l.id IN (t.out_line_id, t.in_line_id))
      ORDER BY l.booked_on, l.id
    ), made AS (
      INSERT INTO entry (id, user_id, kind, happened_on, category_id, classified_by)
      SELECT p.entry_id, each_user, p.kind, p.booked_on, p.category_id, 'default' FROM pending p
      RETURNING id
    )
    INSERT INTO entry_part (user_id, entry_id, line_id, role, amount_minor)
    SELECT each_user, p.entry_id, p.line_id, 'payment', p.amount FROM pending p;
  END LOOP;

  PERFORM set_config('gousset.user_id', '', true);
END
$$;
