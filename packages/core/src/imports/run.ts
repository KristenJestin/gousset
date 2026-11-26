import {
  account,
  accountBalance,
  importFile,
  statementImport,
  statementLine,
} from "@gousset/db/schema/ledger";
import { UserData } from "@gousset/db/user-data";
import type { QueryFailed, UserTransaction } from "@gousset/db/user-data";
import { CsvProfile, detectCsvProfile } from "@gousset/import";
import {
  and,
  asc,
  count,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { Effect, Schema } from "effect";

import { remakeBalanceLines } from "../balance-lines";
import { balanceAt, looksEmpty } from "../balances";
import { takeCategoryTurn } from "../category-turn";
import { entriesForLines } from "../entries";
import { matchTopUpsIn } from "../expenses/top-ups";
import { recogniseIn } from "../merchants/merchants";
import { applyRulesToImport } from "../rules/rules";
import { ImportFailed } from "./errors";
import { dedupKeys, NEAR_DAYS, nearDuplicates } from "./keys";
import type { ExistingLine, ImportFormat, ReadLine } from "./keys";
import { StatementReader } from "./read";
import type { ReadStatement } from "./read";
import { matchProfile, profileCandidates } from "./profiles";
import { pairTransfers } from "../transfers/pair-lines";
import { isId } from "./rows";
import type { ImportStep } from "./summary";

// The import's job (docs/architecture.md, "Background jobs"): read the file, deduplicate its
// lines against the account's, save what is new. Each attempt runs it again from the start, so
// every step is safe to run twice: what an earlier attempt saved is the import's own and is kept,
// and the counts are read back from the lines, never added up.

/** What the job is sent: the import, and how to read its CSV once the user said so. */
export const ImportJobInput = Schema.Struct({
  importId: Schema.String,
  csvProfile: Schema.NullOr(CsvProfile),
});

export type ImportJobInput = typeof ImportJobInput.Type;

/** Where the job reports its step, and how much of it is done when it counts lines. */
export type ImportProgress = (
  step: ImportStep,
  counts?: { readonly done: number; readonly total: number },
) => Effect.Effect<void>;

/** What an import's run changed: the months of its lines, for the pages to read again. */
export type ImportRun = { readonly months: ReadonlyArray<string> };

/** How many lines one insert writes, and the screen's progress moves by. */
const CHUNK = 200;

/**
 * The name an import's transactions give their connection (`application_name`, for the
 * transaction only): what a save that lasts finds them by in `pg_stat_activity` (#241). Its id
 * alone, never what the file holds.
 */
export const importConnectionName = (importId: string) => `gousset-import:${importId}`;

const nothing: ImportRun = { months: [] };

/**
 * The statuses in which an import is its job's to move on. Any other (waiting, done, undone) was
 * decided meanwhile, by the user or by another attempt: the job then stops where it is.
 */
const RUNS: ReadonlySet<string> = new Set(["queued", "reading", "saving", "failed"]);

/** The import was undone or answered while the job ran: it stops, writing nothing more. */
class ImportTaken extends Schema.TaggedError<ImportTaken>()("ImportTaken", {}) {}

/**
 * Locks the import's row until the transaction ends, and says whether its job may still write:
 * an undo or an answer, which take the same lock, waits for this transaction, or this one for it.
 */
async function stillRuns(transaction: UserTransaction, importId: string): Promise<boolean> {
  const [row] = await transaction
    .select({ status: statementImport.status })
    .from(statementImport)
    .where(eq(statementImport.id, importId))
    .for("update");

  return row !== undefined && RUNS.has(row.status);
}

const DAY_MS = 86_400_000;

function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The account a statement names, when exactly one of the user's accounts is it. */
async function recognise(
  transaction: UserTransaction,
  named: ReadStatement["account"],
): Promise<{ id: string; currency: string } | undefined> {
  const columns = { id: account.id, currency: account.currency };
  const iban = named?.iban ?? null;
  const number = named?.number ?? null;

  if (iban !== null) {
    const [found] = await transaction.select(columns).from(account).where(eq(account.iban, iban));

    if (found !== undefined) {
      return found;
    }
  }

  if (number !== null) {
    // A number is unique only with its bank: two accounts with it, and the user chooses.
    const found = await transaction
      .select(columns)
      .from(account)
      .where(eq(account.number, number))
      .limit(2);

    if (found.length === 1) {
      return found[0];
    }
  }

  return undefined;
}

/**
 * The account's balance at the end of `day`, as the account page's check computes it
 * (`balanceAt`): what a statement balance of that day is compared with. The account is the
 * import's, which the lock on the import keeps.
 */
async function balanceOn(
  transaction: UserTransaction,
  accountId: string,
  day: string,
): Promise<number> {
  const [found] = await transaction
    .select({ mode: account.mode, openingBalanceMinor: account.openingBalanceMinor })
    .from(account)
    .where(eq(account.id, accountId));

  const [counted] = await transaction
    .select({
      minor: sql<number>`coalesce(sum(${statementLine.amountMinor}), 0)::bigint`.mapWith(Number),
    })
    .from(statementLine)
    .where(
      and(
        eq(statementLine.accountId, accountId),
        eq(statementLine.state, "counted"),
        lte(statementLine.bookedOn, day),
      ),
    );

  const noted = await transaction
    .select({ day: accountBalance.day, minor: accountBalance.balanceMinor })
    .from(accountBalance)
    .where(
      and(
        eq(accountBalance.accountId, accountId),
        eq(accountBalance.source, "noted"),
        lte(accountBalance.day, day),
      ),
    )
    .orderBy(asc(accountBalance.day), asc(accountBalance.id));

  return balanceAt(
    found ?? { mode: "lines", openingBalanceMinor: 0 },
    counted?.minor ?? 0,
    noted,
    day,
  );
}

type Loaded = {
  readonly status: string;
  readonly format: ImportFormat;
  readonly account: { readonly id: string; readonly currency: string } | undefined;
  readonly bytes: Uint8Array;
};

async function load(transaction: UserTransaction, importId: string): Promise<Loaded | undefined> {
  const [row] = await transaction
    .select({
      status: statementImport.status,
      format: statementImport.format,
      accountId: account.id,
      currency: account.currency,
      content: importFile.content,
    })
    .from(statementImport)
    .leftJoin(account, eq(account.id, statementImport.accountId))
    .leftJoin(importFile, eq(importFile.importId, statementImport.id))
    .where(eq(statementImport.id, importId));

  if (row === undefined) {
    return undefined;
  }

  return {
    status: row.status,
    format: row.format,
    account:
      row.accountId === null || row.currency === null
        ? undefined
        : { id: row.accountId, currency: row.currency },
    bytes: row.content ?? new Uint8Array(),
  };
}

/** A line read, with its key, in the file's order. */
type Keyed = ReadStatement["lines"][number] & { readonly dedupKey: string; readonly order: number };

/** What deduplication decided for the lines that are new: held against a line, or counted. */
type Planned = Keyed & { readonly duplicateOf: string | null };

/**
 * Runs the import `input.importId` of `owner`: reads its file, recognises its account, adds the
 * lines the account does not have yet, holds its near duplicates and keeps its balances. An import
 * that needs the user (its account, how to read its CSV) is left `waiting`, and one already done is
 * left as it is.
 */
export function runImport(
  owner: string,
  input: ImportJobInput,
  progress: ImportProgress,
): Effect.Effect<ImportRun, ImportFailed, UserData | StatementReader> {
  const { importId } = input;

  return Effect.gen(function* () {
    const userData = yield* UserData;
    const reader = yield* StatementReader;

    const inTransaction = <A>(work: (transaction: UserTransaction) => Promise<A>) =>
      userData.transaction(owner, async (transaction) => {
        await transaction.execute(
          sql`select set_config('application_name', ${importConnectionName(importId)}, true)`,
        );

        return work(transaction);
      });

    /** Runs `work` on the import while it is still the job's; stops the run otherwise. */
    const whileRunning = <A>(work: (transaction: UserTransaction) => Promise<A>) =>
      inTransaction(async (transaction) =>
        (await stillRuns(transaction, importId)) ? { done: await work(transaction) } : undefined,
      ).pipe(
        Effect.flatMap((ran) =>
          ran === undefined ? Effect.fail(new ImportTaken()) : Effect.succeed(ran.done),
        ),
      );

    const setStatus = (values: Partial<typeof statementImport.$inferInsert>) =>
      whileRunning((transaction) =>
        transaction.update(statementImport).set(values).where(eq(statementImport.id, importId)),
      );

    const fail = (code: string, retry: boolean) =>
      setStatus({ status: "failed", errorCode: code }).pipe(
        Effect.catchTag("QueryFailed", () => Effect.void),
        Effect.andThen(Effect.fail(new ImportFailed({ code, retry }))),
      );

    const wait = setStatus({ status: "waiting", errorCode: null }).pipe(Effect.as(nothing));

    const loaded = isId(importId)
      ? yield* inTransaction((transaction) => load(transaction, importId))
      : undefined;

    // An attempt left over once the import is over, or before the user answers, does nothing.
    if (loaded === undefined) {
      return yield* new ImportFailed({ code: "IMPORT_NOT_FOUND", retry: false });
    }

    if (!RUNS.has(loaded.status)) {
      return nothing;
    }

    yield* progress("read");
    yield* setStatus({ status: "reading", errorCode: null });

    // QIF and CSV name neither their account nor their currency: the user chooses the account.
    const namesNoAccount = loaded.format === "qif" || loaded.format === "csv";

    if (loaded.account === undefined && namesNoAccount) {
      return yield* wait;
    }

    let csvProfile = input.csvProfile;

    // A CSV file with no profile given is read with the user's profile that recognises its header,
    // else a shipped one, else as detection proposes; the import records which (none for
    // detection). A profile given was recorded when the user chose it.
    if (loaded.format === "csv" && csvProfile === null) {
      const candidates = yield* inTransaction(profileCandidates);
      const matched = yield* matchProfile(loaded.bytes, candidates);

      yield* setStatus({
        profileId: matched?.profileId ?? null,
        shippedProfile: matched?.shippedProfile ?? null,
      });

      csvProfile = matched?.profile ?? null;
    }

    if (loaded.format === "csv" && csvProfile === null) {
      // Detection reads the top of the file only (a mebibyte at most): it stays in this thread.
      const proposal = yield* detectCsvProfile(loaded.bytes).pipe(
        Effect.matchEffect({
          onFailure: (error) => fail(error._tag, false),
          onSuccess: Effect.succeed,
        }),
      );

      if (proposal.unsure.length > 0) {
        return yield* wait;
      }

      csvProfile = proposal.profile;
    }

    const statement = yield* reader
      .read({
        format: loaded.format,
        bytes: loaded.bytes,
        currency: loaded.account?.currency ?? null,
        csvProfile,
      })
      .pipe(Effect.catchTag("ReadFailed", (failed) => fail(failed.code, false)));

    const target =
      loaded.account ??
      (yield* inTransaction((transaction) => recognise(transaction, statement.account)));

    if (target === undefined) {
      return yield* wait;
    }

    if (target.currency !== statement.currency) {
      return yield* fail("CURRENCY_MISMATCH", false);
    }

    const days = statement.lines.map((line) => line.bookedOn).toSorted();
    const periodFrom = days[0] ?? statement.balance?.on ?? null;
    const periodTo = days.at(-1) ?? statement.balance?.on ?? null;

    yield* setStatus({
      accountId: target.id,
      linesRead: statement.lines.length,
      periodFrom,
      periodTo,
    });

    const keys = dedupKeys(loaded.format, statement.lines, csvProfile?.layout);

    const keyed: ReadonlyArray<Keyed> = statement.lines.map((line, order) => ({
      ...line,
      dedupKey: keys[order] ?? "",
      order,
    }));

    yield* progress("deduplicate", { done: 0, total: keyed.length });

    // Which keys the account has already, and whether they are this import's own (an earlier
    // attempt saved them) or another's (a duplicate).
    const known = new Map<string, string | null>();

    for (let start = 0; start < keys.length; start += CHUNK) {
      const chunk = keys.slice(start, start + CHUNK);

      const found = yield* inTransaction((transaction) =>
        transaction
          .select({ dedupKey: statementLine.dedupKey, importId: statementLine.importId })
          .from(statementLine)
          .where(
            and(eq(statementLine.accountId, target.id), inArray(statementLine.dedupKey, chunk)),
          ),
      );

      for (const row of found) {
        if (row.dedupKey !== null) {
          known.set(row.dedupKey, row.importId);
        }
      }
    }

    const fresh = keyed.filter((line) => !known.has(line.dedupKey));

    const candidates: ReadonlyArray<ExistingLine> =
      fresh.length === 0 || periodFrom === null || periodTo === null
        ? []
        : yield* inTransaction((transaction) =>
            transaction
              .select({
                id: statementLine.id,
                bookedOn: statementLine.bookedOn,
                amountMinor: statementLine.amountMinor,
                label: statementLine.label,
                dedupKey: statementLine.dedupKey,
              })
              .from(statementLine)
              .where(
                and(
                  eq(statementLine.accountId, target.id),
                  eq(statementLine.state, "counted"),
                  // A side the app made for a transfer is replaced by the file's line, never held
                  // against it (the pairing below).
                  ne(statementLine.source, "counterpart"),
                  gte(statementLine.bookedOn, shiftDay(periodFrom, -NEAR_DAYS)),
                  lte(statementLine.bookedOn, shiftDay(periodTo, NEAR_DAYS)),
                  or(isNull(statementLine.importId), ne(statementLine.importId, importId)),
                ),
              ),
          );

    // A known line an earlier attempt already held one of this import's lines against stays
    // taken: it is the near duplicate of one read line at most, across attempts too.
    const taken =
      candidates.length === 0
        ? []
        : yield* inTransaction((transaction) =>
            transaction
              .select({ id: statementLine.duplicateOfLineId })
              .from(statementLine)
              .where(
                and(
                  eq(statementLine.importId, importId),
                  isNotNull(statementLine.duplicateOfLineId),
                ),
              ),
          );

    const takenIds = new Set(taken.map((row) => row.id));

    const near = nearDuplicates(
      fresh.map((line): ReadLine => line),
      candidates.filter((candidate) => !takenIds.has(candidate.id)),
    );

    yield* progress("deduplicate", { done: keyed.length, total: keyed.length });

    // Oldest first, the file's order kept within a day: ids follow creation, so the account's
    // order is the statement's.
    const planned: ReadonlyArray<Planned> = fresh
      .map((line, index) => ({ ...line, duplicateOf: near.get(index) ?? null }))
      .toSorted((a, b) => a.bookedOn.localeCompare(b.bookedOn) || a.order - b.order);

    yield* progress("save", { done: 0, total: planned.length });
    yield* setStatus({ status: "saving" });

    for (let start = 0; start < planned.length; start += CHUNK) {
      const chunk = planned.slice(start, start + CHUNK);

      yield* whileRunning(async (transaction) => {
        const added = await transaction
          .insert(statementLine)
          .values(
            chunk.map((line) => ({
              userId: owner,
              accountId: target.id,
              importId,
              source: "import" as const,
              state: line.duplicateOf === null ? ("counted" as const) : ("held" as const),
              bookedOn: line.bookedOn,
              valueOn: line.valueOn,
              amountMinor: line.amountMinor,
              label: line.label,
              memo: line.memo,
              counterpartyName: line.counterparty?.name ?? null,
              counterpartyIban: line.counterparty?.iban ?? null,
              // A payment in another currency, as the file gives it (PayPal's conversions, #201).
              originalAmountMinor: line.original?.amountMinor ?? null,
              originalCurrency: line.original?.currency ?? null,
              bankId: line.bankId,
              dedupKey: line.dedupKey,
              duplicateOfLineId: line.duplicateOf,
            })),
          )
          // Another import running at once may have added the same line meanwhile: it is a
          // duplicate, counted as one below.
          .onConflictDoNothing({ target: [statementLine.accountId, statementLine.dedupKey] })
          .returning({ id: statementLine.id });

        // Each counted line this chunk added gets its entry in the same transaction: no line is
        // ever counted without one, and an attempt run again adds neither twice.
        await entriesForLines(
          transaction,
          owner,
          added.map((line) => line.id),
        );
      });

      yield* progress("save", {
        done: Math.min(start + CHUNK, planned.length),
        total: planned.length,
      });
    }

    yield* whileRunning(async (transaction) => {
      // The user's turn first, before this transaction locks any row its recognition's
      // classification may meet (`../category-turn`): a default set meanwhile waits for it.
      await takeCategoryTurn(transaction, owner);

      // The balances are written again whole, so that a second attempt does not double them.
      await transaction.delete(accountBalance).where(eq(accountBalance.importId, importId));

      // A balance of zero that the account's balance on its day contradicts looks empty (some
      // banks write 0.00 for an account that is not): it is not given, and the summary says so.
      // The lines are saved by now, so the account's balance counts this file's own.
      const balances: Array<typeof accountBalance.$inferInsert> = [];
      let balanceIgnored = false;

      for (const balance of [statement.openingBalance, statement.balance]) {
        if (balance === null) {
          continue;
        }

        if (looksEmpty(balance.amountMinor, await balanceOn(transaction, target.id, balance.on))) {
          balanceIgnored = true;
        } else {
          balances.push({
            userId: owner,
            accountId: target.id,
            day: balance.on,
            balanceMinor: balance.amountMinor,
            source: "statement",
            importId,
          });
        }
      }

      if (balances.length > 0) {
        await transaction.insert(accountBalance).values(balances);
      }

      // The transfers its lines make with the user's other lines (#26), in the transaction that ends
      // the import: an attempt that stops before it pairs nothing, and the next one pairs them.
      if (periodFrom !== null && periodTo !== null) {
        await pairTransfers(transaction, owner, {
          kind: "import",
          importId,
          accountId: target.id,
          from: periodFrom,
          to: periodTo,
        });
      }

      // Its lines, on an account kept by its balance, or the sides the pairing replaced there, count
      // in that account's movements (#31).
      await remakeBalanceLines(transaction, owner);

      const states = await transaction
        .select({ state: statementLine.state, lines: count() })
        .from(statementLine)
        .where(eq(statementLine.importId, importId))
        .groupBy(statementLine.state);

      // The merchants of the lines just added, and of any line whose label names none yet (the
      // lines of v0.2, kept before merchants existed, at the first import after the update).
      await recogniseIn(transaction, owner);

      // The user's rules classify the lines it added (#25), after their merchants' defaults.
      await applyRulesToImport(transaction, importId);

      // A benefit card's line and the bank line its issuer charged the rest to are one expense
      // (#28), once the rules have classified each.
      await matchTopUpsIn(transaction, owner);

      const of = (state: string) => states.find((row) => row.state === state)?.lines ?? 0;
      const added = of("counted");
      const held = of("held") + of("discarded");

      await transaction
        .update(statementImport)
        .set({
          status: "done",
          errorCode: null,
          linesAdded: added,
          linesHeld: held,
          linesDuplicate: Math.max(statement.lines.length - added - held, 0),
          balanceIgnored,
          finishedAt: new Date(),
        })
        .where(eq(statementImport.id, importId));
    });

    return { months: [...new Set(days.map((day) => day.slice(0, 7)))] };
  }).pipe(
    Effect.catchTag("ImportTaken", () => Effect.succeed(nothing)),
    Effect.catchTag("QueryFailed", (failed: QueryFailed) =>
      Effect.fail(new ImportFailed({ code: `QUERY_FAILED_${failed.code}`, retry: true })),
    ),
  );
}

/**
 * Marks an import failed with `code`, when its job's last attempt ended without finishing it (a
 * database that did not answer, a defect, a timeout): otherwise it would stay `reading` or `saving`
 * for good. An import that was done, undone or answered meanwhile is left as it is. Never fails:
 * the job's own failure is what counts.
 */
export function markFailed(
  owner: string,
  importId: string,
  code: string,
): Effect.Effect<void, never, UserData> {
  return Effect.gen(function* () {
    if (!isId(importId)) {
      return;
    }

    const userData = yield* UserData;

    yield* userData.transaction(owner, (transaction) =>
      transaction
        .update(statementImport)
        .set({ status: "failed", errorCode: code })
        .where(
          and(
            eq(statementImport.id, importId),
            inArray(statementImport.status, ["queued", "reading", "saving"]),
          ),
        ),
    );
  }).pipe(Effect.ignore);
}
