import { account, accountBalance, statementImport, statementLine } from "@gousset/db/schema/ledger";
import type { UserTransaction } from "@gousset/db/user-data";
import { exampleStatement } from "@gousset/fixture";

import { expect, test } from "../src/test";
import { openUserData } from "../src/user-data";

// The rules docs/data-model.md asks the database itself to keep, which later code relies on. Each
// is tried in a transaction of the user's that is rolled back, so the worker's rows never change.

let data: ReturnType<typeof openUserData>;
let alex = "";

test.beforeAll(async ({ app, user }) => {
  data = openUserData(app.database);
  alex = await data.ownerOf(user.email);

  await data.seed(alex);
});

test.afterAll(async () => {
  await data.close();
});

/** An account of the user's that was imported into, with one of its imports. */
async function importedAccount(transaction: UserTransaction) {
  const [found] = await transaction
    .select({ accountId: statementImport.accountId, importId: statementImport.id })
    .from(statementImport)
    .limit(1);

  if (found === undefined || found.accountId === null) {
    throw new Error("The seed wrote no import.");
  }

  return { accountId: found.accountId, importId: found.importId };
}

const newAccount = (iban: string | null, number: string | null = null) => ({
  userId: alex,
  name: "Joint account",
  kind: "current" as const,
  currency: "EUR",
  iban,
  number,
});

test("an account's IBAN is kept upper case without spaces", async () => {
  const iban = exampleStatement.account.iban;
  const grouped = iban.replaceAll(/(.{4})/g, "$1 ").trim();

  expect(
    await data.attempt(alex, (each) => each.insert(account).values(newAccount(iban.toLowerCase()))),
  ).toBe("23514");
  expect(await data.attempt(alex, (each) => each.insert(account).values(newAccount(grouped)))).toBe(
    "23514",
  );
  expect(await data.attempt(alex, (each) => each.insert(account).values(newAccount(iban)))).toBe(
    "accepted",
  );

  // Written in one form, the same IBAN names one account of the user's only.
  expect(
    await data.attempt(alex, async (each) => {
      await each.insert(account).values(newAccount(iban));
      await each.insert(account).values(newAccount(iban));
    }),
  ).toBe("23505");
});

test("two accounts of a user may share an account number", async () => {
  // Two banks, or two masked cards, can give the same OFX ACCTID: the file waits for a choice.
  expect(
    await data.attempt(alex, async (each) => {
      await each.insert(account).values(newAccount(null, "XXXX1234"));
      await each.insert(account).values(newAccount(null, "XXXX1234"));
    }),
  ).toBe("accepted");
});

test("a line's original currency is an ISO 4217 code", async () => {
  const line = (accountId: string, originalCurrency: string) => ({
    userId: alex,
    accountId,
    source: "manual" as const,
    bookedOn: "2026-10-15",
    amountMinor: -1150,
    originalAmountMinor: -1250,
    originalCurrency,
    label: "CB HARBOUR BOOKS",
  });

  expect(
    await data.attempt(alex, async (each) => {
      const { accountId } = await importedAccount(each);

      await each.insert(statementLine).values(line(accountId, "usd"));
    }),
  ).toBe("23514");
  expect(
    await data.attempt(alex, async (each) => {
      const { accountId } = await importedAccount(each);

      await each.insert(statementLine).values(line(accountId, "USD"));
    }),
  ).toBe("accepted");
});

test("every imported line has a dedup key, and no other line has one", async () => {
  const line = (accountId: string, importId: string | null, dedupKey: string | null) => ({
    userId: alex,
    accountId,
    importId,
    source: importId === null ? ("manual" as const) : ("import" as const),
    bookedOn: "2026-10-15",
    amountMinor: -320,
    label: "CB CORNER CAFE",
    dedupKey,
  });

  expect(
    await data.attempt(alex, async (each) => {
      const { accountId, importId } = await importedAccount(each);

      await each.insert(statementLine).values(line(accountId, importId, null));
    }),
  ).toBe("23514");
  expect(
    await data.attempt(alex, async (each) => {
      const { accountId } = await importedAccount(each);

      await each.insert(statementLine).values(line(accountId, null, "content:made-by-hand#1"));
    }),
  ).toBe("23514");
});

test("an account has one noted balance a day, and statements may repeat a day", async () => {
  const balance = (accountId: string, importId: string | null, day: string) => ({
    userId: alex,
    accountId,
    importId,
    day,
    balanceMinor: 120_000,
    source: importId === null ? ("noted" as const) : ("statement" as const),
  });

  expect(
    await data.attempt(alex, async (each) => {
      const { accountId } = await importedAccount(each);

      await each.insert(accountBalance).values(balance(accountId, null, "2026-11-30"));
      await each.insert(accountBalance).values(balance(accountId, null, "2026-11-30"));
    }),
  ).toBe("23505");
  expect(
    await data.attempt(alex, async (each) => {
      const { accountId, importId } = await importedAccount(each);

      // Two overlapping files each give their balance of the day, beside a noted one.
      await each.insert(accountBalance).values(balance(accountId, importId, "2026-11-30"));
      await each.insert(accountBalance).values(balance(accountId, importId, "2026-11-30"));
      await each.insert(accountBalance).values(balance(accountId, null, "2026-11-30"));
      await each.insert(accountBalance).values(balance(accountId, null, "2026-12-31"));
    }),
  ).toBe("accepted");
});
