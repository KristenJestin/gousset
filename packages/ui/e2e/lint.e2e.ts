import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { probePath } from "./lint-probe";
import type { ProbeExtension, ProbePlace } from "./lint-probe";

// The theme is only worth something if a page cannot leave it, and the translations if a
// component holds no word of its own. Each probe is written where the app's pages or the shared
// components live (`lint-probe.ts`), linted alone with `vp lint`, then removed.
const repository = fileURLToPath(new URL("../../../", import.meta.url));

function lintPage(className: string) {
  return lintSource(`export function Page() {\n  return <div className="${className}" />;\n}\n`);
}

function lintSource(
  source: string,
  place: ProbePlace = "page",
  extension: ProbeExtension = ".tsx",
) {
  const file = probePath(place, extension);

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
  // The rule's own message ("use <Icon name=…>") is left out of CI's annotation format: the
  // rule's name is what both formats print.
  expect(tabler.output).toContain("no-restricted-imports");
  expect(tabler.output).toContain("@tabler/icons-react");

  const icon = lintSource(
    'import { Icon } from "@gousset/ui/components/icon";\n\nexport function Page() {\n  return <Icon name="housing" />;\n}\n',
  );

  expect(icon.output).not.toContain("no-restricted-imports");
  expect(icon.status).toBe(0);
});

const TEXT_RULE = "gousset(no-text-outside-messages)";

/** A probe that may use the messages, as every page and component does. */
function lintText(body: string, place: ProbePlace = "page", extension: ProbeExtension = ".tsx") {
  return lintSource(`import { m } from "@gousset/i18n/messages";\n\n${body}\n`, place, extension);
}

/** A way of writing a word outside the messages, and where it is written. */
type TextProbe = { name: string; body: string; place?: ProbePlace; extension?: ProbeExtension };

const TEXTS_OUTSIDE: Array<TextProbe> = [
  {
    name: "words between tags",
    body: "export function Page() {\n  return <p>Nothing here yet</p>;\n}",
  },
  {
    name: "a written aria-label, in a shared component",
    body: 'export function Probe() {\n  return <nav aria-label="Main" />;\n}',
    place: "component",
  },
  {
    name: "a string child",
    body: 'export function Page() {\n  return <p>{"Accounts"}</p>;\n}',
  },
  {
    name: "a written title",
    body: 'export function Page() {\n  return <p title="Accounts" />;\n}',
  },
  {
    name: "either branch of a condition",
    body: 'export function Page({ busy }: { busy: boolean }) {\n  return <p>{busy ? "Saving" : m.appName()}</p>;\n}',
  },
  {
    name: "the right side of &&",
    body: 'export function Page({ saved }: { saved: boolean }) {\n  return <p>{saved && "Saved"}</p>;\n}',
  },
  {
    name: "a template with a value",
    body: `export function Page({ count }: { count: number }) {\n  return <p>{\`\${count} lines\`}</p>;\n}`,
  },
  {
    name: "a written message prop",
    body: 'import { FormMessage } from "@gousset/ui/components/form-message";\n\nexport function Page() {\n  return <FormMessage message="Could not save" />;\n}',
  },
  {
    name: "a choice's written label",
    body: 'export const CHOICES = [{ value: "en", label: "English" }];',
  },
  {
    name: "a toast's written description, in a module without JSX",
    body: 'export const failure = { description: "The statement could not be read." };',
    extension: ".ts",
  },
];

test("a test fails when a component holds text outside the messages", () => {
  for (const probe of TEXTS_OUTSIDE) {
    const result = lintText(probe.body, probe.place, probe.extension);

    expect(result.output, probe.name).toContain(TEXT_RULE);
    expect(result.status, probe.name).not.toBe(0);
  }
});

test("texts from the messages, punctuation and digits pass", () => {
  const result = lintText(
    'export function Page({ busy }: { busy: boolean }) {\n  return (\n    <p aria-label={m.appName()} className="flex">\n      {busy ? m.appName() : null} · 2026\n    </p>\n  );\n}',
  );

  expect(result.output).not.toContain(TEXT_RULE);
  expect(result.status).toBe(0);
});

test("a page on the theme's tokens passes vp lint", () => {
  const onTheme = lintPage("bg-background p-3 text-money-spent");

  expect(onTheme.output).not.toContain("shadcn(");
  expect(onTheme.status).toBe(0);
});
