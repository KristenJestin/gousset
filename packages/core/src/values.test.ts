import { Schema } from "effect";
import { describe, expect, test } from "vite-plus/test";

import { Month, addMonths } from "./values";

describe("addMonths", () => {
  test("moves across the years both ways", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2027-01", -1)).toBe("2026-12");
    expect(addMonths("2026-10", 0)).toBe("2026-10");
    expect(addMonths("2026-10", -22)).toBe("2024-12");
  });
});

describe("Month", () => {
  test("accepts YYYY-MM only", () => {
    const isMonth = Schema.is(Month);

    expect(isMonth("2026-10")).toBe(true);
    expect(isMonth("2026-13")).toBe(false);
    expect(isMonth("2026-1")).toBe(false);
    expect(isMonth("October")).toBe(false);
  });
});
