import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { probePath } from "./lint-probe";

// The theme is only worth something if a page cannot leave it. Each page is written where the
// app's pages live (`lint-probe.ts`), linted alone with `vp lint`, then removed.
const repository = fileURLToPath(new URL("../../../", import.meta.url));

function lintPage(className: string) {
  return lintSource(`export function Page() {\n  return <div className="${className}" />;\n}\n`);
}

function lintSource(source: string) {
  const file = probePath();

  writeFileSync(file, source);

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

test("a page with bg-pink-500 or p-[13px] fails vp lint", () => {
  const rawColour = lintPage("bg-pink-500");

  expect(rawColour.status).not.toBe(0);
  expect(rawColour.output).toContain("shadcn(no-raw-colors)");
  expect(rawColour.output).toContain('"bg-pink-500"');

  const arbitraryValue = lintPage("p-[13px]");

  expect(arbitraryValue.status).not.toBe(0);
  expect(arbitraryValue.output).toContain("shadcn(no-arbitrary-values)");
  expect(arbitraryValue.output).toContain('"p-[13px]"');
});

test("a page importing Tabler fails vp lint, and Icon passes", () => {
  const tabler = lintSource(
    'import { IconHome } from "@tabler/icons-react";\n\nexport function Page() {\n  return <IconHome />;\n}\n',
  );

  expect(tabler.status).not.toBe(0);
  expect(tabler.output).toContain("no-restricted-imports");
  expect(tabler.output).toContain("<Icon name=");

  const icon = lintSource(
    'import { Icon } from "@gousset/ui/components/icon";\n\nexport function Page() {\n  return <Icon name="housing" />;\n}\n',
  );

  expect(icon.output).not.toContain("no-restricted-imports");
  expect(icon.status).toBe(0);
});

test("a page on the theme's tokens passes vp lint", () => {
  const onTheme = lintPage("bg-background p-3 text-money-spent");

  expect(onTheme.output).not.toContain("shadcn(");
  expect(onTheme.status).toBe(0);
});
