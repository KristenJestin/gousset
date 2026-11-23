import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";

import { calendarDay, ofxDay, qifDay, readQifDate } from "./dates";
import type { DateOrder } from "./dates";

const dates = fc.date({
  min: new Date("1000-01-01T00:00:00Z"),
  max: new Date("9999-12-31T00:00:00Z"),
  noInvalidDate: true,
});

/** Any day from year 1000 to 9999, as its parts and as `YYYY-MM-DD`. */
const anyDay = dates.map((date) => ({
  iso: date.toISOString().slice(0, 10),
  year: date.getUTCFullYear(),
  month: date.getUTCMonth() + 1,
  day: date.getUTCDate(),
}));

const pad = (value: number) => String(value).padStart(2, "0");

describe("calendar days", () => {
  test("knows which days the calendar has", () => {
    const parts = fc.tuple(
      fc.integer({ min: 1000, max: 9999 }),
      fc.integer({ min: 0, max: 13 }),
      fc.integer({ min: 0, max: 32 }),
    );

    fc.assert(
      fc.property(parts, ([year, month, day]) => {
        const date = new Date(Date.UTC(year, month - 1, day));
        const exists = date.getUTCMonth() === month - 1 && date.getUTCDate() === day;

        expect(calendarDay(year, month, day) !== undefined).toBe(exists);
      }),
    );
  });

  test("has the 29th of February in leap years only", () => {
    expect(calendarDay(2024, 2, 29)).toBe("2024-02-29");
    expect(calendarDay(2000, 2, 29)).toBe("2000-02-29");
    expect(calendarDay(2026, 2, 29)).toBeUndefined();
    expect(calendarDay(2100, 2, 29)).toBeUndefined();
  });
});

describe("OFX dates", () => {
  test("reads the day of any date, whatever time and zone follow it", () => {
    const times = fc.constantFrom("", "1530", "120000", "000000.000", "235959.5");
    const zones = fc.constantFrom("", "[0:GMT]", "[+1:CET]", "[-5:EST]", "[-3.30]", " [+2]");

    fc.assert(
      fc.property(anyDay, times, zones, (day, time, zone) => {
        const written = `${String(day.year)}${pad(day.month)}${pad(day.day)}${time}${zone}`;

        expect(ofxDay(written)).toBe(day.iso);
      }),
    );
  });

  test("refuses what is not a day, or a time that is not one", () => {
    for (const written of [
      "",
      "2026-10-02",
      "20261302",
      "20260230",
      "2026100",
      "20261002250000",
      "20261002126000",
      "20261002120000[+1:CET",
      "20261002x",
    ]) {
      expect(ofxDay(written)).toBeUndefined();
    }
  });
});

describe("QIF dates", () => {
  const orders = fc.constantFrom<DateOrder>("day-first", "month-first");
  const separators = fc.constantFrom("/", ".", "-");

  test("reads any day written with a four-digit year, in the order given", () => {
    fc.assert(
      fc.property(anyDay, orders, separators, fc.boolean(), (day, order, separator, spaced) => {
        const numbers = order === "day-first" ? [day.day, day.month] : [day.month, day.day];
        const [first, second] = numbers.map((value) => (spaced ? String(value) : pad(value)));
        const written = `${first ?? ""}${separator}${second ?? ""}${separator}${String(day.year)}`;
        const date = readQifDate(written);

        expect(date === undefined ? undefined : qifDay(date, order)).toBe(day.iso);
      }),
    );
  });

  test("reads two-digit years from 1970 to 2069, and from 2000 with Quicken's apostrophe", () => {
    expect(readQifDate("10/ 3'26")).toEqual({ kind: "numbers", first: 10, second: 3, year: 2026 });
    expect(readQifDate("10/ 3'85")).toEqual({ kind: "numbers", first: 10, second: 3, year: 2085 });
    expect(readQifDate("03/10/26")).toEqual({ kind: "numbers", first: 3, second: 10, year: 2026 });
    expect(readQifDate("03/10/69")).toEqual({ kind: "numbers", first: 3, second: 10, year: 2069 });
    expect(readQifDate("03/10/70")).toEqual({ kind: "numbers", first: 3, second: 10, year: 1970 });
  });

  test("reads an ISO day whatever the order", () => {
    const date = readQifDate("2026-10-03");

    expect(date).toEqual({ kind: "iso", day: "2026-10-03" });
    expect(date === undefined ? undefined : qifDay(date, "month-first")).toBe("2026-10-03");
  });

  test("tells a day that does not exist in the order given", () => {
    const date = readQifDate("31/10/2026");

    expect(date === undefined ? undefined : qifDay(date, "day-first")).toBe("2026-10-31");
    expect(date === undefined ? undefined : qifDay(date, "month-first")).toBeUndefined();
  });

  test("refuses what is not a date", () => {
    for (const written of ["", "yesterday", "2026/10/03", "3/10", "03/10/2026/1", "2026-02-30"]) {
      expect(readQifDate(written)).toBeUndefined();
    }
  });
});
