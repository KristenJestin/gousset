import { category } from "@gousset/db/schema/ledger";
import { UserData } from "@gousset/db/user-data";
import type { QueryFailed, UserTransaction } from "@gousset/db/user-data";
import { Effect } from "effect";

// The categories every user starts with (#23; docs/data-model.md, v0.3): two levels, expense and
// income, each kind with its fallback, "Other", where an entry goes until it is classified. The set
// is copied into a user's rows at sign-up, in the language their browser prefers; from then on the
// names are theirs. The migration `*_categories_isolation` gives every user who existed before it
// the English set: a unit test keeps its SQL equal to this constant.

/** The languages the default set is written in. */
export type SetLanguage = "en" | "fr";

/** A category's name in each language of the set. */
export type DefaultName = { readonly en: string; readonly fr: string };

/** A top-level category of the set, with its children, in their order. */
export type DefaultCategory = DefaultName & {
  readonly fallback?: true;
  readonly children: ReadonlyArray<DefaultName>;
};

/** The set, by kind: top-level categories in their order. */
export type DefaultSet = {
  readonly expense: ReadonlyArray<DefaultCategory>;
  readonly income: ReadonlyArray<DefaultCategory>;
};

/** The set, by kind, top-level categories in their order; each kind's fallback last. */
export const DEFAULT_CATEGORIES: DefaultSet = {
  expense: [
    {
      en: "Housing",
      fr: "Logement",
      children: [
        { en: "Rent", fr: "Loyer" },
        { en: "Energy", fr: "Énergie" },
        { en: "Home insurance", fr: "Assurance habitation" },
        { en: "Repairs", fr: "Travaux" },
      ],
    },
    {
      en: "Groceries",
      fr: "Courses",
      children: [
        { en: "Supermarket", fr: "Supermarché" },
        { en: "Market", fr: "Marché" },
        { en: "Bakery", fr: "Boulangerie" },
      ],
    },
    {
      en: "Transport",
      fr: "Transports",
      children: [
        { en: "Fuel", fr: "Carburant" },
        { en: "Public transport", fr: "Transports en commun" },
        { en: "Car maintenance", fr: "Entretien du véhicule" },
        { en: "Parking and tolls", fr: "Parking et péages" },
      ],
    },
    {
      en: "Eating out",
      fr: "Sorties au restaurant",
      children: [
        { en: "Restaurants", fr: "Restaurants" },
        { en: "Cafés and bars", fr: "Cafés et bars" },
        { en: "Takeaway", fr: "Plats à emporter" },
      ],
    },
    {
      en: "Health",
      fr: "Santé",
      children: [
        { en: "Doctor", fr: "Médecin" },
        { en: "Pharmacy", fr: "Pharmacie" },
        { en: "Health insurance", fr: "Mutuelle" },
      ],
    },
    {
      en: "Leisure",
      fr: "Loisirs",
      children: [
        { en: "Sport", fr: "Sport" },
        { en: "Culture", fr: "Culture" },
        { en: "Travel", fr: "Voyages" },
        { en: "Hobbies", fr: "Passe-temps" },
      ],
    },
    {
      en: "Shopping",
      fr: "Achats",
      children: [
        { en: "Clothing", fr: "Vêtements" },
        { en: "Electronics", fr: "Électronique" },
        { en: "Home and garden", fr: "Maison et jardin" },
      ],
    },
    {
      en: "Subscriptions",
      fr: "Abonnements",
      children: [
        { en: "Phone and internet", fr: "Téléphone et internet" },
        { en: "Streaming", fr: "Streaming" },
        { en: "Software", fr: "Logiciels" },
      ],
    },
    {
      en: "Family",
      fr: "Famille",
      children: [
        { en: "Childcare", fr: "Garde d'enfants" },
        { en: "Education", fr: "Scolarité" },
        { en: "Gifts", fr: "Cadeaux" },
      ],
    },
    {
      en: "Fees and taxes",
      fr: "Frais et impôts",
      children: [
        { en: "Bank fees", fr: "Frais bancaires" },
        { en: "Taxes", fr: "Impôts" },
      ],
    },
    { en: "Other", fr: "Autre", fallback: true, children: [] },
  ],
  income: [
    {
      en: "Salary",
      fr: "Salaire",
      children: [
        { en: "Pay", fr: "Paie" },
        { en: "Bonus", fr: "Prime" },
      ],
    },
    {
      en: "Benefits",
      fr: "Aides et allocations",
      children: [
        { en: "Family allowance", fr: "Allocations familiales" },
        { en: "Housing aid", fr: "Aide au logement" },
      ],
    },
    {
      en: "Investment income",
      fr: "Revenus financiers",
      children: [
        { en: "Interest", fr: "Intérêts" },
        { en: "Dividends", fr: "Dividendes" },
      ],
    },
    {
      en: "Reimbursements",
      fr: "Remboursements",
      children: [
        { en: "Health reimbursements", fr: "Remboursements santé" },
        { en: "Expense claims", fr: "Notes de frais" },
      ],
    },
    { en: "Gifts received", fr: "Cadeaux reçus", children: [] },
    { en: "Other", fr: "Autre", fallback: true, children: [] },
  ],
};

/** One row of the set, flat: what the migration's SQL lists. */
export type DefaultRow = {
  readonly kind: "expense" | "income";
  readonly parent: string | null;
  readonly name: string;
  readonly position: number;
  readonly fallback: boolean;
};

/** The set in one language, flat: each top-level category, then its children. */
export function defaultRows(language: SetLanguage): ReadonlyArray<DefaultRow> {
  const kinds = ["expense", "income"] as const;

  return kinds.flatMap((kind) =>
    DEFAULT_CATEGORIES[kind].flatMap((top, position) => [
      { kind, parent: null, name: top[language], position, fallback: top.fallback === true },
      ...top.children.map((child, childPosition) => ({
        kind,
        parent: top[language],
        name: child[language],
        position: childPosition,
        fallback: false,
      })),
    ]),
  );
}

/**
 * The language of the set for a browser's `Accept-Language`: French when French comes first among
 * the languages it accepts (by quality, then order), English otherwise, and with no header.
 */
export function setLanguageOf(acceptLanguage: string | null | undefined): SetLanguage {
  const ranked = (acceptLanguage ?? "")
    .split(",")
    .map((part, order) => {
      const [tag = "", ...parameters] = part.trim().split(";");

      const quality = parameters
        .map((parameter) => /^\s*q\s*=\s*([\d.]+)\s*$/i.exec(parameter)?.[1])
        .find((value) => value !== undefined);

      return { tag: tag.trim().toLowerCase(), quality: Number(quality ?? "1"), order };
    })
    .filter((each) => each.tag !== "" && each.tag !== "*" && each.quality > 0)
    .toSorted((a, b) => b.quality - a.quality || a.order - b.order);

  const first = ranked[0]?.tag ?? "";

  return first === "fr" || first.startsWith("fr-") ? "fr" : "en";
}

/**
 * Writes the default set in `language` as `owner`'s categories, in a transaction of theirs. A user
 * who already has a category is left as they are: the set is copied once.
 */
export async function insertDefaultSet(
  transaction: UserTransaction,
  owner: string,
  language: SetLanguage,
): Promise<number> {
  const existing = await transaction.select({ id: category.id }).from(category).limit(1);

  if (existing.length > 0) {
    return 0;
  }

  const rows = defaultRows(language);
  const tops = rows.filter((row) => row.parent === null);

  const made = await transaction
    .insert(category)
    .values(
      tops.map((row) => ({
        userId: owner,
        kind: row.kind,
        name: row.name,
        position: row.position,
        isFallback: row.fallback,
      })),
    )
    .returning({ id: category.id, kind: category.kind, name: category.name });

  const parentOf = new Map(made.map((each) => [`${each.kind}/${each.name}`, each.id]));

  const children = rows.flatMap((row) => {
    const parentId = row.parent === null ? undefined : parentOf.get(`${row.kind}/${row.parent}`);

    return parentId === undefined
      ? []
      : [{ userId: owner, kind: row.kind, parentId, name: row.name, position: row.position }];
  });

  if (children.length > 0) {
    await transaction.insert(category).values(children);
  }

  return made.length + children.length;
}

/**
 * Copies the default set into a new user's categories, in `language` (sign-up, packages/auth). A
 * user who already has categories keeps them.
 */
export const copyDefaultCategories = (
  owner: string,
  language: SetLanguage,
): Effect.Effect<number, QueryFailed, UserData> =>
  Effect.gen(function* () {
    const userData = yield* UserData;

    return yield* userData.transaction(owner, (transaction) =>
      insertDefaultSet(transaction, owner, language),
    );
  });
