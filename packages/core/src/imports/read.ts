import { CsvProfile, readCamt053, readCsv, readMt940, readOfx, readQif } from "@gousset/import";
import type { ReadError, Statement } from "@gousset/import";
import { Context, Effect, Layer, Schema } from "effect";

// Reading a file with its format's reader. The readers are synchronous: a crafted file can hold
// the thread for seconds, so the app runs them in a worker thread (`StatementReader`), and this
// module is that worker's whole program: it needs nothing but the readers.

/**
 * What the import asks a reader: the file, its format, and what the format does not say itself:
 * the account's currency (QIF and CSV name none) and how to read a CSV file. What crosses to the
 * worker thread.
 */
export const ReadRequest = Schema.Struct({
  format: Schema.Literals(["ofx", "qfx", "qif", "camt053", "mt940", "csv"]),
  bytes: Schema.Uint8Array,
  currency: Schema.NullOr(Schema.String),
  csvProfile: Schema.NullOr(CsvProfile),
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

/** A statement as the import keeps it from a reader: what crosses from the worker thread. */
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
  };
}

/** A currency the format needs from its account, or a refusal: no reader guesses one. */
function currencyOf(request: ReadRequest): Effect.Effect<string, ReadFailed> {
  return request.currency === null
    ? Effect.fail(failedAt("NEEDS_CURRENCY", null))
    : Effect.succeed(request.currency);
}

function read(request: ReadRequest): Effect.Effect<Statement, ReadError | ReadFailed> {
  const { bytes, csvProfile } = request;

  switch (request.format) {
    case "ofx":
    case "qfx": {
      return readOfx(bytes);
    }

    case "camt053": {
      return readCamt053(bytes);
    }

    case "mt940": {
      return readMt940(bytes);
    }

    case "qif": {
      return Effect.flatMap(currencyOf(request), (currency) => readQif(bytes, { currency }));
    }

    case "csv": {
      return csvProfile === null
        ? Effect.fail(failedAt("NEEDS_PROFILE", null))
        : Effect.flatMap(currencyOf(request), (currency) =>
            readCsv(bytes, csvProfile, { currency }),
          );
    }
  }
}

/** Reads a file with its format's reader, in this thread. */
export function readStatement(request: ReadRequest): Effect.Effect<ReadStatement, ReadFailed> {
  return read(request).pipe(
    Effect.map(keep),
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
