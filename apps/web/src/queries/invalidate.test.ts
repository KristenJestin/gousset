import { QueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { describe, expect, test } from "vite-plus/test";

import type { Touched } from "@/jobs/view";

import { accountKeys } from "./account-keys";
import { invalidateTouched } from "./invalidate";
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

  test("reads again the months a job touched, and only those", async () => {
    const october = [...monthKeys.of("2026-10"), "e2e-touched"];
    const november = [...monthKeys.of("2026-11"), "e2e-touched"];
    const client = clientWith([october, november]);

    await invalidateTouched(client, { months: ["2026-10"] });

    expect(isInvalidated(client, october)).toBe(true);
    expect(isInvalidated(client, november)).toBe(false);
  });
});
