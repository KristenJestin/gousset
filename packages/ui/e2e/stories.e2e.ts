import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { Schema } from "effect";

/**
 * Every story of `packages/ui`, in light and in dark, screenshotted headless (the issue's "How
 * to verify"). On the desktop Chromium and the phone; Firefox runs the components' own specs.
 * Reduced motion: each story is caught in its final state, never on its way. The list comes from
 * the built Storybook's own index, so a new story is covered without touching this file.
 */
const StoryIndex = Schema.Struct({
  entries: Schema.Record(Schema.String, Schema.Struct({ id: Schema.String, type: Schema.String })),
});

async function storyIds(page: Page) {
  const response = await page.request.get("/index.json");
  const index = Schema.decodeUnknownSync(StoryIndex)(JSON.parse(await response.text()));
  const ids: Array<string> = [];

  for (const entry of Object.values(index.entries)) {
    if (entry.type === "story") {
      ids.push(entry.id);
    }
  }

  return ids.toSorted();
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-24T12:00:00Z"));
});

for (const scheme of ["light", "dark"] as const) {
  test(`every story, ${scheme}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "firefox", "Chromium and the phone sweep every story");
    test.setTimeout(600_000);

    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });

    const ids = await storyIds(page);

    expect(ids.length).toBeGreaterThan(20);

    for (const id of ids) {
      await test.step(id, async () => {
        await page.goto(`/iframe.html?id=${id}&viewMode=story`);
        await page.locator("#storybook-root > *").first().waitFor();
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        await expect.soft(page).toHaveScreenshot(`${id}-${scheme}.png`);
      });
    }
  });
}
