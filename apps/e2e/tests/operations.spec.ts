import type { Locator, Page } from "@playwright/test";
import { account, statementImport, statementLine } from "@gousset/db/schema/ledger";
import { sql } from "drizzle-orm";
import { Schema } from "effect";

import type { TestUser } from "../src/auth";
import { onPhone } from "../src/frame";
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
// through; Basile has 10,000, written once per worker by the first test that needs them; Noémie
// has none.

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
const count = (page: Page) => page.locator('[data-slot="operations-count"]');

// A line's detail: a panel beside the list on a wide screen, a sheet on a phone.
const detail = (page: Page, label: string) =>
  page.getByRole(onPhone(page) ? "dialog" : "region", { name: label });

/**
 * Runs `act` on the filters' fields: on a wide screen, those of the filter row; on a phone, those of
 * the Filters sheet (#127), opened first and closed after, so that the list is in sight again.
 */
async function inFilters(page: Page, act: (fields: Locator) => Promise<void>) {
  const button = page.getByRole("button", { name: /^Filters/ });

  if (!(await button.isVisible())) {
    await act(page.getByRole("group", { name: "Filters" }));

    return;
  }

  await expect(button).toHaveAttribute("data-hydrated", "");
  await button.click();

  const sheet = page.getByRole("dialog", { name: "Filters" });

  await expect(sheet).toBeVisible();
  await act(sheet);
  await sheet.getByRole("button", { name: /^Show / }).click();
  await expect(sheet).toHaveCount(0);
}

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

/** Every 500th of Basile's lines, from the eighth: twenty lines whose label carries the word. */
const ORCHARD = "ORCHARD";
const ORCHARD_LINES = 20;

let basileOnce: Promise<TestUser> | undefined;

/**
 * Basile and his 10,000 lines, made once per worker (the app and its database are the worker's):
 * line i is booked i days before today, so that it is the (i + 1)th row; every 500th, from i = 7,
 * also says `ORCHARD`.
 */
function basileWithTenThousandLines(baseURL: string, admin: TestUser): Promise<TestUser> {
  basileOnce ??= writeBasile(baseURL, admin);

  return basileOnce;
}

async function writeBasile(baseURL: string, admin: TestUser): Promise<TestUser> {
  const basile = await addUser(baseURL, admin, personOfItsOwn("basile"));
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

    // One bulk insert.
    await each.execute(sql`
      insert into statement_line (user_id, account_id, source, booked_on, amount_minor, label)
      select ${owner},
        case i % 3 when 0 then ${first}::uuid when 1 then ${second}::uuid else ${third}::uuid end,
        'manual', date '2026-11-15' - i, -(100 + i),
        'E2E BULK LINE ' || lpad(i::text, 5, '0')
          || case when i % 500 = 7 then ' ' || ${ORCHARD}::text else '' end
      from generate_series(0, 9999) as i`);
  });

  return basile;
}

test("on 10,000 lines, scrolling stays smooth", async ({ page, app, user }) => {
  test.setTimeout(120_000);

  const basile = await basileWithTenThousandLines(app.baseURL, user);

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

test("on 10,000 lines, a search narrows the list", async ({ page, app, user }) => {
  test.setTimeout(120_000);

  const basile = await basileWithTenThousandLines(app.baseURL, user);

  await signedInAs(page, basile);
  await visit(page, "/operations");
  await expect(count(page)).toHaveText("10,000 lines");
  await hydrated(page);

  const typed = Date.now();

  await page.getByRole("searchbox", { name: "Search" }).fill("orchard");

  // Within 5 s of the typing, on CI's two shared cores: the 300 ms wait for the typing to stop,
  // then one search of 10,000 lines. A search that read every line into the page would not.
  await expect(count(page)).toHaveText(`${String(ORCHARD_LINES)} lines`, { timeout: 5000 });
  expect(Date.now() - typed).toBeLessThan(5000);

  // Exactly those lines, newest first: line 7, then every 500th after it.
  await expect
    .poll(async () => (await renderedRows(page)).every((shown) => shown.text.includes(ORCHARD)))
    .toBe(true);

  const shown = await renderedRows(page);

  expect(shown.length).toBeGreaterThan(0);

  for (const { position, text } of shown) {
    expect(position).toBeLessThanOrEqual(ORCHARD_LINES);
    expect(text).toContain(
      `E2E BULK LINE ${String(7 + (position - 1) * 500).padStart(5, "0")} ${ORCHARD}`,
    );
  }

  // The address keeps the search, and opens it again.
  await expect(page).toHaveURL(/[?&]q=orchard(&|$)/);
  await page.reload();
  await expect(page.getByRole("searchbox", { name: "Search" })).toHaveValue("orchard");
  await expect(count(page)).toHaveText(`${String(ORCHARD_LINES)} lines`);
  await animationsDone(page);
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
  await inFilters(page, async (fields) => {
    await fields.getByRole("combobox", { name: "Account" }).click();
    await page.getByRole("option", { name: "Everyday (Harbor Credit)", exact: true }).click();
  });

  await expect(count(page)).toHaveText("2 lines");
  await expect(rows(page)).toHaveCount(2);
  await expect(row(page, SALARY)).toBeVisible();
  await expect(row(page, HARDWARE)).toBeVisible();
  // Money in carries its plus, money out its minus: the direction reads without the colour.
  await expect(row(page, SALARY)).toContainText("+€2,500.00");
  await expect(row(page, HARDWARE)).toContainText("−€80.00");
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
  await inFilters(page, async (fields) => {
    await expect(fields.getByRole("textbox", { name: "From", exact: true })).toHaveValue(
      "09/01/2026",
    );
    await expect(fields.getByRole("textbox", { name: "To", exact: true })).toHaveValue(
      "09/30/2026",
    );
  });
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
  await inFilters(page, async (fields) => {
    await fields.getByRole("textbox", { name: "Amount from", exact: true }).fill("100");
    await fields.getByRole("textbox", { name: "Amount up to", exact: true }).fill("600");
  });

  await expect(count(page)).toHaveText("1 line");
  await expect(row(page, SAVINGS)).toBeVisible();
  await expect(page).toHaveURL(/[?&]min=100(&|$)/);
  await expect(page).toHaveURL(/[?&]max=600(&|$)/);

  // An amount the server cannot read is said under its field; the list stays as it was.
  await inFilters(page, async (fields) => {
    await fields.getByRole("textbox", { name: "Amount from", exact: true }).fill("12.5.0");
  });
  await expect(page.getByText("Type an amount as 12.50").first()).toBeVisible();
  await expect(count(page)).toHaveText("1 line");
  await animationsDone(page);
});

test("the to-review filter shows the lines held for review, marked so", async ({ page }) => {
  await signedInAs(page, oriane);
  await visit(page, "/operations");
  await hydrated(page);

  await inFilters(page, async (fields) => {
    await fields.getByRole("checkbox", { name: "To review only" }).click();
  });

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

test("on a phone, a line opened from its address leaves the rows in sight, then shows as a sheet that does not rise", async ({
  browser,
  page,
  app,
}) => {
  const phone = { width: 390, height: 844 };
  const address = `/operations?line=${greenmarketId}`;

  // The server's first paint, before any script: the list whole, no column squeezing it.
  const still = await browser.newContext({
    javaScriptEnabled: false,
    viewport: phone,
    locale: "en-US",
    timezoneId: "Europe/Paris",
  });

  const first = await still.newPage();

  await still.addCookies([...oriane.cookies]);
  await fixDay(first, TODAY);
  await first.goto(`${app.baseURL}${address}`);
  await expect(row(first, GREENMARKET)).toBeVisible();
  await expect(row(first, STREAMLY)).toBeVisible();
  await expect(first.locator('[data-slot="operations-detail"]')).toBeHidden();
  await still.close();

  // Once the page runs, the detail is a sheet, in its place from its first frame.
  await page.setViewportSize(phone);
  await signedInAs(page, oriane);
  await page.goto(address);

  const sheet = page.getByRole("dialog", { name: GREENMARKET });

  await expect(sheet).toContainText(FILE_NAME);
  // Nothing moves it: each animation found is named, so that a failure says what moved.
  expect(
    await sheet.evaluate((node) =>
      node
        .getAnimations()
        .map((animation) =>
          "transitionProperty" in animation
            ? String(animation.transitionProperty)
            : animation.constructor.name,
        ),
    ),
  ).toEqual([]);
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

/**
 * Samples, each animation frame until `window.__e2eStop`, the detail beside the list: its
 * column's width from the column's first frame, its content's opacity (`null` while the content is
 * not there yet: the column can open around the detail's skeleton first, and Firefox was seen to have
 * it halfway open by the content's first frame), and whether the panel or its content carries a
 * scale. Install before the press that opens it.
 */
async function sampleColumn(page: Page) {
  await page.evaluate(`(() => {
    window.__e2eColumn = [];
    window.__e2eStop = false;

    const scaled = (element) => {
      if (element === null) {
        return false;
      }

      const style = getComputedStyle(element);
      const matrix = new DOMMatrixReadOnly(style.transform === "none" ? undefined : style.transform);

      return Math.abs(matrix.a - 1) > 0.001 || Math.abs(matrix.d - 1) > 0.001 ||
        (style.scale !== "none" && style.scale !== "1");
    };

    const sample = () => {
      const column = document.querySelector('[data-slot="operations-detail"]');
      const content = document.querySelector('[data-slot="line-detail-content"]');

      if (column !== null) {
        const widthTransition = column.getAnimations().find((each) => each.transitionProperty === "width");

        window.__e2eColumn.push({
          debugNow: Math.round(performance.now()),
          debugTimeline: Math.round(document.timeline.currentTime ?? -1),
          debugInserted: window.__e2eInserted ?? null,
          debugStart: widthTransition === undefined ? "none" : widthTransition.startTime === null ? "null" : Math.round(widthTransition.startTime),
          debugCurrent: widthTransition === undefined ? "none" : widthTransition.currentTime === null ? "null" : Math.round(widthTransition.currentTime),
          debugPending: widthTransition === undefined ? "none" : widthTransition.pending,
          width: Math.round(column.getBoundingClientRect().width),
          opacity: content === null ? null : Number(getComputedStyle(content).opacity),
          scaled: scaled(document.querySelector('[data-slot="line-detail"]')) || scaled(content),
        });
      }

      if (!window.__e2eStop) {
        requestAnimationFrame(sample);
      }
    };

    new MutationObserver(() => {
      if (window.__e2eInserted === undefined && document.querySelector('[data-slot="operations-detail"]') !== null) {
        window.__e2eInserted = Math.round(performance.now());
      }
    }).observe(document.body, { childList: true, subtree: true });
    window.__e2eInserted = undefined;
    document.addEventListener("pointerdown", () => { window.__e2ePressed = Math.round(performance.now()); }, { once: true, capture: true });

    requestAnimationFrame(sample);
  })()`);

  const Frames = Schema.Array(
    Schema.Struct({
      width: Schema.Number,
      opacity: Schema.NullOr(Schema.Number),
      scaled: Schema.Boolean,
    }),
  );

  return {
    read: async () => Schema.decodeUnknownSync(Frames)(await page.evaluate("window.__e2eColumn")),
    debug: async () =>
      String(
        await page.evaluate(
          "JSON.stringify({ pressed: window.__e2ePressed, frames: window.__e2eColumn.slice(0, 12) })",
        ),
      ),
    stop: () => page.evaluate("window.__e2eStop = true"),
  };
}

/** The detail's column at its full width: a 16 px gap and the 360 px panel. */
const COLUMN_WIDTH = 376;

for (const reduced of [false, true]) {
  const how = reduced ? "under reduced motion, nothing moves" : "it moves";

  test(`motion: the detail opens beside the list, its width moving, never a scale; ${how}`, async ({
    page,
  }) => {
    test.skip(onPhone(page), "On a phone the detail is a sheet (the next test)");

    if (reduced) {
      await page.emulateMedia({ reducedMotion: "reduce" });
    }

    await signedInAs(page, oriane);
    await visit(page, "/operations");
    await hydrated(page);
    await expect(page.locator("html")).toHaveAttribute("data-motion", reduced ? "reduced" : "full");

    const frames = await sampleColumn(page);

    await row(page, GREENMARKET).getByRole("button").click();
    await expect(detail(page, GREENMARKET)).toBeVisible();
    await expect
      .poll(async () => {
        const last = (await frames.read()).at(-1);

        return last?.width === COLUMN_WIDTH && last.opacity === 1;
      })
      .toBe(true);
    await frames.stop();

    const seen = await frames.read();

    expect(seen.filter((frame) => frame.scaled)).toEqual([]);

    if (reduced) {
      // There at once, whole: the column at its width, the content opaque from its first frame.
      expect(
        seen.filter(
          (frame) =>
            frame.width !== COLUMN_WIDTH || (frame.opacity !== null && frame.opacity !== 1),
        ),
      ).toEqual([]);
    } else {
      // The column widened from far narrower, and the content faded in.
      const debug = await frames.debug();

      console.log(`DEBUG-FRAMES ${debug}`);
      expect(Math.min(...seen.map((frame) => frame.width)), debug).toBeLessThan(COLUMN_WIDTH / 2);
      expect(
        seen.some((frame) => frame.opacity !== null && frame.opacity > 0 && frame.opacity < 1),
      ).toBe(true);
    }

    await animationsDone(page);
  });

  test(`motion: on a phone, the detail is a sheet rising from the bottom; ${how}`, async ({
    page,
  }) => {
    test.skip(!onPhone(page), "On a wide screen the detail opens beside the list");

    if (reduced) {
      await page.emulateMedia({ reducedMotion: "reduce" });
    }

    await signedInAs(page, oriane);
    await visit(page, "/operations");
    await hydrated(page);
    await expect(page.locator("html")).toHaveAttribute("data-motion", reduced ? "reduced" : "full");

    const boxes = await sampleBoxes(page, '[role="dialog"]');

    await row(page, GREENMARKET).getByRole("button").click();

    const sheet = detail(page, GREENMARKET);

    await expect(sheet).toBeVisible();
    await animationsDone(page);

    const rest = (await boxes.read()).at(-1)?.top ?? 0;

    await boxes.stop();

    const below = (await boxes.read()).filter((box) => box.top > rest + 1);

    if (reduced) {
      // In its place at once.
      expect(below).toEqual([]);
    } else {
      // Drawn on its way up from the bottom edge.
      expect(below.length).toBeGreaterThan(1);
    }
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
