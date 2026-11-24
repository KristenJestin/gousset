import { QueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { describe, expect, test } from "vite-plus/test";

import type { Touched } from "@/jobs/view";

import { accountKeys } from "./account-keys";
import { categoryKeys } from "./category-keys";
import { invalidateMerchantEntries, invalidateTouched } from "./invalidate";
import { lineKeys } from "./line-keys";
import { merchantKeys } from "./merchant-keys";
import { monthKeys } from "./month-keys";
import { reviewKeys } from "./review-keys";
import { ruleKeys } from "./rule-keys";

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
const COUNTS = reviewKeys.startingPoints();
const MERCHANTS = merchantKeys.list("");
const MERCHANT = merchantKeys.detail("0b6e3f9a-4c2d-4e8b-9f1a-7d5c3b2e1a90");

/** A query of a month's, as a job's end reads it. */
const touched = (month: string) => [...monthKeys.of(month), "e2e-touched"];

describe("invalidateTouched", () => {
  test("reads the operations, the accounts and the review's counts again, after an import or its undo", async () => {
    const touchedOnes: ReadonlyArray<Touched> = [{ months: ["2026-10"] }, { everyMonth: true }];

    for (const touched of touchedOnes) {
      const client = clientWith([SEARCH, DETAIL, ACCOUNTS, COUNTS]);

      await invalidateTouched(client, touched);

      expect(isInvalidated(client, SEARCH)).toBe(true);
      expect(isInvalidated(client, DETAIL)).toBe(true);
      expect(isInvalidated(client, ACCOUNTS)).toBe(true);
      expect(isInvalidated(client, COUNTS)).toBe(true);
    }
  });

  test("reads the merchants again: an import recognises those of its lines, an undo leaves them", async () => {
    const client = clientWith([MERCHANTS, MERCHANT]);

    await invalidateTouched(client, { months: ["2026-10"] });

    expect(isInvalidated(client, MERCHANTS)).toBe(true);
    expect(isInvalidated(client, MERCHANT)).toBe(true);
  });

  test("reads the rules again: an import's rules and a rule applied to the past count their lines", async () => {
    const touchedOnes: ReadonlyArray<Touched> = [{ months: ["2026-10"] }, { everyMonth: true }];
    const rule = ruleKeys.detail("3d2b1c4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e");

    for (const touched of touchedOnes) {
      const client = clientWith([ruleKeys.list(), rule]);

      await invalidateTouched(client, touched);

      expect(isInvalidated(client, ruleKeys.list())).toBe(true);
      expect(isInvalidated(client, rule)).toBe(true);
    }
  });

  test("a rule applied to the past reads the categories' figures again: its lines moved", async () => {
    const client = clientWith([categoryKeys.list()]);

    await invalidateTouched(client, { everyMonth: true });

    expect(isInvalidated(client, categoryKeys.list())).toBe(true);
  });

  test("reads again the months a job touched and the six after them, which hold them as their previous month and average, and only those", async () => {
    const september = touched("2026-09");
    const october = touched("2026-10");
    const november = monthKeys.review("2026-11");
    const april = monthKeys.spendingDays("2027-04", "category", null);
    const may = monthKeys.review("2027-05");
    const client = clientWith([september, october, november, april, may]);

    await invalidateTouched(client, { months: ["2026-10"] });

    expect(isInvalidated(client, october)).toBe(true);
    expect(isInvalidated(client, november)).toBe(true);
    expect(isInvalidated(client, april)).toBe(true);
    expect(isInvalidated(client, september)).toBe(false);
    expect(isInvalidated(client, may)).toBe(false);
  });
});

describe("invalidateMerchantEntries", () => {
  test("reads the merchants, the operations, the months and the categories again: the entries moved", async () => {
    const october = [...monthKeys.of("2026-10"), "e2e-touched"];
    const categories = categoryKeys.list();
    const client = clientWith([MERCHANTS, MERCHANT, SEARCH, DETAIL, october, categories]);

    await invalidateMerchantEntries(client);

    for (const queryKey of [MERCHANTS, MERCHANT, SEARCH, DETAIL, october, categories]) {
      expect(isInvalidated(client, queryKey), JSON.stringify(queryKey)).toBe(true);
    }
  });
});
