import { m } from "@gousset/i18n/messages";
import { describe, expect, test } from "vite-plus/test";

import { receiptRefusalMessage } from "./receipts";

// A receipt refused (#217) is said in the user's words, naming the limit it passed. Their French is
// checked with every message's (`packages/i18n`).
describe("a receipt's refusals, as a page says them", () => {
  test("a file too large names its size and the limit", () => {
    expect(
      receiptRefusalMessage({ refused: "RECEIPT_TOO_LARGE", bytes: 63_000_000, limit: 50_000_000 }),
    ).toBe("This file is 63 MB; a receipt can be at most 50 MB.");
    expect(
      receiptRefusalMessage({ refused: "RECEIPT_TOO_LARGE", bytes: null, limit: 50_000_000 }),
    ).toBe("This file is too large: a receipt can be at most 50 MB.");
  });

  test("a file of another kind names the kinds the installation takes", () => {
    expect(
      receiptRefusalMessage({ refused: "RECEIPT_TYPE", allowed: ["pdf", "jpeg", "png", "heic"] }),
      // As every list of the interface is written in English (`Intl.ListFormat`).
    ).toBe("Only PDF, JPEG, PNG, and HEIC files can be attached.");
    expect(receiptRefusalMessage({ refused: "RECEIPT_TYPE", allowed: ["pdf"] })).toBe(
      "Only PDF files can be attached.",
    );
  });

  test("each code has its own message", () => {
    const said = (
      [
        "RECEIPT_EMPTY",
        "LINE_NOT_FOUND",
        "SUBJECT_NOT_FOUND",
        "RECEIPT_NOT_FOUND",
        "RECEIPT_UNAVAILABLE",
        "UPLOAD_FAILED",
        "SIGN_IN_REQUIRED",
        "PASSWORD_CHANGE_REQUIRED",
      ] as const
    ).map((refused) => receiptRefusalMessage({ refused }));

    expect(said).not.toContain(m.errorUnknown());
    expect(new Set(said).size).toBe(said.length);
  });
});
