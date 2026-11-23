import { expect, test, visit } from "../src/test";

declare global {
  interface Window {
    /** Exposed by the test below: one Content Security Policy violation of the page. */
    reportCspViolation: (violation: string) => Promise<void>;
  }
}

test("the app loads for a signed-in user", async ({ userPage }) => {
  await visit(userPage, "/");

  await expect(userPage.getByRole("heading", { level: 1, name: "Monthly review" })).toBeVisible();
});

test("the app's page breaks no rule of its Content Security Policy", async ({ userPage }) => {
  const violations: Array<string> = [];

  await userPage.exposeFunction("reportCspViolation", (violation: string) => {
    violations.push(violation);
  });

  await userPage.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      void window.reportCspViolation(`${event.effectiveDirective}: ${event.sample}`);
    });
  });

  await visit(userPage, "/");

  await expect(userPage.getByRole("heading", { level: 1, name: "Monthly review" })).toBeVisible();
  expect(violations).toEqual([]);
});
