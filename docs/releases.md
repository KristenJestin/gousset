# Releases

Gousset is installed from a container image, with `docker-compose.yml`, rather than built by
whoever installs it. Two branches publish, each with a version that says where it comes from.

| Branch | Image tags (example)           | Made by                                                    |
| ------ | ------------------------------ | ---------------------------------------------------------- |
| `dev`  | `0.1.3-beta.12`, `sha-<commit>`, `beta` | each push, once its `verify` passed (`beta.yml`)  |
| `main` | `0.1.3`, `latest`, tag `v0.1.3` | a release pull request `dev → main`, then the `Release` workflow (`release.yml`) |

The image is `ghcr.io/kristenjestin/gousset`. A published version is never replaced: a run again
publishes only what is missing. `beta` and `latest` move; a version stays. `sha-<commit>` (the
full SHA) records the image of each commit of `dev`: the release takes the image by it, never by a
name computed again.

## The image

One `Dockerfile`, at the root of the repository, makes one image for everything that runs:

- **`serve`** (the default command): the app, its pages, server functions, API and background
  jobs, on port 3001, as the unprivileged user `node`.
- **`migrate`**: applies Drizzle's migrations (`packages/db/src/migrations`) to `DATABASE_URL`,
  as the tables' owner, then lets the app's role `gousset_app` log in, and exits. It is safe to
  run again: what is applied is not applied twice.
- **The app logs in to the database as `gousset_app`**, never as the owner `DATABASE_URL` names
  (`docs/data-model.md`, "Ownership and isolation"): no superuser, it owns no table and cannot
  step past row-level security. Its password is derived from the owner's, so `migrate` and the app
  are given the same URL and nothing else.
- **`GET /health`**: the container's health check. It answers 200 only when the app can serve
  someone: the auth configuration loaded (in production better-auth refuses to start without
  `BETTER_AUTH_SECRET`) and the database answers `select 1` with the credentials given; 503
  otherwise. It needs no session and reads nothing private. Compose restarts nothing on an
  unhealthy check: it reports it (`docker compose ps`).

**Secrets come from files.** For each variable `<NAME>_FILE`, the entry point
(`tools/docker-entrypoint.sh`) reads the file it names into `<NAME>`, as Compose's `secrets:`
provide them; setting both is refused. **`DATABASE_PASSWORD`**, when set, is put into
`DATABASE_URL` (which then carries no password) percent-encoded: a password pasted raw into a URL
breaks on `/`, `#`, `@` or `%`, and about half of `openssl rand -base64 32` outputs hold a `/`.
Any password works this way. The environment is read when the server starts (Varlock
checks it against `apps/web/.env.schema`), never at build time: the build needs no secret.

To build it and try it as an installation would, in a clone:

```sh
docker build -t ghcr.io/kristenjestin/gousset:local .
tools/check-image.sh local
```

`tools/check-image.sh <tag>` installs that image with `docker-compose.yml` on a fresh project and
volume, with secrets made for the run (the database password holds `/ # ? @ : % + = &` and a
space), checks that `migrate` succeeded, that `/health` answers 200 and that the app serves its
page (`tools/check-page.sh`: without a session nor an administrator yet, `/` redirects to `/setup`,
which answers Gousset's page), then that the image is not healthy without `BETTER_AUTH_SECRET`,
nor with a wrong database password; it removes everything it started, whatever happened. The beta workflow runs it on every
beta before publishing it.

## Installing

`docker-compose.yml` is the installation: Postgres 18, then `migrate`, then the app, which waits
for `migrate` to have succeeded (`service_completed_successfully`). Postgres is published on no
port of the host; only the app is.

```sh
mkdir gousset && cd gousset
curl -fsSLO https://raw.githubusercontent.com/KristenJestin/gousset/main/docker-compose.yml
mkdir -p secrets
openssl rand -base64 32 > secrets/postgres_password
openssl rand -base64 32 > secrets/better_auth_secret
docker compose up -d
```

Both secrets are required: without either file Compose refuses to start, and nothing falls back
to a default password. `migrate` and the app get the database password from the same file as
Postgres (`DATABASE_PASSWORD_FILE`), never written into a URL.

**The database's roles** are made by the migrations, not by hand: Postgres's image makes its user
`gousset` (`POSTGRES_USER`), a superuser, which owns the tables and runs `migrate`; the migrations
make `gousset_app`, the role the app logs in with, and `gousset_user`, which a user's transaction
acts as. `migrate` gives `gousset_app` a password derived from `gousset`'s, and the app derives
the same one from the URL it is given: the installation keeps one secret. A database of your own
works the same way when `DATABASE_URL` names a superuser; a role that is none needs the right to
create and grant these roles and to take on `gousset_app` (this is not tested). The owner's
password is read from `DATABASE_URL` (or `DATABASE_PASSWORD`) only, never from `PGPASSWORD` or a
password file: a URL without one leaves `gousset_app` without a password, which only a socket's
trust lets in. Roles belong to the whole Postgres server, so one server holds one Gousset: two
installations on one server, each with its own owner, would each give `gousset_app` a password of
their own and lock the other out.

Variables, from the shell or a `.env` file beside `docker-compose.yml`:

| Variable                      | What                                                       | Default                 |
| ----------------------------- | ---------------------------------------------------------- | ----------------------- |
| `GOUSSET_VERSION`             | the image tag: `latest`, `beta`, or a version              | `latest`                |
| `BETTER_AUTH_URL`             | the address the app is reached at                          | `http://localhost:3001` |
| `GOUSSET_PORT`                | the port it is published on (`127.0.0.1:3001` for loopback) | `3001`                 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | a collector of yours                                       | unset: no telemetry     |

**Telemetry is off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set** (`docs/architecture.md`,
"Telemetry"): Compose passes it to the app only when it is set. The image also turns off the usage
statistics of Varlock's command line (`VARLOCK_TELEMETRY_DISABLED`): nothing leaves an
installation unless its owner wants it to.

**Updating**: `docker compose pull && docker compose up -d`; `migrate` runs again before the app.
An installation made before the app had a role of its own (#66) needs nothing more: its next
`migrate` makes `gousset_app`, hands
pg-boss's schema over to it and lets it log in, and the app then logs in as it, with the same
`docker-compose.yml` and the same secret.

**Changing the database password.** Postgres takes `secrets/postgres_password` when its volume is
first made, and never reads it again: changing the file alone leaves the database on the old
password, `migrate` fails and `/health` answers 503. Change it in the database first, then in the
file, then restart:

```sh
docker compose exec postgres psql -U gousset -d gousset -c "ALTER USER gousset PASSWORD 'the new one'"
# write the new one into secrets/postgres_password
docker compose up -d --force-recreate
```

`migrate` runs again first, and gives `gousset_app` the password derived from the new one.

(or start over on a fresh volume, `docker compose down --volumes`, which deletes all the data).

In a clone, `docker compose up --build` builds the image instead of pulling it. The database of
development is another file, `docker-compose.dev.yml` (`pnpm db:start`): another Compose project
(`gousset-dev`) with its own volume, on `127.0.0.1:5432`, so that it never shares a database, and
so a password, with an installation.

## The version

Computed, never typed: `tools/version.sh stable|beta|base [--at <commit>]`, for HEAD by default.

- **It counts from the last release the commit holds**: the highest tag `vX.Y.Z` of its history,
  compared as versions. Pre-release tags do not count. Without a release, from `0.0.0` and the
  first commit.
- **The next version** follows the Angular commits counted (`AGENTS.md`, "Git and pull requests"),
  first parents only and merges left out: `feat` bumps the minor, `fix` and `perf` the patch, a `!`
  after the type or a `BREAKING CHANGE:` footer the major. Nothing that bumps is the next patch.
- **Before 1.0, everything bumps one level less**: a breaking change bumps the minor and a `feat`
  the patch, so a `0.X` line takes the everyday features (`0.1.2`, `0.1.3`…), and the minor moves
  on a breaking change or when the maintainer says so (below). From 1.0 on, `feat` bumps the minor
  again.
- **`Release-As: X.Y.Z` sets the version by hand.** A footer of that form in a commit message since
  the last release (a squash's body) sets the next version, and the betas after it, when it is
  above the computed one; with several, the highest wins. It is forgotten once released. A value
  below the computed version (a breaking change merged after it, say), or not `X.Y.Z`, is ignored:
  `tools/version.sh` warns naming the commit, and never fails, since a commit of `dev` cannot be
  changed and would otherwise block every beta and release after it. Example: the pull request that ends v0.2 is
  squashed into `dev` with `Release-As: 0.2.0` in its body; its betas are `0.2.0-beta.N`, its
  release `0.2.0`, and the next feature after it `0.2.1`.
- **The beta's number** `N` is the commit's place on `dev`'s first-parent line, counted from the
  first commit: each squash into `dev` makes the next number, and it never restarts, so no two
  commits of `dev` share a beta's name, whichever commit is released when (releasing a commit
  behind `dev`'s head leaves the version of the later ones as it was, `X.Y.Z` included, and a
  number that restarted would name them again). A commit that is a release itself has no beta and no release of its own: `tools/version.sh`
  exits 3 for it, on both channels, and never prints a `-beta.0`.
- **The stable version is computed when it is released**, from the releases the commit holds: it
  is the one its beta had, without the pre-release (`0.1.3-beta.12` releases `0.1.3`), unless a
  release of an earlier commit was made since its push, in which case it is the next one (the
  image stays its beta's, found by its commit).

The first release is `0.0.1` unless a commit says otherwise: the one that closes milestone
v0.1 carries `Release-As: 0.1.0`.

### Versions per milestone

- **`dev` carries the current minor**, `0.1` today: what is merged there is released as its patches,
  `0.1.1`, `0.1.2`…, each one **a coherent batch**, released when what `dev` holds since the last
  release makes sense together, not at each merge.
- **`next/x.y` carries the next minor's milestone**, `next/0.2` today: its pull requests target it
  (by squash, as into `dev`), and its CI runs every browser and width on each push, as `dev`'s
  does. It has no beta and no release of its own: its versions come once it is in `dev`, where a
  `Release-As: 0.2.0` footer moves the minor (above).

## Betas

`.github/workflows/beta.yml` runs when the `ci` workflow (`ci.yml`) completes on a push to `dev`.
It reads that run's `verify` job: if it did not pass, nothing is published (a notice says so).
Otherwise it checks out the pushed commit, computes its beta version, builds the image, runs
`tools/check-image.sh` on it, and only then signs in to the registry and pushes
`X.Y.Z-beta.N`. Two jobs: `build` runs the branch's code (the version, the build, the check) with a
token that can only read, and saves the image; `publish` holds the token that writes images, checks
nothing out and runs no code of the branch: it loads the saved image and pushes it as
`sha-<commit>` and `X.Y.Z-beta.N`. A version already published is reused only when it is that
commit's image (`sha-<commit>`, same digest); another commit's under that name fails the run. `beta`
moves only while the commit is still `dev`'s head: a push made since publishes its own. There is no
concurrency group, which would cancel a waiting run: every push gets its beta.

## Releasing

Branches reach `dev` by squash. A release does not: **`main` moves forward to a commit of `dev`**
(a fast-forward), and is then that very commit, with no squash and no merge commit of its own.
`main` is always an ancestor of `dev`. None of GitHub's merge buttons can do that (a merge commit
and a squash add a commit `dev` does not have; GitHub's rebase always writes new commits), so the
`Release` workflow moves `main` itself.

1. **The release pull request `dev → main`** is opened (by the lead): it is the release's review,
   its diff is what the release brings, and its checks run on its head, `dev`'s commit. Its
   description says what the batch is; the release's notes are built from the merged pull
   requests' `Note:` lines (below).
2. **The maintainer says yes on it.** It is never merged with the button.
3. **The `Release` workflow is started from `dev` with its number**, by the maintainer, or by the
   lead once the maintainer said yes:

   ```sh
   gh workflow run release.yml --ref dev -f pull_request=<number>
   ```

   (or "Run workflow" on its page, from `dev`). It releases the pull request's head, and GitHub
   shows the pull request merged once `main` is that commit. The first release alone, while
   `main` does not exist and no pull request into it can be opened, is started with no number: it
   releases `dev`'s head and makes `main` there.

- **What it checks first**, reading only: it runs from `dev`; once `main` exists, a pull request is
  given, it is of `dev` into `main` in this repository, open (or merged already, `main` at its head:
  a run again), and its head is a commit of `dev` that `main` is an ancestor of; something was
  committed since the last release. **Its checks passed**: the whole `ci` run of the commit's push
  to `dev` (every job, the full matrix of `ui` and `e2e` included, where the beta needs only
  `verify`), and the pull request's own `ci` and `pull-request` runs on that commit
  (`react-doctor`, `privacy`, the commit messages); each workflow's last run counts, at its last
  attempt, and one not finished is refused like one that failed. Then, before writing anything,
  that **the beta of that commit was published** (`sha-<commit>`): a release is never built again.
  Any of these refused, nothing moves and the run fails, saying why.
- **Then**, in this order: `main` moves forward to the commit through GitHub's API, not forced
  (GitHub refuses anything but a fast-forward; before the first release, `main` is made there);
  the beta image is published again, unchanged, as `X.Y.Z` and `latest`; last, the GitHub release
  `vX.Y.Z`, marked latest, which makes the tag on that commit. Run again after a failure (its
  failed job again, or a new run with the same pull request), it does what is left: the tag comes
  last, so the version is still the same. A version already published as another commit's image
  is refused, never replaced.
- **A commit pushed to `dev` while the pull request is open becomes its head**, and is what a run
  releases: the pull request is read when the run starts, and the maintainer's yes is for the
  batch it shows then.
- **Everything is written with the workflow's own token** (`contents: write` for `main`, the
  release and its tag, `packages: write` for the images): no secret, no environment. GitHub
  refuses that token a `git push` that changes `.github/workflows`, not a ref moved through the API
  to a commit already in the repository, so a release that carries a change of the workflows moves
  `main` all the same.
- The job that holds that token runs no code of any branch: no checkout, only `gh` and `docker` on
  what the reading job decided.
- **`main` runs no CI of its own after a release**, and the release starts none: a ref moved with
  the workflow's token starts no workflow, and nothing is left to check. `main` is then a commit of
  `dev` whose every check passed, on its push and on the release pull request, and GitHub keeps a
  check by commit, not by branch; on `main`, `ci.yml` would run that same `verify` again and
  nothing else, and `beta.yml` follows `dev` only.

## The notes

A release's body says what the user can do now, in the user's words: `tools/changelog.sh --at
<commit>` (or a range) reads the commits of `dev` since the last release, first parents only,
oldest first. For each `feat`, `fix` and `perf` squash (its subject ends with `(#N)`), it takes the
`Note: <sentence>` line of pull request #N's description: the features under **What's new**, the
fixes under **Fixed**, each with its number. A pull request without a note is left out, as is a
note whose author is not a maintainer (the description can be edited after the merge); one that
cannot be read fails the release, since a release published without its notes cannot be mended.
Then, under **All changes**, every Angular subject, grouped by type.

`tools/release.test.ts` runs both scripts on made-up histories (`vp test`).

## What the maintainer sets once

In the repository's settings, never in the repository:

1. **The package is public.** The first beta creates `ghcr.io/kristenjestin/gousset` as a private
   package: in its settings, make it public, so that an installation pulls it without signing in.
2. **`main`'s ruleset blocks deletion and non-fast-forward, nothing more.** The release moves
   `main` with the workflow's own token, through the API, to a commit whose checks passed and
   whose beta exists: the checks are enforced by the release's guards and on `dev`, and a rule
   asking for a pull request or for status checks on `main` would refuse the release's
   fast-forward, every time, and the first release's making of `main`. That `main` moves only by
   the release is a convention, not a guarantee: the ruleset protects it against deletion and a
   force, nothing else, so whoever may write to the repository, and any branch's workflow given
   `contents: write`, can fast-forward it too. The release then fails while `main` is not an
   ancestor of `dev`. The release needs no secret and no environment.
3. The beta follows the workflow named `ci` and its job named `verify`, and the release reads the
   runs of `ci.yml` and `pull-request.yml`: renaming one means changing `beta.yml` and
   `release.yml` with it.
