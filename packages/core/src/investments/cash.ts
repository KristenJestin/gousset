import { investmentOperation } from "@gousset/db/schema/investments";
import { statementLine } from "@gousset/db/schema/ledger";
import { sql } from "drizzle-orm";

import type { OperationKind } from "./positions";

// What an operation's line counts as (docs/data-model.md, v0.6). A deposit's and a withdrawal's
// lines are the account's money coming in or going out: ordinary lines, with their default entry
// until paired as a transfer. A purchase's, a sale's, a dividend's and a fee's lines move money
// inside the account: none of the month's. Such a line has no entry, is never a transfer's side,
// and is left out of whatever reads lines to classify them: the default entries
// (`@gousset/db/entries`, which writes the same test in SQL), the pairing of transfers, the
// recognition of merchants. The rules, the top-ups, the refunds proposed and the lines to review
// reach lines through their entries, and so never meet one.

/** The kinds whose line is cash moving inside the account, none of the month's. */
export const INSIDE_KINDS: ReadonlyArray<OperationKind> = ["purchase", "sale", "dividend", "fee"];

/** Whether an operation of this kind leaves its line out of the month (`INSIDE_KINDS`). */
export const movesInside = (kind: OperationKind): boolean => INSIDE_KINDS.includes(kind);

/**
 * A line of `statement_line`, as the query names it, that is no purchase's, sale's, dividend's nor
 * fee's cash.
 */
export const notOperationCash = sql`not exists (select 1 from ${investmentOperation} where ${investmentOperation.lineId} = ${statementLine.id} and ${investmentOperation.kind} in ('purchase', 'sale', 'dividend', 'fee'))`;

/** The opposite: a line that is a purchase's, sale's, dividend's or fee's cash. */
export const operationCash = sql<boolean>`exists (select 1 from ${investmentOperation} where ${investmentOperation.lineId} = ${statementLine.id} and ${investmentOperation.kind} in ('purchase', 'sale', 'dividend', 'fee'))`;
