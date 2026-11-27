import type { Page } from "@playwright/test";
import { account, category, entry, entryPart, statementLine } from "@gousset/db/schema/ledger";
import type { Client } from "@modelcontextprotocol/client";
import { and, eq } from "drizzle-orm";
import { Schema } from "effect";

import { addUser, connectMcp, expect, personOfItsOwn, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #217 through the MCP door: a subject paid back by someone else, with `subjects`
// (`payback_from`, `attach_payback`, `list` with `waiting`), and its payback lines as `lines` and
// `month` read them, called by the official MCP client over the real OAuth flow, against the built
// app and a real Postgres. Each test has a user of its own, their lines written as an import writes
// them: one entry each, in its kind's fallback. Every name and amount is invented.
//
// The MCP door reads today from the server's clock: the lines are written in the two months
// before the current one, so that they read the same whenever the test runs.

let data: ReturnType<typeof openUserData>;

test.beforeAll(({ app }) => {
  data = openUserData(app.database);
});

test.afterAll(async () => {
  await data.close();
});

/** The month `offset` months from the current one, `YYYY-MM`, as the server's clock reads it. */
function monthFromNow(offset: number): string {
  const now = new Date();

  return new Date(Date.UTC(now.getFullYear(), now.getMonth() + offset, 1))
    .toISOString()
    .slice(0, 7);
}

const LAST_MONTH = monthFromNow(-1);
const TWO_MONTHS_AGO = monthFromNow(-2);

const ERROR_LIMIT = 2000;

const allowReadAndWrite = (page: Page) =>
  page.getByRole("button", { name: "Allow read and write" }).click();

const allowReadOnly = (page: Page) => page.getByRole("button", { name: "Allow read only" }).click();

type Arguments = { readonly [key: string]: Schema.Json };

const Written = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json));

/** A line to seed: the day, its amount in cents (out negative), its label, its account's name. */
type Seeded = readonly [day: string, minor: number, label: string, account?: string];

/** The user's lines, each of one entry in its kind's fallback, as imported. */
function seed(owner: string, lines: ReadonlyArray<Seeded>) {
  return data.asUser(owner, async (transaction) => {
    const accounts = new Map<string, string>();

    for (const [bookedOn, amountMinor, label, name = "Everyday account"] of lines) {
      const known = accounts.get(name);

      const [made] =
        known === undefined
          ? await transaction
              .insert(account)
              .values({ userId: owner, name, kind: "current", currency: "EUR" })
              .returning({ id: account.id })
          : [{ id: known }];

      if (made === undefined) {
        throw new Error("The account was not made.");
      }

      accounts.set(name, made.id);
      const kind = amountMinor < 0 ? "expense" : "income";

      const [fallback] = await transaction
        .select({ id: category.id })
        .from(category)
        .where(and(eq(category.kind, kind), eq(category.isFallback, true)));

      const [line] = await transaction
        .insert(statementLine)
        .values({
          userId: owner,
          accountId: made.id,
          source: "manual",
          bookedOn,
          amountMinor,
          label,
        })
        .returning({ id: statementLine.id });

      const [written] = await transaction
        .insert(entry)
        .values({
          userId: owner,
          kind,
          happenedOn: bookedOn,
          categoryId: fallback?.id ?? "",
          classifiedBy: "default",
        })
        .returning({ id: entry.id });

      if (line === undefined || written === undefined) {
        throw new Error("The line was not made.");
      }

      await transaction.insert(entryPart).values({
        userId: owner,
        entryId: written.id,
        lineId: line.id,
        role: "payment",
        amountMinor: Math.abs(amountMinor),
      });
    }
  });
}

/** A user of the test's own, their lines seeded, and their MCP client connected. */
async function paybackUser(
  page: Page,
  app: { readonly baseURL: string },
  user: Parameters<typeof addUser>[1],
  mcpClientId: string,
  local: string,
  lines: ReadonlyArray<Seeded>,
  consent = allowReadAndWrite,
) {
  const person = await addUser(app.baseURL, user, personOfItsOwn(local));
  const owner = await data.ownerOf(person.email);

  await seed(owner, lines);
  await page.context().addCookies([...person.cookies]);

  const { client } = await connectMcp({
    baseURL: app.baseURL,
    page,
    consent,
    scope: "read write",
    clientId: mcpClientId,
  });

  const call = async (name: string, args: Arguments) => {
    const result = await (client satisfies Client).callTool({ name, arguments: args });
    const [first] = result.content ?? [];

    return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
  };

  /** Calls a tool and expects it to answer. */
  const answer = async (name: string, args: Arguments) => {
    const answered = await call(name, args);

    expect(answered.isError, answered.text).toBe(false);

    return answered.text;
  };

  /** Calls a tool and expects its refusal, under its size and with a valid call. */
  const refusal = async (name: string, args: Arguments) => {
    const refused = await call(name, args);

    expect(refused.isError, refused.text).toBe(true);
    expect(refused.text.length, refused.text).toBeLessThan(ERROR_LIMIT);
    expect(refused.text).toContain("A valid call: ");

    return refused.text;
  };

  /** A line's handle, from a search of every line. */
  const handleOf = async (label: string) => {
    const found = await answer("lines", { action: "search", text: label });

    const row =
      found.split("\n").find((line) => line.startsWith("- ") && line.includes(`"${label}"`)) ?? "";

    const [, handle = ""] = /; line: (\S+)$/.exec(row) ?? [];

    expect(handle, found).not.toBe("");

    return handle;
  };

  const subjects = (args: Arguments) => answer("subjects", args);

  return { call, answer, refusal, subjects, handleOf };
}

/** The call a text writes after `lead`, read back. */
function callAfter(text: string, lead: string): Arguments {
  const at = text.indexOf(lead);

  expect(at, text).toBeGreaterThan(-1);

  return Schema.decodeUnknownSync(Written)(text.slice(at + lead.length).split("\n")[0] ?? "");
}

test("a paid-back subject with three expenses and one larger transfer back shows spent, paid back and the difference", async ({
  page,
  app,
  user,
  mcpClientId,
}) => {
  const { answer, subjects, handleOf } = await paybackUser(page, app, user, mcpClientId, "leonie", [
    [`${TWO_MONTHS_AGO}-18`, -12_000, "CB RAILWAYS"],
    [`${TWO_MONTHS_AGO}-19`, -9000, "CB GRAND HOTEL"],
    [`${TWO_MONTHS_AGO}-20`, -4185, "CB CITY TAXI"],
    [`${LAST_MONTH}-08`, 91_450, "VIR EXAMPLE CONSULTING NOTE DE FRAIS"],
    [`${LAST_MONTH}-09`, 2500, "VIR SOMEONE ELSE"],
  ]);

  expect(
    await subjects({
      action: "create",
      name: "Riverton trip",
      payback_from: "Example Consulting",
      payback_asked_on: `${LAST_MONTH}-02`,
    }),
  ).toContain(
    `Created the subject Riverton trip: paid back by Example Consulting, asked on ${LAST_MONTH}-02.`,
  );

  await subjects({
    action: "attach",
    subject: "Riverton trip",
    lines: [
      await handleOf("CB RAILWAYS"),
      await handleOf("CB GRAND HOTEL"),
      await handleOf("CB CITY TAXI"),
    ],
  });

  const report = await handleOf("VIR EXAMPLE CONSULTING NOTE DE FRAIS");
  const before = await subjects({ action: "show", subject: "Riverton trip", period: "all" });

  expect(before).toContain(
    `Paid back by Example Consulting, all time, in EUR: spent 251.85 EUR, paid back 0.00 EUR, difference -251.85 EUR (paid back less spent). State: asked on ${LAST_MONTH}-02, nothing back yet.`,
  );
  expect(before).toContain("No line pays it back yet.");
  // Offered, the payer's words first, and attached only on the user's yes.
  expect(before).toContain(
    `\n- ${LAST_MONTH}-08, Everyday account: 914.50 EUR, "VIR EXAMPLE CONSULTING NOTE DE FRAIS"; line: ${report}`,
  );
  expect(before).toContain("never attach one without the user's yes");

  const proposed = callAfter(before, "Once the user says yes: subjects ");

  expect(proposed).toEqual({ action: "attach_payback", subject: "Riverton trip", lines: [report] });

  const attached = await subjects(proposed);

  expect(attached).toContain("Attached 1 line(s) to Riverton trip as what pays it back.");
  expect(attached).toContain(
    "Riverton trip now: spent 251.85 EUR, paid back 914.50 EUR, difference +662.65 EUR; paid back.",
  );

  const after = await subjects({ action: "show", subject: "Riverton trip", period: "all" });

  expect(after).toContain(
    "spent 251.85 EUR, paid back 914.50 EUR, difference +662.65 EUR (paid back less spent). State: paid back.",
  );
  expect(after).toContain(
    `Its payback lines, oldest first (booked on, account: amount, label; the handle attach_payback takes):\n- ${LAST_MONTH}-08, Everyday account: 914.50 EUR, "VIR EXAMPLE CONSULTING NOTE DE FRAIS"; line: ${report}`,
  );
  expect(callAfter(after, "To detach one: subjects ")).toEqual({
    action: "attach_payback",
    subject: "Riverton trip",
    lines: [report],
    remove: true,
  });
  // Its own cost stays the full cost of its expenses.
  expect(after).toContain("Cost: 251.85 EUR");

  expect(await subjects({ action: "list" })).toContain(
    `; paid back by Example Consulting, asked on ${LAST_MONTH}-02: paid back, spent 251.85 EUR, paid back 914.50 EUR, difference +662.65 EUR`,
  );

  // The transfer back is no income in the month: a payback of its subject.
  const month = await answer("month", { action: "summary", month: LAST_MONTH });

  expect(month).toContain("Received 25.00 EUR");
  expect(month).toContain(
    `\n- ${LAST_MONTH}-08, payback of Riverton trip, not income: Example Consulting → Everyday account, 914.50 EUR`,
  );

  // The line names the subject it pays back, and the call that detaches it.
  expect(await answer("lines", { action: "search", text: "NOTE DE FRAIS" })).toContain(
    `"VIR EXAMPLE CONSULTING NOTE DE FRAIS", pays back Riverton trip; line: ${report}`,
  );

  const line = await answer("lines", { action: "show", line: report });

  expect(line).toContain("Pays back the subject Riverton trip, which classifies it: no income.");
  expect(callAfter(line, "If it does not: subjects ")).toEqual({
    action: "attach_payback",
    subject: "Riverton trip",
    lines: [report],
    remove: true,
  });

  // Detached, it is an income of its own again.
  expect(
    await subjects({
      action: "attach_payback",
      subject: "Riverton trip",
      lines: [report],
      remove: true,
    }),
  ).toContain("Detached 1 line(s) from Riverton trip: each is an income of its own again");
  expect(await answer("lines", { action: "show", line: report })).not.toContain("Pays back");
});

test("a shared holiday settled in two transfers that cover less than it cost shows partly paid back", async ({
  page,
  app,
  user,
  mcpClientId,
}) => {
  const { subjects, handleOf } = await paybackUser(page, app, user, mcpClientId, "maxime", [
    [`${TWO_MONTHS_AGO}-03`, -40_000, "CB LAKE CABIN"],
    [`${TWO_MONTHS_AGO}-04`, -6000, "CB BOAT RENTAL"],
    [`${LAST_MONTH}-02`, 15_000, "VIR SAM EXAMPLE CABIN"],
    [`${LAST_MONTH}-12`, 10_000, "VIR SAM EXAMPLE BOAT"],
  ]);

  await subjects({ action: "create", name: "Shared holiday", payback_from: "Sam Example" });
  await subjects({
    action: "attach",
    subject: "Shared holiday",
    lines: [await handleOf("CB LAKE CABIN"), await handleOf("CB BOAT RENTAL")],
  });

  expect(
    await subjects({
      action: "attach_payback",
      subject: "shared holiday",
      lines: [await handleOf("VIR SAM EXAMPLE CABIN"), await handleOf("VIR SAM EXAMPLE BOAT")],
    }),
  ).toContain("Attached 2 line(s) to Shared holiday as what pays it back.");

  expect(await subjects({ action: "show", subject: "Shared holiday" })).toContain(
    "Paid back by Sam Example, all time, in EUR: spent 460.00 EUR, paid back 250.00 EUR, difference -210.00 EUR (paid back less spent). State: partly paid back.",
  );
});

test("what the user still waits for, with how much", async ({ page, app, user, mcpClientId }) => {
  const { subjects, handleOf, refusal } = await paybackUser(
    page,
    app,
    user,
    mcpClientId,
    "noemie",
    [
      [`${TWO_MONTHS_AGO}-05`, -3000, "CB GIFT SHOP"],
      [`${TWO_MONTHS_AGO}-06`, -12_000, "CB RAILWAYS"],
      [`${TWO_MONTHS_AGO}-07`, -46_000, "CB LAKE CABIN"],
      [`${TWO_MONTHS_AGO}-08`, -5000, "CB OLD TRIP"],
      [`${LAST_MONTH}-02`, 15_000, "VIR SAM EXAMPLE"],
    ],
  );

  const subject = async (name: string, from: string, label: string, more: Arguments = {}) => {
    await subjects({ action: "create", name, payback_from: from, ...more });
    await subjects({ action: "attach", subject: name, lines: [await handleOf(label)] });
  };

  await subject("Riverton trip", "Example Consulting", "CB RAILWAYS", {
    payback_asked_on: `${LAST_MONTH}-01`,
  });
  await subject("Gift pool", "Friends", "CB GIFT SHOP");
  await subject("Shared holiday", "Sam Example", "CB LAKE CABIN");
  await subject("Old trip", "Example Consulting", "CB OLD TRIP");
  await subjects({ action: "create", name: "Bicycle" });
  await subjects({
    action: "attach_payback",
    subject: "Shared holiday",
    lines: [await handleOf("VIR SAM EXAMPLE")],
  });

  // Settled by hand: paid back, whatever came back.
  expect(
    await subjects({
      action: "edit",
      subject: "Old trip",
      payback_settled_on: `${LAST_MONTH}-20`,
    }),
  ).toContain(`settled by hand on ${LAST_MONTH}-20`);

  const waiting = await subjects({ action: "list", waiting: true });

  expect(waiting).toContain(
    "The user waits to be paid back for 3 subject(s), in EUR: those to ask first, then those asked, by the day they were, then those partly paid back.",
  );
  expect(waiting).toContain(
    [
      "- Gift pool, by Friends: waits for 30.00 EUR (spent 30.00 EUR, paid back 0.00 EUR); to ask",
      `- Riverton trip, by Example Consulting: waits for 120.00 EUR (spent 120.00 EUR, paid back 0.00 EUR); asked on ${LAST_MONTH}-01, nothing back yet`,
      "- Shared holiday, by Sam Example: waits for 310.00 EUR (spent 460.00 EUR, paid back 150.00 EUR); partly paid back",
    ].join("\n"),
  );
  expect(waiting).not.toContain("Old trip");
  expect(waiting).not.toContain("Bicycle");

  // The option turned off: no longer waited for. Refused while lines pay it back, with the call
  // that detaches them.
  expect(await subjects({ action: "edit", subject: "Gift pool", payback_from: null })).toContain(
    "Changed the subject Gift pool.",
  );
  expect(await subjects({ action: "list", waiting: true })).not.toContain("Gift pool");

  const kept = await refusal("subjects", {
    action: "edit",
    subject: "Shared holiday",
    payback_from: null,
  });

  expect(kept).toContain('Lines pay "Shared holiday" back: detach them first');
  expect(kept).toContain(
    `A valid call: subjects {"action":"attach_payback","subject":"Shared holiday","lines":["${await handleOf("VIR SAM EXAMPLE")}"],"remove":true}`,
  );
});

test("a refused line gets its error, with the call that helps", async ({
  page,
  app,
  user,
  mcpClientId,
}) => {
  const { subjects, handleOf, refusal } = await paybackUser(
    page,
    app,
    user,
    mcpClientId,
    "octave",
    [
      [`${TWO_MONTHS_AGO}-03`, -40_000, "CB LAKE CABIN"],
      [`${LAST_MONTH}-02`, 15_000, "VIR SAM EXAMPLE"],
      [`${LAST_MONTH}-02`, -15_000, "TO EVERYDAY", "Savings book"],
    ],
  );

  await subjects({ action: "create", name: "Shared holiday", payback_from: "Sam Example" });
  await subjects({ action: "create", name: "Water damage", payback_from: "Example Insurance" });
  await subjects({ action: "create", name: "Bicycle" });

  const cabin = await handleOf("CB LAKE CABIN");
  const share = await handleOf("VIR SAM EXAMPLE");

  // Money going out is an expense of the subject, never what pays it back.
  const out = await refusal("subjects", {
    action: "attach_payback",
    subject: "Shared holiday",
    lines: [cabin],
  });

  expect(out).toContain("is money going out: only money coming in pays a subject back.");
  expect(out).toContain(
    `A valid call: subjects {"action":"attach","subject":"Shared holiday","lines":["${cabin}"]}`,
  );

  // A subject without the option: the call that turns it on.
  const plain = await refusal("subjects", {
    action: "attach_payback",
    subject: "Bicycle",
    lines: [share],
  });

  expect(plain).toContain('"Bicycle" is not paid back by anyone');
  expect(plain).toContain(
    'A valid call: subjects {"action":"edit","subject":"Bicycle","payback_from":"Example Corp"}',
  );

  // A line that pays back another subject: the exact call that detaches it from that one.
  await subjects({ action: "attach_payback", subject: "Shared holiday", lines: [share] });

  const other = await refusal("subjects", {
    action: "attach_payback",
    subject: "Water damage",
    lines: [share],
  });

  expect(other).toContain('pays back "Shared holiday" already');
  const detach = `A valid call: subjects {"action":"attach_payback","subject":"Shared holiday","lines":["${share}"],"remove":true}`;

  expect(other).toContain(detach);

  // What would touch a payback line in lines is refused with the same call.
  expect(await refusal("lines", { action: "link", line: share, into: cabin })).toContain(detach);
  expect(
    await refusal("lines", {
      action: "split",
      line: share,
      shares: [{ category: "Other", amount: "150" }],
    }),
  ).toContain(detach);
  expect(
    await refusal("lines", { action: "pair", line: share, other: await handleOf("TO EVERYDAY") }),
  ).toContain(detach);

  const classified = await refusal("lines", {
    action: "classify",
    line: share,
    kind: "income",
  });

  expect(classified).toContain("This line pays back a subject, which classifies it");
  expect(classified).toContain(detach);

  // An unknown handle.
  expect(
    await refusal("subjects", {
      action: "attach_payback",
      subject: "Water damage",
      lines: ["00000000-0000-4000-8000-000000000000"],
    }),
  ).toContain('No line of the user\'s has the handle "00000000-0000-4000-8000-000000000000"');
});

test("a line with a receipt lists it through a real MCP client", async ({
  page,
  app,
  user,
  mcpClientId,
}) => {
  const { answer, handleOf } = await paybackUser(page, app, user, mcpClientId, "quentin", [
    [`${LAST_MONTH}-08`, 91_450, "VIR EXAMPLE CONSULTING NOTE DE FRAIS"],
    [`${LAST_MONTH}-09`, -2500, "CB CORNER CAFE"],
  ]);

  const line = await handleOf("VIR EXAMPLE CONSULTING NOTE DE FRAIS");

  // Attached in the browser, as the line's page does: MCP carries no bytes.
  const sent = await page.request.post(
    `${app.baseURL}/api/lines/${line}/receipts?${new URLSearchParams({ name: "expense-report.pdf" }).toString()}`,
    {
      headers: { "Content-Type": "application/octet-stream" },
      data: Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(2491, 0x20)]),
    },
  );

  expect(sent.status(), await sent.text()).toBe(200);

  const shown = await answer("lines", { action: "show", line });

  expect(shown).toContain(
    "Receipts (1), the first attached first. MCP carries no file: the user opens or downloads one in Gousset, signed in, from this line or its subject's page (all of a subject's in one zip), or at its address:",
  );
  expect(shown).toMatch(
    /\n- expense-report\.pdf, PDF, 2\.5 KB, attached on \d{4}-\d{2}-\d{2}: http\S+\/api\/receipts\/[\da-f-]{36}\n/,
  );
  expect(shown).not.toContain("%PDF");

  // A line of none says nothing of them.
  expect(
    await answer("lines", { action: "show", line: await handleOf("CB CORNER CAFE") }),
  ).not.toContain("Receipts");
});

test("attach_payback refused to a read-only token", async ({ page, app, user, mcpClientId }) => {
  const { call } = await paybackUser(
    page,
    app,
    user,
    mcpClientId,
    "pauline",
    [[`${LAST_MONTH}-02`, 15_000, "VIR SAM EXAMPLE"]],
    allowReadOnly,
  );

  const writes: ReadonlyArray<Arguments> = [
    {
      action: "attach_payback",
      subject: "Shared holiday",
      lines: ["00000000-0000-4000-8000-000000000000"],
    },
    { action: "create", name: "Shared holiday", payback_from: "Sam Example" },
  ];

  for (const args of writes) {
    const refused = await call("subjects", args);

    expect(refused.isError, refused.text).toBe(true);
    expect(refused.text).toContain("choose Read and write on Gousset's consent page");
  }

  expect((await call("subjects", { action: "list", waiting: true })).isError).toBe(false);
});
