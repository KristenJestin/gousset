import { category } from "@gousset/db/schema/ledger";
import { UserData } from "@gousset/db/user-data";
import type { QueryFailed, UserTransaction } from "@gousset/db/user-data";
import { asc, eq } from "drizzle-orm";
import { Effect } from "effect";
import type { Option } from "effect";

// The categories every user starts with (#23; docs/data-model.md, v0.3): two levels, expense and
// income, each kind with its fallback, "Other", where an entry goes until it is classified. The set
// is copied into a user's rows at sign-up, in the language of their interface; from then on the
// names are theirs. The migration `*_categories_isolation` gives every user who existed before it
// the English set: a unit test keeps its SQL equal to this constant. A user made before #195, or
// by the administrator, gets the defaults they never touched renamed once into their own language,
// at their first signed-in page (`settleDefaultNames`).

/** The languages the default set is written in. */
export type SetLanguage = "en" | "fr";

/**
 * A category's name in each language of the set; `operation` when it takes the lines of an
 * operation that name no merchant (#194, `merchants/operations.ts`).
 */
export type DefaultName = {
  readonly en: string;
  readonly fr: string;
  readonly operation?: CategoryOperation;
};

/** The operations a category takes the lines of: the database's `category_operation`. */
export type CategoryOperation = "loan" | "fee" | "interest";

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
        { en: "Bank fees", fr: "Frais bancaires", operation: "fee" },
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
        { en: "Interest", fr: "Intérêts", operation: "interest" },
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

/** The operation a child of the set, named in `language`, takes the lines of; null for none. */
function operationOfChild(row: DefaultRow, language: SetLanguage): CategoryOperation | null {
  const top = DEFAULT_CATEGORIES[row.kind].find((each) => each[language] === row.parent);

  return top?.children.find((each) => each[language] === row.name)?.operation ?? null;
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

/** The cookie the interface keeps the language the user chose in (Paraglide's, packages/i18n). */
export const LANGUAGE_COOKIE = "PARAGLIDE_LOCALE";

/**
 * The language of the set for a request, as the interface decides its own (apps/web, server.ts):
 * the language the user chose (its cookie), else the browser's `Accept-Language`, else English.
 */
export function setLanguageOfRequest(
  cookieHeader: string | null | undefined,
  acceptLanguage: string | null | undefined,
): SetLanguage {
  const chosen = (cookieHeader ?? "")
    .split(";")
    .map((pair) => pair.trim().split("="))
    .find(([name]) => name === LANGUAGE_COOKIE)?.[1];

  return chosen === "fr" || chosen === "en" ? chosen : setLanguageOf(acceptLanguage);
}

/** A category as the renaming of the defaults reads it. */
export type HeldCategory = {
  readonly id: string;
  readonly kind: "expense" | "income";
  readonly parentId: string | null;
  readonly name: string;
  readonly archived: boolean;
  readonly fallback: boolean;
};

/** A category's new name. */
export type DefaultRename = { readonly id: string; readonly name: string };

const LANGUAGES: ReadonlyArray<SetLanguage> = ["en", "fr"];

/**
 * The live categories that sit where the set put them with a name `named` accepts, each with its
 * place in the set: a top-level category at the top of its kind (a fallback only as its kind's
 * fallback), a child under such a top-level category.
 */
function placed(
  live: ReadonlyArray<HeldCategory>,
  named: (slot: DefaultName, name: string) => boolean,
) {
  const tops = live.flatMap((row) => {
    const slot =
      row.parentId === null
        ? DEFAULT_CATEGORIES[row.kind].find(
            (top) => named(top, row.name) && (top.fallback === true) === row.fallback,
          )
        : undefined;

    return slot === undefined ? [] : [{ row, slot }];
  });

  const slotOfTop = new Map(tops.map((each) => [each.row.id, each.slot]));

  const children = live.flatMap((row) => {
    const parent = row.parentId === null ? undefined : slotOfTop.get(row.parentId);
    const slot = parent?.children.find((child) => named(child, row.name));

    return slot === undefined ? [] : [{ row, slot }];
  });

  return [...tops, ...children];
}

/**
 * The language a user's set was written in, as their categories tell it (#218). The set is written
 * whole in one language (by the migration, at sign-up, or by the administrator's creation), and the
 * user may since have renamed a default to the other language's name: the set's language is the
 * one more of the defaults where the set put them are named in, a name both languages share telling
 * nothing. None when as many are named in each: what the user renamed cannot be told then.
 */
function languageOfSet(live: ReadonlyArray<HeldCategory>): SetLanguage | undefined {
  const inPlace = placed(live, (slot, name) => LANGUAGES.some((each) => slot[each] === name));

  const named = LANGUAGES.map((language) => ({
    language,
    count: inPlace.filter(
      ({ row, slot }) =>
        slot[language] === row.name &&
        LANGUAGES.every((other) => other === language || slot[other] !== row.name),
    ).length,
  })).toSorted((a, b) => b.count - a.count);

  const [first, second] = named;

  return first === undefined || first.count === (second?.count ?? 0) ? undefined : first.language;
}

/**
 * What renames a user's untouched defaults into `language`. A default is untouched while it sits
 * where the set put it, not archived, with the name the set gave it in the language it was written
 * in (`languageOfSet`): a top-level category at the top of its kind (a fallback only as its kind's
 * fallback), a child under an untouched top-level category of the set. What the user renamed (to
 * the other language's name too), moved or archived is theirs, and so are the children of a
 * top-level category they renamed. A name a sibling already holds (letter case aside) is left as
 * it is.
 */
export function renamesInto(
  rows: ReadonlyArray<HeldCategory>,
  language: SetLanguage,
): ReadonlyArray<DefaultRename> {
  const live = rows.filter((row) => !row.archived);
  const written = languageOfSet(live);

  if (written === undefined) {
    return [];
  }

  const untouched = placed(live, (slot, name) => slot[written] === name);

  // The names each set of siblings holds, as the renames change them.
  const siblingsOf = (row: HeldCategory) => `${row.kind}/${row.parentId ?? ""}`;
  const taken = new Map<string, Set<string>>();

  for (const row of rows) {
    const names = taken.get(siblingsOf(row)) ?? new Set<string>();

    names.add(row.name.toLowerCase());
    taken.set(siblingsOf(row), names);
  }

  return untouched.flatMap(({ row, slot }) => {
    const name = slot[language];
    const names = taken.get(siblingsOf(row));

    if (name === row.name || names === undefined) {
      return [];
    }

    // Another sibling of that name: the user's, or a default they renamed so.
    if (name.toLowerCase() !== row.name.toLowerCase() && names.has(name.toLowerCase())) {
      return [];
    }

    names.delete(row.name.toLowerCase());
    names.add(name.toLowerCase());

    return [{ id: row.id, name }];
  });
}

/**
 * Renames `owner`'s untouched defaults into `language` (`renamesInto`), in a transaction of
 * theirs. Their categories are locked first, so that two at once rename once.
 */
export async function renameDefaultsIn(
  transaction: UserTransaction,
  language: SetLanguage,
): Promise<number> {
  const rows = await transaction
    .select({
      id: category.id,
      kind: category.kind,
      parentId: category.parentId,
      name: category.name,
      archivedAt: category.archivedAt,
      fallback: category.isFallback,
    })
    .from(category)
    .orderBy(asc(category.id))
    .for("update");

  const renames = renamesInto(
    rows.map((row) => ({ ...row, archived: row.archivedAt !== null })),
    language,
  );

  for (const rename of renames) {
    await transaction.update(category).set({ name: rename.name }).where(eq(category.id, rename.id));
  }

  return renames.length;
}

/**
 * The first signed-in page of a user whose defaults were never put in their language (a user made
 * before #195, or by the administrator): their untouched defaults are renamed into the language of
 * that page, once. The user is marked in the same transaction, so a second page, at once or later,
 * renames nothing; from then on the names are theirs. Gives how many were renamed, or none when
 * the user was marked already.
 */
export const settleDefaultNames = (
  owner: string,
  language: SetLanguage,
): Effect.Effect<Option.Option<number>, QueryFailed, UserData> =>
  Effect.gen(function* () {
    const userData = yield* UserData;

    return yield* userData.settlingDefaultNames(owner, (transaction) =>
      renameDefaultsIn(transaction, language),
    );
  });

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
      : [
          {
            userId: owner,
            kind: row.kind,
            parentId,
            name: row.name,
            position: row.position,
            operation: operationOfChild(row, language),
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
