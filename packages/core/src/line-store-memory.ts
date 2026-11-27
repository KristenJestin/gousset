import { Effect, Layer } from "effect";

import type { MemoryImport, MemoryLine, MemoryRows } from "./account-store-memory";
import type { LineCategory } from "./category-store";
import type { ImportFormat } from "./imports/summary";
import { LineStore } from "./line-store";
import type { FoundLine, FoundLineDetail, LineQuery } from "./line-store";
import { subtreeOf } from "./subjects/counting";
import type { SubjectName, SubjectNode } from "./subjects/counting";
import { candidateFinder } from "./transfers/pairing";

// An in-memory `LineStore`, for tests: the same reads as the database's, on the rows an in-memory
// `AccountStore` takes (`MemoryRows`), with what a line's detail adds. A restart forgets them.

/** A line of the memory store, with its detail: manual and with no detail unless said otherwise. */
export type MemoryLineDetail = MemoryLine & {
  readonly source?: FoundLineDetail["source"];
  readonly importId?: string;
  readonly originalAmountMinor?: number;
  readonly originalCurrency?: string;
  readonly counterpartyIban?: string;
  readonly duplicateOfLineId?: string;
  readonly expiresOn?: string;
  /** The category of its one entry. */
  readonly category?: LineCategory;
  /** Who put its entry in its category; `default`, the import, waits for the user. */
  readonly classifiedBy?: "default" | "rule" | "user";
  /** Its part in its entry: `refund` when linked to an expense, whose entry it then follows. */
  readonly role?: "payment" | "refund";
  /** Its entries' subjects (#37). */
  readonly subjects?: ReadonlyArray<SubjectName>;
};

/** An import of the memory store, as a line's detail names it. */
export type MemoryLineImport = MemoryImport & {
  readonly id: string;
  readonly fileName: string;
  readonly format: ImportFormat;
  /** ISO 8601. */
  readonly importedAt: string;
  readonly periodFrom: string | null;
};

/** One user's rows: those of `MemoryRows`, lines and imports with their detail. */
export type MemoryLineRows = Omit<MemoryRows, "lines" | "imports"> & {
  readonly lines?: ReadonlyArray<MemoryLineDetail>;
  readonly imports?: ReadonlyArray<MemoryLineImport>;
  /** The user's subjects, whose tree a search by subject reads (#37). */
  readonly subjects?: ReadonlyArray<SubjectNode>;
};

/** The text a search reads, as the database's (`label || ' ' || coalesce(memo, '') || …`). */
const searchedOf = (line: MemoryLineDetail) =>
  `${line.label} ${line.memo ?? ""} ${line.counterpartyName ?? ""}`.toLowerCase();

/** Newest first: booked on, then id. */
const newestFirst = (a: MemoryLineDetail, b: MemoryLineDetail) =>
  b.bookedOn.localeCompare(a.bookedOn) || b.id.localeCompare(a.id);

function matches(
  line: MemoryLineDetail,
  currency: string,
  query: LineQuery,
  subtree: ReadonlySet<string> | null,
): boolean {
  const { after } = query;
  const absolute = Math.abs(line.amountMinor);
  const bounds = query.amount === null ? undefined : query.amount(currency);

  const state = line.state ?? "counted";

  return (
    (state === query.state ||
      (query.state === "held" &&
        state === "counted" &&
        (query.alsoLineIds.includes(line.id) ||
          (line.classifiedBy === "default" && (line.role ?? "payment") === "payment")))) &&
    line.bookedOn <= query.to &&
    (query.onlyLineIds === undefined || query.onlyLineIds.includes(line.id)) &&
    (query.from === null || line.bookedOn >= query.from) &&
    (query.accountId === null || line.accountId === query.accountId) &&
    (subtree === null || (line.subjects ?? []).some((each) => subtree.has(each.id))) &&
    (query.text === null || searchedOf(line).includes(query.text.toLowerCase())) &&
    (bounds === undefined ||
      (bounds !== null &&
        (bounds.minMinor === null || absolute >= bounds.minMinor) &&
        (bounds.maxMinor === null || absolute <= bounds.maxMinor))) &&
    (after === null ||
      line.bookedOn < after.bookedOn ||
      (line.bookedOn === after.bookedOn && line.id < after.id))
  );
}

/** A counted or held line of `own`'s, with its account; undefined for a discarded one. */
function withAccount(own: MemoryLineRows, line: MemoryLineDetail): FoundLine | undefined {
  const owned = own.accounts?.find((each) => each.id === line.accountId);
  const state = line.state ?? "counted";

  if (owned === undefined || state === "discarded") {
    return undefined;
  }

  return {
    id: line.id,
    bookedOn: line.bookedOn,
    valueOn: line.valueOn,
    label: line.label,
    memo: line.memo,
    counterpartyName: line.counterpartyName,
    amountMinor: line.amountMinor,
    state,
    account: {
      id: owned.id,
      name: owned.name,
      institution: owned.institution,
      currency: owned.currency,
    },
    category: line.category ?? null,
    fromBalance: sourceOf(line) === "balance",
    subjects: line.subjects ?? [],
    // The memory store keeps no subject's payback lines (#217).
    payback: null,
  };
}

function sourceOf(line: MemoryLineDetail): FoundLineDetail["source"] {
  return line.source ?? (line.importId === undefined ? "manual" : "import");
}

/**
 * The counted lines of `own` booked on or before `day` with several candidates for their transfer's
 * other side, by the same rules as the database's. The memory store keeps no transfer: every line
 * is still to review and no side of one.
 */
function severalCandidatesOf(own: MemoryLineRows, day: string): ReadonlyArray<string> {
  const pool = (own.lines ?? []).flatMap((line) => {
    const shown = withAccount(own, line);
    const owned = own.accounts?.find((each) => each.id === line.accountId);

    return shown === undefined ||
      owned === undefined ||
      shown.state !== "counted" ||
      sourceOf(line) === "balance" ||
      line.amountMinor === 0 ||
      line.bookedOn > day
      ? []
      : [{ ...line, accountKind: owned.kind, currency: shown.account.currency }];
  });

  const candidates = candidateFinder(pool);

  return pool.flatMap((line) => (candidates(line).length > 1 ? [line.id] : []));
}

/** A `LineStore` holding each user's rows in memory, `rows` by owner. */
export function memoryLineStore(rows: ReadonlyMap<string, MemoryLineRows> = new Map()) {
  const of = (owner: string): MemoryLineRows => rows.get(owner) ?? {};

  return Layer.sync(LineStore, () => ({
    search: (owner, query) =>
      Effect.sync(() => {
        const own = of(owner);

        const subtree =
          query.subjectId === null ? null : subtreeOf(own.subjects ?? [], query.subjectId);

        const everyMatch = (own.lines ?? [])
          .flatMap((line) => {
            const shown = withAccount(own, line);

            return shown !== undefined &&
              matches(line, shown.account.currency, { ...query, after: null }, subtree)
              ? [{ line, shown }]
              : [];
          })
          .sort((a, b) => newestFirst(a.line, b.line));

        const page = everyMatch
          .filter(({ line, shown }) => matches(line, shown.account.currency, query, subtree))
          .slice(0, query.limit)
          .map(({ shown }) => shown);

        return { lines: page, total: everyMatch.length };
      }),

    show: (owner, lineId, day) =>
      Effect.sync((): FoundLineDetail | undefined => {
        const own = of(owner);
        const line = own.lines?.find((each) => each.id === lineId);
        const shown = line === undefined ? undefined : withAccount(own, line);

        if (line === undefined || shown === undefined || line.bookedOn > day) {
          return undefined;
        }

        const original = own.lines?.find((each) => each.id === line.duplicateOfLineId);

        const originalAccount = own.accounts?.find((each) => each.id === original?.accountId);

        const read = own.imports?.find((each) => each.id === line.importId);

        return {
          ...shown,
          source: sourceOf(line),
          originalAmountMinor: line.originalAmountMinor ?? null,
          originalCurrency: line.originalCurrency ?? null,
          counterpartyIban: line.counterpartyIban ?? null,
          expiresOn: line.expiresOn ?? null,
          // The memory store keeps no receipt (#217): their files are on disk.
          receipts: [],
          duplicateOf:
            original === undefined
              ? null
              : {
                  id: original.id,
                  bookedOn: original.bookedOn,
                  label: original.label,
                  amountMinor: original.amountMinor,
                  currency: originalAccount?.currency ?? shown.account.currency,
                },
          import:
            read === undefined
              ? null
              : {
                  id: read.id,
                  fileName: read.fileName,
                  format: read.format,
                  importedAt: read.importedAt,
                  periodFrom: read.periodFrom,
                  periodTo: read.periodTo,
                },
        };
      }),

    severalCandidates: (owner, day) => Effect.sync(() => severalCandidatesOf(of(owner), day)),
  }));
}
