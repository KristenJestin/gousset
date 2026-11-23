# Gousset

Gousset answers "where did my money go?" from your bank statements, month by month, and follows
your investments. It is open source (AGPL-3.0) and self-hosted: one installation serves several
users, and nobody's bank credentials are handed to anyone.

**Nothing works yet.** The repository holds the documents that describe what will be built
([`docs/`](docs/)) and the empty project they will be built in.

## Install

With Docker Compose: `docker-compose.yml`, its secrets and its variables are described in
[`docs/releases.md`](docs/releases.md), "Installing", with how versions, betas and releases are
made.

## Develop

Node.js 24 and pnpm 12.

```sh
pnpm install
pnpm db:start   # Postgres 18 in Docker
pnpm db:migrate # its schema, as an installation gets it
pnpm dev        # http://localhost:3001; sign up
pnpm db:seed    # the made-up accounts and lines for every user who has none
```

The database of development (`docker-compose.dev.yml`) listens on this machine only. To run the
whole stack from the clone with `pnpm docker:up`, make its two secret files first
([`docs/releases.md`](docs/releases.md), "Installing").

The database of development moved to `docker-compose.dev.yml` (project `gousset-dev`). If you ran
`pnpm db:start` before, its old container still holds port 5432: remove it with
`docker rm --force gousset-postgres` (its volume `gousset_gousset_postgres_data` stays). The new one starts empty: `pnpm db:migrate` fills its schema; to keep old data, dump it from
the old container before removing it (`docker exec gousset-postgres pg_dump -U postgres gousset`)
and load it into the new one.

`vp check`, `vp test` and `pnpm build` are the checks. How to work in this repository, for
people and agents alike, is in [`AGENTS.md`](AGENTS.md).

## Licence

[AGPL-3.0-only](LICENSE).
