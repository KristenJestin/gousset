import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const story = (component: string, name: string) =>
  `/iframe.html?id=import-${component}--${name}&viewMode=story`;

/** What to read at each frame: an element's clip, or whether a digit column shows two digits. */
type Reading = { selector: string; read: "clip" | "rolling" };

/**
 * Presses the button named `trigger` and, from that press, samples at every frame for half a
 * second what `reading` names: the clip of the first element `selector` matches ("none" while
 * there is none), or whether any element it matches has more than one child. Returns the values.
 */
async function sampleWhile(page: Page, trigger: string, reading: Reading) {
  const samples = page.evaluate(({ selector, read }) => {
    const value = () => {
      if (read === "rolling") {
        return String(
          [...document.querySelectorAll(selector)].some((element) => element.children.length > 1),
        );
      }

      const element = document.querySelector(selector);

      return element === null ? "none" : getComputedStyle(element).clipPath;
    };

    return new Promise<Array<string>>((resolve) => {
      const seen: Array<string> = [];

      document.addEventListener(
        "pointerdown",
        () => {
          const start = performance.now();

          const sample = () => {
            seen.push(value());

            if (performance.now() - start < 500) {
              requestAnimationFrame(sample);
            } else {
              resolve(seen);
            }
          };

          requestAnimationFrame(sample);
        },
        { once: true, capture: true },
      );
    });
  }, reading);

  await page.getByRole("button", { name: trigger }).click();

  return samples;
}

/**
 * The distinct clips an element took while it appeared (its absence left out): `Unfold` reveals
 * its content by its clip, never by its height.
 */
async function clipsWhileAppearing(page: Page, trigger: string, selector: string) {
  const samples = await sampleWhile(page, trigger, { selector, read: "clip" });

  return new Set(samples.filter((sample) => sample !== "none")).size;
}

/** A drag of made-up files, as the browser hands it to the page. */
async function draggedFiles(page: Page) {
  return page.evaluateHandle(() => {
    const transfer = new DataTransfer();

    transfer.items.add(new File(["OFXHEADER:100"], "statement_october.ofx"));
    transfer.items.add(new File(["!Type:Bank"], "savings.qif"));

    return transfer;
  });
}

/**
 * Playwright's Firefox kills the page's content process when a synthetic drag carries a
 * `DataTransfer` handle ("Page crashed", on every drag check): a crash of the browser under test,
 * not of the zone. Chromium and the phone run them.
 */
const NO_SYNTHETIC_DRAG = "Playwright's Firefox crashes on a synthetic drag with files";

const FILES = [
  { name: "statement_october.ofx", mimeType: "application/x-ofx", buffer: Buffer.from("OFX") },
  { name: "savings.qif", mimeType: "application/qif", buffer: Buffer.from("!Type:Bank") },
];

test.describe("FileDrop", () => {
  test("choosing files hands every one of them at once", async ({ page }) => {
    await page.goto(story("file-drop", "default"));
    await page.locator('[data-slot="file-drop-input"]').setInputFiles(FILES);
    await expect(page.getByTestId("received")).toHaveText(
      "Call 1: statement_october.ofx, savings.qif",
    );
  });

  test("its button opens the file picker from the keyboard, for several files", async ({
    page,
  }) => {
    await page.goto(story("file-drop", "default"));

    const button = page.getByRole("button", { name: "Choose files" });

    await expect(button).toHaveAccessibleDescription("OFX, QIF, CAMT.053, MT940 or CSV");
    // A press before the button works is lost (button.tsx, `data-hydrated`): wait for what is
    // drawn to say it works, then focus and press the button as it is now, in one step.
    await expect(button).toHaveAttribute("data-hydrated", "");

    const chooser = page.waitForEvent("filechooser");

    await button.press("Enter");

    const picker = await chooser;

    expect(picker.isMultiple()).toBe(true);
    await picker.setFiles(FILES);
    await expect(page.getByTestId("received")).toHaveText(
      "Call 1: statement_october.ofx, savings.qif",
    );
  });

  test("files dragged over it light the zone up, and dropping them hands them over", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === "firefox", NO_SYNTHETIC_DRAG);
    await page.goto(story("file-drop", "default"));

    const zone = page.getByRole("group", { name: "Drop your statements here" });
    const transfer = await draggedFiles(page);

    await expect(zone).not.toHaveAttribute("data-dragging");
    await zone.dispatchEvent("dragenter", { dataTransfer: transfer });
    await zone.dispatchEvent("dragover", { dataTransfer: transfer });
    await expect(zone).toHaveAttribute("data-dragging", "true");
    await expect(zone).toHaveCSS("transition-duration", "0.15s");
    await expect(zone).toHaveCSS("transition-timing-function", "cubic-bezier(0, 0, 0.2, 1)");
    await zone.dispatchEvent("drop", { dataTransfer: transfer });
    await expect(zone).not.toHaveAttribute("data-dragging");
    await expect(page.getByTestId("received")).toHaveText(
      "Call 1: statement_october.ofx, savings.qif",
    );
  });

  test("files dragged away leave the zone as it was", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "firefox", NO_SYNTHETIC_DRAG);
    await page.goto(story("file-drop", "default"));

    const zone = page.getByRole("group", { name: "Drop your statements here" });
    const transfer = await draggedFiles(page);

    await zone.dispatchEvent("dragenter", { dataTransfer: transfer });
    await expect(zone).toHaveAttribute("data-dragging", "true");
    await zone.dispatchEvent("dragleave", { dataTransfer: transfer });
    await expect(zone).not.toHaveAttribute("data-dragging");
  });

  test("its zone changes at once under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(story("file-drop", "default"));
    await expect(page.locator('[data-slot="file-drop"]')).toHaveCSS("transition-duration", "0s");
  });

  test("disabled, it takes no file", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "firefox", NO_SYNTHETIC_DRAG);
    await page.goto(story("file-drop", "disabled"));
    await expect(page.getByRole("button", { name: "Choose files" })).toBeDisabled();

    const zone = page.getByRole("group", { name: "Drop your statements here" });
    const transfer = await draggedFiles(page);

    await zone.dispatchEvent("dragenter", { dataTransfer: transfer });
    await zone.dispatchEvent("drop", { dataTransfer: transfer });
    await expect(zone).not.toHaveAttribute("data-dragging");
    await expect(page.getByTestId("received")).toHaveText("Nothing received yet.");
  });

  test("says its button in French on a French page", async ({ page }) => {
    await page.goto(story("file-drop", "french"));
    await expect(page.getByRole("button", { name: "Choisir des fichiers" })).toBeVisible();
  });
});

test.describe("ImportFiles", () => {
  test("one row per file under four column headers", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "phone", "A phone stacks each file: no header row");
    await page.goto(story("import-files", "checking"));

    const table = page.getByRole("table", { name: "Files to import" });

    await expect(table.getByRole("columnheader")).toHaveText([
      "File",
      "New",
      "Already known",
      "State",
    ]);
    await expect(table.locator('[data-slot="import-file"]')).toHaveCount(6);
  });

  test("the file's name comes first, its facts set back under it", async ({ page }) => {
    await page.goto(story("import-files", "imported"));

    const file = page.locator('[data-slot="import-file"]').first().locator('[data-column="file"]');
    const name = file.locator('[data-slot="import-file-name"]');
    const facts = file.locator('[data-slot="import-file-facts"]');

    await expect(facts).toHaveText("OFX · Current account · 1 Jan. 2016 – 31 Oct. 2026");
    await expect(name).toHaveCSS("font-weight", "500");
    await expect(facts).toHaveCSS("font-size", "12px");
    expect(await name.evaluate((element) => getComputedStyle(element).color)).not.toBe(
      await facts.evaluate((element) => getComputedStyle(element).color),
    );
  });

  test("a long name keeps its end whole and gives way at its start", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "phone", "A phone shows the name on two lines");
    await page.goto(story("import-files", "imported"));

    const name = page.locator('[data-slot="import-file-name"]').first();
    const full = "northbank_current-account_statement_full-history_2016-01-01_to_2026-10-31.ofx";

    await expect(name).toHaveAttribute("title", full);
    await expect(name).toHaveText(full);

    const end = name.locator("span").last();

    await expect(end).toHaveText("2016-01-01_to_2026-10-31.ofx");
    // One line, the end inside the cell: nothing of it is cut.
    expect((await name.boundingBox())?.height).toBeLessThanOrEqual(20);
    expect(await end.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  });

  test("each state is a chip: coloured only where something waits or failed", async ({ page }) => {
    await page.goto(story("import-files", "checking"));

    const chips = page.locator('[data-slot="import-file"] [data-slot="status-chip"]');

    await expect(chips).toHaveText([
      "Account to choose",
      "Reading",
      "Failed",
      "Imported",
      "Imported",
      "Undone",
    ]);
    await expect(chips.nth(0)).toHaveAttribute("data-tone", "action");
    await expect(chips.nth(2)).toHaveAttribute("data-tone", "error");
    await expect(chips.nth(3)).toHaveAttribute("data-tone", "done");

    // Every chip holds on one line.
    for (const chip of await chips.all()) {
      expect((await chip.boundingBox())?.height).toBeLessThanOrEqual(24);
    }
  });

  test("no state wraps in French either", async ({ page }) => {
    await page.goto(story("import-files", "french"));

    const chip = page.locator('[data-slot="status-chip"]', { hasText: "Colonnes à confirmer" });

    expect((await chip.boundingBox())?.height).toBeLessThanOrEqual(24);
  });

  test("on a phone each file is a stack: name, facts, then its state and counts", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "The stacked layout is the phone's");
    await page.goto(story("import-files", "imported"));
    await expect(page.getByRole("columnheader").first()).toBeHidden();

    const first = page.locator('[data-slot="import-file"]').first();
    const name = await first.locator('[data-column="file"]').boundingBox();
    const chip = await first.locator('[data-column="state"]').boundingBox();
    const added = await first.locator('[data-column="added"]').boundingBox();

    await expect(first.locator('[data-column="added"]')).toHaveText(/New\s*4,790/);
    expect(chip?.y).toBeGreaterThan((name?.y ?? 0) + (name?.height ?? 0) - 1);
    // The counts on the chip's line, after it.
    expect(Math.abs((added?.y ?? 0) - (chip?.y ?? 0))).toBeLessThan(8);
    expect(added?.x).toBeGreaterThan(chip?.x ?? 0);
  });

  test("counts are tabular and right-aligned", async ({ page }) => {
    await page.goto(story("import-files", "large-counts"));

    const added = page
      .locator('[data-slot="import-file"]')
      .first()
      .locator('[data-column="added"]');

    await expect(added).toHaveCSS("font-variant-numeric", "tabular-nums");
    await expect(added).toContainText("1,204");
    await expect(
      page.locator('[data-slot="import-file"]').first().locator('[data-column="known"]'),
    ).toContainText("13,870");
  });

  test("a count not made yet shows a dash, heard as not known yet", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "phone", "A phone leaves out counts not made yet");
    await page.goto(story("import-files", "just-dropped"));

    const first = page.locator('[data-slot="import-file"]').first();

    await expect(first.locator('[data-slot="import-file-facts"]')).toHaveCount(0);

    for (const column of ["added", "known"]) {
      await expect(first.locator(`[data-column="${column}"]`)).toContainText("—");
      await expect(first.locator(`[data-column="${column}"] .sr-only`)).toHaveText("Not known yet");
    }
  });

  test("the account question sits on one line under its file, with no gap", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === "phone", "A phone stacks the question");
    await page.goto(story("import-files", "waiting-for-account"));

    const prompt = page.locator('[data-slot="import-prompt"]');

    const select = prompt.getByRole("combobox", {
      name: "Account of mealcard-transactions-export-2026-10-31T18-42-07.csv",
    });

    const button = prompt.getByRole("button", { name: "Import into this account" });

    const box = await prompt.boundingBox();
    const selectBox = await select.boundingBox();
    const buttonBox = await button.boundingBox();

    // The sentence, the select and the button share one line: the inset is one control high.
    expect(box?.height).toBeLessThanOrEqual(52);
    expect(Math.abs((selectBox?.y ?? 0) - (buttonBox?.y ?? 0))).toBeLessThan(2);
    expect(buttonBox?.x).toBeGreaterThan(selectBox?.x ?? 0);
  });

  test("on a phone the account question stacks, its button full width", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "The stacked question is the phone's");
    await page.goto(story("import-files", "waiting-for-account"));

    const prompt = page.locator('[data-slot="import-prompt"]');
    const select = await prompt.getByRole("combobox").boundingBox();
    const button = await prompt.getByRole("button").boundingBox();

    expect(button?.y).toBeGreaterThan(select?.y ?? 0);
    expect(Math.abs((button?.width ?? 0) - (select?.width ?? 0))).toBeLessThan(2);
  });

  test("a row's content unfolds when it appears", async ({ page }) => {
    await page.goto(story("import-files", "opening-row"));
    // Nothing, then the clips on the way, then the whole content.
    expect(
      await clipsWhileAppearing(
        page,
        "Import the first file",
        '[data-slot="import-file-content"] [data-slot="unfold"]',
      ),
    ).toBeGreaterThan(3);
    await expect(
      page.getByRole("progressbar", {
        name: "Importing northbank-pea-operations-2025-annual.csv",
      }),
    ).toBeVisible();
  });

  test("a row's content appears at once under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(story("import-files", "opening-row"));
    expect(
      await clipsWhileAppearing(
        page,
        "Import the first file",
        '[data-slot="import-file-content"] [data-slot="unfold"]',
      ),
    ).toBeLessThanOrEqual(2);
  });

  test("writes its counts in French on a French page", async ({ page }) => {
    await page.goto(story("import-files", "french"));
    await expect(
      page.locator('[data-slot="import-file"]').first().locator('[data-column="known"]'),
    ).toContainText(/13\s870/);
    await expect(page.getByText("Pas encore connu").first()).toBeAttached();
  });
});

test.describe("ImportSummary", () => {
  test("says each count with what it counts", async ({ page }) => {
    await page.goto(story("import-summary", "default"));

    const summary = page.getByRole("region", { name: "Import summary" });

    for (const { figure, count, label } of [
      { figure: "read", count: "89", label: "lines read" },
      { figure: "added", count: "63", label: "added" },
      { figure: "known", count: "24", label: "already known" },
      { figure: "review", count: "2", label: "to review" },
    ]) {
      const term = summary.locator(`[data-figure="${figure}"]`);

      await expect(term.locator("dt")).toHaveText(label);
      await expect(term.locator('[data-slot="rolling-count"] > .sr-only')).toHaveText(count);
    }

    await expect(summary.getByRole("link", { name: "Continue to the review" })).toBeVisible();
  });

  test("the way forward comes last, undo set apart and quiet", async ({ page }, testInfo) => {
    await page.goto(story("import-summary", "default"));

    const summary = page.getByRole("region", { name: "Import summary" });
    const undo = summary.getByRole("button", { name: "Undo this import" });
    const next = summary.getByRole("link", { name: "Continue to the review" });
    const undoBox = await undo.boundingBox();
    const nextBox = await next.boundingBox();

    if (testInfo.project.name === "phone") {
      // Stacked under the figures, full width, the way forward on top.
      expect(nextBox?.y).toBeLessThan(undoBox?.y ?? 0);
      expect(Math.abs((nextBox?.width ?? 0) - (undoBox?.width ?? 0))).toBeLessThan(2);
    } else {
      // One line at the right edge, the way forward last, a wider gap between them.
      expect(Math.abs((nextBox?.y ?? 0) - (undoBox?.y ?? 0))).toBeLessThan(2);
      expect(nextBox?.x).toBeGreaterThanOrEqual((undoBox?.x ?? 0) + (undoBox?.width ?? 0) + 16);
    }

    // Undo draws no surface; it turns red only on hover, in 150 ms.
    await expect(undo).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(undo).toHaveCSS("transition-duration", "0.15s");
  });

  test("undo's colours change at once under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(story("import-summary", "default"));
    await expect(page.getByRole("button", { name: "Undo this import" })).toHaveCSS(
      "transition-duration",
      "0s",
    );
  });

  test("says the page's note under its figures, and none without one", async ({ page }) => {
    await page.goto(story("import-summary", "with-note"));

    const summary = page.getByRole("region", { name: "Import summary" });

    await expect(summary.locator('[data-slot="import-summary-note"]')).toHaveText(
      /^This file's balance looks empty and was ignored/,
    );
    await page.goto(story("import-summary", "default"));
    await expect(page.locator('[data-slot="import-summary-note"]')).toHaveCount(0);
  });

  test("lines to review stand out only while there are some", async ({ page }) => {
    await page.goto(story("import-summary", "default"));
    await expect(page.locator('[data-figure="review"] dd')).toHaveClass(/text-primary/);
    await page.goto(story("import-summary", "nothing-to-review"));
    await expect(page.locator('[data-figure="review"] dd')).not.toHaveClass(/text-primary/);
  });

  test("its counts roll to the new values", async ({ page }) => {
    await page.goto(story("import-summary", "rolling"));

    const samples = await sampleWhile(page, "Add the second file", {
      selector: '[data-slot="rolling-digit"]',
      read: "rolling",
    });

    // The roll lasts 200 ms: about a dozen frames show two digits in a column. More than 2 leaves
    // room for a slow runner, as Amount's own check does, and is far from reduced motion's.
    expect(samples.filter((sample) => sample === "true").length).toBeGreaterThan(2);
    await expect(page.locator('[data-figure="read"] .sr-only')).toHaveText("1,315");
  });

  test("its counts jump under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(story("import-summary", "rolling"));

    const samples = await sampleWhile(page, "Add the second file", {
      selector: '[data-slot="rolling-digit"]',
      read: "rolling",
    });

    expect(samples.filter((sample) => sample === "true").length).toBeLessThanOrEqual(1);
    await expect(page.locator('[data-figure="read"] .sr-only')).toHaveText("1,315");
  });

  test("it unfolds when it first appears", async ({ page }) => {
    await page.goto(story("import-summary", "unfolding"));
    expect(
      await clipsWhileAppearing(page, "Finish the import", '[data-slot="unfold"]'),
    ).toBeGreaterThan(3);
    await expect(page.getByRole("region", { name: "Import summary" })).toBeVisible();
  });

  test("it appears at once under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(story("import-summary", "unfolding"));
    expect(
      await clipsWhileAppearing(page, "Finish the import", '[data-slot="unfold"]'),
    ).toBeLessThanOrEqual(2);
  });

  test("writes its counts in French on a French page", async ({ page }) => {
    await page.goto(story("import-summary", "french"));
    await expect(page.locator('[data-figure="read"] .sr-only')).toHaveText(/^1\s315$/);
  });
});
