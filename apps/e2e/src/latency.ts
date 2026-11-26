import { setTimeout as sleep } from "node:timers/promises";

import type { Page, Route } from "@playwright/test";

/** Where TanStack Start serves its server functions to the browser. */
export const SERVER_FUNCTIONS = "**/_serverFn/**";

/**
 * Holds every server function call the browser makes for `milliseconds` before it leaves, for the
 * loading and skeleton scenarios. A page's first paint is rendered on the server and does not go
 * through the browser, so this slows the client's calls only: navigations, refetches, actions.
 * Returns how to take the latency off again.
 */
export async function slowServerFunctions(page: Page, milliseconds: number) {
  const handler = async (route: Route) => {
    await sleep(milliseconds);
    await route.fallback();
  };

  await page.route(SERVER_FUNCTIONS, handler);

  return async () => {
    await page.unroute(SERVER_FUNCTIONS, handler);
  };
}

/**
 * Holds the browser's server function writes (POST) for `milliseconds` before they leave, and only
 * them: the reads a save then waits for (the data read again) go at once. For a setting whose save
 * must outlast a reload made too early. Returns how to take the latency off again.
 */
export async function slowServerWrites(page: Page, milliseconds: number) {
  const handler = async (route: Route) => {
    if (route.request().method() === "POST") {
      await sleep(milliseconds);
    }

    await route.fallback();
  };

  await page.route(SERVER_FUNCTIONS, handler);

  return async () => {
    await page.unroute(SERVER_FUNCTIONS, handler);
  };
}
