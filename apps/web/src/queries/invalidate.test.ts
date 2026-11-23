import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test } from "vite-plus/test";

import { invalidateApproval } from "./invalidate";
import { monthKeys } from "./month-keys";

const isInvalidated = (client: QueryClient, queryKey: ReadonlyArray<string>) =>
  client.getQueryState(queryKey)?.isInvalidated;

describe("invalidateApproval", () => {
  test("reads the month again, and the next month's day-by-day spending, which it is compared with", async () => {
    const client = new QueryClient();
    const october = monthKeys.summary("2026-10");
    const novemberDays = monthKeys.spendingDays("2026-11", "category", "Groceries");
    const novemberSummary = monthKeys.summary("2026-11");
    const decemberDays = monthKeys.spendingDays("2026-12", "category", "Groceries");

    for (const queryKey of [october, novemberDays, novemberSummary, decemberDays]) {
      client.setQueryData(queryKey, "read");
    }

    await invalidateApproval(client, "2026-10");

    expect(isInvalidated(client, october)).toBe(true);
    expect(isInvalidated(client, novemberDays)).toBe(true);
    // The rest of the next month counts every expense, approved or not: it stays as it was.
    expect(isInvalidated(client, novemberSummary)).toBe(false);
    expect(isInvalidated(client, decemberDays)).toBe(false);
  });
});
