import type { CsvReadRefusal } from "@gousset/core/imports";
import { m } from "@gousset/i18n/messages";
import { getLocale } from "@gousset/i18n/runtime";
import { CSV_FIELDS } from "@gousset/ui/lib/csv-fields";
import type { CsvField } from "@gousset/ui/lib/csv-fields";

import type { RequiredField } from "@/lib/csv-mapping";

import { importFailureMessage } from "./imports";

// The words of the import screen's CSV preview (#19): what a column holds, and why a test read
// refused the file, naming its line and column.

const FIELD_NAMES = {
  bookedOn: () => m.importCsvFieldBookedOn(),
  valueOn: () => m.importCsvFieldValueOn(),
  label: () => m.importCsvFieldLabel(),
  memo: () => m.importCsvFieldMemo(),
  amount: () => m.importCsvFieldAmount(),
  debit: () => m.importCsvFieldDebit(),
  credit: () => m.importCsvFieldCredit(),
  bankId: () => m.importCsvFieldBankId(),
  currency: () => m.importCsvFieldCurrency(),
  ignored: () => m.importCsvFieldIgnored(),
} satisfies { readonly [Field in CsvField]: () => string };

/** Each field a column can hold, by its name in the page's language. */
export function csvFieldNames() {
  return {
    bookedOn: FIELD_NAMES.bookedOn(),
    valueOn: FIELD_NAMES.valueOn(),
    label: FIELD_NAMES.label(),
    memo: FIELD_NAMES.memo(),
    amount: FIELD_NAMES.amount(),
    debit: FIELD_NAMES.debit(),
    credit: FIELD_NAMES.credit(),
    bankId: FIELD_NAMES.bankId(),
    currency: FIELD_NAMES.currency(),
    ignored: FIELD_NAMES.ignored(),
  } satisfies { [Field in CsvField]: string };
}

/** A reader's field (`bookedOn`, `debit`) by its name; one it does not know, as it came. */
function fieldName(field: string | null): string {
  const known = CSV_FIELDS.find((each) => each === field);

  return known === undefined ? (field ?? "") : FIELD_NAMES[known]();
}

const lists = new Map<string, Intl.ListFormat>();

/** What a profile still lacks, in a sentence: "Say which column holds: Label and …". */
export function missingMessage(missing: ReadonlyArray<RequiredField>): string {
  const names = missing.map((field) =>
    field === "amount" ? m.importCsvMissingAmount() : FIELD_NAMES[field](),
  );

  const locale = getLocale();
  const list = lists.get(locale) ?? new Intl.ListFormat(locale, { type: "conjunction" });

  lists.set(locale, list);

  return m.importCsvMissing({ fields: list.format(names) });
}

/** Why a test read refused the file, naming the line and the column where the reader says them. */
export function csvRefusalMessage(refusal: CsvReadRefusal): string {
  const { line, column, field, text } = refusal;

  if (line === null) {
    return importFailureMessage(refusal.error);
  }

  switch (refusal.error) {
    case "MalformedFile":
      return m.importCsvRefusedTable({ line });
    case "InvalidField":
      return column === null
        ? m.importCsvRefusedLine({ line, problem: importFailureMessage(refusal.error) })
        : m.importCsvRefusedValue({ line, column, text: text ?? "", field: fieldName(field) });
    case "MissingField":
      return column === null
        ? m.importCsvRefusedLine({ line, problem: importFailureMessage(refusal.error) })
        : m.importCsvRefusedEmpty({ line, column, field: fieldName(field) });
    case "NotAStatement":
    case "UnsupportedContent":
    case "InvalidOption":
      return column === null
        ? m.importCsvRefusedLine({ line, problem: importFailureMessage(refusal.error) })
        : m.importCsvRefusedCell({ line, column, problem: importFailureMessage(refusal.error) });
  }
}
