import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vite-plus/test";

import { isCategoryColor, isCategoryIcon } from "./category-looks";
import { DEFAULT_CATEGORIES, defaultRows, setLanguageOf } from "./default-categories";

const MIGRATIONS = fileURLToPath(new URL("../../db/src/migrations/", import.meta.url));

const QUOTED = String.raw`'((?:[^']|'')*)'`;

/** A migration's SQL, by the end of its folder's name. */
function migration(ending: string): string {
  const [folder] = readdirSync(MIGRATIONS).filter((name) => name.endsWith(ending));

  return readFileSync(`${MIGRATIONS}${folder ?? ""}/migration.sql`, "utf8");
}

const unquote = (text: string | undefined) => (text ?? "").replaceAll("''", "'");

/** The icons and colours the migration gives to the set a user left as it was (#205). */
function looksRows() {
  const listed =
    /-- default looks: begin([\s\S]*?)-- default looks: end/.exec(
      migration("_default_category_looks"),
    )?.[1] ?? "";

  const row = new RegExp(
    String.raw`\('(expense|income)', (NULL|${QUOTED}), ${QUOTED}, ${QUOTED}, (NULL|${QUOTED})\)`,
    "g",
  );

  return [...listed.matchAll(row)].map((match) => ({
    kind: match[1],
    parent: match[2] === "NULL" ? null : unquote(match[3]),
    name: unquote(match[4]),
    icon: match[5],
    color: match[6] === "NULL" ? null : match[7],
  }));
}

/** The default set as the migration that gave it to every existing user writes it, in English. */
function migrationRows() {
  const text = migration("_categories_isolation");
  const listed = /-- default set: begin([\s\S]*?)-- default set: end/.exec(text)?.[1] ?? "";
  const quoted = QUOTED;

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
    expect(migrationRows()).toEqual(
      defaultRows("en").map(({ kind, parent, name, position, fallback }) => ({
        kind,
        parent,
        name,
        position,
        fallback,
      })),
    );
  });

  test("the update gives the icons and colours of the code to the set in both languages", () => {
    expect(looksRows()).toEqual(
      (["en", "fr"] as const).flatMap((language) =>
        defaultRows(language).map(({ kind, parent, name, icon, color }) => ({
          kind,
          parent,
          name,
          icon,
          color,
        })),
      ),
    );
  });

  test("each category has an icon, each top-level one a colour its children take", () => {
    for (const language of ["en", "fr"] as const) {
      for (const row of defaultRows(language)) {
        expect(isCategoryIcon(row.icon), row.name).toBe(true);
        expect(
          row.color === null ? row.parent !== null : isCategoryColor(row.color),
          row.name,
        ).toBe(true);
      }
    }
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
});
