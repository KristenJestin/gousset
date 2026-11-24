import { afterEach, describe, expect, test } from "vite-plus/test";

import { dayRange, longDay, monthLabel, shortDay } from "./account-day";

// A bank day has no time zone: it is parsed as UTC midnight and must be formatted in UTC too
// (docs/data-model.md, "Dates"), or a reader west of the bank sees the day before. `TZ` is read by
// Node's `Intl` for the machine's own zone: setting it to one west of UTC during the test is what
// would reveal the bug, without depending on whatever zone actually runs this test.

const WESTERN_ZONE = "Pacific/Honolulu"; // UTC−10

function inWesternZone<T>(run: () => T): T {
  const original = process.env["TZ"];

  process.env["TZ"] = WESTERN_ZONE;

  try {
    return run();
  } finally {
    if (original === undefined) {
      delete process.env["TZ"];
    } else {
      process.env["TZ"] = original;
    }
  }
}

afterEach(() => {
  delete process.env["TZ"];
});

describe("account-day", () => {
  test("names a bank day by itself, never the day before, in a zone west of UTC", () => {
    inWesternZone(() => {
      expect(shortDay("2026-11-01", "en")).toBe("Nov 1");
      expect(longDay("2026-11-01", "en")).toBe("November 1, 2026");
      expect(monthLabel("2026-11-01", "en")).toBe("November");
    });
  });

  // The server and the browser format a range with their own ICU: Node puts thin spaces around
  // the dash where Chromium puts plain ones, and a page whose text differs from the server's is
  // drawn again from nothing once it runs (React's error #418), its line detail with it.
  test("writes a period with plain spaces, as every engine does", () => {
    expect(dayRange("2026-11-04", "2026-11-06", "en")).toBe("Nov 4 – 6, 2026");
    expect(dayRange("2026-10-01", "2026-11-30", "en")).toBe("Oct 1 – Nov 30, 2026");
  });
});
