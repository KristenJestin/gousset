import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vite-plus/test";

// The theme is only worth something if a page cannot leave it: `vp lint` runs @shadcn/lint with
// the repository's configuration. Each page is written outside the clone and linted on its own.
const repository = fileURLToPath(new URL("../../../", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "gousset-lint-"));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function lintPage(name: string, className: string) {
  const file = join(scratch, `${name}.tsx`);

  writeFileSync(file, `export function Page() {\n  return <div className="${className}" />;\n}\n`);

  const run = spawnSync("pnpm", ["exec", "vp", "lint", file], {
    cwd: repository,
    encoding: "utf8",
  });

  return `${run.stdout}${run.stderr}`;
}

describe("vp lint keeps pages on the theme", () => {
  it("fails a page with bg-pink-500", () => {
    const output = lintPage("raw-colour", "bg-pink-500");

    expect(output).toContain("shadcn(no-raw-colors)");
    expect(output).toContain('"bg-pink-500"');
  });

  it("fails a page with p-[13px]", () => {
    const output = lintPage("arbitrary-value", "p-[13px]");

    expect(output).toContain("shadcn(no-arbitrary-values)");
    expect(output).toContain('"p-[13px]"');
  });

  it("lets a page on the theme's tokens through", () => {
    const output = lintPage("on-theme", "bg-background p-3 text-money-spent");

    expect(output).not.toContain("shadcn(");
  });
});
