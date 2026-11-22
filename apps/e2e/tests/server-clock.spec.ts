import { expect, fixDay, test, visit } from "../src/test";

const PROBE = "/e2e/today";

/** `YYYY-MM-DD` in the machine's time zone, as the server reads its own clock. */
function localDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${date.getFullYear()}-${month}-${day}`;
}

/** The 15th of the month six months from now: never the real month. */
function dayMonthsAway(): string {
  const now = new Date();

  return localDay(new Date(now.getFullYear(), now.getMonth() + 6, 15, 12));
}

function monthOf(day: string): string {
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${day}T00:00:00Z`),
  );
}

test("a scenario that fixes a day months away sees that day's month in the server-rendered page and after hydration, with no hydration warning", async ({
  page,
}) => {
  const day = dayMonthsAway();
  const month = monthOf(day);
  const errors: Array<string> = [];

  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await fixDay(page, day);

  // The page as the server sent it, before any script ran.
  const rendered = await page.request.get(PROBE);

  expect(rendered.ok()).toBe(true);
  expect(await rendered.text()).toContain(`>${month}</`);

  await visit(page, PROBE);

  // Shown only once hydrated, from the browser's own clock.
  await expect(page.getByTestId("browser-day")).toHaveText(day);
  await expect(page.getByTestId("server-month")).toHaveText(month);
  await expect(page.getByTestId("server-day")).toHaveText(day);
  expect(errors).toEqual([]);
});

test("without a fixed day the server's today is the real one", async ({ page }) => {
  const before = localDay(new Date());

  await visit(page, PROBE);

  const after = localDay(new Date());
  const serverDay = await page.getByTestId("server-day").textContent();

  // Either side of a midnight that fell during the visit.
  expect([before, after]).toContain(serverDay);
});
