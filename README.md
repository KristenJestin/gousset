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
pnpm dev        # http://localhost:3001
```

`vp check`, `vp test` and `pnpm build` are the checks. How to work in this repository, for
people and agents alike, is in [`AGENTS.md`](AGENTS.md).

## Licence

[AGPL-3.0-only](LICENSE).
