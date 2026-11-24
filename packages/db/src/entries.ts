import { sql } from "drizzle-orm";

import type { UserTransaction } from "./user-data";

/**
 * Gives an entry to each line among `lineIds` that is `owner`'s, counted, has an amount, no part
 * yet and is no side of a transfer (docs/data-model.md, v0.3: a line is an entry's or a transfer's,
 * never both): an expense when money leaves, an income when it comes in, the day
 * it was booked, in its kind's fallback category, with one payment part of the whole line,
 * `classified_by = default`. A line that has a part is left as it is, so a second call adds
 * nothing; a user without fallback categories gets none (packages/core copies the default set
 * first). The logic that calls it is packages/core's (`entriesForLines`); the development seed
 * calls it too.
 */
export async function insertDefaultEntries(
  transaction: UserTransaction,
  owner: string,
  lineIds: ReadonlyArray<string>,
): Promise<void> {
  if (lineIds.length === 0) {
    return;
  }

  // The ids go as one array parameter (uuids hold no comma), where Drizzle would spread a
  // JavaScript array into a list of them. `pending` is read twice and calls a volatile function:
  // Postgres computes it once. Both inserts' foreign keys are checked at the end of the statement.
  await transaction.execute(sql`
    with pending as materialized (
      select uuidv7() as entry_id, l.id as line_id, l.booked_on, abs(l.amount_minor) as amount,
        c.id as category_id, c.kind
      from statement_line l
      join category c on c.user_id = l.user_id and c.is_fallback
        and c.kind = (case when l.amount_minor < 0 then 'expense' else 'income' end)::entry_kind
      where l.id = any(string_to_array(${lineIds.join(",")}, ',')::uuid[])
        and l.user_id = ${owner} and l.state = 'counted' and l.amount_minor <> 0
        and not exists (select 1 from entry_part p where p.line_id = l.id)
        and not exists (select 1 from transfer t where l.id in (t.out_line_id, t.in_line_id))
      order by l.booked_on, l.id
    ), made as (
      insert into entry (id, user_id, kind, happened_on, category_id, classified_by)
      select entry_id, ${owner}, kind, booked_on, category_id, 'default' from pending
      returning id
    )
    insert into entry_part (user_id, entry_id, line_id, role, amount_minor)
    select ${owner}, entry_id, line_id, 'payment', amount from pending`);
}
