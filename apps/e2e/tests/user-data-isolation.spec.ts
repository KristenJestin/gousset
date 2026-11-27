import {
  account,
  entry,
  entrySubject,
  merchant,
  merchantAlias,
  merchantLogo,
  rule,
  statementImport,
  statementLine,
  subject,
  subjectAccount,
  subjectEntryRefused,
} from "@gousset/db/schema/ledger";
import { eq, sql } from "drizzle-orm";

import { expect, test } from "../src/test";
import {
  ACCOUNTS,
  JOBS_SCHEMA,
  SEED_LOGO,
  SHARED_TABLES,
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
  // A file upload belongs to an MCP grant: each user gets one for these tests alone.
  await data.seedFileUpload(alex);
  await data.seedFileUpload(sam);
});

test.afterAll(async () => {
  try {
    await data.forgetFileUploads(alex);
    await data.forgetFileUploads(sam);
  } finally {
    await data.close();
  }
});

test("every table holding a user's rows is kept apart by row-level security", async () => {
  expect(await data.tablesWithOwner()).toEqual(USER_TABLES.map((table) => table.name).toSorted());

  // The role a user's transaction acts as is restricted by row-level security, and logs in never.
  expect(await data.userRole()).toEqual([
    { superuser: false, bypassesRowSecurity: false, logsIn: false },
  ]);

  for (const table of USER_TABLES) {
    expect(await data.isolationOf(table.name), table.name).toEqual([
      { rowSecurity: true, forced: true, ownerPolicy: true, granted: true },
    ]);
  }
});

// Issue #66: the app's own role cannot step past row-level security either. It is no superuser,
// does not bypass row-level security and owns no table, so that SQL run outside `UserData`, or
// that undoes its role, meets the policies or no grant at all.
test("the app logs in as a role that row-level security binds", async () => {
  expect(await data.appRole()).toEqual([
    { role: "gousset_app", superuser: false, bypassesRowSecurity: false, ownsTables: false },
  ]);
});

test("every table the app reaches is a user's, kept apart, or shared on purpose", async () => {
  // A user's transaction reaches the users' tables, each kept apart above, and nothing else.
  expect(await data.reachableTables("gousset_user")).toEqual(
    USER_TABLES.map((table) => `public.${table.name}`).toSorted(),
  );

  // The app's own role reaches what is no user's data, and pg-boss's schema, which it owns (its
  // tables, made as the app starts, are pg-boss's own).
  const reached = await data.reachableTables("gousset_app");

  expect(reached.filter((table) => !table.startsWith(`${JOBS_SCHEMA}.`))).toEqual(
    SHARED_TABLES.map((table) => `public.${table}`).toSorted(),
  );
});

test("a query outside UserData fails closed", async () => {
  for (const table of USER_TABLES) {
    // On the app's own handle, the query has no grant to run on.
    expect(await data.outside((app) => keysOf(app, table)), table.name).toBe("42501");

    // Naming a user without `UserData` reaches nothing more.
    expect(
      await data.outside((app) =>
        app.transaction(async (transaction) => {
          await transaction.execute(sql`select set_config('gousset.user_id', ${sam}, true)`);

          return keysOf(transaction, table);
        }),
      ),
      table.name,
    ).toBe("42501");
  }
});

test("RESET ROLE inside a user's transaction gains nothing", async () => {
  for (const table of USER_TABLES) {
    expect(
      await data.refusal(alex, async (transaction) => {
        await transaction.execute(sql`reset role`);

        return keysOf(transaction, table);
      }),
      table.name,
    ).toBe("42501");
  }

  // Nor does the role taken again by hand: the app's own role is all a session can return to.
  expect(
    await data.refusal(alex, async (transaction) => {
      await transaction.execute(sql`set role none`);
      await transaction.execute(sql`set session authorization default`);

      return keysOf(transaction, ACCOUNTS);
    }),
  ).toBe("42501");
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

  const [samsMerchant] = await data.asUser(sam, (transaction) =>
    transaction.select({ id: merchant.id }).from(merchant).limit(1),
  );

  expect(samsMerchant).toBeDefined();

  // A cleaned label of one's own, naming the other user's merchant.
  expect(
    await data.refusal(alex, (transaction) =>
      transaction.insert(merchantAlias).values({
        userId: alex,
        merchantId: samsMerchant?.id ?? "",
        alias: "NOT THEIR SHOP",
      }),
    ),
  ).toBe("23503");

  // A logo of one's own on the other user's merchant (#204), one with no logo yet.
  const samsMerchants = await data.asUser(sam, (transaction) =>
    transaction
      .select({ id: merchant.id, logo: merchantLogo.merchantId })
      .from(merchant)
      .leftJoin(merchantLogo, eq(merchantLogo.merchantId, merchant.id)),
  );

  const bare = samsMerchants.find((each) => each.logo === null);

  expect(bare).toBeDefined();
  expect(
    await data.refusal(alex, (transaction) =>
      transaction.insert(merchantLogo).values({
        merchantId: bare?.id ?? "",
        userId: alex,
        mediaType: "image/png",
        content: Buffer.from(SEED_LOGO),
        sha256: "0".repeat(64),
      }),
    ),
  ).toBe("23503");

  // A rule of one's own that sets the other user's merchant (#25).
  expect(
    await data.refusal(alex, (transaction) =>
      transaction.insert(rule).values({
        userId: alex,
        conditions: {
          kind: "group",
          combinator: "and",
          children: [{ kind: "rule", field: "label", operator: "contains", value: "THEIRS" }],
        },
        setMerchantId: samsMerchant?.id ?? "",
        createdFrom: "user",
      }),
    ),
  ).toBe("23503");

  // An expense of one's own attached to the other user's subject (#37).
  const [samsSubject] = await data.asUser(sam, (transaction) =>
    transaction.select({ id: subject.id }).from(subject).limit(1),
  );

  expect(samsSubject).toBeDefined();

  expect(
    await data.refusal(alex, async (transaction) => {
      const [own] = await transaction.select({ id: entry.id }).from(entry).limit(1);

      await transaction
        .insert(entrySubject)
        .values({ userId: alex, entryId: own?.id ?? "", subjectId: samsSubject?.id ?? "" });
    }),
  ).toBe("23503");

  const [samsEntry] = await data.asUser(sam, (transaction) =>
    transaction.select({ id: entry.id }).from(entry).limit(1),
  );

  expect(samsEntry).toBeDefined();

  const theirEntry = samsEntry?.id ?? "";
  const theirSubject = samsSubject?.id ?? "";

  // One's own subject, expense and account, each beside the other user's.
  const own = await data.asUser(alex, async (transaction) => ({
    subject: (await transaction.select({ id: subject.id }).from(subject).limit(1))[0]?.id ?? "",
    entry: (await transaction.select({ id: entry.id }).from(entry).limit(1))[0]?.id ?? "",
    account: (await transaction.select({ id: account.id }).from(account).limit(1))[0]?.id ?? "",
  }));

  expect(own.subject).not.toBe("");
  expect(own.entry).not.toBe("");
  expect(own.account).not.toBe("");

  // The other user's expense attached to a subject of one's own.
  expect(
    await data.refusal(alex, (transaction) =>
      transaction
        .insert(entrySubject)
        .values({ userId: alex, entryId: theirEntry, subjectId: own.subject }),
    ),
  ).toBe("23503");

  // A subject of one's own linked to the other user's account, and theirs to one's own account.
  expect(
    await data.refusal(alex, (transaction) =>
      transaction
        .insert(subjectAccount)
        .values({ userId: alex, subjectId: own.subject, accountId: theirAccount }),
    ),
  ).toBe("23503");
  expect(
    await data.refusal(alex, (transaction) =>
      transaction
        .insert(subjectAccount)
        .values({ userId: alex, subjectId: theirSubject, accountId: own.account }),
    ),
  ).toBe("23503");

  // A subject of one's own inside the other user's subject (checked as the transaction commits).
  expect(
    await data.refusal(alex, (transaction) =>
      transaction
        .insert(subject)
        .values({ userId: alex, name: "Not their shed", parentId: theirSubject }),
    ),
  ).toBe("23503");

  // A subject of one's own bought with the other user's loan.
  expect(
    await data.refusal(alex, (transaction) =>
      transaction
        .insert(subject)
        .values({ userId: alex, name: "Not their van", loanAccountId: theirAccount }),
    ),
  ).toBe("23503");

  // A proposal declined for a subject of one's own on the other user's expense, and the other way.
  expect(
    await data.refusal(alex, (transaction) =>
      transaction
        .insert(subjectEntryRefused)
        .values({ userId: alex, subjectId: own.subject, entryId: theirEntry }),
    ),
  ).toBe("23503");
  expect(
    await data.refusal(alex, (transaction) =>
      transaction
        .insert(subjectEntryRefused)
        .values({ userId: alex, subjectId: theirSubject, entryId: own.entry }),
    ),
  ).toBe("23503");

  // A rule of one's own that attaches the other user's subject.
  expect(
    await data.refusal(alex, (transaction) =>
      transaction.insert(rule).values({
        userId: alex,
        conditions: {
          kind: "group",
          combinator: "and",
          children: [{ kind: "rule", field: "label", operator: "contains", value: "THEIRS" }],
        },
        attachSubjectId: theirSubject,
        createdFrom: "user",
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

  expect(session?.role).toBe("gousset_app");
  expect(session?.owner).toBe("");
});
