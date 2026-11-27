import { account, entry, entryPart, entrySubject, statementLine } from "@gousset/db/schema/ledger";
import type { UserTransaction } from "@gousset/db/user-data";
import { and, asc, eq, exists, inArray, lte, sql } from "drizzle-orm";

import { costsOf } from "./counting";
import type { CostPart, SubjectCost } from "./counting";

/**
 * The expenses attached to any of `subjectIds` (every subject when null), happened up to `day`,
 * each at its net cost per currency, with the subjects among those it is attached to.
 */
export async function costsIn(
  transaction: UserTransaction,
  subjectIds: ReadonlyArray<string> | null,
  day: string,
): Promise<ReadonlyArray<SubjectCost>> {
  const among = subjectIds === null ? undefined : inArray(entrySubject.subjectId, [...subjectIds]);

  if (subjectIds !== null && subjectIds.length === 0) {
    return [];
  }

  const links = await transaction
    .select({ entryId: entrySubject.entryId, subjectId: entrySubject.subjectId })
    .from(entrySubject)
    .where(among);

  if (links.length === 0) {
    return [];
  }

  const subjectsOf = new Map<string, Array<string>>();

  for (const link of links) {
    subjectsOf.set(link.entryId, [...(subjectsOf.get(link.entryId) ?? []), link.subjectId]);
  }

  const parts: ReadonlyArray<CostPart> = await transaction
    .select({
      entryId: entry.id,
      happenedOn: entry.happenedOn,
      categoryId: entry.categoryId,
      role: entryPart.role,
      amountMinor: entryPart.amountMinor,
      currency: account.currency,
    })
    .from(entry)
    .innerJoin(entryPart, eq(entryPart.entryId, entry.id))
    .innerJoin(statementLine, eq(statementLine.id, entryPart.lineId))
    .innerJoin(account, eq(account.id, statementLine.accountId))
    .where(
      and(
        eq(entry.kind, "expense"),
        lte(entry.happenedOn, day),
        exists(
          transaction
            .select({ one: sql`1` })
            .from(entrySubject)
            .where(and(eq(entrySubject.entryId, entry.id), among)),
        ),
      ),
    )
    .orderBy(asc(entry.happenedOn), asc(entry.id));

  return costsOf(parts, subjectsOf);
}
