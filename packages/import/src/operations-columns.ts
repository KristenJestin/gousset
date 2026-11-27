import type { ColumnPlace, OperationsProfile } from "./operations-profile";
import { isPlace } from "./operations-profile";
import { cleanValue } from "./text";

// Where an operations profile's columns stand in a file (README, "Brokers' operations"): at their
// place, or found by their names in its header row, wherever they stand and whatever else stands
// beside them, as a broker's export is.

/** What a row of a broker's operations holds, and where the reader looks for it. */
export type OperationField = keyof OperationsProfile["columns"];

/** Every field, in the order a profile's columns list them. */
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

/** Where each field stands, counted from 1, as the errors and the preview count. */
export type OperationPlaces = { readonly [field in OperationField]?: number };

/** Where a header puts each field, and the first name of a column it lacks, if any. */
export type FoundPlaces = { readonly places: OperationPlaces; readonly missing: string | null };

/** A name as compared: trimmed, lower case, accents and inner spaces gone. */
export function plainName(text: string): string {
  return cleanValue(text)
    .normalize("NFD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll(/\s+/g, " ");
}

/** Whether a profile finds any of its columns by a name: it then reads a header row. */
export function findsColumnsByName(profile: OperationsProfile): boolean {
  return Object.values(profile.columns).some((column) => column !== null && !isPlace(column));
}

/** The first column, counted from 0, whose plain name is one of `names`; -1 when none is. */
function namedIndex(plain: ReadonlyArray<string>, names: ReadonlyArray<string>): number {
  const wanted = new Set(names.map(plainName));

  return plain.findIndex((cell) => wanted.has(cell));
}

/** Where one column stands in the header (counted from 1), `undefined` when it has none. */
function placeIn(column: ColumnPlace, plain: ReadonlyArray<string>): number | undefined {
  if (isPlace(column)) {
    return column;
  }

  if ("names" in column) {
    const at = namedIndex(plain, column.names);

    return at === -1 ? undefined : at + 1;
  }

  const at = namedIndex(plain, column.after);

  // The column after it holds its currency only when it has no name of its own.
  return at !== -1 && plain[at + 1] === "" ? at + 2 : undefined;
}

/**
 * Where a header row puts each of the profile's columns, from the cells as the file writes them;
 * `missing`, the first name of the first column found by name that the profile requires and the
 * header lacks, or `null` when the header has them all.
 */
export function placesIn(profile: OperationsProfile, header: ReadonlyArray<string>): FoundPlaces {
  const plain = header.map(plainName);
  const places: { [field in OperationField]?: number } = {};
  let missing: string | null = null;

  for (const field of FIELDS) {
    const column = profile.columns[field];

    if (column === null) {
      continue;
    }

    const at = placeIn(column, plain);

    if (at !== undefined) {
      places[field] = at;
    } else if (
      missing === null &&
      !isPlace(column) &&
      "names" in column &&
      column.optional !== true
    ) {
      missing = column.names[0] ?? field;
    }
  }

  return { places, missing };
}

/** Whether a header (normalised: lower case, `;` between its cells) names every column required. */
export function namesEveryColumn(profile: OperationsProfile, header: string): boolean {
  return placesIn(profile, header.split(";")).missing === null;
}
