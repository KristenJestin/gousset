import { createHash } from "node:crypto";

import {
  account,
  accountBalance,
  importFile,
  statementImport,
  statementLine,
} from "@gousset/db/schema/ledger";
import { UserData } from "@gousset/db/user-data";
import type { QueryFailed, UserTransaction } from "@gousset/db/user-data";
import { detectCsvProfile, detectFormat } from "@gousset/import";
import type { CsvProfile, CsvUnsure } from "@gousset/import";
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import type { ImportUnavailable } from "./errors";
import {
  AccountNotFound,
  EmptyFile,
  FileTooLarge,
  ImportBusy,
  ImportNotFound,
  UnknownFormat,
} from "./errors";
import type { ImportFormat } from "./keys";
import { findSummary, isId, selectSummaries, summaryOf } from "./rows";
import type { ImportSummary } from "./rows";
import type { ImportJobInput } from "./run";

// Importing statements (#20), as the import screen and the MCP door both do it: a file dropped
// becomes an import and its job; the screen follows the job, answers what the file left open,
// lists the imports and undoes one.

/** The largest file an import takes: a statement is a few hundred kilobytes. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** How many imports a page of the list holds at most. */
export const IMPORTS_LISTED = 50;

/** Where the import's job goes: the app's job queue (`apps/web`), which runs `runImport`. */
export class ImportJobs extends Context.Service<
  ImportJobs,
  {
    /** Sends the import's job for `owner`; its id, which the screen follows. */
    readonly send: (
      owner: string,
      input: ImportJobInput,
    ) => Effect.Effect<string, ImportUnavailable>;
  }
>()("@gousset/core/ImportJobs") {}

/** A file dropped: its bytes, its name, and the format and account when the user named them. */
export type Upload = {
  readonly fileName: string;
  readonly content: Uint8Array;
  readonly format: ImportFormat | null;
  readonly accountId: string | null;
};

/** An import started, and the import of the same file done before, when there is one. */
export type Started = {
  readonly started: ImportSummary;
  readonly sameFile: { readonly fileName: string; readonly importedAt: string } | null;
};

/** A page of imports, newest first; `next` is the id to pass as `before` for the next page. */
export type ImportPage = {
  readonly imports: ReadonlyArray<ImportSummary>;
  readonly next: string | null;
};

/**
 * What undoing removed: the import's lines (counted, held and discarded), the lines of other
 * imports it gave back (held as near duplicates of its lines, counted again), and the later imports
 * of the account whose period overlaps it, which skipped some of its lines as duplicates.
 */
export type Undone = {
  readonly undone: ImportSummary;
  readonly linesRemoved: number;
  readonly linesGivenBack: number;
  readonly laterOverlapping: number;
  readonly months: ReadonlyArray<string>;
};

/** An account an import may go to. */
export type ImportAccount = {
  readonly id: string;
  readonly name: string;
  readonly currency: string;
  readonly institution: string | null;
};

/** How a waiting CSV import's file reads, as far as detection could tell, and what it left open. */
export type CsvQuestions = {
  readonly profile: CsvProfile;
  /** The header's columns, normalised (lower case), in order; empty when the file has none. */
  readonly header: ReadonlyArray<string>;
  readonly unsure: ReadonlyArray<CsvUnsure>;
};

/** What the user answers a waiting import: its account, and how to read its CSV. */
export type Answers = {
  readonly accountId: string | null;
  readonly csvProfile: CsvProfile | null;
};

type Failure = QueryFailed;

/** Importing statements, for the user `owner` of each call. */
export class Imports extends Context.Service<
  Imports,
  {
    /**
     * Keeps the file and starts its import: refused when it is empty, over `MAX_FILE_BYTES`, in no
     * format the file or the user names, or for an account the user does not have.
     */
    readonly start: (
      owner: string,
      upload: Upload,
    ) => Effect.Effect<
      Started,
      EmptyFile | FileTooLarge | UnknownFormat | AccountNotFound | ImportUnavailable | Failure
    >;
    readonly show: (
      owner: string,
      importId: string,
    ) => Effect.Effect<ImportSummary, ImportNotFound | Failure>;
    /** The imports, newest first, `IMPORTS_LISTED` a page, from before the import `before`. */
    readonly list: (owner: string, before: string | null) => Effect.Effect<ImportPage, Failure>;
    /**
     * Removes exactly what the import added: its lines and balances, and its file; the lines of
     * other imports held as near duplicates of its lines count again. Refused while it runs.
     */
    readonly undo: (
      owner: string,
      importId: string,
    ) => Effect.Effect<Undone, ImportNotFound | ImportBusy | Failure>;
    /**
     * Runs a waiting or failed import again, with the user's answers: its account, how to read its
     * CSV. Refused for an import that runs, is done or undone.
     */
    readonly resume: (
      owner: string,
      importId: string,
      answers: Answers,
    ) => Effect.Effect<
      ImportSummary,
      ImportNotFound | ImportBusy | AccountNotFound | ImportUnavailable | Failure
    >;
    /** The accounts an import may go to: the open ones, by name. */
    readonly accounts: (owner: string) => Effect.Effect<ReadonlyArray<ImportAccount>, Failure>;
    /** What detection proposes for a CSV import's file, and what it left open. */
    readonly csvQuestions: (
      owner: string,
      importId: string,
    ) => Effect.Effect<CsvQuestions, ImportNotFound | Failure>;
  }
>()("@gousset/core/Imports") {}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function accountExists(transaction: UserTransaction, accountId: string): Promise<boolean> {
  if (!isId(accountId)) {
    return false;
  }

  const [found] = await transaction
    .select({ id: account.id })
    .from(account)
    .where(eq(account.id, accountId));

  return found !== undefined;
}

/** An import may be run again only when it waits for the user or failed. */
const RESUMABLE = new Set(["waiting", "failed"]);

/** An import may be undone once nothing runs it. */
const UNDOABLE = new Set(["done", "waiting", "failed"]);

/** `Imports` on the database (`UserData`) and the app's job queue (`ImportJobs`). */
export const importsLayer = Layer.effect(
  Imports,
  Effect.gen(function* () {
    const userData = yield* UserData;
    const jobs = yield* ImportJobs;

    const inTransaction = <A>(owner: string, work: (transaction: UserTransaction) => Promise<A>) =>
      userData.transaction(owner, work);

    const show = (owner: string, importId: string) =>
      inTransaction(owner, (transaction) => findSummary(transaction, importId)).pipe(
        Effect.flatMap((found) =>
          found === undefined
            ? Effect.fail(new ImportNotFound({ importId }))
            : Effect.succeed(found),
        ),
      );

    /** Sends the import's job and keeps its id; an import the queue did not take has failed. */
    const sendJob = (owner: string, importId: string, csvProfile: CsvProfile | null) =>
      jobs.send(owner, { importId, csvProfile }).pipe(
        Effect.tapError(() =>
          inTransaction(owner, (transaction) =>
            transaction
              .update(statementImport)
              .set({ status: "failed", errorCode: "QUEUE_UNAVAILABLE" })
              .where(eq(statementImport.id, importId)),
          ).pipe(Effect.ignore),
        ),
        Effect.flatMap((jobId) =>
          inTransaction(owner, (transaction) =>
            transaction
              .update(statementImport)
              .set({ jobId })
              .where(eq(statementImport.id, importId)),
          ),
        ),
      );

    return {
      start: (owner, upload) =>
        Effect.gen(function* () {
          const bytes = upload.content.byteLength;

          if (bytes === 0) {
            return yield* new EmptyFile();
          }

          if (bytes > MAX_FILE_BYTES) {
            return yield* new FileTooLarge({ bytes, limit: MAX_FILE_BYTES });
          }

          const format = upload.format ?? detectFormat(upload.content, upload.fileName);

          if (format === null) {
            return yield* new UnknownFormat();
          }

          const fileSha256 = sha256(upload.content);
          const { accountId } = upload;

          const created = yield* inTransaction(owner, async (transaction) => {
            if (accountId !== null && !(await accountExists(transaction, accountId))) {
              return undefined;
            }

            const [same] = await transaction
              .select({ fileName: statementImport.fileName, createdAt: statementImport.createdAt })
              .from(statementImport)
              .where(
                and(eq(statementImport.fileSha256, fileSha256), eq(statementImport.status, "done")),
              )
              .orderBy(desc(statementImport.id))
              .limit(1);

            const [row] = await transaction
              .insert(statementImport)
              .values({ userId: owner, accountId, fileName: upload.fileName, fileSha256, format })
              .returning({ id: statementImport.id });

            if (row === undefined) {
              throw new Error("The insert returned no row.");
            }

            await transaction
              .insert(importFile)
              .values({ importId: row.id, userId: owner, content: Buffer.from(upload.content) });

            return {
              id: row.id,
              sameFile:
                same === undefined
                  ? null
                  : { fileName: same.fileName, importedAt: same.createdAt.toISOString() },
            };
          });

          if (created === undefined) {
            return yield* new AccountNotFound({ accountId: accountId ?? "" });
          }

          yield* sendJob(owner, created.id, null);

          return {
            started: yield* show(owner, created.id).pipe(Effect.orDie),
            sameFile: created.sameFile,
          };
        }),

      show,

      list: (owner, before) =>
        inTransaction(owner, async (transaction) => {
          const rows = await selectSummaries(transaction)
            .where(before === null || !isId(before) ? undefined : lt(statementImport.id, before))
            .orderBy(desc(statementImport.id))
            .limit(IMPORTS_LISTED + 1);

          const page = rows.slice(0, IMPORTS_LISTED).map(summaryOf);
          const last = page.at(-1);

          return {
            imports: page,
            next: rows.length > IMPORTS_LISTED && last !== undefined ? last.id : null,
          };
        }),

      undo: (owner, importId) =>
        Effect.gen(function* () {
          const found = yield* show(owner, importId);

          if (!UNDOABLE.has(found.status)) {
            return yield* new ImportBusy({ importId, status: found.status });
          }

          const counts = yield* inTransaction(owner, async (transaction) => {
            const own = transaction
              .select({ id: statementLine.id })
              .from(statementLine)
              .where(eq(statementLine.importId, importId));

            // Lines of other imports held or discarded as near duplicates of this import's lines
            // lose what they duplicated: they count again.
            const givenBack = await transaction
              .update(statementLine)
              .set({ state: "counted", duplicateOfLineId: null })
              .where(
                and(
                  inArray(statementLine.duplicateOfLineId, own),
                  or(isNull(statementLine.importId), ne(statementLine.importId, importId)),
                ),
              )
              .returning({ bookedOn: statementLine.bookedOn });

            const removed = await transaction
              .delete(statementLine)
              .where(eq(statementLine.importId, importId))
              .returning({ bookedOn: statementLine.bookedOn });

            await transaction.delete(accountBalance).where(eq(accountBalance.importId, importId));
            await transaction.delete(importFile).where(eq(importFile.importId, importId));

            await transaction
              .update(statementImport)
              .set({ status: "undone", undoneAt: new Date() })
              .where(eq(statementImport.id, importId));

            const overlapping =
              found.account === null || found.periodFrom === null || found.periodTo === null
                ? []
                : await transaction
                    .select({ id: statementImport.id })
                    .from(statementImport)
                    .where(
                      and(
                        eq(statementImport.accountId, found.account.id),
                        eq(statementImport.status, "done"),
                        gt(statementImport.id, importId),
                        sql`${statementImport.periodFrom} <= ${found.periodTo}`,
                        sql`${statementImport.periodTo} >= ${found.periodFrom}`,
                      ),
                    );

            const months = new Set(
              [...removed, ...givenBack].map((line) => line.bookedOn.slice(0, 7)),
            );

            return {
              linesRemoved: removed.length,
              linesGivenBack: givenBack.length,
              laterOverlapping: overlapping.length,
              months: [...months].toSorted(),
            };
          });

          return { undone: yield* show(owner, importId), ...counts };
        }),

      resume: (owner, importId, answers) =>
        Effect.gen(function* () {
          const found = yield* show(owner, importId);

          if (!RESUMABLE.has(found.status)) {
            return yield* new ImportBusy({ importId, status: found.status });
          }

          const { accountId } = answers;

          const accepted = yield* inTransaction(owner, async (transaction) => {
            if (accountId !== null && !(await accountExists(transaction, accountId))) {
              return false;
            }

            await transaction
              .update(statementImport)
              .set({
                status: "queued",
                errorCode: null,
                accountId: accountId ?? found.account?.id ?? null,
              })
              .where(eq(statementImport.id, importId));

            return true;
          });

          if (!accepted) {
            return yield* new AccountNotFound({ accountId: accountId ?? "" });
          }

          yield* sendJob(owner, importId, answers.csvProfile);

          return yield* show(owner, importId);
        }),

      accounts: (owner) =>
        inTransaction(owner, (transaction) =>
          transaction
            .select({
              id: account.id,
              name: account.name,
              currency: account.currency,
              institution: account.institution,
            })
            .from(account)
            .where(isNull(account.closedOn))
            .orderBy(asc(account.name), asc(account.id)),
        ),

      csvQuestions: (owner, importId) =>
        Effect.gen(function* () {
          const content = yield* inTransaction(owner, async (transaction) => {
            if (!isId(importId)) {
              return undefined;
            }

            const [row] = await transaction
              .select({ content: importFile.content })
              .from(importFile)
              .innerJoin(statementImport, eq(statementImport.id, importFile.importId))
              .where(and(eq(importFile.importId, importId), eq(statementImport.format, "csv")));

            return row?.content;
          });

          if (content === undefined) {
            return yield* new ImportNotFound({ importId });
          }

          // Detection reads the top of the file only (a mebibyte at most).
          return yield* detectCsvProfile(content).pipe(
            Effect.map((proposal) => ({
              profile: proposal.profile,
              header: proposal.header === null ? [] : proposal.header.split(";"),
              unsure: proposal.unsure,
            })),
            Effect.catchTags({
              NotAStatement: () => Effect.fail(new ImportNotFound({ importId })),
              MalformedFile: () => Effect.fail(new ImportNotFound({ importId })),
              MissingField: () => Effect.fail(new ImportNotFound({ importId })),
              InvalidField: () => Effect.fail(new ImportNotFound({ importId })),
              UnsupportedContent: () => Effect.fail(new ImportNotFound({ importId })),
              InvalidOption: () => Effect.fail(new ImportNotFound({ importId })),
            }),
          );
        }),
    };
  }),
);
