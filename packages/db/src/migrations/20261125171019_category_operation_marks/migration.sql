-- The categories the lines of an operation go in (#194; docs/data-model.md, v0.3, "Operation
-- prefixes"), marked for every user who exists already, only where it is sure: the default set's
-- "Fees and taxes > Bank fees" (expense) takes the fees, "Investment income > Interest" (income)
-- the interest, each found under its parent by the name the set gives it in English or French
-- (#195 renames untouched defaults into the user's language), neither archived, and marked only
-- when exactly one category of the user's matches. A category the user renamed, moved or archived
-- is left unmarked; so is a user with two candidates. Loans have no default category: none is
-- marked. Once marked, nothing finds the category by its name again. Categories force row-level
-- security on their owner too: each user is set in turn. A user with a category of that operation
-- already is left as they are, so it does nothing the second time.
DO $$
DECLARE
  each_user text;
BEGIN
  FOR each_user IN SELECT id FROM auth_user ORDER BY id LOOP
    PERFORM set_config('gousset.user_id', each_user, true);

    WITH marks (operation, kind, parents, names) AS (
      VALUES
        ('fee', 'expense', ARRAY['Fees and taxes', 'Frais et impôts'], ARRAY['Bank fees', 'Frais bancaires']),
        ('interest', 'income', ARRAY['Investment income', 'Revenus financiers'], ARRAY['Interest', 'Intérêts'])
    ), found AS (
      SELECT m.operation, c.id, count(*) OVER (PARTITION BY m.operation) AS candidates
      FROM marks m
      JOIN category c ON c.user_id = each_user AND c.kind = m.kind::entry_kind
        AND c.name = ANY (m.names) AND c.archived_at IS NULL
      JOIN category p ON p.id = c.parent_id AND p.parent_id IS NULL
        AND p.name = ANY (m.parents) AND p.archived_at IS NULL
    )
    UPDATE category c SET operation = f.operation::category_operation
    FROM found f
    WHERE c.id = f.id AND f.candidates = 1
      AND NOT EXISTS (
        SELECT 1 FROM category o
        WHERE o.user_id = each_user AND o.kind = c.kind AND o.operation = f.operation::category_operation
      );
  END LOOP;

  PERFORM set_config('gousset.user_id', '', true);
END
$$;
