import { describe, expect, test } from "vite-plus/test";

import { initialsOf, toneIndexOf } from "./merchant";

describe("initialsOf", () => {
  test("takes the first letter of the first two words", () => {
    expect(initialsOf("Corner Bistro")).toBe("CB");
    expect(initialsOf("Greenmarket")).toBe("G");
    expect(initialsOf("le petit café du coin")).toBe("LP");
  });

  test("skips punctuation and keeps accented letters", () => {
    expect(initialsOf("  Élan & Co.")).toBe("ÉC");
    expect(initialsOf("Café-Bar")).toBe("CB");
  });

  test("falls back to a question mark when there is no letter", () => {
    expect(initialsOf("")).toBe("?");
    expect(initialsOf("—")).toBe("?");
  });
});

describe("toneIndexOf", () => {
  test("is stable for a name, whatever its case and spaces", () => {
    expect(toneIndexOf("Corner Bistro", 4)).toBe(toneIndexOf("corner  bistro", 4));
  });

  test("stays in range and spreads names over the tones", () => {
    const names = [
      "Greenmarket",
      "Fuelstop",
      "Corner Bistro",
      "Streamly",
      "Pixelplay",
      "Northbank",
    ];
    const seen = new Set<number>();

    for (const name of names) {
      const index = toneIndexOf(name, 4);

      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(4);
      seen.add(index);
    }

    expect(seen.size).toBeGreaterThan(1);
  });
});
