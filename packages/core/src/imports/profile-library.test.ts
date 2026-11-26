import { readFileSync } from "node:fs";

import {
  BROKER_ISINS,
  DEGIRO_ROWS,
  FORTUNEO_HEADER,
  FORTUNEO_ROWS,
  degiroExport,
  fortuneoExport,
} from "@gousset/fixture";
import {
  CsvDefinition,
  UnsupportedContent,
  readOperations,
  readsOperations,
} from "@gousset/import";
import type { OperationKind, OperationRow, OperationsProfile } from "@gousset/import";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { describe, expect, test } from "vite-plus/test";

import { checkOperation } from "../investments/operation-input";
import { operationDedupKeys } from "./operation-keys";

// The library of profiles (`packages/import/profiles/`, its README): each file is the JSON a user
// exports from Gousset, imported through the profile import as it is, and it reads the invented
// exports of `@gousset/fixture` exactly as the brokers' layouts of #250's part 2 read them, before
// they were removed: the same operations, the words of their kinds included, the same refusals and
// the same dedup keys, recorded here from the layouts' reads.

/** A library file's text, as a user would pick it for the profile import. */
const libraryFile = (path: string) =>
  readFileSync(new URL(`../../../import/profiles/${path}`, import.meta.url), "utf8");

/** What the profile import does with a shared file's text (`ImportProfiles.importFile`). */
const decodeShared = Schema.decodeUnknownExit(Schema.fromJsonString(CsvDefinition));

function imported(path: string): OperationsProfile {
  const decoded = decodeShared(libraryFile(path));

  if (Exit.isFailure(decoded)) {
    throw new Error(`${path} is no profile the profile import takes.`);
  }

  if (!readsOperations(decoded.value)) {
    throw new Error(`${path} reads no operations.`);
  }

  return decoded.value;
}

const read = (bytes: Uint8Array, profile: OperationsProfile, currency = "EUR") =>
  Effect.runSyncExit(readOperations(bytes, profile, { currency }));

/** Each operation's dedup key, as the import's job checks and keys the rows it read. */
function keysOf(rows: ReadonlyArray<OperationRow>): Array<string> {
  return operationDedupKeys(
    rows.map((row) => {
      const checked = checkOperation({
        kind: row.kind,
        bookedOn: row.bookedOn,
        valueOn: row.valueOn,
        amountMinor: row.amountMinor,
        isin: row.isin,
        securityName: row.securityName,
        securityCurrency: row.securityCurrency,
        quantity: row.quantity,
        unitPrice: row.unitPrice,
        feesMinor: row.feesMinor,
        label: row.label,
      });

      if (Result.isFailure(checked)) {
        throw new Error(`Line ${String(row.line)} is no operation Gousset keeps.`);
      }

      return {
        bookedOn: checked.success.bookedOn,
        kind: checked.success.kind,
        isin: checked.success.security?.isin ?? null,
        quantity: checked.success.quantity,
        unitPrice: checked.success.unitPrice,
        amountMinor: checked.success.amountMinor,
        reference: row.reference,
        referenceUnique: row.referenceUnique,
      };
    }),
  );
}

function operation(
  line: number,
  kind: OperationKind,
  bookedOn: string,
  amountMinor: number,
  more: Partial<Omit<OperationRow, "line" | "kind" | "bookedOn" | "amountMinor">> = {},
): OperationRow {
  return {
    line,
    kind,
    bookedOn,
    valueOn: null,
    amountMinor,
    isin: null,
    securityName: null,
    securityCurrency: null,
    quantity: null,
    unitPrice: null,
    feesMinor: 0,
    label: null,
    reference: null,
    referenceUnique: false,
    ...more,
  };
}

const { fund: FUND, share: SHARE } = BROKER_ISINS;

const FUND_NAME = "NORTHWIND WORLD ETF";

const FORTUNEO_READ = [
  operation(2, "deposit", "2026-10-05", 100_000, { label: "VIREMENT" }),
  operation(3, "purchase", "2026-10-06", -25_318, {
    isin: FUND,
    securityName: FUND_NAME,
    quantity: "10",
    unitPrice: "25.1234",
    feesMinor: 195,
    label: FUND_NAME,
  }),
  operation(4, "dividend", "2026-10-20", 357, {
    isin: FUND,
    securityName: FUND_NAME,
    feesMinor: 63,
    label: FUND_NAME,
  }),
  operation(5, "sale", "2026-11-03", 10_805, {
    isin: FUND,
    securityName: FUND_NAME,
    quantity: "4",
    unitPrice: "27.5",
    feesMinor: 195,
    label: FUND_NAME,
  }),
  operation(6, "fee", "2026-11-30", -200, { label: "DROITS DE GARDE" }),
];

const FORTUNEO_KEYS = [
  "operation:ad8887352befc0ac3fe2199f9b6ca9f201f3ca616cf7d5336f3f6dfa11625036#1",
  "operation:c4f149b981cdf477708d86794a1891de8d74d3ad98eb95ab4697e4864143d989#1",
  "operation:9a5dd140b1210b451f8912c2f2aae603a104e49cf5e5cb441811364059769b80#1",
  "operation:b1be23d4eef22b9a61060c88b78ba7a517a1d7b5eaa1521c5d0b4dcd80459927#1",
  "operation:6d4ade882a538eac76d1bfd4b0d1ca5587d626c1408e8fae7587809efd605900#1",
];

const DEGIRO_READ = [
  operation(2, "purchase", "2026-10-06", -30_050, {
    isin: FUND,
    securityName: FUND_NAME,
    securityCurrency: "EUR",
    quantity: "3",
    unitPrice: "99.5",
    feesMinor: 200,
    label: FUND_NAME,
    reference: "a1b2c3d4-0000-4000-8000-000000000001",
  }),
  // Priced in dollars: what it was worth in euros, per unit.
  operation(3, "purchase", "2026-10-07", -27_603, {
    isin: SHARE,
    securityName: "SOUTHWIND HOLDINGS",
    securityCurrency: "USD",
    quantity: "2",
    unitPrice: "137.515",
    feesMinor: 100,
    label: "SOUTHWIND HOLDINGS",
    reference: "a1b2c3d4-0000-4000-8000-000000000002",
  }),
  operation(4, "sale", "2026-11-03", 9925, {
    isin: FUND,
    securityName: FUND_NAME,
    securityCurrency: "EUR",
    quantity: "1",
    unitPrice: "101.25",
    feesMinor: 200,
    label: FUND_NAME,
    reference: "a1b2c3d4-0000-4000-8000-000000000003",
  }),
];

const DEGIRO_KEYS = [
  "operation:7aaad70dad7794727ab8495045581e4d2562e3875b37adddb094417d875f46bf#1",
  "operation:570f404184dfd1ebc57778d43bc35c356f5ee7330637c517ca8676ad856924b5#1",
  "operation:e8e811268ecdd9843c7222ee6a05ec12b13361a7cb2f44f4f57f453f05f07e7f#1",
];

const LIBRARY = [
  {
    file: "operations/fortuneo-operations.json",
    files: [
      {
        name: "its export",
        bytes: fortuneoExport(FORTUNEO_ROWS),
        read: FORTUNEO_READ,
        keys: FORTUNEO_KEYS,
        // The amount's currency, `Devise`, where the header puts it.
        refused: { line: 2, column: 10 },
      },
      {
        name: "its columns in another order",
        bytes: fortuneoExport(
          FORTUNEO_ROWS.map((row) => [...row].reverse()),
          [...FORTUNEO_HEADER].reverse(),
        ),
        read: FORTUNEO_READ,
        keys: FORTUNEO_KEYS,
        refused: { line: 2, column: 1 },
      },
    ],
  },
  {
    file: "operations/degiro-transactions.json",
    files: [
      {
        name: "its Transactions.csv",
        bytes: degiroExport(DEGIRO_ROWS),
        read: DEGIRO_READ,
        keys: DEGIRO_KEYS,
        // The total's currency, in the unnamed column after `Total`.
        refused: { line: 2, column: 18 },
      },
    ],
  },
];

describe.each(LIBRARY)("the library's $file", ({ file, files }) => {
  test("is the JSON a profile's export writes, marked as guessed", () => {
    const profile = imported(file);

    expect(`${JSON.stringify(Schema.encodeSync(CsvDefinition)(profile), null, 2)}\n`).toBe(
      libraryFile(file),
    );
    expect(profile.description).toMatch(/^Guessed/);
  });

  test.each(files)(
    "reads $name as the layout did, keys included",
    ({ bytes, read: rows, keys }) => {
      const exit = read(bytes, imported(file));
      const operations = Exit.isSuccess(exit) ? exit.value.operations : [];

      expect(Exit.isSuccess(exit)).toBe(true);
      expect(operations).toEqual(rows);
      expect(keysOf(operations)).toEqual(keys);
    },
  );

  test.each(files)("refuses $name in dollars at the amount's currency", ({ bytes, refused }) => {
    const exit = read(bytes, imported(file), "USD");
    const error = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

    expect(error).toBeInstanceOf(UnsupportedContent);
    expect(error).toMatchObject(refused);
  });
});
