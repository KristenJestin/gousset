import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

// The subjects' components (#37): the tree, a subject's figures, what a dated subject proposes,
// what attaches it, and its sheet; their behaviour and their motion, in every browser of the
// config. Their reference screenshots are `stories.e2e.ts`'s, drawn by CI only.

const story = (component: string, name: string) =>
  `/iframe.html?id=subjects-${component}--${name}&viewMode=story`;

/** The longest transition of an element, in seconds, as the browser computes it. */
async function transitionSeconds(element: Locator) {
  const durations = await element.evaluate((node) => getComputedStyle(node).transitionDuration);

  return Math.max(...durations.split(",").map((value) => Number.parseFloat(value)));
}

/**
 * What to read at each frame: whether a digit of the element `slot` rolls (an animation of the
 * page's, running), or the opacity of the proposal whose text holds `title` ("gone" once it is).
 */
type Reading = { kind: "rolling"; slot: string } | { kind: "opacity"; title: string };

/** Samples `reading` at every frame for `forMs` from the press on `trigger`. */
async function framesFromPress(page: Page, trigger: Locator, reading: Reading, forMs = 700) {
  const frames = page.evaluate(
    ({ wanted, duration }) => {
      // Runs in the page: everything it needs is in its arguments.
      const readNow = () => {
        if (wanted.kind === "rolling") {
          const digits = document.querySelectorAll(
            `[data-slot="${wanted.slot}"] [data-slot="rolling-digit"] *`,
          );

          return String(
            [...digits].some((digit) =>
              digit.getAnimations().some((animation) => animation.playState === "running"),
            ),
          );
        }

        const row = [...document.querySelectorAll('[data-slot="subject-proposal"]')].find((each) =>
          (each.textContent ?? "").includes(wanted.title),
        );

        return row === undefined ? "gone" : getComputedStyle(row).opacity;
      };

      return new Promise<Array<string>>((resolve) => {
        const seen: Array<string> = [];

        document.addEventListener(
          "pointerdown",
          () => {
            const start = performance.now();

            const sample = () => {
              seen.push(readNow());

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
    { wanted: reading, duration: forMs },
  );

  await trigger.click();

  return frames;
}

const ROLLING_COST: Reading = { kind: "rolling", slot: "subject-cost" };

const proposalRows = (page: Page) => page.locator('[data-slot="subject-proposal"]');

/** How many proposals are left, as screen readers hear it (the rolling digits are hidden). */
const left = (page: Page) =>
  page.locator('[data-slot="proposals-count"] [data-slot="count"] > span').first();

const sheet = (page: Page, name = "New subject") => page.getByRole("dialog", { name });

test.describe("SubjectTree", () => {
  test("each subject is a link, the one shown marked, a child indented, an archived one said so", async ({
    page,
  }) => {
    await page.goto(story("subjecttree", "default"));

    const tree = page.getByRole("navigation", { name: "Your subjects" });

    const row = (name: string) =>
      tree
        .locator('[data-slot="subject-row"]')
        .filter({ has: page.getByText(name, { exact: true }) });

    await expect(tree.getByRole("link")).toHaveCount(6);
    await expect(row("Van")).toHaveAttribute("aria-current", "page");
    await expect(row("Van")).toContainText("€165/month");
    await expect(row("Alps 2028")).toContainText("3–17 Jul. 2028");
    await expect(row("Garden shed")).toHaveAttribute("data-depth", "1");

    const indent = async (name: string) =>
      row(name).evaluate((node) => Number.parseFloat(getComputedStyle(node).paddingInlineStart));

    expect(await indent("Garden shed")).toBeGreaterThan(await indent("House"));
    await expect(row("Dog")).toHaveAttribute("data-archived", "");
    await expect(row("Dog")).toContainText("archived");
    await expect(tree.getByRole("button", { name: "New" })).toBeVisible();
  });

  test("in French, an archived subject is “archivé”, its own word", async ({ page }) => {
    await page.goto(story("subjecttree", "french"));

    await expect(page.locator('[data-slot="subject-row"][data-archived]')).toContainText("archivé");
    await expect(page.locator('[data-slot="subject-row"][data-archived]')).not.toContainText(
      "archivée",
    );
  });

  test("on a phone, the tree comes first and the subject's page under it", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(story("subjecttree", "phone"));

    const tree = await page.getByRole("navigation", { name: "Your subjects" }).boundingBox();
    const subject = await page.getByText("Van’s page").boundingBox();

    expect(subject?.y ?? 0).toBeGreaterThan((tree?.y ?? 0) + (tree?.height ?? 0) - 1);
  });
});

test.describe("SubjectFigures", () => {
  test("value and loan appear only for a subject that has a value; other currencies apart", async ({
    page,
  }) => {
    await page.goto(story("subjectfigures", "with-loan"));
    await expect(page.locator('[data-slot="subject-value"]')).toContainText("€320,000");
    await expect(page.locator('[data-slot="subject-loan"]')).toContainText("Harbor Savings loan");

    await page.goto(story("subjectfigures", "dated"));
    await expect(page.locator('[data-slot="subject-cost"]')).toContainText("€1,240");
    await expect(page.locator('[data-slot="subject-value"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="subject-loan"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="subject-elsewhere"]')).toHaveText(
      /^Also CHF\s180\.00, not converted\.$/,
    );
  });

  test("changing the period rolls the amounts in 200 ms", async ({ page }) => {
    await page.goto(story("subjectfigures", "changing-period"));
    await expect(page.locator('[data-slot="subject-cost"]')).toContainText("€1,980");

    const frames = await framesFromPress(
      page,
      page.getByRole("button", { name: "Show all time" }),
      ROLLING_COST,
    );

    const rolling = frames.filter((each) => each === "true");

    expect(rolling.length).toBeGreaterThan(1);
    expect(frames.at(-1)).toBe("false");
    await expect(page.locator('[data-slot="subject-cost"]')).toContainText("€7,425");
  });

  test("under reduced motion, the amounts change at once", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(story("subjectfigures", "changing-period"));
    await expect(page.locator('[data-slot="subject-cost"]')).toContainText("€1,980");

    const frames = await framesFromPress(
      page,
      page.getByRole("button", { name: "Show all time" }),
      ROLLING_COST,
    );

    expect(frames.filter((each) => each === "true")).toEqual([]);
    await expect(page.locator('[data-slot="subject-cost"]')).toContainText("€7,425");
  });
});

test.describe("SubjectProposals", () => {
  const rows = proposalRows;
  const LODGE: Reading = { kind: "opacity", title: "Alpine Lodge" };

  test("nothing is selected; each row, a selection or all of them are attached or declined", async ({
    page,
  }) => {
    await page.goto(story("subjectproposals", "default"));
    await expect(rows(page)).toHaveCount(4);
    await expect(left(page)).toHaveText("4");

    for (const box of await page.getByRole("checkbox").all()) {
      await expect(box).not.toBeChecked();
    }

    await expect(page.getByRole("button", { name: "Attach selected" })).toBeDisabled();

    await page.getByRole("button", { name: "Attach Fuelstop, 3 Jul." }).click();
    await expect(page.getByTestId("said")).toHaveText("Attached: 1");
    await expect(rows(page)).toHaveCount(3);
    await expect(left(page)).toHaveText("3");

    await page.getByRole("checkbox", { name: "Select Alpine Lodge, 4 Jul." }).click();
    await page.getByRole("checkbox", { name: "Select Summit Café, 6 Jul." }).click();
    await page.getByRole("button", { name: "Not for this subject", exact: true }).click();
    await expect(page.getByTestId("said")).toHaveText("Declined: 2, 3");
    await expect(rows(page)).toHaveCount(1);

    await page.getByRole("button", { name: "Attach all" }).click();
    await expect(page.getByTestId("said")).toHaveText("Attached: 4");
    await expect(rows(page)).toHaveCount(0);
    await expect(page.getByText("Nothing to confirm")).toBeVisible();
  });

  test("a refused attachment puts the rows back", async ({ page }) => {
    await page.goto(story("subjectproposals", "refused"));
    await page.getByRole("button", { name: "Attach Fuelstop, 3 Jul." }).click();
    await expect(page.getByTestId("said")).toHaveText("Refused: the rows come back");
    await expect(rows(page)).toHaveCount(4);
    await expect(left(page)).toHaveText("4");
  });

  test("a row attached folds away, fading out in 200 ms", async ({ page }) => {
    await page.goto(story("subjectproposals", "default"));
    await expect(rows(page)).toHaveCount(4);

    const frames = await framesFromPress(
      page,
      page.getByRole("button", { name: "Attach Alpine Lodge, 4 Jul." }),
      LODGE,
    );

    const fading = frames.filter(
      (opacity) => opacity !== "gone" && Number(opacity) > 0 && Number(opacity) < 1,
    );

    expect(fading.length).toBeGreaterThan(1);
    expect(frames.at(-1)).toBe("gone");
  });

  test("under reduced motion, a row attached is gone at once", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(story("subjectproposals", "default"));
    await expect(rows(page)).toHaveCount(4);

    const frames = await framesFromPress(
      page,
      page.getByRole("button", { name: "Attach Alpine Lodge, 4 Jul." }),
      LODGE,
    );

    expect(
      frames.filter((opacity) => opacity !== "gone" && Number(opacity) > 0 && Number(opacity) < 1),
    ).toEqual([]);
    expect(frames.at(-1)).toBe("gone");
  });
});

test.describe("SubjectMerchants", () => {
  test("the merchants as chips, then how many other rules attach it", async ({ page }) => {
    await page.goto(story("subjectmerchants", "with-other-rules"));
    await expect(page.locator('[data-slot="subject-merchants"] li')).toHaveCount(3);
    await expect(page.getByText("and 2 other rules")).toBeVisible();

    await page.goto(story("subjectmerchants", "nothing"));
    await expect(
      page.getByText("No merchant attaches its expenses here automatically."),
    ).toBeVisible();

    await page.goto(story("subjectmerchants", "french"));
    await expect(page.getByText("et 1 autre règle")).toBeVisible();
  });
});

test.describe("SubjectEditor", () => {
  test("it opens on its name; its merchants are added and taken off, their past offered", async ({
    page,
  }) => {
    await page.goto(story("subjecteditor", "default"));

    const editor = sheet(page);

    await expect(editor.getByRole("textbox", { name: "Name" })).toBeFocused();
    await expect(editor.getByRole("checkbox", { name: "Archived" })).toHaveCount(0);
    await expect(editor.locator('[data-slot="subject-past"]')).toHaveText(
      "9 expenses match (€486).",
    );
    await expect(editor.getByRole("checkbox", { name: "Attach them" })).toBeChecked();

    await editor.getByRole("button", { name: "Merchant", exact: true }).click();

    const picker = editor.getByRole("combobox", { name: "Merchant to attach" });

    await expect(picker).toBeFocused();
    await picker.pressSequentially("Fuel");
    await page.getByRole("option", { name: "Fuelstop", exact: true }).click();
    await expect(editor.getByRole("button", { name: "Remove Fuelstop" })).toBeVisible();

    for (const name of ["Cycle Hub", "Pedal Cover insurance", "Fuelstop"]) {
      await editor.getByRole("button", { name: `Remove ${name}` }).click();
    }

    await expect(editor.getByText("Add a merchant to find its past expenses.")).toBeVisible();
  });

  test("while it is sent it stays open, its button busy; then it closes", async ({ page }) => {
    await page.goto(story("subjecteditor", "default"));

    const editor = sheet(page);
    const create = editor.getByRole("button", { name: "Create the subject" });

    await create.click();
    await expect(create).toHaveAttribute("aria-busy", "true");
    await page.keyboard.press("Escape");
    await expect(editor).toBeVisible();
    await expect(editor).toBeHidden();
    await expect(page.getByTestId("saved")).toContainText('"name":"Bicycle"');
  });

  test("a saved one may be archived; a refusal is said under its field", async ({ page }) => {
    await page.goto(story("subjecteditor", "saved"));
    await expect(
      sheet(page, "Edit Alps 2028").getByRole("checkbox", { name: "Archived" }),
    ).toBeVisible();

    await page.goto(story("subjecteditor", "refused"));

    const inside = sheet(page, "Edit House").getByRole("combobox", { name: "Inside", exact: true });

    await expect(inside).toHaveAccessibleDescription(
      /A subject cannot go inside itself, nor inside one of its own\./,
    );
  });

  test("it slides in from the right in 300 ms over a backdrop fading in 200 ms; from the bottom on a phone", async ({
    page,
  }) => {
    await page.goto(story("subjecteditor", "default"));

    const content = page.locator('[data-slot="dialog-content"]');

    await expect(content).toBeVisible();
    expect(await transitionSeconds(content)).toBe(0.3);
    expect(await transitionSeconds(page.locator('[data-slot="dialog-backdrop"]'))).toBe(0.2);

    const wide = (page.viewportSize()?.width ?? 0) >= 768;

    await expect(content).toHaveAttribute("data-side", wide ? "right" : "bottom");
  });

  test("under reduced motion it is there at once", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(story("subjecteditor", "default"));

    const content = page.locator('[data-slot="dialog-content"]');

    await expect(content).toBeVisible();
    expect(await transitionSeconds(content)).toBe(0);
    expect(await transitionSeconds(page.locator('[data-slot="dialog-backdrop"]'))).toBe(0);
  });
});
