import { CsvDefinition } from "@gousset/import";
import { Effect, Schema } from "effect";
import { describe, expect, test } from "vite-plus/test";

import { candidatesFor, matchProfile } from "./profiles";
import type { ProfileCandidate } from "./profiles";

// Which of the user's profiles may read a CSV file, by where the file goes (#250): a broker's
// operations profile that finds its columns by names as common as "Date" and "Amount" recognises
// a bank statement's header too, and must not take it from the statements' profiles.

const definition = Schema.decodeUnknownSync(CsvDefinition);

/** An invented bank statement, its header `Date;Label;Amount`. */
const STATEMENT = new TextEncoder().encode(
  "Date;Label;Amount\n2026-12-14;EXAMPLE GROCER;-12,40\n2026-12-15;EXAMPLE BAKERY;-3,20\n",
);

/** A hand-made operations profile, imported from a file: its columns found by generic names. */
const operations: ProfileCandidate = {
  header: null,
  profile: definition({
    version: 2,
    reads: "operations",
    separator: ";",
    encoding: "utf8",
    skipRows: 0,
    headerRow: true,
    dateFormat: "YYYY-MM-DD",
    decimalMark: ",",
    columns: { bookedOn: { names: ["Date"] }, amount: { names: ["Amount"] } },
    kinds: [],
    referenceUnique: false,
  }),
  profileId: "operations",
  shippedProfile: null,
};

/** A statement profile saved from a preview of that statement, with its header. */
const statement: ProfileCandidate = {
  header: "date;label;amount",
  profile: definition({
    version: 1,
    separator: ";",
    encoding: "utf8",
    skipRows: 0,
    headerRow: true,
    dateFormat: "YYYY-MM-DD",
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
  }),
  profileId: "statement",
  shippedProfile: null,
};

const matched = (candidates: ReadonlyArray<ProfileCandidate>) =>
  Effect.runSync(matchProfile(STATEMENT, candidates))?.profileId ?? null;

describe("the profiles tried on a file", () => {
  test("an operations profile of generic names recognises a bank statement's header", () => {
    expect(matched([operations])).toBe("operations");
  });

  test("on an account that takes no operations, no operations profile is tried", () => {
    expect(matched(candidatesFor([operations, statement], "other"))).toBe("statement");
    // None left: detection reads the statement.
    expect(matched(candidatesFor([operations], "other"))).toBeNull();
  });

  test("with no account known, a statement profile wins a file both recognise", () => {
    expect(matched(candidatesFor([operations, statement], "unknown"))).toBe("statement");
    expect(matched(candidatesFor([operations], "unknown"))).toBe("operations");
  });

  test("on an investment account, every profile is tried in the user's order", () => {
    expect(matched(candidatesFor([operations, statement], "investment"))).toBe("operations");
    expect(matched(candidatesFor([statement, operations], "investment"))).toBe("statement");
  });
});
