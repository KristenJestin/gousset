import {
  CsvDefinition,
  OperationKind,
  readCamt053,
  readCsv,
  readMt940,
  readOfx,
  readOperations,
  readQif,
  readsOperations,
} from "@gousset/import";
import type { Operations, ReadError, Statement } from "@gousset/import";
import { Context, Effect, Layer, Schema } from "effect";

// Reading a file with its format's reader. The readers are synchronous: a crafted file can hold
// the thread for seconds, so the app runs them in a worker thread (`StatementReader`), and this
// module is that worker's whole program: it needs nothing but the readers.

/**
 * What the import asks a reader: the file, its format, and what the format does not say itself:
 * the account's currency (QIF and CSV name none) and how to read a CSV file: as a statement, or as
 * a broker's operations. What crosses to the worker thread.
 */
export const ReadRequest = Schema.Struct({
  format: Schema.Literals(["ofx", "qfx", "qif", "camt053", "mt940", "csv"]),
  bytes: Schema.Uint8Array,
  currency: Schema.NullOr(Schema.String),
  csvProfile: Schema.NullOr(CsvDefinition),
});

export type ReadRequest = typeof ReadRequest.Type;

/**
 * Why a file could not be read, as a code the import screen translates (the reader's error, by its
 * tag), and the file's line when the reader names one. Never the file's text: the code is what the
 * import keeps and what telemetry may see.
 */
export class ReadFailed extends Schema.TaggedError<ReadFailed>()("ReadFailed", {
  code: Schema.String,
  line: Schema.NullOr(Schema.Number),
}) {}

const Text = Schema.NullOr(Schema.String);
const Balance = Schema.NullOr(Schema.Struct({ amountMinor: Schema.Number, on: Schema.String }));

/** An operation of a broker's file, as `@gousset/import` reads it (`OperationRow`). */
const ReadOperation = Schema.Struct({
  line: Schema.Number,
  kind: OperationKind,
  bookedOn: Schema.String,
  valueOn: Text,
  amountMinor: Schema.Number,
  isin: Text,
  securityName: Text,
  securityCurrency: Text,
  quantity: Text,
  unitPrice: Text,
  feesMinor: Schema.Number,
  label: Text,
  reference: Text,
  referenceUnique: Schema.Boolean,
});

export type ReadOperation = typeof ReadOperation.Type;

/**
 * A statement as the import keeps it from a reader: what crosses from the worker thread. A
 * broker's file has no lines but its `operations`, `null` for any other file.
 */
export const ReadStatement = Schema.Struct({
  currency: Schema.String,
  lines: Schema.Array(
    Schema.Struct({
      bookedOn: Schema.String,
      valueOn: Text,
      amountMinor: Schema.Number,
      label: Schema.String,
      memo: Text,
      bankId: Text,
      counterparty: Schema.NullOr(Schema.Struct({ name: Text, iban: Text })),
      original: Schema.NullOr(
        Schema.Struct({ amountMinor: Schema.Number, currency: Schema.String }),
      ),
    }),
  ),
  openingBalance: Balance,
  balance: Balance,
  account: Schema.NullOr(Schema.Struct({ iban: Text, number: Text })),
  operations: Schema.NullOr(Schema.Array(ReadOperation)),
});

export type ReadStatement = typeof ReadStatement.Type;

/** What the worker thread answers: the statement, or why it could not be read. */
export const ReadOutcome = Schema.Union([
  Schema.Struct({ statement: ReadStatement }),
  Schema.Struct({
    failed: Schema.Struct({ code: Schema.String, line: Schema.NullOr(Schema.Number) }),
  }),
]);

export type ReadOutcome = typeof ReadOutcome.Type;

const failedAt = (code: string, line: number | null) => new ReadFailed({ code, line });

function keep(statement: Statement): ReadStatement {
  return {
    currency: statement.currency,
    lines: statement.lines.map((line) => ({
      bookedOn: line.bookedOn,
      valueOn: line.valueOn,
      amountMinor: line.amountMinor,
      label: line.label,
      memo: line.memo,
      bankId: line.bankId,
      counterparty: line.counterparty,
      original: line.original ?? null,
    })),
    openingBalance: statement.openingBalance,
    balance: statement.balance,
    account: statement.account,
    operations: null,
  };
}

/** A broker's file as the import keeps it: its operations, in the account's currency. */
function keepOperations(read: Operations): ReadStatement {
  return {
    currency: read.currency,
    lines: [],
    openingBalance: null,
    balance: null,
    account: null,
    operations: read.operations,
  };
}

/** A currency the format needs from its account, or a refusal: no reader guesses one. */
function currencyOf(request: ReadRequest): Effect.Effect<string, ReadFailed> {
  return request.currency === null
    ? Effect.fail(failedAt("NEEDS_CURRENCY", null))
    : Effect.succeed(request.currency);
}

function read(request: ReadRequest): Effect.Effect<ReadStatement, ReadError | ReadFailed> {
  const { bytes, csvProfile } = request;

  switch (request.format) {
    case "ofx":
    case "qfx": {
      return Effect.map(readOfx(bytes), keep);
    }

    case "camt053": {
      return Effect.map(readCamt053(bytes), keep);
    }

    case "mt940": {
      return Effect.map(readMt940(bytes), keep);
    }

    case "qif": {
      return Effect.flatMap(currencyOf(request), (currency) =>
        Effect.map(readQif(bytes, { currency }), keep),
      );
    }

    case "csv": {
      if (csvProfile === null) {
        return Effect.fail(failedAt("NEEDS_PROFILE", null));
      }

      return Effect.flatMap(currencyOf(request), (currency) =>
        readsOperations(csvProfile)
          ? Effect.map(readOperations(bytes, csvProfile, { currency }), keepOperations)
          : Effect.map(readCsv(bytes, csvProfile, { currency }), keep),
      );
    }
  }
}

/** Reads a file with its format's reader, in this thread. */
export function readStatement(request: ReadRequest): Effect.Effect<ReadStatement, ReadFailed> {
  return read(request).pipe(
    // The reader's tag is the code; its words, which quote the file, stay behind.
    Effect.catchTags({
      NotAStatement: () => Effect.fail(failedAt("NotAStatement", null)),
      InvalidOption: () => Effect.fail(failedAt("InvalidOption", null)),
      MalformedFile: (error) => Effect.fail(failedAt("MalformedFile", error.line)),
      MissingField: (error) => Effect.fail(failedAt("MissingField", error.line)),
      InvalidField: (error) => Effect.fail(failedAt("InvalidField", error.line)),
      UnsupportedContent: (error) => Effect.fail(failedAt("UnsupportedContent", error.line)),
    }),
  );
}

/** The outcome of a read, as the worker thread posts it back. */
export function readOutcome(request: ReadRequest): Effect.Effect<ReadOutcome> {
  return readStatement(request).pipe(
    Effect.match({
      onSuccess: (statement) => ({ statement }),
      onFailure: (failed) => ({ failed: { code: failed.code, line: failed.line } }),
    }),
  );
}

/** Where the import reads its files: a worker thread in the app, this thread in tests. */
export class StatementReader extends Context.Service<
  StatementReader,
  { readonly read: (request: ReadRequest) => Effect.Effect<ReadStatement, ReadFailed> }
>()("@gousset/core/StatementReader") {}

/** Reads in this thread: tests, and development, where no worker is built. */
export const inlineStatementReader = Layer.succeed(StatementReader, { read: readStatement });
