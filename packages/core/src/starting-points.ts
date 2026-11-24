import { Effect } from "effect";

import { listAccounts } from "./accounts";
import { Imports } from "./imports/imports";
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

/** The user's counts on the accounts, the imports and the operations. */
export const startingPoints = (owner: string) =>
  Effect.gen(function* () {
    const imports = yield* Imports;

    const [accounts, counted, held, listed] = yield* Effect.all(
      [
        listAccounts(owner),
        // One line a page is enough: a page says how many lines match in all.
        searchLines(owner, { limit: 1 }),
        searchLines(owner, { toReview: true, limit: 1 }),
        imports.list(owner, null),
      ],
      { concurrency: "unbounded" },
    );

    // The latest imports, newest first: the last one done among them.
    const last = listed.imports.find((summary) => summary.status === "done");

    return {
      accounts: accounts.groups.reduce((sum, group) => sum + group.accounts.length, 0),
      lastImportOn: last === undefined ? null : (last.finishedAt ?? last.createdAt).slice(0, 10),
      lines: counted.total,
      toReview: held.total,
    } satisfies StartingPoints;
  });
