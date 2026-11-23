import { ImportJobs, Imports, importsLayer, inlineStatementReader, runImport } from "@gousset/core";
import type { ImportSummary } from "@gousset/core";
import { account, statementLine } from "@gousset/db/schema/ledger";
import { writeStatement } from "@gousset/fixture";
import type { Statement, StatementFormat } from "@gousset/fixture";
import { asc, eq } from "drizzle-orm";
import { Effect, Layer } from "effect";

import type { openUserData } from "./user-data";

type UserDataAccess = ReturnType<typeof openUserData>;

/**
 * Imports run as the app runs them, without its queue: a file is kept as the upload keeps it, then
 * the import's job is run here, on the worker's database, by `@gousset/core` itself. What the job
 * queue adds (retries, progress) is the jobs spec's and the import screen's.
 */
export function importsOn(data: UserDataAccess) {
  // The queue is not this harness's: a job is given an id and run below, by hand, so that no job
  // is ever under way between two calls.
  const noQueue = Layer.succeed(ImportJobs, {
    send: () => Effect.sync(() => crypto.randomUUID()),
    isOver: () => Effect.succeed(true),
  });

  const imports = importsLayer.pipe(Layer.provide(Layer.mergeAll(data.layer, noQueue)));

  const withImports = <A, E>(work: (service: Imports["Service"]) => Effect.Effect<A, E>) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* Imports;

        return yield* work(service);
      }).pipe(Effect.provide(imports)),
    );

  /** Runs the import's job once, as an attempt of the queue would. */
  const run = (owner: string, importId: string) =>
    Effect.runPromise(
      runImport(owner, { importId, csvProfile: null }, () => Effect.void).pipe(
        Effect.provide(Layer.mergeAll(data.layer, inlineStatementReader)),
      ),
    );

  return {
    run,

    /** Keeps the file for the account and runs its import to the end; its summary. */
    async importFile(
      owner: string,
      accountId: string | null,
      file: { fileName: string; contents: string },
    ): Promise<ImportSummary & { sameFile: boolean }> {
      const { started, sameFile } = await withImports((service) =>
        service.start(owner, {
          fileName: file.fileName,
          content: new TextEncoder().encode(file.contents),
          format: null,
          accountId,
        }),
      );

      await run(owner, started.id);

      return {
        ...(await withImports((service) => service.show(owner, started.id))),
        sameFile: sameFile !== null,
      };
    },

    undo: (owner: string, importId: string) =>
      withImports((service) => service.undo(owner, importId)),

    show: (owner: string, importId: string) =>
      withImports((service) => service.show(owner, importId)),

    /** A new current account in euros, with this IBAN when given. */
    async createAccount(owner: string, name: string, iban: string | null = null): Promise<string> {
      const [created] = await data.asUser(owner, (transaction) =>
        transaction
          .insert(account)
          .values({ userId: owner, name, kind: "current", currency: "EUR", iban })
          .returning({ id: account.id }),
      );

      if (created === undefined) {
        throw new Error("The account was not created.");
      }

      return created.id;
    },

    /** The account's lines, as the bank wrote them, in the account's order. */
    linesOf: (owner: string, accountId: string) =>
      data.asUser(owner, (transaction) =>
        transaction
          .select({
            bookedOn: statementLine.bookedOn,
            amountMinor: statementLine.amountMinor,
            label: statementLine.label,
            state: statementLine.state,
            importId: statementLine.importId,
            duplicateOfLineId: statementLine.duplicateOfLineId,
          })
          .from(statementLine)
          .where(eq(statementLine.accountId, accountId))
          .orderBy(asc(statementLine.bookedOn), asc(statementLine.id)),
      ),
  };
}

/** The statement written in a format, under a name of its own. */
export function statementFile(format: StatementFormat, statement: Statement, fileName?: string) {
  const file = writeStatement(format, statement);

  return { fileName: fileName ?? file.fileName, contents: file.contents };
}
