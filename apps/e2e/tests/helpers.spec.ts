import { expect, expectAccessible, fixDay, slowServerFunctions, test, visit } from "../src/test";

test("axe fails a screen that breaks accessibility", async ({ page }) => {
  await page.setContent(
    '<html lang="en"><title>Broken</title><main><img src="/x.png"></main></html>',
  );

  await expect(expectAccessible(page)).rejects.toThrow(/image-alt/);
});

test("the browser's clock is fixed to the chosen day", async ({ page }) => {
  await fixDay(page, "2026-10-15");
  await visit(page, "/");

  const today = await page.evaluate(() => new Date().toLocaleDateString("en-CA"));

  expect(today).toBe("2026-10-15");
});

test("server function calls wait for the added latency", async ({ page }) => {
  await visit(page, "/");
  await slowServerFunctions(page, 800);

  const waited = await page.evaluate(async () => {
    const start = performance.now();

    await fetch("/_serverFn/e2e-latency-probe").catch(() => undefined);

    return performance.now() - start;
  });

  expect(waited).toBeGreaterThanOrEqual(800);
});

test("the signed-in users carry their own sessions", async ({
  userPage,
  secondUserPage,
  user,
  secondUser,
}) => {
  const session = async (page: typeof userPage) => {
    const response = await page.request.get("/api/auth/get-session");

    expect(response.ok()).toBe(true);

    return response.text();
  };

  expect(await session(userPage)).toContain(user.email);
  expect(await session(secondUserPage)).toContain(secondUser.email);
  expect(await session(secondUserPage)).not.toContain(user.email);
});
