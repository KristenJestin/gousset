# Gousset: architecture

The stack and why, how a page loads its data, the shared components, quality, telemetry and background jobs. Validated by the maintainer on 2026-11-22. Versions were read on npm that day: always the latest, or the latest release candidate while a major version is under way. Each ticket checks npm again on its own day.

## Stack

- **pnpm monorepo** and the **whole vite-plus toolchain** (1.7.0): `vp check`, `vp lint` (Oxlint), `vp fmt` (Oxfmt), `vp test` (Vitest), `vp staged` for the Git hooks. No ESLint, no Prettier, no Jest beside it.
- **TanStack Start** (1.169, React, server rendering, Nitro), with TanStack Router, Query and Form.
- **The other TanStack libraries**:
  - **Query** (5.108): the interface's data, wired to the server functions.
  - **Hotkeys** (0.27, beta): the app's keyboard shortcuts, for example moving from one line to review to the next and approving it, or `Mod+K` to search. It handles Mac and Windows, AZERTY and typing in a field, and produces a list of shortcuts that is always up to date. The keyboard inside a component (a menu, a list) stays with ui-sdk.
  - **Pacer** (0.24, beta): pacing on the interface side. Search waits for typing to stop, several statements dropped at once queue with limited concurrency, and corrections made in a burst during the review are sent together. On the server, retries and scheduling stay with pg-boss.
  - **Devtools** (0.10, alpha): one panel in development for Query, Router, Pacer and Hotkeys, plus a panel of Gousset's own for pg-boss jobs and import progress. Nothing of it ships in production.
  - **Intent** (0.5, alpha): agent skills shipped inside installed packages. `@tanstack/intent` is a devDependency, and `intent install` writes into `AGENTS.md` how to load them, with an allowlist of packages. It replaces Better-T-Stack's `skills` add-on.
  - **Redact** (0.3): a lighter React runtime (about 43 % less JavaScript with Start), added by a Vite plugin. It renders synchronously, without render splitting, and its own documentation says animations are not yet verified everywhere. Whether Motion, Bklit and ui-sdk run on it is unknown. **The first ticket builds the monthly review with and without Redact**, and Redact stays only if animations and charts render the same. Removing it touches one line of `vite.config.ts`.
- **Postgres 18** with **Drizzle 1.0.0-rc.6** (`drizzle-orm` and `drizzle-kit`).
- **Effect 4.1.5** for services, typed errors and telemetry.
- **better-auth 1.7** for user accounts. An installation has several users.
- **Interface**: ui-sdk, Bklit, Motion, Tailwind, Geist, Tabler (see [`design.md`](design.md)).
- **Docker Compose** to install it at home: the app and Postgres.
- **Language**: the interface is written in English and translated into French from the start; every text goes through translations.

### Effect wherever it fits

Effect is used wherever it is possible and makes sense: services, typed errors, validation schemas, configuration, jobs, telemetry, and the public API if one comes. The React interface stays React; only the server functions and what they call go through Effect.

### Starting point

Better-T-Stack (3.49.2 on 2026-11-22), roughly:

```sh
pnpm create better-t-stack@latest gousset --frontend tanstack-start --backend self --runtime none \
  --api none --auth better-auth --payments none --database postgres --orm drizzle --db-setup docker \
  --package-manager pnpm --git --web-deploy docker --server-deploy none --install \
  --addons vite-plus --examples none
```

Without the `oxlint` add-on: it installs Oxlint and Oxfmt on their own, while vite-plus already provides them (`vp lint`, `vp fmt`) and wires the Git hooks itself. Both together would double the configuration. After generation, Drizzle, Effect and the rest are raised to the versions above.

## Styling: Tailwind, not StyleX

**Tailwind 4.** Bklit installs as components written in Tailwind classes, ui-sdk's examples are in Tailwind, and `@shadcn/lint` and `cn` only work with Tailwind. StyleX would mean rewriting every Bklit chart and losing the linter.

- **`cn`** (0.5, by shadcn and Aiden Bai) replaces `clsx` and `tailwind-merge`: the same calls, no dependency. Bklit's components, which import `cn` from `lib/utils`, are pointed to it.
- **`@shadcn/lint`** (0.2.5) runs inside `vp lint` as an Oxlint plugin. All six rules are on:
  - `no-restyle`: a page does not restyle a component;
  - `no-raw-colors`: no `bg-pink-500`, only the theme's variables;
  - `no-arbitrary-values`: no `p-[13px]`;
  - `no-inline-styles`;
  - `no-unknown-classes`;
  - `require-static-classes`.

  Only the components of `packages/ui` may set their own style.

## Shared components

- **`packages/ui` holds every component**, and a page only composes. That includes Gousset's own: amount (sign, currency, tabular numerals), month bar, breakdown list with benchmark, month picker, account chip, merchant logo, category icon, difference, empty state, error state, skeletons. A missing pattern is added to `packages/ui` first, never inside a page.
- **Every component is described in Storybook** (10.6): what it is for, its variants, its states (loading, empty, error, disabled), in light and dark, on desktop and phone, and what not to do with it. Stories use the shared made-up data.
- `@shadcn/lint` enforces the rule: `no-restyle` stops a page from redoing a component its own way.

## Data loading and skeletons

- **The first paint comes with its data.** A route loads its queries in its `loader` (`queryClient.ensureQueryData`) and the server renders the page filled in: no skeleton on a first visit.
- **Load before the click.** TanStack Router preloads a route on hover or focus of a link (`defaultPreload: "intent"`).
- **Each block has its skeleton, shaped exactly like the loaded block** (same heights, same lines), so that nothing jumps when data arrives. Blocks load separately (`useSuspenseQuery` inside one `Suspense` boundary per block). A skeleton appears only after a short delay (about 150 ms), so it does not flash on a fast answer, and gives way to the content with a fade.
- **Changing month does not go through skeletons**: the displayed month's data stays on screen (`placeholderData`) while loading, then bars and amounts move to their new values.
- **Actions are optimistic**: approving a line folds it away at once, and puts it back with a message if the server refuses.
- **An error stays in its block**, with a button to retry; the rest of the page keeps working.
- **Query keys per domain** (one factory per domain). The end of a background job (an import, a rule applied to the past) invalidates the queries it touches.
- **Shared made-up data** (`packages/fixture`): one generator serves Storybook stories, tests, the development database and the demonstration. Nobody has a reason to use real data.

## Calls between the interface and the server: neither tRPC nor oRPC

**TanStack Start's server functions** are enough. They are typed end to end and wired to TanStack Query. tRPC or oRPC would add a second layer of procedures that gives the app nothing more.

**Rule conditions** (issue #25) are a typed query built with **qnot** (`@qnot/core`, `@qnot/react`, MIT): the fields declared once, the editor made from its headless hooks with `packages/ui` components, the query validated on the server, evaluated in JavaScript at import and turned into parameterized SQL to apply a rule to the past. qnot is young (0.1.0): it stays only if it covers those three uses without patches; otherwise a small evaluator of our own reads the same JSON shape.

The logic (import, rules, the month's figures) lives in packages, not in server functions. Background jobs, the MCP server and, later, a public API call the same packages. If a public API comes (a script that drops its statements every month, say), it is built with Effect's `HttpApi`, which publishes its `openapi.json`.

## MCP server

From v0.1, the app serves MCP at `/mcp`, so that each user reaches their own data from an AI agent. The tools call the same packages as the server functions: no logic of their own. The protocol, the authorization and the rules every tool follows are in [`mcp.md`](mcp.md).

## Quality

- **Lint against sloppy code**:
  - `@cloudflare/oxlint-config` as the base (0.1.0, built on `@nkzw/oxlint-config`, type-aware: no `any`, no unsafe assignment or assertion, no floating promise, exhaustive `switch`). The author of anti-slop now recommends this preset, which took over part of its rules;
  - on top, **anti-slop vendored in the repository** (`dmmulroy/anti-slop`, MIT) for the rules the preset lacks (no `as` without a `// SAFETY:` comment, no `unknown` at boundaries, no mocked module…), and **anti-slop-effect** for Effect;
  - **no zod**: Effect `Schema` everywhere.
- **React Compiler** (1.0) on: memoisation is automatic, nobody writes `useMemo` by hand.
- **React Doctor** (by Million): in full in the verify step, and on every pull request through its official Action, which reports only what the pull request introduces, as comments on the changed lines; an error blocks. Nothing leaves CI: no score (computed on their side), no sharing, no third-party dependency analysis, telemetry off.
- **End-to-end tests first**: every scenario of a ticket is a Playwright test named after it, on the built app, a real Postgres database (one database per worker, cloned from a template filled by `packages/fixture`) and a real browser, or a real MCP client going through OAuth.
  - Chromium and Firefox, desktop and phone, light and dark when it is visual; screenshots compared; the clock fixed.
  - No automatic retries: an unstable test is a bug.
  - Unit tests only for dense pure logic (statement parsers, deduplication, amounts, returns, expiry order), and property tests where inputs are wide.
  - No mocked module.
  - The full suite runs in CI; locally, one file at a time.
- **Renovate** proposes every new version of the dependencies, release candidates included for those followed on RC.
- **Accessibility**: everything works with the keyboard, contrast checked in both themes, motion cut when the system asks for reduced motion.
- **Security**: rate-limited sign-in attempts, security headers and a CSP with a nonce (ui-sdk can read it), secure session cookies.

## Telemetry

**OpenTelemetry**, exported over OTLP/HTTP by Effect's `Otlp` layer, in `packages/telemetry`.

- Telemetry is off while `OTEL_EXPORTER_OTLP_ENDPOINT` is not set. Logs then go to standard output. The endpoint is a collector chosen by whoever installs Gousset, never a service of the project's: nothing leaves the server unless they want it to.
- **Traces**: every request, every server function, every pg-boss job and every step of an import.
- **Metrics**: import duration and the number of lines read, added, duplicated and to review; jobs waiting or failed; price calls (succeeded, failed, duration).
- **Logs**: structured and linked to their trace.
- **Only identifiers and counts go in**, never an amount, a label, a merchant, an IBAN or a file name. This is financial data: a trace must be able to go to a third party without revealing anything. An error is recorded by its name and code, not by its message.

## Background jobs

There are some, but no extra service: the job queue lives in Postgres with **pg-boss** (12.39). It survives a restart and lets a job be retried or scheduled, with no Redis and no extra container. Jobs run inside the app's process. If they ever weigh too much, the same image can start a separate `worker` container without changing the code. pg-boss logs in as the app's role, `gousset_app`, which owns its schema `pgboss` and nothing of a user's ([`data-model.md`](data-model.md#ownership-and-isolation)); a job that works for a user opens `UserData` as a server function does.

| Job | When | Why in the background |
|---|---|---|
| **Importing a statement**: reading the file, deduplication, detecting transfers, matching payment top-ups, rules, detecting subscriptions | at each import | The import screen follows the real progress step by step, and an interrupted import resumes or fails cleanly. |
| **Investment prices**: sends only ISINs, can be turned off | once a day | It is the only call out of the server; it must be able to fail and retry without blocking anyone. |
| **Applying a rule to the past**: a merchant attached to a subject, a corrected category | when a rule is created or changed | It can touch years of lines; the user sees "312 lines updated" when it is done. |
| Later: a reminder before a benefit credit expires, optional bank sync | scheduled | — |

What does **not** run in the background: the month's totals, benchmarks, balances and expiries. They are computed on read, in SQL. One person's volumes (a few thousand lines a year) do not justify a cache, and a recomputed total is never wrong.

The interface follows a job's progress live, as Server-Sent Events (`/api/jobs/<id>/events`): that is what moves the import's steps forward and rolls the counter of updated lines. One-way like progress itself, plain HTTP through any reverse proxy, and the browser reconnects by itself, which carries a page across a restart of the app. A job is defined once with its input's schema, its steps, its retries and its timeout; each attempt runs it again from its first step, and nothing in the queue stops it from doing twice what an earlier attempt did: each job is written so that it does not (an import keeps what it already saved, a rule sets values rather than adds them).

## Packages

A first split:

- `apps/web`: the app (pages, API, jobs).
- `packages/db`: the Drizzle schema and migrations. The data model, and how each user's rows are kept apart, is in [`data-model.md`](data-model.md).
- `packages/import`: the format readers (OFX/QFX, QIF, CAMT.053, MT940, CSV and its profiles), with no dependency on the database, tested on sample files.
- `packages/ui`: the styled components and the theme's variables.
- `packages/fixture`: the shared made-up data.
- `packages/telemetry`: telemetry.
