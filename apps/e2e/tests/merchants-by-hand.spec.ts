import type { Locator, Page } from "@playwright/test";
import { merchant } from "@gousset/db/schema/ledger";
import { exampleStatement } from "@gousset/fixture";
import type { StatementLine } from "@gousset/fixture";

import type { TestUser } from "../src/auth";
import { lineDetail, onPhone } from "../src/frame";
import { importsOn, statementFile } from "../src/imports";
import { pngOfSize, solidPng } from "../src/pictures";
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

// Issue #204's pages, "How to verify", in the browser: a merchant made by hand, in its sheet, names
// the next imported lines of its labels; a logo uploaded there shows in the merchants' list, the
// operations and a line's detail, and once removed the avatar of initials is back; a file too
// large, of another type, or a picture in name only, is refused with a message under the logo. The
// server's half is merchant-logo.spec.ts, the MCP door's merchants-mcp.spec.ts; the sheet's motion
// is merchants.spec.ts's. Each test has a user of its own; every name, label and picture is
// invented, the pictures made in code (src/pictures.ts).

const TODAY = "2026-11-15";

/** A hardware shop's card payment, as an invented bank writes it: within OFX's 32 characters. */
const JUNIPER_LABEL = "CB JUNIPER HARDWARE 0311 ELMS";

/** A logo made here: a 64 px square of one green. */
const LOGO = { name: "juniper.png", mimeType: "image/png", buffer: solidPng(64, [40, 110, 80]) };

/** An SVG under a PNG's name and type: the browser lets it through, the server reads its bytes. */
const DISGUISED = {
  name: "juniper.png",
  mimeType: "image/png",
  buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8"/></svg>'),
};

let data: ReturnType<typeof openUserData>;
let imports: ReturnType<typeof importsOn>;

test.beforeAll(({ app }) => {
  data = openUserData(app.database);
  imports = importsOn(data);
});

test.afterAll(async () => {
  await data.close();
});

/** A user of the test's own, with an account of theirs and no line yet. */
async function newcomer(app: { baseURL: string }, admin: TestUser, local: string) {
  const person = await addUser(app.baseURL, admin, personOfItsOwn(local));
  const owner = await data.ownerOf(person.email);

  return { person, owner, accountId: await imports.createAccount(owner, "Everyday") };
}

/** Imports a November statement of `lines` into the account, as the import job runs it. */
async function importLines(
  owner: string,
  accountId: string,
  lines: ReadonlyArray<StatementLine>,
): Promise<void> {
  const imported = await imports.importFile(
    owner,
    accountId,
    // OFX, whose dates read one way: a CSV of days up to the 12th waits to be told which.
    statementFile(
      "ofx",
      { ...exampleStatement, from: "2026-11-01", to: "2026-11-14", lines: [...lines] },
      "everyday-2026-11.ofx",
    ),
  );

  expect(imported.status).toBe("done");
}

const JUNIPER_LINE: StatementLine = {
  bookedOn: "2026-11-03",
  amountMinor: -4290,
  label: JUNIPER_LABEL,
  reference: "JH0311",
};

/** The page, signed in as `person`, on the fixed day. */
async function signedInAs(page: Page, person: TestUser) {
  await page.context().addCookies([...person.cookies]);
  await fixDay(page, TODAY);
}

const merchantList = (page: Page) => page.getByRole("list", { name: "Merchants" });

/** A block of a merchant's page, by its heading: its title block, by the merchant's name. */
const block = (page: Page, title: string) =>
  page
    .locator("section")
    .filter({ has: page.getByRole("heading", { level: 2, name: title, exact: true }) });

/** The logo field of a merchant's sheet: its avatar, its buttons, its file picker. */
const logoField = (sheet: Locator) => sheet.getByRole("group", { name: "Logo" });

/** Picks a file in the logo field, as the file picker gives it. */
async function pickLogo(
  sheet: Locator,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  await logoField(sheet).locator('input[type="file"]').setInputFiles(file);
}

/** An avatar showing the merchant's uploaded logo, drawn by the browser. */
async function expectLogoShown(avatar: Locator): Promise<void> {
  const image = avatar.locator("img");

  await expect(image).toHaveAttribute("src", /^\/api\/merchants\/[^/]+\/logo\?v=[0-9a-f]{16}$/);
  await expect
    .poll(async () => image.evaluate((node: HTMLImageElement) => node.naturalWidth))
    .toBeGreaterThan(0);
  await expect(avatar).not.toHaveAttribute("data-fallback");
}

/** An avatar of initials, no logo; `initials` checked when the test knows the name. */
async function expectInitials(avatar: Locator, initials?: string): Promise<void> {
  await expect(avatar.locator("img")).toHaveCount(0);
  await expect(avatar).toHaveAttribute("data-fallback", "true");

  if (initials !== undefined) {
    await expect(avatar).toHaveText(initials);
  }
}

test("a merchant created by hand names the next imported lines of its labels", async ({
  page,
  app,
  user,
}) => {
  const { person, owner, accountId } = await newcomer(app, user, "juniper.by-hand");

  await signedInAs(page, person);
  await visit(page, "/settings/merchants");

  // No merchant yet: the empty state offers to make one.
  await expect(page.getByText("No merchant yet")).toBeVisible();
  await page.getByRole("button", { name: "New merchant" }).click();

  const sheet = page.getByRole("dialog", { name: "New merchant" });

  await expect(sheet.getByRole("textbox", { name: "Name" })).toBeFocused();
  await sheet.getByRole("textbox", { name: "Name" }).fill("Juniper Tools");

  // The bank's label, as the statements write it; Enter adds it, and never sends the form.
  const labels = sheet.getByRole("textbox", { name: "Labels" });

  await labels.fill(JUNIPER_LABEL);
  await labels.press("Enter");
  await expect(sheet.getByRole("list", { name: "Labels" }).getByRole("listitem")).toHaveText([
    JUNIPER_LABEL,
  ]);
  await expect(sheet).toBeVisible();

  // Its colour, picked rather than the automatic one.
  await sheet.getByRole("radio", { name: "Teal" }).click();
  await expect(logoField(sheet).locator('[data-slot="avatar"]')).toHaveAttribute(
    "data-color",
    "teal",
  );

  // The sheet's new fields, checked with it open.
  await expectAccessible(page);

  await sheet.getByRole("button", { name: "Add the merchant" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("Juniper Tools is added.", { exact: true })).toBeVisible();

  // Its page: its name beside its avatar of initials on its colour, the label it was given.
  await expect(
    page.getByRole("heading", { level: 2, name: "Juniper Tools", exact: true }),
  ).toBeVisible();

  const avatar = block(page, "Juniper Tools").locator('[data-slot="avatar"]');

  await expect(avatar).toHaveAttribute("data-color", "teal");
  await expectInitials(avatar, "JT");
  await expect(page.getByRole("list", { name: "Labels" }).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByText("No line of this merchant yet.")).toBeVisible();

  // The next statement's line with that label is its, not a merchant recognised anew.
  await importLines(owner, accountId, [JUNIPER_LINE]);
  await page.reload();
  await expect(block(page, "Latest lines")).toContainText(JUNIPER_LABEL);

  await visit(page, "/settings/merchants");
  await expect(merchantList(page).getByRole("link")).toHaveCount(1);
  await expect(merchantList(page).getByRole("link", { name: /^Juniper Tools / })).toBeVisible();

  // And the line's detail names it.
  await visit(page, "/operations");
  await page
    .getByRole("list", { name: "Operations" })
    .getByRole("button", { name: new RegExp(JUNIPER_LABEL) })
    .click();
  await expect(
    lineDetail(page, JUNIPER_LABEL).locator('[data-slot="line-merchant"]'),
  ).toContainText("Juniper Tools");
  await animationsDone(page);
});

test("an uploaded logo shows in the list and the line's detail; a removed one gives back the avatar", async ({
  page,
  app,
  user,
}) => {
  const { person, owner, accountId } = await newcomer(app, user, "juniper.logo");

  await importLines(owner, accountId, [JUNIPER_LINE]);

  // The merchant the import recognised, the only one, by the name recognition wrote.
  const [recognised] = await data.asUser(owner, (transaction) =>
    transaction.select({ name: merchant.name }).from(merchant),
  );

  const name = recognised?.name ?? "";

  expect(name).not.toBe("");
  await signedInAs(page, person);
  await visit(page, "/settings/merchants");

  const row = merchantList(page).getByRole("link").first();

  await expect(merchantList(page).getByRole("link")).toHaveCount(1);
  await expectInitials(row.locator('[data-slot="avatar"]'));
  await row.click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();

  const sheet = page.getByRole("dialog", { name: `Edit ${name}` });

  // Picked: its preview at once, from the file itself; nothing is sent before Save.
  await pickLogo(sheet, LOGO);
  await expect(logoField(sheet).locator("img")).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect(logoField(sheet).getByRole("button", { name: "Replace" })).toBeVisible();
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText(`${name} is saved.`, { exact: true })).toBeVisible();

  // On its page, in the list, in the operations and in the line's detail.
  await expectLogoShown(block(page, name).locator('[data-slot="avatar"]'));
  await visit(page, "/settings/merchants");
  await expectLogoShown(
    merchantList(page).getByRole("link").first().locator('[data-slot="avatar"]'),
  );

  await visit(page, "/operations");

  const operation = page
    .getByRole("list", { name: "Operations" })
    .getByRole("button", { name: new RegExp(JUNIPER_LABEL) });

  await expectLogoShown(operation.locator('[data-slot="avatar"]'));
  await operation.click();

  const said = lineDetail(page, JUNIPER_LABEL).locator('[data-slot="line-merchant"]');

  await expect(said).toContainText(name);
  await expectLogoShown(said.locator('[data-slot="avatar"]'));
  await page.keyboard.press("Escape");

  // Removed: its initials are back everywhere it is named.
  await visit(page, "/settings/merchants");
  await merchantList(page).getByRole("link").first().click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await logoField(sheet).getByRole("button", { name: "Remove" }).click();
  await expect(logoField(sheet).locator("img")).toHaveCount(0);
  await expect(logoField(sheet).getByRole("button", { name: "Choose a file" })).toBeVisible();
  await sheet.getByRole("button", { name: "Save", exact: true }).click();
  await expect(sheet).toBeHidden();

  await expectInitials(block(page, name).locator('[data-slot="avatar"]'));
  await visit(page, "/settings/merchants");
  await expectInitials(
    merchantList(page).getByRole("link").first().locator('[data-slot="avatar"]'),
  );

  await visit(page, "/operations");
  await page
    .getByRole("list", { name: "Operations" })
    .getByRole("button", { name: new RegExp(JUNIPER_LABEL) })
    .click();
  await expectInitials(
    lineDetail(page, JUNIPER_LABEL).locator('[data-slot="line-merchant"] [data-slot="avatar"]'),
  );
  await animationsDone(page);
});

test("a logo too large or of another type is refused with a message, and the merchant keeps its avatar", async ({
  page,
  app,
  user,
}) => {
  const { person } = await newcomer(app, user, "juniper.refused");

  await signedInAs(page, person);
  await visit(page, "/settings/merchants");
  await page.getByRole("button", { name: "New merchant" }).click();

  const sheet = page.getByRole("dialog", { name: "New merchant" });
  const field = logoField(sheet);

  await sheet.getByRole("textbox", { name: "Name" }).fill("Juniper Tools");

  // One byte over 256 KiB: refused before a byte is sent, said under the field.
  await pickLogo(sheet, { ...LOGO, buffer: pngOfSize(256 * 1024 + 1) });
  await expect(field).toHaveAccessibleDescription(
    /This picture is over 256 KB: choose a smaller one\./,
  );
  await expect(field.locator("img")).toHaveCount(0);

  // Not a picture at all.
  await pickLogo(sheet, {
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Juniper Tools, made up."),
  });
  await expect(field).toHaveAccessibleDescription(
    /This file is not a PNG, JPEG or WebP picture: choose one of these\./,
  );

  // A picture in name only: let through here, refused by the server, which reads its bytes. The
  // merchant is made all the same: the sheet becomes its edit, and says so under the logo.
  await pickLogo(sheet, DISGUISED);
  await sheet.getByRole("button", { name: "Add the merchant" }).click();

  const edit = page.getByRole("dialog", { name: "Edit Juniper Tools" });

  await expect(edit).toBeVisible();
  await expect(logoField(edit)).toHaveAccessibleDescription(
    /Juniper Tools is saved, without this logo\. This file is not a PNG, JPEG or WebP picture: choose one of these\./,
  );
  await expect(edit.getByRole("button", { name: "Save", exact: true })).toBeVisible();

  // Closed, the list behind holds it, with its avatar of initials.
  await page.keyboard.press("Escape");
  await expect(edit).toBeHidden();
  await expectInitials(
    merchantList(page)
      .getByRole("link", { name: /^Juniper Tools / })
      .locator('[data-slot="avatar"]'),
    "JT",
  );
});

test("the merchant's sheet opens from the right on a desktop, along the bottom on a phone, and Cancel sends nothing", async ({
  page,
  app,
  user,
}) => {
  const { person } = await newcomer(app, user, "juniper.sheet");

  await signedInAs(page, person);
  await visit(page, "/settings/merchants");

  const trigger = page.getByRole("button", { name: "New merchant" });

  await trigger.click();

  // docs/design.md, "Actions and forms": a long form is a side `Sheet`, never a form in the page.
  const sheet = page.getByRole("dialog", { name: "New merchant" });

  await expect(sheet).toHaveAttribute("data-side", onPhone(page) ? "bottom" : "right");
  await expect(sheet.getByRole("button", { name: /^(Cancel|Add the merchant)$/ })).toHaveText([
    "Cancel",
    "Add the merchant",
  ]);
  await sheet.getByRole("textbox", { name: "Name" }).fill("Juniper Tools");
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(sheet).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.getByText("No merchant yet")).toBeVisible();
});
