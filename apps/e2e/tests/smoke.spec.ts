import { expect, test, visit } from "../src/test";

test("the app loads for a signed-in user", async ({ userPage, user }) => {
  await visit(userPage, "/");

  await expect(
    userPage.getByRole("heading", { level: 1, name: `Hello, ${user.name}.` }),
  ).toBeVisible();
});
