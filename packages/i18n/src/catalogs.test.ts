import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Schema } from "effect";
import { describe, expect, test } from "vite-plus/test";

// The interface is written in English and translated into French from the start: every message
// has its French, with the same inputs. Paraglide would otherwise show the English in silence.
const Catalog = Schema.Record(Schema.String, Schema.String);

function catalog(locale: string) {
  const file = join(import.meta.dirname, "../messages", `${locale}.json`);

  return Schema.decodeUnknownSync(Catalog)(JSON.parse(readFileSync(file, "utf8")));
}

/** The inputs a message takes: `{name}` in "Hello, {name}." */
function inputs(text: string): Array<string> {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? "").toSorted();
}

describe("the messages", () => {
  const english = catalog("en");
  const french = catalog("fr");

  test("every English message has its French, and nothing more", () => {
    expect(Object.keys(french).toSorted()).toEqual(Object.keys(english).toSorted());
  });

  test("each French message takes the same inputs as its English", () => {
    for (const [key, text] of Object.entries(english)) {
      expect(inputs(french[key] ?? ""), key).toEqual(inputs(text));
    }
  });

  test("no message is left empty", () => {
    for (const [key, text] of [...Object.entries(english), ...Object.entries(french)]) {
      expect(text.trim(), key).not.toBe("");
    }
  });
});
