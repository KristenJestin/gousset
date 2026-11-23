import { minorDigits as importMinorDigits } from "@gousset/import";
import { CURRENCY_CODES, minorDigits as uiMinorDigits } from "@gousset/ui/lib/money";
import { describe, expect, test } from "vite-plus/test";

// The web form (packages/ui), the MCP door and the imports must read a currency's minor units the
// same way (docs/data-model.md, "Money"): they share one ISO 4217 table (packages/currency), but
// this proves the promise directly, for every currency the form's Combobox offers.

describe("currency minor units", () => {
  test("the web form and the imports agree, for every currency the form offers", () => {
    for (const currency of CURRENCY_CODES) {
      expect(importMinorDigits(currency), currency).toBe(uiMinorDigits(currency));
    }
  });
});
