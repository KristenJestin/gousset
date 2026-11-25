import { account, statementLine } from "@gousset/db/schema/ledger";
import { transfer } from "@gousset/db/schema/transfers";
import { UserData } from "@gousset/db/user-data";
import type { QueryFailed, UserTransaction } from "@gousset/db/user-data";
import { and, eq, gte, inArray, lte, or } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { remakeBalanceLines } from "../balance-lines";
import { takeCategoryTurn } from "../category-turn";
import { dropEntriesOfTransferSides, entriesForLines } from "../entries";
import { AccountNotFound, LineNotFound, NotATransfer, TransferRefused } from "../errors";
import type { AccountKind } from "../account-values";
import { isId } from "../imports/rows";
import type { LineAccount } from "../lines";
import type { Money } from "../month";
import { today } from "../today";
import { POOL_DAYS, linesWithSeveralCandidates, pairTransfers, pairableLines } from "./pair-lines";
import type { PairingWritten } from "./pair-lines";
import { candidatesOf, shiftDay } from "./pairing";

// Transfers between the user's own accounts (#26), as the operations page and the MCP door both
// read and change them: a line's transfer or its candidates, pairing two lines by hand, undoing a
// pairing, and the pairing the import runs, on demand.

/** The other side of a transfer, or a line that may be it. */
export type TransferSide = {
  readonly id: string;
  readonly bookedOn: string;
  readonly label: string;
  readonly amount: Money;
  readonly account: LineAccount;
  /** Made by the app: the side the account's own statement does not show. */
  readonly madeByApp: boolean;
};

/** What a line is to the transfers: a side of one, or a line that may be one. */
export type LineTransfer = {
  /** The transfer the line is a side of; null when it is none. */
  readonly paired: {
    /** `out`: money left by this line; `in`: it came in by it. */
    readonly direction: "out" | "in";
    readonly other: TransferSide;
    /** Money moved to a savings or investment account from another kind: the month sets it aside. */
    readonly setAside: boolean;
    readonly pairedBy: "import" | "rule" | "user";
  } | null;
  /**
   * A counted line that is no side yet: the lines that may be its other side, nearest first. One is
   * paired by the import; several wait for the user to choose. Empty otherwise.
   */
  readonly candidates: ReadonlyArray<TransferSide>;
};

/** A transfer undone: its other side, as it was, and whether a side the app made was deleted. */
export type Unpaired = {
  readonly other: TransferSide;
  /** The side the app had made (this line, or the other) is gone with the transfer. */
  readonly madeSideDeleted: boolean;
};

/** What a pairing on demand did, and what it leaves to the user. */
export type PairingSummary = PairingWritten & {
  /** Lines with several candidates, which wait for the user to choose their other side. */
  readonly toReview: number;
};

type Failure = QueryFailed;

/** Transfers between the user's accounts, for the user `owner` of each call. */
export class Transfers extends Context.Service<
  Transfers,
  {
    /** The transfer a counted or held line is a side of, or its candidates. */
    readonly ofLine: (
      owner: string,
      lineId: string,
    ) => Effect.Effect<LineTransfer, LineNotFound | Failure>;
    /**
     * Pairs two lines as a transfer, the user's own pairing, across currencies too; with no other
     * line named, the line's only candidate. Refused (`TransferRefused`) for two lines that cannot
     * be the two sides of one transfer, a line that is a side already, and a line with no candidate
     * or several. Both lines lose their entry: a transfer is never an expense nor an income.
     */
    readonly pair: (
      owner: string,
      lineId: string,
      otherId: string | null,
    ) => Effect.Effect<LineTransfer, LineNotFound | TransferRefused | Failure>;
    /**
     * Pairs a line with an account kept by its balance (#31), the user's own pairing: no file shows
     * that account's side, so the app makes it (`source = counterpart`), booked the same day, of the
     * opposite amount, and the account's movements are made again around it. Refused
     * (`TransferRefused`) as `pair` refuses a line, for an account kept by its lines, of another
     * currency, or the line's own; `AccountNotFound` for none of the user's.
     */
    readonly pairWithAccount: (
      owner: string,
      lineId: string,
      accountId: string,
    ) => Effect.Effect<LineTransfer, LineNotFound | AccountNotFound | TransferRefused | Failure>;
    /**
     * Undoes the transfer the line is a side of: both lines are no transfer any more, and a side the
     * app had made, this line or the other, is deleted; each line left gets its entry back, in its
     * kind's fallback. The other side, as it was.
     */
    readonly unpair: (
      owner: string,
      lineId: string,
    ) => Effect.Effect<Unpaired, LineNotFound | NotATransfer | Failure>;
    /** Runs the import's pairing over every line of the user's. */
    readonly pairAll: (owner: string) => Effect.Effect<PairingSummary, Failure>;
    /**
     * `pairAll` for the lines kept before v0.3 (#192), at boot: the same rules, but a line whose
     * entry the user classified or split is never paired, for the user to pair by hand.
     */
    readonly pairKept: (owner: string) => Effect.Effect<PairingSummary, Failure>;
  }
>()("@gousset/core/Transfers") {}

/** The kinds whose money the month sets aside (docs/vision.md, "Kinds of money movement"). */
const SET_ASIDE: ReadonlySet<string> = new Set(["savings", "investment"]);

const lineColumns = {
  id: statementLine.id,
  accountId: statementLine.accountId,
  bookedOn: statementLine.bookedOn,
  valueOn: statementLine.valueOn,
  amountMinor: statementLine.amountMinor,
  label: statementLine.label,
  state: statementLine.state,
  source: statementLine.source,
  accountName: account.name,
  institution: account.institution,
  kind: account.kind,
  currency: account.currency,
};

type ReadLine = {
  readonly id: string;
  readonly accountId: string;
  readonly bookedOn: string;
  readonly valueOn: string | null;
  readonly amountMinor: number;
  readonly label: string;
  readonly state: "counted" | "held" | "discarded";
  readonly source: "import" | "manual" | "balance" | "counterpart";
  readonly accountName: string;
  readonly institution: string | null;
  readonly kind: AccountKind;
  readonly currency: string;
};

/** The user's counted or held lines among `lineIds` booked on or before `day`. */
function readLines(
  transaction: UserTransaction,
  lineIds: ReadonlyArray<string>,
  day: string,
): Promise<ReadonlyArray<ReadLine>> {
  const ids = lineIds.filter(isId);

  return ids.length === 0
    ? Promise.resolve([])
    : transaction
        .select(lineColumns)
        .from(statementLine)
        .innerJoin(account, eq(account.id, statementLine.accountId))
        .where(
          and(
            inArray(statementLine.id, ids),
            inArray(statementLine.state, ["counted", "held"]),
            lte(statementLine.bookedOn, day),
          ),
        );
}

const sideOf = (line: ReadLine): TransferSide => ({
  id: line.id,
  bookedOn: line.bookedOn,
  label: line.label,
  amount: { minor: line.amountMinor, currency: line.currency },
  account: { id: line.accountId, name: line.accountName, institution: line.institution },
  madeByApp: line.source === "counterpart",
});

/** The transfer `lineId` is a side of, if any. */
async function transferOfLine(transaction: UserTransaction, lineId: string) {
  const [found] = await transaction
    .select({
      id: transfer.id,
      outLineId: transfer.outLineId,
      inLineId: transfer.inLineId,
      pairedBy: transfer.pairedBy,
    })
    .from(transfer)
    .where(or(eq(transfer.outLineId, lineId), eq(transfer.inLineId, lineId)));

  return found;
}

/**
 * The lines that may be the other side of `line`, nearest first, for the user to pair by hand: none
 * unless it is pairable. A line the user said is no transfer keeps them, and is one of them: only
 * the automatic pairing leaves it alone.
 */
async function candidatesOfLine(
  transaction: UserTransaction,
  line: ReadLine,
  day: string,
): Promise<ReadonlyArray<TransferSide>> {
  if (line.state !== "counted" || line.source === "balance" || line.amountMinor === 0) {
    return [];
  }

  const pool = await pairableLines(
    transaction,
    and(
      eq(statementLine.amountMinor, -line.amountMinor),
      gte(statementLine.bookedOn, shiftDay(line.bookedOn, -POOL_DAYS)),
      lte(statementLine.bookedOn, shiftDay(line.bookedOn, POOL_DAYS)),
      lte(statementLine.bookedOn, day),
    ),
    "by hand",
  );

  const found = candidatesOf({ ...line, accountKind: line.kind }, pool);

  const read = await readLines(
    transaction,
    found.map((each) => each.id),
    day,
  );

  const byId = new Map(read.map((each) => [each.id, each]));

  return found.flatMap((each) => {
    const other = byId.get(each.id);

    return other === undefined ? [] : [sideOf(other)];
  });
}

/** What `line` is to the transfers, read in `transaction`. */
async function lineTransfer(
  transaction: UserTransaction,
  line: ReadLine,
  day: string,
): Promise<LineTransfer> {
  const found = await transferOfLine(transaction, line.id);

  if (found === undefined) {
    return { paired: null, candidates: await candidatesOfLine(transaction, line, day) };
  }

  const direction = found.outLineId === line.id ? "out" : "in";
  const otherId = direction === "out" ? found.inLineId : found.outLineId;
  // The other side is shown whatever its day: it is part of this line's story.
  const [other] = await readLines(transaction, [otherId], "9999-12-31");

  if (other === undefined) {
    return { paired: null, candidates: [] };
  }

  const [out, into] = direction === "out" ? [line, other] : [other, line];

  return {
    paired: {
      direction,
      other: sideOf(other),
      setAside: SET_ASIDE.has(into.kind) && !SET_ASIDE.has(out.kind),
      pairedBy: found.pairedBy,
    },
    candidates: [],
  };
}

type Outcome<A> =
  | { readonly done: A }
  | { readonly missing: string }
  | { readonly refused: TransferRefused["reason"]; readonly lineId: string };

/** Why two lines cannot be paired, or undefined when they can. */
function refusalOf(
  line: ReadLine,
  other: ReadLine,
): { readonly reason: TransferRefused["reason"]; readonly lineId: string } | undefined {
  if (line.id === other.id) {
    return { reason: "same_line", lineId: line.id };
  }

  // A line made from a noted balance stands for a month's movement (#31): never a transfer's side.
  const fromBalance = [line, other].find((each) => each.source === "balance");

  if (fromBalance !== undefined) {
    return { reason: "made_from_balance", lineId: fromBalance.id };
  }

  const held = [line, other].find((each) => each.state !== "counted");

  if (held !== undefined) {
    return { reason: "not_counted", lineId: held.id };
  }

  const zero = [line, other].find((each) => each.amountMinor === 0);

  if (zero !== undefined) {
    return { reason: "zero_amount", lineId: zero.id };
  }

  if (line.accountId === other.accountId) {
    return { reason: "same_account", lineId: other.id };
  }

  if (line.amountMinor < 0 === other.amountMinor < 0) {
    return { reason: "same_sign", lineId: other.id };
  }

  return undefined;
}

async function pairInTransaction(
  transaction: UserTransaction,
  owner: string,
  lineId: string,
  otherId: string | null,
  day: string,
): Promise<Outcome<LineTransfer>> {
  const [line] = await readLines(transaction, [lineId], day);

  if (line === undefined) {
    return { missing: lineId };
  }

  let other: ReadLine | undefined;

  if (otherId === null) {
    const candidates = await candidatesOfLine(transaction, line, day);
    const [only, ...others] = candidates;

    if (only === undefined || others.length > 0) {
      const paired = await transferOfLine(transaction, line.id);

      return paired === undefined
        ? { refused: only === undefined ? "no_candidate" : "several_candidates", lineId }
        : { refused: "already_paired", lineId };
    }

    [other] = await readLines(transaction, [only.id], day);
  } else {
    [other] = await readLines(transaction, [otherId], day);
  }

  if (other === undefined) {
    return { missing: otherId ?? lineId };
  }

  const refused = refusalOf(line, other);

  if (refused !== undefined) {
    return { refused: refused.reason, lineId: refused.lineId };
  }

  for (const side of [line, other]) {
    if ((await transferOfLine(transaction, side.id)) !== undefined) {
      return { refused: "already_paired", lineId: side.id };
    }
  }

  const [out, into] = line.amountMinor < 0 ? [line, other] : [other, line];

  const written = await transaction
    .insert(transfer)
    .values({ userId: owner, outLineId: out.id, inLineId: into.id, pairedBy: "user" })
    .onConflictDoNothing()
    .returning({ id: transfer.id });

  // Another call paired one of them meanwhile.
  if (written.length === 0) {
    return { refused: "already_paired", lineId };
  }

  // The user said what both lines are: the monthly review no longer lists them, and a "Not a
  // transfer" said before no longer holds.
  await transaction
    .update(statementLine)
    .set({ reviewState: "done", transferRefused: false })
    .where(inArray(statementLine.id, [out.id, into.id]));

  // A transfer is never an expense nor an income: both lines lose their entry (#23).
  await dropEntriesOfTransferSides(transaction, owner);

  return { done: await lineTransfer(transaction, line, day) };
}

/** Why a line cannot be paired with an account kept by its balance, or undefined when it can. */
function accountRefusalOf(
  line: ReadLine,
  target: { readonly id: string; readonly mode: "lines" | "balance"; readonly currency: string },
): TransferRefused["reason"] | undefined {
  if (line.source === "balance") {
    return "made_from_balance";
  }

  if (line.state !== "counted") {
    return "not_counted";
  }

  if (line.amountMinor === 0) {
    return "zero_amount";
  }

  if (line.accountId === target.id) {
    return "same_account";
  }

  if (target.mode !== "balance") {
    return "account_kept_by_lines";
  }

  return line.currency === target.currency ? undefined : "other_currency";
}

async function pairWithAccountInTransaction(
  transaction: UserTransaction,
  owner: string,
  lineId: string,
  accountId: string,
  day: string,
): Promise<Outcome<LineTransfer> | { readonly noAccount: string }> {
  // The account's movements are made again below (`../balance-lines`).
  await takeCategoryTurn(transaction, owner);

  const [line] = await readLines(transaction, [lineId], day);

  if (line === undefined) {
    return { missing: lineId };
  }

  const [target] = isId(accountId)
    ? await transaction
        .select({ id: account.id, mode: account.mode, currency: account.currency })
        .from(account)
        .where(eq(account.id, accountId))
    : [];

  if (target === undefined) {
    return { noAccount: accountId };
  }

  const refused = accountRefusalOf(line, target);

  if (refused !== undefined) {
    return { refused, lineId };
  }

  if ((await transferOfLine(transaction, line.id)) !== undefined) {
    return { refused: "already_paired", lineId };
  }

  const [made] = await transaction
    .insert(statementLine)
    .values({
      userId: owner,
      accountId: target.id,
      source: "counterpart",
      bookedOn: line.bookedOn,
      valueOn: line.valueOn,
      amountMinor: -line.amountMinor,
      label: line.label,
    })
    .returning({ id: statementLine.id });

  if (made === undefined) {
    throw new Error("The insert returned no row.");
  }

  const [outId, inId] = line.amountMinor < 0 ? [line.id, made.id] : [made.id, line.id];

  const written = await transaction
    .insert(transfer)
    .values({ userId: owner, outLineId: outId, inLineId: inId, pairedBy: "user" })
    .onConflictDoNothing()
    .returning({ id: transfer.id });

  // Another call paired the line meanwhile: the side made for it stands for nothing.
  if (written.length === 0) {
    await transaction.delete(statementLine).where(eq(statementLine.id, made.id));

    return { refused: "already_paired", lineId };
  }

  // The user said what the line is: the monthly review no longer lists it.
  await transaction
    .update(statementLine)
    .set({ reviewState: "done", transferRefused: false })
    .where(inArray(statementLine.id, [line.id, made.id]));

  // A transfer is never an expense nor an income (#23); the account's movements count it (#31).
  await dropEntriesOfTransferSides(transaction, owner);
  await remakeBalanceLines(transaction, owner);

  return { done: await lineTransfer(transaction, line, day) };
}

async function unpairInTransaction(
  transaction: UserTransaction,
  owner: string,
  lineId: string,
  day: string,
): Promise<Outcome<Unpaired> | { readonly notPaired: string }> {
  // A side the app made on an account kept by its balance goes below: its movements are made again.
  await takeCategoryTurn(transaction, owner);

  const [line] = await readLines(transaction, [lineId], day);

  if (line === undefined) {
    return { missing: lineId };
  }

  const found = await transferOfLine(transaction, line.id);

  if (found === undefined) {
    return { notPaired: lineId };
  }

  const otherId = found.outLineId === line.id ? found.inLineId : found.outLineId;
  const [other] = await readLines(transaction, [otherId], "9999-12-31");

  await transaction.delete(transfer).where(eq(transfer.id, found.id));

  // A side the app made stands for nothing once the transfer is gone, whichever side it is.
  const deleted = await transaction
    .delete(statementLine)
    .where(
      and(inArray(statementLine.id, [line.id, otherId]), eq(statementLine.source, "counterpart")),
    )
    .returning({ id: statementLine.id });

  // "Not a transfer", remembered on the lines left: the automatic pairing leaves them alone, and
  // the monthly review lists them again, for what they are instead.
  await transaction
    .update(statementLine)
    .set({ reviewState: "to_review", transferRefused: true })
    .where(inArray(statementLine.id, [line.id, otherId]));

  // Each line left is an expense or an income again: its entry, in its kind's fallback (#23).
  await entriesForLines(transaction, owner, [line.id, otherId]);

  // A side the app made on an account kept by its balance no longer counts in its movements (#31).
  if (deleted.length > 0) {
    await remakeBalanceLines(transaction, owner);
  }

  return other === undefined
    ? { notPaired: lineId }
    : { done: { other: sideOf(other), madeSideDeleted: deleted.length > 0 } };
}

/** The transfer a line is a side of, or the lines that may be its other side. */
export const lineTransferOf = (owner: string, lineId: string) =>
  Effect.gen(function* () {
    const transfers = yield* Transfers;

    return yield* transfers.ofLine(owner, lineId);
  });

/** Pairs two lines as a transfer, or a line with its only candidate (`Transfers.pair`). */
export const pairLines = (owner: string, lineId: string, otherId: string | null) =>
  Effect.gen(function* () {
    const transfers = yield* Transfers;

    return yield* transfers.pair(owner, lineId, otherId);
  });

/** Pairs a line with an account kept by its balance, whose side the app makes. */
export const pairLineWithAccount = (owner: string, lineId: string, accountId: string) =>
  Effect.gen(function* () {
    const transfers = yield* Transfers;

    return yield* transfers.pairWithAccount(owner, lineId, accountId);
  });

/** Undoes the transfer a line is a side of (`Transfers.unpair`). */
export const unpairLine = (owner: string, lineId: string) =>
  Effect.gen(function* () {
    const transfers = yield* Transfers;

    return yield* transfers.unpair(owner, lineId);
  });

/** Pairs every clear transfer of the user's lines, as an import does (`Transfers.pairAll`). */
export const pairEveryLine = (owner: string) =>
  Effect.gen(function* () {
    const transfers = yield* Transfers;

    return yield* transfers.pairAll(owner);
  });

/** Pairs the lines kept before v0.3, at boot (`Transfers.pairKept`). */
export const pairKeptLines = (owner: string) =>
  Effect.gen(function* () {
    const transfers = yield* Transfers;

    return yield* transfers.pairKept(owner);
  });

/** The pairing of every line of the user's, in its own transaction: on demand, or at boot. */
const pairEvery = async (
  transaction: UserTransaction,
  owner: string,
  scope: "all" | "kept",
): Promise<PairingSummary> => {
  // A card's side made or replaced may be on an account kept by its balance (#31).
  await takeCategoryTurn(transaction, owner);

  const written = await pairTransfers(transaction, owner, { kind: scope });

  await remakeBalanceLines(transaction, owner);

  return {
    ...written,
    toReview: (await linesWithSeveralCandidates(transaction)).length,
  };
};

/** `Transfers` on the database (`UserData`). */
export const transfersLayer = Layer.effect(
  Transfers,
  Effect.gen(function* () {
    const userData = yield* UserData;

    return {
      ofLine: (owner, lineId) =>
        Effect.gen(function* () {
          const day = yield* today;

          const found = yield* userData.transaction(owner, async (transaction) => {
            const [line] = await readLines(transaction, [lineId], day);

            return line === undefined ? undefined : lineTransfer(transaction, line, day);
          });

          return found === undefined ? yield* new LineNotFound({ lineId }) : found;
        }),

      pair: (owner, lineId, otherId) =>
        Effect.gen(function* () {
          const day = yield* today;

          const outcome = yield* userData.transaction(owner, (transaction) =>
            pairInTransaction(transaction, owner, lineId, otherId, day),
          );

          if ("missing" in outcome) {
            return yield* new LineNotFound({ lineId: outcome.missing });
          }

          if ("refused" in outcome) {
            return yield* new TransferRefused({ reason: outcome.refused, lineId: outcome.lineId });
          }

          return outcome.done;
        }),

      pairWithAccount: (owner, lineId, accountId) =>
        Effect.gen(function* () {
          const day = yield* today;

          const outcome = yield* userData.transaction(owner, (transaction) =>
            pairWithAccountInTransaction(transaction, owner, lineId, accountId, day),
          );

          if ("missing" in outcome) {
            return yield* new LineNotFound({ lineId: outcome.missing });
          }

          if ("noAccount" in outcome) {
            return yield* new AccountNotFound({ accountId: outcome.noAccount });
          }

          if ("refused" in outcome) {
            return yield* new TransferRefused({ reason: outcome.refused, lineId: outcome.lineId });
          }

          return outcome.done;
        }),

      unpair: (owner, lineId) =>
        Effect.gen(function* () {
          const day = yield* today;

          const outcome = yield* userData.transaction(owner, (transaction) =>
            unpairInTransaction(transaction, owner, lineId, day),
          );

          if ("missing" in outcome) {
            return yield* new LineNotFound({ lineId: outcome.missing });
          }

          if ("notPaired" in outcome || "refused" in outcome) {
            return yield* new NotATransfer({ lineId });
          }

          return outcome.done;
        }),

      pairAll: (owner) =>
        userData.transaction(owner, (transaction) => pairEvery(transaction, owner, "all")),

      pairKept: (owner) =>
        userData.transaction(owner, (transaction) => pairEvery(transaction, owner, "kept")),
    };
  }),
);
