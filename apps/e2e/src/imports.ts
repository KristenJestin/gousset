import {
  ImportJobs,
  ImportProfiles,
  Imports,
  importProfilesLayer,
  importsLayer,
  inlineStatementReader,
  markFailed,
  runImport,
} from "@gousset/core";
import type { Answers, ImportJobInput, ImportProgress, ImportSummary } from "@gousset/core";
import { account, statementImport, statementLine } from "@gousset/db/schema/ledger";
import { writeStatement } from "@gousset/fixture";
import type { Statement, StatementFormat } from "@gousset/fixture";
import { asc, eq } from "drizzle-orm";
import { Effect, Layer } from "effect";

import type { openUserData } from "./user-data";

type UserDataAccess = ReturnType<typeof openUserData>;

/** A file to import: its text, kept as UTF-8, or its bytes (a Windows-1252 export). */
type StatementFile =
  | { readonly fileName: string; readonly contents: string }
  | { readonly fileName: string; readonly bytes: Uint8Array };

/**
 * Imports run as the app runs them, without its queue: a file is kept as the upload keeps it, then
 * the import's job is run here, on the worker's database, by `@gousset/core` itself. What the job
 * queue adds (retries, progress) is the jobs spec's and the import screen's.
 */
export function importsOn(data: UserDataAccess) {
  // What the queue says of a job's end: over, unless a test says it still runs.
  let jobsOver = true;

  // The last job sent for each import, which `run` runs as the queue would.
  const sent = new Map<string, ImportJobInput>();

  // The queue is not this harness's: a job is given an id and run below, by hand, so that no job
  // is under way between two calls unless a test says so.
  const noQueue = Layer.succeed(ImportJobs, {
    send: (_owner, input) =>
      Effect.sync(() => {
        sent.set(input.importId, input);

        return crypto.randomUUID();
      }),
    isOver: () => Effect.sync(() => jobsOver),
  });

  const imports = importsLayer.pipe(Layer.provide(Layer.mergeAll(data.layer, noQueue)));
  const profiles = importProfilesLayer.pipe(Layer.provide(data.layer));

  const withImports = <A, E>(work: (service: Imports["Service"]) => Effect.Effect<A, E>) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* Imports;

        return yield* work(service);
      }).pipe(Effect.provide(imports)),
    );

  const withProfiles = <A, E>(work: (service: ImportProfiles["Service"]) => Effect.Effect<A, E>) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* ImportProfiles;

        return yield* work(service);
      }).pipe(Effect.provide(profiles)),
    );

  /**
   * Runs the import's job once, as an attempt of the queue would, with what was last sent for it;
   * `progress` sees each step as it starts, for a test to act in the middle of a run.
   */
  const run = (owner: string, importId: string, progress: ImportProgress = () => Effect.void) =>
    Effect.runPromise(
      runImport(
        owner,
        { importId, csvProfile: sent.get(importId)?.csvProfile ?? null },
        progress,
      ).pipe(Effect.provide(Layer.mergeAll(data.layer, inlineStatementReader))),
    );

  /** Keeps the file as the upload does, its job not run yet; the import's summary. */
  const keep = async (owner: string, accountId: string | null, file: StatementFile) =>
    withImports((service) =>
      service.start(owner, {
        fileName: file.fileName,
        content: "bytes" in file ? file.bytes : new TextEncoder().encode(file.contents),
        format: null,
        accountId,
      }),
    );

  return {
    run,
    keep,
    withImports,
    withProfiles,

    /** Runs a waiting import again with these answers, as the import screen does. */
    resumeWith: (owner: string, importId: string, answers: Answers) =>
      withImports((service) => service.resume(owner, importId, answers)),

    /** The profile an import's row says read its file: one of the user's, or a shipped one. */
    async profileOf(owner: string, importId: string) {
      const [row] = await data.asUser(owner, (transaction) =>
        transaction
          .select({
            profileId: statementImport.profileId,
            shippedProfile: statementImport.shippedProfile,
          })
          .from(statementImport)
          .where(eq(statementImport.id, importId)),
      );

      return row;
    },

    /** Whether the queue says an import's job is over (it does by default). */
    jobsAreOver(over: boolean) {
      jobsOver = over;
    },

    /** What the job's last attempt does when it ends unfinished. */
    markFailed: (owner: string, importId: string, code: string) =>
      Effect.runPromise(markFailed(owner, importId, code).pipe(Effect.provide(data.layer))),

    resume: (owner: string, importId: string, accountId: string | null) =>
      withImports((service) =>
        service.resume(owner, importId, { accountId, csvProfile: null, profile: null }),
      ),

    /** Keeps the file for the account and runs its import to the end; its summary. */
    async importFile(
      owner: string,
      accountId: string | null,
      file: StatementFile,
    ): Promise<ImportSummary & { sameFile: boolean }> {
      const { started, sameFile } = await keep(owner, accountId, file);

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
