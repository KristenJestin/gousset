import { Imports } from "@gousset/core";
import type { ImportSummary } from "@gousset/core/imports";
import { CsvProfile } from "@gousset/import";
import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";

import { runCore } from "@/services";

import { signedIn } from "./month";

// The import screen's calls (#20), on `@gousset/core`'s `Imports`, as the MCP door's `imports`
// tool makes them. A file is uploaded by `/api/imports`, which caps its size as it reads it.

const ImportInput = Schema.toStandardSchemaV1(Schema.Struct({ importId: Schema.String }));

/** A refusal, as a code the screen translates. */
type Refused = { readonly refused: string };

/** The import, or `null` when the user has none with this id. */
export const getImport = createServerFn({ method: "GET" })
  .middleware([signedIn])
  .validator(ImportInput)
  .handler(({ data, context }) =>
    runCore(
      Imports.use((imports) => imports.show(context.owner, data.importId)).pipe(
        Effect.catchTag("ImportNotFound", () => Effect.succeed(null)),
      ),
    ),
  );

/** The user's imports, newest first, a page at a time. */
export const listImports = createServerFn({ method: "GET" })
  .middleware([signedIn])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ before: Schema.NullOr(Schema.String) })))
  .handler(({ data, context }) =>
    runCore(Imports.use((imports) => imports.list(context.owner, data.before))),
  );

/** The accounts a file may go to. */
export const getImportAccounts = createServerFn({ method: "GET" })
  .middleware([signedIn])
  .handler(({ context }) => runCore(Imports.use((imports) => imports.accounts(context.owner))));

/** What detection proposes for a waiting CSV import, and what it left open; `null` for none. */
export const getCsvQuestions = createServerFn({ method: "GET" })
  .middleware([signedIn])
  .validator(ImportInput)
  .handler(({ data, context }) =>
    runCore(
      Imports.use((imports) => imports.csvQuestions(context.owner, data.importId)).pipe(
        Effect.catchTag("ImportNotFound", () => Effect.succeed(null)),
      ),
    ),
  );

/** Runs a waiting or failed import again with the user's answers: its account, how to read it. */
export const resumeImport = createServerFn({ method: "POST" })
  .middleware([signedIn])
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({
        importId: Schema.String,
        accountId: Schema.NullOr(Schema.String),
        csvProfile: Schema.NullOr(CsvProfile),
      }),
    ),
  )
  .handler(({ data, context }) =>
    runCore(
      Imports.use((imports) =>
        imports.resume(context.owner, data.importId, {
          accountId: data.accountId,
          csvProfile: data.csvProfile,
        }),
      ).pipe(
        Effect.map((resumed): { resumed: ImportSummary } | Refused => ({ resumed })),
        Effect.catchTags({
          ImportNotFound: () => Effect.succeed({ refused: "IMPORT_NOT_FOUND" }),
          ImportBusy: () => Effect.succeed({ refused: "IMPORT_BUSY" }),
          AccountNotFound: () => Effect.succeed({ refused: "ACCOUNT_NOT_FOUND" }),
          ImportUnavailable: () => Effect.succeed({ refused: "IMPORT_UNAVAILABLE" }),
        }),
      ),
    ),
  );

/**
 * Undoes an import: removes exactly its lines and balances, and counts again the lines of other
 * imports held as near duplicates of them. Refused while it runs.
 */
export const undoImport = createServerFn({ method: "POST" })
  .middleware([signedIn])
  .validator(ImportInput)
  .handler(({ data, context }) =>
    runCore(
      Imports.use((imports) => imports.undo(context.owner, data.importId)).pipe(
        Effect.map((undone) => ({
          undone: undone.undone,
          linesRemoved: undone.linesRemoved,
          linesGivenBack: undone.linesGivenBack,
          laterOverlapping: undone.laterOverlapping,
          months: [...undone.months],
        })),
        Effect.catchTags({
          ImportNotFound: () => Effect.succeed({ refused: "IMPORT_NOT_FOUND" }),
          ImportBusy: () => Effect.succeed({ refused: "IMPORT_BUSY" }),
        }),
      ),
    ),
  );
