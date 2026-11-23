import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { onPhone } from "./frame";

/** A block of the monthly review, by its title. */
export const block = (page: Page, title: string) => page.getByRole("region", { name: title });

/**
 * A secondary block's content: in its block on a wide screen; on a phone the block is one line,
 * which opens it in a sheet. `closeBlock` closes it.
 */
export async function openBlock(page: Page, title: string): Promise<Locator> {
  if (!onPhone(page)) {
    return block(page, title);
  }

  await block(page, title)
    .getByRole("button", { name: new RegExp(`^${title}`) })
    .click();

  const sheet = page.getByRole("dialog", { name: title });

  await expect(sheet).toBeVisible();

  return sheet;
}

/** Closes what `openBlock` opened: the sheet on a phone; nothing on a wide screen. */
export async function closeBlock(page: Page): Promise<void> {
  if (!onPhone(page)) {
    return;
  }

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
