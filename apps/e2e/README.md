# End-to-end harness

Playwright against the built app and a real Postgres 18: every scenario of an issue's "How to
verify" is a test here, named after it (`AGENTS.md`, "Testing").

## Run

```sh
pnpm build                     # the harness tests the built server, apps/web/.output
pnpm db:start                  # Postgres 18 from docker-compose.yml
pnpm --filter @gousset/e2e exec playwright install chromium firefox   # once per Playwright version
pnpm e2e smoke.spec.ts         # one spec, headless: how to run it locally
pnpm e2e --shard=1/4           # CI: the whole suite, one shard
```

Every test runs in four projects: Chromium and Firefox, at 1440 px and at 390 px. There are no
retries: a test that passes only on retry is a bug. On failure the trace, the video and the
screenshots are kept in `test-results/`, with each worker's app log (`app-<project>-worker-<n>.log`).

## Environment

| Variable           | Default                                                  | What                                                                                                             |
| ------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `E2E_DATABASE_URL` | `postgresql://postgres:password@localhost:5432/postgres` | A Postgres 18 server where the harness may create and drop `gousset_e2e_*` databases; `DATABASE_URL` when unset. |
| `E2E_APP_IMAGE`    | unset: the built server                                  | An app image to test instead; each worker runs it with `docker run --network host`.                              |
| `CI`               | unset                                                    | Set: `test.only` fails the run, and the reporters are `github`, `list` and `html` (`playwright-report/`).        |

## How a run is isolated

Global setup draws a run id and builds a template database (`gousset_e2e_<run>_template`): the
migrations of `packages/db`, as an installation applies them, then the shared made-up data of
`packages/fixture`. Each worker clones
it (`gousset_e2e_<run>_worker_<n>`, `CREATE DATABASE … TEMPLATE`) and starts its own app on a
free port against its clone, so tests run in parallel and never see each other's rows. The run
id keeps two runs on one Postgres (two worktrees on `pnpm db:start`) apart. Databases are
dropped when their worker and the run end; a run killed before its teardown leaves its
`gousset_e2e_<run>_*` databases behind, safe to drop by hand.

## The server's clock

`fixDay` fixes both clocks at once. The server reads "today" from one function
(`apps/web/src/lib/today.ts`), which is the server's own clock unless the app was started with
`GOUSSET_E2E_CLOCK=on`: then a request's `gousset-e2e-day` cookie, which `fixDay` sets on the
page's context, gives the day. Only the harness sets that variable, on every worker's app; an
installation never does (neither the image, nor docker-compose.yml, nor `.env.schema` names it),
and without it the cookie is ignored. Any other value of the variable fails the request.

A cookie rather than a day per app: the worker's app serves every test of the worker, each with
its own day, and a test's browser context starts without cookies. Only what runs inside a request
sees the fixed day; a background job reads the server's own clock. `/e2e/today`, not found
outside a test run, shows the server's day, the month it falls in and, once hydrated, the
browser's day (`tests/server-clock.spec.ts`).

## Helpers

Import `test` and `expect` from `src/test.ts`, never from `@playwright/test`.

| Helper                             | What                                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `user`, `userPage`                 | A user signed up through the app once per worker; the test's page signed in as them (`src/auth.ts`).  |
| `secondUser`, `secondUserPage`     | Another user, in a browser context of its own, to prove one never sees the other's data.              |
| `statements`                       | The made-up example statement written in OFX, QIF, CAMT.053, MT940 and CSV, by format.                |
| `visit(page, path)`                | Opens a screen and checks it with axe. Each page is also checked on the screen it ends on.            |
| `expectAccessible(page)`           | axe (WCAG 2.2 A and AA) on the screen as it is, after a client-side change.                           |
| `fixDay(page, "2026-10-15")`       | Fixes the browser's clock to noon UTC that day, and the server's day for this page's context (below). |
| `slowServerFunctions(page, ms)`    | Holds the browser's server function calls, for loading and skeleton scenarios.                        |
| `connectMcp({ baseURL, page, … })` | The official MCP client through the real OAuth flow. Not run yet: `/mcp` comes with #39.              |

A visual test compares its screenshots with `toHaveScreenshot("<screen>-<theme>.png")`, light and
dark, in each project; a changed screenshot is reviewed in the pull request, never updated
blindly.
