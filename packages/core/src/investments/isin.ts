import { Result } from "effect";

import { InvalidIsin } from "./errors";

// An ISIN (ISO 6166): two letters, nine letters or digits, and a check digit. The database checks
// the shape (`security_isin_format`); the check digit is checked here, so that a typo entered by
// hand, or a file's row, is refused rather than made into a security (docs/data-model.md, v0.6).

/** Two letters, nine letters or digits, a digit: what `security_isin_format` checks. */
const ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

/**
 * The check digit of the first eleven characters of an ISIN: each letter read as its number
 * (A = 10 … Z = 35), each digit as itself, then the Luhn sum of those digits, every other one
 * doubled from the rightmost.
 */
export function isinCheckDigit(rest: string): number {
  // An ISIN's characters are ASCII letters and digits, one code unit each.
  const digits = rest
    .split("")
    .map((character) => Number.parseInt(character, 36).toString())
    .join("");

  let sum = 0;

  for (let at = digits.length - 1, doubled = true; at >= 0; at -= 1, doubled = !doubled) {
    const digit = Number(digits.charAt(at)) * (doubled ? 2 : 1);

    sum += digit > 9 ? digit - 9 : digit;
  }

  return (10 - (sum % 10)) % 10;
}

/** An ISIN as written, in any case and with spaces: upper case without them, or `InvalidIsin`. */
export function parseIsin(given: string): Result.Result<string, InvalidIsin> {
  const isin = given.replaceAll(/\s+/g, "").toUpperCase();

  return ISIN.test(isin) && Number(isin.charAt(11)) === isinCheckDigit(isin.slice(0, 11))
    ? Result.succeed(isin)
    : Result.fail(new InvalidIsin({ isin: given }));
}
