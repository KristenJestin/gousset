import type { Page } from "@playwright/test";

import { hasUser } from "../src/database";
import { onPhone } from "../src/frame";
import { animationsDone, expect, expectAccessible, test, visit } from "../src/test";

// The scenarios of issue #103, "How to verify": an action's form opens in a dialog, not inline in
// the page. Settings › Users is the first: a button beside the list's title opens creating a user.

const listed = (page: Page, email: string) =>
  page.getByRole("main").getByRole("listitem").filter({ hasText: email });

test("creating a user through the dialog closes it and the list shows the new user", async ({
  userPage,
  app,
}) => {
  await visit(userPage, "/settings/users");

  const open = userPage.getByRole("button", { name: "Create a user" });
  const dialog = userPage.getByRole("dialog", { name: "Create a user" });

  // The page shows the list; the form is not in it.
  await expect(userPage.getByLabel("Temporary password")).toHaveCount(0);

  await open.click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription(
    "They will choose their own password at their first sign-in.",
  );

  // Once it has come in: on a phone, a sheet along the bottom edge, the screen's whole width.
  await animationsDone(userPage);

  if (onPhone(userPage)) {
    const box = await dialog.boundingBox();
    const viewport = userPage.viewportSize();

    // A classic scrollbar may take a few pixels of the width.
    expect(box?.x).toBe(0);
    expect(box?.width ?? 0).toBeGreaterThan((viewport?.width ?? 0) - 20);
    expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(viewport?.height);
  }

  await expectAccessible(userPage);

  await dialog.getByLabel("Name").fill("Lin Example");
  await dialog.getByLabel("E-mail").fill("lin@example.com");
  await dialog.getByLabel("Temporary password").fill("lin-temporary-e2e");
  await dialog.getByRole("button", { name: "Create the user" }).click();

  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
  await expect(listed(userPage, "lin@example.com")).toContainText("Lin Example");
  await expect(listed(userPage, "lin@example.com")).toContainText("Temporary password");
  await expect(userPage.getByRole("main").locator('[role="status"]')).toHaveText(
    "Lin Example can now sign in with the temporary password.",
  );
  expect(await hasUser(app.database, "lin@example.com")).toBe(true);
});

test("creating a user from the keyboard alone; focus goes back to the button when the dialog closes", async ({
  userPage,
  app,
}) => {
  await visit(userPage, "/settings/users");

  const open = userPage.getByRole("button", { name: "Create a user" });
  const dialog = userPage.getByRole("dialog", { name: "Create a user" });

  // Escape closes it, nothing sent, focus back on the button.
  await open.focus();
  await userPage.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await userPage.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();

  // Cancel too.
  await userPage.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).focus();
  await userPage.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();

  // Then the whole form, field after field, sent with Enter.
  await userPage.keyboard.press("Enter");
  await expect(dialog).toBeVisible();

  const name = dialog.getByLabel("Name");

  // Reading starts at the title; Tab reaches the close button, then the first field, focus never
  // leaving the dialog.
  for (let step = 0; step < 2; step += 1) {
    await userPage.keyboard.press("Tab");
    await expect(dialog.locator(":focus")).toHaveCount(1);
  }

  await expect(name).toBeFocused();
  await userPage.keyboard.type("Kai Example");
  await userPage.keyboard.press("Tab");
  await expect(dialog.getByLabel("E-mail")).toBeFocused();
  await userPage.keyboard.type("kai@example.com");
  await userPage.keyboard.press("Tab");
  await expect(dialog.getByLabel("Temporary password")).toBeFocused();
  await userPage.keyboard.type("kai-temporary-e2e");
  await userPage.keyboard.press("Enter");

  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
  await expect(listed(userPage, "kai@example.com")).toContainText("Kai Example");
  expect(await hasUser(app.database, "kai@example.com")).toBe(true);
});
