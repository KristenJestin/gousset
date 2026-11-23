import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Client } from "@modelcontextprotocol/client";
import type { Page } from "@playwright/test";
import { account, statementLine } from "@gousset/db/schema/ledger";
import { exampleStatement, statementSamples } from "@gousset/fixture";
import type { SampleFile } from "@gousset/fixture";
import { Schema } from "effect";
import pg from "pg";

import { addUser } from "../src/auth";
import { databaseUrl } from "../src/database";
import { importsOn, statementFile } from "../src/imports";
import { connectMcp, expect, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #132, "How to verify": invented fixtures with `&amp;apos;`, `&amp;amp;` and a single
// `&apos;` are read as the bank meant them, through the MCP door, the app and its job queue; a
// re-import of a file imported before the fix adds nothing, once the migration
// (packages/db/src/migrations/20261123223101_decode_label_entities) has decoded the lines 0.2.0
// read and computed their keys again. The migration is run here again, as the tables' owner, on
// lines put back as 0.2.0 wrote them: it is written to be safe to run again. Each test has a user
// of its own, whose accounts no other test meets.

const MIGRATION = fileURLToPath(
  new URL(
    "../../../packages/db/src/migrations/20261123223101_decode_label_entities/migration.sql",
    import.meta.url,
  ),
);

const statementsOfMigration = () =>
  readFileSync(MIGRATION, "utf8").split("--> statement-breakpoint");

/** The account `ofx-double-encoded.ofx` names by its number. */
const OFX_ACCOUNT = "Entities current account";

/** The account `camt053-double-encoded.xml` names by its IBAN, an invented one. */
const CAMT_ACCOUNT = "Entities CAMT account";

const SAMPLES_IBAN = "FR7699999000010001234567809";

const LineRow = Schema.Struct({
  id: Schema.String,
  booked_on: Schema.String,
  label: Schema.String,
  memo: Schema.NullOr(Schema.String),
  bank_id: Schema.NullOr(Schema.String),
  dedup_key: Schema.NullOr(Schema.String),
  state: Schema.String,
  duplicate_of_line_id: Schema.NullOr(Schema.String),
});

type LineRow = typeof LineRow.Type;

const decodeLines = Schema.decodeUnknownSync(Schema.Array(LineRow));

/** Runs `work` on the worker's database as the harness's own role: the tables' owner. */
async function asOwner<A>(database: string, work: (client: pg.Client) => Promise<A>): Promise<A> {
  const client = new pg.Client({ connectionString: databaseUrl(database) });

  await client.connect();

  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** An account's lines, read past row-level security, in the order they were made. */
async function linesOf(client: pg.Client, accountId: string): Promise<ReadonlyArray<LineRow>> {
  const result = await client.query(
    `select id::text, to_char(booked_on, 'YYYY-MM-DD') as booked_on, label, memo, bank_id,
       dedup_key, state::text, duplicate_of_line_id::text
     from statement_line where account_id = $1 order by id`,
    [accountId],
  );

  return decodeLines(result.rows);
}

/** Runs the migration whole, in one transaction, as Drizzle's migrator does. */
async function runMigration(client: pg.Client): Promise<void> {
  await client.query("begin");

  for (const statement of statementsOfMigration()) {
    await client.query(statement);
  }

  await client.query("commit");
}

/** Puts a line's text and key back as they were. */
async function putBack(
  client: pg.Client,
  id: string,
  line: { label: string; memo: string | null; dedupKey: string },
): Promise<void> {
  await client.query(
    "update statement_line set label = $2, memo = $3, dedup_key = $4 where id = $1",
    [id, line.label, line.memo, line.dedupKey],
  );
}

/** The baker's two lines of a day, as the fixed import keys them, and as 0.2.0 did. */
const BAKER = {
  first: "content:54c347bc4c470134458e3fff43d68d4e173b56cbdedb8a2e702360d8aee381bb#1",
  second: "content:54c347bc4c470134458e3fff43d68d4e173b56cbdedb8a2e702360d8aee381bb#2",
  firstBeforeTheFix: "content:d748edab169e5007aa1ff471dad2e775d50b577b5e8039f1a09a2586d86d8ca7#1",
  secondBeforeTheFix: "content:d748edab169e5007aa1ff471dad2e775d50b577b5e8039f1a09a2586d86d8ca7#2",
};

/**
 * What 0.2.0 stored for each line of `ofx-double-encoded.ofx` it changes, by the key the fixed
 * import gives that line: the label decoded once, and the key made from it. These are the rows the
 * upgrade check finds in 0.2.0's own import of the same lines (tools/check-upgrade.changes.json).
 */
const BEFORE_THE_FIX = new Map([
  [
    "bank:EX2026110201",
    {
      label: "CB CAFE DE L&apos;EXEMPLE",
      memo: "PAIEMENT PAR CARTE",
      dedupKey: "bank:EX2026110201",
    },
  ],
  [
    BAKER.first,
    {
      label: "BOULANGERIE L&apos;EPI D&apos;EXEMPLE",
      memo: null,
      dedupKey: BAKER.firstBeforeTheFix,
    },
  ],
  [
    BAKER.second,
    {
      label: "BOULANGERIE L&apos;EPI D&apos;EXEMPLE",
      memo: null,
      dedupKey: BAKER.secondBeforeTheFix,
    },
  ],
  [
    "content:0ed9eec6279a398b247bc1b58a17cbcf76a88d781735c561514156a1691d7558#1",
    {
      label: "PRLV SEPA ELEC &amp; GAZ EXEMPLE",
      memo: "ECHEANCE &quot;NOVEMBRE&quot;",
      dedupKey: "content:1e467e718e773fdfc6dfe252dea8a9d2d81b69c028e45801c4864eda9e4a0d28#1",
    },
  ],
]);

/** Puts every line of `ofx-double-encoded.ofx` back as 0.2.0 stored it; how many it changed. */
async function asBeforeTheFix(client: pg.Client, lines: ReadonlyArray<LineRow>): Promise<number> {
  let changed = 0;

  for (const line of lines) {
    const before = BEFORE_THE_FIX.get(line.dedup_key ?? "");

    if (before !== undefined) {
      await putBack(client, line.id, before);
      changed += 1;
    }
  }

  return changed;
}

/** A new user of the test's own, with the two accounts the samples name. */
async function userWithAccounts(
  app: { baseURL: string; database: string; slot: number },
  administrator: Parameters<typeof addUser>[1],
  name: string,
  repeat: number,
) {
  const person = await addUser(app.baseURL, administrator, {
    name: `${name} Example`,
    email: `${name.toLowerCase()}.entities.worker${String(app.slot)}.${String(repeat)}@example.com`,
    password: `e2e-${name.toLowerCase()}-password-${String(app.slot)}`,
  });

  const data = openUserData(app.database);

  try {
    const owner = await data.ownerOf(person.email);

    const accounts = await data.asUser(owner, (transaction) =>
      transaction
        .insert(account)
        .values([
          {
            userId: owner,
            name: OFX_ACCOUNT,
            kind: "current",
            currency: "EUR",
            number: "00012345678",
          },
          {
            userId: owner,
            name: CAMT_ACCOUNT,
            kind: "current",
            currency: "EUR",
            iban: SAMPLES_IBAN,
          },
        ])
        .returning({ id: account.id, name: account.name }),
    );

    const idOf = (accountName: string) =>
      accounts.find((each) => each.name === accountName)?.id ?? "";

    return { person, owner, ofxAccount: idOf(OFX_ACCOUNT), camtAccount: idOf(CAMT_ACCOUNT) };
  } finally {
    await data.close();
  }
}

const allowReadAndWrite = (page: Page) =>
  page.getByRole("button", { name: "Allow read and write" }).click();

type Arguments = { readonly [key: string]: string | number };

/** The text of a tool's answer, and whether it is an error. */
async function callText(client: Client, name: string, args: Arguments) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}

const upload = (client: Client, sample: SampleFile) =>
  callText(client, "imports", {
    action: "upload",
    file_name: sample.fileName,
    content: new TextDecoder().decode(sample.bytes),
  });

/** The handle of the only line a search found. */
function onlyLine(text: string): string {
  const handles = [...text.matchAll(/; line: (\S+)$/gm)].map(([, handle]) => handle ?? "");

  expect(handles, text).toHaveLength(1);

  return handles[0] ?? "";
}

const ENTITIES = ["&apos;", "&amp;", "&quot;", "&#"];

test("invented fixtures with &amp;apos;, &amp;amp; and a single &apos; are read as the bank meant them", async ({
  app,
  user,
  page,
  baseURL,
  mcpClientId,
}, testInfo) => {
  // Two uploads, each waiting for the app's import job.
  test.setTimeout(90_000);

  const { person } = await userWithAccounts(app, user, "Noa", testInfo.repeatEachIndex);

  await page.context().addCookies([...person.cookies]);

  const session = await connectMcp({
    baseURL: baseURL ?? "",
    page,
    consent: allowReadAndWrite,
    scope: "read write",
    clientId: mcpClientId,
  });

  const ofx = await upload(session.client, statementSamples.ofxDoubleEncoded);

  expect(ofx.isError, ofx.text).toBe(false);
  expect(ofx.text).toContain(`into ${OFX_ACCOUNT}`);
  expect(ofx.text).toContain("6 lines read: 6 added, 0 already known (duplicates)");

  const camt = await upload(session.client, statementSamples.camt053DoubleEncoded);

  expect(camt.isError, camt.text).toBe(false);
  expect(camt.text).toContain(`into ${CAMT_ACCOUNT}`);
  expect(camt.text).toContain("2 lines read: 2 added, 0 already known (duplicates)");

  // Every label as the bank meant it: encoded twice (`&amp;apos;`, `&amp;amp;`) or once (`&apos;`).
  const listed = await callText(session.client, "lines", {
    action: "search",
    account: OFX_ACCOUNT,
  });

  expect(listed.isError, listed.text).toBe(false);
  expect(listed.text).toContain('"CB CAFE DE L\'EXEMPLE"');
  expect(listed.text.match(/"BOULANGERIE L'EPI D'EXEMPLE"/g)).toHaveLength(2);
  expect(listed.text).toContain('"PRLV SEPA ELEC & GAZ EXEMPLE"');
  expect(listed.text.match(/"LIBRAIRIE L'ENCRE EXEMPLE"/g)).toHaveLength(2);

  for (const entity of ENTITIES) {
    expect(listed.text).not.toContain(entity);
  }

  // A memo, a counterparty's name and remittance information, decoded alike.
  const debit = await callText(session.client, "lines", {
    action: "search",
    account: OFX_ACCOUNT,
    text: "GAZ",
  });

  const shownDebit = await callText(session.client, "lines", {
    action: "show",
    line: onlyLine(debit.text),
  });

  expect(shownDebit.text).toContain('Memo: ECHEANCE "NOVEMBRE"');

  const cafe = await callText(session.client, "lines", {
    action: "search",
    account: CAMT_ACCOUNT,
    text: "CAFE",
  });

  const shownCafe = await callText(session.client, "lines", {
    action: "show",
    line: onlyLine(cafe.text),
  });

  expect(shownCafe.text).toContain('Label: "CB CAFE DE L\'EXEMPLE"');
  expect(shownCafe.text).toContain("Memo: TICKET L'EXEMPLE");
  expect(shownCafe.text).toContain("Counterparty: CAFE DE L'EXEMPLE & FILS");

  for (const entity of ENTITIES) {
    expect(shownDebit.text + shownCafe.text).not.toContain(entity);
  }
});

test("a re-import of a file imported before the fix adds nothing", async ({
  app,
  user,
  page,
  baseURL,
  mcpClientId,
}, testInfo) => {
  test.setTimeout(90_000);

  const { person, ofxAccount } = await userWithAccounts(
    app,
    user,
    "Sasha",
    testInfo.repeatEachIndex,
  );

  await page.context().addCookies([...person.cookies]);

  const session = await connectMcp({
    baseURL: baseURL ?? "",
    page,
    consent: allowReadAndWrite,
    scope: "read write",
    clientId: mcpClientId,
  });

  const first = await upload(session.client, statementSamples.ofxDoubleEncoded);

  expect(first.text).toContain("6 lines read: 6 added, 0 already known (duplicates)");

  await asOwner(app.database, async (client) => {
    // The lines as the fixed import writes them, then as 0.2.0 wrote them.
    const fixed = await linesOf(client, ofxAccount);

    expect(await asBeforeTheFix(client, fixed)).toBe(4);
    expect((await linesOf(client, ofxAccount)).map((line) => line.label)).toContain(
      "BOULANGERIE L&apos;EPI D&apos;EXEMPLE",
    );

    // The update: every line as the fixed import writes it, text and key, and so again.
    await runMigration(client);

    expect(await linesOf(client, ofxAccount)).toEqual(fixed);

    await runMigration(client);

    expect(await linesOf(client, ofxAccount)).toEqual(fixed);
  });

  const again = await upload(session.client, statementSamples.ofxDoubleEncoded);

  expect(again.isError, again.text).toBe(false);
  expect(again.text).toContain("6 lines read: 0 added, 6 already known (duplicates)");

  await asOwner(app.database, async (client) => {
    expect(await linesOf(client, ofxAccount)).toHaveLength(6);
  });
});

/**
 * Labels as a bank may write them in an OFX file, each one encoded twice or more, numeric
 * references, characters the readers drop or turn into a space, and what is no entity. No `<`: it
 * would open a tag. No NUL nor half a surrogate pair, which the migration leaves as they are.
 */
const RAW_LABELS = [
  "CB CAFE DE L&amp;apos;EXEMPLE",
  "A&amp;amp;amp;lt;B",
  "L&amp;#39;EST L&AMP;#x27;OUEST",
  "&lt&#59; &#38;apos;",
  "R&D & CO",
  "&amp;unknown; &#99999999; &#x;",
  "CAFE&amp;nbsp;",
  "&amp;#x2028;A&amp;#9;B  &amp;#x202E;C",
  "&#x1F600; SOURIRE",
  "&amp;#160;DEBUT ET FIN&amp;#xA0;",
  "ZERO&amp;#x200B;LARGEUR",
  "NEL&amp;#x85;ICI",
  "BOM&amp;#xFEFF;ICI&amp;#xfeff;",
  "IDEO&amp;#x3000;&amp;#x3000;ESPACE",
  "x&amp;quot;y&amp;gt;z&amp;#62;",
  "ÉLÉ&amp;amp;GANCE   À  PARIS",
  "&amp;amp;#38;amp;",
];

/** An OFX file whose lines bear these labels and no FITID, one a day from 2026-10-01. */
function ofxWithLabels(labels: ReadonlyArray<string>): string {
  const transactions = labels.flatMap((label, index) => [
    "<STMTTRN>",
    "<TRNTYPE>DEBIT",
    `<DTPOSTED>202610${String(index + 1).padStart(2, "0")}`,
    "<TRNAMT>-1.00",
    `<NAME>${label}`,
    "</STMTTRN>",
  ]);

  return [
    "OFXHEADER:100",
    "",
    "<OFX>",
    "<BANKMSGSRSV1>",
    "<STMTTRNRS>",
    "<STMTRS>",
    "<CURDEF>EUR",
    "<BANKACCTFROM>",
    "<ACCTID>00012345678",
    "</BANKACCTFROM>",
    "<BANKTRANLIST>",
    ...transactions,
    "</BANKTRANLIST>",
    "</STMTRS>",
    "</STMTTRNRS>",
    "</BANKMSGSRSV1>",
    "</OFX>",
    "",
  ].join("\n");
}

const SqlLine = Schema.Struct({
  label: Schema.NullOr(Schema.String),
  key: Schema.NullOr(Schema.String),
});

test("the migration decodes a label and computes its key as the readers and the import do", async ({
  app,
  user,
}, testInfo) => {
  const { owner, ofxAccount } = await userWithAccounts(app, user, "Lou", testInfo.repeatEachIndex);
  const data = openUserData(app.database);

  try {
    const imported = await importsOn(data).importFile(owner, ofxAccount, {
      fileName: "labels.ofx",
      contents: ofxWithLabels(RAW_LABELS),
    });

    expect(imported).toMatchObject({ status: "done", linesAdded: RAW_LABELS.length });
  } finally {
    await data.close();
  }

  await asOwner(app.database, async (client) => {
    const lines = new Map(
      (await linesOf(client, ofxAccount)).map((line) => [line.booked_on, line]),
    );

    // The migration's functions, made in this session, as the migration makes them in its own.
    for (const statement of statementsOfMigration()) {
      if (statement.includes("CREATE OR REPLACE FUNCTION pg_temp.")) {
        await client.query(statement);
      }
    }

    for (const [index, raw] of RAW_LABELS.entries()) {
      const day = `2026-10-${String(index + 1).padStart(2, "0")}`;

      const result = await client.query(
        `select pg_temp.gousset_clean_value(pg_temp.gousset_decode_entities($1)) as label,
          pg_temp.gousset_content_key($2::date, -100,
            pg_temp.gousset_clean_value(pg_temp.gousset_decode_entities($1))) || '#1' as key`,
        // The OFX reader trims a value before it decodes it.
        [raw.trim(), day],
      );

      const [computed] = Schema.decodeUnknownSync(Schema.Array(SqlLine))(result.rows);
      const line = lines.get(day);

      expect(line, raw).toBeDefined();
      expect(computed, raw).toEqual({ label: line?.label, key: line?.dedup_key });
    }
  });
});

test("the migration keeps a line's key when another line holds the new one, and leaves other lines as they are", async ({
  app,
  user,
}, testInfo) => {
  const { owner, ofxAccount } = await userWithAccounts(app, user, "Kim", testInfo.repeatEachIndex);
  const data = openUserData(app.database);
  const imports = importsOn(data);

  // The same baker's payment exported as CSV, its label written once; a day past the 12th, so that
  // its days are read without asking.
  const csv = statementFile(
    "csv",
    {
      ...exampleStatement,
      lines: [
        {
          bookedOn: "2026-11-03",
          amountMinor: -120,
          label: "BOULANGERIE L'EPI D'EXEMPLE",
          reference: "CSV1",
        },
        {
          bookedOn: "2026-11-20",
          amountMinor: -300,
          label: "TEXTE L&apos;EXEMPLE",
          reference: "CSV2",
        },
      ],
    },
    "export.csv",
  );

  try {
    await imports.importFile(owner, ofxAccount, {
      fileName: statementSamples.ofxDoubleEncoded.fileName,
      bytes: statementSamples.ofxDoubleEncoded.bytes,
    });

    // The OFX file as 0.2.0 imported it, then the CSV export, read by today's import: its baker's
    // line meets no key and is held as a near duplicate of the OFX's first one.
    await asOwner(app.database, async (client) => {
      expect(await asBeforeTheFix(client, await linesOf(client, ofxAccount))).toBe(4);
    });

    const read = await imports.importFile(owner, ofxAccount, csv);

    expect(read).toMatchObject({ status: "done", linesAdded: 1, linesHeld: 1 });

    await data.asUser(owner, (transaction) =>
      transaction.insert(statementLine).values({
        userId: owner,
        accountId: ofxAccount,
        source: "manual",
        bookedOn: "2026-11-21",
        amountMinor: -400,
        label: "SAISIE L&apos;EXEMPLE",
      }),
    );
  } finally {
    await data.close();
  }

  await asOwner(app.database, async (client) => {
    const before = await linesOf(client, ofxAccount);

    await runMigration(client);

    const after = await linesOf(client, ofxAccount);
    const byId = new Map(before.map((line) => [line.id, line]));

    // No line came or went.
    expect(after.map((line) => line.id)).toEqual(before.map((line) => line.id));

    const bakers = after.filter((line) => line.label === "BOULANGERIE L'EPI D'EXEMPLE");
    const keyed = (key: string) => bakers.find((line) => line.dedup_key === key);
    const held = bakers.find((line) => line.state === "held");

    // The first OFX line's new key is the held CSV line's: it keeps its own, decoded all the
    // same; the second takes its new key; the CSV line is left as it was.
    expect(bakers).toHaveLength(3);
    expect(held?.dedup_key).toBe(BAKER.first);
    expect(held).toEqual(byId.get(held?.id ?? ""));
    expect(keyed(BAKER.firstBeforeTheFix)?.state).toBe("counted");
    expect(keyed(BAKER.second)?.state).toBe("counted");

    // A CSV's text and a line entered by hand are the user's and the bank's as written.
    for (const label of ["TEXTE L&apos;EXEMPLE", "SAISIE L&apos;EXEMPLE"]) {
      expect(after.find((line) => line.label === label)).toEqual(
        before.find((line) => line.label === label),
      );
    }
  });

  // The OFX file imported again counts nothing twice: its first baker's line is the CSV's.
  const again = await importAgain(app.database, owner, ofxAccount);

  expect(again).toMatchObject({ status: "done", linesAdded: 0, linesDuplicate: 6, linesHeld: 0 });
});

/** The direct debit's line of `ofx-double-encoded.ofx`, as the fixed import keys it. */
const DEBIT = "content:0ed9eec6279a398b247bc1b58a17cbcf76a88d781735c561514156a1691d7558#1";

/** The first of the lines booked that day. */
const onDay = (lines: ReadonlyArray<LineRow>, day: string) =>
  lines.find((line) => line.booked_on === day);

test("the migration leaves as they are the lines it cannot read as the reader does", async ({
  app,
  user,
}, testInfo) => {
  const { owner, ofxAccount, camtAccount } = await userWithAccounts(
    app,
    user,
    "Ari",
    testInfo.repeatEachIndex,
  );

  const data = openUserData(app.database);
  const imports = importsOn(data);
  const camtText = new TextDecoder().decode(statementSamples.camt053DoubleEncoded.bytes);

  try {
    const read = [
      await imports.importFile(owner, ofxAccount, {
        fileName: statementSamples.ofxDoubleEncoded.fileName,
        bytes: statementSamples.ofxDoubleEncoded.bytes,
      }),
      // A CDATA section is read as written: its `&amp;apos;` stays.
      await imports.importFile(owner, ofxAccount, {
        fileName: "cdata.ofx",
        contents: ofxWithLabels(["<![CDATA[CB L&amp;apos;EXEMPLE CDATA]]>", "CB L&amp;apos;AUTRE"]),
      }),
      await imports.importFile(owner, camtAccount, {
        fileName: statementSamples.camt053DoubleEncoded.fileName,
        bytes: statementSamples.camt053DoubleEncoded.bytes,
      }),
      // The same entries a month earlier, in a file that holds a comment.
      await imports.importFile(owner, camtAccount, {
        fileName: "commented.xml",
        contents: camtText
          .replace("<Stmt>", "<Stmt>\n<!-- an invented comment -->")
          .replaceAll("2026-11-02", "2026-10-22")
          .replaceAll("2026-11-06", "2026-10-26"),
      }),
    ];

    expect(read.map((summary) => [summary.status, summary.linesAdded])).toEqual([
      ["done", 6],
      ["done", 2],
      ["done", 2],
      ["done", 2],
    ]);
  } finally {
    await data.close();
  }

  await asOwner(app.database, async (client) => {
    const ofxLines = await linesOf(client, ofxAccount);
    const camtLines = await linesOf(client, camtAccount);
    const keyed = (key: string) => ofxLines.find((line) => line.dedup_key === key);

    const fixedDebit = keyed(DEBIT);
    const debitBefore = BEFORE_THE_FIX.get(DEBIT);

    expect(fixedDebit).toBeDefined();
    expect(debitBefore).toBeDefined();

    /** Gives a line another label, and memo, as 0.2.0 may have stored them. */
    const store = async (line: LineRow | undefined, label: string, memo = line?.memo ?? null) => {
      expect(line, label).toBeDefined();
      await putBack(client, line?.id ?? "", { label, memo, dedupKey: line?.dedup_key ?? "" });
    };

    // The control: a line encoded twice, as 0.2.0 stored it, which the migration decodes and keys
    // again.
    await putBack(
      client,
      fixedDebit?.id ?? "",
      debitBefore ?? { label: "", memo: null, dedupKey: "" },
    );

    // More than ten levels, a million characters: refused at the eleventh pass.
    await store(keyed("bank:EX2026110201"), `L&${"amp;".repeat(250_000)}apos;EXEMPLE`);
    // A surrogate pair, which the reader joins into one character.
    await store(keyed(BAKER.first), "CAFE &#55357;&#56832; L&apos;EXEMPLE");
    // A label that decodes to a space, which the reader leaves empty and takes the memo for.
    await store(keyed(BAKER.second), "&#32;", "X");
    // NUL, which the reader drops.
    await store(onDay(ofxLines, "2026-11-06"), "A&#0;B");
    // A line of a file that holds a CDATA section.
    await store(onDay(ofxLines, "2026-10-02"), "CB L&apos;AUTRE");
    // A CAMT.053 memo that decodes to its label: the reader would give no memo.
    await store(onDay(camtLines, "2026-11-02"), "TICKET L&apos;EXEMPLE");
    // A line of a CAMT.053 file that holds a comment.
    await store(onDay(camtLines, "2026-10-22"), "CB CAFE DE L&apos;EXEMPLE");

    const before = [
      ...(await linesOf(client, ofxAccount)),
      ...(await linesOf(client, camtAccount)),
    ];

    const started = Date.now();

    await runMigration(client);

    // Each pass reads the text once, and there are eleven at most.
    expect(Date.now() - started).toBeLessThan(30_000);

    const after = [...(await linesOf(client, ofxAccount)), ...(await linesOf(client, camtAccount))];

    expect(after).toEqual(before.map((line) => (line.id === fixedDebit?.id ? fixedDebit : line)));
  });
});

/** Imports `ofx-double-encoded.ofx` again into the account; the import's summary. */
async function importAgain(database: string, owner: string, accountId: string) {
  const data = openUserData(database);

  try {
    return await importsOn(data).importFile(owner, accountId, {
      fileName: statementSamples.ofxDoubleEncoded.fileName,
      bytes: statementSamples.ofxDoubleEncoded.bytes,
    });
  } finally {
    await data.close();
  }
}
