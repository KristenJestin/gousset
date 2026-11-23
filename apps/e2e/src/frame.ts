import type { Locator, Page } from "@playwright/test";

/** Below this width the frame shows the tab bar instead of the sidebar (`AppShell`). */
const SIDEBAR_FROM = 768;

/** Whether the page shows the phone's tab bar rather than the sidebar. */
export function onPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? SIDEBAR_FROM) < SIDEBAR_FROM;
}

/**
 * Opens the menu that holds the account's actions: the user's menu in the sidebar (named by who
 * is signed in), or "More" in the phone's tab bar. Returns the open menu.
 */
export async function openAccountMenu(page: Page, userName: string): Promise<Locator> {
  const trigger = onPhone(page)
    ? page.getByRole("button", { name: "More" })
    : page.getByRole("button", { name: userName });

  await trigger.click();

  const menu = page.getByRole("menu");

  await menu.waitFor();

  return menu;
}
