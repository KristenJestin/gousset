import { describe, expect, test } from "vite-plus/test";

import { listsNewestFirst } from "./file-order";

// Which way a broker's file lists its days (docs/data-model.md, v0.6): read from every step between
// two rows, not from its two ends, so that one row out of place does not turn a file around.
describe("a broker's file listed newest first", () => {
  test("is one whose days go down from row to row", () => {
    expect(listsNewestFirst(["2026-10-08", "2026-10-06", "2026-10-06", "2026-10-02"])).toBe(true);
  });

  test("is not one whose days go up, even with a lone older row at its end", () => {
    expect(
      listsNewestFirst([
        "2026-01-05",
        "2026-01-05",
        "2026-03-10",
        "2026-06-18",
        "2026-12-20",
        "2026-01-02",
      ]),
    ).toBe(false);
  });

  test("is not one with a lone newer row at its start, its other days going up", () => {
    expect(
      listsNewestFirst(["2026-12-20", "2026-01-05", "2026-03-10", "2026-06-18", "2026-09-01"]),
    ).toBe(false);
  });

  test("is not a file of one day, nor one whose steps go down as often as up", () => {
    expect(listsNewestFirst(["2026-10-06", "2026-10-06", "2026-10-06"])).toBe(false);
    expect(listsNewestFirst(["2026-10-06", "2026-10-02", "2026-10-09"])).toBe(false);
    expect(listsNewestFirst([])).toBe(false);
  });
});
