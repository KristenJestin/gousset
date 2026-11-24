import { describe, expect, it } from "vite-plus/test";

import { foldedFiltersCount, NO_OPERATIONS_FILTERS } from "./operations";

describe("foldedFiltersCount", () => {
  it("counts none when nothing is set", () => {
    expect(foldedFiltersCount(NO_OPERATIONS_FILTERS)).toBe(0);
  });

  it("leaves the search out: it stays in sight beside the Filters button", () => {
    expect(foldedFiltersCount({ ...NO_OPERATIONS_FILTERS, search: "greenmarket" })).toBe(0);
  });

  it("counts the period once, whether one bound or both are set", () => {
    expect(foldedFiltersCount({ ...NO_OPERATIONS_FILTERS, from: "2026-10-01" })).toBe(1);
    expect(
      foldedFiltersCount({ ...NO_OPERATIONS_FILTERS, from: "2026-10-01", to: "2026-10-31" }),
    ).toBe(1);
  });

  it("counts the amount once, whether one bound or both are typed", () => {
    expect(foldedFiltersCount({ ...NO_OPERATIONS_FILTERS, max: "60" })).toBe(1);
    expect(foldedFiltersCount({ ...NO_OPERATIONS_FILTERS, min: "20", max: "60" })).toBe(1);
  });

  it("counts the account, the period, the amount and the lines to review", () => {
    expect(
      foldedFiltersCount({
        search: "bistro",
        accountId: "current",
        from: null,
        to: "2026-10-31",
        min: "20",
        max: "",
        toReview: true,
      }),
    ).toBe(4);
  });
});
