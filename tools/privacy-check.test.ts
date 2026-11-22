import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";

const SCRIPT = join(import.meta.dirname, "privacy-check.sh");

const scratch = mkdtempSync(join(tmpdir(), "gousset-privacy-check-"));

// What the check refuses is built from pieces, so that this file never holds it whole: the
// privacy check reads this file too, in every pull request that changes it.
const OUTSIDE_EMAIL = ["alex", "mail.test"].join("@");
const OTHER_IBAN = ["DE78", "99999999", "0087654321"].join("");
const LINUX_HOME = ["", "home", "alex", "notes.txt"].join("/");
const MAC_HOME = ["", "Users", "alex", "notes.txt"].join("/");
const WINDOWS_HOME = ["C:", "Users", "alex", "notes.txt"].join("\\");
const HOME_PAGE = ["https://example.com", "home", "page"].join("/");

const PRIVATE_WORDS = join(scratch, "private-words");

writeFileSync(PRIVATE_WORDS, "# A made-up list for the tests\n\nZorblax\nquux bank\n");

function environment(privateWords: string | null) {
  const env = { ...process.env };

  delete env.GOUSSET_PRIVATE_WORDS;

  if (privateWords !== null) {
    env.GOUSSET_PRIVATE_WORDS = privateWords;
  }

  return env;
}

function run(args: Array<string>, cwd = scratch, privateWords: string | null = PRIVATE_WORDS) {
  const result = spawnSync("bash", [SCRIPT, ...args], {
    cwd,
    encoding: "utf8",
    env: environment(privateWords),
  });

  return { status: result.status, stderr: result.stderr };
}

function checkText(text: string, privateWords: string | null = PRIVATE_WORDS) {
  const file = join(scratch, "message");

  writeFileSync(file, text);

  return run([file], scratch, privateWords);
}

function git(cwd: string, args: Array<string>) {
  const result = spawnSync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, encoding: "utf8" },
  );

  expect(result.status).toBe(0);

  return result.stdout.trim();
}

describe("tools/privacy-check.sh", () => {
  test("a text with nothing personal passes", () => {
    expect(checkText(`Show the month's total.\n${HOME_PAGE}\n`)).toEqual({
      status: 0,
      stderr: "",
    });
  });

  test("a package at a version is not an e-mail address", () => {
    expect(checkText("typescript@7.1.0-beta.next and pkg@1.2.3\n").status).toBe(0);
  });

  test("an e-mail address at example.com or example.org passes", () => {
    expect(checkText("alex@example.com and sam@docs.example.org\n").status).toBe(0);
  });

  test("an e-mail address outside example.com and example.org fails, saying where", () => {
    const result = checkText(`A first line.\nWrite to ${OUTSIDE_EMAIL}.\n`);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`message:2: e-mail address ${OUTSIDE_EMAIL}`);
  });

  test("an invented IBAN of the fixtures passes, written whole or grouped", () => {
    expect(
      checkText("FR7699999000010001234567809\nFR76 9999 9000 0100 0123 4567 809 SENT\n").status,
    ).toBe(0);
  });

  test("an IBAN that is not one of the invented ones fails", () => {
    const result = checkText(`Paid to ${OTHER_IBAN}.\n`);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`message:1: IBAN ${OTHER_IBAN}`);
    expect(result.stderr).toContain("packages/fixture/src/ibans.ts");
  });

  test("an IBAN grouped by spaces is found too", () => {
    const grouped = OTHER_IBAN.replaceAll(/(.{4})/g, "$1 ").trim();
    const result = checkText(`Paid to ${grouped} TODAY\n`);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`IBAN ${OTHER_IBAN}`);
  });

  test("a string shaped like an IBAN whose checksum fails is not one", () => {
    expect(checkText("FR7699999000010001234567808\n").status).toBe(0);
  });

  test("an absolute home path fails, on Linux, macOS and Windows", () => {
    for (const path of [LINUX_HOME, MAC_HOME, WINDOWS_HOME]) {
      const result = checkText(`See ${path}\n`);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("message:1: absolute home path");
    }
  });

  test("a word of the private list fails, without printing the word", () => {
    const result = checkText("Paid at the QUUX BANK.\nZorblax again.\n");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("message:1: a word of the private list");
    expect(result.stderr).toContain("message:2: a word of the private list");
    expect(result.stderr.toLowerCase()).not.toContain("quux");
    expect(result.stderr.toLowerCase()).not.toContain("zorblax");
  });

  test("without GOUSSET_PRIVATE_WORDS the words are not checked, and it says so", () => {
    const result = checkText("Zorblax\n", null);

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("GOUSSET_PRIVATE_WORDS is not set");
  });

  test("a private list that cannot be read stops the check", () => {
    const result = checkText("Zorblax\n", join(scratch, "missing"));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("GOUSSET_PRIVATE_WORDS names a file that cannot be read");
  });

  test("the staged diff is checked, line by line of the file", () => {
    const repository = mkdtempSync(join(scratch, "staged-"));

    git(repository, ["init", "--quiet"]);
    writeFileSync(join(repository, "notes.md"), `# Notes\n\nWrite to ${OUTSIDE_EMAIL}.\n`);
    git(repository, ["add", "notes.md"]);

    const result = run(["--staged"], repository);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`notes.md:3: e-mail address ${OUTSIDE_EMAIL}`);
  });

  test("a range checks the lines it adds and its commit messages", () => {
    const repository = mkdtempSync(join(scratch, "range-"));

    git(repository, ["init", "--quiet"]);
    writeFileSync(join(repository, "notes.md"), `Kept from before: ${LINUX_HOME}\n`);
    git(repository, ["add", "notes.md"]);
    git(repository, ["commit", "--quiet", "-m", "docs(docs): start"]);

    const base = git(repository, ["rev-parse", "HEAD"]);

    writeFileSync(join(repository, "notes.md"), `Kept from before: ${LINUX_HOME}\nNew: Zorblax\n`);
    git(repository, ["add", "notes.md"]);
    git(repository, ["commit", "--quiet", "-m", `docs(docs): notes\n\nAsk ${OUTSIDE_EMAIL}`]);

    const head = git(repository, ["rev-parse", "HEAD"]);
    const result = run(["--range", base, head], repository);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("notes.md:2: a word of the private list");
    expect(result.stderr).toContain(
      `commit ${head.slice(0, 8)}:3: e-mail address ${OUTSIDE_EMAIL}`,
    );
    expect(result.stderr).not.toContain("notes.md:1");
  });
});
