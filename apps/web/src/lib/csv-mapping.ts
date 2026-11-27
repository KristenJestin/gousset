import { operationPlaces } from "@gousset/import";
import type { CsvProfile, OperationKind, OperationsProfile } from "@gousset/import";
import type { CsvField } from "@gousset/ui/lib/csv-fields";

// The import screen's CSV preview (#19): a profile as the user makes it there, a list of what each
// column holds (`CsvMapping`) and the file's settings (`CsvSettings`), and back.

/**
 * A profile's settings that its columns do not say, its `layout` among them: PayPal's activity,
 * chosen from the list, still reads its columns by their names once a setting is changed or the
 * profile is saved.
 */
export type CsvFileSettings = Omit<CsvProfile, "version" | "columns">;

/** The settings as the form sends them, each picked from its list or typed. */
export type CsvSettingsForm = {
  readonly separator: string;
  readonly encoding: string;
  readonly skipRows: number;
  readonly headerRow: boolean;
  readonly dateFormat: string;
  readonly decimalMark: string;
};

export const SEPARATORS = [";", ",", "\t", "|"] as const satisfies ReadonlyArray<
  CsvProfile["separator"]
>;

export const ENCODINGS = ["utf8", "windows-1252"] as const satisfies ReadonlyArray<
  CsvProfile["encoding"]
>;

export const DECIMAL_MARKS = [",", "."] as const satisfies ReadonlyArray<CsvProfile["decimalMark"]>;

/** The date formats offered; a profile's own, if another, is offered beside them. */
export const DATE_FORMATS = [
  "DD/MM/YYYY",
  "MM/DD/YYYY",
  "YYYY-MM-DD",
  "DD.MM.YYYY",
  "DD-MM-YYYY",
  "DD/MM/YY",
  "MM/DD/YY",
  "DD.MM.YY",
  "YYYYMMDD",
] as const;

/** The most lines a profile skips (`MAX_SKIP_ROWS` of `@gousset/import`). */
const MAX_SKIP_ROWS = 100;

/** A date format a profile takes, as `@gousset/import`'s `CsvProfile` checks it. */
const DATE_FORMAT =
  /^(?:DD([/. -]?)MM\1(?:YYYY|YY)|MM([/. -]?)DD\2(?:YYYY|YY)|YYYY([/. -]?)MM\3DD)$/;

/** The format with a day in it, as the list of formats shows it: `DD/MM/YYYY` is `03/10/2026`. */
export function dateExample(format: string): string {
  return format.replace("YYYY", "2026").replace("YY", "26").replace("MM", "10").replace("DD", "03");
}

/**
 * A profile that only splits the file (its encoding, separator, lines skipped, header): for the
 * preview's rows while the columns still lack a field. Its columns are never read.
 */
export function splittingProfile(settings: CsvFileSettings): CsvProfile {
  return {
    version: 1,
    ...settings,
    columns: {
      bookedOn: 1,
      valueOn: null,
      amount: { kind: "signed", column: 1 },
      label: 1,
      memo: null,
      bankId: null,
      currency: null,
    },
  };
}

export function settingsOf({
  version: _version,
  columns: _columns,
  ...settings
}: CsvProfile): CsvFileSettings {
  return settings;
}

/**
 * The settings the form sent, each checked against what a profile takes: one that is not (never
 * what the lists offer) keeps its last value, and the lines to skip stay within their bounds.
 */
export function withSettings(settings: CsvFileSettings, form: CsvSettingsForm): CsvFileSettings {
  return {
    ...settings,
    separator: SEPARATORS.find((separator) => separator === form.separator) ?? settings.separator,
    encoding: ENCODINGS.find((encoding) => encoding === form.encoding) ?? settings.encoding,
    skipRows: Math.min(Math.max(Math.trunc(form.skipRows), 0), MAX_SKIP_ROWS),
    headerRow: form.headerRow,
    dateFormat: DATE_FORMAT.test(form.dateFormat) ? form.dateFormat : settings.dateFormat,
    decimalMark: DECIMAL_MARKS.find((mark) => mark === form.decimalMark) ?? settings.decimalMark,
  };
}

/**
 * The settings once the user maps the columns by hand: without a `layout`, which would read the
 * file its own way and leave the mapping shown unread.
 */
export function byHand({ layout: _layout, ...settings }: CsvFileSettings): CsvFileSettings {
  return settings;
}

/**
 * What each column holds under `profile`, from the first: `width` columns at least, more when the
 * profile reads one further right.
 */
export function mappingOf(profile: CsvProfile, width: number): Array<CsvField> {
  const { amount, bookedOn, valueOn, label, memo, bankId, currency } = profile.columns;

  const amounts: Array<[number, CsvField]> =
    amount.kind === "signed"
      ? [[amount.column, "amount"]]
      : [
          [amount.debit, "debit"],
          [amount.credit, "credit"],
        ];

  const held: Array<[number | null, CsvField]> = [
    [bookedOn, "bookedOn"],
    [valueOn, "valueOn"],
    [label, "label"],
    [memo, "memo"],
    [bankId, "bankId"],
    [currency, "currency"],
    ...amounts,
  ];

  const last = Math.max(width, ...held.map(([column]) => column ?? 0));
  const mapping = Array.from({ length: last }, (): CsvField => "ignored");

  for (const [column, field] of held) {
    if (column !== null) {
      mapping[column - 1] = field;
    }
  }

  return mapping;
}

/** The fields a column holding `field` takes from the others: itself, and the amounts it excludes. */
function displaced(field: CsvField): ReadonlyArray<CsvField> {
  switch (field) {
    case "ignored":
      return [];
    case "amount":
      return ["amount", "debit", "credit"];
    case "debit":
    case "credit":
      return [field, "amount"];
    case "bookedOn":
    case "valueOn":
    case "label":
    case "memo":
    case "bankId":
    case "currency":
    case "kind":
    case "isin":
    case "securityName":
    case "securityCurrency":
    case "quantity":
    case "unitPrice":
    case "priceCurrency":
    case "value":
    case "fees":
    case "feesCurrency":
    case "reference":
      return [field];
  }
}

/**
 * The mapping with `column` (counted from 1) holding `field`: a field is held by one column, and a
 * signed amount excludes a debit and a credit, so the column that held it before holds nothing.
 */
export function remap(
  mapping: ReadonlyArray<CsvField>,
  column: number,
  field: CsvField,
): Array<CsvField> {
  const taken = displaced(field);
  const width = Math.max(mapping.length, column);

  return Array.from({ length: width }, (_, index): CsvField => {
    if (index === column - 1) {
      return field;
    }

    const held = mapping[index] ?? "ignored";

    return taken.includes(held) ? "ignored" : held;
  });
}

/**
 * A field a profile cannot do without: a booking date, a label, an amount (or debit and credit); a
 * broker's operations need no label.
 */
export type RequiredField = "bookedOn" | "label" | "amount";

/** The profile the settings and the mapping make, or the fields it still lacks. */
export function profileOf(
  settings: CsvFileSettings,
  mapping: ReadonlyArray<CsvField>,
): { profile: CsvProfile } | { missing: Array<RequiredField> } {
  const columnOf = (field: CsvField) => {
    const index = mapping.indexOf(field);

    return index === -1 ? null : index + 1;
  };

  const bookedOn = columnOf("bookedOn");
  const label = columnOf("label");
  const signed = columnOf("amount");
  const debit = columnOf("debit");
  const credit = columnOf("credit");

  const amount: CsvProfile["columns"]["amount"] | null =
    signed !== null
      ? { kind: "signed", column: signed }
      : debit !== null && credit !== null
        ? { kind: "debit-credit", debit, credit }
        : null;

  if (bookedOn === null || label === null || amount === null) {
    const missing: Array<RequiredField> = [];

    if (bookedOn === null) {
      missing.push("bookedOn");
    }

    if (label === null) {
      missing.push("label");
    }

    if (amount === null) {
      missing.push("amount");
    }

    return { missing };
  }

  return {
    profile: {
      version: 1,
      ...settings,
      columns: {
        bookedOn,
        valueOn: columnOf("valueOn"),
        amount,
        label,
        memo: columnOf("memo"),
        bankId: columnOf("bankId"),
        currency: columnOf("currency"),
      },
    },
  };
}

/** A word of a broker's kind column, and the kind of operation the user says it names. */
export type KindWord = { readonly word: string; readonly kind: OperationKind | null };

/** The column, counted from 1, that holds `field` in the mapping; `null` when none does. */
function placeOf(mapping: ReadonlyArray<CsvField>, field: CsvField): number | null {
  const index = mapping.indexOf(field);

  return index === -1 ? null : index + 1;
}

/**
 * The profile of a broker's operations the settings, the mapping and the kind words make (v0.6), or
 * the fields it still lacks: a day and an amount. `referenceUnique`, the user's word that each row's
 * reference is unique, counts only with a reference column mapped. `labelWithName`: the label is
 * read from the security's name column when no column of its own holds it (`labelWithNameOf`).
 */
export function operationsProfileOf(
  settings: CsvFileSettings,
  mapping: ReadonlyArray<CsvField>,
  words: ReadonlyArray<KindWord>,
  referenceUnique = false,
  labelWithName = false,
): { profile: OperationsProfile } | { missing: Array<RequiredField> } {
  const bookedOn = placeOf(mapping, "bookedOn");
  const amount = placeOf(mapping, "amount");

  if (bookedOn === null || amount === null) {
    const missing: Array<RequiredField> = [];

    if (bookedOn === null) {
      missing.push("bookedOn");
    }

    if (amount === null) {
      missing.push("amount");
    }

    return { missing };
  }

  const { layout: _statementLayout, ...table } = settings;
  const reference = placeOf(mapping, "reference");
  const securityName = placeOf(mapping, "securityName");
  const label = placeOf(mapping, "label") ?? (labelWithName ? securityName : null);

  const profile: OperationsProfile = {
    version: 2,
    reads: "operations",
    ...table,
    columns: {
      bookedOn,
      valueOn: placeOf(mapping, "valueOn"),
      kind: placeOf(mapping, "kind"),
      isin: placeOf(mapping, "isin"),
      securityName,
      // A price is written in its security's currency: one column may say both (Degiro's), and the
      // preview shows it as the price's alone.
      securityCurrency: placeOf(mapping, "securityCurrency") ?? placeOf(mapping, "priceCurrency"),
      quantity: placeOf(mapping, "quantity"),
      unitPrice: placeOf(mapping, "unitPrice"),
      fees: placeOf(mapping, "fees"),
      amount,
      label,
      reference,
      amountCurrency: placeOf(mapping, "currency"),
      feesCurrency: placeOf(mapping, "feesCurrency"),
      priceCurrency: placeOf(mapping, "priceCurrency"),
      value: placeOf(mapping, "value"),
    },
    kinds: words.flatMap(({ word, kind }) => (kind === null ? [] : [{ word, kind }])),
    // Keyed by its reference only when the user says the broker makes it unique; else by content.
    referenceUnique: referenceUnique && reference !== null,
  };

  return { profile };
}

/**
 * A broker's operations profile chosen from the list, read as it is (its columns at their places or
 * found by their names, its words, its description), with the file's settings the form now says.
 */
export function startedOperations(
  profile: OperationsProfile,
  settings: CsvFileSettings,
): OperationsProfile {
  return {
    ...profile,
    separator: settings.separator,
    encoding: settings.encoding,
    skipRows: settings.skipRows,
    headerRow: settings.headerRow,
    dateFormat: settings.dateFormat,
    decimalMark: settings.decimalMark,
  };
}

/** A broker's operations profile's settings, as the form shows them. */
export function operationsSettingsOf(profile: OperationsProfile): CsvFileSettings {
  return {
    separator: profile.separator,
    encoding: profile.encoding,
    skipRows: profile.skipRows,
    headerRow: profile.headerRow,
    dateFormat: profile.dateFormat,
    decimalMark: profile.decimalMark,
  };
}

/**
 * Whether a broker's operations profile reads its label from its security's name column, as
 * Fortuneo's does: the preview shows that column as the name alone, so the profile made from what it
 * shows is told to keep the label there.
 */
export function labelWithNameOf(
  profile: OperationsProfile,
  header: ReadonlyArray<string>,
): boolean {
  const { places } = operationPlaces(profile, header);

  return places.label !== undefined && places.label === places.securityName;
}

/** A place found, or `null` for a field the file has no column for. */
const at = (place: number | undefined) => place ?? null;

/**
 * What each column holds under a broker's operations profile, from the first, as `mappingOf`: a
 * column the profile finds by its name where the preview's `header` names it.
 */
export function operationsMappingOf(
  profile: OperationsProfile,
  width: number,
  header: ReadonlyArray<string>,
): Array<CsvField> {
  const { places } = operationPlaces(profile, header);

  const held: Array<[number | null, CsvField]> = [
    [at(places.bookedOn), "bookedOn"],
    [at(places.valueOn), "valueOn"],
    [at(places.kind), "kind"],
    [at(places.isin), "isin"],
    [at(places.securityName), "securityName"],
    [at(places.securityCurrency), "securityCurrency"],
    [at(places.quantity), "quantity"],
    [at(places.unitPrice), "unitPrice"],
    // Shown over the security's currency when both are one column (Degiro's): a price in another
    // currency is read from the trade's value only when its currency's column says so.
    [at(places.priceCurrency), "priceCurrency"],
    [at(places.value), "value"],
    [at(places.fees), "fees"],
    [at(places.feesCurrency), "feesCurrency"],
    [at(places.amount), "amount"],
    [at(places.amountCurrency), "currency"],
    // A broker's label is often its security's name, in the same column: the name is shown.
    [places.label === places.securityName ? null : at(places.label), "label"],
    [at(places.reference), "reference"],
  ];

  const last = Math.max(width, ...held.map(([column]) => column ?? 0));
  const mapping = Array.from({ length: last }, (): CsvField => "ignored");

  for (const [column, field] of held) {
    if (column !== null) {
      mapping[column - 1] = field;
    }
  }

  return mapping;
}

/**
 * The words of the kind column the user maps: those the profile maps, then those the file's first
 * lines write, then one a test read refused, each once, trimmed, as written the first time.
 */
export function kindWordsOf(
  known: ReadonlyArray<KindWord>,
  seen: ReadonlyArray<string>,
): Array<KindWord> {
  const words: Array<KindWord> = [];
  const met = new Set<string>();

  for (const each of [...known, ...seen.map((word): KindWord => ({ word, kind: null }))]) {
    const word = each.word.trim();
    const plain = word.normalize("NFD").replaceAll(/\p{M}/gu, "").toLowerCase();

    if (word !== "" && !met.has(plain)) {
      met.add(plain);
      words.push({ word, kind: each.kind });
    }
  }

  return words;
}
