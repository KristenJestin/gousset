import { describe, expect, test } from "vite-plus/test";

import { initialsOf } from "./initials";

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
