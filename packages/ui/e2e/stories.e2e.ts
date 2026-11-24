import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/**
 * One representative story per component, in light and in dark, screenshotted headless on the
 * desktop Chromium (the issue's "How to verify"), and the month bar's `Phone` story at a phone's
 * width, whose legend must hold on one line (#83). Each component's other stories, its phone
 * layout included (its `Phone` story), are covered by its behaviour tests; screenshotting every
 * story in every browser would put over a thousand images in Git. Reduced motion: each story is
 * caught in its final state, never on its way.
 *
 * The references come from CI (the `references` job of `.github/workflows/ci.yml`), never from a
 * local browser.
 */
type Shot = {
  id: string;
  /** What to do before the screenshot, for a popup that opens from its trigger. */
  open?: "click" | "focus";
  /** The trigger's name, when it is not the story's first button. */
  trigger?: string;
  /** A field to focus once the popup is open, by its label: its ring is in the picture. */
  field?: string;
  /** The screenshot's name, when a story is shot twice. */
  name?: string;
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
  // The list over a block: a floating surface stands out from the card (#104).
  { id: "forms-select--in-a-card", open: "click" },
  { id: "forms-combobox--chosen" },
  { id: "forms-namefield--typed" },
  { id: "forms-checkbox--checked" },
  { id: "forms-switch--on" },
  { id: "forms-datepicker--chosen" },
  { id: "forms-statusmessage--shown" },
  { id: "forms-formmessage--shown" },
  { id: "forms-file-button--default" },
  { id: "navigation-tabs--with-icons" },
  { id: "overlays-tooltip--default", open: "focus" },
  { id: "overlays-menu--default", open: "click" },
  { id: "overlays-popover--default", open: "click" },
  { id: "overlays-dialog--default", open: "click" },
  { id: "overlays-sheet--default", open: "click" },
  // A focused field's ring, whole at the edge of a dialog and of a sheet's scrolling body (#122);
  // a form sheet opens on its first field.
  { id: "overlays-dialog--with-form", open: "click", field: "Balance" },
  { id: "overlays-sheet--with-form", open: "click" },
  // On a phone, a long form is a bottom sheet (#121).
  { id: "overlays-sheet--with-form-on-phone", open: "click", width: 320 },
  { id: "feedback-toaster--failed" },
  { id: "feedback-job-progress--running" },
  { id: "import-file-drop--default" },
  { id: "import-import-files--checking" },
  { id: "import-import-summary--default" },
  { id: "import-csv-mapping--default" },
  { id: "import-csv-settings--default" },
  { id: "import-csv-test-read--default" },
  { id: "import-csv-test-read--refused" },
  { id: "import-csv-preview--default" },
  { id: "states-emptystate--in-a-block" },
  { id: "states-errorstate--beside-a-working-block" },
  // The review until it reads real lines (#126): a user with lines, a new user, a phone.
  { id: "states-reviewcoming--with-data" },
  { id: "states-reviewcoming--new-user" },
  { id: "states-reviewcoming--phone", width: 320 },
  { id: "layout-card--with-description" },
  { id: "layout-screen--sign-in" },
  { id: "data-list--loading-beside-loaded" },
  { id: "data-list--links" },
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
  // The user's menu opened over the sidebar: a floating surface stands out from it (#104).
  {
    id: "layout-app-shell--desktop",
    open: "click",
    trigger: "Ada Example",
    name: "layout-app-shell--desktop-user-menu",
  },
  { id: "layout-user-menu--default", open: "click" },
  { id: "inputs-segmented-choice--default" },
  { id: "forms-moneyfield--default" },
  { id: "data-chip--several" },
  { id: "accounts-overview--default" },
  { id: "accounts-accountfigures--default" },
  { id: "accounts-balancecheck--disagrees" },
  { id: "accounts-balancechart--default" },
  { id: "accounts-accountsettings--card" },
  { id: "accounts-accountlines--with-show-older" },
  { id: "accounts-accountfigures--restricted" },
  { id: "accounts-accountsettings--benefit-account" },
  { id: "accounts-benefitcredits--default" },
  { id: "accounts-benefitcredits--uncovered" },
  { id: "operations-operationslist--default" },
  { id: "operations-linedetail--to-review" },
  { id: "operations-operationsfilters--set" },
  { id: "operations-operationslayout--line-open" },
  { id: "categories-categorytree--default" },
  { id: "categories-categorypicker--chosen" },
  { id: "operations-linedetail--with-category" },
  { id: "operations-lineexpense--linked" },
  { id: "rules-ruleslist--default" },
  { id: "rules-ruleeditor--default" },
  { id: "rules-ruleproposal--default" },
  { id: "rules-ruleproposal--merchant" },
  // An intermediary's line that asks who was paid: its notice stands out in the detail (#30).
  { id: "operations-linemerchant--asks" },
  { id: "operations-linemerchant--assigned" },
  // The dialog the Change button opens, over the page.
  {
    id: "operations-linemerchant--choosing",
    open: "click",
    trigger: "Change the merchant",
  },
  { id: "operations-linedetail--with-merchant" },
];

async function openPopup(page: Page, open: Shot["open"], name: Shot["trigger"]) {
  const trigger =
    name === undefined
      ? page.locator("#storybook-root button").first()
      : page.getByRole("button", { name, exact: true });

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
    const name = shot.name ?? shot.id;

    test(`${name}, ${scheme}`, async ({ page }, testInfo) => {
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
        await openPopup(page, shot.open, shot.trigger);
        // The visible popup: a trigger's own tooltip sits closed and hidden in the page too.
        await expect(
          page
            .locator(
              '[role="dialog"], [role="menu"], [role="tooltip"], [role="listbox"], [data-slot$="-content"][data-open]',
            )
            .filter({ visible: true })
            .first(),
        ).toBeVisible();
      }

      if (shot.field !== undefined) {
        await page.getByLabel(shot.field, { exact: true }).focus();
      }

      await expect(page).toHaveScreenshot(`${name}-${scheme}.png`);
    });
  }
}
