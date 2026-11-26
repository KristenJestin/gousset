import type { BrokerLayout, CsvProfile, OperationKind, OperationsProfile } from "@gousset/import";
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
    case "fees":
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
 * the fields it still lacks: a day and an amount. `layout`, for a broker's profile chosen from the
 * list: its columns are then found by their names, as long as the mapping is left as it came.
 */
export function operationsProfileOf(
  settings: CsvFileSettings,
  mapping: ReadonlyArray<CsvField>,
  words: ReadonlyArray<KindWord>,
  layout: BrokerLayout | undefined,
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

  const profile: OperationsProfile = {
    version: 1,
    reads: "operations",
    ...table,
    columns: {
      bookedOn,
      valueOn: placeOf(mapping, "valueOn"),
      kind: placeOf(mapping, "kind"),
      isin: placeOf(mapping, "isin"),
      securityName: placeOf(mapping, "securityName"),
      securityCurrency: placeOf(mapping, "securityCurrency"),
      quantity: placeOf(mapping, "quantity"),
      unitPrice: placeOf(mapping, "unitPrice"),
      fees: placeOf(mapping, "fees"),
      amount,
      label: placeOf(mapping, "label"),
      reference: placeOf(mapping, "reference"),
    },
    kinds: words.flatMap(({ word, kind }) => (kind === null ? [] : [{ word, kind }])),
    // Nothing on the screen says a broker's reference is unique to its row: keyed by content.
    referenceUnique: false,
  };

  return { profile: layout === undefined ? profile : { ...profile, layout } };
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

/** What each column holds under a broker's operations profile, from the first, as `mappingOf`. */
export function operationsMappingOf(profile: OperationsProfile, width: number): Array<CsvField> {
  const { columns } = profile;

  const held: Array<[number | null, CsvField]> = [
    [columns.bookedOn, "bookedOn"],
    [columns.valueOn, "valueOn"],
    [columns.kind, "kind"],
    [columns.isin, "isin"],
    [columns.securityName, "securityName"],
    [columns.securityCurrency, "securityCurrency"],
    [columns.quantity, "quantity"],
    [columns.unitPrice, "unitPrice"],
    [columns.fees, "fees"],
    [columns.amount, "amount"],
    // A broker's label is often its security's name, in the same column: the name is shown.
    [columns.label === columns.securityName ? null : columns.label, "label"],
    [columns.reference, "reference"],
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
