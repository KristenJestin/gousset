import { investmentOperation, security } from "@gousset/db/schema/investments";
import { account, entryPart, statementLine } from "@gousset/db/schema/ledger";
import { UserData } from "@gousset/db/user-data";
import type { QueryFailed, UserTransaction } from "@gousset/db/user-data";
import { and, count, desc, eq, ne, sql } from "drizzle-orm";
import { Context, Effect, Layer, Result } from "effect";

import { listAccounts } from "../accounts";
import type { AccountSummary } from "../accounts";
import { takeCategoryTurn } from "../category-turn";
import { entriesForLines, paymentsOfLines, settleEntries } from "../entries";
import { AccountNotFound } from "../errors";
import { isId } from "../imports/rows";
import type { Money } from "../month";
import { today } from "../today";
import { pairTransfers } from "../transfers/pair-lines";
import { unpairInTransaction } from "../transfers/transfers";
import { movesInside } from "./cash";
import {
  NotAnInvestmentAccount,
  OperationNotFound,
  SecurityNotFound,
  SecurityNotOnAccount,
} from "./errors";
import type { InvalidIsin, InvalidQuantity, OperationRefused } from "./errors";
import { checkOperation } from "./operation-input";
import type { CheckedOperation, OperationInput } from "./operation-input";
import {
  investmentAccountIn,
  operationOf,
  pairedLine,
  positionsIn,
  readOperation,
  securitiesFor,
  selectOperations,
} from "./rows";
import type {
  AccountRefusal,
  AccountRefused,
  OperationRead,
  PositionRead,
  SecurityRead,
} from "./rows";

// An investment account's positions and operations (#250; docs/data-model.md, v0.6), as the
// investments page and the MCP door's `investments` tool both read and change them. An operation is
// a cash line of the account with what the broker says of it: entering one writes its line
// (`source = manual`) and the operation in one transaction; correcting one changes both together;
// deleting one deletes its line, and the operation with it. Each write takes the user's turn among
// the changes of the categories first (`../category-turn`), as the other writers of lines and
// entries do, then locks its line.

/** How many operations a page lists when none is asked for, and the most. */
export const DEFAULT_OPERATIONS_LISTED = 50;
export const MAX_OPERATIONS_LISTED = 500;

/** An investment account: its cash, as the accounts page gives its balance, and its positions. */
export type InvestmentAccount = {
  readonly id: string;
  readonly name: string;
  readonly institution: string | null;
  /** What it was created as: `pea`, `life_insurance` or `securities`, which names its envelope. */
  readonly choice: AccountSummary["choice"];
  readonly currency: string;
  readonly mode: AccountSummary["mode"];
  readonly closedOn: string | null;
  /** Its balance at the end of today: its opening balance and its counted lines. */
  readonly cash: Money;
  /** Its open positions, by security name, at cost. */
  readonly positions: ReadonlyArray<PositionRead>;
};

/** A page of an account's operations, newest first (booked on, then their line's id). */
export type OperationPage = {
  readonly operations: ReadonlyArray<OperationRead>;
  /** Give it as `after` for the next page; null on the last one. */
  readonly next: string | null;
  /** How many operations the account has in all, whatever the page. */
  readonly total: number;
};

/** One security held on one account, with all of its operations there, newest first. */
export type PositionDetail = {
  readonly account: {
    readonly id: string;
    readonly name: string;
    readonly institution: string | null;
    readonly currency: string;
  };
  readonly security: SecurityRead;
  /** Null when the account has no counted operation of it booked by today. */
  readonly position: PositionRead | null;
  readonly operations: ReadonlyArray<OperationRead>;
};

/** What a page of operations asks for: an operation's id to read past, and how many. */
export type OperationPaging = { readonly after?: string | null; readonly limit?: number };

type Failure = QueryFailed;

type WriteRefusal = OperationRefused | InvalidQuantity | InvalidIsin | NotAnInvestmentAccount;

/** The investments of the user `owner` of each call. */
export class Investments extends Context.Service<
  Investments,
  {
    /** The open positions of every investment account, open or closed, as of `day`. */
    readonly positions: (
      owner: string,
      day: string,
    ) => Effect.Effect<
      ReadonlyArray<{ readonly accountId: string; readonly position: PositionRead }>,
      Failure
    >;
    /**
     * A page of an account's operations, newest first; `after` an operation's id from the page
     * before (one of no page gives an empty page). `AccountNotFound` for none of the user's.
     */
    readonly operations: (
      owner: string,
      accountId: string,
      paging: OperationPaging,
    ) => Effect.Effect<OperationPage, AccountNotFound | Failure>;
    /**
     * One operation of an account, as its pages read it. `AccountNotFound` for none of the user's,
     * `OperationNotFound` for none of the account's operations (its discarded lines left out).
     */
    readonly operationOn: (
      owner: string,
      accountId: string,
      operationId: string,
    ) => Effect.Effect<OperationRead, AccountNotFound | OperationNotFound | Failure>;
    /** One security on one account: its position as of today and its operations there. */
    readonly position: (
      owner: string,
      accountId: string,
      securityId: string,
    ) => Effect.Effect<PositionDetail, AccountNotFound | SecurityNotFound | Failure>;
    /**
     * One security on one account by its ISIN, as `position` reads it, open or closed.
     * `AccountNotFound` for none of the user's, `SecurityNotOnAccount` when none of the account's
     * operations (its discarded lines left out) names it.
     */
    readonly positionByIsin: (
      owner: string,
      accountId: string,
      isin: string,
    ) => Effect.Effect<PositionDetail, AccountNotFound | SecurityNotOnAccount | Failure>;
    /**
     * Enters an operation by hand: its line (`source = manual`) and the operation, its security
     * found by ISIN or made. A deposit or a withdrawal gets its default entry, as any line does,
     * and is paired at once with its only candidate as a transfer.
     */
    readonly enter: (
      owner: string,
      accountId: string,
      input: OperationInput,
    ) => Effect.Effect<OperationRead, AccountNotFound | WriteRefusal | Failure>;
    /** Corrects an operation and its line together (`correctInvestmentOperation`). */
    readonly correct: (
      owner: string,
      operationId: string,
      input: OperationInput,
    ) => Effect.Effect<OperationRead, OperationNotFound | WriteRefusal | Failure>;
    /** Deletes an operation's line, and the operation with it (`deleteInvestmentOperation`). */
    readonly remove: (
      owner: string,
      operationId: string,
    ) => Effect.Effect<OperationRead, OperationNotFound | Failure>;
  }
>()("@gousset/core/Investments") {}

/** What a write decided in its transaction, on what it read. */
type Done = { readonly done: OperationRead };

type Gone = { readonly gone: string };

/** The operation as it is now, which the transaction that wrote it reads. */
async function written(transaction: UserTransaction, operationId: string): Promise<Done> {
  const read = await readOperation(transaction, operationId);

  if (read === undefined) {
    throw new Error("The operation written was not read back.");
  }

  return { done: read };
}

/** Locks the operation's line until the transaction ends, and reads both; undefined for none. */
async function lockedOperation(transaction: UserTransaction, operationId: string) {
  if (!isId(operationId)) {
    return undefined;
  }

  const [found] = await transaction
    .select({ lineId: investmentOperation.lineId })
    .from(investmentOperation)
    .where(eq(investmentOperation.id, operationId));

  if (found === undefined) {
    return undefined;
  }

  await transaction
    .select({ id: statementLine.id })
    .from(statementLine)
    .where(eq(statementLine.id, found.lineId))
    .for("update");

  return readOperation(transaction, operationId);
}

/**
 * A deposit's or a withdrawal's line saved by hand is paired at once, as an import pairs its lines:
 * with its only candidate, which has no other; with several, it waits for the user's choice, as any
 * line to review does. A purchase's, a sale's, a dividend's and a fee's line is never a side.
 */
async function pairCash(
  transaction: UserTransaction,
  owner: string,
  lineId: string,
  accountId: string,
  checked: CheckedOperation,
): Promise<void> {
  if (!movesInside(checked.kind)) {
    await pairTransfers(transaction, owner, {
      kind: "lines",
      lineIds: [lineId],
      accountId,
      from: checked.bookedOn,
      to: checked.bookedOn,
    });
  }
}

/** The security id and name an operation names, made when new; nulls for none. */
async function securityOf(
  transaction: UserTransaction,
  owner: string,
  checked: CheckedOperation,
  currency: string,
): Promise<SecurityRead | null> {
  if (checked.security === null) {
    return null;
  }

  const found = await securitiesFor(transaction, owner, [checked.security], currency);

  return found.get(checked.security.isin) ?? null;
}

async function enterIn(
  transaction: UserTransaction,
  owner: string,
  accountId: string,
  checked: CheckedOperation,
): Promise<Done | AccountRefusal> {
  await takeCategoryTurn(transaction, owner);

  const target = isId(accountId)
    ? await investmentAccountIn(transaction, accountId)
    : { missing: accountId };

  if (!("account" in target)) {
    return target;
  }

  const named = await securityOf(transaction, owner, checked, target.account.currency);

  const [line] = await transaction
    .insert(statementLine)
    .values({
      userId: owner,
      accountId: target.account.id,
      source: "manual",
      bookedOn: checked.bookedOn,
      valueOn: checked.valueOn,
      amountMinor: checked.amountMinor,
      label: checked.label ?? named?.name ?? "",
    })
    .returning({ id: statementLine.id });

  if (line === undefined) {
    throw new Error("The insert returned no row.");
  }

  const [made] = await transaction
    .insert(investmentOperation)
    .values({
      userId: owner,
      lineId: line.id,
      kind: checked.kind,
      securityId: named?.id ?? null,
      quantity: checked.quantity,
      unitPrice: checked.unitPrice,
      feesMinor: checked.feesMinor,
    })
    .returning({ id: investmentOperation.id });

  if (made === undefined) {
    throw new Error("The insert returned no row.");
  }

  // A deposit's or a withdrawal's line is money coming in or going out: its entry, as any line's.
  // A purchase's, a sale's, a dividend's and a fee's have none (`entriesForLines` leaves them).
  await entriesForLines(transaction, owner, [line.id]);
  await pairCash(transaction, owner, line.id, target.account.id, checked);

  return written(transaction, made.id);
}

async function correctIn(
  transaction: UserTransaction,
  owner: string,
  operationId: string,
  checked: CheckedOperation,
): Promise<Done | Gone | AccountRefused> {
  await takeCategoryTurn(transaction, owner);

  const current = await lockedOperation(transaction, operationId);

  if (current === undefined) {
    return { gone: operationId };
  }

  // Its account may have changed since: kept by its balance now, or of another kind.
  const target = await investmentAccountIn(transaction, current.accountId);

  if (!("account" in target)) {
    return "missing" in target ? { gone: operationId } : target;
  }

  const moved =
    current.bookedOn !== checked.bookedOn || current.amount.minor !== checked.amountMinor;

  const wasCash = !movesInside(current.kind);
  const nowCash = !movesInside(checked.kind);

  // A deposit or a withdrawal paired as a transfer and moved in its day or its amount, or that is
  // no deposit nor withdrawal any more, is unpaired first: its other side back to review. A
  // correction is no "Not a transfer": both sides stay pairable, and a deposit or a withdrawal is
  // paired again below when it has a clear candidate.
  if ((moved || !nowCash) && (await pairedLine(transaction, current.lineId))) {
    await unpairInTransaction(transaction, owner, current.lineId, "9999-12-31", "change");
  }

  // Its entry was made of the line as it was: moved, or no money in or out of the account any
  // more, the line loses it (and, moved, gets its default one back below).
  const remade = wasCash && (moved || !nowCash);
  const lineOnly = eq(entryPart.lineId, current.lineId);
  const gone = remade ? await paymentsOfLines(transaction, lineOnly) : [];

  if (remade) {
    await transaction.delete(entryPart).where(lineOnly);
  }

  const named = await securityOf(transaction, owner, checked, target.account.currency);

  // With none given, the line keeps its settlement day while its day stays (neither the page nor
  // the MCP door has a field for it), and loses it with a new day, which it no longer follows. A
  // label given is the line's; with none, it keeps its own, unless its security changes: it is then
  // the new security's name (or empty for none), as an operation entered with no label is named.
  const valueOn =
    checked.valueOn ?? (checked.bookedOn === current.bookedOn ? current.valueOn : null);

  const label =
    checked.label ??
    ((named?.id ?? null) === (current.security?.id ?? null) ? current.label : (named?.name ?? ""));

  // An imported line keeps its dedup key: importing its file again does not bring the broker's
  // version back.
  await transaction
    .update(statementLine)
    .set({
      bookedOn: checked.bookedOn,
      valueOn,
      amountMinor: checked.amountMinor,
      label,
    })
    .where(eq(statementLine.id, current.lineId));

  await transaction
    .update(investmentOperation)
    .set({
      kind: checked.kind,
      securityId: named?.id ?? null,
      quantity: checked.quantity,
      unitPrice: checked.unitPrice,
      feesMinor: checked.feesMinor,
    })
    .where(eq(investmentOperation.id, current.id));

  await settleEntries(transaction, owner, gone);

  // A deposit or a withdrawal now, with no entry: its default one, as any line's.
  await entriesForLines(transaction, owner, [current.lineId]);
  await pairCash(transaction, owner, current.lineId, target.account.id, checked);

  return written(transaction, current.id);
}

async function removeIn(
  transaction: UserTransaction,
  owner: string,
  operationId: string,
): Promise<Done | Gone> {
  await takeCategoryTurn(transaction, owner);

  const current = await lockedOperation(transaction, operationId);

  if (current === undefined) {
    return { gone: operationId };
  }

  // A side of a transfer is unpaired first: the other side goes back to review, with its entry,
  // and stays pairable (a deletion is no "Not a transfer").
  if (await pairedLine(transaction, current.lineId)) {
    await unpairInTransaction(transaction, owner, current.lineId, "9999-12-31", "change");
  }

  const gone = await paymentsOfLines(transaction, eq(entryPart.lineId, current.lineId));

  // The operation and the line's parts go with it, by their foreign keys.
  await transaction.delete(statementLine).where(eq(statementLine.id, current.lineId));
  await settleEntries(transaction, owner, gone);

  return { done: current };
}

/** The account's operations as a page, or undefined for no account of the user's. */
async function pageIn(
  transaction: UserTransaction,
  accountId: string,
  paging: OperationPaging,
): Promise<OperationPage | undefined> {
  const [found] = isId(accountId)
    ? await transaction.select({ id: account.id }).from(account).where(eq(account.id, accountId))
    : [];

  if (found === undefined) {
    return undefined;
  }

  const limit = Math.min(
    Math.max(Math.trunc(paging.limit ?? DEFAULT_OPERATIONS_LISTED), 1),
    MAX_OPERATIONS_LISTED,
  );

  const after = paging.after ?? null;

  const ofAccount = and(
    eq(statementLine.accountId, found.id),
    ne(statementLine.state, "discarded"),
  );

  const older =
    after === null
      ? undefined
      : isId(after)
        ? sql`(${statementLine.bookedOn}, ${statementLine.id}) < (select l.booked_on, l.id from ${investmentOperation} o join ${statementLine} l on l.id = o.line_id where o.id = ${after}::uuid and l.account_id = ${found.id}::uuid)`
        : sql`false`;

  const rows = await selectOperations(transaction)
    .where(and(ofAccount, older))
    .orderBy(desc(statementLine.bookedOn), desc(statementLine.id))
    .limit(limit + 1);

  const [counted] = await transaction
    .select({ total: count() })
    .from(investmentOperation)
    .innerJoin(statementLine, eq(statementLine.id, investmentOperation.lineId))
    .where(ofAccount);

  const operations = rows.slice(0, limit).map(operationOf);

  return {
    operations,
    next: rows.length > limit ? (operations.at(-1)?.id ?? null) : null,
    total: counted?.total ?? 0,
  };
}

/** The id of the user's account, or undefined for none. */
async function accountIdIn(
  transaction: UserTransaction,
  accountId: string,
): Promise<string | undefined> {
  const [found] = isId(accountId)
    ? await transaction.select({ id: account.id }).from(account).where(eq(account.id, accountId))
    : [];

  return found?.id;
}

/** One of the account's operations, its discarded lines left out; otherwise what is missing. */
async function operationOnIn(
  transaction: UserTransaction,
  accountId: string,
  operationId: string,
): Promise<OperationRead | { readonly noAccount: string } | { readonly noOperation: string }> {
  const found = await accountIdIn(transaction, accountId);

  if (found === undefined) {
    return { noAccount: accountId };
  }

  const [row] = isId(operationId)
    ? await selectOperations(transaction).where(
        and(
          eq(investmentOperation.id, operationId),
          eq(statementLine.accountId, found),
          ne(statementLine.state, "discarded"),
        ),
      )
    : [];

  return row === undefined ? { noOperation: operationId } : operationOf(row);
}

/** The security of this ISIN on the account, as `positionDetailIn` reads it; otherwise what is missing. */
async function positionByIsinIn(
  transaction: UserTransaction,
  accountId: string,
  isin: string,
  day: string,
): Promise<PositionDetail | { readonly noAccount: string } | { readonly noSecurity: string }> {
  const found = await accountIdIn(transaction, accountId);

  if (found === undefined) {
    return { noAccount: accountId };
  }

  const [named] = await transaction
    .select({ id: security.id })
    .from(security)
    .innerJoin(investmentOperation, eq(investmentOperation.securityId, security.id))
    .innerJoin(statementLine, eq(statementLine.id, investmentOperation.lineId))
    .where(
      and(
        eq(security.isin, isin),
        eq(statementLine.accountId, found),
        ne(statementLine.state, "discarded"),
      ),
    )
    .limit(1);

  return named === undefined
    ? { noSecurity: isin }
    : positionDetailIn(transaction, found, named.id, day);
}

async function positionDetailIn(
  transaction: UserTransaction,
  accountId: string,
  securityId: string,
  day: string,
): Promise<PositionDetail | { readonly noAccount: string } | { readonly noSecurity: string }> {
  const [found] = isId(accountId)
    ? await transaction
        .select({
          id: account.id,
          name: account.name,
          institution: account.institution,
          currency: account.currency,
        })
        .from(account)
        .where(eq(account.id, accountId))
    : [];

  if (found === undefined) {
    return { noAccount: accountId };
  }

  const [held] = isId(securityId)
    ? await transaction
        .select({
          id: security.id,
          isin: security.isin,
          name: security.name,
          currency: security.currency,
        })
        .from(security)
        .where(eq(security.id, securityId))
    : [];

  if (held === undefined) {
    return { noSecurity: securityId };
  }

  const ofBoth = and(
    eq(statementLine.accountId, found.id),
    eq(investmentOperation.securityId, held.id),
  );

  const [position] = await positionsIn(transaction, day, ofBoth);

  const rows = await selectOperations(transaction)
    .where(and(ofBoth, ne(statementLine.state, "discarded")))
    .orderBy(desc(statementLine.bookedOn), desc(statementLine.id));

  return {
    account: found,
    security: held,
    position: position?.position ?? null,
    operations: rows.map(operationOf),
  };
}

/** `Investments` on the database (`UserData`). */
export const investmentsLayer = Layer.effect(
  Investments,
  Effect.gen(function* () {
    const userData = yield* UserData;

    /** Checks the input, then runs the write on it in one transaction of the user's. */
    const write = <A>(
      owner: string,
      input: OperationInput,
      work: (transaction: UserTransaction, checked: CheckedOperation) => Promise<A>,
    ) =>
      Effect.gen(function* () {
        const checked = checkOperation(input);

        if (Result.isFailure(checked)) {
          return yield* checked.failure;
        }

        return yield* userData.transaction(owner, (transaction) =>
          work(transaction, checked.success),
        );
      });

    return {
      positions: (owner, day) =>
        userData.transaction(owner, (transaction) =>
          positionsIn(transaction, day, eq(account.kind, "investment")),
        ),

      operations: (owner, accountId, paging) =>
        Effect.gen(function* () {
          const page = yield* userData.transaction(owner, (transaction) =>
            pageIn(transaction, accountId, paging),
          );

          return page === undefined ? yield* new AccountNotFound({ accountId }) : page;
        }),

      operationOn: (owner, accountId, operationId) =>
        Effect.gen(function* () {
          const found = yield* userData.transaction(owner, (transaction) =>
            operationOnIn(transaction, accountId, operationId),
          );

          if ("noAccount" in found) {
            return yield* new AccountNotFound({ accountId });
          }

          if ("noOperation" in found) {
            return yield* new OperationNotFound({ operationId });
          }

          return found;
        }),

      positionByIsin: (owner, accountId, isin) =>
        Effect.gen(function* () {
          const day = yield* today;

          const found = yield* userData.transaction(owner, (transaction) =>
            positionByIsinIn(transaction, accountId, isin, day),
          );

          if ("noAccount" in found) {
            return yield* new AccountNotFound({ accountId });
          }

          if ("noSecurity" in found) {
            return yield* new SecurityNotOnAccount({ accountId, isin });
          }

          return found;
        }),

      position: (owner, accountId, securityId) =>
        Effect.gen(function* () {
          const day = yield* today;

          const found = yield* userData.transaction(owner, (transaction) =>
            positionDetailIn(transaction, accountId, securityId, day),
          );

          if ("noAccount" in found) {
            return yield* new AccountNotFound({ accountId });
          }

          if ("noSecurity" in found) {
            return yield* new SecurityNotFound({ securityId });
          }

          return found;
        }),

      enter: (owner, accountId, input) =>
        Effect.gen(function* () {
          const outcome = yield* write(owner, input, (transaction, checked) =>
            enterIn(transaction, owner, accountId, checked),
          );

          if ("missing" in outcome) {
            return yield* new AccountNotFound({ accountId: outcome.missing });
          }

          return "refused" in outcome ? yield* refusal(outcome) : outcome.done;
        }),

      correct: (owner, operationId, input) =>
        Effect.gen(function* () {
          const outcome = yield* write(owner, input, (transaction, checked) =>
            correctIn(transaction, owner, operationId, checked),
          );

          if ("gone" in outcome) {
            return yield* new OperationNotFound({ operationId: outcome.gone });
          }

          return "refused" in outcome ? yield* refusal(outcome) : outcome.done;
        }),

      remove: (owner, operationId) =>
        Effect.gen(function* () {
          const outcome = yield* userData.transaction(owner, (transaction) =>
            removeIn(transaction, owner, operationId),
          );

          return "done" in outcome
            ? outcome.done
            : yield* new OperationNotFound({ operationId: outcome.gone });
        }),
    };
  }),
);

/** An account an operation cannot go on, as its failure. */
const refusal = (refused: AccountRefused) =>
  new NotAnInvestmentAccount({ accountId: refused.accountId, reason: refused.refused });

/**
 * The user's investment accounts, open and closed, each with its cash (its balance at the end of
 * today, as the accounts page computes it) and its open positions at cost, by security name.
 */
export const investmentAccounts = (owner: string) =>
  Effect.gen(function* () {
    const investments = yield* Investments;
    const listed = yield* listAccounts(owner);
    const held = yield* investments.positions(owner, listed.day);

    const accounts = [...listed.groups.flatMap((group) => group.accounts), ...listed.closed].filter(
      (each) => each.kind === "investment",
    );

    return accounts.map((each): InvestmentAccount => ({
      id: each.id,
      name: each.name,
      institution: each.institution,
      choice: each.choice,
      currency: each.currency,
      mode: each.mode,
      closedOn: each.closedOn,
      cash: each.balance,
      positions: held.flatMap((one) =>
        one.accountId === each.id && one.position.open ? [one.position] : [],
      ),
    }));
  });

/** A page of an account's operations, newest first (`Investments.operations`). */
export const investmentOperations = (
  owner: string,
  accountId: string,
  paging: OperationPaging = {},
) =>
  Effect.gen(function* () {
    const investments = yield* Investments;

    return yield* investments.operations(owner, accountId, paging);
  });

/** One security on one account, with its operations (`Investments.position`). */
export const investmentPosition = (owner: string, accountId: string, securityId: string) =>
  Effect.gen(function* () {
    const investments = yield* Investments;

    return yield* investments.position(owner, accountId, securityId);
  });

/** One operation of an account, by its id (`Investments.operationOn`). */
export const investmentOperationOn = (owner: string, accountId: string, operationId: string) =>
  Effect.gen(function* () {
    const investments = yield* Investments;

    return yield* investments.operationOn(owner, accountId, operationId);
  });

/** One security on one account, by its ISIN, with its operations (`Investments.positionByIsin`). */
export const investmentPositionByIsin = (owner: string, accountId: string, isin: string) =>
  Effect.gen(function* () {
    const investments = yield* Investments;

    return yield* investments.positionByIsin(owner, accountId, isin);
  });

/**
 * Enters an operation by hand on an investment account kept by its lines: its line and the
 * operation in one transaction (docs/data-model.md, v0.6). Fails with `AccountNotFound`,
 * `NotAnInvestmentAccount` (another kind, or kept by its balance), `OperationRefused` (its sign,
 * amount, fees, days, quantity or security), `InvalidQuantity`, `InvalidIsin`.
 */
export const enterInvestmentOperation = (owner: string, accountId: string, input: OperationInput) =>
  Effect.gen(function* () {
    const investments = yield* Investments;

    return yield* investments.enter(owner, accountId, input);
  });

/**
 * Corrects an operation and its line together, as `input` gives it whole: a label of null keeps
 * the line's, or names it after its new security when that changes; a settlement day of null keeps
 * the line's on the same day, and clears it on another. An imported line keeps its dedup key. A deposit or a withdrawal paired as a transfer
 * whose day or amount changes, or that becomes another kind, is unpaired first, its other side back
 * to review and still pairable, and paired again at once with a clear candidate; a kind moved between a deposit or a withdrawal and the others gives the line its
 * default entry or takes it away, and a deposit or a withdrawal moved gets its default entry anew.
 * Fails with `OperationNotFound`, and as `enterInvestmentOperation` refuses.
 */
export const correctInvestmentOperation = (
  owner: string,
  operationId: string,
  input: OperationInput,
) =>
  Effect.gen(function* () {
    const investments = yield* Investments;

    return yield* investments.correct(owner, operationId, input);
  });

/**
 * Deletes an operation's line, and the operation with it; a side of a transfer is unpaired first,
 * its other side back to review and still pairable. The operation as it was. Fails with `OperationNotFound`.
 */
export const deleteInvestmentOperation = (owner: string, operationId: string) =>
  Effect.gen(function* () {
    const investments = yield* Investments;

    return yield* investments.remove(owner, operationId);
  });
