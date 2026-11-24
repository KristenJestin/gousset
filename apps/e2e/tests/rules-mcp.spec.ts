import type { Page } from "@playwright/test";
import { account } from "@gousset/db/schema/ledger";
import { exampleStatement, writeStatement } from "@gousset/fixture";
import type { StatementLine } from "@gousset/fixture";
import { Schema } from "effect";

import type { WorkerEnvironment } from "../src/app-server";
import type { TestUser } from "../src/auth";
import { addUser, connectMcp, expect, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #25 through the MCP door: the `rules` tool, with `imports` and `lines`, called by the
// official MCP client over the real OAuth flow, against the built app, its job queue (imports, and
// a rule applied to the past) and a real Postgres. Each test has a user of its own, so that no other
// test's rules or lines meet its own. Every line is invented.

const ACCOUNT_NAME = "Everyday account";

const allowReadAndWrite = (page: Page) =>
  page.getByRole("button", { name: "Allow read and write" }).click();

type Arguments = { readonly [key: string]: Schema.Json };

const Written = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json));

/** What a test needs to make a user of its own and connect their MCP client. */
type Setup = {
  readonly app: WorkerEnvironment;
  readonly user: TestUser;
  readonly page: Page;
  readonly mcpClientId: string;
  readonly repeat: number;
};

/**
 * A user of the test's own, with one current account the example statement's IBAN names, and their
 * MCP client allowed to read and write; the calls a test makes through it.
 */
async function rulesUser(setup: Setup, first: string) {
  const slug = first.toLowerCase();

  const person = await addUser(setup.app.baseURL, setup.user, {
    name: `${first} Example`,
    email: `${slug}.rules.worker${setup.app.slot}.${setup.repeat}@example.com`,
    password: `e2e-${slug}-password-${setup.app.slot}`,
  });

  const data = openUserData(setup.app.database);

  try {
    const owner = await data.ownerOf(person.email);

    await data.asUser(owner, (transaction) =>
      transaction.insert(account).values({
        userId: owner,
        name: ACCOUNT_NAME,
        kind: "current",
        currency: "EUR",
        iban: exampleStatement.account.iban,
      }),
    );
  } finally {
    await data.close();
  }

  await setup.page.context().addCookies([...person.cookies]);

  const session = await connectMcp({
    baseURL: setup.app.baseURL,
    page: setup.page,
    consent: allowReadAndWrite,
    scope: "read write",
    clientId: setup.mcpClientId,
  });

  /** The text of a tool's answer, and whether it is an error. */
  const call = async (name: string, args: Arguments) => {
    const result = await session.client.callTool({ name, arguments: args });
    const [answer] = result.content ?? [];

    return { text: answer?.type === "text" ? answer.text : "", isError: result.isError === true };
  };

  /** Imports `lines` through `imports`, as an MCP client uploads a statement. */
  const upload = async (lines: ReadonlyArray<StatementLine>) => {
    const file = writeStatement("camt053", { ...exampleStatement, lines });

    const uploaded = await call("imports", {
      action: "upload",
      file_name: file.fileName,
      content: file.contents,
    });

    expect(uploaded.isError, uploaded.text).toBe(false);
    expect(uploaded.text).toContain(`${lines.length} lines read: ${lines.length} added`);
  };

  /** Each line's row in a search of every line: its handle and its category. */
  const rowOf = async (label: string) => {
    const found = await call("lines", { action: "search", limit: 100 });

    expect(found.isError, found.text).toBe(false);

    const row = found.text.split("\n").find((line) => line.includes(`"${label}"`)) ?? "";

    expect(row, label).not.toBe("");

    return {
      handle: /; line: (\S+)$/.exec(row)?.[1] ?? "",
      category: /, in (.+?)(?:, to review)?; line: \S+$/.exec(row)?.[1] ?? "",
    };
  };

  return { call, upload, rowOf };
}

/** The ids `list` gives, in order. */
const idsOf = (text: string) => [...text.matchAll(/ Id: (\S+)$/gm)].map(([, id]) => id ?? "");

/** The call a text writes after `lead`, read back. */
function callAfter(text: string, lead: string): Arguments {
  const at = text.indexOf(lead);

  expect(at, text).toBeGreaterThan(-1);

  return Schema.decodeUnknownSync(Written)(text.slice(at + lead.length).split("\n")[0] ?? "");
}

const line = (bookedOn: string, amountMinor: number, label: string, reference: string) => ({
  bookedOn,
  amountMinor,
  label,
  reference,
});

test("a rule applies to new lines", async ({ app, user, page, mcpClientId }, testInfo) => {
  // Two uploads waiting for the app's import job, then the calls.
  test.setTimeout(120_000);

  const { call, upload, rowOf } = await rulesUser(
    { app, user, page, mcpClientId, repeat: testInfo.repeatEachIndex },
    "Robin",
  );

  const first = "CB HARBOUR FUEL RIVERTON 0410";
  const later = "CB HARBOUR FUEL RIVERTON 1810";

  await upload([line("2026-10-04", -4210, first, "HF0410")]);

  // The user corrects the line; the answer proposes the rule that does it for the next ones.
  const corrected = await call("lines", {
    action: "classify",
    line: (await rowOf(first)).handle,
    category: "Transport > Fuel",
  });

  expect(corrected.isError, corrected.text).toBe(false);
  expect(corrected.text).toContain("is now in Transport > Fuel (expense).");

  const proposed = callAfter(corrected.text, "propose this rule to the user: rules ");

  expect(proposed).toMatchObject({
    action: "create",
    category: "Transport > Fuel",
    from_correction: true,
  });

  const created = await call("rules", proposed);

  expect(created.isError, created.text).toBe(false);
  expect(created.text).toContain("Created this rule");
  expect(created.text).toMatch(
    /\n1\. If label contains "[A-Z ]+", then category Transport > Fuel\. On\. Classified 0 lines\. Id: \S+\n/,
  );
  expect(created.text).toContain(
    'To apply it to the lines already there: rules {"action":"apply_to_past"',
  );

  // A line imported now meets the rule, and is classified by it.
  await upload([line("2026-10-18", -3800, later, "HF1810")]);

  expect((await rowOf(later)).category).toBe("Transport > Fuel");

  const listed = await call("rules", { action: "list" });

  expect(listed.isError, listed.text).toBe(false);
  expect(listed.text).toContain("1 rule(s), in the order they are tried");
  expect(listed.text).toContain("then category Transport > Fuel. On. Classified 1 line.");
});

test("a manual correction survives a rule run", async ({
  app,
  user,
  page,
  mcpClientId,
}, testInfo) => {
  test.setTimeout(120_000);

  const { call, upload, rowOf } = await rulesUser(
    { app, user, page, mcpClientId, repeat: testInfo.repeatEachIndex },
    "Sasha",
  );

  const kept = "PRLV SEPA BRIGHTWAVE ENERGY REF 0610";
  const other = "PRLV SEPA BRIGHTWAVE ENERGY REF 2010";

  await upload([
    line("2026-10-06", -6140, kept, "BW0610"),
    line("2026-10-20", -5875, other, "BW2010"),
  ]);

  // The user puts one line, by hand, somewhere the rule will not.
  const corrected = await call("lines", {
    action: "classify",
    line: (await rowOf(kept)).handle,
    category: "Housing > Repairs",
  });

  expect(corrected.isError, corrected.text).toBe(false);

  const created = await call("rules", {
    action: "create",
    conditions: [{ field: "label", operator: "contains", value: "brightwave energy" }],
    category: "Housing > Energy",
  });

  expect(created.isError, created.text).toBe(false);
  expect(created.text).toContain(
    "It applies to 2 lines already there; 1 would change; 1 were classified otherwise by hand, which apply_to_past leaves alone unless include_by_hand is true.",
  );

  const [rule = ""] = idsOf(created.text);
  const applied = await call("rules", { action: "apply_to_past", rule });

  expect(applied.isError, applied.text).toBe(false);
  expect(applied.text).toContain(
    "Applied rule 1 to the lines already there: 1 line changed, each now classified by the rule. 1 line the user classified otherwise by hand was left alone;",
  );
  expect(applied.text).toContain(
    `to change them too: rules {"action":"apply_to_past","rule":"${rule}","include_by_hand":true}`,
  );

  expect((await rowOf(kept)).category).toBe("Housing > Repairs");
  expect((await rowOf(other)).category).toBe("Housing > Energy");

  // Nothing is left for it to change but the user's own choice.
  const shown = await call("rules", { action: "show", rule });

  expect(shown.text).toContain(
    "It applies to 2 lines already there; 0 would change; 1 were classified otherwise by hand",
  );
});

test("applying to the past changes exactly the lines that match", async ({
  app,
  user,
  page,
  mcpClientId,
}, testInfo) => {
  test.setTimeout(150_000);

  const { call, upload, rowOf } = await rulesUser(
    { app, user, page, mcpClientId, repeat: testInfo.repeatEachIndex },
    "Morgan",
  );

  const matching = ["CB GREENLEAF GROCER 0210", "CB GREENLEAF GROCER 0910"];
  const tooDear = "CB GREENLEAF GROCER 1610";
  const moneyIn = "VIR GREENLEAF GROCER REMBOURSEMENT";
  const otherShop = "CB CORNER BAKERY 1110";
  const byHand = "CB GREENLEAF GROCER 2310";

  await upload([
    line("2026-10-02", -1500, matching[0] ?? "", "GL0210"),
    line("2026-10-09", -1250, matching[1] ?? "", "GL0910"),
    line("2026-10-16", -4500, tooDear, "GL1610"),
    line("2026-10-17", 1500, moneyIn, "GL1710"),
    line("2026-10-11", -1400, otherShop, "CB1110"),
    line("2026-10-23", -1800, byHand, "GL2310"),
  ]);

  const corrected = await call("lines", {
    action: "classify",
    line: (await rowOf(byHand)).handle,
    category: "Eating out > Takeaway",
  });

  expect(corrected.isError, corrected.text).toBe(false);

  const before = await Promise.all(
    [tooDear, moneyIn, otherShop].map(async (label) => (await rowOf(label)).category),
  );

  const created = await call("rules", {
    action: "create",
    conditions: [
      { field: "label", operator: "contains", value: "GREENLEAF" },
      { field: "direction", operator: "eq", value: "out" },
      { field: "amount", operator: "between", value: [10, 20] },
      { field: "account", operator: "eq", value: "everyday account" },
    ],
    category: "Groceries > Market",
  });

  expect(created.isError, created.text).toBe(false);
  expect(created.text).toContain(
    `1. If label contains "GREENLEAF" and money leaves the account and amount is between 10 and 20 and account is ${ACCOUNT_NAME}, then category Groceries > Market. On. Classified 0 lines.`,
  );
  expect(created.text).toContain(
    "It applies to 3 lines already there; 2 would change; 1 were classified otherwise by hand",
  );

  const [rule = ""] = idsOf(created.text);
  const applied = await call("rules", { action: "apply_to_past", rule });

  expect(applied.isError, applied.text).toBe(false);
  expect(applied.text).toContain(
    "Applied rule 1 to the lines already there: 2 lines changed, each now classified by the rule. 1 line the user classified otherwise by hand was left alone;",
  );

  // Exactly the lines that match: the two, not the dearer one, the money in, the other shop, nor
  // the one the user classified by hand.
  for (const label of matching) {
    expect((await rowOf(label)).category, label).toBe("Groceries > Market");
  }

  const after = await Promise.all(
    [tooDear, moneyIn, otherShop].map(async (label) => (await rowOf(label)).category),
  );

  expect(after).toEqual(before);
  expect(after).not.toContain("Groceries > Market");
  expect((await rowOf(byHand)).category).toBe("Eating out > Takeaway");

  // Asked to, it changes the user's own choice too, and only that.
  const again = await call("rules", { action: "apply_to_past", rule, include_by_hand: true });

  expect(again.isError, again.text).toBe(false);
  expect(again.text).toContain(
    "1 line changed, each now classified by the rule. Among them, 1 line the user had classified otherwise by hand.",
  );
  expect((await rowOf(byHand)).category).toBe("Groceries > Market");

  const listed = await call("rules", { action: "list" });

  expect(listed.text).toContain("Classified 3 lines.");
});

test("an MCP client lists, shows, edits, moves and turns off rules, and is told what to do when refused", async ({
  app,
  user,
  page,
  mcpClientId,
}, testInfo) => {
  test.setTimeout(120_000);

  const { call, upload } = await rulesUser(
    { app, user, page, mcpClientId, repeat: testInfo.repeatEachIndex },
    "Alex",
  );

  await upload([
    line("2026-10-05", -1100, "CB SILVERLINE CINEMA 0510", "SC0510"),
    line("2026-10-07", -2490, "CB NORTHWIND BOOKS 0710", "NB0710"),
  ]);

  const empty = await call("rules", { action: "list" });

  expect(empty.text).toContain("The user has no rule yet.");

  for (const [text, category] of [
    ["SILVERLINE", "Leisure > Culture"],
    ["NORTHWIND", "Leisure > Hobbies"],
  ] as const) {
    const created = await call("rules", {
      action: "create",
      conditions: [{ field: "label", operator: "contains", value: text }],
      category,
    });

    expect(created.isError, created.text).toBe(false);
  }

  const listed = await call("rules", { action: "list" });
  const [cinema = "", books = ""] = idsOf(listed.text);

  expect(listed.text).toContain(
    `1. If label contains "SILVERLINE", then category Leisure > Culture. On. Classified 0 lines. Id: ${cinema}`,
  );
  expect(listed.text).toContain(
    `2. If label contains "NORTHWIND", then category Leisure > Hobbies. On. Classified 0 lines. Id: ${books}`,
  );

  const shown = await call("rules", { action: "show", rule: books });

  expect(shown.isError, shown.text).toBe(false);
  expect(shown.text).toContain(
    "It applies to 1 line already there; 1 would change; 0 were classified otherwise by hand",
  );

  // Its conditions replaced, its merchant set by name, and moved first.
  const merchants = await call("merchants", { action: "search", text: "northwind" });
  const [, merchant = ""] = /^- (.+): \d+ cleaned labels?$/m.exec(merchants.text) ?? [];

  expect(merchant).not.toBe("");

  const edited = await call("rules", {
    action: "edit",
    rule: books,
    conditions: [
      { field: "label", operator: "contains", value: "NORTHWIND" },
      { field: "amount", operator: "gte", value: 20 },
    ],
    merchant,
    place: 1,
  });

  expect(edited.isError, edited.text).toBe(false);
  expect(edited.text).toContain(
    `1. If label contains "NORTHWIND" and amount is at least 20, then merchant ${merchant}, category Leisure > Hobbies. On.`,
  );

  expect(idsOf((await call("rules", { action: "list" })).text)).toEqual([books, cinema]);

  const disabled = await call("rules", { action: "disable", rule: cinema });

  expect(disabled.isError, disabled.text).toBe(false);
  expect(disabled.text).toContain(
    'Turned off: 2. If label contains "SILVERLINE", then category Leisure > Culture. Off.',
  );
  expect((await call("rules", { action: "list" })).text).toContain(
    'If label contains "SILVERLINE", then category Leisure > Culture. Off.',
  );

  const enabled = await call("rules", { action: "edit", rule: cinema, enabled: true });

  expect(enabled.text).toContain(
    'If label contains "SILVERLINE", then category Leisure > Culture. On.',
  );

  // Refused, each with what to do and a valid call.
  const unknownCategory = await call("rules", {
    action: "create",
    conditions: [{ field: "label", operator: "contains", value: "SILVERLINE" }],
    category: "Cinema nights",
  });

  expect(unknownCategory.isError).toBe(true);
  expect(unknownCategory.text).toContain('No category of the user\'s is named "Cinema nights".');
  expect(unknownCategory.text).toContain('A valid call: categories {"action":"list"}');

  const nothingSet = await call("rules", { action: "edit", rule: cinema, category: null });

  expect(nothingSet.isError).toBe(true);
  expect(nothingSet.text).toContain("A rule sets a merchant, a category, or both");
  expect(nothingSet.text).toContain('A valid call: rules {"action":"edit"');

  const unknownRule = await call("rules", { action: "show", rule: "not-a-rule" });

  expect(unknownRule.isError).toBe(true);
  expect(unknownRule.text).toContain('No rule of the user\'s has the id "not-a-rule".');
  expect(unknownRule.text).toContain('A valid call: rules {"action":"list"}');

  // Deleted: gone from the list, the other one stays.
  const deleted = await call("rules", { action: "delete", rule: cinema });

  expect(deleted.isError, deleted.text).toBe(false);
  expect(deleted.text).toContain('Deleted: 2. If label contains "SILVERLINE"');
  expect(idsOf((await call("rules", { action: "list" })).text)).toEqual([books]);
});
