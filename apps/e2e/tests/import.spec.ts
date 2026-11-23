import { writeFile } from "node:fs/promises";
import { basename } from "node:path";

import type { Page } from "@playwright/test";
import { account } from "@gousset/db/schema/ledger";
import { exampleStatement } from "@gousset/fixture";

import { addUser } from "../src/auth";
import type { TestUser } from "../src/auth";
import { expect, test, visit } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #20, the import screen (docs/wireframes, `import`): files dropped are imported in the
// background, their steps followed live, their summary shown; the same file again adds nothing,
// a file that names no account asks for it, and an import can be undone. Each test has a user of
// its own, so that no other test's lines meet the example statement.

const ACCOUNT = "Everyday account";

async function importer(
  app: { baseURL: string; database: string; slot: number },
  admin: TestUser,
  name: string,
  withIban: boolean,
): Promise<TestUser> {
  const person = await addUser(app.baseURL, admin, {
    name: "Robin Example",
    email: `robin.${name}.worker${app.slot}@example.com`,
    password: `e2e-robin-password-${app.slot}`,
  });

  const data = openUserData(app.database);

  try {
    const owner = await data.ownerOf(person.email);

    await data.asUser(owner, (transaction) =>
      transaction.insert(account).values({
        userId: owner,
        name: ACCOUNT,
        kind: "current",
        currency: "EUR",
        iban: withIban ? exampleStatement.account.iban : null,
      }),
    );
  } finally {
    await data.close();
  }

  return person;
}

const drop = (page: Page, path: string) =>
  page.locator('[data-slot="file-drop-input"]').setInputFiles(path);

/** A file's summary, by its name. */
const summaryOf = (page: Page, file: string) =>
  page.getByRole("region", { name: `What ${file} brought` });

/** A figure of a summary, as screen readers hear it. */
const figure = (page: Page, file: string, which: "read" | "added" | "known" | "review") =>
  summaryOf(page, file).first().locator(`[data-figure="${which}"] dd .sr-only`);

test("the same file twice adds nothing, and an import can be undone", async ({
  app,
  user,
  page,
  statements,
}) => {
  test.setTimeout(90_000);

  const person = await importer(app, user, "screen", true);
  const file = basename(statements.camt053);

  await page.context().addCookies([...person.cookies]);
  await visit(page, "/import");

  // The file names its account by its IBAN: it goes there, read, deduplicated and saved.
  await drop(page, statements.camt053);
  await expect(summaryOf(page, file)).toBeVisible({ timeout: 30_000 });
  await expect(figure(page, file, "read")).toHaveText("6");
  await expect(figure(page, file, "added")).toHaveText("6");
  await expect(figure(page, file, "known")).toHaveText("0");
  await expect(figure(page, file, "review")).toHaveText("0");
  await expect(page.getByRole("cell", { name: ACCOUNT }).first()).toBeVisible();

  // Again: said at once, and nothing added. The newest import comes first.
  await drop(page, statements.camt053);
  await expect(page.getByRole("status").filter({ hasText: "was already imported" })).toBeVisible();
  await expect(summaryOf(page, file)).toHaveCount(2, { timeout: 30_000 });
  await expect(figure(page, file, "added")).toHaveText("0");
  await expect(figure(page, file, "known")).toHaveText("6");

  await visit(page, "/import");

  // Undoing the first import removes its six lines; the later one overlaps it.
  await summaryOf(page, file).last().getByRole("button", { name: "Undo this import" }).click();
  await expect(page.getByText("Lines removed: 6.", { exact: false })).toBeVisible();
  await expect(page.getByText("Later imports of this account overlap it")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Undone" })).toBeVisible();
});

test("a file that names no account asks for one, then imports into it", async ({
  app,
  user,
  page,
  statements,
}) => {
  test.setTimeout(90_000);

  // Under reduced motion the summary appears at once, its counts already there.
  await page.emulateMedia({ reducedMotion: "reduce" });

  const person = await importer(app, user, "asked", false);
  const file = basename(statements.qif);

  await page.context().addCookies([...person.cookies]);
  await visit(page, "/import");

  await drop(page, statements.qif);
  await expect(page.getByRole("cell", { name: "Account to choose" })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole("combobox", { name: `Account of ${file}` }).click();
  await page.getByRole("option", { name: ACCOUNT }).click();
  await page.getByRole("button", { name: "Import into this account" }).click();

  await expect(summaryOf(page, file)).toBeVisible({ timeout: 30_000 });
  await expect(figure(page, file, "added")).toHaveText("6");
  await expect(summaryOf(page, file)).toHaveCSS("opacity", "1");
});

test("a file of no known format is refused, saying why", async ({ userPage }, testInfo) => {
  await visit(userPage, "/import");

  const notAStatement = testInfo.outputPath("photo.png");

  await writeFile(notAStatement, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  await drop(userPage, notAStatement);
  await expect(
    userPage.getByText("photo.png: Gousset cannot tell this file's format"),
  ).toBeVisible();
});
