#!/usr/bin/env bash
# Installs an image as docker-compose.yml does, on an empty machine (docs/releases.md, "The
# image"): a fresh project and volume, secrets made for the run, `migrate`, then the app. Checks
# that `migrate` succeeded, that /health answers 200 and that the app serves its page; then that the
# app is not healthy without BETTER_AUTH_SECRET, nor with a wrong database password. The database
# password holds every character a URL reserves. Removes everything it started, whatever happened.
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
  docker rm --force "$project-unsigned" "$project-wrong-password" > /dev/null 2>&1 || true
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
# What a raw URL breaks on: / # ? @ : % + = & and a space.
password="a/b#c?d@e:f%g+h=i&j k$(od -An -tx1 -N8 /dev/urandom | tr -d ' \n')"
printf '%s\n' "$password" > "$work/secrets/postgres_password"
od -An -tx1 -N32 /dev/urandom | tr -d ' \n' > "$work/secrets/better_auth_secret"

export GOUSSET_VERSION=$tag GOUSSET_PORT=127.0.0.1:$port BETTER_AUTH_URL=http://localhost:$port
"${compose[@]}" up --detach --no-build --pull missing --wait --wait-timeout 180 ||
  fail "the installation did not come up."

migrated=$("${compose[@]}" ps --all --format '{{.ExitCode}}' migrate)
[ "$migrated" = 0 ] || fail "migrate exited with $migrated."

health=$(curl --silent --show-error --max-time 10 --write-out '%{http_code}' --output /dev/null "http://127.0.0.1:$port/health") ||
  fail "/health did not answer."
[ "$health" = 200 ] || fail "/health answered $health."

# No session and no administrator yet: `/` sends the visitor to /setup, Gousset's page.
"$root/tools/check-page.sh" "http://127.0.0.1:$port" || fail "the app's page is not Gousset's."

# The image beside the installation, on its network and database, one thing wrong: what its
# /health answers once it answers (000: it never started, which is not healthy either).
probe() { # <name> <host port> <docker run arguments>…
  local name=$project-$1 published=$2 code=000
  shift 2
  docker run --detach --name "$name" --network "${project}_default" \
    --publish "127.0.0.1:$published:3001" --env "BETTER_AUTH_URL=http://localhost:$published" \
    --env DATABASE_URL=postgresql://gousset@postgres:5432/gousset "$@" \
    "ghcr.io/kristenjestin/gousset:$tag" > /dev/null
  for _ in $(seq 60); do
    code=$(curl --silent --max-time 5 --write-out '%{http_code}' --output /dev/null \
      "http://127.0.0.1:$published/health") || true
    [ "$code" = 000 ] || break
    [ "$(docker inspect --format '{{.State.Running}}' "$name")" = true ] || break
    sleep 1
  done
  echo "$code"
}

# Without its secret, sign-in cannot work (better-auth refuses its default secret in production).
unsigned=$(probe unsigned $((port + 1)) --env "DATABASE_PASSWORD=$password")
[ "$unsigned" != 200 ] || fail "/health answered 200 without BETTER_AUTH_SECRET."

# A password changed on one side only: the database refuses it, and /health says so.
secret=$(cat "$work/secrets/better_auth_secret")
wrong=$(probe wrong-password $((port + 2)) --env "BETTER_AUTH_SECRET=$secret" --env "DATABASE_PASSWORD=not-$password")
[ "$wrong" != 200 ] || fail "/health answered 200 with a wrong database password."

echo "check-image.sh: $tag installs: migrate ran, /health answers 200, the app serves its page;"
echo "check-image.sh: /health answers $unsigned without BETTER_AUTH_SECRET, $wrong with a wrong database password."
