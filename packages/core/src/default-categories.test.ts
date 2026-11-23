import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vite-plus/test";

import { DEFAULT_CATEGORIES, defaultRows, setLanguageOf } from "./default-categories";

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
});
