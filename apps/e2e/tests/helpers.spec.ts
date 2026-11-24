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

// Firefox build 1572 crashed a page once axe and a role query by name had both read an element's
// `ariaLabelledByElements` (src/accessibility.ts, ELEMENT_REFLECTIONS). The button and the region
// are named only by `aria-labelledby`: axe must still find their names, from the attribute. No
// `dispatchEvent` on a role locator: in that build Playwright's own call reads the property in the
// page and crashes it, axe or not.
test("axe and role queries by name share a page whose names come from aria-labelledby", async ({
  page,
}) => {
  await page.setContent(
    `<html lang="en"><title>Sign in</title><main>
      <section aria-labelledby="heading"><h1 id="heading">Sign in</h1>
        <label for="password">Password</label><input id="password">
        <span id="close-label">Close</span><button aria-labelledby="close-label"></button>
      </section>
    </main></html>`,
  );

  await expect(page.getByRole("button", { name: "Close" })).toBeVisible();
  await expectAccessible(page);
  await page.getByLabel("Password").fill("made-up");
  await page.getByRole("button", { name: "Close" }).click();
  await expectAccessible(page);
  await expect(page.getByRole("region", { name: "Sign in" })).toBeVisible();
});

test("axe fails a button that aria-labelledby names by nothing, in every browser", async ({
  page,
}) => {
  await page.setContent(
    '<html lang="en"><title>Unnamed</title><main><button aria-labelledby="missing"></button></main></html>',
  );

  await expect(expectAccessible(page)).rejects.toThrow(/button-name/);
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
  const first = await addUser(app.baseURL, user, personOfItsOwn("linden"));
  const again = await addUser(app.baseURL, user, personOfItsOwn("linden"));

  expect(again.name).toBe(first.name);
  expect(again.email).not.toBe(first.email);
});
