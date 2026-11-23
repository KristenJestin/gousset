import type { Page } from "@playwright/test";
import { account, statementImport, statementLine } from "@gousset/db/schema/ledger";
import { sql } from "drizzle-orm";
import { Schema } from "effect";

import type { TestUser } from "../src/auth";
import {
  addUser,
  animationsDone,
  expect,
  expectAccessible,
  fixDay,
  personOfItsOwn,
  test,
  visit,
} from "../src/test";
import { openUserData } from "../src/user-data";

// The scenarios of issue #21's operations page, "How to verify", one test each, plus its motions;
// the MCP scenario is lines-mcp.spec.ts. Each user here is the file's own (`personOfItsOwn`), so
// that the counts are known whatever the worker's other specs add to the shared users: Oriane has
// a few invented lines over three accounts, two of them of the same name, and 250 more to page
// through; Basile has 10,000, written by the scrolling test alone; Noémie has none.

const TODAY = "2026-11-15";

/** Lines of Oriane's made to page through: more than one page (200 lines) with the others. */
const PAGED = 250;

/** Every line Oriane has counted: the five below and the paged ones. */
const ORIANE_LINES = 5 + PAGED;

const GREENMARKET = "CB GREENMARKET 10/11";
const STREAMLY = "CB STREAMLY SUBSCRIPTION";
const SALARY = "SEPA TRF ACME CONSULTING SALARY";
const HARDWARE = "CB HARDWARE DEPOT";
const SAVINGS = "TRANSFER TO SAVINGS POT";
const HELD = "CB GREENMARKET 10/11 BIS";
const FILE_NAME = "riverside-2026-11.ofx";

let data: ReturnType<typeof openUserData>;
let oriane: TestUser;
let greenmarketId = "";

test.beforeAll(async ({ app, user }) => {
  data = openUserData(app.database);
  oriane = await addUser(app.baseURL, user, personOfItsOwn("oriane"));

  const owner = await data.ownerOf(oriane.email);

  greenmarketId = await data.asUser(owner, async (each) => {
    const accounts = await each
      .insert(account)
      .values([
        {
          userId: owner,
          name: "Everyday",
          institution: "Riverside Bank",
          kind: "current",
          currency: "EUR",
        },
        {
          userId: owner,
          name: "Everyday",
          institution: "Harbor Credit",
          kind: "current",
          currency: "EUR",
        },
        { userId: owner, name: "Savings pot", kind: "savings", currency: "EUR" },
      ])
      .returning({ id: account.id });

    const [riverside, harbor, pot] = accounts.map((created) => created.id);

    if (riverside === undefined || harbor === undefined || pot === undefined) {
      throw new Error("The accounts were not created.");
    }

    const [imported] = await each
      .insert(statementImport)
      .values({
        userId: owner,
        accountId: riverside,
        fileName: FILE_NAME,
        fileSha256: "e2e-operations-riverside-sha256",
        format: "ofx",
        status: "done",
        periodFrom: "2026-11-01",
        periodTo: "2026-11-14",
      })
      .returning({ id: statementImport.id });

    if (imported === undefined) {
      throw new Error("The import was not created.");
    }

    const [greenmarket] = await each
      .insert(statementLine)
      .values({
        userId: owner,
        accountId: riverside,
        importId: imported.id,
        source: "import",
        bookedOn: "2026-11-10",
        valueOn: "2026-11-11",
        amountMinor: -4250,
        label: GREENMARKET,
        dedupKey: "e2e-operations-greenmarket",
      })
      .returning({ id: statementLine.id });

    if (greenmarket === undefined) {
      throw new Error("The line was not created.");
    }

    const manual = (accountId: string, bookedOn: string, amountMinor: number, label: string) => ({
      userId: owner,
      accountId,
      source: "manual" as const,
      bookedOn,
      amountMinor,
      label,
    });

    await each.insert(statementLine).values([
      manual(riverside, "2026-11-03", -1299, STREAMLY),
      manual(harbor, "2026-10-20", 250_000, SALARY),
      manual(harbor, "2026-10-05", -8000, HARDWARE),
      manual(pot, "2026-09-15", 50_000, SAVINGS),
      // Booked after today: never shown.
      manual(riverside, "2026-11-20", -999, "CB NOT YET BOOKED"),
      {
        ...manual(harbor, "2026-11-10", -4250, HELD),
        state: "held" as const,
        duplicateOfLineId: greenmarket.id,
      },
    ]);

    // 10.00 to 12.49, one a day back from the end of August.
    await each.execute(sql`
      insert into statement_line (user_id, account_id, source, booked_on, amount_minor, label)
      select ${owner}, ${pot}::uuid, 'manual', date '2026-08-31' - i, -(1000 + i),
        'PAGED LINE ' || lpad(i::text, 3, '0')
      from generate_series(0, ${PAGED - 1}) as i`);

    return greenmarket.id;
  });
});

test.afterAll(async () => {
  await data.close();
});

/** The page, signed in as `person`, on the fixed day. */
async function signedInAs(page: Page, person: TestUser) {
  await page.context().addCookies([...person.cookies]);
  await fixDay(page, TODAY);
}

const list = (page: Page) => page.getByRole("list", { name: "Operations" });
const rows = (page: Page) => list(page).getByRole("listitem");
const row = (page: Page, label: string) => rows(page).filter({ hasText: label });
const count = (page: Page) => page.locator('[data-slot="operations-layout"] > p');
const detail = (page: Page, label: string) => page.getByRole("region", { name: label });

/** Once hydrated, the list places its rows itself, from script: the browser runs the page. */
async function hydrated(page: Page) {
  await expect(page.locator('[data-slot="operation-row"][style*="top"]').first()).toBeAttached();
}

const Numbers = Schema.Array(Schema.Number);
const Rendered = Schema.Array(Schema.Struct({ position: Schema.Number, text: Schema.String }));

/** The rows in the page now: their place among all the lines, and their text. */
async function renderedRows(page: Page) {
  return Schema.decodeUnknownSync(Rendered)(
    await page.evaluate(`[...document.querySelectorAll('[data-slot="operation-row"]')].map(
      (row) => ({ position: Number(row.getAttribute("aria-posinset")), text: row.textContent ?? "" }),
    )`),
  );
}

test("on 10,000 lines, scrolling stays smooth", async ({ page, app, user }) => {
  test.setTimeout(120_000);

  const basile = await addUser(app.baseURL, user, personOfItsOwn("basile"));
  const owner = await data.ownerOf(basile.email);

  await data.asUser(owner, async (each) => {
    const accounts = await each
      .insert(account)
      .values(
        ["Basile current", "Basile card", "Basile savings"].map((name) => ({
          userId: owner,
          name,
          kind: "current" as const,
          currency: "EUR",
        })),
      )
      .returning({ id: account.id });

    const [first, second, third] = accounts.map((created) => created.id);

    if (first === undefined || second === undefined || third === undefined) {
      throw new Error("The accounts were not created.");
    }

    // One bulk insert: line i is booked i days before today, so that it is the (i + 1)th row.
    await each.execute(sql`
      insert into statement_line (user_id, account_id, source, booked_on, amount_minor, label)
      select ${owner},
        case i % 3 when 0 then ${first}::uuid when 1 then ${second}::uuid else ${third}::uuid end,
        'manual', date '2026-11-15' - i, -(100 + i), 'E2E BULK LINE ' || lpad(i::text, 5, '0')
      from generate_series(0, 9999) as i`);
  });

  await signedInAs(page, basile);
  await visit(page, "/operations");
  await expect(count(page)).toHaveText("10,000 lines");
  await hydrated(page);

  // Row 3,001 at the top: fifteen pages of 200 lines, read as the list nears its end.
  const target = 3000 * 48;

  // The scroll and the frames are the page's own: the list moves 240 px a frame (five rows, a
  // fast fling), and waits at the end of what is loaded until the next page comes. Each frame's
  // length is the time between two animation frames.
  const frames = Schema.decodeUnknownSync(Numbers)(
    await page.evaluate(`new Promise((resolve, reject) => {
      const scroller = document.querySelector('[data-slot="operations-scroller"]');
      const frames = [];
      const deadline = performance.now() + 90000;
      let last;

      const step = (now) => {
        if (last !== undefined) {
          frames.push(now - last);
        }

        last = now;

        if (scroller.scrollTop >= ${String(target)}) {
          resolve(frames);
        } else if (now > deadline) {
          reject(new Error("The list did not reach row 3,001 in 90 s."));
        } else {
          scroller.scrollTop += 240;
          requestAnimationFrame(step);
        }
      };

      requestAnimationFrame(step);
    })`),
  );

  // Virtualised: a screen of rows and a few around it, not the 3,000 loaded.
  await expect
    .poll(async () => (await renderedRows(page)).some((shown) => shown.position === 3001))
    .toBe(true);

  const shown = await renderedRows(page);

  expect(shown.length).toBeGreaterThan(5);
  expect(shown.length).toBeLessThan(80);

  // Each row is the line of its place: line i, booked i days back, is the (i + 1)th.
  for (const { position, text } of shown) {
    expect(position).toBeGreaterThan(2900);
    expect(text).toContain(`E2E BULK LINE ${String(position - 1).padStart(5, "0")}`);
  }

  // Smooth: no frame of the scroll beyond 250 ms. A frame at 60 Hz is 17 ms and a jank a user
  // feels is over 50 ms; the bound is generous because CI draws without a GPU, on two shared
  // cores that also run the app and Postgres, and a page of 200 rows lands mid-scroll. A list that
  // rendered every loaded row (thousands) takes seconds a frame there, far beyond it.
  expect(frames.length).toBeGreaterThan(100);
  expect(Math.max(...frames)).toBeLessThan(250);
});

test("a search narrows the list", async ({ page }) => {
  // Every search the page puts in its address, in order.
  await page.addInitScript({
    content: `
      window.__e2eSearches = [];
      const replace = history.replaceState.bind(history);

      history.replaceState = (state, unused, url) => {
        const q = new URL(String(url ?? ""), location.href).searchParams.get("q");

        if (q !== null) {
          window.__e2eSearches.push(q);
        }

        return replace(state, unused, url);
      };
    `,
  });

  await signedInAs(page, oriane);
  await visit(page, "/operations");
  await expect(count(page)).toHaveText(`${String(ORIANE_LINES)} lines`);
  await hydrated(page);

  await page.getByRole("searchbox", { name: "Search" }).pressSequentially("greenmarket");

  // After the typing stops, the list keeps the one counted line that matches (the held one is to
  // review, not counted), and the address keeps the search.
  await expect(count(page)).toHaveText("1 line");
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, GREENMARKET)).toBeVisible();
  await expect(page).toHaveURL(/[?&]q=greenmarket(&|$)/);

  // Debounced: the words went to the address once the typing stopped, not at each letter.
  const searches = Schema.decodeUnknownSync(Schema.Array(Schema.String))(
    await page.evaluate("window.__e2eSearches"),
  );

  expect(searches.at(-1)).toBe("greenmarket");
  expect(new Set(searches).size).toBeLessThan("greenmarket".length);

  // The address alone opens the same search.
  await page.reload();
  await expect(page.getByRole("searchbox", { name: "Search" })).toHaveValue("greenmarket");
  await expect(count(page)).toHaveText("1 line");

  // Words that match nothing say so.
  await page.getByRole("searchbox", { name: "Search" }).fill("no such shop");
  await expect(count(page)).toHaveText("0 lines");
  await expect(page.getByText("No line matches these filters.")).toBeVisible();
  await animationsDone(page);
});

test("the account filter narrows the list to that account's lines", async ({ page }) => {
  await signedInAs(page, oriane);
  await visit(page, "/operations");
  await hydrated(page);

  // Two accounts share a name: each is named with its institution.
  await page.getByRole("combobox", { name: "Account" }).click();
  await page.getByRole("option", { name: "Everyday (Harbor Credit)", exact: true }).click();

  await expect(count(page)).toHaveText("2 lines");
  await expect(rows(page)).toHaveCount(2);
  await expect(row(page, SALARY)).toBeVisible();
  await expect(row(page, HARDWARE)).toBeVisible();
  await expect(page).toHaveURL(/[?&]account=[\da-f-]{36}(&|$)/);
  await animationsDone(page);
});

test("the period filter narrows the list to its days, and the older month address still works", async ({
  page,
}) => {
  await signedInAs(page, oriane);
  await visit(page, "/operations?from=2026-10-01&to=2026-10-31");

  await expect(count(page)).toHaveText("2 lines");
  await expect(row(page, SALARY)).toBeVisible();
  await expect(row(page, HARDWARE)).toBeVisible();

  // The review's link names a month: its first to last day.
  await visit(page, "/operations?month=2026-09");
  await expect(page.getByRole("textbox", { name: "From", exact: true })).toHaveValue("09/01/2026");
  await expect(page.getByRole("textbox", { name: "To", exact: true })).toHaveValue("09/30/2026");
  await expect(count(page)).toHaveText("1 line");
  await expect(row(page, SAVINGS)).toBeVisible();

  // A period the server cannot read says so.
  await visit(page, "/operations?from=2026-10-31&to=2026-10-01");
  await expect(page.getByText("This period cannot be read")).toBeVisible();
  await animationsDone(page);
});

test("the amount filter narrows the list to amounts between its bounds", async ({ page }) => {
  await signedInAs(page, oriane);
  await visit(page, "/operations");
  await hydrated(page);

  // Bounds against the amount whatever its sign: 500.00 only, of 42.50, 12.99, 2,500, 80, 500 and
  // the paged 10.00 to 12.49.
  await page.getByRole("textbox", { name: "Amount from", exact: true }).fill("100");
  await page.getByRole("textbox", { name: "Amount up to", exact: true }).fill("600");

  await expect(count(page)).toHaveText("1 line");
  await expect(row(page, SAVINGS)).toBeVisible();
  await expect(page).toHaveURL(/[?&]min=100(&|$)/);
  await expect(page).toHaveURL(/[?&]max=600(&|$)/);

  // An amount the server cannot read is said under its field; the list stays as it was.
  await page.getByRole("textbox", { name: "Amount from", exact: true }).fill("12.5.0");
  await expect(page.getByText("Type an amount as 12.50").first()).toBeVisible();
  await expect(count(page)).toHaveText("1 line");
  await animationsDone(page);
});

test("the to-review filter shows the lines held for review, marked so", async ({ page }) => {
  await signedInAs(page, oriane);
  await visit(page, "/operations");
  await hydrated(page);

  await page.getByRole("checkbox", { name: "To review only" }).click();

  await expect(count(page)).toHaveText("1 line");
  await expect(row(page, HELD)).toContainText("To review");
  await expect(page).toHaveURL(/[?&]review=true(&|$)/);

  // Its detail says which line it looks like.
  await row(page, HELD).getByRole("button").click();
  await expect(detail(page, HELD)).toContainText(`To review: looks like Nov 10, ${GREENMARKET}`);
  await animationsDone(page);
});

test("the cursor pages beyond the first page as you scroll", async ({ page }) => {
  await signedInAs(page, oriane);
  await visit(page, "/operations");
  await hydrated(page);

  const scroller = page.locator('[data-slot="operations-scroller"]');

  // The first page holds 200 lines; the last ones come with the next page, read at the end.
  await expect(list(page).locator(`[aria-posinset="${String(ORIANE_LINES)}"]`)).toHaveCount(0);

  await expect
    .poll(async () => {
      await scroller.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });

      return list(page)
        .locator(`[aria-posinset="${String(ORIANE_LINES)}"]`)
        .count();
    })
    .toBe(1);

  // The oldest line, last.
  await expect(list(page).locator(`[aria-posinset="${String(ORIANE_LINES)}"]`)).toContainText(
    `PAGED LINE ${String(PAGED - 1).padStart(3, "0")}`,
  );
  await animationsDone(page);
});

test("a line opens its detail, Escape closes it, and its address opens it on the first paint", async ({
  page,
}) => {
  await signedInAs(page, oriane);
  await visit(page, "/operations");
  await hydrated(page);

  await row(page, GREENMARKET).getByRole("button").click();

  const panel = detail(page, GREENMARKET);

  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Everyday (Riverside Bank)");
  await expect(panel).toContainText("November 10, 2026");
  await expect(panel).toContainText("November 11, 2026");
  await expect(panel).toContainText(GREENMARKET);
  await expect(panel).toContainText(FILE_NAME);
  await expect(page).toHaveURL(new RegExp(`[?&]line=${greenmarketId}(&|$)`));

  // With a line open, the page is still accessible.
  await animationsDone(page);
  await expectAccessible(page);

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]line=/);
  await expect(row(page, GREENMARKET).getByRole("button")).toBeFocused();

  // The address alone: the server draws the line's detail before any script runs.
  const address = `/operations?line=${greenmarketId}`;
  const rendered = await page.request.get(address);
  const html = await rendered.text();

  expect(rendered.ok()).toBe(true);
  expect(html).toContain('data-slot="line-detail"');
  expect(html).toContain(FILE_NAME);

  await visit(page, address);
  await expect(detail(page, GREENMARKET)).toContainText(FILE_NAME);
  await animationsDone(page);
});

test("a user with no line is told where the lines will come from", async ({ page, app, user }) => {
  const noemie = await addUser(app.baseURL, user, personOfItsOwn("noemie"));

  await signedInAs(page, noemie);
  await visit(page, "/operations");

  await expect(page.getByRole("heading", { level: 1, name: "Operations" })).toBeVisible();
  await expect(page.getByText("No operation yet")).toBeVisible();
});

/**
 * Samples, each animation frame until `window.__e2eStop`, the box of what `selector` finds (the
 * first match whose text holds `text`, when given): its top within the list's scroller, and its
 * height. Install before the action that moves it.
 */
async function sampleBoxes(page: Page, selector: string, text = "") {
  await page.evaluate(`(() => {
    window.__e2eBoxes = [];
    window.__e2eStop = false;

    const sample = () => {
      const found = [...document.querySelectorAll(${JSON.stringify(selector)})].find((element) =>
        (element.textContent ?? "").includes(${JSON.stringify(text)}),
      );
      const scroller = document.querySelector('[data-slot="operations-scroller"]');

      if (found !== undefined && scroller !== null) {
        const box = found.getBoundingClientRect();

        window.__e2eBoxes.push({
          top: Math.round(box.top - scroller.getBoundingClientRect().top),
          height: Math.round(box.height),
        });
      }

      if (!window.__e2eStop) {
        requestAnimationFrame(sample);
      }
    };

    requestAnimationFrame(sample);
  })()`);

  const Boxes = Schema.Array(Schema.Struct({ top: Schema.Number, height: Schema.Number }));

  return {
    read: async () => Schema.decodeUnknownSync(Boxes)(await page.evaluate("window.__e2eBoxes")),
    stop: () => page.evaluate("window.__e2eStop = true"),
  };
}

for (const reduced of [false, true]) {
  const how = reduced ? "under reduced motion, nothing moves" : "it moves";

  test(`motion: the detail opens from its row; ${how}`, async ({ page }) => {
    if (reduced) {
      await page.emulateMedia({ reducedMotion: "reduce" });
    }

    await signedInAs(page, oriane);
    await visit(page, "/operations");
    await hydrated(page);
    await expect(page.locator("html")).toHaveAttribute("data-motion", reduced ? "reduced" : "full");

    const boxes = await sampleBoxes(page, '[data-slot="line-detail"]');

    await row(page, GREENMARKET).getByRole("button").click();

    const panel = detail(page, GREENMARKET);

    await expect(panel).toBeVisible();

    // Its own height, as laid out (`offsetHeight` leaves the motion's transform out); settled
    // once the frames draw it so.
    const final = Schema.decodeUnknownSync(Schema.Number)(
      await panel.evaluate("(element) => element.offsetHeight"),
    );

    await expect
      .poll(async () => Math.abs(((await boxes.read()).at(-1)?.height ?? 0) - final))
      .toBeLessThanOrEqual(1);
    await boxes.stop();

    const smallest = Math.min(...(await boxes.read()).map((box) => box.height));

    if (reduced) {
      // In place at once, at its own size.
      expect(smallest).toBeGreaterThan(final - 1);
    } else {
      // It grew out of its 48 px row: some frame drew it far smaller than it ends.
      expect(smallest).toBeLessThan(final / 2);
    }

    await animationsDone(page);
  });

  test(`motion: the rows slide to their new places on a new search; ${how}`, async ({ page }) => {
    if (reduced) {
      await page.emulateMedia({ reducedMotion: "reduce" });
    }

    await signedInAs(page, oriane);
    await visit(page, "/operations");
    await hydrated(page);
    await expect(page.locator("html")).toHaveAttribute("data-motion", reduced ? "reduced" : "full");

    // The hardware store's row is the fourth (top 144 px); among the card payments, the third (96).
    const boxes = await sampleBoxes(page, '[data-slot="operation-row"]', HARDWARE);

    await page.getByRole("searchbox", { name: "Search" }).fill("CB");
    await expect(count(page)).toHaveText("3 lines");
    await expect.poll(async () => (await boxes.read()).at(-1)?.top).toBe(96);
    await boxes.stop();

    const tops = (await boxes.read()).map((box) => box.top);
    const between = tops.filter((top) => top > 97 && top < 143);

    expect(tops[0]).toBe(144);

    if (reduced) {
      // From one place to the other at once.
      expect(between).toEqual([]);
    } else {
      // Frames drawn on the way.
      expect(between.length).toBeGreaterThan(0);
    }

    await animationsDone(page);
  });
}
