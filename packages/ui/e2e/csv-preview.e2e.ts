import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const story = (component: string, name: string) =>
  `/iframe.html?id=import-csv-${component}--${name}&viewMode=story`;

/** Chooses what a column holds from its list, as a user does. */
async function choose(page: Page, column: string, field: string) {
  await page.getByRole("combobox", { name: `What ${column} holds` }).click();
  await page.getByRole("option", { name: field, exact: true }).click();
  await expect(page.getByRole("listbox")).toBeHidden();
}

/**
 * Presses the button named `trigger` and, from that press, samples at every frame for half a
 * second the opacity of the test read's result ("none" while there is none). Returns the values.
 */
async function opacitiesWhile(page: Page, trigger: string) {
  const samples = page.evaluate(
    async () =>
      new Promise<Array<string>>((resolve) => {
        const seen: Array<string> = [];

        document.addEventListener(
          "pointerdown",
          () => {
            const start = performance.now();

            const sample = () => {
              const element = document.querySelector('[data-slot="csv-test-result"]');

              seen.push(element === null ? "none" : getComputedStyle(element).opacity);

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
      }),
  );

  await page.getByRole("button", { name: trigger }).click();

  return samples;
}

/** An opacity on its way: neither hidden nor whole. */
const fading = (opacity: string) =>
  opacity !== "none" && Number(opacity) > 0 && Number(opacity) < 1;

test.describe("CsvMapping", () => {
  test("each column has its list, named after the column", async ({ page }) => {
    await page.goto(story("mapping", "default"));

    const table = page.getByRole("table", { name: "The first lines of export.csv" });

    for (const [column, field] of [
      ["Date", "Booking date"],
      ["Libellé", "Label"],
      ["Type", "Ignored"],
      ["Montant", "Amount (signed)"],
    ] as const) {
      await expect(table.getByRole("combobox", { name: `What ${column} holds` })).toHaveText(field);
    }

    await expect(table.locator('[data-slot="csv-mapping-row"]')).toHaveCount(4);
  });

  test("a column lights up in 200 ms as it is mapped, and goes back when ignored", async ({
    page,
  }) => {
    await page.goto(story("mapping", "unmapped"));

    const cell = page.locator('[data-slot="csv-mapping-row"] [data-column="2"]').first();

    await expect(cell).not.toHaveAttribute("data-mapped");
    await expect(cell).toHaveCSS("transition-duration", "0.2s");
    await expect(cell).toHaveCSS("transition-timing-function", "cubic-bezier(0, 0, 0.2, 1)");

    const before = await cell.evaluate((element) => getComputedStyle(element).backgroundColor);

    await choose(page, "Libellé", "Label");
    await expect(cell).toHaveAttribute("data-mapped", "true");
    await expect(cell).not.toHaveCSS("background-color", before);
    await expect(page.locator('[data-slot="csv-mapping-row"] [data-mapped]')).toHaveCount(4);

    await choose(page, "Libellé", "Ignored");
    await expect(cell).not.toHaveAttribute("data-mapped");
    await expect(cell).toHaveCSS("background-color", before);
  });

  test("under reduced motion a column lights up at once", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(story("mapping", "unmapped"));

    const cell = page.locator('[data-slot="csv-mapping-row"] [data-column="1"]').first();

    await expect(cell).toHaveCSS("transition-duration", "0s");
    await choose(page, "Date", "Booking date");
    await expect(cell).toHaveAttribute("data-mapped", "true");
  });

  test("a wide file scrolls inside its block", async ({ page }) => {
    await page.goto(story("mapping", "wide"));

    const scroller = page.locator('[data-slot="csv-mapping"]');

    expect(await scroller.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
      true,
    );
  });
});

test.describe("CsvSettings", () => {
  test("each setting is labelled, and a change hands over the whole settings", async ({ page }) => {
    await page.goto(story("settings", "default"));

    const settings = page.getByTestId("settings");

    await page.getByRole("combobox", { name: "Separator" }).click();
    await page.getByRole("option", { name: "Comma ," }).click();
    await expect(settings).toContainText('"separator":","');

    await page.getByRole("spinbutton", { name: "Lines to skip" }).fill("2");
    await expect(settings).toContainText('"skipRows":2');

    await page.getByRole("checkbox", { name: "The first line names the columns" }).click();
    await expect(settings).toContainText('"headerRow":false');
    await expect(settings).toContainText('"dateFormat":"DD/MM/YYYY"');
  });

  test("disabled, nothing changes", async ({ page }) => {
    await page.goto(story("settings", "disabled"));
    await expect(page.getByRole("combobox", { name: "Separator" })).toBeDisabled();
    await expect(page.getByRole("spinbutton", { name: "Lines to skip" })).toBeDisabled();
  });
});

test.describe("FileButton", () => {
  test("its button opens the picker, and the file chosen is handed over", async ({ page }) => {
    await page.goto("/iframe.html?id=forms-file-button--default&viewMode=story");

    const chooser = page.waitForEvent("filechooser");

    await page.getByRole("button", { name: "Import a profile file" }).click();
    await (
      await chooser
    ).setFiles({
      name: "shared.gousset-profile.json",
      mimeType: "application/json",
      buffer: Buffer.from("{}"),
    });
    await expect(page.getByTestId("received")).toHaveText("shared.gousset-profile.json");
  });
});

test.describe("CsvPreview", () => {
  test("lays out the profile, the lines, the settings, the test read, then the import", async ({
    page,
  }) => {
    await page.goto("/iframe.html?id=import-csv-preview--default&viewMode=story");

    const preview = page.locator('[data-slot="csv-preview"]');

    await expect(preview.getByRole("combobox", { name: "Read with" })).toBeVisible();
    await expect(
      preview.getByRole("table", { name: "The first lines of mealcard.csv" }),
    ).toBeVisible();
    await expect(preview.getByRole("heading", { name: "Test read" })).toBeVisible();
    await expect(preview.getByRole("button").last()).toHaveText("Read the file this way");
  });
});

test.describe("CsvTestRead", () => {
  test("shows the first lines as the import would save them", async ({ page }) => {
    await page.goto(story("test-read", "default"));

    const region = page.getByRole("region", { name: "Test read" });

    await expect(region).toHaveAttribute("aria-live", "polite");
    await expect(region.getByRole("columnheader")).toHaveText(["Date", "Label", "Amount"]);
    await expect(region.getByRole("row")).toHaveCount(4);
  });

  test("a refusal names the line and the column", async ({ page }) => {
    await page.goto(story("test-read", "refused"));
    await expect(page.getByRole("region", { name: "Test read" })).toContainText("Line 4, column 1");
  });

  test("each new result fades in in 200 ms", async ({ page }) => {
    await page.goto(story("test-read", "fading"));

    const first = await opacitiesWhile(page, "Test the reading");

    expect(first.filter(fading).length).toBeGreaterThan(1);
    expect(first.at(-1)).toBe("1");

    // The refusal that follows is a new result: it fades in too.
    const second = await opacitiesWhile(page, "Test the reading");

    expect(second.filter(fading).length).toBeGreaterThan(1);
    await expect(page.getByRole("region", { name: "Test read" })).toContainText("Line 4");
  });

  test("under reduced motion a result appears at once", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(story("test-read", "fading"));

    const samples = await opacitiesWhile(page, "Test the reading");

    expect(samples.filter(fading)).toEqual([]);
    expect(samples.at(-1)).toBe("1");
  });
});
