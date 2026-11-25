import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

const story = (component: string, name: string) =>
  `/iframe.html?id=money-${component}--${name}&viewMode=story`;

const NARROW_NO_BREAK_SPACE = " ";
const NO_BREAK_SPACE = " ";

/** What to read at each frame: whether a digit column shows two digits, or an attribute. */
type Reading = { selector: string; attribute: string | null };

/**
 * Presses the button named `trigger` and, from that press, samples at every frame for `forMs`
 * what `read` names: with an attribute, its value on the first element `selector` matches;
 * without, whether any element it matches draws more than one child inside its own box (by at
 * least a pixel). Returns the values seen.
 *
 * What is drawn, not what is in the DOM: a leaving digit stays in the DOM until Motion's exit
 * ends and React renders again, a frame or two later even when reduced motion skips the exit
 * (it is moved out of its clipped column at once), so counting children would measure React's
 * scheduling, not the motion.
 */
async function sampleWhile(page: Page, trigger: string, read: Reading, forMs = 500) {
  const samples = page.evaluate(
    ({ selector, attribute, duration }) => {
      const reading = () =>
        attribute === null
          ? String(
              [...document.querySelectorAll(selector)].some((element) => {
                const box = element.getBoundingClientRect();

                const drawn = [...element.children].filter((child) => {
                  const inner = child.getBoundingClientRect();

                  return Math.min(box.bottom, inner.bottom) - Math.max(box.top, inner.top) >= 1;
                });

                return drawn.length > 1;
              }),
            )
          : String(document.querySelector(selector)?.getAttribute(attribute));

      return new Promise<Array<string>>((resolve) => {
        const seen: Array<string> = [];

        document.addEventListener(
          "pointerdown",
          () => {
            const start = performance.now();

            const sample = () => {
              seen.push(reading());

              if (performance.now() - start < duration) {
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
    },
    { ...read, duration: forMs },
  );

  await page.getByRole("button", { name: trigger }).click();

  return samples;
}

/** How many frames, from the press, had at least one digit column drawing two digits. */
async function rollingFrames(page: Page) {
  const samples = await sampleWhile(page, "Previous month", {
    selector: '[data-slot="rolling-digit"]',
    attribute: null,
  });

  return samples.filter((sample) => sample === "true").length;
}

/** The distinct values an SVG attribute took during the change. */
async function attributeSteps(page: Page, selector: string, attribute: string) {
  const samples = await sampleWhile(page, "Previous month", { selector, attribute });

  return new Set(samples).size;
}

/**
 * An amount as screen readers hear it, exactly: its whole text, where the rolling digits beside
 * it are hidden from them (and would also match a text search).
 */
function spokenAmount(page: Page, text: string) {
  const exactly = new RegExp(`^${text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}$`);

  return page.locator('[data-slot="amount"] > .sr-only').filter({ hasText: exactly });
}

async function heightOf(page: Page, url: string, selector: string) {
  await page.goto(url);

  const box = await page.locator(selector).first().boundingBox();

  expect(box).not.toBeNull();

  return box?.height ?? 0;
}

test.describe("Amount", () => {
  test("writes an amount with its sign, currency and separators", async ({ page }) => {
    await page.goto(story("amount", "signs"));
    await expect(spokenAmount(page, "−€80.00")).toBeAttached();
    await expect(spokenAmount(page, "+€26.50")).toBeAttached();
    await expect(spokenAmount(page, "€0.00")).toBeAttached();
  });

  test("follows the page's language: French formatting on <html lang=fr>", async ({ page }) => {
    await page.goto(story("amount", "default"));
    await expect(spokenAmount(page, "€3,120.00")).toBeAttached();
    await page.evaluate(() => {
      document.documentElement.lang = "fr";
    });
    await expect(
      spokenAmount(page, `3${NARROW_NO_BREAK_SPACE}120,00${NO_BREAK_SPACE}€`),
    ).toBeAttached();
  });

  test("draws no style attribute before its value changes (strict CSP)", async ({ page }) => {
    await page.goto(story("amount", "changing-month"));
    await expect(page.locator('[data-slot="amount"]').first()).toBeVisible();
    await expect(
      page.locator('[data-slot="amount"] [style], [data-slot="amount"][style]'),
    ).toHaveCount(0);
  });

  test("rolls its digits to the next value", async ({ page }) => {
    await page.goto(story("amount", "changing-month"));
    await expect(spokenAmount(page, "€2,030")).toBeAttached();
    // The roll lasts 200 ms, about 150 of them with both digits drawn: some nine frames at 60 fps.
    // More than 2 leaves room for a slow runner, and is still far from reduced motion's 0.
    expect(await rollingFrames(page)).toBeGreaterThan(2);
    await expect(spokenAmount(page, "€1,934")).toBeAttached();
    await expect(page.locator('[data-slot="rolling-digit"]').first().locator("> *")).toHaveCount(1);
  });

  test("does not roll under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(story("amount", "changing-month"));
    await expect(spokenAmount(page, "€2,030")).toBeAttached();
    expect(await rollingFrames(page)).toBe(0);
    await expect(spokenAmount(page, "€1,934")).toBeAttached();
  });

  test("its skeleton has its height at each size", async ({ page }) => {
    await page.goto(story("amount", "loading"));

    for (const row of await page.locator("#storybook-root > div > div").all()) {
      const skeleton = await row.locator('[data-slot="skeleton"]').boundingBox();
      const amount = await row.locator('[data-slot="amount"]').boundingBox();

      expect(skeleton?.height).toBe(amount?.height);
    }
  });
});

test.describe("Delta", () => {
  test("spending up is red, and says what it is against", async ({ page }) => {
    await page.goto(story("delta", "spending-up"));

    const delta = page.locator('[data-slot="delta"]');

    await expect(delta).toHaveAttribute("data-trend", "up");
    await expect(delta).toHaveClass(/text-destructive/);
    await expect(delta).toContainText("+5%");
    await expect(page.getByText("5% more than your 6-month average")).toBeAttached();
  });

  test("spending down is green", async ({ page }) => {
    await page.goto(story("delta", "spending-down"));

    const delta = page.locator('[data-slot="delta"]');

    await expect(delta).toHaveAttribute("data-trend", "down");
    await expect(delta).toHaveClass(/text-money-income/);
    await expect(delta).toContainText("−7%");
  });

  test("income up is green, savings down is red", async ({ page }) => {
    await page.goto(story("delta", "income-up"));
    await expect(page.locator('[data-slot="delta"]')).toHaveClass(/text-money-income/);
    await page.goto(story("delta", "savings-down"));
    await expect(page.locator('[data-slot="delta"]')).toHaveClass(/text-destructive/);
  });

  test("nearly no change is grey", async ({ page }) => {
    await page.goto(story("delta", "steady"));

    const delta = page.locator('[data-slot="delta"]');

    await expect(delta).toHaveAttribute("data-trend", "steady");
    await expect(delta).toHaveClass(/text-muted-foreground/);
    await expect(page.getByText("About the same as your 6-month average")).toBeAttached();
  });

  test("against nothing, it shows the amount", async ({ page }) => {
    await page.goto(story("delta", "against-nothing"));
    await expect(page.locator('[data-slot="delta"]')).toContainText("+€98.00");
  });

  test("writes French", async ({ page }) => {
    await page.goto(story("delta", "french"));
    await expect(
      page.getByText(`5${NO_BREAK_SPACE}% de plus que votre moyenne sur 6 mois`),
    ).toBeAttached();
  });

  test("its colour moves in 150 ms, and not under reduced motion", async ({ page }) => {
    await page.goto(story("delta", "spending-up"));

    const delta = page.locator('[data-slot="delta"]');

    await expect(delta).toHaveCSS("transition-duration", "0.15s");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(delta).toHaveCSS("transition-duration", "0s");
  });
});

test.describe("MonthBar", () => {
  test("cuts the money received into its parts, each with its amount", async ({ page }) => {
    await page.goto(story("month-bar", "default"));
    await expect(spokenAmount(page, "€3,120")).toBeAttached();

    const parts = page.getByRole("group", { name: "What came in, by part" });

    await expect(parts.getByRole("button")).toHaveCount(3);
    await expect(parts.getByRole("button", { name: "€2,030 spent" })).toBeVisible();
    await expect(parts.getByRole("button", { name: "€600 set aside" })).toBeVisible();
    await expect(parts.getByRole("button", { name: "€490 left" })).toBeVisible();
    await expect(page.locator('rect[data-role="spent"]')).toHaveAttribute("width", /^65\.0/);
    await expect(page.locator('[data-slot="month-bar-received-mark"]')).toHaveCount(0);
  });

  test("each part is reached and chosen with the keyboard", async ({ page }) => {
    await page.goto(story("month-bar", "default"));
    await expect(page.getByRole("button", { name: "€2,030 spent" })).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "€2,030 spent" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "€600 set aside" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("chosen")).toHaveText("Chosen: saved");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Space");
    await expect(page.getByTestId("chosen")).toHaveText("Chosen: left");
  });

  // Under its parts, the legend sat at fixed thirds that matched none of them (#83): on a wide
  // screen it is a compact one, its keys side by side from the bar's start, whatever the parts'
  // widths. On every project, the phone's too, at a desktop's width.
  for (const name of ["default", "narrow-part"]) {
    test(`its legend sits side by side from the bar's start (${name})`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto(story("month-bar", name));

      const bar = await page.locator('[data-slot="month-bar-drawing"]').boundingBox();

      // Where each key's text is drawn (its two lines), not its box: a box can stretch to a column
      // wider than what it holds.
      const keys = await page
        .getByRole("group", { name: "What came in, by part" })
        .evaluate((group) =>
          [...group.children].map((key) => {
            const lines = [...key.children].map((line) => line.getBoundingClientRect());

            return {
              top: key.getBoundingClientRect().top,
              left: Math.min(...lines.map((line) => line.left)),
              right: Math.max(...lines.map((line) => line.right)),
            };
          }),
        );

      expect(bar).not.toBeNull();
      expect(keys).toHaveLength(3);

      const [first, ...others] = keys;
      const barLeft = bar?.x ?? 0;

      expect(Math.abs((first?.left ?? 0) - barLeft)).toBeLessThanOrEqual(1);

      for (const [index, key] of others.entries()) {
        const gap = key.left - (keys[index]?.right ?? 0);

        expect(key.top).toBe(first?.top);
        expect(gap).toBeGreaterThanOrEqual(8);
        expect(gap).toBeLessThanOrEqual(32);
      }

      expect(keys.at(-1)?.right ?? 0).toBeLessThanOrEqual(barLeft + (bar?.width ?? 0));
    });
  }

  // On a phone the width does not allow them side by side (the wireframe `mobile`, #36): a list,
  // one row a key, at the narrowest phone it is drawn for (Storybook's `mobile1`), in its block.
  test("on a phone its legend is a list under the bar, every name whole", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(story("month-bar", "phone"));

    const bar = await page.locator('[data-slot="month-bar-drawing"]').boundingBox();
    const group = page.getByRole("group", { name: "What came in, by part" });

    // Each row: its box, where its name and its amount are drawn, and whether its name is cut.
    const rows = await group.evaluate((legend) =>
      [...legend.children].map((row) => {
        const name = row.querySelector('[data-slot="month-bar-key-name"]');
        const amount = row.querySelector('[data-slot="amount"]');

        const box = row.getBoundingClientRect();

        return {
          box: { top: box.top, bottom: box.bottom, width: box.width },
          nameRight: name?.getBoundingClientRect().right ?? 0,
          amountLeft: amount?.getBoundingClientRect().left ?? 0,
          nameCut: name === null || name.scrollWidth > name.clientWidth,
        };
      }),
    );

    expect(bar).not.toBeNull();
    expect(rows).toHaveLength(3);
    await expect(group.getByRole("button", { name: /restricted$/ })).toBeVisible();

    for (const [index, row] of rows.entries()) {
      // One under the other, each as wide as the bar, give or take its 4 px of hover band.
      expect(row.box.top).toBeGreaterThanOrEqual(rows[index - 1]?.box.bottom ?? 0);
      expect(Math.abs(row.box.width - (bar?.width ?? 0))).toBeLessThanOrEqual(8);
      // The name first and whole, the amount after it.
      expect(row.nameCut).toBe(false);
      expect(row.amountLeft).toBeGreaterThan(row.nameRight);
    }

    // The comparison on a line of its own, between the total (the bar's first amount) and the bar.
    const [comparison, total] = await Promise.all([
      page.locator('[data-slot="month-bar-comparison"]').boundingBox(),
      page.locator('[data-slot="month-bar"] [data-slot="amount"]').first().boundingBox(),
    ]);

    expect(comparison?.y ?? 0).toBeGreaterThanOrEqual(
      (total?.y ?? Number.POSITIVE_INFINITY) + (total?.height ?? 0),
    );
    expect((comparison?.y ?? 0) + (comparison?.height ?? 0)).toBeLessThanOrEqual(bar?.y ?? 0);

    // It says what it compares, in words as on a wide screen, and stays within the bar's width:
    // a bare "+5%" under the money received would read as more income.
    const said = page.locator('[data-slot="month-bar-comparison"]');

    for (const words of ["spending", "vs. average", "vs. September"]) {
      await expect(said.getByText(words, { exact: true })).toBeVisible();
    }

    expect((comparison?.x ?? 0) + (comparison?.width ?? 0)).toBeLessThanOrEqual(
      (bar?.x ?? 0) + (bar?.width ?? 0) + 1,
    );

    // The rules between the rows (each row's bottom border but the last's): plain and identical,
    // square at their ends, no shadow.
    const rules = await group.evaluate((legend) =>
      [...legend.children].slice(0, -1).map((row) => {
        const style = getComputedStyle(row);

        return [
          style.borderBottomWidth,
          style.borderBottomStyle,
          style.borderBottomColor,
          style.borderBottomLeftRadius,
          style.borderBottomRightRadius,
          style.boxShadow,
        ].join(" ");
      }),
    );

    expect(rules).toHaveLength(2);
    expect(rules[0]).toMatch(/^1px solid \S+.* 0px 0px none$/);
    expect(rules[1]).toBe(rules[0]);
  });

  test("its skeleton has the loaded bar's height on a phone too", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });

    const loaded = await heightOf(page, story("month-bar", "default"), '[data-slot="month-bar"]');

    const loading = await heightOf(
      page,
      story("month-bar", "loading"),
      '[data-slot="skeleton-frame"]',
    );

    expect(loading).toBe(loaded);
  });

  test("an overspent month says by how much, and marks where the money received ended", async ({
    page,
  }) => {
    await page.goto(story("month-bar", "overspent"));
    await expect(page.getByRole("button", { name: "€375 overspent" })).toBeVisible();
    await expect(page.locator('[data-slot="month-bar-received-mark"]')).toHaveCount(1);
    await expect(page.locator('rect[data-role="left"]')).toHaveAttribute("width", "0%");
  });

  test("money taken back from savings leaves money, not an overspent month", async ({ page }) => {
    await page.goto(story("month-bar", "taken-from-savings"));
    await expect(page.getByText("taken from savings")).toBeVisible();
    await expect(spokenAmount(page, "€500")).toBeAttached();
    await expect(spokenAmount(page, "€200")).toBeAttached();
    await expect(page.getByText("overspent")).toHaveCount(0);
    await expect(page.locator('[data-slot="month-bar-received-mark"]')).toHaveCount(0);
    await expect(page.locator('rect[data-role="saved"]')).toHaveAttribute("width", "0%");
  });

  test("an empty month has an empty bar and nothing to click", async ({ page }) => {
    await page.goto(story("month-bar", "empty"));
    await expect(spokenAmount(page, "€0").first()).toBeAttached();
    await expect(page.getByRole("button")).toHaveCount(0);
    await expect(page.locator('rect[data-role="spent"]')).toHaveAttribute("width", "0%");
  });

  test("writes French", async ({ page }) => {
    await page.goto(story("month-bar", "french"));
    await expect(page.getByText("reçus")).toBeVisible();
    await expect(
      spokenAmount(page, `2${NARROW_NO_BREAK_SPACE}030${NO_BREAK_SPACE}€`),
    ).toBeAttached();
    await expect(page.getByText("mis de côté")).toBeVisible();
  });

  test("its skeleton has the loaded bar's height", async ({ page }) => {
    const loaded = await heightOf(page, story("month-bar", "default"), '[data-slot="month-bar"]');

    const loading = await heightOf(
      page,
      story("month-bar", "loading"),
      '[data-slot="skeleton-frame"]',
    );

    expect(loading).toBe(loaded);
  });

  test("its parts grow to the new month", async ({ page }) => {
    await page.goto(story("month-bar", "changing-month"));
    await expect(page.getByRole("button", { name: "Previous month" })).toBeVisible();
    // Old width, new width, and the steps between them.
    expect(await attributeSteps(page, 'rect[data-role="spent"]', "width")).toBeGreaterThan(3);
  });

  test("its parts jump to the new month under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(story("month-bar", "changing-month"));
    await expect(page.getByRole("button", { name: "Previous month" })).toBeVisible();
    expect(await attributeSteps(page, 'rect[data-role="spent"]', "width")).toBeLessThanOrEqual(2);
  });
});

test.describe("Breakdown", () => {
  test("shows its rows, cut with a button for the others, each a button", async ({ page }) => {
    await page.goto(story("breakdown", "default"));

    const rows = page.locator('[data-slot="breakdown"] > li');

    await expect(rows).toHaveCount(6);
    await expect(page.getByRole("button", { name: /^Housing/ })).toBeVisible();
    await page.getByRole("button", { name: "Show the other 3" }).click();
    await expect(rows).toHaveCount(8);
  });

  test("writes French", async ({ page }) => {
    await page.goto(story("breakdown", "french"));
    await expect(page.getByText("+ 3 de plus")).toBeVisible();
    await expect(spokenAmount(page, `690${NO_BREAK_SPACE}€`)).toBeAttached();
    await expect(page.getByRole("img", { name: "Au-dessus du repère" }).first()).toBeVisible();
  });

  test("marks the benchmark, with ⚠ once it is passed", async ({ page }) => {
    await page.goto(story("breakdown", "default"));

    const leisure = page.getByRole("button", { name: /^Leisure/ });
    const housing = page.getByRole("button", { name: /^Housing/ });

    await expect(leisure.getByRole("img", { name: "Above the benchmark" })).toBeVisible();
    await expect(housing.getByRole("img", { name: "Above the benchmark" })).toHaveCount(0);
    await expect(leisure.locator('[data-slot="breakdown-benchmark"]')).toHaveAttribute(
      "x",
      /^23\.18/,
    );
    await expect(leisure).toContainText("benchmark €160");
  });

  test("a benchmark the user set is marked and read as set, passed by any amount, none without a mark", async ({
    page,
  }) => {
    await page.goto(story("breakdown", "benchmarks"));

    const row = (name: string) =>
      page.locator('[data-slot="breakdown"] > li').filter({ hasText: name });

    const over = (name: string) => row(name).getByRole("img", { name: "Above the benchmark" });

    await expect(over("Groceries")).toBeVisible();
    await expect(row("Groceries")).toContainText("benchmark €395");
    await expect(over("Leisure")).toBeVisible();
    await expect(row("Leisure")).toContainText("benchmark €100, set");
    // Reached, not passed.
    await expect(over("Transport")).toHaveCount(0);
    await expect(row("Transport").locator('[data-slot="breakdown-benchmark"]')).toHaveCount(1);

    for (const name of ["Gifts", "Pets"]) {
      await expect(over(name)).toHaveCount(0);
      await expect(row(name).locator('[data-slot="breakdown-benchmark"]')).toHaveCount(0);
      await expect(row(name).locator('[data-slot="breakdown-benchmark-text"]')).toHaveCount(0);
    }
  });

  test("a row is chosen with the keyboard", async ({ page }) => {
    await page.goto(story("breakdown", "default"));
    await expect(page.getByRole("button", { name: /^Housing/ })).toBeVisible();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: /^Groceries/ })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("chosen")).toHaveText("Chosen: groceries");
  });

  test("says when there is nothing, in its words or the page's", async ({ page }) => {
    await page.goto(story("breakdown", "empty"));
    await expect(page.getByText("Nothing to show this month.")).toBeVisible();
    await page.goto(story("breakdown", "empty-with-text"));
    await expect(
      page.getByText("No subject this month. Tag a line to follow a project."),
    ).toBeVisible();
  });

  test("its skeleton has the loaded list's height", async ({ page }) => {
    const loaded = await heightOf(page, story("breakdown", "default"), '[data-slot="breakdown"]');

    const loading = await heightOf(
      page,
      story("breakdown", "loading"),
      '[data-slot="skeleton-frame"]',
    );

    expect(loading).toBe(loaded);
  });

  test("its bars grow to the new month", async ({ page }) => {
    await page.goto(story("breakdown", "changing-month"));
    await expect(page.getByRole("button", { name: "Previous month" })).toBeVisible();
    expect(
      await attributeSteps(page, 'li:nth-child(2) [data-slot="breakdown-fill"]', "width"),
    ).toBeGreaterThan(3);
  });

  test("its bars jump to the new month under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(story("breakdown", "changing-month"));
    await expect(page.getByRole("button", { name: "Previous month" })).toBeVisible();
    expect(
      await attributeSteps(page, 'li:nth-child(2) [data-slot="breakdown-fill"]', "width"),
    ).toBeLessThanOrEqual(2);
  });
});
