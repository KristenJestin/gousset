import type { Page } from "@playwright/test";

import { APP_HOST } from "./app-server";

/** The cookie the app's server reads its day from, under `GOUSSET_E2E_CLOCK` only (apps/web/src/lib/today.ts). */
const DAY_COOKIE = "gousset-e2e-day";

/**
 * Fixes both clocks on `day` (`YYYY-MM-DD`), so that months and expiries read the same on every
 * run: the browser's to noon UTC that day, and the server's, which reads the day from a cookie of
 * the page's context. Noon UTC is the same day in the run's time zone (`Europe/Paris`) whatever
 * the machine's own. Call it before the first `goto`. Timers keep running; only `Date` stops.
 */
export async function fixDay(page: Page, day: string): Promise<void> {
  await page.clock.setFixedTime(new Date(`${day}T12:00:00Z`));
  await page.context().addCookies([{ name: DAY_COOKIE, value: day, domain: APP_HOST, path: "/" }]);
}
