import { expect, test, visit } from "../src/test";

test("the starter page loads", async ({ page }) => {
  await visit(page, "/");

  await expect(page.getByRole("heading", { level: 1, name: "Gousset" })).toBeVisible();
});
