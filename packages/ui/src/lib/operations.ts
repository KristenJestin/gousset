// What the operations screen's components share with the page: the filters' values with their
// empty state.

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

/**
 * How many filters a narrow screen folds behind its Filters button are set, the number on that
 * button: the account, the period (one or both days), the amount (one or both bounds) and the
 * lines to review. The search stays in sight beside the button, so it is not counted.
 */
export function foldedFiltersCount(values: OperationsFilterValues) {
  return [
    values.accountId !== null,
    values.from !== null || values.to !== null,
    values.min !== "" || values.max !== "",
    values.toReview,
  ].filter(Boolean).length;
}

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
