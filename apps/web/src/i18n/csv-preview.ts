import type { CsvReadRefusal } from "@gousset/core/imports";
import type { OperationKind } from "@gousset/import";
import { m } from "@gousset/i18n/messages";
import { getLocale } from "@gousset/i18n/runtime";
import { CSV_FIELDS, OPERATION_FIELDS } from "@gousset/ui/lib/csv-fields";
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
  kind: () => m.importCsvFieldKind(),
  isin: () => m.importCsvFieldIsin(),
  securityName: () => m.importCsvFieldSecurityName(),
  securityCurrency: () => m.importCsvFieldSecurityCurrency(),
  quantity: () => m.importCsvFieldQuantity(),
  unitPrice: () => m.importCsvFieldUnitPrice(),
  fees: () => m.importCsvFieldFees(),
  reference: () => m.importCsvFieldReference(),
  priceCurrency: () => m.importCsvFieldPriceCurrency(),
  value: () => m.importCsvFieldTradeValue(),
  feesCurrency: () => m.importCsvFieldFeesCurrency(),
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
  } satisfies { [Field in (typeof CSV_FIELDS)[number]]: string };
}

/** Each field a column of a broker's operations can hold, by its name in the page's language. */
export function operationFieldNames() {
  return {
    bookedOn: FIELD_NAMES.bookedOn(),
    valueOn: FIELD_NAMES.valueOn(),
    kind: FIELD_NAMES.kind(),
    isin: FIELD_NAMES.isin(),
    securityName: FIELD_NAMES.securityName(),
    securityCurrency: FIELD_NAMES.securityCurrency(),
    quantity: FIELD_NAMES.quantity(),
    unitPrice: FIELD_NAMES.unitPrice(),
    priceCurrency: FIELD_NAMES.priceCurrency(),
    value: FIELD_NAMES.value(),
    fees: FIELD_NAMES.fees(),
    feesCurrency: FIELD_NAMES.feesCurrency(),
    // Signed by its kind, whatever the file writes: not "Amount (signed)" here.
    amount: m.importCsvFieldOperationAmount(),
    // Checked against the account's: Gousset converts no currency.
    currency: m.importCsvFieldOperationCurrency(),
    label: FIELD_NAMES.label(),
    reference: FIELD_NAMES.reference(),
    ignored: FIELD_NAMES.ignored(),
  } satisfies { [Field in (typeof OPERATION_FIELDS)[number]]: string };
}

const KIND_NAMES = {
  deposit: () => m.importOperationKindDeposit(),
  withdrawal: () => m.importOperationKindWithdrawal(),
  purchase: () => m.importOperationKindPurchase(),
  sale: () => m.importOperationKindSale(),
  dividend: () => m.importOperationKindDividend(),
  fee: () => m.importOperationKindFee(),
} satisfies { readonly [Kind in OperationKind]: () => string };

/** A kind of operation by its name in the page's language. */
export function operationKindName(kind: OperationKind): string {
  return KIND_NAMES[kind]();
}

/** A reader's field (`bookedOn`, `debit`) by its name; one it does not know, as it came. */
function fieldName(field: string | null): string {
  const known = [...CSV_FIELDS, ...OPERATION_FIELDS].find((each) => each === field);

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
