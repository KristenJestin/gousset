import { account, statementImport, statementLine } from "@gousset/db/schema/ledger";
import { sql } from "drizzle-orm";

import { expect, test } from "../src/test";
import {
  ACCOUNTS,
  USER_TABLES,
  keyArray,
  keysOf,
  openUserData,
  touchedKeys,
} from "../src/user-data";

// Issue #13, "How to verify": a user never reads, changes or deletes another user's row. Each rule
// is tried on every table holding a user's rows, through `UserData`, the transaction every server
// function, MCP tool and job opens for a user (docs/data-model.md, "Ownership and isolation"). The
// two users are the worker's, signed up through the app; each gets the shared made-up data.

let data: ReturnType<typeof openUserData>;
let alex = "";
let sam = "";

test.beforeAll(async ({ app, user, secondUser }) => {
  data = openUserData(app.database);
  alex = await data.ownerOf(user.email);
  sam = await data.ownerOf(secondUser.email);

  // A user who already has the rows (a worker that runs this file again) is left as they are.
  await data.seed(alex);
  await data.seed(sam);
});

test.afterAll(async () => {
  await data.close();
});

test("every table holding a user's rows is kept apart by row-level security", async () => {
  expect(await data.tablesWithOwner()).toEqual(USER_TABLES.map((table) => table.name).toSorted());

  // The role a user's transaction acts as is restricted by row-level security, and logs in never.
  expect(await data.userRole()).toEqual([
    { superuser: false, bypassesRowSecurity: false, logsIn: false },
  ]);

  for (const table of USER_TABLES) {
    expect(await data.isolationOf(table.name), table.name).toEqual([
      { rowSecurity: true, ownerPolicy: true, granted: true },
    ]);
  }
});

for (const table of USER_TABLES) {
  test(`a user never reads another user's ${table.rows}`, async () => {
    const theirs = await data.asUser(sam, (transaction) => keysOf(transaction, table));
    const mine = await data.asUser(alex, (transaction) => keysOf(transaction, table));

    expect(theirs.length).toBeGreaterThan(0);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.filter((key) => theirs.includes(key))).toEqual([]);
    // Named by their keys, they are not found either.
    expect(await data.asUser(alex, (transaction) => keysOf(transaction, table, theirs))).toEqual(
      [],
    );
  });

  test(`a user never changes another user's ${table.rows}`, async () => {
    const theirs = await data.asUser(sam, (transaction) => keysOf(transaction, table));
    const key = sql.identifier(table.key);

    // Taking them over: the update meets none of them.
    const taken = await data.asUser(alex, (transaction) =>
      touchedKeys(
        transaction,
        sql`update ${sql.identifier(table.name)} set user_id = ${alex}
            where ${key}::text = any(${keyArray(theirs)}) returning ${key}::text as key`,
      ),
    );

    expect(taken).toEqual([]);
    expect(await data.asUser(sam, (transaction) => keysOf(transaction, table))).toEqual(theirs);
  });

  test(`a user never deletes another user's ${table.rows}`, async () => {
    const theirs = await data.asUser(sam, (transaction) => keysOf(transaction, table));
    const key = sql.identifier(table.key);

    const deleted = await data.asUser(alex, (transaction) =>
      touchedKeys(
        transaction,
        sql`delete from ${sql.identifier(table.name)}
            where ${key}::text = any(${keyArray(theirs)}) returning ${key}::text as key`,
      ),
    );

    expect(deleted).toEqual([]);
    expect(await data.asUser(sam, (transaction) => keysOf(transaction, table))).toEqual(theirs);
  });

  test(`a user never hands their ${table.rows} to another user`, async () => {
    const mine = await data.asUser(alex, (transaction) => keysOf(transaction, table));
    const key = sql.identifier(table.key);

    // Row-level security refuses the new owner: 42501, whatever the foreign keys would say.
    expect(
      await data.refusal(alex, (transaction) =>
        transaction.execute(
          sql`update ${sql.identifier(table.name)} set user_id = ${sam}
              where ${key}::text = any(${keyArray(mine)})`,
        ),
      ),
    ).toBe("42501");

    expect(await data.asUser(alex, (transaction) => keysOf(transaction, table))).toEqual(mine);
  });
}

test("a user never writes a row in another user's name", async () => {
  expect(
    await data.refusal(alex, (transaction) =>
      transaction
        .insert(account)
        .values({ userId: sam, name: "Not theirs", kind: "current", currency: "EUR" }),
    ),
  ).toBe("42501");

  const [samsAccount] = await data.asUser(sam, (transaction) =>
    transaction.select({ id: account.id }).from(account).limit(1),
  );

  expect(samsAccount).toBeDefined();

  expect(
    await data.refusal(alex, (transaction) =>
      transaction.insert(statementLine).values({
        userId: sam,
        accountId: samsAccount?.id ?? "",
        source: "manual",
        bookedOn: "2026-10-15",
        amountMinor: -1000,
        label: "NOT THEIRS",
      }),
    ),
  ).toBe("42501");
});

test("a user never attaches a row to another user's row", async () => {
  const [samsAccount] = await data.asUser(sam, (transaction) =>
    transaction.select({ id: account.id }).from(account).limit(1),
  );

  expect(samsAccount).toBeDefined();

  const theirAccount = samsAccount?.id ?? "";

  // In their own name, on the other user's account: the composite foreign key refuses it, 23503.
  expect(
    await data.refusal(alex, (transaction) =>
      transaction.insert(statementLine).values({
        userId: alex,
        accountId: theirAccount,
        source: "manual",
        bookedOn: "2026-10-15",
        amountMinor: -1000,
        label: "ON THEIR ACCOUNT",
      }),
    ),
  ).toBe("23503");

  expect(
    await data.refusal(alex, (transaction) =>
      transaction.insert(statementImport).values({
        userId: alex,
        accountId: theirAccount,
        fileName: "theirs.ofx",
        fileSha256: "0".repeat(64),
        format: "ofx",
      }),
    ),
  ).toBe("23503");
});

test("a transaction opened for no user sees no row", async () => {
  for (const table of USER_TABLES) {
    expect(await data.asUser("", (transaction) => keysOf(transaction, table)), table.name).toEqual(
      [],
    );
  }
});

test("a user's transaction leaves neither its role nor its user on the connection", async () => {
  await data.asUser(alex, (transaction) => keysOf(transaction, ACCOUNTS));

  const [session] = await data.session();

  expect(session?.role).not.toBe("gousset_user");
  expect(session?.owner).toBe("");
});
