// ISO 4217, the one source both the web form (packages/ui), the MCP door and the imports read: an
// amount's minor units, and the codes a person can choose an account's currency from. CLDR (Intl's
// own figures) disagrees with ISO 4217 for a few codes (IQD, ALL): ISO 4217's is the one Gousset
// banks on, since that is what a bank statement writes.

// ISO 4217's minor units, where they are not two.
const NO_MINOR_UNIT = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "UYI",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

const THREE_MINOR_DIGITS = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

const FOUR_MINOR_DIGITS = new Set(["CLF", "UYW"]);

/**
 * How many minor units a currency has, as ISO 4217 gives them: EUR 2, JPY 0, KWD 3. A currency
 * this does not recognise (malformed, or simply not one of these) is taken as 2: never throws, so
 * a stray value never loses a page or a render.
 */
export function minorDigits(currency: string): number {
  if (NO_MINOR_UNIT.has(currency)) {
    return 0;
  }

  if (THREE_MINOR_DIGITS.has(currency)) {
    return 3;
  }

  return FOUR_MINOR_DIGITS.has(currency) ? 4 : 2;
}

/**
 * The ISO 4217 codes an account's currency is chosen from, sorted: every currency actively held in
 * an everyday account, not the inflation-indexed units (CLF, UYW) or the metals, which `minorDigits`
 * still recognises but nobody opens an account in.
 */
export const CURRENCY_CODES: ReadonlyArray<string> = [
  "AED",
  "AFN",
  "ALL",
  "AMD",
  "ANG",
  "AOA",
  "ARS",
  "AUD",
  "AWG",
  "AZN",
  "BAM",
  "BBD",
  "BDT",
  "BGN",
  "BHD",
  "BIF",
  "BMD",
  "BND",
  "BOB",
  "BRL",
  "BSD",
  "BTN",
  "BWP",
  "BYN",
  "BZD",
  "CAD",
  "CDF",
  "CHF",
  "CLP",
  "CNY",
  "COP",
  "CRC",
  "CUP",
  "CVE",
  "CZK",
  "DJF",
  "DKK",
  "DOP",
  "DZD",
  "EGP",
  "ERN",
  "ETB",
  "EUR",
  "FJD",
  "FKP",
  "GBP",
  "GEL",
  "GHS",
  "GIP",
  "GMD",
  "GNF",
  "GTQ",
  "GYD",
  "HKD",
  "HNL",
  "HTG",
  "HUF",
  "IDR",
  "ILS",
  "INR",
  "IQD",
  "IRR",
  "ISK",
  "JMD",
  "JOD",
  "JPY",
  "KES",
  "KGS",
  "KHR",
  "KMF",
  "KPW",
  "KRW",
  "KWD",
  "KYD",
  "KZT",
  "LAK",
  "LBP",
  "LKR",
  "LRD",
  "LSL",
  "LYD",
  "MAD",
  "MDL",
  "MGA",
  "MKD",
  "MMK",
  "MNT",
  "MOP",
  "MRU",
  "MUR",
  "MVR",
  "MWK",
  "MXN",
  "MYR",
  "MZN",
  "NAD",
  "NGN",
  "NIO",
  "NOK",
  "NPR",
  "NZD",
  "OMR",
  "PAB",
  "PEN",
  "PGK",
  "PHP",
  "PKR",
  "PLN",
  "PYG",
  "QAR",
  "RON",
  "RSD",
  "RUB",
  "RWF",
  "SAR",
  "SBD",
  "SCR",
  "SDG",
  "SEK",
  "SGD",
  "SHP",
  "SLE",
  "SOS",
  "SRD",
  "SSP",
  "STN",
  "SYP",
  "SZL",
  "THB",
  "TJS",
  "TMT",
  "TND",
  "TOP",
  "TRY",
  "TTD",
  "TWD",
  "TZS",
  "UAH",
  "UGX",
  "USD",
  "UYU",
  "UZS",
  "VES",
  "VND",
  "VUV",
  "WST",
  "XAF",
  "XCD",
  "XOF",
  "XPF",
  "YER",
  "ZAR",
  "ZMW",
  "ZWL",
];

/** Whether `currency` is one of `CURRENCY_CODES`, upper case and all. */
export function isKnownCurrency(currency: string): boolean {
  return CURRENCY_CODES.includes(currency);
}
