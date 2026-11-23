import { AccountId, Day } from "@gousset/core/account-values";
import { MAX_FILTER_TEXT } from "@gousset/ui/lib/operations";
import type { OperationsFilterValues } from "@gousset/ui/lib/operations";
import { Effect, Option, Schema, SchemaGetter } from "effect";

import type { LineFilters } from "@/queries/line-keys";

import { Month } from "./month";

/** A line's id, as the database makes them. */
export const LineId = Schema.String.check(
  Schema.isUUID(undefined, { message: "A line is named by its id, a UUID." }),
);

/**
 * A value of the address read with `schema`, or dropped when it cannot be: anyone may type an
 * address, and a wrong piece of it opens the page without that filter rather than failing it.
 */
const forgiving = <S extends Schema.Top>(schema: S) =>
  Schema.optional(
    Schema.UndefinedOr(schema).pipe(
      Schema.catchDecoding(() => Effect.succeed(Option.some(undefined))),
    ),
  );

/** Text cut to what the server reads: a longer address opens the page with its first part. */
const Cut = Schema.String.pipe(
  Schema.decode({
    decode: SchemaGetter.transform((text: string) => text.slice(0, MAX_FILTER_TEXT)),
    encode: SchemaGetter.transform((text: string) => text),
  }),
);

/**
 * Words and amounts as the address gives them back: the router reads `?min=12.5` as a number and
 * `?q=lunch` as a string; both are the text the user typed.
 */
const Typed = Schema.Union([Cut, Schema.Finite]);

/**
 * The operations page's address: its filters, and the open line, so that an address opens the
 * same list and the same line. `month` is the older address of a month's operations
 * (`?month=2026-10`, which the review links to), read as that month's first to last day.
 */
export const OperationsSearch = Schema.Struct({
  q: forgiving(Typed),
  account: forgiving(AccountId),
  from: forgiving(Day),
  to: forgiving(Day),
  min: forgiving(Typed),
  max: forgiving(Typed),
  review: forgiving(Schema.Boolean),
  line: forgiving(LineId),
  month: forgiving(Month),
});

export type OperationsSearch = typeof OperationsSearch.Type;

const textOf = (value: string | number | undefined) => (value === undefined ? "" : String(value));

/** The last day of a month (`2025-02` gives `2025-02-28`). */
function lastDayOf(month: string): string {
  const year = Number(month.slice(0, 4));
  const number = Number(month.slice(5, 7));
  // Day 0 of the next month is this month's last.
  const days = new Date(Date.UTC(year, number, 0)).getUTCDate();

  return `${month}-${String(days).padStart(2, "0")}`;
}

/** The filters an address sets, as the filter bar shows them. */
export function filtersOf(search: OperationsSearch): OperationsFilterValues {
  // The older address names a month only, and only when it names no day of its own.
  const month = search.from === undefined && search.to === undefined ? search.month : undefined;

  return {
    search: textOf(search.q),
    accountId: search.account ?? null,
    from: search.from ?? (month === undefined ? null : `${month}-01`),
    to: search.to ?? (month === undefined ? null : lastDayOf(month)),
    min: textOf(search.min),
    max: textOf(search.max),
    toReview: search.review === true,
  };
}

const blankAsNone = (text: string) => (text.trim() === "" ? undefined : text);

/** The address of the filters, with the line `line` open; what is not set is left out. */
export function searchOf(
  values: OperationsFilterValues,
  line: string | undefined,
): OperationsSearch {
  return {
    q: blankAsNone(values.search),
    account: values.accountId ?? undefined,
    from: values.from ?? undefined,
    to: values.to ?? undefined,
    min: blankAsNone(values.min),
    max: blankAsNone(values.max),
    review: values.toReview ? true : undefined,
    line,
  };
}

/** The search the server runs for the filters. */
export function lineFiltersOf(values: OperationsFilterValues): LineFilters {
  return {
    text: blankAsNone(values.search),
    accountId: values.accountId ?? undefined,
    from: values.from ?? undefined,
    to: values.to ?? undefined,
    amountMin: blankAsNone(values.min),
    amountMax: blankAsNone(values.max),
    toReview: values.toReview ? true : undefined,
  };
}

/** One text for a set of filters, the same for the same filters whatever made them. */
export function filtersKey(values: OperationsFilterValues): string {
  return JSON.stringify([
    values.search,
    values.accountId,
    values.from,
    values.to,
    values.min,
    values.max,
    values.toReview,
  ]);
}
