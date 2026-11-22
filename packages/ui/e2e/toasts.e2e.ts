import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const story = (name: string) => `/iframe.html?id=feedback-toaster--${name}&viewMode=story`;

const toasts = (page: Page) => page.locator('[data-slot="toast"]');

const region = (page: Page) => page.locator('[data-slot="toast-region"]');

/** ui-sdk's shared live region of that politeness, where toasts are announced. */
const announcer = (page: Page, priority: "polite" | "assertive") =>
  page.locator(`[data-ui-sdk-announcer][aria-live="${priority}"]`);

/** Marks the element, so a later check can tell it is still the same one, updated in place. */
async function mark(toast: Locator) {
  await toast.evaluate((element) => element.setAttribute("data-test-mark", "first"));
}

test("a success says Saved politely and leaves after 4 s", async ({ page }) => {
  await page.clock.install();
  await page.goto(story("saved"));

  const toast = toasts(page);

  await expect(toast).toHaveCount(1);
  await expect(toast).toHaveAttribute("data-type", "success");
  await expect(toast).toContainText("Saved");
  await expect(toast).toContainText("Greenmarket · Groceries");
  await expect(announcer(page, "polite")).toContainText("Saved");
  await expect(page.getByRole("region", { name: "Notifications" })).toBeVisible();

  await page.clock.fastForward(2500);
  await expect(toast).toHaveCount(1);
  await page.clock.fastForward(2000);
  await expect(toast).toHaveCount(0);
});

test("an error is announced assertively, stays until dismissed and offers Retry", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto(story("failed"));

  const toast = toasts(page);

  await expect(toast).toHaveAttribute("data-type", "error");
  await expect(toast).toContainText("Something went wrong");
  await expect(announcer(page, "assertive")).toContainText("Something went wrong");
  await expect(toast.getByRole("button", { name: "Retry" })).toBeVisible();

  await page.clock.fastForward(60_000);
  await expect(toast).toHaveCount(1);
  await toast.getByRole("button", { name: "Dismiss" }).click();
  await expect(toast).toHaveCount(0);
});

test("a progress shows the loader and resolves in the same toast", async ({ page }) => {
  await page.clock.install();
  await page.goto(story("progress"));

  const toast = toasts(page);

  await expect(toast).toHaveAttribute("data-type", "loading");
  await expect(toast).toContainText("Reading statement.ofx");
  await expect(toast.locator('[data-slot="loader"]')).toBeVisible();
  await mark(toast);

  await page.clock.fastForward(1500);
  await expect(toast).toContainText("Matching 12 lines");
  await page.clock.fastForward(1500);
  await expect(toast).toContainText("12 lines added");
  await expect(toast).toHaveAttribute("data-type", "success");
  await expect(toast).toHaveCount(1);
  await expect(toast).toHaveAttribute("data-test-mark", "first");
});

// In real time: Motion's swap of the mark does not run on Playwright's fake clock.
test("once the progress succeeds, its loader gives way to the check", async ({ page }) => {
  await page.goto(story("progress"));

  const toast = toasts(page);

  await expect(toast).toContainText("12 lines added", { timeout: 6000 });
  await expect(toast.locator('[data-slot="loader"]')).toHaveCount(0, { timeout: 1000 });
  await expect(toast.locator("svg.tabler-icon")).toHaveCount(2);
});

test("a failing progress turns into an error in the same toast", async ({ page }) => {
  await page.clock.install();
  await page.goto(story("progress-failing"));

  const toast = toasts(page);

  await expect(toast).toHaveAttribute("data-type", "loading");
  await mark(toast);
  await page.clock.fastForward(2000);
  await expect(toast).toHaveAttribute("data-type", "error");
  await expect(toast).toContainText("statement.ofx is not a bank statement.");
  await expect(toast.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(toast).toHaveCount(1);
  await expect(toast).toHaveAttribute("data-test-mark", "first");
});

test("undo runs its callback and the same toast says Undone", async ({ page }) => {
  await page.goto(story("undo"));

  const toast = toasts(page);

  await expect(toast).toContainText("Line approved");
  await mark(toast);
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Line back to review")).toBeVisible();
  await expect(toast).toContainText("Undone");
  await expect(toast).toHaveAttribute("data-type", "success");
  await expect(toast.getByRole("button", { name: "Undo" })).toHaveCount(0);
  await expect(toast).toHaveCount(1);
  await expect(toast).toHaveAttribute("data-test-mark", "first");
});

test("an undo that fails says so in the same toast, assertively, with Retry", async ({ page }) => {
  await page.goto(story("undo-failing"));

  const toast = toasts(page);

  await mark(toast);
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(toast).toContainText("Couldn't undo");
  await expect(toast).toHaveAttribute("data-type", "error");
  await expect(announcer(page, "assertive")).toContainText("Couldn't undo");
  await expect(toast.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(toast).toHaveCount(1);
  await expect(toast).toHaveAttribute("data-test-mark", "first");
});

/** Whether any two toasts overlap on screen. */
async function overlapping(page: Page) {
  const boxes = await toasts(page).evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();

      return { top: box.top, bottom: box.bottom };
    }),
  );

  return boxes.some((box, index) =>
    boxes.slice(index + 1).some((other) => box.top < other.bottom && other.top < box.bottom),
  );
}

test("at most three show, and the stack expands on hover", async ({ page }) => {
  await page.goto(story("more-than-three"));
  await expect(toasts(page)).toHaveCount(3);
  await expect(region(page)).not.toHaveAttribute("data-expanded");
  await expect.poll(() => overlapping(page)).toBe(true);

  await page.locator('[data-slot="toast"][data-front]').hover();
  await expect(region(page)).toHaveAttribute("data-expanded");
  await expect.poll(() => overlapping(page)).toBe(false);
});

test("F6 reaches the stack, which expands, and Escape dismisses the toast", async ({ page }) => {
  await page.goto(story("more-than-three"));
  await expect(toasts(page)).toHaveCount(3);
  await page.keyboard.press("F6");
  await expect(page.locator('[data-slot="toast"][data-front]')).toBeFocused();
  await expect(region(page)).toHaveAttribute("data-expanded");

  await page.keyboard.press("Escape");
  // The newest goes; the next takes its place, and one that waited comes in.
  await expect(toasts(page).filter({ hasText: "Pixelplay" })).toHaveCount(0);
  await expect(toasts(page).filter({ hasText: "Fuelstop" })).toHaveCount(1);
  await expect(toasts(page)).toHaveCount(3);
});

test("Escape on the last toast dismisses it and gives focus back", async ({ page }) => {
  await page.goto(story("failed"));

  const button = page.getByRole("button", { name: "Fail again" });

  await button.focus();
  await page.keyboard.press("F6");
  await expect(toasts(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(toasts(page)).toHaveCount(0);
  await expect(button).toBeFocused();
});

test("toasts sit at the bottom on desktop and at the top on a phone", async ({ page }) => {
  await page.goto(story("saved"));
  await expect(toasts(page)).toHaveCount(1);

  const viewport = page.viewportSize();
  const box = await region(page).boundingBox();

  expect(viewport).not.toBeNull();
  expect(box).not.toBeNull();

  const phone = (viewport?.width ?? 0) < 640;
  const top = box?.y ?? 0;
  const bottom = top + (box?.height ?? 0);

  if (phone) {
    await expect(region(page)).toHaveAttribute("data-side", "top");
    expect(top).toBeLessThan(40);
  } else {
    await expect(region(page)).toHaveAttribute("data-side", "bottom");
    expect(bottom).toBeGreaterThan((viewport?.height ?? 0) - 40);
  }
});

test("the words follow the page's language", async ({ page }) => {
  await page.goto(story("french"));
  await expect(toasts(page)).toHaveCount(3);
  await expect(page.getByRole("region", { name: "Notifications" })).toBeVisible();
  await expect(toasts(page).getByText("Enregistré")).toBeVisible();
  await expect(toasts(page).getByText("Un problème est survenu")).toBeVisible();
  await page.keyboard.press("F6");
  await expect(page.getByRole("button", { name: "Annuler" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Réessayer" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fermer" })).toHaveCount(3);
});

test("the stack moves in 300 ms, and not under reduced motion", async ({ page }) => {
  await page.goto(story("saved"));

  const toast = toasts(page);

  await expect(toast).toHaveCSS("transition-duration", "0.3s");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(toast).toHaveCSS("transition-duration", "0s");
  await expect(region(page)).toHaveCSS("transition-duration", "0s");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
});
