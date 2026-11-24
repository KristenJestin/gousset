import type { QueryFailed } from "@gousset/db/user-data";
import { Effect } from "effect";

import { listAccounts } from "./accounts";
import { Imports } from "./imports/imports";
import type { ImportSummary } from "./imports/summary";
import { searchLines } from "./lines";

// What the review shows until it reads the user's own lines (#126): their own counts on the
// screens that work today. Counts only, never a figure of the month.

export type StartingPoints = {
  /** The user's open accounts. */
  readonly accounts: number;
  /** The day the user's last finished import ended, `YYYY-MM-DD` (UTC); `null` before the first. */
  readonly lastImportOn: string | null;
  /** The lines counted in the balances. */
  readonly lines: number;
  /** The lines held for review, as near duplicates. */
  readonly toReview: number;
};

/** The day an import ended: when it finished, or else when it was made. */
const endedOn = (summary: ImportSummary) => (summary.finishedAt ?? summary.createdAt).slice(0, 10);

/**
 * The day the user's last finished import ended. The imports come newest first, a page at a time:
 * the pages are read on until one holds a finished import, so that failed or undone ones after it
 * hide nothing; within that page, the one that finished last.
 */
const lastImportOn = (
  imports: Imports["Service"],
  owner: string,
  before: string | null,
): Effect.Effect<string | null, QueryFailed> =>
  imports.list(owner, before).pipe(
    Effect.flatMap((page) => {
      const days = page.imports.flatMap((summary) =>
        summary.status === "done" ? [endedOn(summary)] : [],
      );

      if (days.length > 0) {
        return Effect.succeed(days.toSorted().at(-1) ?? null);
      }

      return page.next === null ? Effect.succeed(null) : lastImportOn(imports, owner, page.next);
    }),
  );

/** The user's counts on the accounts, the imports and the operations. */
export const startingPoints = (owner: string) =>
  Effect.gen(function* () {
    const imports = yield* Imports;

    const [accounts, counted, held, lastImport] = yield* Effect.all(
      [
        listAccounts(owner),
        // One line a page is enough: a page says how many lines match in all.
        searchLines(owner, { limit: 1 }),
        searchLines(owner, { toReview: true, limit: 1 }),
        lastImportOn(imports, owner, null),
      ],
      { concurrency: "unbounded" },
    );

    return {
      accounts: accounts.groups.reduce((sum, group) => sum + group.accounts.length, 0),
      lastImportOn: lastImport,
      lines: counted.total,
      toReview: held.total,
    } satisfies StartingPoints;
  });
