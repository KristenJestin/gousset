import { minorDigits } from "@gousset/currency";
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { conditionsQuery } from "./conditions";
import type { Conditions } from "./conditions";

/**
 * A rule's conditions as SQL, for a `where` over rows named as the fields are (`label`, `account`,
 * `amount`, `direction`, `day`, `date`). Every value is a parameter: qnot writes `$n` placeholders,
 * each bound here to its value, in its place.
 */
export function conditionsSql(conditions: Conditions): SQL {
  const encoded = conditionsQuery(conditions);
  const pieces = encoded.sql.split(/\$(\d+)/);
  const chunks: Array<SQL> = [];

  for (const [index, piece] of pieces.entries()) {
    chunks.push(index % 2 === 0 ? sql.raw(piece) : sql`${encoded.params[Number(piece) - 1]}`);
  }

  return sql.join(chunks);
}

/**
 * How many units of a currency make one of its amounts, as SQL over an account's `currency`, for
 * the currencies the user's accounts hold: 100 for most, 1 for JPY, 1000 for KWD.
 */
export function unitsSql(currencyColumn: SQL, currencies: ReadonlyArray<string>): SQL {
  const others = [...new Set(currencies)].filter((currency) => minorDigits(currency) !== 2);

  if (others.length === 0) {
    return sql`100`;
  }

  const cases = others.map(
    (currency) => sql`when ${currency} then ${10 ** minorDigits(currency)}::numeric`,
  );

  return sql`(case ${currencyColumn} ${sql.join(cases, sql` `)} else 100 end)`;
}
