import { category } from "@gousset/db/schema/ledger";
import { UserData } from "@gousset/db/user-data";
import type { QueryFailed, UserTransaction } from "@gousset/db/user-data";
import { Effect } from "effect";

import type { CategoryColorKey, CategoryIconKey } from "./category-looks";

// The categories every user starts with (#23; docs/data-model.md, v0.3): two levels, expense and
// income, each kind with its fallback, "Other", where an entry goes until it is classified. The set
// is copied into a user's rows at sign-up, in the language their browser prefers; from then on the
// names are theirs. The migration `*_categories_isolation` gives every user who existed before it
// the English set: a unit test keeps its SQL equal to this constant. Each category has its icon,
// and each top-level one its colour, which its children take (#205): the migration
// `*_default_category_looks` gives them to the categories of the set a user left as they were, and a unit
// test keeps its SQL equal to this constant too.

/** The languages the default set is written in. */
export type SetLanguage = "en" | "fr";

/** A category's name in each language of the set. */
export type DefaultName = { readonly en: string; readonly fr: string };

/** A child of the set: its names and its icon; its colour is its parent's. */
export type DefaultChild = DefaultName & { readonly icon: CategoryIconKey };

/** A top-level category of the set, with its icon, its colour and its children, in their order. */
export type DefaultCategory = DefaultName & {
  readonly icon: CategoryIconKey;
  readonly color: CategoryColorKey;
  readonly fallback?: true;
  readonly children: ReadonlyArray<DefaultChild>;
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
      icon: "housing",
      color: "blue",
      children: [
        { en: "Rent", fr: "Loyer", icon: "rent" },
        { en: "Energy", fr: "Énergie", icon: "energy" },
        { en: "Home insurance", fr: "Assurance habitation", icon: "insurance" },
        { en: "Repairs", fr: "Travaux", icon: "repairs" },
      ],
    },
    {
      en: "Groceries",
      fr: "Courses",
      icon: "groceries",
      color: "green",
      children: [
        { en: "Supermarket", fr: "Supermarché", icon: "supermarket" },
        { en: "Market", fr: "Marché", icon: "market" },
        { en: "Bakery", fr: "Boulangerie", icon: "bakery" },
      ],
    },
    {
      en: "Transport",
      fr: "Transports",
      icon: "transport",
      color: "cyan",
      children: [
        { en: "Fuel", fr: "Carburant", icon: "fuel" },
        { en: "Public transport", fr: "Transports en commun", icon: "train" },
        { en: "Car maintenance", fr: "Entretien du véhicule", icon: "car" },
        { en: "Parking and tolls", fr: "Parking et péages", icon: "parking" },
      ],
    },
    {
      en: "Eating out",
      fr: "Sorties au restaurant",
      icon: "restaurants",
      color: "orange",
      children: [
        { en: "Restaurants", fr: "Restaurants", icon: "restaurants" },
        { en: "Cafés and bars", fr: "Cafés et bars", icon: "cafe" },
        { en: "Takeaway", fr: "Plats à emporter", icon: "takeaway" },
      ],
    },
    {
      en: "Health",
      fr: "Santé",
      icon: "health",
      color: "red",
      children: [
        { en: "Doctor", fr: "Médecin", icon: "doctor" },
        { en: "Pharmacy", fr: "Pharmacie", icon: "pharmacy" },
        { en: "Health insurance", fr: "Mutuelle", icon: "insurance" },
      ],
    },
    {
      en: "Leisure",
      fr: "Loisirs",
      icon: "leisure",
      color: "violet",
      children: [
        { en: "Sport", fr: "Sport", icon: "sport" },
        { en: "Culture", fr: "Culture", icon: "culture" },
        { en: "Travel", fr: "Voyages", icon: "travel" },
        { en: "Hobbies", fr: "Passe-temps", icon: "hobbies" },
      ],
    },
    {
      en: "Shopping",
      fr: "Achats",
      icon: "shopping",
      color: "pink",
      children: [
        { en: "Clothing", fr: "Vêtements", icon: "clothes" },
        { en: "Electronics", fr: "Électronique", icon: "electronics" },
        { en: "Home and garden", fr: "Maison et jardin", icon: "garden" },
      ],
    },
    {
      en: "Subscriptions",
      fr: "Abonnements",
      icon: "subscriptions",
      color: "indigo",
      children: [
        { en: "Phone and internet", fr: "Téléphone et internet", icon: "phone" },
        { en: "Streaming", fr: "Streaming", icon: "streaming" },
        { en: "Software", fr: "Logiciels", icon: "software" },
      ],
    },
    {
      en: "Family",
      fr: "Famille",
      icon: "family",
      color: "amber",
      children: [
        { en: "Childcare", fr: "Garde d'enfants", icon: "children" },
        { en: "Education", fr: "Scolarité", icon: "education" },
        { en: "Gifts", fr: "Cadeaux", icon: "gifts" },
      ],
    },
    {
      en: "Fees and taxes",
      fr: "Frais et impôts",
      icon: "fees",
      color: "olive",
      children: [
        { en: "Bank fees", fr: "Frais bancaires", icon: "bank" },
        { en: "Taxes", fr: "Impôts", icon: "taxes" },
      ],
    },
    { en: "Other", fr: "Autre", icon: "other", color: "grey", fallback: true, children: [] },
  ],
  income: [
    {
      en: "Salary",
      fr: "Salaire",
      icon: "salary",
      color: "green",
      children: [
        { en: "Pay", fr: "Paie", icon: "pay" },
        { en: "Bonus", fr: "Prime", icon: "bonus" },
      ],
    },
    {
      en: "Benefits",
      fr: "Aides et allocations",
      icon: "benefits",
      color: "teal",
      children: [
        { en: "Family allowance", fr: "Allocations familiales", icon: "family" },
        { en: "Housing aid", fr: "Aide au logement", icon: "housing" },
      ],
    },
    {
      en: "Investment income",
      fr: "Revenus financiers",
      icon: "investments",
      color: "blue",
      children: [
        { en: "Interest", fr: "Intérêts", icon: "interest" },
        { en: "Dividends", fr: "Dividendes", icon: "dividends" },
      ],
    },
    {
      en: "Reimbursements",
      fr: "Remboursements",
      icon: "reimbursements",
      color: "cyan",
      children: [
        { en: "Health reimbursements", fr: "Remboursements santé", icon: "health" },
        { en: "Expense claims", fr: "Notes de frais", icon: "expense-claims" },
      ],
    },
    {
      en: "Gifts received",
      fr: "Cadeaux reçus",
      icon: "gifts",
      color: "pink",
      children: [],
    },
    { en: "Other", fr: "Autre", icon: "other", color: "grey", fallback: true, children: [] },
  ],
};

/** One row of the set, flat: what the migrations' SQL lists. */
export type DefaultRow = {
  readonly kind: "expense" | "income";
  readonly parent: string | null;
  readonly name: string;
  readonly position: number;
  readonly fallback: boolean;
  readonly icon: CategoryIconKey;
  /** A top-level category's; null for a child, which takes its parent's. */
  readonly color: CategoryColorKey | null;
};

/** The set in one language, flat: each top-level category, then its children. */
export function defaultRows(language: SetLanguage): ReadonlyArray<DefaultRow> {
  const kinds = ["expense", "income"] as const;

  return kinds.flatMap((kind) =>
    DEFAULT_CATEGORIES[kind].flatMap((top, position) => [
      {
        kind,
        parent: null,
        name: top[language],
        position,
        fallback: top.fallback === true,
        icon: top.icon,
        color: top.color,
      },
      ...top.children.map((child, childPosition) => ({
        kind,
        parent: top[language],
        name: child[language],
        position: childPosition,
        fallback: false,
        icon: child.icon,
        color: null,
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
        icon: row.icon,
        color: row.color,
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
      : [
          {
            userId: owner,
            kind: row.kind,
            parentId,
            name: row.name,
            icon: row.icon,
            position: row.position,
          },
        ];
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
