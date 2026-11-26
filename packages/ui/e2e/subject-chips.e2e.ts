import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

// What an expense is for (#37) where it meets the money: a subject's chips and their field, the
// operations' column and filter, the split's shares, an account's lines and the review's "by
// subject"; their behaviour and their motion, in every browser of the config. Their reference
// screenshots are `stories.e2e.ts`'s, drawn by CI only.

const story = (id: string) => `/iframe.html?id=${id}&viewMode=story`;

const chips = (within: Locator) => within.locator('[data-slot="subject-chip"]');

/** The detail's field, its "+ Add", and a subject chosen in its picker by typing. */
async function add(page: Page, within: Locator, button: string, picker: string, name: string) {
  await within.getByRole("button", { name: button, exact: true }).click();

  const field = within.getByRole("combobox", { name: picker, exact: true });

  await expect(field).toBeFocused();
  await field.pressSequentially(name);
  await expect(page.getByRole("option", { name, exact: true })).toBeVisible();
  await field.press("Enter");
}

/**
 * Samples, from the press on `trigger` and for `forMs`, the opacity of the chip whose text holds
 * `name` ("gone" while there is none).
 */
async function chipOpacity(page: Page, trigger: Locator, name: string, forMs = 600) {
  const frames = page.evaluate(
    ({ wanted, duration }) =>
      new Promise<Array<string>>((resolve) => {
        const seen: Array<string> = [];

        document.addEventListener(
          "pointerdown",
          () => {
            const start = performance.now();

            const sample = () => {
              const chip = [...document.querySelectorAll('[data-slot="subject-chip"]')].find(
                (each) => (each.textContent ?? "").includes(wanted),
              );

              seen.push(chip === undefined ? "gone" : getComputedStyle(chip).opacity);

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
      }),
    { wanted: name, duration: forMs },
  );

  await trigger.click();

  return frames;
}

const between = (frames: ReadonlyArray<string>) =>
  frames.filter((opacity) => opacity !== "gone" && Number(opacity) > 0 && Number(opacity) < 1);

test.describe("SubjectsField", () => {
  test("+ Add shows a picker with the focus; a choice adds its chip, a remove takes it off", async ({
    page,
  }) => {
    await page.goto(story("subjects-subjectchips--none-yet"));

    const field = page.getByRole("region", { name: "Subjects" });

    await expect(field).toContainText("None yet");
    await add(page, field, "Add a subject", "Subject to add", "Van");
    await expect(chips(field)).toHaveText(["Van"]);
    await expect(field).not.toContainText("None yet");
    // The picker hides again; a subject chosen is not offered twice.
    await expect(field.getByRole("combobox", { name: "Subject to add" })).toHaveCount(0);
    await field.getByRole("button", { name: "Add a subject", exact: true }).click();
    await field.getByRole("combobox", { name: "Subject to add", exact: true }).click();
    await expect(page.getByRole("option", { name: "House > Garden shed" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Van", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await field.getByRole("button", { name: "Remove Van" }).click();
    await expect(chips(field)).toHaveCount(0);
    await expect(field).toContainText("None yet");
  });

  test("a refusal is said under the field", async ({ page }) => {
    await page.goto(story("subjects-subjectchips--refused"));

    await expect(page.getByRole("alert")).toContainText("This subject is archived");
  });

  test("a row's chips stop at its limit, the others said as +N", async ({ page }) => {
    await page.goto(story("subjects-subjectchips--limited"));

    await expect(chips(page.locator("#storybook-root"))).toHaveText(["House", "Garden shed"]);
    await expect(page.locator('[data-slot="subject-chips"]')).toContainText("+1");
  });

  test("in French", async ({ page }) => {
    await page.goto(story("subjects-subjectchips--french"));

    const field = page.getByRole("region", { name: "Sujets" });

    await expect(field.getByRole("button", { name: "Ajouter un sujet" })).toBeVisible();
    await expect(field.getByRole("button", { name: "Retirer Van" })).toBeVisible();
  });

  for (const reduced of [false, true]) {
    test(`a chip fades in and out in 150 ms; ${reduced ? "cut under reduced motion" : "in full"}`, async ({
      page,
    }) => {
      if (reduced) {
        await page.emulateMedia({ reducedMotion: "reduce" });
      }

      await page.goto(story("subjects-subjectchips--in-detail"));

      const field = page.getByRole("region", { name: "Subjects" });

      const leaving = await chipOpacity(
        page,
        field.getByRole("button", { name: "Remove Alps 2026" }),
        "Alps",
      );

      await expect(chips(field)).toHaveText(["Van"]);

      await field.getByRole("button", { name: "Add a subject", exact: true }).click();

      const picker = field.getByRole("combobox", { name: "Subject to add", exact: true });

      await picker.pressSequentially("House");
      await expect(page.getByRole("option", { name: "House", exact: true })).toBeVisible();

      const coming = await chipOpacity(
        page,
        page.getByRole("option", { name: "House", exact: true }),
        "House",
      );

      await expect(chips(field)).toHaveText(["Van", "House"]);

      if (reduced) {
        expect(between(leaving)).toEqual([]);
        expect(between(coming)).toEqual([]);
      } else {
        expect(between(leaving).length).toBeGreaterThan(1);
        expect(between(coming).length).toBeGreaterThan(1);
      }
    });
  }
});

test.describe("The operations' subjects", () => {
  test("a wide list has a Subjects column of chips; a phone's gives it up", async ({
    page,
    isMobile,
  }) => {
    await page.goto(story("operations-operationslist--with-subjects"));

    const row = page.locator('[data-slot="operation-row"]').nth(4);

    if (isMobile) {
      await expect(row.locator('[data-slot="subject-chips"]')).toBeHidden();

      return;
    }

    await expect(row.locator('[data-slot="subject-chips"]')).toBeVisible();
    await expect(chips(row)).toHaveText(["House", "Garden shed"]);
    await expect(row).toContainText("+1");
    await expect(
      page.locator('[data-slot="operation-row"]').nth(1).locator('[data-slot="subject-chip"]'),
    ).toHaveCount(0);
  });

  test("the filter offers every subject by its path, after the account; on a phone in the sheet", async ({
    page,
    isMobile,
  }) => {
    await page.goto(
      story(
        isMobile
          ? "operations-operationsfilters--phone-with-subjects"
          : "operations-operationsfilters--with-subjects",
      ),
    );

    let fields = page.getByRole("group", { name: "Filters" });

    if (isMobile) {
      const button = page.getByRole("button", { name: /^Filters/ });

      // The account, the subject, the period, the amount and "To review only": all five set.
      await expect(button).toContainText("5");
      await button.click();
      fields = page.getByRole("dialog", { name: "Filters" });
    }

    const subject = fields.getByRole("combobox", { name: "Subject", exact: true });

    await expect(subject).toBeVisible();
    await subject.click();
    await expect(page.getByRole("option")).toHaveText([
      "All subjects",
      "House",
      "House > Garden shed",
      "Van",
      "Alps 2028",
    ]);
    await page.getByRole("option", { name: "All subjects" }).click();
    await expect(subject).toContainText("All subjects");
  });

  test("an account's lines have their subjects as chips, a phone's none", async ({
    page,
    isMobile,
  }) => {
    await page.goto(story("accounts-accountlines--with-subjects"));

    const line = page.locator('[data-slot="account-lines"] li').nth(1);

    if (isMobile) {
      await expect(line.locator('[data-slot="subject-chips"]')).toBeHidden();
    } else {
      await expect(chips(line)).toHaveText(["House"]);
    }
  });
});
