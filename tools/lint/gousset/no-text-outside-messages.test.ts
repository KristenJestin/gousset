import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";

// Issue #8, "How to verify": a test fails when a component holds text outside the messages. Each
// probe is written where the app's pages and the shared components live, so that it gets their
// own lint configuration, linted alone with `vp lint`, then removed (.gitignore: `lint-probe-*`).
const repository = join(import.meta.dirname, "../../..");

const FOLDERS = {
  page: join(repository, "apps/web/src"),
  component: join(repository, "packages/ui/src/components"),
};

function lint(where: keyof typeof FOLDERS, body: string) {
  const file = join(FOLDERS[where], `lint-probe-${process.pid}-${Date.now()}.tsx`);

  writeFileSync(file, `import { m } from "@gousset/i18n/messages";\n\n${body}\n`);

  try {
    const run = spawnSync("pnpm", ["exec", "vp", "lint", file], {
      cwd: repository,
      encoding: "utf8",
      timeout: 60_000,
    });

    expect(run.error).toBeUndefined();

    return { status: run.status, output: `${run.stdout}${run.stderr}` };
  } finally {
    rmSync(file, { force: true });
  }
}

const RULE = "gousset(no-text-outside-messages)";

describe("text outside the messages", () => {
  test("a page with words between its tags fails vp lint", () => {
    const result = lint("page", "export function Page() {\n  return <p>Nothing here yet</p>;\n}");

    expect(result.output).toContain(RULE);
    expect(result.status).not.toBe(0);
  });

  test("a component with a written aria-label fails vp lint", () => {
    const result = lint(
      "component",
      'export function Probe() {\n  return <nav aria-label="Main" />;\n}',
    );

    expect(result.output).toContain(RULE);
    expect(result.status).not.toBe(0);
  });

  test("a string child or a written label prop fails vp lint", () => {
    const child = lint("page", 'export function Page() {\n  return <p>{"Accounts"}</p>;\n}');
    const prop = lint("page", 'export function Page() {\n  return <p title="Accounts" />;\n}');

    expect(child.output).toContain(RULE);
    expect(prop.output).toContain(RULE);
  });

  test("texts from the messages, punctuation and digits pass", () => {
    const result = lint(
      "page",
      'export function Page() {\n  return (\n    <p aria-label={m.appName()} className="flex">\n      {m.appName()} · 2026\n    </p>\n  );\n}',
    );

    expect(result.output).not.toContain(RULE);
    expect(result.status).toBe(0);
  });
});
