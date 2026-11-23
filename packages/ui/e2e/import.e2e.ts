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
    await button.focus();

    const chooser = page.waitForEvent("filechooser");

    await page.keyboard.press("Enter");

    const picker = await chooser;

    expect(picker.isMultiple()).toBe(true);
    await picker.setFiles(FILES);
    await expect(page.getByTestId("received")).toHaveText(
      "Call 1: statement_october.ofx, savings.qif",
    );
  });

  test("files dragged over it light the zone up, and dropping them hands them over", async ({
    page,
  }) => {
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

  test("files dragged away leave the zone as it was", async ({ page }) => {
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

  test("disabled, it takes no file", async ({ page }) => {
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
  test("one row per file under the column headers", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "phone", "A phone stacks each file: no header row");
    await page.goto(story("import-files", "checking"));

    const table = page.getByRole("table", { name: "Files to import" });

    await expect(table.getByRole("columnheader")).toHaveText([
      "File",
      "Format recognised",
      "Account",
      "Period",
      "New",
      "Already known",
      "State",
    ]);
    await expect(table.locator('[data-slot="import-file"]')).toHaveCount(4);
    await expect(table.getByRole("combobox", { name: "Account" })).toHaveCount(4);
  });

  test("on a phone each line of a file names its column", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "The stacked layout is the phone's");
    await page.goto(story("import-files", "checking"));
    await expect(page.getByRole("columnheader").first()).toBeHidden();

    const first = page.locator('[data-slot="import-file"]').first();

    await expect(first.locator('[data-column="format"]')).toHaveText(/Format recognised\s*OFX/);
    await expect(first.locator('[data-column="added"]')).toHaveText(/New\s*58/);
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

  test("a value not known yet shows a dash, heard as not known yet", async ({ page }) => {
    await page.goto(story("import-files", "just-dropped"));

    const first = page.locator('[data-slot="import-file"]').first();

    for (const column of ["format", "account", "period", "added", "known"]) {
      await expect(first.locator(`[data-column="${column}"]`)).toContainText("—");
      await expect(first.locator(`[data-column="${column}"] .sr-only`)).toHaveText("Not known yet");
    }
  });

  test("a file that waits for the user has its state marked, its question under it", async ({
    page,
  }) => {
    await page.goto(story("import-files", "checking"));

    const csv = page.locator('[data-slot="import-file"][data-attention]');

    await expect(csv).toHaveCount(1);
    await expect(csv.locator('[data-column="state"]')).toContainText("to map");
    await expect(page.locator('[data-slot="import-file-content"]')).toContainText(
      "what does each column hold?",
    );
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
      page.getByRole("progressbar", { name: "Importing statement_october.ofx" }),
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

    await expect(summary.getByRole("button", { name: "Continue to the review" })).toBeVisible();
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

    // The roll lasts 200 ms: about a dozen frames show two digits in a column.
    expect(samples.filter((sample) => sample === "true").length).toBeGreaterThan(4);
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
