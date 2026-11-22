import { describe, expect, test } from "vite-plus/test";

import { INVENTED_IBANS } from "../ibans";
import { exampleStatement } from "./example";
import { frenchRibKey, ibanWithCheckDigits } from "./iban";

describe("ibanWithCheckDigits", () => {
  test("gives the check digits of the repository's invented IBANs", () => {
    expect(ibanWithCheckDigits("FR", "99999000010001234567809")).toBe(INVENTED_IBANS[0]);
    expect(ibanWithCheckDigits("DE", "999999990012345678")).toBe(INVENTED_IBANS[1]);
  });

  // The privacy check refuses any IBAN outside packages/fixture/src/ibans.ts.
  test("gives the example statement one of the invented IBANs", () => {
    expect(INVENTED_IBANS).toContain(exampleStatement.account.iban);
  });

  test("gives the example statement an IBAN that passes the mod 97 check", () => {
    const { iban } = exampleStatement.account;
    const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
    const digits = rearranged.replaceAll(/[A-Z]/g, (letter) => String(Number.parseInt(letter, 36)));

    expect(BigInt(digits) % 97n).toBe(1n);
  });
});

describe("frenchRibKey", () => {
  test("gives the key that makes a French BBAN valid", () => {
    expect(frenchRibKey("99999", "00001", "00012345678")).toBe("09");
  });

  test("ends the example statement's BBAN", () => {
    // The BBAN of a French IBAN: bank (5), branch (5), account (11), key (2).
    const bban = exampleStatement.account.iban.slice(4);
    const sum = 89 * Number(bban.slice(0, 5)) + 15 * Number(bban.slice(5, 10));
    const total = sum + 3 * Number(bban.slice(10, 21)) + Number(bban.slice(21));

    expect(total % 97).toBe(0);
  });
});
