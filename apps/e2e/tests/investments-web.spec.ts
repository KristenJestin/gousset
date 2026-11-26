import type { Page } from "@playwright/test";
import { madeUpMonth } from "@gousset/fixture";

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

// Issue #250, part 3: the investments page (docs/wireframes, screen 4), at cost, with operations
// entered, corrected and deleted by hand. Each test has a user of its own, seeded with the made-up
// September and October 2026 (`packages/fixture`), whose Northbank PEA receives a deposit a month,
// buys two ETFs and pays a custody fee; its ISINs are in the country code XX, which no country has.

let data: ReturnType<typeof openUserData>;

test.beforeAll(({ app }) => {
  data = openUserData(app.database);
});

test.afterAll(async () => {
  await data.close();
});

/** The seeded months; the page reads them on a day after both. */
const SEEDED = ["2026-09", "2026-10"];
const TODAY = "2026-11-15";

const WORLD_INDEX = "XX0000000002";

/** A user of the test's own, seeded or not, signed in on `page` on `TODAY`. */
async function personOn(
  page: Page,
  app: { readonly baseURL: string },
  user: Parameters<typeof addUser>[1],
  local: string,
  seeded = true,
) {
  const person = await addUser(app.baseURL, user, personOfItsOwn(local));

  if (seeded) {
    await data.seed(await data.ownerOf(person.email));
  }

  await page.context().addCookies([...person.cookies]);
  await fixDay(page, TODAY);
}

const euros = new Intl.NumberFormat("en", { style: "currency", currency: "EUR" });

/** An amount as the page writes it in English, its minus a true one. */
const eur = (minor: number) => euros.format(minor / 100).replace("-", "−");

/** Ten-thousandths of a unit as the page writes a quantity in English. */
const units = (tenThousandths: number) =>
  new Intl.NumberFormat("en", { maximumFractionDigits: 4 }).format(tenThousandths / 10_000);

/** What the seed put on the PEA: its cash, and the World Index ETF's units and cost. */
function seededPea() {
  const lines = SEEDED.flatMap((month) => madeUpMonth(month).lines).filter(
    (line) => line.accountId === "pea",
  );

  const world = lines.filter(
    (line) => line.operation?.kind === "purchase" && line.operation.isin === WORLD_INDEX,
  );

  return {
    cashMinor: lines.reduce((sum, line) => sum + line.amountMinor, 0),
    worldTenThousandths: world.reduce(
      (sum, line) => sum + Math.round(Number(line.operation?.quantity ?? "0") * 10_000),
      0,
    ),
    worldCostMinor: world.reduce((sum, line) => sum - line.amountMinor, 0),
  };
}

const positions = (page: Page) =>
  page.getByRole("table", { name: "Positions of Northbank PEA, at cost" });

const operations = (page: Page) => page.getByRole("list", { name: "Operations of Northbank PEA" });

/** The page's sentence saying what was done. */
const said = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });

const worldRow = (page: Page) => positions(page).getByRole("row", { name: /World Index ETF/ });

/** Enters a purchase of the World Index ETF through the form. */
async function enterPurchase(
  page: Page,
  values: { quantity: string; unitPrice: string; amount: string; fees?: string; isin?: string },
) {
  await page.getByRole("button", { name: "Add an operation" }).click();

  const dialog = page.getByRole("dialog", { name: "Add an operation" });

  await dialog.getByRole("textbox", { name: "ISIN" }).fill(values.isin ?? WORLD_INDEX);
  await dialog.getByRole("textbox", { name: "Quantity" }).fill(values.quantity);
  await dialog.getByRole("textbox", { name: "Unit price" }).fill(values.unitPrice);
  await dialog.getByRole("textbox", { name: "Amount" }).fill(values.amount);

  if (values.fees !== undefined) {
    await dialog.getByRole("textbox", { name: "Fees" }).fill(values.fees);
  }

  await dialog.getByRole("button", { name: "Add the operation" }).click();

  return dialog;
}

test("the PEA's positions show at cost, with its cash", async ({ page, app, user }) => {
  await personOn(page, app, user, "noemie");
  await visit(page, "/investments");

  const pea = seededPea();
  const figures = page.getByRole("region", { name: "Northbank PEA" });

  await expect(figures).toContainText("PEA");
  await expect(figures).toContainText("Northbank");
  await expect(figures).toContainText(`Cash${eur(pea.cashMinor)}`);

  await expect(worldRow(page)).toContainText(WORLD_INDEX);
  await expect(worldRow(page)).toContainText(units(pea.worldTenThousandths));
  await expect(worldRow(page)).toContainText(eur(pea.worldCostMinor));
  await expect(positions(page).getByRole("row", { name: /Emerging Markets ETF/ })).toBeVisible();
  await expect(positions(page).getByRole("row", { name: /^Cash/ })).toContainText(
    eur(pea.cashMinor),
  );

  // The operations, newest first: the custody fee closes October; the deposit is told apart from
  // the purchases it paid for.
  const listed = operations(page).getByRole("listitem");

  await expect(listed.first()).toHaveAttribute("data-kind", "fee");
  await expect(listed.filter({ hasText: "Deposit" }).first()).toContainText(
    "between your accounts",
  );
  await expect(listed.filter({ hasText: "Purchase" }).first()).toContainText(
    /units of (World Index|Emerging Markets) ETF/,
  );
});

test("a purchase entered by hand updates its position", async ({ page, app, user }) => {
  await personOn(page, app, user, "anatole");
  await visit(page, "/investments");

  const pea = seededPea();

  const dialog = await enterPurchase(page, {
    quantity: "1,5",
    unitPrice: "100",
    amount: "150.99",
    fees: "0.99",
  });

  await expect(dialog).toBeHidden();
  await expect(said(page, "Operation added: Purchase")).toBeVisible();
  await expect(worldRow(page)).toContainText(units(pea.worldTenThousandths + 15_000));
  await expect(worldRow(page)).toContainText(eur(pea.worldCostMinor + 15_099));
  await expect(page.getByRole("region", { name: "Northbank PEA" })).toContainText(
    `Cash${eur(pea.cashMinor - 15_099)}`,
  );

  const entered = operations(page).getByRole("listitem").first();

  await expect(entered).toContainText("Purchase");
  await expect(entered).toContainText("1.5 units of World Index ETF");
  await expect(entered).toContainText(eur(-15_099));
});

test("correcting a purchase and deleting it", async ({ page, app, user }) => {
  await personOn(page, app, user, "berthe");
  await visit(page, "/investments");

  const pea = seededPea();

  await expect(
    await enterPurchase(page, { quantity: "1", unitPrice: "100", amount: "100" }),
  ).toBeHidden();

  const entered = operations(page).getByRole("listitem").first();

  await entered.getByRole("button", { name: "Correct this operation" }).click();

  const correct = page.getByRole("dialog", { name: "Correct the operation" });

  await expect(correct.getByRole("textbox", { name: "Quantity" })).toHaveValue("1");
  await correct.getByRole("textbox", { name: "Quantity" }).fill("2");
  await correct.getByRole("textbox", { name: "Amount" }).fill("200");
  await correct.getByRole("button", { name: "Save" }).click();
  await expect(correct).toBeHidden();

  await expect(said(page, "Operation corrected: Purchase")).toBeVisible();
  await expect(entered).toContainText("2 units of World Index ETF");
  await expect(worldRow(page)).toContainText(units(pea.worldTenThousandths + 20_000));
  await expect(worldRow(page)).toContainText(eur(pea.worldCostMinor + 20_000));

  await entered.getByRole("button", { name: "Delete this operation" }).click();

  const confirm = page.getByRole("alertdialog", { name: "Delete this operation?" });

  await expect(confirm).toContainText(eur(-20_000));
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(confirm).toBeHidden();

  await expect(said(page, "Operation deleted: Purchase")).toBeVisible();
  await expect(worldRow(page)).toContainText(units(pea.worldTenThousandths));
  await expect(worldRow(page)).toContainText(eur(pea.worldCostMinor));
  await expect(operations(page).getByRole("listitem").first()).toHaveAttribute("data-kind", "fee");
});

test("an invalid ISIN is refused in words, under its field", async ({ page, app, user }) => {
  await personOn(page, app, user, "casimir");
  await visit(page, "/investments");

  // The check digit of XX000000000 is 2: a 3 is a typo.
  const dialog = await enterPurchase(page, {
    quantity: "1",
    unitPrice: "100",
    amount: "100",
    isin: "XX0000000003",
  });

  const isin = dialog.getByRole("textbox", { name: "ISIN" });

  await expect(dialog.getByText(/This is not an ISIN/)).toBeVisible();
  await expect(isin).toHaveAttribute("aria-invalid", "true");
  await expectAccessible(page);

  // Typing again takes the refusal away; the right ISIN is accepted.
  await isin.fill(WORLD_INDEX);
  await expect(dialog.getByText(/This is not an ISIN/)).toHaveCount(0);
  await dialog.getByRole("button", { name: "Add the operation" }).click();
  await expect(dialog).toBeHidden();
});

test("the investments page on a phone: the positions and the operations fit its width", async ({
  page,
  app,
  user,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await personOn(page, app, user, "delphine");
  await visit(page, "/investments");

  await expect(worldRow(page)).toBeVisible();
  // On a phone the ISIN goes under the name, and the average cost leaves.
  await expect(positions(page).getByRole("columnheader", { name: "ISIN" })).toBeHidden();
  await expect(positions(page).getByRole("columnheader", { name: "Average cost" })).toBeHidden();
  await expect(worldRow(page).getByText(WORLD_INDEX).filter({ visible: true })).toHaveCount(1);
  await expect(worldRow(page).getByRole("cell", { name: WORLD_INDEX })).toBeHidden();
  await expect(operations(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add an operation" })).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );

  expect(overflow).toBeLessThanOrEqual(0);

  // The form is a sheet along the bottom edge, its whole width.
  await page.getByRole("button", { name: "Add an operation" }).click();

  const dialog = page.getByRole("dialog", { name: "Add an operation" });
  const box = await dialog.boundingBox();

  expect(box?.width).toBe(390);
  await animationsDone(page);
});

test("a user with no investment account is pointed to the accounts page", async ({
  page,
  app,
  user,
}) => {
  await personOn(page, app, user, "eliott", false);
  await visit(page, "/investments");

  await expect(page.getByText("No investment account yet")).toBeVisible();
  await page.getByRole("link", { name: "Go to the accounts" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Accounts" })).toBeVisible();
});

test("the operation just entered slides in, and nothing moves under reduced motion", async ({
  page,
  app,
  user,
}) => {
  await personOn(page, app, user, "fanny");
  await visit(page, "/investments");

  await expect(
    await enterPurchase(page, { quantity: "1", unitPrice: "10", amount: "10" }),
  ).toBeHidden();

  const entered = operations(page).getByRole("listitem").first();

  await expect(entered).toContainText("1 unit of World Index ETF");
  await expect(entered).toHaveCSS("animation-duration", "0.2s");
  await animationsDone(page);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(
    await enterPurchase(page, { quantity: "3", unitPrice: "10", amount: "30" }),
  ).toBeHidden();

  const cut = operations(page).getByRole("listitem").first();

  await expect(cut).toContainText("3 units of World Index ETF");
  await expect(cut).toHaveCSS("animation-duration", "0s");
  await expect(positions(page).getByRole("row").nth(1)).toHaveCSS("animation-duration", "0s");
});
