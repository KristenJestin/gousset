import fc from "fast-check";
import { describe, expect, it } from "vite-plus/test";

import { charactersOf, splitFileName } from "./file-name";

describe("splitFileName", () => {
  it("keeps the end of a long name whole, where its dates and extension are", () => {
    expect(
      splitFileName(
        "northbank_current-account_statement_full-history_2016-01-01_to_2026-10-31.ofx",
      ),
    ).toEqual({
      start: "northbank_current-account_statement_full-history_",
      end: "2016-01-01_to_2026-10-31.ofx",
    });
  });

  it("gives a short name whole to its end", () => {
    expect(splitFileName("savings.qif")).toEqual({ start: "", end: "savings.qif" });
  });

  it("never cuts a character in two: an emoji, a letter with its accent", () => {
    expect(splitFileName("statement-😀-2026-10.ofx", 13).end).toBe("😀-2026-10.ofx");
    expect(splitFileName("relevé-2026-10.ofx", 13).end).toBe("é-2026-10.ofx");
  });

  it("always gives back the whole name, its end no longer than asked", () => {
    fc.assert(
      fc.property(
        fc.string({ unit: "binary", maxLength: 120 }),
        fc.integer({ min: 1, max: 40 }),
        (name, keep) => {
          const { start, end } = splitFileName(name, keep);

          expect(`${start}${end}`).toBe(name);
          expect(charactersOf(end).length).toBeLessThanOrEqual(keep);
        },
      ),
    );
  });
});
