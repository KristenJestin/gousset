import type { CsvProfile } from "@gousset/import";
import { Exit, Schema } from "effect";
import { describe, expect, test } from "vite-plus/test";

import { ImportProfileInput, RenameProfileInput, SaveProfileInput } from "./import-profile-inputs";

const definition: CsvProfile = {
  version: 1,
  separator: ";",
  encoding: "utf8",
  skipRows: 0,
  headerRow: true,
  dateFormat: "DD/MM/YYYY",
  decimalMark: ",",
  columns: {
    bookedOn: 1,
    valueOn: null,
    amount: { kind: "signed", column: 3 },
    label: 2,
    memo: null,
    bankId: null,
    currency: null,
  },
};

const decodeSave = Schema.decodeUnknownExit(SaveProfileInput);
const decodeRename = Schema.decodeUnknownExit(RenameProfileInput);
const decodeImport = Schema.decodeUnknownExit(ImportProfileInput);

const savable = (draft: typeof SaveProfileInput.Encoded) => Exit.isSuccess(decodeSave(draft));
const renamable = (name: string) => Exit.isSuccess(decodeRename({ profileId: "p", name }));

const importable = (shared: typeof ImportProfileInput.Encoded) =>
  Exit.isSuccess(decodeImport(shared));

describe("a CSV profile sent by the import screen", () => {
  const draft = { name: "Example bank", institution: null, definition, header: "date;label" };

  test("is taken with a name and an institution of 100 characters", () => {
    expect(savable({ ...draft, name: "n".repeat(100) })).toBe(true);
    expect(savable({ ...draft, institution: "i".repeat(100) })).toBe(true);
    expect(renamable("n".repeat(100))).toBe(true);
  });

  test("is refused with a longer name, institution or header", () => {
    expect(savable({ ...draft, name: "n".repeat(101) })).toBe(false);
    expect(savable({ ...draft, institution: "i".repeat(101) })).toBe(false);
    expect(savable({ ...draft, header: "h".repeat(10_001) })).toBe(false);
    expect(renamable("n".repeat(101))).toBe(false);
  });

  test("is refused as a file of more than 64 KiB, before its JSON is parsed", () => {
    const shared = { name: "Shared", institution: null, content: JSON.stringify(definition) };

    expect(importable(shared)).toBe(true);
    expect(importable({ ...shared, content: " ".repeat(64 * 1024 + 1) })).toBe(false);
  });
});
