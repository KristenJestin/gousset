import { QueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { describe, expect, test } from "vite-plus/test";

import type { Touched } from "@/jobs/view";

import { accountKeys } from "./account-keys";
import { invalidateApproval, invalidateTouched } from "./invalidate";
import { lineKeys } from "./line-keys";
import { monthKeys } from "./month-keys";

const isInvalidated = (client: QueryClient, queryKey: QueryKey) =>
  client.getQueryState(queryKey)?.isInvalidated;

/** A client holding one read of each key. */
function clientWith(keys: ReadonlyArray<QueryKey>) {
  const client = new QueryClient();

  for (const queryKey of keys) {
    client.setQueryData(queryKey, "read");
  }

  return client;
}

const SEARCH = lineKeys.search({ text: "greenmarket" });
const DETAIL = lineKeys.detail("6f1c2a4e-0d5b-4c3e-9a7f-2b8d1e4c5a60");
const ACCOUNTS = accountKeys.list();

describe("invalidateTouched", () => {
  test("reads the operations and the accounts again, after an import or its undo", async () => {
    const touchedOnes: ReadonlyArray<Touched> = [{ months: ["2026-10"] }, { everyMonth: true }];

    for (const touched of touchedOnes) {
      const client = clientWith([SEARCH, DETAIL, ACCOUNTS]);

      await invalidateTouched(client, touched);

      expect(isInvalidated(client, SEARCH)).toBe(true);
      expect(isInvalidated(client, DETAIL)).toBe(true);
      expect(isInvalidated(client, ACCOUNTS)).toBe(true);
    }
  });
});

describe("invalidateApproval", () => {
  test("reads the month again, and the next month's day-by-day spending, which it is compared with", async () => {
    const october = monthKeys.summary("2026-10");
    const novemberDays = monthKeys.spendingDays("2026-11", "category", "Groceries");
    const novemberSummary = monthKeys.summary("2026-11");
    const decemberDays = monthKeys.spendingDays("2026-12", "category", "Groceries");
    const client = clientWith([october, novemberDays, novemberSummary, decemberDays]);

    await invalidateApproval(client, "2026-10");

    expect(isInvalidated(client, october)).toBe(true);
    expect(isInvalidated(client, novemberDays)).toBe(true);
    // The rest of the next month counts every expense, approved or not: it stays as it was.
    expect(isInvalidated(client, novemberSummary)).toBe(false);
    expect(isInvalidated(client, decemberDays)).toBe(false);
  });

  test("reads the operations again: an approved line is no longer to review", async () => {
    const client = clientWith([SEARCH, DETAIL]);

    await invalidateApproval(client, "2026-10");

    expect(isInvalidated(client, SEARCH)).toBe(true);
    expect(isInvalidated(client, DETAIL)).toBe(true);
  });
});
