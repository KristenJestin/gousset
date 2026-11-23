import type { QueryFailed } from "@gousset/db/user-data";
import { Context } from "effect";
import type { Effect, Result } from "effect";

import type { CategoryNotFound, LineNotFound } from "./errors";

/** An entry's kind, and its category's: money out or money in. */
export type EntryKind = "expense" | "income";

/** What a category is compared with: the six-month average, a fixed amount, or nothing. */
export type Benchmark =
  | { readonly mode: "automatic" }
  /** A fixed amount, in minor units of the user's currency. */
  | { readonly mode: "fixed"; readonly minor: number }
  | { readonly mode: "none" };

/** A category's row, as the logic reads it. */
export type CategoryRecord = {
  readonly id: string;
  /** Null for a top-level category. */
  readonly parentId: string | null;
  readonly kind: EntryKind;
  readonly name: string;
  readonly icon: string | null;
  readonly position: number;
  /** When it was archived, ISO 8601; null while in use. */
  readonly archivedAt: string | null;
  readonly benchmark: Benchmark;
  /** Its kind's fallback, "Other": where an entry goes until it is classified. */
  readonly fallback: boolean;
};

/** A new category: every setting but its id, made by the database. */
export type NewCategory = Omit<CategoryRecord, "id" | "archivedAt">;

/** What an update sets on a category; the rest stays. */
export type CategoryPatch = Partial<
  Pick<CategoryRecord, "name" | "parentId" | "icon" | "position" | "archivedAt" | "benchmark">
>;

/**
 * One step of a change to the categories, applied in order in one transaction: a category made, a
 * category's columns set, every entry of one category moved to another, a category deleted (once
 * nothing uses it: the database refuses it otherwise, at commit).
 */
export type CategoryStep =
  | { readonly step: "insert"; readonly category: NewCategory }
  | { readonly step: "update"; readonly id: string; readonly patch: CategoryPatch }
  | { readonly step: "move_entries"; readonly from: string; readonly into: string }
  | { readonly step: "delete"; readonly id: string };

/** The categories as a change left them, and the ids of those it made, in its steps' order. */
export type CategoryChange = {
  readonly categories: ReadonlyArray<CategoryRecord>;
  readonly inserted: ReadonlyArray<string>;
};

/** How much a category is used: its entries, and their net amount per currency over days. */
export type CategoryUse = {
  readonly categoryId: string;
  /** Every entry of the category's own, whenever it happened. */
  readonly entries: number;
  /**
   * The net amount of its own entries that happened in the range, per currency of their lines'
   * accounts: payments less refunds, in minor units, positive the entry's way.
   */
  readonly net: ReadonlyArray<{ readonly currency: string; readonly minor: number }>;
};

/** A line's category, as a search or a line's detail gives it; null for a line with no entry. */
export type LineCategory = {
  readonly id: string;
  readonly name: string;
  /** Its parent's name, for a child. */
  readonly parentName: string | null;
  readonly kind: EntryKind;
};

/** What a line's classification is decided from, read in the transaction that writes it. */
export type LineEntries = {
  readonly lineId: string;
  readonly amountMinor: number;
  /** The entries the line is a part of. */
  readonly entries: ReadonlyArray<{ readonly id: string; readonly kind: EntryKind }>;
  /** A side of a transfer (#26): it is the transfer, and has no entry. */
  readonly paired: boolean;
  readonly categories: ReadonlyArray<CategoryRecord>;
};

/**
 * Where the categories are read and written. The live layer (`DatabaseCategoryStore`) goes through
 * `UserData`; tests give an in-memory one (`memoryCategoryStore`). What a change may do is decided
 * by the logic (`./categories`), whose `decide` each write calls inside its transaction, on what
 * that transaction read.
 */
export class CategoryStore extends Context.Service<
  CategoryStore,
  {
    /** Every category of the user's, archived ones included. */
    readonly list: (owner: string) => Effect.Effect<ReadonlyArray<CategoryRecord>, QueryFailed>;
    /**
     * Each category's entries, and the net amount of those that happened from `from` to `to`,
     * both included; a category with no entry is left out.
     */
    readonly use: (
      owner: string,
      range: { readonly from: string; readonly to: string },
    ) => Effect.Effect<ReadonlyArray<CategoryUse>, QueryFailed>;
    /** Applies the steps `decide` gives from the user's categories, in one transaction. */
    readonly change: <E>(
      owner: string,
      decide: (
        categories: ReadonlyArray<CategoryRecord>,
      ) => Result.Result<ReadonlyArray<CategoryStep>, E>,
    ) => Effect.Effect<CategoryChange, E | QueryFailed>;
    /**
     * Puts the one entry of a line in the category `decide` gives, as the user's choice
     * (`classified_by = user`), in one transaction. Fails with `LineNotFound` for no line of the
     * user's.
     */
    readonly classifyLine: <E>(
      owner: string,
      lineId: string,
      decide: (
        facts: LineEntries,
      ) => Result.Result<{ readonly entryId: string; readonly categoryId: string }, E>,
    ) => Effect.Effect<LineCategory, E | LineNotFound | CategoryNotFound | QueryFailed>;
  }
>()("@gousset/core/CategoryStore") {}
