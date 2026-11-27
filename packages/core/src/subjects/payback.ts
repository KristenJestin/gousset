import {
  account,
  entry,
  entryPart,
  entrySubject,
  statementLine,
  subject,
  subjectPayback,
} from "@gousset/db/schema/ledger";
import { transfer } from "@gousset/db/schema/transfers";
import { UserData } from "@gousset/db/user-data";
import type { UserTransaction } from "@gousset/db/user-data";
import { and, asc, desc, eq, gt, gte, inArray, lte, ne, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { Effect, Result } from "effect";

import { takeCategoryTurn } from "../category-turn";
import { entriesForLines } from "../entries";
import { LineNotFound } from "../errors";
import { isId } from "../imports/rows";
import type { LineAccount } from "../lines";
import type { Money } from "../month";
import { today } from "../today";
import { costsIn } from "./costs";
import { countedIn, pathOf, subtreeOf, treeOrder } from "./counting";
import type { SubjectCost, SubjectNode } from "./counting";
import { PaybackRefused, SubjectNotFound } from "./errors";
import { leftToUserOf, paybackStateOf } from "./payback-share";
import type { PaidBackSubject, PaybackState } from "./payback-share";
import { takeSubjectTurn } from "./turn";

// A subject paid back by someone else (#217; docs/data-model.md, v0.5, "Paid back"): its payback
// lines, the figures they make, the lines that could be them, and what the user still waits for.
// A payback line is classified by its subject, as a transfer's side is by its transfer: it has no
// entry, so nothing that reads or writes entries (the rules, the review, refund proposals, top-ups)
// meets it, and the pairings of transfers leave it out (`../transfers/pair-lines`, `pairable`).

/** The most lines one attachment names. */
export const MAX_PAYBACK_LINES = 100;

/** The longest who pays a subject back may be, once trimmed. */
export const MAX_PAYBACK_FROM = 100;

/** How many lines a subject's page offers as payback candidates. */
export const PAYBACK_CANDIDATES_SHOWN = 20;

/** Who pays a subject back, and when the user asked and settled it: its option. */
export type PaybackSettings = {
  /** Who pays it back, free text. */
  readonly from: string;
  /** `YYYY-MM-DD`, or null. */
  readonly askedOn: string | null;
  /** The day the user marked it paid back by hand; null otherwise. */
  readonly settledOn: string | null;
};

/** A paid-back subject's figures, all time, in the user's currency. */
export type SubjectPayback = PaybackSettings & {
  /** What it and its descendants cost, by the counting rule. */
  readonly spent: Money;
  /** The sum of its payback lines. */
  readonly paidBack: Money;
  /** Paid back less spent, either way: positive when more came back than it cost. */
  readonly difference: Money;
  readonly state: PaybackState;
};

/** A line that pays back a subject, or could. */
export type PaybackLine = {
  readonly lineId: string;
  readonly bookedOn: string;
  readonly label: string;
  readonly account: LineAccount;
  /** Positive, in its account's currency. */
  readonly amount: Money;
};

/** What an attachment or a removal of payback lines did. */
export type PaybackAttachment = {
  readonly subjectId: string;
  /** The lines named. */
  readonly lines: number;
  /** Those it changed: the others were already as asked. */
  readonly changed: number;
};

/** A paid-back subject the user still waits for. */
export type PaybackWaiting = {
  readonly subjectId: string;
  readonly name: string;
  /** Its name with its ancestors', "Work > Lyon trip". */
  readonly path: string;
  readonly from: string;
  readonly askedOn: string | null;
  readonly state: Exclude<PaybackState, "paid_back">;
  readonly spent: Money;
  readonly paidBack: Money;
  /** Spent less paid back. */
  readonly waiting: Money;
};

type SubjectRow = typeof subject.$inferSelect;

const money = (minor: number, currency: string): Money => ({ minor, currency });

/** A subject row's option, or null without it. */
export const paybackSettingsOf = (row: SubjectRow): PaybackSettings | null =>
  row.paybackFrom === null
    ? null
    : { from: row.paybackFrom, askedOn: row.paybackAskedOn, settledOn: row.paybackSettledOn };

/** The counted payback lines of `subjectIds` (every subject's when null), oldest first. */
async function paybackRowsIn(
  transaction: UserTransaction,
  subjectIds: ReadonlyArray<string> | null,
) {
  if (subjectIds !== null && subjectIds.length === 0) {
    return [];
  }

  return transaction
    .select({
      subjectId: subjectPayback.subjectId,
      lineId: statementLine.id,
      bookedOn: statementLine.bookedOn,
      label: statementLine.label,
      amountMinor: statementLine.amountMinor,
      accountId: account.id,
      accountName: account.name,
      institution: account.institution,
      currency: account.currency,
    })
    .from(subjectPayback)
    .innerJoin(statementLine, eq(statementLine.id, subjectPayback.lineId))
    .innerJoin(account, eq(account.id, statementLine.accountId))
    .where(
      and(
        eq(statementLine.state, "counted"),
        subjectIds === null ? undefined : inArray(subjectPayback.subjectId, [...subjectIds]),
      ),
    )
    .orderBy(asc(statementLine.bookedOn), asc(statementLine.id));
}

type PaybackRow = Awaited<ReturnType<typeof paybackRowsIn>>[number];

const paybackLineOf = (row: PaybackRow): PaybackLine => ({
  lineId: row.lineId,
  bookedOn: row.bookedOn,
  label: row.label,
  account: { id: row.accountId, name: row.accountName, institution: row.institution },
  amount: money(Math.abs(row.amountMinor), row.currency),
});

/**
 * The subjects with the option among `rows`, each per currency its expenses or its payback lines
 * hold: what its subtree cost (`costs`, read for every subject with the option) and what came back.
 */
function paidBackOf(
  rows: ReadonlyArray<SubjectRow>,
  costs: ReadonlyArray<SubjectCost>,
  paybacks: ReadonlyArray<PaybackRow>,
): ReadonlyArray<PaidBackSubject> {
  const nodes = rows.map((row) => ({ id: row.id, parentId: row.parentId, name: row.name }));

  return rows.flatMap((row) => {
    if (row.paybackFrom === null) {
      return [];
    }

    const sums = new Map<string, { spentMinor: number; paidBackMinor: number }>();
    const sumOf = (currency: string) => sums.get(currency) ?? { spentMinor: 0, paidBackMinor: 0 };

    for (const cost of countedIn(costs, subtreeOf(nodes, row.id))) {
      const known = sumOf(cost.currency);

      sums.set(cost.currency, { ...known, spentMinor: known.spentMinor + cost.minor });
    }

    for (const line of paybacks) {
      if (line.subjectId === row.id) {
        const known = sumOf(line.currency);

        sums.set(line.currency, {
          ...known,
          paidBackMinor: known.paidBackMinor + Math.abs(line.amountMinor),
        });
      }
    }

    return [...sums].map(([currency, sum]) => ({ subjectId: row.id, currency, ...sum }));
  });
}

/** What the subjects with the option cost and got back, all time up to `day`. */
export async function paidBackSubjectsIn(
  transaction: UserTransaction,
  day: string,
): Promise<{
  readonly rows: ReadonlyArray<SubjectRow>;
  readonly paidBack: ReadonlyArray<PaidBackSubject>;
}> {
  const rows = await transaction.select().from(subject);
  const withOption = rows.filter((row) => row.paybackFrom !== null);

  if (withOption.length === 0) {
    return { rows, paidBack: [] };
  }

  const nodes = rows.map((row) => ({ id: row.id, parentId: row.parentId, name: row.name }));
  const subtrees = new Set(withOption.flatMap((row) => [...subtreeOf(nodes, row.id)]));
  const costs = await costsIn(transaction, [...subtrees], day);

  const paybacks = await paybackRowsIn(
    transaction,
    withOption.map((row) => row.id),
  );

  return { rows, paidBack: paidBackOf(rows, costs, paybacks) };
}

/**
 * What of each expense is left to the user (`leftToUserOf`), as of `day`: the reads that the
 * categories' spending (`../category-store-database`) applies it with. Every expense in full when no
 * subject has the option.
 */
export async function leftToUserIn(
  transaction: UserTransaction,
  day: string,
): Promise<(entryId: string, currency: string, netMinor: number) => number> {
  const { rows, paidBack } = await paidBackSubjectsIn(transaction, day);

  if (paidBack.length === 0) {
    return (_entryId, _currency, netMinor) => netMinor;
  }

  const links = await transaction
    .select({ entryId: entrySubject.entryId, subjectId: entrySubject.subjectId })
    .from(entrySubject);

  const subjectsOf = new Map<string, Array<string>>();

  for (const link of links) {
    subjectsOf.set(link.entryId, [...(subjectsOf.get(link.entryId) ?? []), link.subjectId]);
  }

  return leftToUserOf(
    rows.map((row) => ({ id: row.id, parentId: row.parentId, name: row.name })),
    paidBack,
    subjectsOf,
  );
}

/** A subject's figures in the user's `currency`, from what `paidBackOf` read; null without option. */
export function subjectPaybackOf(
  row: SubjectRow,
  paidBack: ReadonlyArray<PaidBackSubject>,
  currency: string,
): SubjectPayback | null {
  const settings = paybackSettingsOf(row);

  if (settings === null) {
    return null;
  }

  const own = paidBack.find((each) => each.subjectId === row.id && each.currency === currency);
  const spentMinor = own?.spentMinor ?? 0;
  const paidBackMinor = own?.paidBackMinor ?? 0;

  return {
    ...settings,
    spent: money(spentMinor, currency),
    paidBack: money(paidBackMinor, currency),
    difference: money(paidBackMinor - spentMinor, currency),
    state: paybackStateOf({ spentMinor, paidBackMinor, ...settings }),
  };
}

/** The figures of every subject with the option, by id, in the user's `currency`, as of `day`. */
export async function subjectPaybacksIn(
  transaction: UserTransaction,
  currency: string,
  day: string,
): Promise<ReadonlyMap<string, SubjectPayback>> {
  const { rows, paidBack } = await paidBackSubjectsIn(transaction, day);

  return new Map(
    rows.flatMap((row) => {
      const figures = subjectPaybackOf(row, paidBack, currency);

      return figures === null ? [] : [[row.id, figures] as const];
    }),
  );
}

/** A subject's own payback lines, oldest first. */
export async function paybackLinesIn(
  transaction: UserTransaction,
  subjectId: string,
): Promise<ReadonlyArray<PaybackLine>> {
  return (await paybackRowsIn(transaction, [subjectId])).map(paybackLineOf);
}

/** Each line's subject it pays back, by name (`../line-store-database`). */
export async function paybackSubjectsOfLines(
  transaction: UserTransaction,
  lineIds: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, { readonly id: string; readonly name: string }>> {
  if (lineIds.length === 0) {
    return new Map();
  }

  const rows = await transaction
    .select({ lineId: subjectPayback.lineId, id: subject.id, name: subject.name })
    .from(subjectPayback)
    .innerJoin(subject, eq(subject.id, subjectPayback.subjectId))
    .where(inArray(subjectPayback.lineId, [...lineIds]));

  return new Map(rows.map((row) => [row.lineId, { id: row.id, name: row.name }]));
}

/** A line that is no side of a transfer. */
const notPaired = sql`not exists (select 1 from ${transfer} t where t.out_line_id = ${statementLine.id} or t.in_line_id = ${statementLine.id})`;

/**
 * A line whose only part is the payment of an income made of that line alone: classified by
 * default, a rule or the user, neither split nor linked (#27).
 */
const aloneIncome = sql`(select count(*) from ${entryPart} p where p.line_id = ${statementLine.id}) = 1 and exists (select 1 from ${entryPart} p join ${entry} e on e.id = p.entry_id where p.line_id = ${statementLine.id} and p.role = 'payment' and e.kind = 'income' and p.amount_minor = ${statementLine.amountMinor} and not exists (select 1 from ${entryPart} q where q.entry_id = p.entry_id and q.line_id <> p.line_id))`;

/** The words of who pays back that a line's label may hold: letters and digits, 3 at least. */
const payerWords = (from: string) =>
  [...new Set(from.toLowerCase().split(/[^\p{L}\p{N}]+/u))].filter((word) => word.length >= 3);

/**
 * The lines attaching would accept for a subject with the option, booked from `from` on (none: any
 * day) up to `day`, of the user's `currency`: those whose label holds the payer's words first, then
 * the newest, `PAYBACK_CANDIDATES_SHOWN` at most. Offered, never attached unasked.
 */
export async function paybackCandidatesIn(
  transaction: UserTransaction,
  payer: string,
  from: string | null,
  currency: string,
  day: string,
): Promise<ReadonlyArray<PaybackLine>> {
  const words = payerWords(payer);
  const text = sql`(${statementLine.label} || ' ' || coalesce(${statementLine.counterpartyName}, ''))`;

  const named: SQL =
    words.length === 0
      ? sql`1`
      : sql`case when ${text} ilike any(string_to_array(${words.map((word) => `%${word}%`).join(",")}, ',')) then 0 else 1 end`;

  const rows = await transaction
    .select({
      subjectId: sql<string>`''`,
      lineId: statementLine.id,
      bookedOn: statementLine.bookedOn,
      label: statementLine.label,
      amountMinor: statementLine.amountMinor,
      accountId: account.id,
      accountName: account.name,
      institution: account.institution,
      currency: account.currency,
    })
    .from(statementLine)
    .innerJoin(account, eq(account.id, statementLine.accountId))
    .where(
      and(
        eq(statementLine.state, "counted"),
        gt(statementLine.amountMinor, 0),
        ne(statementLine.source, "balance"),
        eq(account.currency, currency),
        lte(statementLine.bookedOn, day),
        from === null ? undefined : gte(statementLine.bookedOn, from),
        notPaired,
        sql`not exists (select 1 from ${subjectPayback} b where b.line_id = ${statementLine.id})`,
        aloneIncome,
      ),
    )
    .orderBy(named, desc(statementLine.bookedOn), desc(statementLine.id))
    .limit(PAYBACK_CANDIDATES_SHOWN);

  return rows.map(paybackLineOf);
}

/** The first day the subject's candidates are booked from: its start, else its first expense's. */
export async function candidatesFromIn(
  transaction: UserTransaction,
  row: SubjectRow,
  nodes: ReadonlyArray<SubjectNode>,
  day: string,
): Promise<string | null> {
  if (row.startsOn !== null) {
    return row.startsOn;
  }

  const subtree = subtreeOf(nodes, row.id);
  const costs = countedIn(await costsIn(transaction, [...subtree], day), subtree);

  return costs.reduce<string | null>(
    (first, cost) => (first === null || cost.happenedOn < first ? cost.happenedOn : first),
    null,
  );
}

const refused = (
  reason: PaybackRefused["reason"],
  about: { lineId?: string; subjectId?: string },
) => Result.fail(new PaybackRefused({ reason, ...about }));

/** Why `lineId` cannot pay back `subjectId`, null when it can, `same` when it does already. */
async function lineProblem(
  transaction: UserTransaction,
  lineId: string,
  subjectId: string,
  currency: string,
  day: string,
): Promise<Result.Result<"attach" | "same", PaybackRefused | LineNotFound>> {
  const [line] = isId(lineId)
    ? await transaction
        .select({
          id: statementLine.id,
          state: statementLine.state,
          amountMinor: statementLine.amountMinor,
          source: statementLine.source,
          currency: account.currency,
        })
        .from(statementLine)
        .innerJoin(account, eq(account.id, statementLine.accountId))
        .where(and(eq(statementLine.id, lineId), lte(statementLine.bookedOn, day)))
    : [];

  if (line === undefined) {
    return Result.fail(new LineNotFound({ lineId }));
  }

  const about = { lineId };

  if (line.state !== "counted") {
    return refused("not_counted", about);
  }

  if (line.amountMinor === 0) {
    return refused("zero_amount", about);
  }

  if (line.amountMinor < 0) {
    return refused("going_out", about);
  }

  if (line.source === "balance") {
    return refused("made_from_balance", about);
  }

  const [attached] = await transaction
    .select({ subjectId: subjectPayback.subjectId })
    .from(subjectPayback)
    .where(eq(subjectPayback.lineId, lineId));

  if (attached !== undefined) {
    return attached.subjectId === subjectId
      ? Result.succeed("same")
      : refused("other_subject", { lineId, subjectId: attached.subjectId });
  }

  const sides = await transaction
    .select({ id: transfer.id })
    .from(transfer)
    .where(or(eq(transfer.outLineId, lineId), eq(transfer.inLineId, lineId)));

  if (sides.length > 0) {
    return refused("transfer", about);
  }

  const parts = await transaction
    .select({ entryId: entryPart.entryId, role: entryPart.role })
    .from(entryPart)
    .where(eq(entryPart.lineId, lineId));

  if (new Set(parts.map((part) => part.entryId)).size > 1) {
    return refused("split", about);
  }

  const [part] = parts;

  const others =
    part === undefined
      ? []
      : await transaction
          .select({ id: entryPart.id })
          .from(entryPart)
          .where(and(eq(entryPart.entryId, part.entryId), ne(entryPart.lineId, lineId)))
          .limit(1);

  if (part === undefined || part.role !== "payment" || others.length > 0) {
    return refused("linked", about);
  }

  if (line.currency !== currency) {
    return refused("currency", about);
  }

  return Result.succeed("attach");
}

type AttachProblem = SubjectNotFound | PaybackRefused | LineNotFound;

async function attachPaybackIn(
  transaction: UserTransaction,
  owner: string,
  subjectId: string,
  lineIds: ReadonlyArray<string>,
  currency: string,
  remove: boolean,
  day: string,
): Promise<Result.Result<PaybackAttachment, AttachProblem>> {
  const ids = [...new Set(lineIds)];

  if (ids.length > MAX_PAYBACK_LINES) {
    return refused("lines", { subjectId });
  }

  // A line's entry goes or comes back: the categories' turn, which a split and a link take; then
  // the subjects', which an edit turning the option off takes.
  await takeCategoryTurn(transaction, owner);
  await takeSubjectTurn(transaction, owner);

  const [found] = isId(subjectId)
    ? await transaction
        .select({
          id: subject.id,
          archivedAt: subject.archivedAt,
          paybackFrom: subject.paybackFrom,
        })
        .from(subject)
        .where(eq(subject.id, subjectId))
    : [];

  if (found === undefined) {
    return Result.fail(new SubjectNotFound({ subjectId }));
  }

  const valid = ids.filter(isId);
  const invalid = ids.find((each) => !isId(each));

  if (invalid !== undefined) {
    return Result.fail(new LineNotFound({ lineId: invalid }));
  }

  if (valid.length === 0) {
    return Result.succeed({ subjectId, lines: 0, changed: 0 });
  }

  // The lines take turns too, in one order, as linking locks them (`../expenses/expenses`).
  await transaction
    .select({ id: statementLine.id })
    .from(statementLine)
    .where(inArray(statementLine.id, valid))
    .orderBy(asc(statementLine.id))
    .for("no key update");

  if (remove) {
    const known = await transaction
      .select({ id: statementLine.id })
      .from(statementLine)
      .where(inArray(statementLine.id, valid));

    const missing = valid.find((each) => !known.some((line) => line.id === each));

    if (missing !== undefined) {
      return Result.fail(new LineNotFound({ lineId: missing }));
    }

    const detached = await transaction
      .delete(subjectPayback)
      .where(and(eq(subjectPayback.subjectId, subjectId), inArray(subjectPayback.lineId, valid)))
      .returning({ lineId: subjectPayback.lineId });

    // Each line detached is an income of its own again, classified by default, as unpairing does.
    await entriesForLines(
      transaction,
      owner,
      detached.map((each) => each.lineId),
    );

    return Result.succeed({ subjectId, lines: ids.length, changed: detached.length });
  }

  if (found.paybackFrom === null) {
    return refused("not_paid_back", { subjectId });
  }

  if (found.archivedAt !== null) {
    return refused("archived", { subjectId });
  }

  const toAttach: Array<string> = [];

  for (const lineId of valid) {
    const problem = await lineProblem(transaction, lineId, subjectId, currency, day);

    if (Result.isFailure(problem)) {
      return Result.fail(problem.failure);
    }

    if (problem.success === "attach") {
      toAttach.push(lineId);
    }
  }

  if (toAttach.length === 0) {
    return Result.succeed({ subjectId, lines: ids.length, changed: 0 });
  }

  // Its entry goes, an income made of the line alone: the line is classified by its subject now.
  await transaction
    .delete(entry)
    .where(
      inArray(
        entry.id,
        transaction
          .select({ id: entryPart.entryId })
          .from(entryPart)
          .where(inArray(entryPart.lineId, toAttach)),
      ),
    );

  const attached = await transaction
    .insert(subjectPayback)
    .values(toAttach.map((lineId) => ({ userId: owner, subjectId, lineId })))
    .onConflictDoNothing()
    .returning({ lineId: subjectPayback.lineId });

  return Result.succeed({ subjectId, lines: ids.length, changed: attached.length });
}

/**
 * Attaches the lines `lineIds` to a subject as what pays it back, or with `remove` detaches them:
 * attaching deletes each line's entry (it is no income), detaching gives it back its default entry.
 * Accepted: a counted line coming in, of the user's `currency`, whose one entry is an income made
 * of that whole line, for a subject with the option "paid back", not archived; attaching it again
 * changes nothing. Refused, nothing changed then: `SubjectNotFound`, `LineNotFound` (a line missing,
 * or booked after today), `PaybackRefused` with its reason (a line going out, held or discarded, of
 * nothing, made from a balance, split, linked, a side of a transfer, of another currency, or paying
 * back another subject; a subject without the option or archived; more than `MAX_PAYBACK_LINES`).
 * A line may be detached from an archived subject, or one whose option is on. Example: attach the
 * expense report `attachPayback(owner, tripId, [reportLineId], "EUR")`.
 */
export const attachPayback = (
  owner: string,
  subjectId: string,
  lineIds: ReadonlyArray<string>,
  currency: string,
  options: { readonly remove?: boolean } = {},
) =>
  Effect.gen(function* () {
    const userData = yield* UserData;
    const day = yield* today;

    const done = yield* userData.transaction(owner, (transaction) =>
      attachPaybackIn(
        transaction,
        owner,
        subjectId,
        lineIds,
        currency,
        options.remove === true,
        day,
      ),
    );

    return yield* Effect.fromResult(done);
  });

const WAITING_ORDER: ReadonlyArray<PaybackWaiting["state"]> = ["to_ask", "asked", "partly"];

/**
 * What the user still waits for: the subjects with the option, neither archived nor paid back,
 * each with how much (spent less paid back), in the user's `currency`: those to ask first, then
 * those asked, by the day they were, then those partly paid back; by path within each.
 */
export const paybacksWaiting = (owner: string, currency: string) =>
  Effect.gen(function* () {
    const userData = yield* UserData;
    const day = yield* today;

    return yield* userData.transaction(owner, async (transaction) => {
      const { rows, paidBack } = await paidBackSubjectsIn(transaction, day);
      const nodes = rows.map((row) => ({ id: row.id, parentId: row.parentId, name: row.name }));
      const order = new Map(treeOrder(nodes).map((node, index) => [node.id, index]));

      const waiting = rows.flatMap((row): ReadonlyArray<PaybackWaiting> => {
        const figures = subjectPaybackOf(row, paidBack, currency);

        if (figures === null || row.archivedAt !== null || figures.state === "paid_back") {
          return [];
        }

        return [
          {
            subjectId: row.id,
            name: row.name,
            path: pathOf(nodes, row.id),
            from: figures.from,
            askedOn: figures.askedOn,
            state: figures.state,
            spent: figures.spent,
            paidBack: figures.paidBack,
            waiting: money(figures.spent.minor - figures.paidBack.minor, currency),
          },
        ];
      });

      return waiting.toSorted(
        (a, b) =>
          WAITING_ORDER.indexOf(a.state) - WAITING_ORDER.indexOf(b.state) ||
          (a.state === "asked" ? (a.askedOn ?? "").localeCompare(b.askedOn ?? "") : 0) ||
          (order.get(a.subjectId) ?? 0) - (order.get(b.subjectId) ?? 0),
      );
    });
  });

/** Whether any line pays back `subjectId` (`./subjects`: the option cannot go while one does). */
export async function hasPaybackLinesIn(
  transaction: UserTransaction,
  subjectId: string,
): Promise<boolean> {
  const found = await transaction
    .select({ lineId: subjectPayback.lineId })
    .from(subjectPayback)
    .where(eq(subjectPayback.subjectId, subjectId))
    .limit(1);

  return found.length > 0;
}
