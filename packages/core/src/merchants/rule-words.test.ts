import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

import { MAX_LABEL_TEXT } from "../rules/conditions";
import { isKnownIntermediary } from "./intermediaries";
import { ruleWords } from "./rule-words";

// Every label, shop and person here is invented.

describe("the known intermediaries", () => {
  test("are recognised by their cleaned label, letters and digits only", () => {
    for (const key of ["PAYPAL", "LYDIA", "SUMUP", "IZETTLE", "STRIPE", "KLARNA", "TWINT"]) {
      expect(isKnownIntermediary(key), key).toBe(true);
    }

    expect(isKnownIntermediary("PAY PAL")).toBe(true);
  });

  test("never by a prefix: a cleaned label that goes on names someone else", () => {
    expect(isKnownIntermediary("LYDIA MARTIN")).toBe(false);
    expect(isKnownIntermediary("PAYPAL EUROPE")).toBe(false);
    expect(isKnownIntermediary("PAYLINK")).toBe(false);
    expect(isKnownIntermediary("GREENMARKET")).toBe(false);
  });
});

describe("the words a rule born from a line looks for", () => {
  const CASES: ReadonlyArray<readonly [string, string, string | null, boolean, string | null]> = [
    [
      "a normal line: its cleaned label",
      "CB GREENMARKET 2110 RIVERTON",
      null,
      false,
      "GREENMARKET",
    ],
    [
      "a normal line whose cleaned label is not in it: the label",
      "CB PÂTISSERIE DU MARCHÉ 31/10",
      null,
      false,
      "CB PÂTISSERIE DU MARCHÉ 31/10",
    ],
    [
      "an intermediary: its name through the name after it",
      "CB PAYPAL *PIXELPLAY 21/10",
      null,
      true,
      "PAYPAL *PIXELPLAY",
    ],
    [
      "an intermediary, in lower case",
      "Paypal *Pixelplay Games 04/11 Riverton",
      null,
      true,
      "PAYPAL *PIXELPLAY GAMES",
    ],
    [
      "an intermediary the user marked",
      "PAYLINK *CORNER CAFE 0311",
      null,
      true,
      "PAYLINK *CORNER CAFE",
    ],
    ["an intermediary with nothing after it: none", " PAYPAL 21/10 ", null, true, null],
    ["an intermediary alone: none", "PAYPAL", null, true, null],
    ["an intermediary after a payment word: none", "CB PAYPAL", null, true, null],
    [
      "an intermediary followed by its own company's legal form: none",
      "PRLV SEPA PAYPAL EUROPE SARL",
      null,
      true,
      null,
    ],
    [
      "an intermediary's legal form, then who was paid",
      "PAYPAL EUROPE SARL *PIXELPLAY 21/10",
      null,
      true,
      "PAYPAL EUROPE SARL *PIXELPLAY",
    ],
    ["a normal line naming no one: the label", " 21/10 X1234 ", null, false, "21/10 X1234"],
    [
      "an intermediary named by the counterparty: found in the label",
      "PAYPAL *PIXELPLAY 21/10",
      "PayPal Europe",
      true,
      "PAYPAL *PIXELPLAY",
    ],
  ];

  for (const [name, label, counterparty, intermediary, words] of CASES) {
    test(name, () => {
      expect(ruleWords(label, counterparty, intermediary)).toBe(words);
    });
  }

  test("never says the intermediary alone", () => {
    expect(ruleWords("CB PAYPAL *PIXELPLAY 21/10", null, true)).not.toBe("PAYPAL");
  });

  test("are cut to what a condition holds", () => {
    const long = `PAYPAL *${"PIXELPLAY ".repeat(40)}`;

    expect(ruleWords(long, null, true)?.length).toBeLessThanOrEqual(MAX_LABEL_TEXT);
    expect(ruleWords(long, null, false)?.length).toBeLessThanOrEqual(MAX_LABEL_TEXT);
  });

  test("are found in the label, in any case, whatever it holds", () => {
    const tokens = fc.constantFrom(
      "CB",
      "PAYPAL",
      "PayPal",
      "LYDIA",
      "*",
      " *",
      "PIXELPLAY",
      "Café",
      "ŒUVRE",
      "straße",
      "21/10",
      "2110",
      "X1234",
      "-",
      "//",
      "EUR 23,40",
      "",
    );

    const labels = fc.oneof(
      fc.string(),
      fc.string({ unit: "binary" }),
      fc.array(tokens, { maxLength: 10 }).map((words) => words.join(" ")),
      fc.array(tokens, { maxLength: 10 }).map((words) => words.join("")),
    );

    fc.assert(
      fc.property(labels, fc.option(labels), fc.boolean(), (label, counterparty, intermediary) => {
        const words = ruleWords(label, counterparty, intermediary);

        // Only an intermediary's line may have none: a rule is then not proposed.
        expect(words !== null || intermediary).toBe(true);
        expect(label.toUpperCase()).toContain((words ?? "").toUpperCase());
        expect((words ?? "").length).toBeLessThanOrEqual(MAX_LABEL_TEXT);
      }),
    );
  });
});
