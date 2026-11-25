# Releases

Gousset is installed from a container image, with `docker-compose.yml`, rather than built by
whoever installs it. Two branches publish, each with a version that says where it comes from.

| Branch | Image tags (example)           | Made by                                                    |
| ------ | ------------------------------ | ---------------------------------------------------------- |
| `dev`  | `0.1.3-beta.12`, `sha-<commit>`, `beta` | each push, once its `verify` passed (`ci.yml`, `beta`) |
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
- **`recover-admin <e-mail>`**: gives the administrator who forgot their password a temporary
  one (below, "Recovering the administrator"), as the tables' owner, and exits.
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
nor with a wrong database password; it removes everything it started, whatever happened. CI runs
it on every image it builds (`ci.yml`, `image`), so on every beta before it is published.

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

**Updating**: back up first ([Backing up and restoring](#backing-up-and-restoring): a dump and
`secrets/`), then `docker compose pull && docker compose up -d`; `migrate` runs again before the
app. Migrations only go forward: an update is undone by restoring that dump under the previous
image ([Going back](#going-back)), never by running the previous image on the updated database.
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

**Recovering the administrator.** In the app, the administrator resets any user's password but
their own. If the administrator forgets it, whoever runs the installation gives them a temporary
one from the server, in the running app's container:

```sh
docker compose exec web gousset recover-admin admin@example.com
```

The command (`packages/auth/src/recover-admin.ts`) does what the administrator's reset of a user
does (#70): the password becomes a temporary one, drawn at random and printed once on its output,
which the administrator must replace with their own at the next sign-in, before anything else;
every session of theirs ends, and every MCP client they allowed loses its access. The old password
no longer works. It is refused, changing nothing, for any e-mail but the administrator's, and then
names the administrator's. `gousset` is the image's entry point: called this way, it reads the
database password from its secret, as the app does, and the command logs in as the tables' owner,
like `migrate`. It logs nothing: the temporary password stays in the terminal it was run from,
and is kept nowhere but as its hash. Without Compose, `docker run --rm` the image with the same
`DATABASE_URL` and password, and `recover-admin <e-mail>` as its command.

In a clone, `docker compose up --build` builds the image instead of pulling it. The database of
development is another file, `docker-compose.dev.yml` (`pnpm db:start`): another Compose project
(`gousset-dev`) with its own volume, on `127.0.0.1:5432`, so that it never shares a database, and
so a password, with an installation.

## Backing up and restoring

An installation is its database and its two secrets. Each user takes their own data away from
Settings, Data: an archive of JSON and CSV files, readable without Gousset, which a backup does
not replace and which Gousset does not import back. The administrator backs up the whole
installation, every user's data, password and connected MCP clients, from the folder of
`docker-compose.yml`.

**The secrets**: keep `secrets/` with every backup, away from the machine. `better_auth_secret`
signs the sessions, and better-auth encrypts with it the keys the MCP door signs its tokens with:
a database restored beside another secret keeps its users and passwords, but nobody's session or
MCP client works until they sign in and connect again. `postgres_password` is the password of the
tables' owner (`gousset`), from which `migrate` derives `gousset_app`'s.

**A dump** (`pg_dump`), made while the app serves (it reads one consistent snapshot):

```sh
docker compose exec -T postgres pg_dump -U gousset -d gousset --format=custom > gousset-$(date +%F).dump
```

`-T` gives no terminal, so that the binary dump comes out whole. A dump holds the tables, their
rows, pg-boss's jobs and the grants, never the roles: `gousset_app` and `gousset_user` belong to
the Postgres server, not to one database, and the restore makes them first.

**Restoring a dump** into an empty installation (a new machine, or a lost volume): the same
`docker-compose.yml`, the same `secrets/`, and the `GOUSSET_VERSION` the dump was made with
(update afterwards, as always).

```sh
docker compose up -d postgres
docker compose run --rm migrate                  # makes the roles gousset_app and gousset_user
docker compose exec -T postgres dropdb -U gousset gousset
docker compose exec -T postgres createdb -U gousset gousset
docker compose exec -T postgres pg_restore -U gousset -d gousset --exit-on-error --single-transaction < gousset-2026-11-23.dump
docker compose up -d                             # migrate again (it lets gousset_app log in), then the app
```

`migrate` makes the roles on the new server, then the database it filled gives way to an empty one,
so that the dump comes in whole, in one transaction: a restore that fails leaves the database
empty, never half restored. Over an installation that still has its volume, `docker compose down`
first: the same steps then replace its database, and every row in it, with the dump's.

The end-to-end test `apps/e2e/tests/backup.spec.ts` runs these `pg_dump` and `pg_restore` options
against a database the migrations' roles already exist for, starts an app on it, signs a user in
with their password and finds their export unchanged.

**A copy of the volume**, the other way: stop the installation, so that Postgres writes nothing
during the copy, then copy the volume `gousset_postgres` with Postgres's image, which is already
there:

```sh
docker compose stop
docker run --rm -v gousset_postgres:/data:ro -v "$PWD":/backup postgres:18.7 tar -czf /backup/gousset-volume.tgz -C /data .
docker compose start
```

It restores into an empty volume of the same name (`tar -xzf … -C /data`, the installation
stopped), on the same major version of Postgres only (18): a dump is the one that moves to a later
Postgres. This copy is not tested.

### Going back

An update that goes wrong is undone with the dump made just before it, under the image that made
it. The previous image never runs on a database a later `migrate` changed: its code does not know
the new columns and tables, and nothing removes them (`docs/data-model.md`, "Migrations").

One line at a time, stopping at the first that fails; `<dump>` is the file of that dump, as
`gousset-$(date +%F).dump` named it, and `<version>` the version it was made with:

```sh
test -s <dump> && echo found                     # the dump is there and not empty: go on only then
docker compose down                              # the app and migrate stop; the volume stays
echo GOUSSET_VERSION=<version> >> .env           # the previous image, as 0.1.1
docker compose up -d postgres
docker compose exec -T postgres dropdb -U gousset gousset
docker compose exec -T postgres createdb -U gousset gousset
docker compose exec -T postgres pg_restore -U gousset -d gousset --exit-on-error --single-transaction < <dump>
```

Only once `pg_restore` ended without an error, start the previous image's `migrate` (nothing to
apply) and its app:

```sh
docker compose up -d
```

If `pg_restore` failed, the database is empty: do not start the app, which would offer `/setup` to
whoever reaches it first. Mend what failed and run the last three lines again.

The roles are there already: the same server keeps them. What was written after the dump, under
the new version, is lost with it. Take `GOUSSET_VERSION` out of `.env` to follow `latest` again
once a fixed release is out. These are the restore's steps above, on a server that has its roles;
the end-to-end test of the restore runs them, not this way back as a whole.

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
  (by squash, as into `dev`), and its CI runs on each push as `dev`'s does, the `upgrade` job
  included. It has no beta and no release of its own: its versions come once it is in `dev`, where a
  `Release-As: 0.2.0` footer moves the minor (above).

## Betas

The `ci` workflow (`ci.yml`) publishes the beta of each push to `dev`, in two of its jobs, without
waiting for its browser checks. `image` checks out the pushed commit, computes its beta version,
builds the image (anew: no layer of the Actions cache, which pull requests' builds use, reaches a
beta), runs `tools/check-image.sh` on it and saves it as the run's `image` artifact, the one
`upgrade` tests too: the image of a commit is built once. Once `verify` passed as well, `beta`
checks the artifact is the one `image` saved (its SHA-256, passed as a job output, which no other
job can replace), signs in to the registry and pushes it as
`sha-<commit>` and `X.Y.Z-beta.N`; if `verify` failed, nothing is published. `image` runs the
branch's code (the version, the build, the check) with a token that can only read; `beta` holds
the token that writes images, checks nothing out and runs no code of the branch: it loads the saved
image and pushes it. A version already published is reused only when it is that commit's image
(`sha-<commit>`, same digest); another commit's under that name fails the job. `beta` moves only
while the commit is still `dev`'s head: a push made since publishes its own. Each push's run has a
concurrency group of its own, so that none waiting is cancelled: every push gets its beta.

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
  to `dev` (every job, where the beta needs only `verify`), with **its `upgrade` job**
  ([Every release is an upgrade](#every-release-is-an-upgrade)); the pull request's own `ci` run
  on that commit, which **runs `ui` and `e2e` with every browser and width** (`ci.yml` does on a
  pull request into `main`; the release finds their shards, `ui full i/n` and `e2e full i/n`, each
  passed); and its `pull-request` run (`react-doctor`, `privacy`, the commit messages). Each
  workflow's last run counts, at its last attempt, and one not finished is refused like one that
  failed. The first release, with no pull request, needs its push's run to be a full one
  (`E2E-Matrix: full`).
  Then, before writing anything,
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
  nothing else, and the beta follows `dev` only.

## Every release is an upgrade

From v0.2 on, installations hold real data, and an update must keep every row of it (#102).
The `upgrade` job of `ci.yml` runs on every push to `dev` and `next/**`, and on a pull request
(but the release's, whose commit was tested on its push) that touches what an update runs through
(`packages/db`, `packages/auth`, the `Dockerfile`, the compose files, `tools/docker-entrypoint.sh`),
what reads again the statement the release imported (the readers of `packages/import`, the import
of `packages/core/src/imports`, the app's jobs and its import route, #132) or the jobs themselves
(`tools/check-image.sh`, `tools/check-upgrade.*`, the workflow): it takes the commit's image from
the `image` job and runs `tools/check-upgrade.sh` on it, which, on a fresh project and volume:

1. installs **the last release** (the highest tag `vX.Y.Z`, `--from` to choose another) with that
   release's own `docker-compose.yml`, its image pulled from the registry;
2. fills it with invented data, **through the app's API where the release has one**: the
   administrator by sign-up, a user given a temporary password who replaced it with her own,
   one still on her temporary password, one banned; and **through the tables' owner
   (`tools/check-upgrade.sql`) for what the release offers no route for**: 0.1.1 has neither an
   accounts screen nor an import route, so two users' accounts of every kind, balances, an import
   with its file and its lines (a held duplicate, a foreign currency, a discarded line), the
   transfers between two accounts as 0.2 kept them (never paired, #192), with each counted line's
   entry where the release has entries (from 0.3.0, #23), a CSV profile, and an MCP client with its
   consent and tokens are written as the app would write them;
   and, where the release has its import route (from 0.2.0), a user uploads an invented statement
   (`tools/check-upgrade.ofx`, whose bank encodes entities twice, #132), read as that release
   reads it;
3. stops the app, as an update does, and reads every row of every table of the `public` schema;
   from a release that has entries, every counted line with an amount must already have its one
   entry: invented data the release could not hold fails here, not as the update's fault;
4. puts the image under test in its place, as the [update](#installing) does, the compose file
   unchanged: **`migrate` runs and ends**, and has recorded every migration of the commit; run
   again, it applies nothing and changes nothing; the user's untouched default categories Bank
   fees and Interest are marked with their operation (#194);
5. reads every row again: **every table and column of before is still there, and every row is
   identical**, but in the columns and tables the new migrations add (those of the commit's
   `packages/db/src/migrations` the release did not have), each of which must be named in them
   (`ALTER TABLE "t" ADD COLUMN "c"`, `CREATE TABLE "t"`), and in the rows a new migration
   declares it changes. A migration that must change rows (#132 decodes labels and computes their
   keys again) declares each change in `tools/check-upgrade.changes.json`, under its own name: the
   table, the values that find the rows (`where`), the values they take (`set`), and why. Each
   declaration must find a row of the release once its statement was imported, the rows after the
   update must be exactly the rows before with the declared changes, and no other row may change:
   a declaration says what changes, it never lets a table or a column change freely;
6. starts the app: `/health` answers 200; once the boot's merchants and balances jobs have
   completed, the user's merchants (#24) and her noted balance's movement line (#31) are there, the
   line once: the boot makes them from a release older than 0.3.0, and from 0.3.0 the release's
   own import made them, so only the boot's making no second line is checked; the merchants a
   release before #194 made from an operation prefix, which the user never touched, are forgotten,
   the shop's merchant is there, and the fee's entry is in Bank fees; once every boot job
   has ended, **her transfers kept before v0.3 are paired** (#192: a clear pair and one across her
   savings account's fortnight, never paired by the release, are transfers; an ambiguous one waits
   in the review; from 0.3.0, two whose side she classified, by hand and by a rule of hers, stay
   unpaired, their expenses unchanged); **started again, the app changes no row**; **the
   administrator and both users sign in with the same passwords**, the temporary one still has to
   be replaced, the banned one is still refused, and a session made before the update still works;
7. downloads the user's **export** (#22, `/api/export`), which the last release may not have: each
   of its tables holds that user's rows exactly as the release held them, with the declared
   changes, and each imported file its bytes; but a line made from a noted balance
   (`source = balance`) that the release did not hold, which the boot made, left out of the
   export's side;
8. uploads the statement of step 2 again, through the updated app: **it adds nothing**, every line
   found as a duplicate under the key the update gave it (`done 0 8`: nothing added, 8 found);
9. migrates an empty database beside it with the same image: **the updated schema is a fresh
   installation's**, to the column order and the grant.

It removes everything it started, whatever happened. To run it on a clone, with the release's tag
fetched (`git fetch --tags`):

```sh
docker build -t ghcr.io/kristenjestin/gousset:local .
tools/check-upgrade.sh local
```

The Release workflow refuses a commit whose push to `dev` did not pass the job (the run's last
attempt), as it refuses one without a beta. **When a release changes the tables
`tools/check-upgrade.sql` writes, or gives them a route of their own, that file changes in the
same pull request**: from a release with the import route, the lines come through it. A commit
released after an earlier commit of `dev` was released since its push was tested from the release
before that one only.

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
3. The release reads the runs of `ci.yml` and `pull-request.yml`, the `upgrade` job and the
   shards' names (`ui full i/n`, `e2e full i/n`): renaming one means changing `release.yml` with
   it.
