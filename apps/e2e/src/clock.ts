import type { Page } from "@playwright/test";

/**
 * Fixes the browser's clock to noon UTC on `day` (`YYYY-MM-DD`), so that months and expiries read
 * the same on every run. Noon UTC is the same day in the run's time zone (`Europe/Paris`) whatever
 * the machine's own. Call it before the first `goto`. Timers keep running; only `Date` stops.
 *
 * The server's clock is not fixed: a page rendered on the server still sees today (README,
 * "The server's clock").
 */
export async function fixDay(page: Page, day: string): Promise<void> {
  await page.clock.setFixedTime(new Date(`${day}T12:00:00Z`));
}
