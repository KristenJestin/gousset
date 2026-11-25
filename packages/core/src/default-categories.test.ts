import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vite-plus/test";

import {
  DEFAULT_CATEGORIES,
  defaultRows,
  renamesInto,
  setLanguageOf,
  setLanguageOfRequest,
} from "./default-categories";
import type { HeldCategory } from "./default-categories";

const MIGRATIONS = fileURLToPath(new URL("../../db/src/migrations/", import.meta.url));

/** The default set as the migration that gave it to every existing user writes it, in English. */
function migrationRows() {
  const [folder] = readdirSync(MIGRATIONS).filter((name) => name.endsWith("_categories_isolation"));
  const text = readFileSync(`${MIGRATIONS}${folder ?? ""}/migration.sql`, "utf8");
  const listed = /-- default set: begin([\s\S]*?)-- default set: end/.exec(text)?.[1] ?? "";
  const quoted = String.raw`'((?:[^']|'')*)'`;

  const row = new RegExp(
    String.raw`\('(expense|income)', (NULL|${quoted}), ${quoted}, (\d+), (true|false)\)`,
    "g",
  );

  return [...listed.matchAll(row)].map((match) => ({
    kind: match[1],
    parent: match[2] === "NULL" ? null : (match[3] ?? "").replaceAll("''", "'"),
    name: (match[4] ?? "").replaceAll("''", "'"),
    position: Number(match[5]),
    fallback: match[6] === "true",
  }));
}

describe("the default set", () => {
  test("the migration gives every existing user the English set of the code", () => {
    expect(migrationRows()).toEqual(defaultRows("en"));
  });

  test("two levels, each kind with one fallback, last, with no child", () => {
    for (const kind of ["expense", "income"] as const) {
      const tops = DEFAULT_CATEGORIES[kind];
      const fallbacks = tops.filter((top) => top.fallback === true);

      expect(fallbacks).toHaveLength(1);
      expect(tops.at(-1)?.fallback).toBe(true);
      expect(fallbacks[0]?.children).toEqual([]);
    }
  });

  test("names are unique among siblings, in each language", () => {
    for (const language of ["en", "fr"] as const) {
      const keys = defaultRows(language).map(
        (row) => `${row.kind}/${row.parent ?? ""}/${row.name.toLowerCase()}`,
      );

      expect(new Set(keys).size, language).toBe(keys.length);
    }
  });
});

describe("the set's language", () => {
  test("French when the browser puts French first, English otherwise", () => {
    expect(setLanguageOf("fr-FR,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(setLanguageOf("FR")).toBe("fr");
    expect(setLanguageOf("en;q=0.5, fr-CA;q=0.9")).toBe("fr");
    expect(setLanguageOf("en-GB,fr;q=0.9")).toBe("en");
    expect(setLanguageOf("de-DE,fr;q=0.5")).toBe("en");
    expect(setLanguageOf("fr;q=0, en")).toBe("en");
    expect(setLanguageOf("*")).toBe("en");
    expect(setLanguageOf(null)).toBe("en");
    expect(setLanguageOf(undefined)).toBe("en");
  });

  test("the language the user chose comes before the browser's", () => {
    expect(setLanguageOfRequest("PARAGLIDE_LOCALE=fr", "en-US,en;q=0.9")).toBe("fr");
    expect(setLanguageOfRequest("theme=dark; PARAGLIDE_LOCALE=en", "fr-FR")).toBe("en");
    expect(setLanguageOfRequest("theme=dark", "fr-FR")).toBe("fr");
    // A cookie naming no language of the set is not a choice: the browser's then.
    expect(setLanguageOfRequest("PARAGLIDE_LOCALE=de", "fr-FR")).toBe("fr");
    expect(setLanguageOfRequest("MY_PARAGLIDE_LOCALE=fr", "en")).toBe("en");
    expect(setLanguageOfRequest(null, null)).toBe("en");
  });
});

/** A user's categories as the set made them in `language`, with ids of their path. */
function heldSet(language: "en" | "fr"): Array<HeldCategory> {
  return defaultRows(language).map((row) => ({
    id: `${row.kind}/${row.parent === null ? "" : `${row.parent}/`}${row.name}`,
    kind: row.kind,
    parentId: row.parent === null ? null : `${row.kind}/${row.parent}`,
    name: row.name,
    archived: false,
    fallback: row.fallback,
  }));
}

const renamed = (rows: ReadonlyArray<HeldCategory>, language: "en" | "fr") =>
  new Map(renamesInto(rows, language).map((each) => [each.id, each.name]));

describe("the untouched defaults, in the user's language", () => {
  test("the English set becomes the French one, the fallbacks included", () => {
    const renames = renamed(heldSet("en"), "fr");

    expect(renames.get("expense/Housing")).toBe("Logement");
    expect(renames.get("expense/Housing/Rent")).toBe("Loyer");
    expect(renames.get("expense/Other")).toBe("Autre");
    expect(renames.get("income/Other")).toBe("Autre");
    // A name the same in both languages has nothing to change.
    expect(renames.has("expense/Eating out/Restaurants")).toBe(false);

    const changed = defaultRows("en").filter(
      (row, index) => row.name !== defaultRows("fr")[index]?.name,
    );

    expect(renames.size).toBe(changed.length);
  });

  test("a set made in French becomes the English one for an English user", () => {
    const renames = renamed(heldSet("fr"), "en");

    expect(renames.get("expense/Logement")).toBe("Housing");
    expect(renames.get("income/Autre")).toBe("Other");
  });

  test("a set already in the user's language has nothing to change", () => {
    expect(renamesInto(heldSet("fr"), "fr")).toEqual([]);
    expect(renamesInto(heldSet("en"), "en")).toEqual([]);
  });

  test("what the user renamed, moved or archived stays as it is", () => {
    const rows = heldSet("en").map((row) => {
      switch (row.id) {
        // Renamed: its children, still under it, are not the set's either.
        case "expense/Housing": {
          return { ...row, name: "Home" };
        }

        // Moved under another top-level category.
        case "expense/Groceries/Bakery": {
          return { ...row, parentId: "expense/Eating out" };
        }

        // A top-level category moved under another.
        case "expense/Health": {
          return { ...row, parentId: "expense/Family" };
        }

        case "expense/Leisure/Travel": {
          return { ...row, archived: true };
        }

        default: {
          return row;
        }
      }
    });

    const renames = renamed(rows, "fr");

    expect(renames.has("expense/Housing")).toBe(false);
    expect(renames.has("expense/Housing/Rent")).toBe(false);
    expect(renames.has("expense/Groceries/Bakery")).toBe(false);
    expect(renames.has("expense/Health")).toBe(false);
    expect(renames.has("expense/Health/Doctor")).toBe(false);
    expect(renames.has("expense/Leisure/Travel")).toBe(false);
    // Their untouched neighbours are renamed.
    expect(renames.get("expense/Groceries")).toBe("Courses");
    expect(renames.get("expense/Leisure/Hobbies")).toBe("Passe-temps");
  });

  test("a name the user already gave a sibling is not taken from them", () => {
    const rows: Array<HeldCategory> = [
      ...heldSet("en"),
      {
        id: "mine",
        kind: "expense",
        parentId: null,
        name: "logement",
        archived: false,
        fallback: false,
      },
    ];

    const renames = renamed(rows, "fr");

    expect(renames.has("expense/Housing")).toBe(false);
    // The children of a parent left in English are still the set's, and renamed.
    expect(renames.get("expense/Housing/Rent")).toBe("Loyer");
  });

  test("a default renamed by hand to the other language's name stays the user's", () => {
    // The English set; the user named a top-level category and a child in French (#218).
    const rows = heldSet("en").map((row) => {
      switch (row.id) {
        case "expense/Groceries": {
          return { ...row, name: "Courses" };
        }

        case "expense/Health/Pharmacy": {
          return { ...row, name: "Pharmacie" };
        }

        default: {
          return row;
        }
      }
    });

    // A first page in English, the set's language: nothing to rename, nothing renamed back.
    expect(renamesInto(rows, "en")).toEqual([]);

    // In French: the user's two kept; the untouched ones renamed, the children of the top-level
    // category the user named in French among them.
    const renames = renamed(rows, "fr");

    expect(renames.has("expense/Groceries")).toBe(false);
    expect(renames.get("expense/Groceries/Supermarket")).toBe("Supermarché");
    expect(renames.has("expense/Health/Pharmacy")).toBe(false);
    expect(renames.get("expense/Health")).toBe("Santé");
    expect(renames.get("expense/Health/Doctor")).toBe("Médecin");
  });

  test("the untouched children of a top-level category the user translated are translated", () => {
    // The English set; the user named Groceries in French before their first page, in French.
    const rows = heldSet("en").map((row) =>
      row.id === "expense/Groceries" ? { ...row, name: "Courses" } : row,
    );

    const renames = renamed(rows, "fr");

    expect(renames.has("expense/Groceries")).toBe(false);
    expect(renames.get("expense/Groceries/Supermarket")).toBe("Supermarché");
    expect(renames.get("expense/Groceries/Market")).toBe("Marché");
    expect(renames.get("expense/Groceries/Bakery")).toBe("Boulangerie");
  });

  test("in a set made in French, a name given in English stays", () => {
    const rows = heldSet("fr").map((row) =>
      row.id === "expense/Logement" ? { ...row, name: "Housing" } : row,
    );

    expect(renamesInto(rows, "fr")).toEqual([]);
    expect(renamed(rows, "en").has("expense/Logement")).toBe(false);
    expect(renamed(rows, "en").get("expense/Courses")).toBe("Groceries");
  });

  test("when the defaults tell no language of the set, nothing is renamed", () => {
    // As many named in English as in French: which ones the user renamed cannot be told.
    const rows = heldSet("en").flatMap((row) => {
      switch (row.id) {
        case "expense/Other": {
          return [row];
        }

        case "income/Other": {
          return [{ ...row, name: "Autre" }];
        }

        default: {
          return [];
        }
      }
    });

    expect(renamesInto(rows, "fr")).toEqual([]);
    expect(renamesInto(rows, "en")).toEqual([]);
  });

  test("a category of the user's own with a default's name is not the fallback", () => {
    const rows = heldSet("en").map((row) =>
      row.id === "expense/Other" ? { ...row, fallback: false } : row,
    );

    expect(renamed(rows, "fr").has("expense/Other")).toBe(false);
  });
});
