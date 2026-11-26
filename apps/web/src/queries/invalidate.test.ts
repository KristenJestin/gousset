import { QueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { describe, expect, test } from "vite-plus/test";

import type { Touched } from "@/jobs/view";

import { accountKeys } from "./account-keys";
import { categoryKeys } from "./category-keys";
import {
  invalidateAccounts,
  invalidateCategories,
  invalidateMerchantEntries,
  invalidateMerchants,
  invalidateSubjects,
  invalidateTouched,
} from "./invalidate";
import { lineKeys } from "./line-keys";
import { merchantKeys } from "./merchant-keys";
import { monthKeys } from "./month-keys";
import { reviewKeys } from "./review-keys";
import { ruleKeys } from "./rule-keys";
import { subjectKeys } from "./subject-keys";

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

/**
 * Months on either side of October, far apart: a month's flags read the next month, and its
 * figures the six before it.
 */
const MONTHS = [
  touched("2026-09"),
  monthKeys.review("2026-10"),
  monthKeys.review("2026-11"),
  monthKeys.spendingDays("2027-04", "category", null),
  monthKeys.review("2027-05"),
];

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

  test("reads the subjects again: an import's rules and a rule applied to the past attach them", async () => {
    const touchedOnes: ReadonlyArray<Touched> = [{ months: ["2026-10"] }, { everyMonth: true }];
    const page = subjectKeys.detail("5e4d3c2b-1a09-4f8e-8d7c-6b5a4f3e2d1c", 2026);

    for (const touched of touchedOnes) {
      const client = clientWith([subjectKeys.list(), page]);

      await invalidateTouched(client, touched);

      expect(isInvalidated(client, subjectKeys.list())).toBe(true);
      expect(isInvalidated(client, page)).toBe(true);
    }
  });

  test("a rule applied to the past reads the categories' figures again: its lines moved", async () => {
    const client = clientWith([categoryKeys.list()]);

    await invalidateTouched(client, { everyMonth: true });

    expect(isInvalidated(client, categoryKeys.list())).toBe(true);
  });

  test("reads every month again, before and after the months a job touched: their flags and averages read them", async () => {
    const client = clientWith(MONTHS);

    await invalidateTouched(client, { months: ["2026-10"] });

    for (const queryKey of MONTHS) {
      expect(isInvalidated(client, queryKey), JSON.stringify(queryKey)).toBe(true);
    }
  });
});

describe("invalidateAccounts", () => {
  test("reads the accounts, the operations and every month again: the review reads the accounts", async () => {
    // A subject's page gives its accounts' balances.
    const subjects = subjectKeys.detail("5e4d3c2b-1a09-4f8e-8d7c-6b5a4f3e2d1c", 2026);
    const client = clientWith([ACCOUNTS, SEARCH, COUNTS, subjects, ...MONTHS]);

    await invalidateAccounts(client);

    for (const queryKey of [ACCOUNTS, SEARCH, COUNTS, subjects, ...MONTHS]) {
      expect(isInvalidated(client, queryKey), JSON.stringify(queryKey)).toBe(true);
    }
  });
});

describe("invalidateSubjects", () => {
  test("reads the subjects, the rules, the operations and every month again: a subject's merchants are rules, its expenses lines", async () => {
    const page = subjectKeys.detail("5e4d3c2b-1a09-4f8e-8d7c-6b5a4f3e2d1c", "all");
    const keys = [subjectKeys.list(), page, ruleKeys.list(), SEARCH, DETAIL, ...MONTHS];
    const client = clientWith(keys);

    await invalidateSubjects(client);

    for (const queryKey of keys) {
      expect(isInvalidated(client, queryKey), JSON.stringify(queryKey)).toBe(true);
    }
  });

  test("reads the accounts' pages again: an account's lines name their subjects", async () => {
    const page = accountKeys.detail("2c4e6a8b-0d1f-4a3c-9e5b-7d9f1b3c5e70");
    const client = clientWith([ACCOUNTS, page]);

    await invalidateSubjects(client);

    expect(isInvalidated(client, ACCOUNTS)).toBe(true);
    expect(isInvalidated(client, page)).toBe(true);
  });
});

describe("invalidateMerchants", () => {
  test("reads the merchants and every month again: the review names the merchants", async () => {
    const client = clientWith([MERCHANTS, MERCHANT, ...MONTHS]);

    await invalidateMerchants(client);

    for (const queryKey of [MERCHANTS, MERCHANT, ...MONTHS]) {
      expect(isInvalidated(client, queryKey), JSON.stringify(queryKey)).toBe(true);
    }
  });

  test("reads the subjects again: a subject's page names its merchants", async () => {
    const page = subjectKeys.detail("5e4d3c2b-1a09-4f8e-8d7c-6b5a4f3e2d1c", 2026);
    const client = clientWith([subjectKeys.list(), page]);

    await invalidateMerchants(client);

    expect(isInvalidated(client, subjectKeys.list())).toBe(true);
    expect(isInvalidated(client, page)).toBe(true);
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

  test("reads the subjects again: a subject's page gives its merchants and its categories", async () => {
    const page = subjectKeys.detail("5e4d3c2b-1a09-4f8e-8d7c-6b5a4f3e2d1c", "all");
    const client = clientWith([subjectKeys.list(), page]);

    await invalidateMerchantEntries(client);

    expect(isInvalidated(client, subjectKeys.list())).toBe(true);
    expect(isInvalidated(client, page)).toBe(true);
  });
});

describe("invalidateCategories", () => {
  test("reads the subjects again: a subject's page gives its cost by category", async () => {
    const page = subjectKeys.detail("5e4d3c2b-1a09-4f8e-8d7c-6b5a4f3e2d1c", 2026);
    const client = clientWith([subjectKeys.list(), page, categoryKeys.list(), SEARCH]);

    await invalidateCategories(client);

    for (const queryKey of [subjectKeys.list(), page, categoryKeys.list(), SEARCH]) {
      expect(isInvalidated(client, queryKey), JSON.stringify(queryKey)).toBe(true);
    }
  });
});
