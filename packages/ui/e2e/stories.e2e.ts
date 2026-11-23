import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/**
 * One representative story per component, in light and in dark, screenshotted headless on the
 * desktop Chromium (the issue's "How to verify"). Each component's other stories, its phone
 * layout included (its `Phone` story), are covered by its behaviour tests; screenshotting every
 * story in every browser would put over a thousand images in Git. Reduced motion: each story is
 * caught in its final state, never on its way.
 *
 * The references come from CI (`.github/workflows/ui-snapshots.yml`), never from a local browser.
 */
type Shot = {
  id: string;
  /** What to do before the screenshot, for a popup that opens from its trigger. */
  open?: "click" | "focus";
  /** A phone's width, for a story whose layout is the phone's (its `Phone` story). */
  width?: number;
};

const SHOTS: ReadonlyArray<Shot> = [
  { id: "foundations-icon--category-icons" },
  { id: "foundations-loader--sizes" },
  { id: "actions-button--variants" },
  { id: "actions-iconbutton--variants" },
  { id: "actions-textlink--in-text" },
  { id: "forms-textfield--error" },
  { id: "forms-select--chosen" },
  { id: "forms-combobox--chosen" },
  { id: "forms-checkbox--checked" },
  { id: "forms-switch--on" },
  { id: "forms-datepicker--chosen" },
  { id: "forms-statusmessage--shown" },
  { id: "forms-formmessage--shown" },
  { id: "navigation-tabs--with-icons" },
  { id: "overlays-tooltip--default", open: "focus" },
  { id: "overlays-menu--default", open: "click" },
  { id: "overlays-popover--default", open: "click" },
  { id: "overlays-dialog--default", open: "click" },
  { id: "overlays-sheet--default", open: "click" },
  { id: "feedback-toaster--failed" },
  { id: "feedback-job-progress--running" },
  { id: "states-emptystate--in-a-block" },
  { id: "states-errorstate--beside-a-working-block" },
  { id: "layout-card--with-description" },
  { id: "layout-screen--sign-in" },
  { id: "data-list--loading-beside-loaded" },
  { id: "data-categoryicon--in-rows" },
  { id: "data-merchantlogo--in-rows" },
  { id: "data-accountchip--kinds" },
  { id: "data-monthswitcher--default" },
  { id: "help-shortcutlist--default" },
  { id: "money-amount--tones" },
  { id: "money-delta--spending-up" },
  { id: "money-month-bar--default" },
  { id: "money-month-bar--overspent" },
  { id: "money-month-bar--narrow-part" },
  // The legend on one line at the narrowest phone (#83), Storybook's `mobile1`.
  { id: "money-month-bar--phone", width: 320 },
  { id: "money-breakdown--default" },
  { id: "money-breakdown--loading" },
  { id: "money-amount--counting" },
  { id: "money-movement-list--default" },
  { id: "money-investment-list--loss" },
  { id: "money-review-lines--default" },
  { id: "data-flag-list--default" },
  { id: "layout-folded--default" },
  { id: "layout-review-layout--desktop" },
  { id: "charts-spending-chart--default" },
  { id: "charts-bar-chart--default" },
  { id: "brand-brand--with-wordmark" },
  { id: "layout-app-shell--desktop" },
  { id: "layout-user-menu--default", open: "click" },
  { id: "inputs-segmented-choice--default" },
];

async function openPopup(page: Page, open: Shot["open"]) {
  const trigger = page.locator("#storybook-root button").first();

  if (open === "click") {
    await trigger.click();
  } else if (open === "focus") {
    await page.keyboard.press("Tab");
  }
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-24T12:00:00Z"));
});

for (const scheme of ["light", "dark"] as const) {
  for (const shot of SHOTS) {
    test(`${shot.id}, ${scheme}`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "chromium", "Screenshotted on the desktop Chromium");

      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });

      if (shot.width !== undefined) {
        await page.setViewportSize({ width: shot.width, height: 568 });
      }

      await page.goto(`/iframe.html?id=${shot.id}&viewMode=story`);
      await page.locator("#storybook-root > *").first().waitFor();
      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      if (shot.open !== undefined) {
        await openPopup(page, shot.open);
        // The visible popup: a trigger's own tooltip sits closed and hidden in the page too.
        await expect(
          page
            .locator(
              '[role="dialog"], [role="menu"], [role="tooltip"], [data-slot$="-content"][data-open]',
            )
            .filter({ visible: true })
            .first(),
        ).toBeVisible();
      }

      await expect(page).toHaveScreenshot(`${shot.id}-${scheme}.png`);
    });
  }
}
