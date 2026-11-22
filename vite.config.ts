import cloudflare from "@cloudflare/oxlint-config";
import { defineConfig } from "vite-plus";

/** Built or generated files: never linted nor formatted. */
const GENERATED = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.output/**",
  "**/.nitro/**",
  "**/.tanstack/**",
  "**/storybook-static/**",
  "**/test-results/**",
  "**/playwright-report/**",
  "**/blob-report/**",
  "apps/web/src/routeTree.gen.ts",
  "apps/web/src/env.ts",
  "packages/db/src/env.ts",
  // Paraglide's messages and runtime, compiled from packages/i18n/messages at install.
  "packages/i18n/src/paraglide/**",
];

/**
 * Vendored code keeps its upstream form, so that the next update stays a readable diff: the lint
 * rules, and Bklit's charts as its shadcn registry installs them (`shadcn add @bklit/...`). The
 * type checker still reads them.
 */
const VENDORED = [
  "tools/oxlint/**",
  "packages/ui/src/components/charts/**",
  "packages/ui/src/components/shimmering-text.tsx",
];

/** Agent tooling installed into the repository: skills, not Gousset's source. */
const AGENT_TOOLING = [".agents/**", ".claude/**"];

const ZOD = 'No zod in Gousset: validate with Effect `Schema` (`import { Schema } from "effect"`).';

const TABLER =
  'Icons come from packages/ui: `<Icon name="..." />`, named in `packages/ui/src/components/icons.ts` (docs/design.md, "Icons").';

const NO_ZOD = {
  paths: [{ name: "zod", message: ZOD }],
  patterns: [{ group: ["zod/*"], message: ZOD }],
};

export default defineConfig({
  lint: {
    // The Cloudflare preset (on @nkzw/oxlint-config), type-aware: no `any`, no unsafe
    // assignment, call, return or assertion, no floating promise, exhaustive `switch`,
    // type-only imports. Every rule it enables is an error.
    ...cloudflare,
    jsPlugins: [
      ...(cloudflare.jsPlugins ?? []),
      "@shadcn/lint",
      { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
      { name: "anti-slop-effect", specifier: "./tools/oxlint/anti-slop-effect/index.ts" },
      { name: "gousset", specifier: "./tools/lint/gousset/index.ts" },
    ],
    settings: {
      ...cloudflare.settings,
      shadcn: {
        ui: "@gousset/ui/components",
        note: "Pages only compose packages/ui components; a missing pattern is added to packages/ui first (AGENTS.md).",
      },
    },
    rules: {
      ...cloudflare.rules,
      // Effect `Schema` validates every value; Tabler is reached only through `Icon`.
      "no-restricted-imports": [
        "error",
        {
          paths: NO_ZOD.paths,
          patterns: [...NO_ZOD.patterns, { group: ["@tabler/*"], message: TABLER }],
        },
      ],
      // The design system: only the theme's values, and a page never restyles a component.
      "shadcn/no-restyle": ["error", { allow: ["layout"] }],
      "shadcn/no-raw-colors": "error",
      "shadcn/no-arbitrary-values": "error",
      "shadcn/no-inline-styles": "error",
      "shadcn/no-unknown-classes": "error",
      "shadcn/require-static-classes": "error",
      // anti-slop: what the preset does not cover (AGENTS.md, "Lint").
      "oxc/no-accumulating-spread": "error",
      "anti-slop/no-array-filter-map": "error",
      "anti-slop/no-chained-type-assertions": "error",
      "anti-slop/no-conditional-empty-object-spread": "error",
      "anti-slop/no-known-value-widening": "error",
      "anti-slop/no-module-mocking": "error",
      "anti-slop/no-object-parameters": "error",
      "anti-slop/no-reduce-accumulator-copy": "error",
      "anti-slop/no-reflect-apply": "error",
      "anti-slop/no-reflect-get": "error",
      "anti-slop/no-runtime-typeof": "error",
      "anti-slop/no-shape-in-symbol-names": "error",
      "anti-slop/no-unknown-parameters": "error",
      "anti-slop/no-unknown-returns": "error",
      "anti-slop/no-unknown-type-aliases": "error",
      "anti-slop/no-unsafe-dictionary-type": "error",
      "anti-slop/no-widen-then-assert": "error",
      "anti-slop/require-readable-spacing": "error",
      "anti-slop/require-safety-comment-for-type-assertion": "error",
      // anti-slop-effect: an error carries the tag of its class, a tag is matched and never
      // compared by hand, a service is reached through its accessor, a branch on a tagged value
      // goes through `Effect.match`.
      "anti-slop-effect/no-manual-effect-error-tag": "error",
      "anti-slop-effect/no-manual-tag-comparison": "error",
      "anti-slop-effect/no-manual-tagged-construction": "error",
      "anti-slop-effect/no-service-constructor-imports": "error",
      "anti-slop-effect/prefer-effect-match": "error",
    },
    overrides: [
      ...(cloudflare.overrides ?? []),
      // Inside a component of packages/ui, a class of its own is the design decision.
      { files: ["packages/ui/src/components/**"], rules: { "shadcn/no-restyle": "off" } },
      // The one file that names Tabler's drawings.
      {
        files: ["packages/ui/src/components/icons.ts"],
        rules: { "no-restricted-imports": ["error", NO_ZOD] },
      },
      // Every text a person reads comes from the messages (packages/i18n), in the app and in the
      // shared components; stories, tests and the harness's probe pages hold made-up text.
      {
        files: ["apps/web/src/**/*.tsx", "packages/ui/src/components/**/*.tsx"],
        rules: { "gousset/no-text-outside-messages": "error" },
      },
      {
        files: ["**/*.stories.tsx", "**/*.test.tsx", "apps/web/src/routes/e2e/**"],
        rules: { "gousset/no-text-outside-messages": "off" },
      },
    ],
    ignorePatterns: [
      ...(cloudflare.ignorePatterns ?? []),
      ...GENERATED,
      ...VENDORED,
      ...AGENT_TOOLING,
    ],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    // The product documents and the brand files are written by hand and kept as they are.
    ignorePatterns: [...GENERATED, ...VENDORED, ...AGENT_TOOLING, "docs/**", "brand/**"],
    singleQuote: false,
    semi: true,
    sortPackageJson: true,
  },
  test: {
    passWithNoTests: true,
    // The end-to-end specs (`pnpm e2e`) and the theme's browser checks on Storybook
    // (`pnpm test:ui`, packages/ui/e2e/*.e2e.ts, outside Vitest's pattern) belong to Playwright.
    exclude: ["**/node_modules/**", "**/.git/**", "apps/e2e/**"],
  },
  staged: {
    "*.{js,ts,jsx,tsx,json,jsonc,css,md}": "vp check --fix",
  },
});
