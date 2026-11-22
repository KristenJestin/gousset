#!/usr/bin/env bash
# Installs an image as docker-compose.yml does, on an empty machine (docs/releases.md, "The
# image"): a fresh project and volume, secrets made for the run, `migrate`, then the app. Checks
# that `migrate` succeeded, that /health answers 200 and that the app serves its page; then that the
# app alone, without BETTER_AUTH_SECRET, is not healthy. Removes everything it started, whatever
# happened.
#   tools/check-image.sh <tag>   a tag of ghcr.io/kristenjestin/gousset, local or pulled
#   docker build -t ghcr.io/kristenjestin/gousset:local . && tools/check-image.sh local
# GOUSSET_PORT chooses the port on the loopback (3901 by default).
set -euo pipefail

tag=${1:?check-image.sh: give the tag of ghcr.io/kristenjestin/gousset to check}
port=${GOUSSET_PORT:-3901}
root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
project=gousset-check-$$
compose=(docker compose --project-name "$project" --project-directory "$work" -f "$work/docker-compose.yml")

cleanup() {
  "${compose[@]}" down --volumes --remove-orphans > /dev/null 2>&1 || true
  docker rm --force "$project-unsigned" > /dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

fail() {
  echo "check-image.sh: $1" >&2
  "${compose[@]}" logs --no-color --tail 40 >&2 || true
  exit 1
}

cp "$root/docker-compose.yml" "$work/"
mkdir "$work/secrets"
password=$(od -An -tx1 -N16 /dev/urandom | tr -d ' \n')
printf '%s\n' "$password" > "$work/secrets/postgres_password"
printf 'postgresql://gousset:%s@postgres:5432/gousset\n' "$password" > "$work/secrets/database_url"
od -An -tx1 -N32 /dev/urandom | tr -d ' \n' > "$work/secrets/better_auth_secret"

export GOUSSET_VERSION=$tag GOUSSET_PORT=127.0.0.1:$port BETTER_AUTH_URL=http://localhost:$port
"${compose[@]}" up --detach --no-build --pull missing --wait --wait-timeout 180 ||
  fail "the installation did not come up."

migrated=$("${compose[@]}" ps --all --format '{{.ExitCode}}' migrate)
[ "$migrated" = 0 ] || fail "migrate exited with $migrated."

health=$(curl --silent --show-error --max-time 10 --write-out '%{http_code}' --output /dev/null "http://127.0.0.1:$port/health") ||
  fail "/health did not answer."
[ "$health" = 200 ] || fail "/health answered $health."

page=$(curl --silent --show-error --fail --max-time 10 "http://127.0.0.1:$port/") ||
  fail "the app's page did not answer."
[[ $page == *"<title>Gousset</title>"* ]] || fail "the app's page is not Gousset's."

# Without its secret, sign-in cannot work: /health says so (better-auth refuses the default secret
# in production).
docker run --detach --name "$project-unsigned" --publish "127.0.0.1:$((port + 1)):3001" \
  --env DATABASE_URL=postgresql://nobody@127.0.0.1:1/none --env "BETTER_AUTH_URL=http://localhost:$((port + 1))" \
  "ghcr.io/kristenjestin/gousset:$tag" > /dev/null
unsigned=000
for _ in $(seq 60); do
  unsigned=$(curl --silent --max-time 5 --write-out '%{http_code}' --output /dev/null \
    "http://127.0.0.1:$((port + 1))/health") || true
  [ "$unsigned" = 000 ] || break
  # Stopped: it refused to start, which is not healthy either.
  [ "$(docker inspect --format '{{.State.Running}}' "$project-unsigned")" = true ] || break
  sleep 1
done
[ "$unsigned" != 200 ] || fail "/health answered 200 without BETTER_AUTH_SECRET."

echo "check-image.sh: $tag installs: migrate ran, /health answers 200, the app serves its page;"
echo "check-image.sh: without BETTER_AUTH_SECRET, /health answers $unsigned (000: the app does not start)."
