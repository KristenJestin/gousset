import type { Page } from "@playwright/test";
import {
  DatabaseAccountStore,
  investmentAccounts,
  investmentOperations,
  investmentsLayer,
} from "@gousset/core";
import type { AccountStore, Investments, PositionRead } from "@gousset/core";
import type { UserData } from "@gousset/db/user-data";
import { Effect, Layer } from "effect";

import type { WorkerEnvironment } from "../src/app-server";
import type { TestUser } from "../src/auth";
import { addUser, connectMcp, expect, personOfItsOwn, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #250 through the MCP door: the `investments` tool, called by the official MCP client over
// the real OAuth flow, against the built app and a real Postgres, on the made-up data's PEA
// (`@gousset/fixture`, "Northbank PEA": two ETFs bought each month, a custody fee, a dividend).
// Each test has a user of its own, so that no other test's operations meet its own. Every amount
// and ISIN is invented; the ISINs are in the country code XX, which no country has.

const PEA = "Northbank PEA (Northbank)";

/** The made-up World Index ETF's invented ISIN. */
const WORLD = "XX0000000002";

let data: ReturnType<typeof openUserData>;

test.beforeAll(({ app }) => {
  data = openUserData(app.database);
});

test.afterAll(async () => {
  await data.close();
});

/** Runs the investments' reads on the worker's database, as the app reads them. */
const run = <A, E>(effect: Effect.Effect<A, E, Investments | AccountStore | UserData>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Layer.mergeAll(investmentsLayer, DatabaseAccountStore).pipe(Layer.provideMerge(data.layer)),
      ),
    ),
  );

const allowReadOnly = (page: Page) => page.getByRole("button", { name: "Allow read only" }).click();

const allowReadAndWrite = (page: Page) =>
  page.getByRole("button", { name: "Allow read and write" }).click();

type Arguments = { readonly [key: string]: string | number };

/**
 * A user of the test's own, the made-up data seeded, and their MCP client connected as `access`
 * allows; the calls a test makes, and what the core reads of their PEA.
 */
async function investor(
  setup: {
    readonly app: WorkerEnvironment;
    readonly user: TestUser;
    readonly page: Page;
    readonly mcpClientId: string;
  },
  local: string,
  access: "read" | "write",
) {
  const person = await addUser(setup.app.baseURL, setup.user, personOfItsOwn(local));
  const owner = await data.ownerOf(person.email);

  await data.seed(owner);
  await setup.page.context().addCookies([...person.cookies]);

  const session = await connectMcp({
    baseURL: setup.app.baseURL,
    page: setup.page,
    consent: access === "write" ? allowReadAndWrite : allowReadOnly,
    scope: "read write",
    clientId: setup.mcpClientId,
  });

  const call = async (args: Arguments) => {
    const result = await session.client.callTool({ name: "investments", arguments: args });
    const [answer] = result.content ?? [];

    return { text: answer?.type === "text" ? answer.text : "", isError: result.isError === true };
  };

  /** The PEA as the core reads it: its id, its cash, its open positions. */
  const pea = async () => {
    const accounts = await run(investmentAccounts(owner));
    const found = accounts.find((each) => each.name === "Northbank PEA");

    if (found === undefined) {
      throw new Error("The made-up data has no Northbank PEA.");
    }

    return found;
  };

  const operations = async () =>
    (await run(investmentOperations(owner, (await pea()).id, { limit: 500 }))).operations;

  return { call, pea, operations };
}

/** `1,234.56 EUR`, as results write euros. */
const euros = (minor: number) =>
  `${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;

/** A position's row in `list`, from what the core reads of it. */
function positionRow(position: PositionRead): string {
  const average =
    position.averageCost === null
      ? ""
      : `, average cost ${position.averageCost.value} ${position.averageCost.currency}`;

  return `- ${position.security.name} (${position.security.isin ?? ""}): ${position.quantity} units${average}, cost ${euros(position.cost.minor)}`;
}

/** The handle the operation row of a write's answer gives. */
const handleOf = (text: string) => /; operation: (\S+)$/m.exec(text)?.[1] ?? "";

test("list shows the made-up PEA's positions at cost", async ({ app, user, page, mcpClientId }) => {
  const { call, pea } = await investor(
    { app, user, page, mcpClientId },
    "investments-list",
    "read",
  );

  const held = await pea();

  expect(held.positions.map((each) => each.security.isin)).toContain(WORLD);

  const { text, isError } = await call({ action: "list" });

  expect(isError, text).toBe(false);
  expect(text).toContain("at cost: what was paid, fees included");
  expect(text).toContain("no value, gain or return");
  expect(text).toContain(`${PEA}, PEA in EUR: cash ${euros(held.cash.minor)}.`);

  for (const position of held.positions) {
    expect(text).toContain(positionRow(position));
  }

  expect(text).toContain(
    'Its operations: investments {"action":"show","account":"Northbank PEA","institution":"Northbank"}',
  );
  // The made-up data's other accounts hold no investment.
  expect(text).not.toContain("Current account");
});

test("show an account's operations and a position by ISIN", async ({
  app,
  user,
  page,
  mcpClientId,
}) => {
  const { call, operations } = await investor(
    { app, user, page, mcpClientId },
    "investments-show",
    "read",
  );

  const all = await operations();

  const listed = await call({ action: "show", account: "northbank pea", limit: 5 });

  expect(listed.isError, listed.text).toBe(false);
  expect(listed.text).toContain(`Operations of ${PEA}, newest first: 5 of ${all.length}.`);
  expect([...listed.text.matchAll(/; operation: (\S+)$/gm)].map(([, id]) => id)).toEqual(
    all.slice(0, 5).map((each) => each.id),
  );
  expect(listed.text).toContain(
    'More operations remain. Read them with: investments {"action":"show","account":"Northbank PEA","institution":"Northbank","limit":5,"after":"',
  );

  const position = await call({ action: "show", isin: WORLD.toLowerCase() });

  expect(position.isError, position.text).toBe(false);
  expect(position.text).toContain(
    `World Index ETF (${WORLD}) on ${PEA}, quoted in EUR.\nAt cost: `,
  );
  expect(position.text).toContain("Its operations there, newest first:");
  expect(position.text).toMatch(/\n- \d{4}-\d\d-\d\d, purchase of [\d.]+ World Index ETF/);
});

test("a purchase added, corrected and deleted", async ({ app, user, page, mcpClientId }) => {
  const { call, pea, operations } = await investor(
    { app, user, page, mcpClientId },
    "investments-write",
    "write",
  );

  const before = await pea();

  const added = await call({
    action: "add_operation",
    account: "Northbank PEA",
    kind: "purchase",
    day: "2026-11-02",
    isin: WORLD,
    quantity: "1.5",
    unit_price: "113.20",
    fees: "0.99",
    amount: "-170.79",
  });

  expect(added.isError, added.text).toBe(false);
  expect(added.text).toContain(`Added to ${PEA}:`);
  expect(added.text).toContain(
    `- 2026-11-02, purchase of 1.5 World Index ETF (${WORLD}) at 113.2 EUR, fees 0.99 EUR: -170.79 EUR, entered by hand; operation: `,
  );
  expect(added.text).toMatch(/\nWorld Index ETF now, at cost: [\d.]+ units, average cost /);

  const handle = handleOf(added.text);

  expect((await operations()).find((each) => each.id === handle)).toMatchObject({
    kind: "purchase",
    amount: { minor: -17_079, currency: "EUR" },
    quantity: "1.5",
    source: "manual",
  });

  const corrected = await call({
    action: "edit_operation",
    operation: handle,
    account: "Northbank PEA",
    kind: "purchase",
    day: "2026-11-03",
    isin: WORLD,
    quantity: "1.5",
    unit_price: "113.80",
    fees: "0.99",
    amount: "-171.69",
  });

  expect(corrected.isError, corrected.text).toBe(false);
  expect(corrected.text).toContain(`Corrected on ${PEA}:`);
  expect(corrected.text).toContain(
    `- 2026-11-03, purchase of 1.5 World Index ETF (${WORLD}) at 113.8 EUR, fees 0.99 EUR: -171.69 EUR, entered by hand; operation: ${handle}`,
  );
  expect((await operations()).find((each) => each.id === handle)).toMatchObject({
    bookedOn: "2026-11-03",
    amount: { minor: -17_169 },
  });

  const deleted = await call({ action: "delete_operation", operation: handle });

  expect(deleted.isError, deleted.text).toBe(false);
  expect(deleted.text).toContain(`Deleted, with its cash line, from ${PEA}:`);
  expect((await operations()).map((each) => each.id)).not.toContain(handle);

  // As it was before the purchase: its cash and its positions.
  expect(await pea()).toEqual(before);
});

test("a write refused to a read-only token", async ({ app, user, page, mcpClientId }) => {
  const { call, operations } = await investor(
    { app, user, page, mcpClientId },
    "investments-read",
    "read",
  );

  const before = await operations();

  const refused = await call({
    action: "add_operation",
    account: "Northbank PEA",
    kind: "deposit",
    day: "2026-11-02",
    amount: "250.00",
  });

  expect(refused.isError).toBe(true);
  expect(refused.text).toContain("this connection was allowed to read only");
  expect(refused.text).toContain("choose Read and write on Gousset's consent page");

  const handle = before[0]?.id ?? "";
  const deleted = await call({ action: "delete_operation", operation: handle });

  const edited = await call({
    action: "edit_operation",
    operation: handle,
    account: "Northbank PEA",
    kind: "fee",
    day: "2026-11-02",
    amount: "-1.00",
  });

  for (const again of [deleted, edited]) {
    expect(again.isError).toBe(true);
    expect(again.text).toContain("choose Read and write on Gousset's consent page");
  }

  expect(await operations()).toEqual(before);
});

test("an invalid ISIN refused with what to do", async ({ app, user, page, mcpClientId }) => {
  const { call, operations } = await investor(
    { app, user, page, mcpClientId },
    "investments-isin",
    "write",
  );

  const before = await operations();

  // The World Index ETF's ISIN with a typo in its last digit: its check digit fails.
  const refused = await call({
    action: "add_operation",
    account: "Northbank PEA",
    kind: "purchase",
    day: "2026-11-02",
    isin: "XX0000000003",
    quantity: "1.5",
    unit_price: "113.20",
    amount: "-169.80",
  });

  expect(refused.isError).toBe(true);
  expect(refused.text).toContain('"XX0000000003" is not an ISIN');
  expect(refused.text).toContain("check digit");
  expect(refused.text).toMatch(
    /\nA valid call: investments \{"action":"add_operation".*"isin":"XX0000000002".*\}$/,
  );
  expect(refused.text.length).toBeLessThan(2000);
  expect(await operations()).toEqual(before);
});
