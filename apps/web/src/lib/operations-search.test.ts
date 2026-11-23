import { NO_OPERATIONS_FILTERS } from "@gousset/ui/lib/operations";
import { Schema } from "effect";
import { describe, expect, test } from "vite-plus/test";

import {
  OperationsSearch,
  filtersKey,
  filtersOf,
  lineFiltersOf,
  searchOf,
} from "./operations-search";

const decode = Schema.decodeUnknownSync(OperationsSearch);

describe("operations-search", () => {
  test("reads the older month address as the month's first to last day, February of a leap year too", () => {
    expect(filtersOf(decode({ month: "2025-02" }))).toMatchObject({
      from: "2025-02-01",
      to: "2025-02-28",
    });
    expect(filtersOf(decode({ month: "2024-02" }))).toMatchObject({
      from: "2024-02-01",
      to: "2024-02-29",
    });
    expect(filtersOf(decode({ month: "2026-12" }))).toMatchObject({ to: "2026-12-31" });
    // Days of its own win over the month.
    expect(filtersOf(decode({ month: "2025-02", from: "2025-02-10" }))).toMatchObject({
      from: "2025-02-10",
      to: null,
    });
  });

  test("drops what it cannot read, and reads a typed number as the text typed", () => {
    const search = decode({
      q: 12,
      account: "not an id",
      from: "2026-02-30",
      min: 12.5,
      review: "yes",
      line: "nope",
      month: "2026-13",
    });

    expect(filtersOf(search)).toEqual({ ...NO_OPERATIONS_FILTERS, search: "12", min: "12.5" });
    expect(search.line).toBeUndefined();
  });

  test("puts the filters in the address and back, leaving out what is not set", () => {
    const values = {
      ...NO_OPERATIONS_FILTERS,
      search: "greenmarket",
      from: "2026-10-01",
      max: "50",
      toReview: true,
    };

    const search = searchOf(values, undefined);

    expect(Object.entries(search).filter(([, value]) => value !== undefined)).toEqual([
      ["q", "greenmarket"],
      ["from", "2026-10-01"],
      ["max", "50"],
      ["review", true],
    ]);
    expect(filtersKey(filtersOf(search))).toBe(filtersKey(values));
    expect(lineFiltersOf(values)).toMatchObject({
      text: "greenmarket",
      from: "2026-10-01",
      amountMax: "50",
      toReview: true,
    });
  });
});
