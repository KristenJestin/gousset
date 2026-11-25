import { describe, expect, test } from "vite-plus/test";

import { PALETTE_COLORS, automaticColorOf } from "./palette";

describe("PALETTE_COLORS", () => {
  test("holds the twelve colours core stores, in their order", () => {
    expect(PALETTE_COLORS).toEqual([
      "gray",
      "red",
      "orange",
      "amber",
      "lime",
      "green",
      "teal",
      "cyan",
      "blue",
      "indigo",
      "violet",
      "pink",
    ]);
  });
});

describe("automaticColorOf", () => {
  test("is stable for a name, whatever its case and spaces", () => {
    expect(automaticColorOf("Corner Bistro")).toBe(automaticColorOf("corner  bistro"));
    expect(automaticColorOf("Greenmarket")).toBe(automaticColorOf("Greenmarket"));
  });

  test("is always one of the palette's colours, and spreads names over it", () => {
    const names = [
      "Greenmarket",
      "Fuelstop",
      "Corner Bistro",
      "Streamly",
      "Pixelplay",
      "Northbank",
      "Harbor Savings",
      "Northwind",
    ];

    const seen = new Set<string>();

    for (const name of names) {
      const color = automaticColorOf(name);

      expect(PALETTE_COLORS).toContain(color);
      seen.add(color);
    }

    expect(seen.size).toBeGreaterThan(3);
  });

  test("gives a colour to an empty name too", () => {
    expect(PALETTE_COLORS).toContain(automaticColorOf(""));
  });
});
