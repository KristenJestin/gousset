import type { QueryFailed } from "@gousset/db/user-data";
import { Context } from "effect";
import type { Effect } from "effect";

import type { ImportFormat } from "./imports/summary";

/**
 * The bounds of a line's absolute amount, in minor units of one currency, both included: null for
 * no bound on that side. A search whose bounds no amount of a currency can meet (a yen amount
 * between 12.5 and 12.7) gives `null` for it, and that currency's lines match nothing.
 */
export type AmountBounds = { readonly minMinor: number | null; readonly maxMinor: number | null };

/** What a search reads, checked by the logic (`./lines`). */
export type LineQuery = {
  /** A substring of the label, memo and counterparty's name, any case; null for none. */
  readonly text: string | null;
  /** Null for every account. */
  readonly accountId: string | null;
  /** Booked on or after this day; null for no start. */
  readonly from: string | null;
  /** Booked on or before this day: never after today. */
  readonly to: string;
  /** The amount's bounds in each currency; null for none. */
  readonly amount: ((currency: string) => AmountBounds | null) | null;
  /** `held` lines only (to review), or `counted` only; never `discarded`. */
  readonly state: "counted" | "held";
  /** Lines strictly older than this one in the order (booked on, then id). */
  readonly after: { readonly bookedOn: string; readonly id: string } | null;
  /** How many lines to give at most. */
  readonly limit: number;
};

/** A line as a search finds it, with its account. */
export type FoundLine = {
  readonly id: string;
  readonly bookedOn: string;
  readonly valueOn: string | null;
  readonly label: string;
  readonly memo: string | null;
  readonly counterpartyName: string | null;
  readonly amountMinor: number;
  readonly state: "counted" | "held";
  readonly account: {
    readonly id: string;
    readonly name: string;
    readonly institution: string | null;
    readonly currency: string;
  };
};

/** A line with all that its detail shows. */
export type FoundLineDetail = FoundLine & {
  readonly source: "import" | "manual" | "balance" | "counterpart";
  readonly originalAmountMinor: number | null;
  readonly originalCurrency: string | null;
  readonly counterpartyIban: string | null;
  readonly expiresOn: string | null;
  /** A held line: the line it looks like, with its account's currency. */
  readonly duplicateOf: {
    readonly id: string;
    readonly bookedOn: string;
    readonly label: string;
    readonly amountMinor: number;
    readonly currency: string;
  } | null;
  readonly import: {
    readonly id: string;
    readonly fileName: string;
    readonly format: ImportFormat;
    /** When the file was dropped, ISO 8601. */
    readonly importedAt: string;
    readonly periodFrom: string | null;
    readonly periodTo: string | null;
  } | null;
};

/**
 * Where every line of the user's is searched and read, across accounts. The live layer
 * (`DatabaseLineStore`) goes through `UserData`; tests give an in-memory one (`memoryLineStore`).
 * It reads only; what a search means is decided by the logic (`./lines`).
 */
export class LineStore extends Context.Service<
  LineStore,
  {
    /**
     * Up to `limit` lines that match, newest first (booked on, then id), older than `after` when
     * given, and how many match in all, whatever the page.
     */
    readonly search: (
      owner: string,
      query: LineQuery,
    ) => Effect.Effect<
      { readonly lines: ReadonlyArray<FoundLine>; readonly total: number },
      QueryFailed
    >;
    /**
     * One counted or held line booked on or before `day`, with its detail; undefined for any
     * other (another user's, a discarded one, an id that is no uuid).
     */
    readonly show: (
      owner: string,
      lineId: string,
      day: string,
    ) => Effect.Effect<FoundLineDetail | undefined, QueryFailed>;
  }
>()("@gousset/core/LineStore") {}
