import { Effect, Layer } from "effect";

import { AccountStore } from "./account-store";
import type { AccountFacts, AccountRecord, StatementBalanceAt, StoredLine } from "./account-store";
import type { DayBalance } from "./balances";
import { AccountNotFound, BalanceAlreadyNoted, LineNotFound } from "./errors";

// An in-memory `AccountStore`, for tests: the same reads and writes as the database's, on arrays,
// one user's rows apart from another's. A restart forgets them.

/**
 * A line of the memory store: counted unless said otherwise, with no expiry unless given, imported
 * unless its source is given.
 */
export type MemoryLine = Omit<StoredLine, "expiresOn" | "source"> & {
  readonly accountId: string;
  readonly state?: "counted" | "held" | "discarded";
  readonly expiresOn?: string | null;
  readonly source?: StoredLine["source"];
};

type HeldLine = StoredLine & {
  readonly accountId: string;
  readonly state: "counted" | "held" | "discarded";
};

/** A balance of the memory store, given by a statement or noted by the user. */
export type MemoryBalance = DayBalance & {
  readonly accountId: string;
  readonly source: "statement" | "noted";
};

/** An import of the memory store: what says how far an account's statements go. */
export type MemoryImport = {
  readonly accountId: string;
  readonly status: "done" | "failed" | "undone";
  readonly periodTo: string | null;
};

/** One user's rows. */
export type MemoryRows = {
  readonly accounts?: ReadonlyArray<AccountRecord>;
  readonly lines?: ReadonlyArray<MemoryLine>;
  readonly balances?: ReadonlyArray<MemoryBalance>;
  readonly imports?: ReadonlyArray<MemoryImport>;
};

type Rows = {
  accounts: Array<AccountRecord>;
  lines: Array<HeldLine>;
  balances: Array<MemoryBalance>;
  imports: Array<MemoryImport>;
};

let made = 0;

/**
 * An id in the form of the database's, ordered by creation as `uuidv7()` is, so that lines given
 * in order keep it.
 */
export function memoryId(): string {
  made += 1;

  return `00000000-0000-7000-8000-${String(made).padStart(12, "0")}`;
}

const byOrder = (a: StoredLine, b: StoredLine) =>
  a.bookedOn.localeCompare(b.bookedOn) || a.id.localeCompare(b.id);

const sum = (lines: ReadonlyArray<HeldLine>) =>
  lines.reduce((total, line) => total + line.amountMinor, 0);

/** An `AccountStore` holding each user's rows in memory, starting from `rows` (by owner). */
export function memoryAccountStore(rows: ReadonlyMap<string, MemoryRows> = new Map()) {
  return Layer.sync(AccountStore, () => {
    const owners = new Map<string, Rows>();

    for (const [owner, given] of rows) {
      owners.set(owner, {
        accounts: [...(given.accounts ?? [])],
        lines: (given.lines ?? []).map((line) => ({
          ...line,
          state: line.state ?? "counted",
          expiresOn: line.expiresOn ?? null,
          source: line.source ?? "import",
        })),
        balances: [...(given.balances ?? [])],
        imports: [...(given.imports ?? [])],
      });
    }

    const of = (owner: string): Rows => {
      const found = owners.get(owner) ?? { accounts: [], lines: [], balances: [], imports: [] };

      owners.set(owner, found);

      return found;
    };

    const counted = (owner: string, accountId: string) =>
      of(owner)
        .lines.filter((line) => line.accountId === accountId && line.state === "counted")
        .sort(byOrder);

    const factsOf = (owner: string, account: AccountRecord, day: string): AccountFacts => {
      const own = of(owner);
      const lines = counted(owner, account.id);

      const balances = own.balances.filter(
        (balance) => balance.accountId === account.id && balance.day <= day,
      );

      // Of two statement balances on a day, the one given last (array order) wins.
      const statementMinorByDay = new Map<string, number>();

      for (const balance of balances) {
        if (balance.source === "statement") {
          statementMinorByDay.set(balance.day, balance.minor);
        }
      }

      const statements: ReadonlyArray<StatementBalanceAt> = [...statementMinorByDay.entries()]
        .sort(([dayA], [dayB]) => dayA.localeCompare(dayB))
        .map(([statementDay, minor]) => ({
          day: statementDay,
          minor,
          countedMinor: sum(lines.filter((line) => line.bookedOn <= statementDay)),
        }));

      const importedTo = own.imports
        .filter((done) => done.accountId === account.id && done.status === "done")
        .reduce<string | null>(
          (latest, done) =>
            done.periodTo !== null && (latest === null || done.periodTo > latest)
              ? done.periodTo
              : latest,
          null,
        );

      // The memory store holds no category: an account's names none.
      return {
        account,
        balanceCategory: null,
        countedMinor: sum(lines.filter((line) => line.bookedOn <= day)),
        noted: balances
          .filter((balance) => balance.source === "noted")
          .sort((a, b) => a.day.localeCompare(b.day))
          .map((balance) => ({ day: balance.day, minor: balance.minor })),
        statements,
        importedTo,
      };
    };

    const find = (owner: string, accountId: string) =>
      of(owner).accounts.find((account) => account.id === accountId);

    return {
      facts: (owner, day) =>
        Effect.sync(() => of(owner).accounts.map((account) => factsOf(owner, account, day))),

      lines: (owner, accountId, { before, limit, day }) =>
        Effect.sync(() => {
          const lines = counted(owner, accountId).filter((line) => line.bookedOn <= day);

          const end =
            before === undefined ? lines.length : lines.findIndex((line) => line.id === before);

          const older = end === -1 ? [] : lines.slice(0, end);
          const page = older.slice(-limit).reverse();

          return {
            lines: page,
            olderMinor: sum(older.slice(0, Math.max(older.length - limit, 0))),
            more: older.length > limit,
          };
        }),

      moves: (owner, accountId, { from, to }) =>
        Effect.sync(() => {
          const lines = counted(owner, accountId);
          const byDay = new Map<string, number>();

          for (const line of lines) {
            if (line.bookedOn >= from && line.bookedOn <= to) {
              byDay.set(line.bookedOn, (byDay.get(line.bookedOn) ?? 0) + line.amountMinor);
            }
          }

          return {
            beforeMinor: sum(lines.filter((line) => line.bookedOn < from)),
            moves: [...byDay].map(([day, minor]) => ({ day, minor })),
          };
        }),

      inOut: (owner, accountId, { from, to }) =>
        Effect.sync(() => {
          const lines = counted(owner, accountId).filter(
            (line) => line.bookedOn >= from && line.bookedOn <= to,
          );

          let inMinor = 0;
          let outMinor = 0;

          for (const line of lines) {
            if (line.amountMinor >= 0) {
              inMinor += line.amountMinor;
            } else {
              outMinor -= line.amountMinor;
            }
          }

          return { inMinor, outMinor };
        }),

      countedLines: (owner, accountId, day) =>
        Effect.sync(() =>
          counted(owner, accountId)
            .filter((line) => line.bookedOn <= day)
            .map(({ id, bookedOn, amountMinor, label, expiresOn }) => ({
              id,
              bookedOn,
              amountMinor,
              label,
              expiresOn,
            })),
        ),

      create: (owner, decide) =>
        Effect.gen(function* () {
          const own = of(owner);
          const created = {
            id: memoryId(),
            ...(yield* Effect.fromResult(decide(own.accounts, []))),
          };

          own.accounts.push(created);

          return created;
        }),

      update: (owner, accountId, decide) =>
        Effect.gen(function* () {
          const own = of(owner);
          const account = find(owner, accountId);

          if (account === undefined) {
            return yield* new AccountNotFound({ accountId });
          }

          const hasEntries =
            own.lines.some((line) => line.accountId === accountId) ||
            own.balances.some((balance) => balance.accountId === accountId);

          const change = yield* Effect.fromResult(
            decide({ account, accounts: own.accounts, hasEntries, categories: [] }),
          );

          const changed = { ...account, ...change };

          own.accounts = own.accounts.map((each) => (each.id === accountId ? changed : each));

          return changed;
        }),

      noteBalance: (owner, accountId, decide) =>
        Effect.gen(function* () {
          const own = of(owner);
          const account = find(owner, accountId);

          if (account === undefined) {
            return yield* new AccountNotFound({ accountId });
          }

          const noted = yield* Effect.fromResult(decide(account));

          const taken = own.balances.some(
            (balance) =>
              balance.accountId === accountId &&
              balance.source === "noted" &&
              balance.day === noted.day,
          );

          if (taken) {
            return yield* new BalanceAlreadyNoted({ accountId, day: noted.day });
          }

          own.balances.push({ ...noted, accountId, source: "noted" });

          return noted;
        }),

      setLineExpiry: (owner, lineId, decide) =>
        Effect.gen(function* () {
          const own = of(owner);
          const found = own.lines.find((line) => line.id === lineId);
          const account = found === undefined ? undefined : find(owner, found.accountId);

          if (found === undefined || account === undefined) {
            return yield* new LineNotFound({ lineId });
          }

          const expiresOn = yield* Effect.fromResult(decide({ ...found, account }));

          own.lines = own.lines.map((line) => (line.id === lineId ? { ...line, expiresOn } : line));

          return { lineId, accountId: account.id, expiresOn };
        }),
    };
  });
}
