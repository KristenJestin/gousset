import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
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

function checkMessage(message: string) {
  const file = join(scratch, "COMMIT_EDITMSG");

  writeFileSync(file, message);

  const result = spawnSync("bash", [SCRIPT, file], { encoding: "utf8" });

  return { status: result.status, stderr: result.stderr };
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
});
