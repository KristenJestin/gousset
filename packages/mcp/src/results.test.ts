import { describe, expect, test } from "vite-plus/test";

import { pageOf } from "./results";

const LIMIT = 5000;
const text = Array.from({ length: 800 }, (_, line) => `Line ${line}`).join("\n");

/** Every page of `text`, following the cursors each page writes. */
function allPages(nextCall: (cursor: string) => string) {
  const pages: Array<string> = [];
  let cursor: string | undefined;

  for (;;) {
    const page = pageOf(text, cursor, nextCall, LIMIT);

    if ("outOfRange" in page) {
      throw new Error(`cursor ${cursor} is out of range`);
    }

    pages.push(page.text);

    const next = /Read on with: .*"cursor":"(\d+)"/.exec(page.text)?.[1];

    if (next === undefined) {
      return pages;
    }

    cursor = next;
  }
}

/** A next call made long by its arguments. */
const longCall = (cursor: string) =>
  `notes ${JSON.stringify({ action: "list", filter: "x".repeat(1500), cursor })}`;

describe("a paged result", () => {
  test("stays under the limit even when the next call is long", () => {
    const pages = allPages(longCall);

    expect(pages.length).toBeGreaterThan(1);

    for (const page of pages) {
      expect(page.length).toBeLessThanOrEqual(LIMIT);
    }
  });

  test("loses no line between its parts", () => {
    const pages = allPages((cursor) => `notes {"cursor":"${cursor}"}`);
    const lines = pages.join("\n").split("\n");

    for (let line = 0; line < 800; line += 1) {
      expect(lines).toContain(`Line ${line}`);
    }
  });
});
