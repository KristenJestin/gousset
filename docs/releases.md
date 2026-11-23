# Releases

Gousset is installed from a container image, with `docker-compose.yml`, rather than built by
whoever installs it. Two branches publish, each with a version that says where it comes from.

| Branch | Image tags (example)           | Made by                                                    |
| ------ | ------------------------------ | ---------------------------------------------------------- |
| `dev`  | `0.1.3-beta.12`, `sha-<commit>`, `beta` | each push, once its `verify` passed (`beta.yml`)  |
| `main` | `0.1.3`, `latest`, tag `v0.1.3` | the `Release` workflow, started by hand (`release.yml`)   |

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
page, then that the image is not healthy without `BETTER_AUTH_SECRET`, nor with a wrong database
password; it removes everything it started, whatever happened. The beta workflow runs it on every
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
create and grant these roles and to take on `gousset_app` (this is not tested).

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
`main` is always an ancestor of `dev`.

```sh
gh workflow run release.yml --ref dev                     # dev's head
gh workflow run release.yml --ref dev -f commit=<full SHA of dev>
```

(or "Run workflow" on its page, from `dev`). A release pull request `dev → main` may be opened for
review; it is never merged with the button, and GitHub shows it merged once `main` is its head.

- **What it checks first**, reading only: it runs from `dev`; the commit is a full SHA or `dev`,
  and a commit of `dev`; `main`, when it exists, is its ancestor; something was committed since the
  last release. Then, before writing anything, that `RELEASE_TOKEN` is set and that **the beta of
  that commit was published** (`sha-<commit>`): a beta exists only once `verify` passed on its
  push, so a release is never a commit no `verify` passed on, and is never built again. Any of these refused, nothing moves and the run fails,
  saying why.
- **Then**, in this order: `main` moves forward to the commit through GitHub's API with
  `RELEASE_TOKEN`, not forced (GitHub refuses anything but a fast-forward; before the first
  release, `main` is made there);
  the beta image is published again, unchanged, as `X.Y.Z` and `latest`; last, the GitHub release
  `vX.Y.Z`, marked latest, which makes the tag on that commit. Run again after a failure, it does
  what is left: the tag comes last, so the version is still the same. A version already published
  as another commit's image is refused, never replaced: a run again with `commit=dev` after `dev`
  moved on fails there, and is started again with the SHA of the commit first released.
- The job that holds the tokens writing `main`, the tags and the images runs no code of any
  branch: no checkout, only `gh` and `docker` on what the reading job decided.

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
2. **The environment `release` and its secret `RELEASE_TOKEN`.** Create the environment before
   the first release (Settings, Environments, New environment: `release`; a job naming one that
   does not exist creates it unprotected). In it, *Deployment branches and tags*, *Selected
   branches and tags*, and only `dev`. Then, as an *environment secret* (not a repository secret,
   which any branch's workflow can read), `RELEASE_TOKEN`: a fine-grained personal access token
   for this repository only, with the permissions **Contents: read and write** and **Workflows:
   read and write**. Optionally, *Required reviewers* on the environment, to approve each release. `main` moves with it: GitHub refuses the workflow's
   own token any push that changes `.github/workflows`, and its documentation does not say a ref
   moved through the API is spared. Without the secret, the release fails at once, saying so,
   before anything is written. If `main` has a ruleset or a branch protection, it lets this token
   update it, by fast-forward only; nobody else pushes to it.
3. The beta follows the workflow named `ci` and its job named `verify`: renaming either means
   changing `beta.yml` with it.
