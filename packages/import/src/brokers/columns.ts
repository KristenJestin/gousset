import { cleanValue } from "../text";

// A broker's export whose columns are found by their names (README, "Brokers' operations"), as
// PayPal's activity's are: a header is the broker's when it names every column the layout needs,
// wherever they stand and whatever else stands beside them.

/** What a row of a broker's operations holds, and where the reader looks for it. */
export type OperationField =
  | "bookedOn"
  | "valueOn"
  | "kind"
  | "isin"
  | "securityName"
  | "securityCurrency"
  | "quantity"
  | "unitPrice"
  | "fees"
  | "amount"
  | "label"
  | "reference"
  /** The currency the amount is written in, checked against the account's. */
  | "amountCurrency"
  /** The currency the fees are written in, checked against the account's. */
  | "feesCurrency"
  /** The currency the unit price is written in: another than the account's is read from `value`. */
  | "priceCurrency"
  /** What the trade was worth in the account's currency, fees aside (Degiro's `Value`). */
  | "value";

const FIELDS: ReadonlyArray<OperationField> = [
  "bookedOn",
  "valueOn",
  "kind",
  "isin",
  "securityName",
  "securityCurrency",
  "quantity",
  "unitPrice",
  "fees",
  "amount",
  "label",
  "reference",
  "amountCurrency",
  "feesCurrency",
  "priceCurrency",
  "value",
];

/** Where each field stands in a header, counted from 1, as the errors and the preview count. */
export type OperationPlaces = { readonly [field in OperationField]?: number };

/** Where a header names each field, and the first name of a required field it lacks, if any. */
export type FoundPlaces = { readonly places: OperationPlaces; readonly missing: string | null };

/** How a broker names its columns. */
export type BrokerColumns = {
  /** Each field's names, the first the one its shipped header shows. */
  readonly names: { readonly [field in OperationField]?: ReadonlyArray<string> };
  /** The fields a header must name to be the broker's. */
  readonly required: ReadonlyArray<OperationField>;
  /** A currency written in the column right after another's, which has no name (Degiro). */
  readonly currencyAfter?: { readonly [field in OperationField]?: OperationField };
};

/** A name as compared: trimmed, lower case, accents and inner spaces gone. */
export function plainName(text: string): string {
  return cleanValue(text)
    .normalize("NFD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll(/\s+/g, " ");
}

/**
 * Where a header names each field, the first column of each name; `missing`, the first name of
 * the first required field it lacks, or `null` when it is the broker's.
 */
export function placesIn(broker: BrokerColumns, header: ReadonlyArray<string>): FoundPlaces {
  const plain = header.map(plainName);
  const places: { [field in OperationField]?: number } = {};

  for (const field of FIELDS) {
    const names = new Set((broker.names[field] ?? []).map(plainName));
    const at = plain.findIndex((cell) => names.has(cell));

    if (at !== -1) {
      places[field] = at + 1;
    }
  }

  for (const field of FIELDS) {
    const after = broker.currencyAfter?.[field];
    const at = after === undefined ? undefined : places[after];

    // `at`, counted from 1, is the index of the column after it.
    if (at !== undefined && plain[at] === "") {
      places[field] = at + 1;
    }
  }

  const missing = broker.required.find((field) => places[field] === undefined);

  return {
    places,
    missing: missing === undefined ? null : (broker.names[missing]?.[0] ?? missing),
  };
}

/** Whether a header (normalised: lower case, `;` between its cells) is the broker's. */
export function isBrokerHeader(broker: BrokerColumns, header: string): boolean {
  return placesIn(broker, header.split(";")).missing === null;
}
