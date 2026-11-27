import { readFileSync } from "node:fs";

import { describe, expect, test } from "vite-plus/test";

import { CATEGORY_COLORS, CATEGORY_ICONS, shownColor } from "./category-looks";

describe("a category's look (#205)", () => {
  test("imports nothing: packages/ui and the browser read it alone, never the core's services", () => {
    const text = readFileSync(new URL("category-looks.ts", import.meta.url), "utf8");

    expect(text).not.toMatch(/^\s*(import|export .* from)\b/m);
  });

  test("its keys are unique, and fit what the core accepts", () => {
    for (const keys of [CATEGORY_ICONS, CATEGORY_COLORS]) {
      expect(new Set(keys).size).toBe(keys.length);

      for (const key of keys) {
        expect(key).toMatch(/^[a-z][a-z-]{0,63}$/);
      }
    }
  });

  test("a child takes its parent's colour unless it has its own; an unknown key shows none", () => {
    expect(shownColor(null, "blue")).toBe("blue");
    expect(shownColor("amber", "blue")).toBe("amber");
    expect(shownColor(null, null)).toBeNull();
    expect(shownColor("chartreuse", null)).toBeNull();
  });
});
