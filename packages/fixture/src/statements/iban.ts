/**
 * The two-digit key that ends a French BBAN (RIB), for an account number made of digits only:
 * 97 − ((89 × bank + 15 × branch + 3 × account) mod 97).
 */
export function frenchRibKey(bank: string, branch: string, account: string): string {
  const weighted = 89 * Number(bank) + 15 * Number(branch) + 3 * Number(account);

  return String(97 - (weighted % 97)).padStart(2, "0");
}

/**
 * A made-up IBAN with valid check digits (ISO 13616, mod 97), so that a reader which checks them
 * accepts it. The account behind it does not exist.
 */
export function ibanWithCheckDigits(country: string, bban: string): string {
  const rearranged = `${bban}${country}00`.toUpperCase();
  let remainder = 0;

  for (const character of rearranged) {
    // Letters count as 10 to 35, digits as themselves: one or two digits fed into the remainder.
    const value = Number.parseInt(character, 36);

    remainder = value < 10 ? (remainder * 10 + value) % 97 : (remainder * 100 + value) % 97;
  }

  const check = String(98 - remainder).padStart(2, "0");

  return `${country.toUpperCase()}${check}${bban.toUpperCase()}`;
}
