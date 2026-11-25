-- The default set's icons and colours (#205; docs/data-model.md, v0.3, "category"), given to the
-- categories every user already has that are still the set's: of its kind, with its name, under a
-- parent of its name (or at the top for a top-level one), in English or in French, the languages
-- the set was copied in. A category the user renamed or moved is theirs, and is left as it is; an
-- icon or a colour already set is never replaced. A child takes its parent's colour, so the set
-- gives colours to top-level categories only. `updated_at` stays: nothing the user did changed.
-- packages/core's unit test keeps the list below equal to `src/default-categories.ts`. Categories
-- force row-level security on their owner: each user is set in turn. Every statement does nothing
-- the second time.
DO $$
DECLARE
  each_user text;
BEGIN
  FOR each_user IN SELECT id FROM auth_user ORDER BY id LOOP
    PERFORM set_config('gousset.user_id', each_user, true);

    WITH default_set (kind, parent, name, icon, color) AS (
      VALUES
        -- default looks: begin
        ('expense', NULL, 'Housing', 'housing', 'blue'),
        ('expense', 'Housing', 'Rent', 'rent', NULL),
        ('expense', 'Housing', 'Energy', 'energy', NULL),
        ('expense', 'Housing', 'Home insurance', 'insurance', NULL),
        ('expense', 'Housing', 'Repairs', 'repairs', NULL),
        ('expense', NULL, 'Groceries', 'groceries', 'green'),
        ('expense', 'Groceries', 'Supermarket', 'supermarket', NULL),
        ('expense', 'Groceries', 'Market', 'market', NULL),
        ('expense', 'Groceries', 'Bakery', 'bakery', NULL),
        ('expense', NULL, 'Transport', 'transport', 'cyan'),
        ('expense', 'Transport', 'Fuel', 'fuel', NULL),
        ('expense', 'Transport', 'Public transport', 'train', NULL),
        ('expense', 'Transport', 'Car maintenance', 'car', NULL),
        ('expense', 'Transport', 'Parking and tolls', 'parking', NULL),
        ('expense', NULL, 'Eating out', 'restaurants', 'orange'),
        ('expense', 'Eating out', 'Restaurants', 'restaurants', NULL),
        ('expense', 'Eating out', 'Cafés and bars', 'cafe', NULL),
        ('expense', 'Eating out', 'Takeaway', 'takeaway', NULL),
        ('expense', NULL, 'Health', 'health', 'red'),
        ('expense', 'Health', 'Doctor', 'doctor', NULL),
        ('expense', 'Health', 'Pharmacy', 'pharmacy', NULL),
        ('expense', 'Health', 'Health insurance', 'insurance', NULL),
        ('expense', NULL, 'Leisure', 'leisure', 'violet'),
        ('expense', 'Leisure', 'Sport', 'sport', NULL),
        ('expense', 'Leisure', 'Culture', 'culture', NULL),
        ('expense', 'Leisure', 'Travel', 'travel', NULL),
        ('expense', 'Leisure', 'Hobbies', 'hobbies', NULL),
        ('expense', NULL, 'Shopping', 'shopping', 'pink'),
        ('expense', 'Shopping', 'Clothing', 'clothes', NULL),
        ('expense', 'Shopping', 'Electronics', 'electronics', NULL),
        ('expense', 'Shopping', 'Home and garden', 'garden', NULL),
        ('expense', NULL, 'Subscriptions', 'subscriptions', 'indigo'),
        ('expense', 'Subscriptions', 'Phone and internet', 'phone', NULL),
        ('expense', 'Subscriptions', 'Streaming', 'streaming', NULL),
        ('expense', 'Subscriptions', 'Software', 'software', NULL),
        ('expense', NULL, 'Family', 'family', 'amber'),
        ('expense', 'Family', 'Childcare', 'children', NULL),
        ('expense', 'Family', 'Education', 'education', NULL),
        ('expense', 'Family', 'Gifts', 'gifts', NULL),
        ('expense', NULL, 'Fees and taxes', 'fees', 'olive'),
        ('expense', 'Fees and taxes', 'Bank fees', 'bank', NULL),
        ('expense', 'Fees and taxes', 'Taxes', 'taxes', NULL),
        ('expense', NULL, 'Other', 'other', 'grey'),
        ('income', NULL, 'Salary', 'salary', 'green'),
        ('income', 'Salary', 'Pay', 'pay', NULL),
        ('income', 'Salary', 'Bonus', 'bonus', NULL),
        ('income', NULL, 'Benefits', 'benefits', 'teal'),
        ('income', 'Benefits', 'Family allowance', 'family', NULL),
        ('income', 'Benefits', 'Housing aid', 'housing', NULL),
        ('income', NULL, 'Investment income', 'investments', 'blue'),
        ('income', 'Investment income', 'Interest', 'interest', NULL),
        ('income', 'Investment income', 'Dividends', 'dividends', NULL),
        ('income', NULL, 'Reimbursements', 'reimbursements', 'cyan'),
        ('income', 'Reimbursements', 'Health reimbursements', 'health', NULL),
        ('income', 'Reimbursements', 'Expense claims', 'expense-claims', NULL),
        ('income', NULL, 'Gifts received', 'gifts', 'pink'),
        ('income', NULL, 'Other', 'other', 'grey'),
        ('expense', NULL, 'Logement', 'housing', 'blue'),
        ('expense', 'Logement', 'Loyer', 'rent', NULL),
        ('expense', 'Logement', 'Énergie', 'energy', NULL),
        ('expense', 'Logement', 'Assurance habitation', 'insurance', NULL),
        ('expense', 'Logement', 'Travaux', 'repairs', NULL),
        ('expense', NULL, 'Courses', 'groceries', 'green'),
        ('expense', 'Courses', 'Supermarché', 'supermarket', NULL),
        ('expense', 'Courses', 'Marché', 'market', NULL),
        ('expense', 'Courses', 'Boulangerie', 'bakery', NULL),
        ('expense', NULL, 'Transports', 'transport', 'cyan'),
        ('expense', 'Transports', 'Carburant', 'fuel', NULL),
        ('expense', 'Transports', 'Transports en commun', 'train', NULL),
        ('expense', 'Transports', 'Entretien du véhicule', 'car', NULL),
        ('expense', 'Transports', 'Parking et péages', 'parking', NULL),
        ('expense', NULL, 'Sorties au restaurant', 'restaurants', 'orange'),
        ('expense', 'Sorties au restaurant', 'Restaurants', 'restaurants', NULL),
        ('expense', 'Sorties au restaurant', 'Cafés et bars', 'cafe', NULL),
        ('expense', 'Sorties au restaurant', 'Plats à emporter', 'takeaway', NULL),
        ('expense', NULL, 'Santé', 'health', 'red'),
        ('expense', 'Santé', 'Médecin', 'doctor', NULL),
        ('expense', 'Santé', 'Pharmacie', 'pharmacy', NULL),
        ('expense', 'Santé', 'Mutuelle', 'insurance', NULL),
        ('expense', NULL, 'Loisirs', 'leisure', 'violet'),
        ('expense', 'Loisirs', 'Sport', 'sport', NULL),
        ('expense', 'Loisirs', 'Culture', 'culture', NULL),
        ('expense', 'Loisirs', 'Voyages', 'travel', NULL),
        ('expense', 'Loisirs', 'Passe-temps', 'hobbies', NULL),
        ('expense', NULL, 'Achats', 'shopping', 'pink'),
        ('expense', 'Achats', 'Vêtements', 'clothes', NULL),
        ('expense', 'Achats', 'Électronique', 'electronics', NULL),
        ('expense', 'Achats', 'Maison et jardin', 'garden', NULL),
        ('expense', NULL, 'Abonnements', 'subscriptions', 'indigo'),
        ('expense', 'Abonnements', 'Téléphone et internet', 'phone', NULL),
        ('expense', 'Abonnements', 'Streaming', 'streaming', NULL),
        ('expense', 'Abonnements', 'Logiciels', 'software', NULL),
        ('expense', NULL, 'Famille', 'family', 'amber'),
        ('expense', 'Famille', 'Garde d''enfants', 'children', NULL),
        ('expense', 'Famille', 'Scolarité', 'education', NULL),
        ('expense', 'Famille', 'Cadeaux', 'gifts', NULL),
        ('expense', NULL, 'Frais et impôts', 'fees', 'olive'),
        ('expense', 'Frais et impôts', 'Frais bancaires', 'bank', NULL),
        ('expense', 'Frais et impôts', 'Impôts', 'taxes', NULL),
        ('expense', NULL, 'Autre', 'other', 'grey'),
        ('income', NULL, 'Salaire', 'salary', 'green'),
        ('income', 'Salaire', 'Paie', 'pay', NULL),
        ('income', 'Salaire', 'Prime', 'bonus', NULL),
        ('income', NULL, 'Aides et allocations', 'benefits', 'teal'),
        ('income', 'Aides et allocations', 'Allocations familiales', 'family', NULL),
        ('income', 'Aides et allocations', 'Aide au logement', 'housing', NULL),
        ('income', NULL, 'Revenus financiers', 'investments', 'blue'),
        ('income', 'Revenus financiers', 'Intérêts', 'interest', NULL),
        ('income', 'Revenus financiers', 'Dividendes', 'dividends', NULL),
        ('income', NULL, 'Remboursements', 'reimbursements', 'cyan'),
        ('income', 'Remboursements', 'Remboursements santé', 'health', NULL),
        ('income', 'Remboursements', 'Notes de frais', 'expense-claims', NULL),
        ('income', NULL, 'Cadeaux reçus', 'gifts', 'pink'),
        ('income', NULL, 'Autre', 'other', 'grey')
        -- default looks: end
    ), untouched AS (
      SELECT c.id, d.icon, d.color
      FROM category c
      JOIN default_set d ON c.kind = d.kind::entry_kind AND c.name = d.name
      LEFT JOIN category p ON p.id = c.parent_id
      WHERE c.user_id = each_user
        AND ((d.parent IS NULL AND c.parent_id IS NULL) OR p.name = d.parent)
    )
    UPDATE category c
    SET icon = coalesce(c.icon, u.icon), color = coalesce(c.color, u.color)
    FROM untouched u
    WHERE c.id = u.id AND (c.icon IS NULL OR (c.color IS NULL AND u.color IS NOT NULL));
  END LOOP;

  PERFORM set_config('gousset.user_id', '', true);
END
$$;
