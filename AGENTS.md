<!-- intent-skills:start -->

## Skill Loading

Use the repository’s installed Intent. If it is unavailable, report the missing dependency instead of downloading a replacement.
Before editing files for a substantial task:

- Run `pnpm exec intent list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `pnpm exec intent load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.

<!-- intent-skills:end -->

# AGENTS.md — Gousset

Instructions for any coding agent working in this repository. `CLAUDE.md` is a symbolic link to
this file: there is one contract, not two that drift apart.

## Project overview

Gousset is a self-hosted personal finance app (AGPL-3.0): it answers "where did my money go?"
from imported bank statements, reviewed month by month, and follows investments. One
installation serves several users, from the browser and from an AI agent over MCP.

**Read the documents in [`docs/`](docs/) before any work**: [`vision.md`](docs/vision.md) (what
and for whom, and the words), [`architecture.md`](docs/architecture.md) (the stack, data loading,
quality, telemetry, jobs), [`design.md`](docs/design.md) (the look and the motion),
[`mcp.md`](docs/mcp.md) (the MCP server and its tools). Those files are the specification; this
file is how to work.

## Layout

| Path                                | What                                                                  |
| ----------------------------------- | --------------------------------------------------------------------- |
| `apps/web`                          | The app: TanStack Start (pages, server functions, API, jobs, `/mcp`)  |
| `packages/ui`                       | Every component and the theme, each described in Storybook            |
| `packages/db`                       | The Drizzle schema and migrations                                     |
| `packages/auth`                     | better-auth, wired to the database; the MCP door's OAuth              |
| `packages/mcp`                      | The MCP tool framework, its guards, the instructions and the tools    |
| `packages/fixture`                  | The shared made-up data                                               |
| `packages/config`                   | The shared TypeScript configuration                                   |
| `tools/oxlint`                      | Lint rules vendored from upstream (see [Lint](#lint))                 |
| `.agents/skills`                    | Skills for agents, vendored from upstream                             |
| `packages/ui/src/components/charts` | Bklit's charts, vendored from its shadcn registry (see [Lint](#lint)) |

## Commands

```
pnpm install
vp check                 # format, lint (type-aware) and type check
vp lint                  # lint only
vp fmt                   # format
vp test                  # unit tests (Vitest)
pnpm build               # build every package
pnpm dev                 # the app on http://localhost:3001
pnpm storybook           # the components of packages/ui on http://localhost:6006
pnpm db:start            # Postgres 18 in Docker; then pnpm db:push
pnpm hooks:setup         # once per clone: the Git hooks (vp staged)
```

The whole toolchain is vite-plus: no ESLint, no Prettier, no Jest beside it.

## Principles

### 1. Think before coding

- State your assumptions. If uncertain, ask.
- If several readings exist, name them; don't pick silently.
- If a simpler approach exists, say so.
- If the code and the issue disagree, the issue wins; if the issue is wrong, say so instead of
  quietly deviating.

### 2. Simplicity first

- No features beyond what the issue asks. No abstraction for single-use code.
- No configurability nobody asked for. No error handling for impossible cases.

### 3. Surgical changes

- Touch only what you must. Don't "improve" adjacent code or formatting.
- Every changed line traces back to the issue. Unrelated dead code is mentioned, not deleted.

### 4. The failing test first

- Write the test that fails, see it fail, then make it pass.
- A bug gets a test that reproduces it, then the fix.

## Code style

- **Everything in English**: code, identifiers, comments, docs, issues, commits. The interface is
  written in English and translated into French; every text goes through translations.
- TypeScript, strict. A comment says why, not what.
- **Effect wherever it fits** on the server: services, typed errors, `Schema`, configuration,
  jobs, telemetry. The React interface stays React; server functions and what they call go
  through Effect.
- **No zod** in Gousset's own code: Effect `Schema` validates every value.
- **React Compiler is on**: nobody writes `useMemo`, `useCallback` or `memo` by hand.
- **Pages only compose `packages/ui` components.** A missing pattern is added to `packages/ui`
  first, with its stories, never drawn inside a page. Tailwind 4 with `cn` (no `clsx`, no
  `tailwind-merge`); only the theme's variables (`docs/architecture.md`, "Shared components").
- **Every UI issue states its motion, and tests it** (`docs/design.md`, "Motion"): what moves,
  how long, and that it is cut under reduced motion.
- **A feature is reachable from the MCP server in the same pull request** (see [MCP](#mcp)).

## Lint

`vp lint` runs every rule below as an error. When a rule fires, **fix the code, not the rule**:
no disable comment without a reason on the same line, never a weaker severity, never a cast to
launder a type. Each rule asks for something, for a reason:

**`@cloudflare/oxlint-config`**, spread into the config, type-aware:

- no `any`, no unsafe assignment, call, member access, return or argument: an `any` switches the
  type checker off for everything it touches;
- no unchecked type assertion (`no-unsafe-type-assertion`), no non-null `!`: narrow the value;
- no floating or misused promise: an unhandled rejection is a lost error;
- exhaustive `switch`: a new case of a union must be handled where it matters;
- type-only imports (`import type`): types stay out of the runtime;
- no `@ts-ignore`; strict equality; the rest of `@nkzw/oxlint-config`.

**`anti-slop`** (vendored in `tools/oxlint/anti-slop/`), what the preset does not cover:

- `no-chained-type-assertions`: no `as unknown as T`. A double cast is a lie to the compiler;
- `require-safety-comment-for-type-assertion`: an `as` needs a `// SAFETY:` comment stating the
  invariant that was checked, so a reviewer can verify it;
- `no-unknown-parameters`, `no-unknown-returns`, `no-unknown-type-aliases`,
  `no-object-parameters`: no `unknown` or `object` on a parameter, a return or an alias. Decode
  at the boundary with a `Schema`, then pass the real type;
- `no-unsafe-dictionary-type`: no `Record<string, unknown>`; give the shape a type;
- `no-runtime-typeof`: no `typeof` narrowing where a schema belongs;
- `no-module-mocking`: no `vi.mock` and the like. Inject a service (an Effect `Layer`) instead;
- `no-reduce-accumulator-copy` (with `oxc/no-accumulating-spread`): no copy of the accumulator at
  each step of a reducer; it is quadratic;
- `no-array-filter-map`: one pass, not `filter` then `map`;
- `no-conditional-empty-object-spread`: no `...(cond ? { a } : {})`; build the value plainly;
- `no-known-value-widening`, `no-widen-then-assert`: no explicit type that throws away what
  inference knew, and no widening followed by a cast back;
- `no-reflect-apply`, `no-reflect-get`: call and read directly;
- `no-shape-in-symbol-names`: a name says what a thing is for, not its type;
- `require-readable-spacing`: a blank line between statements of different kinds.

**`anti-slop-effect`** (vendored in `tools/oxlint/anti-slop-effect/`):

- `no-manual-effect-error-tag`, `no-manual-tagged-construction`: an error carries the tag of the
  class that declares it (`Schema.TaggedError`, `Data.TaggedError`), never a hand-written `_tag`;
- `no-manual-tag-comparison`: a tag is matched (`Effect.catchTag`, `Match`), never compared by
  hand;
- `no-service-constructor-imports`: a service is reached through its own accessor, not by
  importing its implementation;
- `prefer-effect-match`: a branch on a tagged value goes through `Effect.match`.

**`no-restricted-imports`**: no `zod` (see [Code style](#code-style)).

**`@shadcn/lint`**: all six rules on. A page does not restyle a component (`no-restyle`); no raw
colour, arbitrary value, inline style, unknown class or class built at run time. Only the
components of `packages/ui/src/components` set their own style.

The vendored rules are updated with the `install-anti-slop` skill
(`.agents/skills/install-anti-slop/`), which merges upstream into the local copies and keeps
local changes; each folder's `UPSTREAM.md` records the commit it comes from.

**Vendored code is out of `vp lint` and `vp fmt`** (`VENDORED` in `vite.config.ts`): the lint
rules above, and Bklit's charts (`packages/ui/src/components/charts/`, with
`shimmering-text.tsx`) as `shadcn add @bklit/...` installs them, their `cn` import pointed to the
repository's; the charts are out of React Doctor too (`ignore.files` in `doctor.config.ts`), and
their `UPSTREAM.md` records where they come from. They keep their upstream form so that the next update stays a readable diff; the
type checker still reads them. Gousset's own code never goes there, and a chart's Gousset-specific
wrapper lives beside them, linted like the rest.

## MCP

The app serves MCP at `/mcp` (`docs/mcp.md`). For every change to its tools:

- **A feature ships with its tool**: its family tool and actions, in the same pull request, with
  end-to-end tests through a real MCP client.
- **One family tool per concept, with actions** (`accounts` with `list`, `show`…), never one tool
  per verb; about ten tools in all.
- **Every tool has a `title`, a description and annotations**: the description says what it does,
  when to use it rather than another, its effects and refusals, the important part first, with an
  example call where an argument is easy to get wrong; `readOnlyHint` on reads, `idempotentHint`
  where a repeat is harmless, `destructiveHint` on writes, `openWorldHint: false`.
- **The guards**: at most 15 tools, 30,000 characters of definitions, every description under
  2,048 characters. A guard that fails goes to the maintainer; **no description is trimmed to make
  room for another**.
- **Results** text first, names rather than ids, under 20,000 characters, paged with the next
  call written in the result. **Errors** under 2,000 characters, saying what to do with a valid
  example, never a trace.
- **No logic in the MCP layer**: the tools call the same packages as the server functions. A
  write is refused to a token without the write scope, and the refusal says how to get it.
- No roots, sampling, logging or elicitation; the tool list comes in a fixed order.
- Telemetry carries the tool, the action, the duration and the outcome, never arguments or
  results.

The lead reviews every change to the tools against `docs/mcp.md` before merging.

## Testing

- **End to end first.** Every scenario of an issue's "How to verify" is a Playwright test named
  after it, on the end-to-end harness: the built app, a real Postgres database, a real browser or
  a real MCP client.
- **Unit tests only for dense pure logic** (statement parsers, deduplication, amounts and
  currencies, returns, expiry order), and **property tests** where the input space is wide
  (parsers, money).
- **No module mocking**, no test that only checks a mock was called.
- **A test that passes only on retry is a bug.** No automatic retries.
- Examples and fixtures are made up (`packages/fixture`), never real data.
- **`packages/ui`'s browser checks** run on Storybook with `pnpm test:ui` (Chromium, Firefox, a
  phone; screenshots compared). CI runs them in the official Playwright image; refresh the
  reference screenshots in that same image with `tools/playwright-docker.sh
  --update-snapshots=all`, never with a local browser, which renders fonts differently. Missing
  references are made by CI, never on the machine: push a commit whose body ends with the
  trailer line `Update-Snapshots: missing`, and the `ui-snapshots` workflow draws the missing
  ones in that image and commits them to the branch (`test(ui): …`); then fetch, check them, and
  push a commit of your own so that CI runs again. To redraw a reference, delete it first.
- **CI on a pull request runs Chromium on a desktop only**, in `e2e` and `ui`; each push to `dev`
  runs every browser and width. A failure seen only on `dev` is fixed at once. A pull request
  whose head commit ends with the trailer line `E2E-Matrix: full` runs every browser and width as
  `dev` does: use it to reproduce a failure of another browser, and make the last run before
  merging a full one when the change touches what other browsers draw.
- **Required checks** on `dev` and `main`: `verify`, `ui`, `e2e`, `react-doctor` and `privacy`.

## How the work is organised

| Who               | What                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| The maintainer    | decides what is built, tries each milestone, and merges what they have not delegated                             |
| The lead agent    | turns decisions into issues, launches the developing agents, reviews their work, keeps the tracker honest        |
| Developing agents | implement one issue each: the failing test first, then the code, the checks and a pull request; they never merge |

### The tracker

- **Issues are the tickets, and a ticket stands alone**: the what, the where, the "how to verify"
  and the base branch, with no local path. If one is missing, ask rather than guess.
- Milestones are named `vX.Y - Title`; each ends on something the maintainer can use. The
  `Feedback` milestone collects what comes back from use.
- Labels: `type:*` (what kind of work) and `area:*` (where).

## Git and pull requests

- **`dev` is the default and integration branch**: a branch starts from `origin/dev` and its pull
  request targets it. **`main` holds releases.** Never commit, merge, rebase or push on `dev` or
  `main` directly.
- **One branch per ticket**: `feat/<n>-<topic>`, `fix/<n>-<topic>` (`chore/`, `docs/` the same way).
- **Pull requests into `dev` are merged by squash.** Never rewrite published history. No
  `--no-verify`.
- One commit, one intent. No `wip` commits. Commits use the Git identity configured for the
  repository.
- **The subject is `<type>(<scope>): <subject>`**: the scope is required, the subject is 72
  characters at most, starts lowercase and has no final period. Types: `feat`, `fix`, `refactor`,
  `test`, `docs`, `chore`, `build`, `ci`, `perf`. Scopes: `web`, `ui`, `db`, `import`, `jobs`,
  `auth`, `core`, `mcp`, `e2e`, `telemetry`, `fixture`, `i18n`, `repo`, `ci`, `docs`.
- **The pull request description is written in the first person as the maintainer**: what it
  does, what was left out and why. It carries a line `Note: <one sentence, what the user can do
  now>` at the start of its line, in the user's words, and ends with `Closes #<n>`.

## Security and privacy

- **This repository is public.** Nothing personal goes into code, fixtures, docs, issues, pull
  requests or commits: no real person's bank, employer, amount, account number, IBAN or address;
  no private path, host, account or token. Examples and fixtures are invented.
- Secrets are never printed, logged or committed; `.env` files stay out of Git.
- **`tools/privacy-check.sh`** guards it, before each commit and on every pull request: no e-mail
  address outside `example.com` and `example.org`, no IBAN but the invented ones of
  `packages/fixture/src/ibans.ts` (as the base branch has them), no absolute home path, no word
  of the private list (a file named by `GOUSSET_PRIVATE_WORDS`, kept outside the repository). A
  commit's author and committer are the public identity their owner chose: they are held to the
  private list, home paths and IBANs, not to the e-mail rule. Binary files are not read.
- Nothing is published outside the pull request: no gist, no upload, no paste service.
- **A permission denial is never worked around**: do what remains, say what was refused.

## Working on a machine

- The machine is the maintainer's own, in use while you work. Never stop or reconfigure their
  running programs. No artificial load; heavy builds one at a time.
- Scratch files live outside the clone.
- Never open a window: tests and tools run headless.

## When done

Run `vp check`, `vp test` and `pnpm build`, plus the checks the issue asks for, and report the
real output. If something fails, say so; don't claim green.
