import {
  addUser,
  expect,
  expectAccessible,
  fixDay,
  personOfItsOwn,
  slowServerFunctions,
  test,
  visit,
} from "../src/test";

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

// Dev's run 45288876495: a worker ran a file's beforeAll again on its database, and the person it
// made was refused as already there.
test("a person of its own made twice on one worker's database is two users", async ({
  app,
  user,
}) => {
  const first = await addUser(app.baseURL, user, personOfItsOwn("wren"));
  const again = await addUser(app.baseURL, user, personOfItsOwn("wren"));

  expect(again.name).toBe(first.name);
  expect(again.email).not.toBe(first.email);
});
