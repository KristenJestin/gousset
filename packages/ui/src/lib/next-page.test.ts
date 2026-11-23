import { describe, expect, test } from "vite-plus/test";

import { asksNextPage, rowsMark } from "./next-page";

const rows = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index}` }));

describe("asksNextPage", () => {
  const first = rows("first", 200);

  test("asks once the window nears the last loaded row, and not before", () => {
    expect(asksNextPage(150, first.length, rowsMark(first, 1000), null)).toBe(false);
    expect(asksNextPage(189, first.length, rowsMark(first, 1000), null)).toBe(true);
    expect(asksNextPage(199, first.length, rowsMark(first, 1000), null)).toBe(true);
    expect(asksNextPage(0, 0, rowsMark([], 0), null)).toBe(false);
  });

  test("asks once for the same rows, again once a page is appended", () => {
    const asked = rowsMark(first, 1000);
    const longer = [...first, ...rows("first-more", 200)];

    expect(asksNextPage(199, first.length, rowsMark(first, 1000), asked)).toBe(false);
    expect(asksNextPage(399, longer.length, rowsMark(longer, 1000), asked)).toBe(true);
  });

  test("asks again when a new search gives as many rows as the last one", () => {
    const asked = rowsMark(first, 1000);
    const replaced = rows("second", 200);

    expect(asksNextPage(199, replaced.length, rowsMark(replaced, 1000), asked)).toBe(true);
    // The same first page of another search, which matches fewer lines in all.
    expect(asksNextPage(199, first.length, rowsMark(first, 640), asked)).toBe(true);
  });
});
