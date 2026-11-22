import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";

const SCRIPT = join(import.meta.dirname, "privacy-check.sh");

const IBANS_FILE = "packages/fixture/src/ibans.ts";

const scratch = mkdtempSync(join(tmpdir(), "gousset-privacy-check-"));

// What the check refuses is built from pieces, so that this file never holds it whole: the
// privacy check reads this file too, in every pull request that changes it. The invented IBAN
// too: the check allows only those its base lists.
const OUTSIDE_EMAIL = ["alex", "mail.test"].join("@");
const INVENTED_IBAN = ["FR76", "99999", "00001", "00012345678", "09"].join("");
const OTHER_IBAN = ["DE78", "99999999", "0087654321"].join("");
const LINUX_HOME = ["", "home", "alex", "notes.txt"].join("/");
const MAC_HOME = ["", "Users", "alex", "notes.txt"].join("/");
const WINDOWS_HOME = ["C:", "Users", "alex", "notes.txt"].join("\\");
const HOME_PAGE = ["https://example.com", "home", "page"].join("/");

const PRIVATE_WORDS = join(scratch, "private-words");

writeFileSync(PRIVATE_WORDS, "# A made-up list for the tests\n\nZorblax\nquux bank\n");

function grouped(iban: string) {
  return iban.replaceAll(/(.{4})/g, "$1 ").trim();
}

// The identity of every commit, given to git and to the script alike, so that no test reads the
// identity of the machine it runs on.
function environment(privateWords: string | null, email = "test@example.com") {
  const env = { ...process.env };

  env.GIT_AUTHOR_NAME = "Test";
  env.GIT_AUTHOR_EMAIL = email;
  env.GIT_COMMITTER_NAME = "Test";
  env.GIT_COMMITTER_EMAIL = "test@example.com";

  delete env.GOUSSET_PRIVATE_WORDS;

  if (privateWords !== null) {
    env.GOUSSET_PRIVATE_WORDS = privateWords;
  }

  return env;
}

function git(cwd: string, args: Array<string>, email = "test@example.com") {
  const result = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
    env: environment(null, email),
  });

  expect(result.status).toBe(0);

  return result.stdout.trim();
}

function write(repository: string, path: string, text: string) {
  mkdirSync(join(repository, path, ".."), { recursive: true });
  writeFileSync(join(repository, path), text);
}

function commit(repository: string, message: string, email = "test@example.com") {
  git(repository, ["add", "--all"]);
  git(repository, ["commit", "--quiet", "--allow-empty", "-m", message], email);

  return git(repository, ["rev-parse", "HEAD"]);
}

// A repository whose first commit lists the invented IBANs as the fixtures do.
function repositoryWithFixtures() {
  const repository = mkdtempSync(join(scratch, "repository-"));

  git(repository, ["init", "--quiet"]);
  write(repository, IBANS_FILE, readFileSync(join(import.meta.dirname, "..", IBANS_FILE), "utf8"));
  commit(repository, "chore(fixture): the invented ibans");

  return repository;
}

const fixtures = repositoryWithFixtures();

function run(
  args: Array<string>,
  cwd = fixtures,
  privateWords: string | null = PRIVATE_WORDS,
  email = "test@example.com",
) {
  const result = spawnSync("bash", [SCRIPT, ...args], {
    cwd,
    encoding: "utf8",
    env: environment(privateWords, email),
  });

  return { status: result.status, stderr: result.stderr };
}

function checkText(text: string, privateWords: string | null = PRIVATE_WORDS) {
  const file = join(scratch, "message");

  writeFileSync(file, text);

  return run([file], fixtures, privateWords);
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
    expect(checkText(`${INVENTED_IBAN}\n${grouped(INVENTED_IBAN)} SENT\n`).status).toBe(0);
  });

  test("an IBAN that is not one of the invented ones fails", () => {
    const result = checkText(`Paid to ${OTHER_IBAN}.\n`);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`message:1: IBAN ${OTHER_IBAN}`);
    expect(result.stderr).toContain(IBANS_FILE);
  });

  test("an IBAN grouped by spaces is found too", () => {
    const result = checkText(`Paid to ${grouped(OTHER_IBAN)} TODAY\n`);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`IBAN ${OTHER_IBAN}`);
  });

  test("an IBAN right after another IBAN-shaped run is found", () => {
    for (const text of [
      `${grouped(INVENTED_IBAN)} ${grouped(OTHER_IBAN)}`,
      `AB12 ${grouped(OTHER_IBAN)}`,
    ]) {
      const result = checkText(`${text}\n`);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`IBAN ${OTHER_IBAN}`);
    }
  });

  test("a string shaped like an IBAN whose checksum fails is not one", () => {
    expect(checkText(`${INVENTED_IBAN.slice(0, -1)}8\n`).status).toBe(0);
  });

  test("an absolute home path fails, in each of its forms", () => {
    for (const path of [
      LINUX_HOME,
      MAC_HOME,
      WINDOWS_HOME,
      `file://${LINUX_HOME}`,
      `/var${LINUX_HOME}`,
      `/mnt/c${MAC_HOME}`,
      WINDOWS_HOME.replaceAll("\\", String.raw`\\`),
      WINDOWS_HOME.replaceAll("\\", "/"),
    ]) {
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

  test("a commit message is checked without Git's comment lines and the diff below its scissors", () => {
    const file = join(scratch, "COMMIT_EDITMSG");

    writeFileSync(
      file,
      [
        "feat(web): show the total",
        "",
        `# Author: Alex <${OUTSIDE_EMAIL}>`,
        "# ------------------------ >8 ------------------------",
        `-Write to ${OUTSIDE_EMAIL}`,
        "",
      ].join("\n"),
    );

    expect(run(["--message", file]).status).toBe(0);

    writeFileSync(file, `feat(web): show the total\n\nAsk ${OUTSIDE_EMAIL}\n`);

    const result = run(["--message", file]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`COMMIT_EDITMSG:3: e-mail address ${OUTSIDE_EMAIL}`);
  });

  test("a file that cannot be read stops the check", () => {
    const result = run([join(scratch, "missing")]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("cannot read");
  });

  test("the staged diff is checked, line by line of the file", () => {
    const repository = repositoryWithFixtures();

    write(repository, "notes.md", `# Notes\n\nWrite to ${OUTSIDE_EMAIL}.\n`);
    git(repository, ["add", "notes.md"]);

    const result = run(["--staged"], repository);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`notes.md:3: e-mail address ${OUTSIDE_EMAIL}`);
  });

  test("the staged file names and the commit's author are checked", () => {
    const repository = repositoryWithFixtures();

    write(repository, `docs/${OUTSIDE_EMAIL}.md`, "Nothing personal.\n");
    git(repository, ["add", "--all"]);

    const result = run(["--staged"], repository, PRIVATE_WORDS, OUTSIDE_EMAIL);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`file name docs/${OUTSIDE_EMAIL}.md: e-mail address`);
    expect(result.stderr).toContain(`author: e-mail address ${OUTSIDE_EMAIL}`);
  });

  test("a range checks the lines it adds and its commit messages", () => {
    const repository = repositoryWithFixtures();

    write(repository, "notes.md", `Kept from before: ${LINUX_HOME}\n`);

    const base = commit(repository, "docs(docs): start");

    write(repository, "notes.md", `Kept from before: ${LINUX_HOME}\nNew: Zorblax\n`);

    const head = commit(repository, `docs(docs): notes\n\nAsk ${OUTSIDE_EMAIL}`);
    const result = run(["--range", base, head], repository);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("notes.md:2: a word of the private list");
    expect(result.stderr).toContain(
      `commit ${head.slice(0, 8)} message:3: e-mail address ${OUTSIDE_EMAIL}`,
    );
    expect(result.stderr).not.toContain("notes.md:1");
  });

  test("a range checks each commit: a line added then removed, file names, the author", () => {
    const repository = repositoryWithFixtures();
    const base = git(repository, ["rev-parse", "HEAD"]);

    write(repository, "notes.md", `Write to ${OUTSIDE_EMAIL}\n`);

    const added = commit(repository, "docs(docs): add a line");

    write(repository, "notes.md", "Nothing personal.\n");
    write(repository, `docs/${OUTSIDE_EMAIL}.md`, "Nothing personal.\n");

    const named = commit(repository, "docs(docs): name a file", OUTSIDE_EMAIL);
    const result = run(["--range", base, named], repository);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `commit ${added.slice(0, 8)} notes.md:1: e-mail address ${OUTSIDE_EMAIL}`,
    );
    expect(result.stderr).toContain(`file name docs/${OUTSIDE_EMAIL}.md: e-mail address`);
    expect(result.stderr).toContain(
      `commit ${named.slice(0, 8)} author: e-mail address ${OUTSIDE_EMAIL}`,
    );
  });

  test("GitHub's no-reply address passes as a commit's author", () => {
    const repository = repositoryWithFixtures();
    const base = git(repository, ["rev-parse", "HEAD"]);
    const noreply = ["12345+alex", "users.noreply.github.com"].join("@");
    const head = commit(repository, "docs(docs): nothing", noreply);

    expect(run(["--range", base, head], repository).status).toBe(0);
  });

  test("an IBAN a range adds to the fixtures is not allowed by it", () => {
    const repository = repositoryWithFixtures();
    const base = git(repository, ["rev-parse", "HEAD"]);

    write(repository, IBANS_FILE, `export const INVENTED_IBANS = ["${OTHER_IBAN}"];\n`);
    write(repository, "notes.md", `Paid to ${OTHER_IBAN}\n`);

    const head = commit(repository, "test(fixture): one more iban");
    const result = run(["--range", base, head], repository);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`notes.md:1: IBAN ${OTHER_IBAN}`);
    expect(result.stderr).not.toContain(`${IBANS_FILE}:1: IBAN`);
    expect(result.stderr).toContain(`changes ${IBANS_FILE}`);
  });

  test("a range whose base has no list yet reads the one it adds", () => {
    const repository = mkdtempSync(join(scratch, "repository-"));

    git(repository, ["init", "--quiet"]);

    const base = commit(repository, "chore(repo): start");

    write(repository, IBANS_FILE, `export const INVENTED_IBANS = ["${INVENTED_IBAN}"];\n`);
    write(repository, "notes.md", `Paid to ${INVENTED_IBAN}, not ${OTHER_IBAN}\n`);

    const head = commit(repository, "test(fixture): the invented ibans");
    const result = run(["--range", base, head], repository);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("has no packages/fixture/src/ibans.ts yet");
    expect(result.stderr).toContain(`IBAN ${OTHER_IBAN}`);
    expect(result.stderr).not.toContain(`IBAN ${INVENTED_IBAN}`);
  });

  test("a range git cannot read stops the check", () => {
    const result = run(["--range", "deadbeef", "cafebabe"]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("privacy check:");
  });
});
