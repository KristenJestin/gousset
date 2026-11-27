import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/**
 * One representative story per component, in light and in dark, screenshotted headless on the
 * desktop Chromium (the issue's "How to verify"), and the month bar's `Phone` story at a phone's
 * width, whose legend is a list there (#36). Each component's other stories, its phone
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
  // A category's colour and icon (#205): the palette with its choice of none, the icons' grid.
  { id: "forms-colorswatches--parents-colour" },
  { id: "forms-categoryiconchoice--default" },
  { id: "forms-checkbox--checked" },
  { id: "forms-switch--on" },
  { id: "forms-datepicker--chosen" },
  { id: "forms-statusmessage--shown" },
  { id: "forms-formmessage--shown" },
  { id: "forms-file-button--default" },
  // A merchant's logo and labels, in its form (#204).
  { id: "forms-logofield--with-logo" },
  { id: "forms-textlistfield--default" },
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
  // The import screen's states (#125), on a desktop and at a phone's width.
  { id: "import-import-files--waiting-for-account" },
  // A CSV's columns to confirm: the card's state and its action, the form in a sheet (#210).
  { id: "import-import-files--waiting-for-columns" },
  { id: "import-import-files--imported" },
  { id: "import-import-files--failed" },
  {
    id: "import-import-files--waiting-for-account",
    width: 390,
    name: "import-import-files--waiting-for-account-phone",
  },
  { id: "import-import-files--imported", width: 390, name: "import-import-files--imported-phone" },
  { id: "import-import-files--failed", width: 390, name: "import-import-files--failed-phone" },
  { id: "import-import-summary--default" },
  { id: "data-statuschip--tones" },
  { id: "import-csv-mapping--default" },
  { id: "import-csv-settings--default" },
  { id: "import-csv-test-read--default" },
  { id: "import-csv-test-read--refused" },
  { id: "import-csv-preview--default" },
  // A CSV file's columns in their wide side sheet, opened from the file's card (#210).
  { id: "import-csv-preview--in-a-sheet", open: "click" },
  { id: "states-emptystate--in-a-block" },
  { id: "states-errorstate--beside-a-working-block" },
  // The review of a user with no line yet (#32): links to the first import and the accounts.
  { id: "states-emptystate--with-links" },
  { id: "layout-card--with-description" },
  { id: "layout-screen--sign-in" },
  { id: "data-list--loading-beside-loaded" },
  { id: "data-list--links" },
  // Wherever a merchant is named, its logo or its initials on its colour (#204).
  { id: "data-list--links-with-avatars" },
  { id: "data-categoryicon--in-rows" },
  // Every palette colour on its tile, on a block and on the page (#205).
  { id: "data-categoryicon--every-colour" },
  { id: "data-avatar--in-rows" },
  // Every colour of the palette, initials on their tile, in both schemes (#204).
  { id: "data-avatar--palette" },
  { id: "data-accountchip--kinds" },
  { id: "data-monthswitcher--default" },
  { id: "help-shortcutlist--default" },
  { id: "money-amount--tones" },
  { id: "money-delta--spending-up" },
  { id: "money-month-bar--default" },
  { id: "money-month-bar--overspent" },
  { id: "money-month-bar--narrow-part" },
  // The legend as a list at the narrowest phone (#36), Storybook's `mobile1`.
  { id: "money-month-bar--phone", width: 320 },
  // The month in another currency, apart (#32).
  { id: "money-month-bar--other-currencies" },
  { id: "money-delta--several" },
  { id: "money-breakdown--default" },
  { id: "money-breakdown--loading" },
  // An open row's figures against its average and the month before (#32).
  { id: "money-breakdown--detail-figures" },
  { id: "money-breakdown--merchants-with-avatars" },
  { id: "money-amount--counting" },
  { id: "money-movement-list--default" },
  { id: "money-investment-list--loss" },
  { id: "money-review-lines--default" },
  // The review's first lines, read only, and its link into the review mode (#32).
  { id: "money-review-lines--read-only" },
  // The recurring payments' calendar (#34): the month and the agenda, on a desktop and a phone.
  { id: "money-recurringcalendar--default" },
  { id: "money-recurringcalendar--agenda-view" },
  { id: "money-recurringcalendar--phone", width: 390 },
  { id: "money-recurringcalendar--phone-agenda", width: 390 },
  { id: "money-recurringcalendar--agenda-with-avatars" },
  { id: "data-flag-list--default" },
  { id: "data-flag-list--with-avatars" },
  { id: "layout-folded--default" },
  { id: "layout-review-layout--desktop" },
  { id: "charts-spending-chart--default" },
  { id: "charts-bar-chart--default" },
  { id: "brand-brand--with-wordmark" },
  { id: "layout-app-shell--desktop" },
  { id: "layout-app-shell--block-with-avatar" },
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
  { id: "operations-operationslist--with-avatars" },
  { id: "operations-linedetail--to-review" },
  // "To review only" off, then pressed with the others set (#184).
  { id: "operations-operationsfilters--default" },
  { id: "operations-operationsfilters--set" },
  { id: "operations-operationsfilters--french" },
  // A phone: the search and the Filters button, then the sheet it opens (#127).
  { id: "operations-operationsfilters--phone", width: 390 },
  {
    id: "operations-operationsfilters--phone",
    width: 390,
    open: "click",
    trigger: "Filters",
    name: "operations-operationsfilters--phone-sheet",
  },
  { id: "operations-operationslist--phone", width: 390 },
  { id: "operations-operationslayout--line-open" },
  // A line's detail in its side sheet over the list, in French, and a bottom sheet on a phone
  // (#128, #182).
  { id: "operations-operationslayout--line-open-french" },
  { id: "operations-operationslayout--phone", width: 390 },
  { id: "categories-categorytree--default" },
  { id: "categories-categorypicker--chosen" },
  { id: "operations-linedetail--with-category" },
  { id: "operations-lineexpense--linked" },
  // A works council refund and the expense it funds, each on its side's detail (#29).
  { id: "operations-linefunding--funds" },
  { id: "operations-linefunding--funded-by" },
  { id: "rules-ruleslist--default" },
  { id: "rules-ruleeditor--default" },
  { id: "rules-ruleproposal--default" },
  { id: "rules-ruleproposal--merchant" },
  // An intermediary's line that asks who was paid: its notice stands out in the detail (#30).
  { id: "operations-linemerchant--asks" },
  { id: "operations-linemerchant--assigned" },
  { id: "operations-linemerchant--with-logo" },
  // The dialog the Change button opens, over the page.
  {
    id: "operations-linemerchant--choosing",
    open: "click",
    trigger: "Change the merchant",
  },
  { id: "operations-linedetail--with-merchant" },
  // What Gousset proposes for a line to review, at the top of its detail, and Correct's dialog (#35).
  { id: "operations-reviewproposal--in-detail" },
  { id: "operations-reviewproposal--duplicate" },
  {
    id: "operations-reviewproposal--category",
    open: "click",
    trigger: "Correct CB GREENMARKET 2110 RIVERTON",
    name: "operations-reviewproposal--correcting",
  },
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
