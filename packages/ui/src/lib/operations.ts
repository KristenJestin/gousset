// What the operations screen's components share with the page: the shared layout's names, and
// the filters' values with their empty state.

/**
 * The shared layout's name of a line: its row's anchor in `OperationsList` and its open
 * `LineDetail` carry the same, so that the detail grows out of the row and folds back into it
 * (docs/design.md, "Motion").
 */
export function operationLayoutId(id: string) {
  return `operation-line-${id}`;
}

/**
 * The most characters the search's words, and each amount bound, take: the server reads no more,
 * and the fields stop the typing there.
 */
export const MAX_FILTER_TEXT = 200;

/** The operations' filters, as the page keeps them (in its URL, say). */
export type OperationsFilterValues = {
  /** Words to find in the labels; "" for none. */
  search: string;
  /** One account's id; `null` for every account. */
  accountId: string | null;
  /** The first and last days, as ISO dates ("2026-10-01"); `null` for no bound. */
  from: string | null;
  to: string | null;
  /** The amount's bounds as typed ("12.50", "12,50"); "" for none. The page reads them. */
  min: string;
  max: string;
  /** Only the lines held for review. */
  toReview: boolean;
};

/** No filter at all: what "Clear filters" gives back. */
export const NO_OPERATIONS_FILTERS: OperationsFilterValues = {
  search: "",
  accountId: null,
  from: null,
  to: null,
  min: "",
  max: "",
  toReview: false,
};

/** Whether any filter is set, which shows "Clear filters". */
export function hasOperationsFilters(values: OperationsFilterValues) {
  return (
    values.search !== "" ||
    values.accountId !== null ||
    values.from !== null ||
    values.to !== null ||
    values.min !== "" ||
    values.max !== "" ||
    values.toReview
  );
}
