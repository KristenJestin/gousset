import type { Page } from "@playwright/test";

import type { TestUser } from "../src/auth";
import { onPhone } from "../src/frame";
import {
  block,
  closeBlock,
  monthBarKey,
  monthSwitcher,
  openBlock,
  seedReviewMonths,
} from "../src/review";
import {
  addUser,
  animationsDone,
  expect,
  expectAccessible,
  fixDay,
  personOfItsOwn,
  slowServerFunctions,
  test,
  visit,
} from "../src/test";
import { openUserData } from "../src/user-data";

// The scenarios of issue #32, "How to verify", on the web: the home reads the user's own month,
// against the built app and a real Postgres. Each user is the file's own (`personOfItsOwn`), their
// September and October 2026 written as the app writes them (`seedReviewMonths`), read on a fixed
// day in November. Every name and amount is invented.

const TODAY = "2026-11-15";
const OCTOBER = "/?month=2026-10";

/** Long enough for the press to come while the month before is still on its way. */
const SLOW_MONTH_MS = 4000;

let data: ReturnType<typeof openUserData>;

test.beforeAll(({ app }) => {
  data = openUserData(app.database);
});

test.afterAll(async () => {
  await data.close();
});

/**
 * A user of the test's own, signed in on `page` on the fixed day, their months seeded unless
 * `empty`.
 */
async function signedInWithMonths(
  page: Page,
  app: { readonly baseURL: string },
  user: TestUser,
  local: string,
  empty = false,
) {
  const person = await addUser(app.baseURL, user, personOfItsOwn(local));

  if (!empty) {
    await seedReviewMonths(data, await data.ownerOf(person.email));
  }

  await page.context().addCookies([...person.cookies]);
  await fixDay(page, TODAY);

  return person;
}

/** A row of "Where the money goes", by its name: a button that opens its detail. */
const spendingRow = (page: Page, name: string) =>
  block(page, "Where the money goes").getByRole("button", { name: new RegExp(`^${name}`) });

/** A digit's roll as the browser was given it: how long it lasts, and whether it moves the digit. */
type Roll = { duration: number; moves: boolean };

/**
 * Presses "Previous month" and returns the rolls started on a digit of a rolling column, from the
 * press until 30 frames after the switcher announces `month`: the digits roll once that month's
 * data is on screen, and the roll lasts 200 ms. Each `KeyframeEffect` Motion creates in that
 * window is recorded, so that none can end unseen on a busy runner; under reduced motion Motion
 * starts none and moves the digit at once.
 */
async function rollsTo(page: Page, month: string) {
  const rolls = page.evaluate(
    ({ columns, announced, after, cap }) =>
      new Promise<Array<Roll>>((resolve) => {
        document.addEventListener(
          "pointerdown",
          () => {
            const Native = window.KeyframeEffect;
            const created: Array<KeyframeEffect> = [];
            const start = performance.now();
            let frames = 0;
            let shownAt: number | null = null;

            Object.defineProperty(window, "KeyframeEffect", {
              configurable: true,
              writable: true,
              value: class extends Native {
                constructor(
                  target: Element | null,
                  keyframes: Array<Keyframe> | PropertyIndexedKeyframes | null,
                  options?: number | KeyframeEffectOptions,
                ) {
                  super(target, keyframes, options);
                  created.push(this);
                }
              },
            });

            const done = () => {
              Object.defineProperty(window, "KeyframeEffect", {
                configurable: true,
                writable: true,
                value: Native,
              });

              resolve(
                created.flatMap((effect) => {
                  if (!effect.target?.closest(columns)) {
                    return [];
                  }

                  const transforms = effect.getKeyframes().map(({ transform }) => transform);

                  return [
                    {
                      duration: Math.round(Number(effect.getTiming().duration)),
                      moves: new Set(transforms).size > 1,
                    },
                  ];
                }),
              );
            };

            const count = () => {
              frames += 1;

              const label = document.querySelector('[data-slot="month-switcher"] [aria-live]');

              if (shownAt === null && label?.textContent?.includes(announced) === true) {
                shownAt = frames;
              }

              if (
                (shownAt !== null && frames - shownAt > after) ||
                performance.now() - start > cap
              ) {
                done();
              } else {
                requestAnimationFrame(count);
              }
            };

            requestAnimationFrame(count);
          },
          { once: true, capture: true },
        );
      }),
    { columns: '[data-slot="rolling-digit"]', announced: month, after: 30, cap: 15_000 },
  );

  await monthSwitcher(page).getByRole("button", { name: "Previous month" }).click();

  return rolls;
}

test("the month bar reads received, spent, set aside and left", async ({ page, app, user }) => {
  await signedInWithMonths(page, app, user, "albane");
  await visit(page, OCTOBER);

  await expect(page.getByRole("heading", { level: 1, name: "Monthly review" })).toBeVisible();
  await expect(monthSwitcher(page)).toContainText("October 2026");

  // The state line: no statement imported (the lines were written by hand), the line to review.
  await expect(page.getByText("0 of 3 accounts imported")).toBeVisible();
  await expect(page.getByRole("link", { name: "1 line to review" })).toHaveAttribute(
    "href",
    "#to-review",
  );

  const month = block(page, "The month");

  await expect(month).toContainText("€2,000");
  await expect(month).toContainText("received");
  // Where it came from: its categories.
  await expect(month).toContainText("Salary");
  await expect(monthBarKey(page, "spent")).toContainText("€155");
  await expect(monthBarKey(page, "saved")).toContainText("€500");
  await expect(monthBarKey(page, "saved")).toContainText("set aside");
  await expect(monthBarKey(page, "left")).toContainText("€1,345");

  // Spent against the average (September alone, €120) and against September.
  const deltas = month.locator('[data-slot="delta"]');

  await expect(deltas).toHaveCount(2);
  await expect(deltas.nth(0)).toContainText("+29%");
  await expect(deltas.nth(0)).toContainText("more than your average");
  await expect(deltas.nth(1)).toContainText("more than September");

  // The dollar account's month, apart, never converted.
  await expect(month).toContainText("In USD: received $0, spent $25, set aside $0, left −$25");
  await animationsDone(page);
});

test("where the money goes by category against the benchmark", async ({ page, app, user }) => {
  await signedInWithMonths(page, app, user, "basile");
  await visit(page, OCTOBER);

  const spending = block(page, "Where the money goes");

  await expect(spending.getByRole("tab", { name: "Categories" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // No subjects yet (v0.5).
  await expect(spending.getByRole("tab")).toHaveCount(2);

  // The largest first; Leisure passed the €40 the user set: ⚠, and read as set.
  const rows = spending.getByRole("tabpanel").getByRole("button");

  await expect(rows.nth(0)).toContainText("Groceries");
  await expect(rows.nth(0)).toContainText("€80");
  await expect(rows.nth(0)).toContainText("benchmark €120");
  await expect(rows.nth(1)).toContainText("Leisure");
  await expect(rows.nth(1)).toContainText("benchmark €40, set");
  await expect(rows.nth(1).locator('[data-slot="breakdown-over"]')).toBeVisible();
  await expect(rows.nth(0).locator('[data-slot="breakdown-over"]')).toHaveCount(0);
  await expect(rows.nth(2)).toContainText("Other");
  await animationsDone(page);
});

test("where the money goes by merchant", async ({ page, app, user }) => {
  await signedInWithMonths(page, app, user, "capucine");
  await visit(page, OCTOBER);

  const spending = block(page, "Where the money goes");

  await spending.getByRole("tab", { name: "Merchants" }).click();

  const panel = spending.getByRole("tabpanel");
  const rows = panel.getByRole("button");

  await expect(rows.nth(0)).toContainText("Greenmarket");
  // The intermediary is what is known of who was paid: named as such.
  await expect(rows.nth(1)).toContainText("via Payflow");
  // The expenses that name no merchant, last.
  await expect(rows.nth(2)).toContainText("No merchant");
  // Merchants have no benchmark: no mark.
  await expect(panel.locator('[data-slot="breakdown-benchmark"]')).toHaveCount(0);
  await animationsDone(page);
});

test("a row's detail compares with the previous month", async ({ page, app, user }) => {
  await signedInWithMonths(page, app, user, "damien");
  await visit(page, OCTOBER);

  await spendingRow(page, "Groceries").click();

  const panel = block(page, "Where the money goes").getByRole("group", { name: "Groceries" });

  await expect(panel).toBeVisible();

  // Its figures: against the average and against September, €120 both.
  const figures = panel.getByRole("list", { name: "Groceries against" }).getByRole("listitem");

  await expect(figures).toHaveCount(2);
  await expect(figures.nth(0)).toContainText("Average");
  await expect(figures.nth(0)).toContainText("€120");
  await expect(figures.nth(1)).toContainText("September");
  await expect(figures.nth(1)).toContainText("33% less than September");

  // Its chart: October day by day, against September.
  await expect(
    panel.getByRole("figure", { name: "Groceries: spending in October, against September" }),
  ).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(spendingRow(page, "Groceries")).toBeFocused();
  await animationsDone(page);
});

// Issue #167, "How to verify": the shared waits see Motion's layout animations, which the page does
// not list. The panel shrinks back into its row by a transform Motion writes at each frame; until it
// ends, the row covers the ones under it, and axe would read them as hidden.
test("a test that closes a shared-layout panel and checks accessibility at once passes, with no per-test wait", async ({
  page,
  app,
  user,
}) => {
  await signedInWithMonths(page, app, user, "lucien");
  await visit(page, OCTOBER);

  await spendingRow(page, "Groceries").click();

  const panel = block(page, "Where the money goes").getByRole("group", { name: "Groceries" });

  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expectAccessible(page);
});

test("the movements of the month", async ({ page, app, user }) => {
  await signedInWithMonths(page, app, user, "eloise");
  await visit(page, OCTOBER);

  const movements = await openBlock(page, "Movements");
  const rows = movements.getByRole("list", { name: "Movements" }).getByRole("listitem");

  // Oldest first: the salary, then the transfer to savings.
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("ACME PAYROLL");
  await expect(rows.nth(0)).toContainText("Everyday account");
  await expect(rows.nth(0)).toContainText("Salary");
  await expect(rows.nth(0)).toContainText("€2,000");
  await expect(rows.nth(1)).toContainText("Everyday account");
  await expect(rows.nth(1)).toContainText("Rainy-day savings");
  await expect(rows.nth(1)).toContainText("€500");
  await closeBlock(page);

  // What it holds, said truthfully beside its title: the money that came in too.
  if (!onPhone(page)) {
    await expect(block(page, "Movements")).toContainText("money in, and between your accounts");
  }

  await animationsDone(page);
});

test("what is flagged", async ({ page, app, user }) => {
  await signedInWithMonths(page, app, user, "fabien");
  await visit(page, OCTOBER);

  const flagged = await openBlock(page, "Flagged");
  const flags = flagged.getByRole("list", { name: "Flagged" });

  // Leisure drifts above the €40 the user set; the accounts were never imported.
  await expect(flags).toContainText("Leisure: €60 spent, above its benchmark of €40");
  await expect(flags).toContainText("Everyday account has no statement imported");
  await closeBlock(page);

  // The recurring payments' calendar, under the flags.
  const calendar = await openBlock(page, "Recurring payments");

  await expect(calendar.locator('[data-slot="recurring-calendar"]')).toBeVisible();
  await closeBlock(page);
  await animationsDone(page);
});

test("the lines to review lead into the review mode", async ({ page, app, user }) => {
  await signedInWithMonths(page, app, user, "gaspard");
  await visit(page, OCTOBER);

  // Last in the page, with its count; the line read only: no approval here.
  const toReview = block(page, "To review");

  await expect(toReview.locator('[data-slot="count"]').first()).toContainText("1");

  const lines = await openBlock(page, "To review");

  await expect(lines.locator('[data-slot="review-line"]')).toHaveCount(1);
  await expect(lines).toContainText("CARD 4417 KIOSK");
  await expect(lines).toContainText("€15.00");
  await expect(lines.getByRole("button", { name: /^Approve/ })).toHaveCount(0);

  await lines.getByRole("link", { name: "Review the month's lines" }).click();
  await expect(page).toHaveURL(/\/operations\?.*review=true/);
  await expect(page).toHaveURL(/month=2026-10/);
  await expect(page.getByRole("heading", { level: 1, name: "Operations" })).toBeVisible();

  // A month with nothing to review has no such block: November is empty.
  await visit(page, "/?month=2026-11");
  await expect(monthSwitcher(page)).toContainText("November 2026");
  await expect(block(page, "Where the money goes")).toBeVisible();
  await expect(block(page, "To review")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /to review/ })).toHaveCount(0);
});

test("changing month keeps the page and moves the figures", async ({ page, app, user }) => {
  await signedInWithMonths(page, app, user, "hortense");

  // No month to come: November is today's, the last.
  await visit(page, "/");
  await expect(monthSwitcher(page)).toContainText("November 2026");
  await expect(monthSwitcher(page).getByRole("button", { name: "Next month" })).toBeDisabled();

  // The first paint is the server's; the browser's calls, September's preload among them, are
  // slowed: the press comes while September is still on its way.
  await slowServerFunctions(page, SLOW_MONTH_MS);
  await visit(page, OCTOBER);

  const spent = monthBarKey(page, "spent");

  await expect(spent).toContainText("€155");

  // Each digit that changes rolls to the new one, moved by its transform over 200 ms.
  const rolls = rollsTo(page, "September 2026");

  // October stays on screen, no skeleton, and so does its name, until September comes.
  await expect(page).toHaveURL(/month=2026-09/);
  await expect(spent).toContainText("€155");
  await expect(monthSwitcher(page)).toContainText("October 2026");
  await expect(page.locator('[role="status"][aria-busy="true"]')).toHaveCount(0);

  expect(await rolls).toContainEqual({ duration: 200, moves: true });
  await expect(monthSwitcher(page)).toContainText("September 2026");
  await expect(spent).toContainText("€120");
  await animationsDone(page);
});

test("under reduced motion, changing month changes the figures without rolling them", async ({
  page,
  app,
  user,
}) => {
  await signedInWithMonths(page, app, user, "ignace");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await visit(page, OCTOBER);

  expect(await rollsTo(page, "September 2026")).toEqual([]);
  await expect(monthBarKey(page, "spent")).toContainText("€120");
  await animationsDone(page);
});

test("a new user is led to the first import", async ({ page, app, user }) => {
  await signedInWithMonths(page, app, user, "joachim", true);
  await visit(page, "/");

  const main = page.getByRole("main");

  await expect(main.getByRole("heading", { level: 1, name: "Monthly review" })).toBeVisible();
  await expect(main.getByText("Your review starts with your first import")).toBeVisible();

  // One empty state, not a page of zeros.
  await expect(block(page, "The month")).toHaveCount(0);
  await expect(main).not.toContainText("€");
  await expect(main.getByRole("link", { name: "Accounts", exact: true })).toHaveAttribute(
    "href",
    "/accounts",
  );

  await main.getByRole("link", { name: "Import a statement" }).click();
  await expect(page).toHaveURL(/\/import$/);
});

test("the review reads on a phone", async ({ page, app, user }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signedInWithMonths(page, app, user, "kenza");
  await visit(page, OCTOBER);

  // The month bar and where the money goes, as they are; the other blocks folded, one line each.
  await expect(block(page, "The month")).toContainText("€155");
  await expect(spendingRow(page, "Groceries")).toBeVisible();

  for (const title of ["Movements", "Flagged", "Recurring payments", "To review"]) {
    await expect(
      block(page, title).getByRole("button", { name: new RegExp(`^${title}`) }),
    ).toBeVisible();
  }

  // A folded block opens in a sheet.
  expect(onPhone(page)).toBe(true);

  const movements = await openBlock(page, "Movements");

  await expect(movements).toContainText("Rainy-day savings");
  await closeBlock(page);

  // Nothing is wider than the screen.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );

  expect(overflow).toBeLessThanOrEqual(0);
  await animationsDone(page);
});
