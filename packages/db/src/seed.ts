import { createHash } from "node:crypto";

import {
  closingBalanceMinor,
  exampleStatement,
  madeUpAccounts,
  madeUpMonth,
  monthParts,
  writeOfx,
} from "@gousset/fixture";
import type { Statement } from "@gousset/fixture";
import { Effect } from "effect";

import {
  account,
  accountBalance,
  importFile,
  statementImport,
  statementLine,
} from "./schema/ledger";
import type { accountEnvelope } from "./schema/ledger";
import { transfer } from "./schema/transfers";
import { UserData } from "./user-data";
import type { QueryFailed, UserTransaction } from "./user-data";

// The shared made-up data of `packages/fixture` written into a user's tables: the development
// database (`pnpm db:seed`) and the end-to-end tests that need rows. Each made-up account gets one
// OFX import a month, its file, its lines and the statement's closing balance, and its transfers
// paired as the import pairs them (#26). It goes through `UserData`, as the app's own writes do. The fixture's sample statements of other formats (#17)
// are not written yet.

type Envelope = (typeof accountEnvelope.enumValues)[number];

/** What the fixture leaves to the data model: the envelope and the balance before the first line. */
const ENVELOPES: ReadonlyMap<string, Envelope> = new Map([
  ["livret-a", "livret_a"],
  ["pea", "pea"],
]);

const OPENING_BALANCES: ReadonlyMap<string, number> = new Map([
  ["current", 184_250],
  ["livret-a", 1_250_000],
]);

/** What a seed wrote; all zero for a user who already had an account. */
export type SeedSummary = { accounts: number; imports: number; lines: number };

/** The `count` months that end with the month of `today` (`YYYY-MM-DD`), oldest first. */
export function recentMonths(today: string, count: number): ReadonlyArray<string> {
  const { year, month } = monthParts(today.slice(0, 7));

  return Array.from({ length: count }, (_, index) => {
    const first = new Date(Date.UTC(year, month - count + index, 1));

    return first.toISOString().slice(0, 7);
  });
}

function lastDayOf(month: string): string {
  const { year, month: number } = monthParts(month);

  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
}

function only<Row>(rows: ReadonlyArray<Row>): Row {
  const [row] = rows;

  if (row === undefined) {
    throw new Error("The insert returned no row.");
  }

  return row;
}

async function writeMadeUpData(
  transaction: UserTransaction,
  owner: string,
  months: ReadonlyArray<string>,
  today: string,
): Promise<SeedSummary> {
  const existing = await transaction.select({ id: account.id }).from(account).limit(1);

  if (existing.length > 0) {
    return { accounts: 0, imports: 0, lines: 0 };
  }

  const summary = { accounts: 0, imports: 0, lines: 0 };
  const accountIds = new Map<string, string>();
  const balances = new Map<string, number>();
  // The made-up lines' rows, by the made-up id, and the other side of each made-up transfer.
  const lineIds = new Map<string, string>();
  const otherSides = new Map<string, string>();

  for (const made of madeUpAccounts) {
    const openingBalanceMinor = OPENING_BALANCES.get(made.id) ?? 0;

    const created = only(
      await transaction
        .insert(account)
        .values({
          userId: owner,
          name: made.name,
          kind: made.kind,
          envelope: ENVELOPES.get(made.id) ?? null,
          institution: made.bank,
          currency: made.currency,
          openingBalanceMinor,
        })
        .returning({ id: account.id }),
    );

    accountIds.set(made.id, created.id);
    balances.set(made.id, openingBalanceMinor);
    summary.accounts += 1;
  }

  for (const month of months) {
    // Nothing booked after today, as on a statement downloaded today.
    const lines = madeUpMonth(month).lines.filter((line) => line.bookedOn <= today);

    for (const line of lines) {
      if (line.amountMinor < 0 && line.counterpartLineId !== null) {
        otherSides.set(line.id, line.counterpartLineId);
      }
    }

    const end = lastDayOf(month);
    const to = end < today ? end : today;

    for (const made of madeUpAccounts) {
      const accountId = accountIds.get(made.id);
      const ofAccount = lines.filter((line) => line.accountId === made.id);

      if (accountId === undefined || ofAccount.length === 0) {
        continue;
      }

      const statement: Statement = {
        bank: { ...exampleStatement.bank, name: made.bank },
        account: { ...exampleStatement.account, number: made.id, currency: made.currency },
        from: `${month}-01`,
        to,
        openingBalanceMinor: balances.get(made.id) ?? 0,
        lines: ofAccount.map((line) => ({
          bookedOn: line.bookedOn,
          amountMinor: line.amountMinor,
          label: line.label,
          reference: line.id,
        })),
      };

      const content = Buffer.from(writeOfx(statement), "utf8");

      const created = only(
        await transaction
          .insert(statementImport)
          .values({
            userId: owner,
            accountId,
            fileName: `${made.id}-${month}.ofx`,
            fileSha256: createHash("sha256").update(content).digest("hex"),
            format: "ofx",
            status: "done",
            periodFrom: statement.from,
            periodTo: statement.to,
            linesRead: ofAccount.length,
            linesAdded: ofAccount.length,
            finishedAt: new Date(),
          })
          .returning({ id: statementImport.id }),
      );

      await transaction.insert(importFile).values({ importId: created.id, userId: owner, content });

      // Oldest first, as the import saves a file's lines.
      const saved = await transaction
        .insert(statementLine)
        .values(
          statement.lines.map((line) => ({
            userId: owner,
            accountId,
            importId: created.id,
            source: "import" as const,
            bookedOn: line.bookedOn,
            amountMinor: line.amountMinor,
            label: line.label,
            bankId: line.reference,
            dedupKey: `bank:${line.reference}`,
          })),
        )
        .returning({ id: statementLine.id, bankId: statementLine.bankId });

      for (const line of saved) {
        if (line.bankId !== null) {
          lineIds.set(line.bankId, line.id);
        }
      }

      const closing = closingBalanceMinor(statement);

      await transaction.insert(accountBalance).values({
        userId: owner,
        accountId,
        day: statement.to,
        balanceMinor: closing,
        source: "statement",
        importId: created.id,
      });

      balances.set(made.id, closing);
      summary.imports += 1;
      summary.lines += ofAccount.length;
    }
  }

  const pairs = [...otherSides].flatMap(([out, into]) => {
    const outLineId = lineIds.get(out);
    const inLineId = lineIds.get(into);

    return outLineId === undefined || inLineId === undefined
      ? []
      : [{ userId: owner, outLineId, inLineId, pairedBy: "import" as const }];
  });

  if (pairs.length > 0) {
    await transaction.insert(transfer).values(pairs);
  }

  return summary;
}

/**
 * Writes the made-up accounts, and their imports and lines for `months` up to `today`, as
 * `owner`'s own rows. A user who already has an account is left as they are.
 */
export function seedMadeUpData(
  owner: string,
  months: ReadonlyArray<string>,
  today: string,
): Effect.Effect<SeedSummary, QueryFailed, UserData> {
  return Effect.gen(function* () {
    const userData = yield* UserData;

    return yield* userData.transaction(owner, (transaction) =>
      writeMadeUpData(transaction, owner, months, today),
    );
  });
}
