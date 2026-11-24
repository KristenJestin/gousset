import type { Client } from "@modelcontextprotocol/client";
import type { Page } from "@playwright/test";
import { account, statementLine } from "@gousset/db/schema/ledger";
import { exampleStatement } from "@gousset/fixture";
import type { Statement, StatementLine } from "@gousset/fixture";
import { eq } from "drizzle-orm";

import { addUser } from "../src/auth";
import { importsOn, statementFile } from "../src/imports";
import { connectMcp, expect, test } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #35 through the MCP door: the `review` tool, called by the official MCP client over the
// real OAuth flow, against the built app and a real Postgres. The lines to review come from
// statements imported as the import job runs them, into accounts of the test's own user: a near
// duplicate held, a transfer with two candidates, lines still classified by default. Every amount
// and label is invented.

const allowReadAndWrite = (page: Page) =>
  page.getByRole("button", { name: "Allow read and write" }).click();

const allowReadOnly = (page: Page) => page.getByRole("button", { name: "Allow read only" }).click();

type Arguments = { readonly [key: string]: string | number };

/** The text of a tool's answer, and whether it is an error. */
async function callText(client: Client, name: string, args: Arguments) {
  const result = await client.callTool({ name, arguments: args });
  const [first] = result.content ?? [];

  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}

/** A statement of these lines alone, each with a reference of its own. */
function statementOf(name: string, lines: ReadonlyArray<Omit<StatementLine, "reference">>) {
  const statement: Statement = {
    ...exampleStatement,
    lines: lines.map((line, index) => ({ ...line, reference: `${name}-${index + 1}` })),
  };

  return statement;
}

const STREAMING = { bookedOn: "2026-10-20", amountMinor: -1899, label: "PRLV NIMBUS STREAMING" };
const GYM = { bookedOn: "2026-10-22", amountMinor: -2999, label: "PRLV CITYGYM MEMBERSHIP" };
const GROCER = { bookedOn: "2026-10-09", amountMinor: -4320, label: "CB HARBOR GROCER 0910" };
const TO_SAVINGS = { bookedOn: "2026-10-15", amountMinor: -7000, label: "SEPA TRF TO SAVINGS" };

/** The same payments read again from a CSV: a day later, their labels written otherwise. */
const STREAMING_AGAIN = {
  bookedOn: "2026-10-21",
  amountMinor: -1899,
  label: "NIMBUS STREAMING ABO",
};

const GYM_AGAIN = { bookedOn: "2026-10-23", amountMinor: -2999, label: "CITYGYM MEMBER" };

/** A row of `review list`: its text, the line's handle and the proposal's. */
type Row = { readonly row: string; readonly line: string; readonly proposal: string };

function rowsOf(text: string): ReadonlyArray<Row> {
  return text.split("\n").flatMap((row) => {
    const match = /; line: (\S+); proposal: (\S+)$/.exec(row);

    return match === null ? [] : [{ row, line: match[1] ?? "", proposal: match[2] ?? "" }];
  });
}

/** The row whose label is `label`. */
function rowOf(rows: ReadonlyArray<Row>, label: string): Row {
  const found = rows.find((each) => each.row.includes(`"${label}"`));

  if (found === undefined) {
    throw new Error(`No line "${label}" to review.`);
  }

  return found;
}

test("an MCP client lists the lines to review with their proposals, accepts and corrects them", async ({
  app,
  user,
  page,
  baseURL,
  mcpClientId,
}, testInfo) => {
  // Four imports run here, then the calls.
  test.setTimeout(120_000);

  const reviewer = await addUser(app.baseURL, user, {
    name: "Rae Example",
    email: `rae.review.worker${app.slot}.${testInfo.repeatEachIndex}@example.com`,
    password: `e2e-rae-password-${app.slot}`,
  });

  const data = openUserData(app.database);
  const imports = importsOn(data);

  try {
    const owner = await data.ownerOf(reviewer.email);

    const newAccount = async (name: string, kind: "current" | "savings") => {
      const [created] = await data.asUser(owner, (transaction) =>
        transaction
          .insert(account)
          .values({ userId: owner, name, kind, currency: "EUR" })
          .returning({ id: account.id }),
      );

      if (created === undefined) {
        throw new Error("The account was not created.");
      }

      return created.id;
    };

    const importInto = async (
      accountId: string,
      name: string,
      format: "ofx" | "csv",
      lines: ReadonlyArray<Omit<StatementLine, "reference">>,
    ) => {
      const done = await imports.importFile(
        owner,
        accountId,
        statementFile(format, statementOf(name, lines), `${name}.${format}`),
      );

      expect(done.status, name).toBe("done");

      return done;
    };

    const current = await newAccount("Review current", "current");
    const savingsOne = await newAccount("Review savings one", "savings");
    const savingsTwo = await newAccount("Review savings two", "savings");

    // Two lines may be the other side of the transfer out: the user chooses.
    await importInto(savingsOne, "review-one", "ofx", [
      { bookedOn: "2026-10-16", amountMinor: 7000, label: "SEPA TRF RECEIVED ONE" },
    ]);

    await importInto(savingsTwo, "review-two", "ofx", [
      { bookedOn: "2026-10-14", amountMinor: 7000, label: "SEPA TRF RECEIVED TWO" },
    ]);

    await importInto(current, "review-current", "ofx", [GROCER, TO_SAVINGS, STREAMING, GYM]);

    const again = await importInto(current, "review-again", "csv", [STREAMING_AGAIN, GYM_AGAIN]);

    expect(again).toMatchObject({ linesAdded: 0, linesHeld: 2 });

    await page.context().addCookies([...reviewer.cookies]);

    const session = await connectMcp({
      baseURL: baseURL ?? "",
      page,
      consent: allowReadAndWrite,
      scope: "read write",
      clientId: mcpClientId,
    });

    const review = (args: Arguments) => callText(session.client, "review", args);

    expect(session.client.getInstructions()).toContain("`review`");

    // The queue: every line held, waiting for its transfer, or classified by default.
    const listed = await review({ action: "list" });

    expect(listed.isError, listed.text).toBe(false);
    expect(listed.text).toContain("8 line(s) to review.");

    const rows = rowsOf(listed.text);

    expect(rows).toHaveLength(8);

    const heldStreaming = rowOf(rows, STREAMING_AGAIN.label);
    const heldGym = rowOf(rows, GYM_AGAIN.label);
    const transfer = rowOf(rows, TO_SAVINGS.label);
    const streaming = rowOf(rows, STREAMING.label);
    const grocer = rowOf(rows, GROCER.label);

    expect(heldStreaming.row).toContain(
      `discard it, it repeats the line of ${STREAMING.bookedOn}, -18.99 EUR, "${STREAMING.label}"`,
    );

    expect(heldStreaming.proposal).toBe(streaming.line);
    expect(transfer.row).toContain("pair it as a transfer with the line of 2026-10-1");
    expect(transfer.row).toContain("(1 other candidate: lines show)");
    expect(streaming.row).toContain("keep it in Other");
    expect(grocer.row).toContain("keep it in Other");

    // Accepted: the near duplicate is discarded.
    const discarded = await review({
      action: "accept",
      line: heldStreaming.line,
      proposal: heldStreaming.proposal,
    });

    expect(discarded.isError, discarded.text).toBe(false);
    expect(discarded.text).toContain("is discarded");

    const [held] = await data.asUser(owner, (transaction) =>
      transaction
        .select({ state: statementLine.state })
        .from(statementLine)
        .where(eq(statementLine.id, heldStreaming.line)),
    );

    expect(held?.state).toBe("discarded");

    // Accepted: the transfer is paired with its first candidate; both sides leave the queue.
    const paired = await review({
      action: "accept",
      line: transfer.line,
      proposal: transfer.proposal,
    });

    expect(paired.isError, paired.text).toBe(false);
    expect(paired.text).toContain("is paired as a transfer");

    const shown = await callText(session.client, "lines", { action: "show", line: transfer.line });

    expect(shown.text).toContain(`line: ${transfer.proposal}`);
    expect(shown.text).toContain("paired by the user");

    // Accepted: the line keeps its category, as the user's choice.
    const kept = await review({
      action: "accept",
      line: streaming.line,
      proposal: streaming.proposal,
    });

    expect(kept.isError, kept.text).toBe(false);
    expect(kept.text).toContain("stays in its category, as the user's choice");

    const [done] = await data.asUser(owner, (transaction) =>
      transaction
        .select({ reviewState: statementLine.reviewState })
        .from(statementLine)
        .where(eq(statementLine.id, streaming.line)),
    );

    expect(done?.reviewState).toBe("done");

    // Corrected: the line goes in the category the user names, and a rule is proposed.
    const corrected = await review({ action: "correct", line: grocer.line, category: "Groceries" });

    expect(corrected.isError, corrected.text).toBe(false);
    expect(corrected.text).toContain("is now in Groceries, as the user's choice");
    expect(corrected.text).toContain("propose this rule to the user");

    // Corrected without a category: the held line is kept, counted, and still to review.
    const counted = await review({ action: "correct", line: heldGym.line });

    expect(counted.isError, counted.text).toBe(false);
    expect(counted.text).toContain("is kept: it counts now");

    const after = rowsOf((await review({ action: "list" })).text);
    const lines = after.map((each) => each.line);

    expect(lines).not.toContain(heldStreaming.line);
    expect(lines).not.toContain(transfer.line);
    expect(lines).not.toContain(transfer.proposal);
    expect(lines).not.toContain(streaming.line);
    expect(lines).not.toContain(grocer.line);
    expect(rowOf(after, GYM_AGAIN.label).row).toContain("keep it in Other");

    // A line reviewed already, and a proposal that is not the one listed, are refused.
    const twice = await review({ action: "accept", line: grocer.line, proposal: grocer.proposal });

    expect(twice.isError).toBe(true);
    expect(twice.text).toContain("no longer to review");
    expect(twice.text).toContain('A valid call: review {"action":"list"}');

    const gym = rowOf(after, GYM.label);
    const stale = await review({ action: "accept", line: gym.line, proposal: grocer.line });

    expect(stale.isError).toBe(true);
    expect(stale.text).toContain("proposal changed since it was listed");

    const missing = await review({ action: "correct", line: gym.line });

    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("correct needs category for this line");
  } finally {
    await data.close();
  }
});

test("a token allowed to read only lists the lines to review, and is refused accept and correct", async ({
  userPage,
  baseURL,
  mcpClientId,
}) => {
  const session = await connectMcp({
    baseURL: baseURL ?? "",
    page: userPage,
    consent: allowReadOnly,
    scope: "read write",
    clientId: mcpClientId,
  });

  const listed = await callText(session.client, "review", { action: "list" });

  expect(listed.isError, listed.text).toBe(false);
  expect(listed.text).toMatch(/^\d+ line\(s\) to review\./);

  const writes: ReadonlyArray<Arguments> = [
    { action: "accept", line: "a-handle", proposal: "a-proposal" },
    { action: "correct", line: "a-handle", category: "Groceries" },
  ];

  for (const args of writes) {
    const refused = await callText(session.client, "review", args);

    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("allowed to read only");
  }
});
