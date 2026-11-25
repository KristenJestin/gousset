import type { CsvProfile } from "@gousset/import";
import { describe, expect, test } from "vite-plus/test";

import { mappingOf, profileOf, remap, settingsOf, withSettings } from "./csv-mapping";

const profile: CsvProfile = {
  version: 1,
  separator: ";",
  encoding: "windows-1252",
  skipRows: 3,
  headerRow: true,
  dateFormat: "DD/MM/YYYY",
  decimalMark: ",",
  columns: {
    bookedOn: 1,
    valueOn: 2,
    amount: { kind: "debit-credit", debit: 4, credit: 5 },
    label: 3,
    memo: null,
    bankId: null,
    currency: null,
  },
};

describe("a CSV profile as the preview maps its columns", () => {
  test("says what each column holds, as wide as the file", () => {
    expect(mappingOf(profile, 6)).toEqual([
      "bookedOn",
      "valueOn",
      "label",
      "debit",
      "credit",
      "ignored",
    ]);

    expect(
      mappingOf(
        { ...profile, columns: { ...profile.columns, amount: { kind: "signed", column: 7 } } },
        3,
      ),
    ).toEqual(["bookedOn", "valueOn", "label", "ignored", "ignored", "ignored", "amount"]);
  });

  test("gives back the profile it was made from", () => {
    expect(profileOf(settingsOf(profile), mappingOf(profile, 5))).toEqual({ profile });
  });

  test("keeps a profile's layout: PayPal's activity is read by its columns' names, whatever is changed", () => {
    const paypal: CsvProfile = { ...profile, separator: ",", layout: "paypal-activity" };
    const settings = settingsOf(paypal);

    expect(profileOf(settings, mappingOf(paypal, 5))).toEqual({ profile: paypal });

    // The file saved by a spreadsheet with semicolons: the separator changes, the layout stays.
    const semicolons = withSettings(settings, {
      separator: ";",
      encoding: "utf8",
      skipRows: 3,
      headerRow: true,
      dateFormat: "DD/MM/YYYY",
      decimalMark: ",",
    });

    expect(profileOf(semicolons, mappingOf(paypal, 5))).toEqual({
      profile: { ...paypal, separator: ";", encoding: "utf8" },
    });

    // A plain profile has none, and gains none.
    expect("layout" in settingsOf(profile)).toBe(false);
  });

  test("a field is held by one column: mapping it again moves it", () => {
    expect(remap(["bookedOn", "valueOn", "label"], 2, "bookedOn")).toEqual([
      "ignored",
      "bookedOn",
      "label",
    ]);
  });

  test("a signed amount and a debit or credit exclude each other", () => {
    expect(remap(["bookedOn", "label", "debit", "credit"], 2, "amount")).toEqual([
      "bookedOn",
      "amount",
      "ignored",
      "ignored",
    ]);

    expect(remap(["bookedOn", "label", "amount", "ignored"], 4, "credit")).toEqual([
      "bookedOn",
      "label",
      "ignored",
      "credit",
    ]);
  });

  test("maps a column past the mapping's end, the columns between ignored", () => {
    expect(remap(["bookedOn"], 3, "label")).toEqual(["bookedOn", "ignored", "label"]);
  });

  test("names the fields a profile still lacks: a booking date, a label, an amount", () => {
    const settings = settingsOf(profile);

    expect(profileOf(settings, ["ignored", "label", "debit"])).toEqual({
      missing: ["bookedOn", "amount"],
    });

    expect(profileOf(settings, ["bookedOn", "label", "amount", "currency"])).toEqual({
      profile: {
        ...profile,
        columns: {
          bookedOn: 1,
          valueOn: null,
          amount: { kind: "signed", column: 3 },
          label: 2,
          memo: null,
          bankId: null,
          currency: 4,
        },
      },
    });
  });

  test("takes the settings the form sends, and keeps the last good value of one it cannot read", () => {
    const settings = settingsOf(profile);

    expect(
      withSettings(settings, {
        separator: "\t",
        encoding: "utf8",
        skipRows: 0,
        headerRow: false,
        dateFormat: "YYYY-MM-DD",
        decimalMark: ".",
      }),
    ).toEqual({
      separator: "\t",
      encoding: "utf8",
      skipRows: 0,
      headerRow: false,
      dateFormat: "YYYY-MM-DD",
      decimalMark: ".",
    });

    expect(
      withSettings(settings, {
        separator: "#",
        encoding: "latin9",
        skipRows: 500,
        headerRow: true,
        dateFormat: "D/M/Y",
        decimalMark: "'",
      }),
    ).toEqual({ ...settings, skipRows: 100 });
  });
});
