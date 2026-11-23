import { join } from "node:path";

import { startApp } from "../src/app-server";
import { addUser, signIn } from "../src/auth";
import { recreateDatabase, restoredDatabaseName } from "../src/database";
import { downloadExport, dumpDatabase, readArchive, restoreDatabase } from "../src/export";
import { expect, test, visit } from "../src/test";
import { openUserData } from "../src/user-data";

// Issue #22, backing up and restoring the whole installation as the administrator's documentation
// says (docs/releases.md, "Backing up and restoring"): `pg_dump --format=custom` of the database,
// then, on a server where the migrations made the roles, `pg_restore --exit-on-error
// --single-transaction` into an empty database. An app started on it serves what the first served:
// its users sign in with their passwords, and their export holds the same rows and files.

/** Every file of an export but its manifest, whose only change is the moment it was made. */
function withoutManifest(content: Uint8Array) {
  const { files } = readArchive(content);

  return Object.fromEntries(Object.entries(files).filter(([path]) => path !== "manifest.json"));
}

test("a dump restored into an empty installation serves the same data", async ({
  app,
  user,
  page,
}, testInfo) => {
  test.setTimeout(180_000);

  const person = await addUser(app.baseURL, user, {
    name: "Noa Example",
    email: `noa.backup.worker${app.slot}@example.com`,
    password: `e2e-noa-password-${app.slot}`,
  });

  const data = openUserData(app.database);

  try {
    const seeded = await data.seed(await data.ownerOf(person.email));

    expect(seeded.imports).toBeGreaterThan(0);
  } finally {
    await data.close();
  }

  const before = await downloadExport(app.baseURL, person);

  // The backup, made while the app serves, then an installation with nothing in it yet.
  const dump = await dumpDatabase(app.database);
  const restored = restoredDatabaseName(app.slot);

  await recreateDatabase(restored);
  await restoreDatabase(restored, dump);

  const second = await startApp(
    app.slot,
    restored,
    join(testInfo.project.outputDir, `app-${testInfo.project.name}-restored-${app.slot}.log`),
  );

  try {
    expect((await fetch(`${second.baseURL}/health`)).status).toBe(200);

    // A password set before the backup signs in after it.
    const again = await signIn(second.baseURL, person);

    expect(withoutManifest(await downloadExport(second.baseURL, again))).toEqual(
      withoutManifest(before),
    );

    // And the restored installation's screens serve the user's imports.
    await page.context().addCookies([...again.cookies]);
    await visit(page, `${second.baseURL}/import`);
    await expect(page.getByRole("cell", { name: "Current account" }).first()).toBeVisible();
    // Checked with axe on arrival; the restored app stops below.
    await page.goto("about:blank");
  } finally {
    await second.stop();
  }
});
