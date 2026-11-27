import type { Client } from "@modelcontextprotocol/client";
import type { Page } from "@playwright/test";
import { account } from "@gousset/db/schema/ledger";
import { exampleStatement, writeStatement } from "@gousset/fixture";
import type { Statement } from "@gousset/fixture";

import { addUser } from "../src/auth";
import { connectMcp, expect, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #24 through the MCP door: the `merchants` tool, called by the official MCP client over the
// real OAuth flow, on lines the `imports` tool brought in, against the built app, its job queue
// and a real Postgres. The user is the test's own, so that no other test's merchants meet these;
// counts are still read from the results.

const allowReadAndWrite = (page: Page) =>
  page.getByRole("button", { name: "Allow read and write" }).click();

type Arguments = { readonly [key: string]: string | boolean | ReadonlyArray<string> };

/** The text of a tool's answer, and whether it is an error. */
async function callText(client: Client, name: string, args: Arguments) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}

const ACCOUNT_NAME = "Everyday account";

/** An invented shop under three raw labels: a card payment in town, another, a direct debit. */
const LABELS = [
  "CB VERDANT PANTRY 0412 RIVERTON",
  "CB VERDANT PANTRY RIVERTON 1510",
  "PRLV SEPA VERDANT PANTRY ONLINE",
] as const;

const statement: Statement = {
  ...exampleStatement,
  lines: [
    { bookedOn: "2026-10-04", amountMinor: -2318, label: LABELS[0], reference: "VP2026100401" },
    { bookedOn: "2026-10-15", amountMinor: -4105, label: LABELS[1], reference: "VP2026101501" },
    { bookedOn: "2026-10-20", amountMinor: -999, label: LABELS[2], reference: "VP2026102001" },
  ],
};

/** The merchants a list or search page gives, by name. */
const namesOf = (text: string) =>
  [...text.matchAll(/^- (.+): \d+ cleaned labels?$/gm)].map(([, name]) => name ?? "");

/** The cleaned labels a merchant's page lists, in its second paragraph. */
function aliasesOf(text: string): Array<string> {
  const [, section = ""] = text.split("\n\n");

  return section
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2));
}

test("the same shop under several labels becomes one merchant, which an MCP client renames, splits and merges", async ({
  app,
  user,
  page,
  baseURL,
  mcpClientId,
}, testInfo) => {
  // One upload waiting for the app's import job, then the calls.
  test.setTimeout(90_000);

  const shopper = await addUser(app.baseURL, user, {
    name: "Sam Example",
    email: `sam.merchants.worker${app.slot}.${testInfo.repeatEachIndex}@example.com`,
    password: `e2e-sam-password-${app.slot}`,
  });

  const data = openUserData(app.database);

  try {
    const owner = await data.ownerOf(shopper.email);

    await data.asUser(owner, (transaction) =>
      transaction.insert(account).values({
        userId: owner,
        name: ACCOUNT_NAME,
        kind: "current",
        currency: "EUR",
        iban: statement.account.iban,
      }),
    );
  } finally {
    await data.close();
  }

  await page.context().addCookies([...shopper.cookies]);

  const session = await connectMcp({
    baseURL: baseURL ?? "",
    page,
    consent: allowReadAndWrite,
    scope: "read write",
    clientId: mcpClientId,
  });

  const merchants = (args: Arguments) => callText(session.client, "merchants", args);

  expect(session.client.getInstructions()).toContain("`merchants`");

  const file = writeStatement("camt053", statement);

  const uploaded = await callText(session.client, "imports", {
    action: "upload",
    file_name: file.fileName,
    content: file.contents,
  });

  expect(uploaded.isError, uploaded.text).toBe(false);
  expect(uploaded.text).toContain(`Imported ${file.fileName} into ${ACCOUNT_NAME}`);
  expect(uploaded.text).toContain("3 lines read: 3 added");

  // The three labels make one merchant, recognised by the import.
  const found = await merchants({ action: "search", text: "verdant" });

  expect(found.isError, found.text).toBe(false);
  expect(found.text).toContain('1 merchant(s) whose name or a cleaned label contains "verdant".');

  const [recognised = ""] = namesOf(found.text);

  expect(recognised).toMatch(/verdant pantry/i);

  const shown = await merchants({ action: "show", merchant: recognised });

  expect(shown.isError, shown.text).toBe(false);
  expect(shown.text).toContain(`Merchant: ${recognised}.`);

  const aliases = aliasesOf(shown.text);

  expect(aliases.length).toBeGreaterThanOrEqual(2);

  for (const alias of aliases) {
    expect(alias).toContain("VERDANT PANTRY");
  }

  for (const label of LABELS) {
    expect(shown.text).toContain(`, ${ACCOUNT_NAME}: `);
    expect(shown.text).toContain(`"${label}"`);
  }

  // Renamed.
  const renamed = await merchants({
    action: "edit",
    merchant: recognised,
    name: "Verdant Pantry Market",
  });

  expect(renamed.isError, renamed.text).toBe(false);
  expect(renamed.text).toContain('to "Verdant Pantry Market"');

  const afterRename = await merchants({ action: "search", text: "verdant" });

  expect(namesOf(afterRename.text)).toEqual(["Verdant Pantry Market"]);

  // Split: the longest cleaned label moves to a merchant made for it.
  const moved = aliases.toSorted((a, b) => b.length - a.length)[0] ?? "";

  const split = await merchants({
    action: "edit",
    merchant: "Verdant Pantry Market",
    alias: moved,
    to: "Verdant Pantry Online",
  });

  expect(split.isError, split.text).toBe(false);
  expect(split.text).toContain(
    `Moved the cleaned label "${moved}", and its lines, from Verdant Pantry Market to Verdant Pantry Online, a merchant made for it`,
  );

  const afterSplit = await merchants({ action: "search", text: "verdant" });

  expect(namesOf(afterSplit.text)).toEqual(["Verdant Pantry Market", "Verdant Pantry Online"]);

  const online = await merchants({ action: "show", merchant: "Verdant Pantry Online" });

  expect(aliasesOf(online.text)).toEqual([moved]);

  const kept = await merchants({ action: "show", merchant: "Verdant Pantry Market" });

  expect(aliasesOf(kept.text)).toEqual(aliases.filter((alias) => alias !== moved));

  // Merged back: one merchant again, with every cleaned label.
  const merged = await merchants({
    action: "merge",
    merchant: "Verdant Pantry Online",
    into: "Verdant Pantry Market",
  });

  expect(merged.isError, merged.text).toBe(false);
  expect(merged.text).toContain(
    "Merged Verdant Pantry Online into Verdant Pantry Market: 1 cleaned label moved, and Verdant Pantry Online deleted.",
  );

  const afterMerge = await merchants({ action: "search", text: "verdant" });

  expect(namesOf(afterMerge.text)).toEqual(["Verdant Pantry Market"]);

  const whole = await merchants({ action: "show", merchant: "verdant pantry market" });

  expect(aliasesOf(whole.text)).toEqual(aliases);

  // A merge into itself is refused with a call that answers.
  const itself = await merchants({
    action: "merge",
    merchant: "Verdant Pantry Market",
    into: "verdant pantry market",
  });

  expect(itself.isError).toBe(true);
  expect(itself.text).toContain("never into itself");
  expect(itself.text).toContain('A valid call: merchants {"action":"search"');

  // Its default category (#23): a category of the user's own, set, shown, kept archived, cleared.
  const created = await callText(session.client, "categories", {
    action: "create",
    name: "Pantry runs",
  });

  expect(created.isError, created.text).toBe(false);

  const set = await merchants({
    action: "edit",
    merchant: "Verdant Pantry Market",
    category: "pantry runs",
  });

  expect(set.isError, set.text).toBe(false);
  expect(set.text).toBe(
    "Verdant Pantry Market's default category is now Pantry runs (expense): the category its entries go in by default.",
  );

  const withDefault = await merchants({ action: "show", merchant: "Verdant Pantry Market" });

  expect(withDefault.text).toContain("Default category: Pantry runs (expense).");

  const unknown = await merchants({
    action: "edit",
    merchant: "Verdant Pantry Market",
    category: "Pantry trips",
  });

  expect(unknown.isError).toBe(true);
  expect(unknown.text).toContain('No category of the user\'s is named "Pantry trips".');

  const archived = await callText(session.client, "categories", {
    action: "archive",
    category: "Pantry runs",
  });

  expect(archived.isError, archived.text).toBe(false);

  const keptArchived = await merchants({ action: "show", merchant: "Verdant Pantry Market" });

  expect(keptArchived.text).toContain("Default category: Pantry runs (expense), archived");

  const cleared = await merchants({
    action: "edit",
    merchant: "Verdant Pantry Market",
    clear_category: true,
  });

  expect(cleared.text).toBe("Verdant Pantry Market has no default category any more.");
});

/** An invented bakery, under one label, on three days: two lines first, a third imported later. */
const EMBERWOOD = [
  {
    bookedOn: "2026-10-05",
    amountMinor: -480,
    label: "CB EMBERWOOD BAKERY 0510",
    reference: "EB05",
  },
  {
    bookedOn: "2026-10-12",
    amountMinor: -615,
    label: "CB EMBERWOOD BAKERY 1210",
    reference: "EB12",
  },
  {
    bookedOn: "2026-10-19",
    amountMinor: -390,
    label: "CB EMBERWOOD BAKERY 1910",
    reference: "EB19",
  },
] as const;

/** The row of a search that holds `label`: the line's text, and its handle. */
function rowOf(text: string, label: string) {
  const row = text.split("\n").find((line) => line.includes(`"${label}"`)) ?? "";

  return { row, handle: /; line: (\S+)$/.exec(row)?.[1] ?? "" };
}

test("a merchant's default category classifies its lines' entries, still to review; the user's choice stays", async ({
  app,
  user,
  page,
  baseURL,
  mcpClientId,
}, testInfo) => {
  // Two uploads waiting for the app's import job, then the calls.
  test.setTimeout(120_000);

  const baker = await addUser(app.baseURL, user, {
    name: "Bea Example",
    email: `bea.merchants.worker${app.slot}.${testInfo.repeatEachIndex}@example.com`,
    password: `e2e-bea-password-${app.slot}`,
  });

  const data = openUserData(app.database);

  try {
    const owner = await data.ownerOf(baker.email);

    await data.asUser(owner, (transaction) =>
      transaction.insert(account).values({
        userId: owner,
        name: ACCOUNT_NAME,
        kind: "current",
        currency: "EUR",
        iban: statement.account.iban,
      }),
    );
  } finally {
    await data.close();
  }

  await page.context().addCookies([...baker.cookies]);

  const session = await connectMcp({
    baseURL: baseURL ?? "",
    page,
    consent: allowReadAndWrite,
    scope: "read write",
    clientId: mcpClientId,
  });

  const call = (name: string, args: Arguments) => callText(session.client, name, args);

  const upload = async (lines: ReadonlyArray<(typeof EMBERWOOD)[number]>) => {
    const file = writeStatement("camt053", { ...exampleStatement, lines: [...lines] });

    const uploaded = await call("imports", {
      action: "upload",
      file_name: file.fileName,
      content: file.contents,
    });

    expect(uploaded.isError, uploaded.text).toBe(false);
  };

  const search = async () => (await call("lines", { action: "search", text: "emberwood" })).text;

  /** The lines to review: a plain search marks none, the to_review search marks each. */
  const toReview = async () =>
    (await call("lines", { action: "search", text: "emberwood", to_review: true })).text;

  await upload(EMBERWOOD.slice(0, 2));

  // The user puts the second line in a category of their own choosing.
  const chosen = rowOf(await search(), EMBERWOOD[1].label);

  const classified = await call("lines", {
    action: "classify",
    line: chosen.handle,
    category: "Groceries > Supermarket",
  });

  expect(classified.isError, classified.text).toBe(false);

  const [bakery = ""] = namesOf(
    (await call("merchants", { action: "search", text: "emberwood" })).text,
  );

  const set = await call("merchants", {
    action: "edit",
    merchant: bakery,
    category: "Groceries > Bakery",
  });

  expect(set.isError, set.text).toBe(false);

  // The line not classified yet goes in the default, and is still to review; the other stays.
  const afterSet = await search();

  expect(rowOf(afterSet, EMBERWOOD[0].label).row).toContain("in Groceries > Bakery;");
  expect(rowOf(afterSet, EMBERWOOD[1].label).row).toContain("in Groceries > Supermarket;");

  const reviewAfterSet = await toReview();

  expect(rowOf(reviewAfterSet, EMBERWOOD[0].label).row).toContain(
    "in Groceries > Bakery, to review;",
  );
  expect(rowOf(reviewAfterSet, EMBERWOOD[1].label).row).toBe("");

  // A line of the merchant imported afterwards goes in its default category at once.
  await upload(EMBERWOOD.slice(2));

  const afterImport = await search();

  expect(rowOf(afterImport, EMBERWOOD[2].label).row).toContain("in Groceries > Bakery;");
  expect(rowOf(await toReview(), EMBERWOOD[2].label).row).toContain(
    "in Groceries > Bakery, to review;",
  );
  expect(rowOf(afterImport, EMBERWOOD[1].label).row).toContain("in Groceries > Supermarket;");
});

/** Four invented shops: a bakery and a tea room on two days each, a café and a deli once. */
const SHOPS = {
  lantern: ["CB LANTERN BAKERY 0310", "CB LANTERN BAKERY 1010"],
  kettle: ["CB COPPER KETTLE 0410", "CB COPPER KETTLE 1210"],
  tinder: ["CB TINDER CAFE 0610"],
  mossgate: ["CB MOSSGATE DELI 0710"],
} as const;

const SHOP_LINES = [
  { bookedOn: "2026-10-03", amountMinor: -350, label: SHOPS.lantern[0], reference: "LB03" },
  { bookedOn: "2026-10-10", amountMinor: -425, label: SHOPS.lantern[1], reference: "LB10" },
  { bookedOn: "2026-10-04", amountMinor: -780, label: SHOPS.kettle[0], reference: "CK04" },
  { bookedOn: "2026-10-12", amountMinor: -640, label: SHOPS.kettle[1], reference: "CK12" },
  { bookedOn: "2026-10-06", amountMinor: -290, label: SHOPS.tinder[0], reference: "TC06" },
  { bookedOn: "2026-10-07", amountMinor: -1260, label: SHOPS.mossgate[0], reference: "MD07" },
];

test("merging merchants and moving a label keep their entries in the right default category; the user's choice stays", async ({
  app,
  user,
  page,
  baseURL,
  mcpClientId,
}, testInfo) => {
  // One upload waiting for the app's import job, then the calls.
  test.setTimeout(120_000);

  const shopper = await addUser(app.baseURL, user, {
    name: "Lea Example",
    email: `lea.merchants.worker${app.slot}.${testInfo.repeatEachIndex}@example.com`,
    password: `e2e-lea-password-${app.slot}`,
  });

  const data = openUserData(app.database);

  try {
    const owner = await data.ownerOf(shopper.email);

    await data.asUser(owner, (transaction) =>
      transaction.insert(account).values({
        userId: owner,
        name: ACCOUNT_NAME,
        kind: "current",
        currency: "EUR",
        iban: statement.account.iban,
      }),
    );
  } finally {
    await data.close();
  }

  await page.context().addCookies([...shopper.cookies]);

  const session = await connectMcp({
    baseURL: baseURL ?? "",
    page,
    consent: allowReadAndWrite,
    scope: "read write",
    clientId: mcpClientId,
  });

  const call = (name: string, args: Arguments) => callText(session.client, name, args);

  const file = writeStatement("camt053", { ...exampleStatement, lines: SHOP_LINES });

  const uploaded = await call("imports", {
    action: "upload",
    file_name: file.fileName,
    content: file.contents,
  });

  expect(uploaded.isError, uploaded.text).toBe(false);

  const merchantOf = async (text: string) => {
    const [name = ""] = namesOf((await call("merchants", { action: "search", text })).text);

    expect(name).not.toBe("");

    return name;
  };

  const lantern = await merchantOf("lantern");
  const kettle = await merchantOf("kettle");
  const tinder = await merchantOf("tinder");
  const mossgate = await merchantOf("mossgate");

  /** A merchants call that answers, never refused (an edit, a merge, a show): its text. */
  const edited = async (args: Arguments) => {
    const answer = await call("merchants", args);

    expect(answer.isError, answer.text).toBe(false);

    return answer.text;
  };

  /** The category each shop line is in, as the lines' search writes it. */
  const rows = async () => {
    const text = (await call("lines", { action: "search", text: "CB " })).text;

    return (label: string) => rowOf(text, label).row;
  };

  // The user puts the tea room's second line in a category of their own choosing.
  const chosen = rowOf(
    (await call("lines", { action: "search", text: "copper kettle" })).text,
    SHOPS.kettle[1],
  );

  const classified = await call("lines", {
    action: "classify",
    line: chosen.handle,
    category: "Groceries > Supermarket",
  });

  expect(classified.isError, classified.text).toBe(false);

  await edited({ action: "edit", merchant: kettle, category: "Groceries > Bakery" });

  // Merged into a merchant without a default: the kept one takes the merged one's, and its own
  // entries go in it too.
  await edited({ action: "merge", merchant: kettle, into: lantern });

  expect(await edited({ action: "show", merchant: lantern })).toContain(
    "Default category: Groceries > Bakery (expense).",
  );

  const afterFirst = await rows();

  for (const label of [...SHOPS.lantern, SHOPS.kettle[0]]) {
    expect(afterFirst(label)).toContain("in Groceries > Bakery;");
  }

  expect(afterFirst(SHOPS.kettle[1])).toContain("in Groceries > Supermarket;");

  // Merged into a merchant with its own default: the kept one keeps it, and the merged one's
  // entries still classified by default follow it.
  await edited({ action: "edit", merchant: tinder, category: "Eating out > Cafés and bars" });
  await edited({ action: "merge", merchant: lantern, into: tinder });

  const kept = await edited({ action: "show", merchant: tinder });

  expect(kept).toContain("Default category: Eating out > Cafés and bars (expense).");

  const afterSecond = await rows();

  for (const label of [...SHOPS.lantern, SHOPS.kettle[0], ...SHOPS.tinder]) {
    expect(afterSecond(label)).toContain("in Eating out > Cafés and bars;");
  }

  expect(afterSecond(SHOPS.kettle[1])).toContain("in Groceries > Supermarket;");

  // The tea room's cleaned labels moved to the deli: their entries follow the deli's default.
  await edited({ action: "edit", merchant: mossgate, category: "Groceries > Market" });

  const kettleLabels = aliasesOf(kept).filter((alias) => alias.includes("COPPER KETTLE"));

  expect(kettleLabels.length).toBeGreaterThan(0);

  for (const alias of kettleLabels) {
    await edited({ action: "edit", merchant: tinder, alias, to: mossgate });
  }

  const afterMove = await rows();

  expect(afterMove(SHOPS.kettle[0])).toContain("in Groceries > Market;");
  expect(afterMove(SHOPS.mossgate[0])).toContain("in Groceries > Market;");
  expect(afterMove(SHOPS.lantern[0])).toContain("in Eating out > Cafés and bars;");
  expect(afterMove(SHOPS.kettle[1])).toContain("in Groceries > Supermarket;");
});

/** An invented hardware shop, unknown until the user makes it, then on two lines of a statement. */
const JUNIPER = [
  {
    bookedOn: "2026-10-09",
    amountMinor: -2450,
    label: "CB JUNIPER HARDWARE 0910 RIVERTON",
    reference: "JH09",
  },
  {
    bookedOn: "2026-10-23",
    amountMinor: -1290,
    label: "CB JUNIPER HARDWARE 2310",
    reference: "JH23",
  },
] as const;

/** A PNG's first bytes, in base64, made here: no real picture. */
const PNG_BASE64 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d,
]).toString("base64");

test("a merchant made by hand names the next imported lines of its label; its colour and logo are set and cleared; what it cannot be is refused (#204)", async ({
  app,
  user,
  page,
  baseURL,
  mcpClientId,
}, testInfo) => {
  // One upload waiting for the app's import job, then the calls.
  test.setTimeout(90_000);

  const maker = await addUser(app.baseURL, user, {
    name: "Ivo Example",
    email: `ivo.merchants.worker${app.slot}.${testInfo.repeatEachIndex}@example.com`,
    password: `e2e-ivo-password-${app.slot}`,
  });

  const data = openUserData(app.database);

  try {
    const owner = await data.ownerOf(maker.email);

    await data.asUser(owner, (transaction) =>
      transaction.insert(account).values({
        userId: owner,
        name: ACCOUNT_NAME,
        kind: "current",
        currency: "EUR",
        iban: statement.account.iban,
      }),
    );
  } finally {
    await data.close();
  }

  await page.context().addCookies([...maker.cookies]);

  const session = await connectMcp({
    baseURL: baseURL ?? "",
    page,
    consent: allowReadAndWrite,
    scope: "read write",
    clientId: mcpClientId,
  });

  const merchants = (args: Arguments) => callText(session.client, "merchants", args);

  // Made by hand before any of its lines, with its label, its default category and a colour.
  const made = await merchants({
    action: "create",
    name: "Juniper Hardware",
    labels: ["CB JUNIPER HARDWARE 0910"],
    category: "Groceries > Bakery",
    color: "teal",
  });

  expect(made.isError, made.text).toBe(false);
  expect(made.text).toContain("Made the merchant Juniper Hardware.");
  expect(made.text).toContain("Its 1 cleaned label name the lines");

  const file = writeStatement("camt053", { ...exampleStatement, lines: [...JUNIPER] });

  const uploaded = await callText(session.client, "imports", {
    action: "upload",
    file_name: file.fileName,
    content: file.contents,
  });

  expect(uploaded.isError, uploaded.text).toBe(false);
  expect(uploaded.text).toContain("2 lines read: 2 added");

  // The import made no merchant of its own: both lines are Juniper Hardware's.
  const found = await merchants({ action: "search", text: "juniper" });

  expect(found.text).toContain('1 merchant(s) whose name or a cleaned label contains "juniper".');
  expect(found.text).toContain("- Juniper Hardware: 1 cleaned label, colour teal");

  const shown = await merchants({ action: "show", merchant: "juniper hardware" });

  expect(shown.text).toContain("Merchant: Juniper Hardware.");
  expect(shown.text).toContain("Default category: Groceries > Bakery (expense).");
  expect(shown.text).toContain("Shown as its initials on teal; no logo");

  for (const line of JUNIPER) {
    expect(shown.text).toContain(`"${line.label}"`);
  }

  // Its lines went in its default category.
  const lines = (await callText(session.client, "lines", { action: "search", text: "juniper" }))
    .text;

  for (const line of JUNIPER) {
    expect(rowOf(lines, line.label).row).toContain("in Groceries > Bakery");
  }

  // Its logo, set from its base64, then cleared: its initials again.
  const logo = await merchants({ action: "edit", merchant: "Juniper Hardware", logo: PNG_BASE64 });

  expect(logo.isError, logo.text).toBe(false);
  expect(logo.text).toContain("Juniper Hardware's logo is set");
  expect((await merchants({ action: "show", merchant: "Juniper Hardware" })).text).toContain(
    "Shown with its logo",
  );
  expect((await merchants({ action: "search", text: "juniper" })).text).toContain(
    "- Juniper Hardware: 1 cleaned label, colour teal, a logo",
  );

  const cleared = await merchants({
    action: "edit",
    merchant: "Juniper Hardware",
    clear_logo: true,
  });

  expect(cleared.text).toBe("Juniper Hardware has no logo any more: its initials are shown.");

  const automatic = await merchants({
    action: "edit",
    merchant: "Juniper Hardware",
    color: "automatic",
  });

  expect(automatic.text).toContain("an automatic colour");
  expect((await merchants({ action: "show", merchant: "Juniper Hardware" })).text).toContain(
    "Shown as its initials on an automatic colour",
  );

  // What it cannot be: a name taken, a label naming another merchant or no one, a logo of SVG.
  const refusals: ReadonlyArray<readonly [Arguments, string]> = [
    [{ action: "create", name: "juniper hardware" }, 'named "Juniper Hardware" already'],
    [
      { action: "create", name: "Juniper Tools", labels: ["CB JUNIPER HARDWARE 0112"] },
      'The label "JUNIPER HARDWARE" names Juniper Hardware already',
    ],
    [
      { action: "create", name: "Cash", labels: ["RETRAIT DAB 21/10"] },
      "names no one once cleaned",
    ],
    [
      {
        action: "edit",
        merchant: "Juniper Hardware",
        logo: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>").toString("base64"),
      },
      "neither PNG, JPEG nor WebP",
    ],
  ];

  for (const [args, says] of refusals) {
    const refused = await merchants(args);

    expect(refused.isError, says).toBe(true);
    expect(refused.text).toContain(says);
    expect(refused.text).toContain("A valid call: ");
  }

  const after = await merchants({ action: "search", text: "juniper" });

  expect(after.text).toContain('1 merchant(s) whose name or a cleaned label contains "juniper".');
});
