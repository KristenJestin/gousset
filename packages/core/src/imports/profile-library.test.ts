import { readFileSync } from "node:fs";

import {
  DEGIRO_ROWS,
  FORTUNEO_HEADER,
  FORTUNEO_ROWS,
  degiroExport,
  fortuneoExport,
} from "@gousset/fixture";
import {
  CsvDefinition,
  readOperations,
  readsOperations,
  shippedOperationsProfile,
} from "@gousset/import";
import type { OperationRow, Operations, OperationsProfile, ReadError } from "@gousset/import";
import { Effect, Exit, Result, Schema } from "effect";
import { describe, expect, test } from "vite-plus/test";

import { checkOperation } from "../investments/operation-input";
import { operationDedupKeys } from "./operation-keys";

// The library of profiles (`packages/import/profiles/`, its README): each file is the JSON a user
// exports from Gousset, imported through the profile import as it is, and it reads the invented
// exports of `@gousset/fixture` exactly as the brokers' layouts of #250's part 2 read them: the
// same operations, the words of their kinds included, and the same dedup keys.

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

function layout(key: string): OperationsProfile {
  const shipped = shippedOperationsProfile(key);

  if (shipped === undefined) {
    throw new Error(`No layout is shipped as ${key}.`);
  }

  return shipped.profile;
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

const rowsOf = (exit: Exit.Exit<Operations, ReadError>) =>
  Exit.isSuccess(exit) ? exit.value.operations : [];

const FORTUNEO_FILES = {
  "its export": fortuneoExport(FORTUNEO_ROWS),
  "its columns in another order": fortuneoExport(
    FORTUNEO_ROWS.map((row) => [...row].reverse()),
    [...FORTUNEO_HEADER].reverse(),
  ),
};

const LIBRARY = [
  {
    file: "operations/fortuneo-operations.json",
    layout: "fortuneo-operations",
    files: FORTUNEO_FILES,
  },
  {
    file: "operations/degiro-transactions.json",
    layout: "degiro-transactions",
    files: { "its Transactions.csv": degiroExport(DEGIRO_ROWS) },
  },
];

describe.each(LIBRARY)("the library's $file", ({ file, layout: key, files }) => {
  test("is the JSON a profile's export writes, marked as guessed", () => {
    const profile = imported(file);

    expect(`${JSON.stringify(Schema.encodeSync(CsvDefinition)(profile), null, 2)}\n`).toBe(
      libraryFile(file),
    );
    expect(profile.description).toMatch(/^Guessed/);
  });

  test.each(Object.entries(files))("reads %s as the layout did, keys included", (_, bytes) => {
    const fromLibrary = read(bytes, imported(file));
    const fromLayout = read(bytes, layout(key));

    expect(Exit.isSuccess(fromLibrary)).toBe(true);
    expect(fromLibrary).toEqual(fromLayout);
    expect(keysOf(rowsOf(fromLibrary))).toEqual(keysOf(rowsOf(fromLayout)));
  });

  test.each(Object.entries(files))("refuses %s in dollars as the layout did", (_, bytes) => {
    expect(read(bytes, imported(file), "USD")).toEqual(read(bytes, layout(key), "USD"));
  });
});
