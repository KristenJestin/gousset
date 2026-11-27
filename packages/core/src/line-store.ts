import type { QueryFailed } from "@gousset/db/user-data";
import { Context } from "effect";
import type { Effect } from "effect";

import type { Receipt } from "./attachments/attachments";
import type { LineCategory } from "./category-store";
import type { ImportFormat } from "./imports/summary";
import type { SubjectName } from "./subjects/counting";

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
  /**
   * The lines of an expense attached to this subject or to any of its descendants (#37); null for
   * any line. An id that names none of the user's subjects gives no line.
   */
  readonly subjectId: string | null;
  /** Booked on or after this day; null for no start. */
  readonly from: string | null;
  /** Booked on or before this day: never after today. */
  readonly to: string;
  /** The amount's bounds in each currency; null for none. */
  readonly amount: ((currency: string) => AmountBounds | null) | null;
  /**
   * `held` lines (to review), or `counted` only; never `discarded`. With `held`, the counted lines
   * whose entry is still where the import put it (`classified_by = default`, #23) match too, but a
   * noted balance's movement in its account's own category (#31): the user chose it there.
   */
  readonly state: "counted" | "held";
  /** With `held`: these counted lines match too (a transfer's side to choose, #26). */
  readonly alsoLineIds: ReadonlyArray<string>;
  /** These lines only, when given: whether one line is among those a search gives (#35). */
  readonly onlyLineIds?: ReadonlyArray<string>;
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
  /** The category of its one entry; null for a line with none (held, of no amount) or split. */
  readonly category: LineCategory | null;
  /** The movement a noted balance makes (#31): it has no label, the interface names it. */
  readonly fromBalance: boolean;
  /** Its entries' subjects (#37), each once, by name: none for most lines. */
  readonly subjects: ReadonlyArray<SubjectName>;
  /** The subject it pays back (#217), which classifies it: it has no entry then; null for most. */
  readonly payback: SubjectName | null;
};

/** A line with all that its detail shows. */
export type FoundLineDetail = FoundLine & {
  readonly source: "import" | "manual" | "balance" | "counterpart";
  readonly originalAmountMinor: number | null;
  readonly originalCurrency: string | null;
  readonly counterpartyIban: string | null;
  readonly expiresOn: string | null;
  /** Its receipts (#217), the first attached first: none for most lines. */
  readonly receipts: ReadonlyArray<Receipt>;
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
    /**
     * The counted lines booked on or before `day`, still to review and no side of a transfer, that
     * have several lines that may be their transfer's other side (#26): they wait for the user.
     */
    readonly severalCandidates: (
      owner: string,
      day: string,
    ) => Effect.Effect<ReadonlyArray<string>, QueryFailed>;
  }
>()("@gousset/core/LineStore") {}
