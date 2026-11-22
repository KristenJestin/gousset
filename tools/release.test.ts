// tools/version.sh and tools/changelog.sh on made-up histories (docs/releases.md): each test makes
// a throwaway Git repository, commits with invented messages, and reads what the scripts print.
// GitHub's API is a stand-in `gh` on the PATH, answering from the descriptions the test gives.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

const TOOLS = import.meta.dirname;

/** A pull request as the stand-in API returns it: its author's association and description. */
type PullRequest = { association: string; body: string };

/** What a script of tools/ did: its exit status and what it printed. */
type ScriptRun = { status: number | null; out: string; err: string };

/** Answers `gh api repos/{owner}/{repo}/pulls/<n> --jq …` from `$FAKE_GH/<n>`; fails without it. */
const FAKE_GH = `#!/usr/bin/env bash
number=\${2##*/}
[ -f "$FAKE_GH/$number" ] || { echo "HTTP 404: Not Found" >&2; exit 1; }
cat "$FAKE_GH/$number"
`;

const repositories: Array<string> = [];

afterEach(() => {
  for (const folder of repositories.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

class Repository {
  readonly folder = mkdtempSync(join(tmpdir(), "gousset-release-"));
  readonly work = join(this.folder, "work");
  readonly pulls = join(this.folder, "pulls");
  readonly env: NodeJS.ProcessEnv;

  constructor() {
    repositories.push(this.folder);
    mkdirSync(this.work);
    mkdirSync(this.pulls);
    mkdirSync(join(this.folder, "bin"));
    writeFileSync(join(this.folder, "bin", "gh"), FAKE_GH);
    chmodSync(join(this.folder, "bin", "gh"), 0o755);
    // No configuration of the machine's: no signing, no hook, a made-up identity.
    this.env = {
      PATH: `${join(this.folder, "bin")}:${process.env.PATH ?? ""}`,
      HOME: this.folder,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Ada Example",
      GIT_AUTHOR_EMAIL: "ada@example.com",
      GIT_COMMITTER_NAME: "Ada Example",
      GIT_COMMITTER_EMAIL: "ada@example.com",
      FAKE_GH: this.pulls,
    };
    this.git("init", "--quiet", "--initial-branch=dev");
  }

  git(...args: Array<string>): string {
    return execFileSync("git", args, { cwd: this.work, env: this.env, encoding: "utf8" }).trim();
  }

  commit(...messages: Array<string>): string {
    for (const message of messages) {
      this.git("commit", "--quiet", "--allow-empty", "-m", message);
    }

    return this.git("rev-parse", "HEAD");
  }

  tag(name: string): void {
    this.git("tag", name);
  }

  pull(number: number, pull: PullRequest): void {
    writeFileSync(join(this.pulls, String(number)), `${pull.association}\n${pull.body}`);
  }

  /** Runs a script of tools/ in the repository. */
  run(script: string, ...args: Array<string>): ScriptRun {
    const result = spawnSync(join(TOOLS, script), args, {
      cwd: this.work,
      env: this.env,
      encoding: "utf8",
    });

    return { status: result.status, out: result.stdout, err: result.stderr };
  }

  version(channel: string, ...args: Array<string>): string {
    const result = this.run("version.sh", channel, ...args);

    expect(result.err).toBe("");
    expect(result.status).toBe(0);

    return result.out.trim();
  }
}

describe("tools/version.sh", () => {
  it("counts from 0.0.0 and the first commit before any release", () => {
    const repository = new Repository();

    repository.commit("chore(repo): start the monorepo", "feat(web): a page", "fix(web): a link");

    expect(repository.version("stable")).toBe("0.0.1");
    expect(repository.version("beta")).toBe("0.0.1-beta.3");
    expect(repository.version("base")).toBe("");
  });

  it("bumps one level less before 1.0: a feature the patch, a breaking change the minor", () => {
    const repository = new Repository();

    repository.commit("chore(repo): start");
    repository.tag("v0.1.0");
    repository.commit("fix(web): a link");
    expect(repository.version("stable")).toBe("0.1.1");
    repository.commit("feat(import): read OFX");
    expect(repository.version("stable")).toBe("0.1.1");
    expect(repository.version("beta")).toBe("0.1.1-beta.2");
    repository.commit("refactor(db)!: rename the accounts");
    expect(repository.version("stable")).toBe("0.2.0");
  });

  it("reads a BREAKING CHANGE footer as a breaking change", () => {
    const repository = new Repository();

    repository.commit("chore(repo): start");
    repository.tag("v0.3.4");
    repository.commit("feat(db): new tables\n\nBREAKING CHANGE: the old tables are dropped");

    expect(repository.version("stable")).toBe("0.4.0");
  });

  it("bumps the minor for a feature from 1.0 on, the major for a breaking change", () => {
    const repository = new Repository();

    repository.commit("chore(repo): start");
    repository.tag("v1.2.3");
    repository.commit("fix(web): a link");
    expect(repository.version("stable")).toBe("1.2.4");
    repository.commit("feat(mcp): a tool");
    expect(repository.version("stable")).toBe("1.3.0");
    repository.commit("feat(auth)!: passkeys only");
    expect(repository.version("stable")).toBe("2.0.0");
  });

  it("makes the next patch of commits that bump nothing", () => {
    const repository = new Repository();

    repository.commit("chore(repo): start");
    repository.tag("v0.1.0");
    repository.commit("docs(docs): a word", "chore(ci): a step");

    expect(repository.version("stable")).toBe("0.1.1");
    expect(repository.version("beta")).toBe("0.1.1-beta.2");
  });

  it("counts from the highest release, and never from a pre-release tag", () => {
    const repository = new Repository();

    repository.commit("chore(repo): start");
    repository.tag("v0.9.0");
    const released = repository.commit("fix(web): one");

    repository.tag("v0.10.0");
    repository.commit("fix(web): two");
    repository.tag("v0.10.1-beta.1");
    repository.commit("fix(web): three");

    expect(repository.version("stable")).toBe("0.10.1");
    expect(repository.version("beta")).toBe("0.10.1-beta.2");
    expect(repository.version("base")).toBe(`v0.10.0 ${released}`);
  });

  it("computes for the commit given with --at", () => {
    const repository = new Repository();

    repository.commit("chore(repo): start");
    repository.tag("v0.1.0");
    const fix = repository.commit("fix(web): a link");

    repository.commit("feat(db)!: a new schema");

    expect(repository.version("beta", "--at", fix)).toBe("0.1.1-beta.1");
    expect(repository.version("beta")).toBe("0.2.0-beta.2");
  });

  it("gives a release commit neither a release nor a beta, never a -beta.0", () => {
    const repository = new Repository();

    repository.commit("chore(repo): start");
    repository.tag("v0.1.0");

    for (const channel of ["stable", "beta"]) {
      const result = repository.run("version.sh", channel);

      expect(result.status).toBe(3);
      expect(result.out).toBe("");
      expect(result.err).toContain("is v0.1.0 itself: nothing since it");
    }
  });

  it("counts from the releases the commit holds, not from a later one", () => {
    const repository = new Repository();

    repository.commit("chore(repo): start");
    repository.tag("v0.1.0");
    const before = repository.commit("fix(web): before");
    const released = repository.commit("fix(web): released");

    repository.commit("fix(web): after");
    // Its beta was 0.1.1-beta.3 before the release of `released`, which then takes 0.1.1.
    expect(repository.version("beta")).toBe("0.1.1-beta.3");
    repository.git("tag", "v0.1.1", released);

    expect(repository.version("beta", "--at", before)).toBe("0.1.1-beta.1");
    expect(repository.run("version.sh", "beta", "--at", released).status).toBe(3);
    expect(repository.version("stable")).toBe("0.1.2");
    expect(repository.version("beta")).toBe("0.1.2-beta.1");
  });

  it("takes a Release-As above the computed version, for the betas that follow too", () => {
    const repository = new Repository();

    repository.commit("chore(repo): start", "feat(web): the review\n\nRelease-As: 0.1.0");

    expect(repository.version("stable")).toBe("0.1.0");
    expect(repository.version("beta")).toBe("0.1.0-beta.2");
    repository.tag("v0.1.0");
    repository.commit("feat(web): a filter");
    expect(repository.version("stable")).toBe("0.1.1");
  });

  it("ignores a Release-As below the computed version or not X.Y.Z, warning with the commit", () => {
    const repository = new Repository();

    repository.commit("chore(repo): start");
    repository.tag("v0.4.0");
    const below = repository.commit("fix(web): a link\n\nRelease-As: 0.3.0");
    const result = repository.run("version.sh", "stable");

    expect(result.status).toBe(0);
    expect(result.out).toBe("0.4.1\n");
    expect(result.err).toContain(
      `commit ${below} says Release-As: 0.3.0, below the computed 0.4.1: ignored`,
    );

    const other = new Repository();
    const malformed = other.commit("fix(web): a link\n\nRelease-As: v1");
    const beta = other.run("version.sh", "beta");

    expect(beta.status).toBe(0);
    expect(beta.out).toBe("0.0.1-beta.1\n");
    expect(beta.err).toContain(
      `commit ${malformed} says Release-As: 'v1', which is not X.Y.Z: ignored`,
    );
  });

  it("never lets a later breaking change turn a Release-As into a block", () => {
    const repository = new Repository();

    repository.commit("chore(repo): start");
    repository.tag("v1.2.3");
    repository.commit("feat(web): a page\n\nRelease-As: 1.3.0");
    expect(repository.version("stable")).toBe("1.3.0");
    repository.commit("feat(db)!: a new schema", "fix(web): later");
    const result = repository.run("version.sh", "beta");

    expect(result.status).toBe(0);
    expect(result.out).toBe("2.0.0-beta.3\n");
    expect(result.err).toContain("Release-As: 1.3.0, below the computed 2.0.0: ignored");
  });

  it("takes the highest of several valid requests", () => {
    const repository = new Repository();

    repository.commit("fix(web): a\n\nRelease-As: 0.3.0", "fix(web): b\n\nRelease-As: 0.2.0");

    expect(repository.version("stable")).toBe("0.3.0");
  });

  it("refuses an unknown channel", () => {
    const result = new Repository().run("version.sh", "alpha");

    expect(result.status).toBe(2);
  });
});

describe("tools/changelog.sh", () => {
  it("gives the maintainers' notes, the fixes apart, then every change by type", () => {
    const repository = new Repository();

    repository.commit("chore(repo): start");
    repository.tag("v0.1.0");
    repository.commit(
      "feat(import): read OFX statements (#12)",
      "fix(web): the month bar's total (#13)",
      "docs(docs): the releases (#14)",
      "feat(mcp)!: the accounts tool takes names (#15)",
      "feat(ui): a chip without a note (#16)",
      "perf(db): an index for the review (#17)",
      "fix(auth): a note by someone else (#18)",
    );
    repository.pull(12, {
      association: "OWNER",
      body: "I read OFX now.\r\n\r\nNote: You can import an OFX statement.  \r\n\r\nCloses #3",
    });
    repository.pull(13, { association: "COLLABORATOR", body: "Note: The month's total is right." });
    repository.pull(15, { association: "MEMBER", body: "Note: Ask your agent by account name." });
    repository.pull(16, { association: "OWNER", body: "No note here." });
    repository.pull(17, { association: "OWNER", body: "Note: The review opens faster." });
    repository.pull(18, { association: "CONTRIBUTOR", body: "Note: Something unreviewed." });
    const result = repository.run("changelog.sh");

    expect(result.err).toBe("");
    expect(result.status).toBe(0);
    expect(result.out).toBe(`### What's new

- You can import an OFX statement. (#12)
- Ask your agent by account name. (#15)
- The review opens faster. (#17)

### Fixed

- The month's total is right. (#13)

### All changes

#### Breaking changes

- **mcp**: the accounts tool takes names (#15)

#### Features

- **import**: read OFX statements (#12)
- **mcp**: the accounts tool takes names (#15)
- **ui**: a chip without a note (#16)

#### Fixes

- **web**: the month bar's total (#13)
- **auth**: a note by someone else (#18)

#### Performance

- **db**: an index for the review (#17)

#### Other changes

- **docs**: the releases (#14)
`);
  });

  it("lists only the commits since the last release, up to --at", () => {
    const repository = new Repository();

    repository.commit("fix(web): before the release (#1)");
    repository.tag("v0.1.0");
    const at = repository.commit("chore(ci): after it (#2)");

    repository.commit("chore(ci): after --at (#3)");
    const result = repository.run("changelog.sh", "--at", at);

    expect(result.status).toBe(0);
    expect(result.out).toBe("### All changes\n\n#### Other changes\n\n- **ci**: after it (#2)\n");
  });

  it("fails when a pull request cannot be read", () => {
    const repository = new Repository();

    repository.commit("feat(web): a page (#21)");
    const result = repository.run("changelog.sh");

    expect(result.status).toBe(1);
    expect(result.err).toContain("#21 could not be read from the API.");
  });
});
