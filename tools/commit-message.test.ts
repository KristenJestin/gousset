import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";

const SCRIPT = join(import.meta.dirname, "commit-message.sh");

const scratch = mkdtempSync(join(tmpdir(), "gousset-commit-message-"));

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

function run(args: Array<string>, script = SCRIPT) {
  const result = spawnSync("bash", [script, ...args], { cwd: scratch, encoding: "utf8" });

  return { status: result.status, stderr: result.stderr };
}

function checkMessage(message: string) {
  const file = join(scratch, "COMMIT_EDITMSG");

  writeFileSync(file, message);

  return run([file]);
}

function checkTitle(title: string) {
  const file = join(scratch, "title");

  writeFileSync(file, `${title}\n`);

  return run(["--title", file]);
}

describe("tools/commit-message.sh", () => {
  test("a subject of a known type and scope passes", () => {
    expect(checkMessage("feat(web): show the month's total\n\nA body.\n")).toEqual({
      status: 0,
      stderr: "",
    });
  });

  test("a breaking change marked with ! passes", () => {
    expect(checkMessage("refactor(db)!: rename the accounts table\n").status).toBe(0);
  });

  test("the comment lines Git adds are left out", () => {
    expect(
      checkMessage("# Please enter the commit message\nci(ci): verify pull requests\n").status,
    ).toBe(0);
  });

  test("a merge or a revert Git wrote passes", () => {
    expect(checkMessage("Merge branch 'dev' into feat/1-topic\n").status).toBe(0);
    expect(checkMessage('Revert "feat(web): show the total"\n').status).toBe(0);
  });

  test("a subject without type and scope fails", () => {
    const result = checkMessage("show the month's total\n");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("is not <type>(<scope>): <subject>");
  });

  test("a subject without a scope fails", () => {
    const result = checkMessage("feat: show the month's total\n");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("the scope is required");
  });

  test("an unknown type fails, naming the types", () => {
    const result = checkMessage("feature(web): show the month's total\n");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unknown type "feature"');
    expect(result.stderr).toContain("feat, fix, refactor, test, docs, chore, build, ci, perf");
  });

  test("a scope AGENTS.md does not list fails, naming the scopes", () => {
    const result = checkMessage("feat(api): show the month's total\n");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unknown scope "api"');
    expect(result.stderr).toContain("web, ui, db, import, jobs, auth, core, mcp, e2e");
  });

  test("a subject starting with a capital letter fails", () => {
    const result = checkMessage("feat(web): Show the month's total\n");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("starts with a capital letter");
  });

  test("a subject ending with a period fails", () => {
    const result = checkMessage("feat(web): show the month's total.\n");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ends with a period");
  });

  test("a subject of 72 characters passes, one of 73 fails", () => {
    const prefix = "feat(web): ";

    expect(checkMessage(`${prefix}${"a".repeat(72 - prefix.length)}\n`).status).toBe(0);

    const result = checkMessage(`${prefix}${"a".repeat(73 - prefix.length)}\n`);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("the subject is 73 characters, 72 at most");
  });

  test("the number GitHub adds to a squashed pull request does not count", () => {
    const prefix = "feat(web): ";

    expect(checkMessage(`${prefix}${"a".repeat(72 - prefix.length)} (#12)\n`).status).toBe(0);
  });

  test("a title ending with its issue's number gives a squashed subject that passes too", () => {
    const title = `feat(web): ${"a".repeat(72 - "feat(web): ".length)} (#7)`;

    expect(checkTitle(title).status).toBe(0);
    expect(checkMessage(`${title} (#12)\n`).status).toBe(0);

    const result = checkMessage(`feat(web): ${"a".repeat(73 - "feat(web): ".length)} (#7) (#12)\n`);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("the subject is 73 characters, 72 at most");
  });

  test("numbers never pad a subject past the limit: one counts off a title, two off a commit", () => {
    const full = `feat(web): ${"a".repeat(72 - "feat(web): ".length)}`;

    expect(checkTitle(`${full} (#7) (#8)`).status).toBe(1);
    expect(checkMessage(`${full} (#7) (#8) (#12)\n`).status).toBe(1);
    expect(checkMessage(`feat(web): a${" (#1)".repeat(40)}\n`).status).toBe(1);
  });

  test("a range fails on its bad commit and names it", () => {
    const repository = mkdtempSync(join(scratch, "repository-"));

    git(repository, ["init", "--quiet"]);
    git(repository, ["commit", "--quiet", "--allow-empty", "-m", "chore(repo): start"]);

    const base = git(repository, ["rev-parse", "HEAD"]);

    git(repository, ["commit", "--quiet", "--allow-empty", "-m", "feat(web): show the total"]);
    git(repository, ["commit", "--quiet", "--allow-empty", "-m", "Fixed things."]);

    const bad = git(repository, ["rev-parse", "HEAD"]);

    const result = spawnSync("bash", [SCRIPT, "--range", `${base}..HEAD`], {
      cwd: repository,
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${bad.slice(0, 8)}: "Fixed things."`);
    expect(result.stderr).not.toContain("show the total");
  });

  test("a pull request title follows the convention", () => {
    expect(checkTitle("ci(ci): verify every pull request").status).toBe(0);

    const result = checkTitle("ci: verify every pull request");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("title: ");
  });

  test("a pull request title never passes as a subject Git wrote", () => {
    for (const title of ["Merge the two account lists", "Revert the import change"]) {
      const result = checkTitle(title);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("is not <type>(<scope>): <subject>");
    }
  });

  test("a range git cannot read stops the check", () => {
    const result = run(["--range", "deadbeef..cafebabe"]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("commit message check: git rev-list");
  });

  test("a message that cannot be read stops the check", () => {
    const result = run([join(scratch, "missing")]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("cannot read");
  });

  test("without the lists of AGENTS.md the check stops and says so", () => {
    const copy = mkdtempSync(join(scratch, "alone-"));

    mkdirSync(join(copy, "tools"));
    copyFileSync(SCRIPT, join(copy, "tools", "commit-message.sh"));
    writeFileSync(join(copy, "AGENTS.md"), "# No lists here\n");

    const result = run(
      ["--title", join(scratch, "title")],
      join(copy, "tools", "commit-message.sh"),
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("no types or scopes found in AGENTS.md");
  });
});
