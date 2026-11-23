import type { CsvProfile } from "@gousset/import";
import type { CsvField } from "@gousset/ui/lib/csv-fields";

// The import screen's CSV preview (#19): a profile as the user makes it there, a list of what each
// column holds (`CsvMapping`) and the file's settings (`CsvSettings`), and back.

/** A profile's settings that its columns do not say. */
export type CsvFileSettings = Pick<
  CsvProfile,
  "separator" | "encoding" | "skipRows" | "headerRow" | "dateFormat" | "decimalMark"
>;

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

export function settingsOf(profile: CsvProfile): CsvFileSettings {
  const { separator, encoding, skipRows, headerRow, dateFormat, decimalMark } = profile;

  return { separator, encoding, skipRows, headerRow, dateFormat, decimalMark };
}

/**
 * The settings the form sent, each checked against what a profile takes: one that is not (never
 * what the lists offer) keeps its last value, and the lines to skip stay within their bounds.
 */
export function withSettings(settings: CsvFileSettings, form: CsvSettingsForm): CsvFileSettings {
  return {
    separator: SEPARATORS.find((separator) => separator === form.separator) ?? settings.separator,
    encoding: ENCODINGS.find((encoding) => encoding === form.encoding) ?? settings.encoding,
    skipRows: Math.min(Math.max(Math.trunc(form.skipRows), 0), MAX_SKIP_ROWS),
    headerRow: form.headerRow,
    dateFormat: DATE_FORMAT.test(form.dateFormat) ? form.dateFormat : settings.dateFormat,
    decimalMark: DECIMAL_MARKS.find((mark) => mark === form.decimalMark) ?? settings.decimalMark,
  };
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

/** A field a profile cannot do without: a booking date, a label, an amount (or debit and credit). */
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
