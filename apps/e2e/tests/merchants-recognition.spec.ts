import { recogniseMerchants } from "@gousset/core";
import { account, merchant, merchantAlias, statementLine } from "@gousset/db/schema/ledger";
import { count } from "drizzle-orm";
import { Effect } from "effect";

import { addUser } from "../src/auth";
import { expect, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #24, recognising merchants on a real Postgres: one recognition that makes more merchants
// than one insert can carry. A statement holds at most 65,535 parameters, two per merchant and
// three per cleaned label: 33,000 new ones in one go pass both limits, so recognition must write
// them a part at a time.

/** How many distinct invented stalls the user paid: past 32,767, the limit of one insert. */
const STALLS = 33_000;

/** Lines one insert of the test writes: six parameters each. */
const LINES_AT_ONCE = 1000;

// Letters only, no X (which reads as a masked card number): STALLAAAA, STALLAAAB…
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWYZ";

function stall(index: number): string {
  const code = Array.from(
    { length: 4 },
    (_digit, place) =>
      LETTERS[Math.floor(index / LETTERS.length ** (3 - place)) % LETTERS.length] ?? "A",
  ).join("");

  return `STALL${code}`;
}

test("one recognition makes more merchants than one insert holds", async ({ app, user }) => {
  test.setTimeout(180_000);

  const person = await addUser(app.baseURL, user, {
    name: "Rowan Example",
    email: `rowan.stalls.worker${app.slot}@example.com`,
    password: `e2e-rowan-password-${app.slot}`,
  });

  const data = openUserData(app.database);

  try {
    const owner = await data.ownerOf(person.email);

    const [market] = await data.asUser(owner, (transaction) =>
      transaction
        .insert(account)
        .values({ userId: owner, name: "Market stalls", kind: "current", currency: "EUR" })
        .returning({ id: account.id }),
    );

    expect(market).toBeDefined();

    for (let start = 0; start < STALLS; start += LINES_AT_ONCE) {
      const lines = Array.from(
        { length: Math.min(LINES_AT_ONCE, STALLS - start) },
        (_line, at) => ({
          userId: owner,
          accountId: market?.id ?? "",
          source: "manual" as const,
          bookedOn: "2026-10-15",
          amountMinor: -250,
          // A French card label: the date and the town after the stall's name are cleaned away.
          label: `CB ${stall(start + at)} 1510 RIVERTON`,
        }),
      );

      await data.asUser(owner, (transaction) => transaction.insert(statementLine).values(lines));
    }

    const recognised = await Effect.runPromise(
      recogniseMerchants(owner).pipe(Effect.provide(data.layer)),
    );

    expect(recognised).toEqual({ merchants: STALLS, aliases: STALLS });

    const [merchants] = await data.asUser(owner, (transaction) =>
      transaction.select({ rows: count() }).from(merchant),
    );

    const [aliases] = await data.asUser(owner, (transaction) =>
      transaction.select({ rows: count() }).from(merchantAlias),
    );

    expect(merchants?.rows).toBe(STALLS);
    expect(aliases?.rows).toBe(STALLS);

    // Run again, it finds every line named already.
    expect(
      await Effect.runPromise(recogniseMerchants(owner).pipe(Effect.provide(data.layer))),
    ).toEqual({ merchants: 0, aliases: 0 });
  } finally {
    await data.close();
  }
});
