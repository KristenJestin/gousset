#!/usr/bin/env bash
# Updates an installation of the last release to an image, as its owner would (docs/releases.md,
# "Every release is an upgrade"): the release's image with its own docker-compose.yml, filled with
# invented data, then the image under test in its place. Checks that `migrate` runs and ends, twice
# with the same result; that no row of any table changed, went or came, but in the columns and
# tables the new migrations add, which must be named in them; that the upgraded schema is the one
# a fresh installation gets; that the app answers, that every user signs in with the same password
# (a banned one still cannot), that a session made before still works, and that a user's export
# holds their rows as they were. Removes everything it started, whatever happened.
#   tools/check-upgrade.sh <tag>                   from the last release (the highest tag vX.Y.Z)
#   tools/check-upgrade.sh --from 0.1.1 <tag>
#   docker build -t ghcr.io/kristenjestin/gousset:local . && tools/check-upgrade.sh local
# Needs the release's tag in the clone (git fetch --tags), docker compose, curl, jq and unzip.
# GOUSSET_PORT chooses the port on the loopback (3911 by default).
set -euo pipefail

from=
if [ "${1:-}" = --from ]; then
  from=${2:?check-upgrade.sh: --from takes a version, as 0.1.1}
  shift 2
fi
tag=${1:?check-upgrade.sh: give the tag of ghcr.io/kristenjestin/gousset to update to}
port=${GOUSSET_PORT:-3911}
root=$(cd "$(dirname "$0")/.." && pwd)

if [ -z "$from" ]; then
  from=$(git -C "$root" tag --list 'v*' --sort=-version:refname |
    grep -E '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' | head -n 1 || true)
  from=${from#v}
fi
if [ -z "$from" ]; then
  echo "check-upgrade.sh: no release yet (no tag vX.Y.Z): nothing to update from."
  exit 0
fi

work=$(mktemp -d)
project=gousset-upgrade-$$
compose=(docker compose --project-name "$project" --project-directory "$work" -f "$work/docker-compose.yml")
base=http://127.0.0.1:$port
origin=http://localhost:$port

cleanup() {
  "${compose[@]}" down --volumes --remove-orphans > /dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

fail() {
  echo "check-upgrade.sh: $1" >&2
  "${compose[@]}" logs --no-color --tail 40 migrate web >&2 || true
  exit 1
}

say() { echo "check-upgrade.sh: $1"; }

# The release's own compose file: an owner updates by changing the image, not the file
# (docs/releases.md, "Updating").
git -C "$root" show "v$from:docker-compose.yml" > "$work/docker-compose.yml" ||
  fail "v$from has no docker-compose.yml (is the tag fetched?)."

# The migrations the update brings: those of this tree the release did not have.
migrations=$root/packages/db/src/migrations
git -C "$root" ls-tree --name-only "v$from" packages/db/src/migrations/ | xargs -n 1 basename > "$work/old-migrations"
: > "$work/new-migrations.sql"
brought=0
for folder in "$migrations"/*/; do
  name=$(basename "$folder")
  if ! grep -qxF "$name" "$work/old-migrations"; then
    cat "$folder/migration.sql" >> "$work/new-migrations.sql"
    brought=$((brought + 1))
  fi
done
expected=$(find "$migrations" -mindepth 2 -maxdepth 2 -name migration.sql | wc -l)

mkdir "$work/secrets"
password="a/b#c?d@e:f%g+h=i&j k$(od -An -tx1 -N8 /dev/urandom | tr -d ' \n')"
printf '%s\n' "$password" > "$work/secrets/postgres_password"
od -An -tx1 -N32 /dev/urandom | tr -d ' \n' > "$work/secrets/better_auth_secret"

# As the tables' owner, on the socket; one value per line, no header.
sql() { "${compose[@]}" exec -T postgres psql -X -U gousset -d gousset -v ON_ERROR_STOP=1 -tA -c "$1"; }

# A JSON request to the app with a cookie jar, as a browser of BETTER_AUTH_URL sends it. Prints the
# body; fails unless the status is the one expected.
call() { # <jar> <method> <path> <expected status> [<JSON body>]
  local jar=$work/$1 out code
  local args=(--silent --show-error --max-time 20 --cookie "$jar" --cookie-jar "$jar"
    --header "Origin: $origin" --request "$2" --write-out '\n%{http_code}')
  [ $# -lt 5 ] || args+=(--header 'Content-Type: application/json' --data "$5")
  out=$(curl "${args[@]}" "$base$3") || fail "$2 $3 did not answer."
  code=${out##*$'\n'}
  [ "$code" = "$4" ] || fail "$2 $3 answered $code, not $4: ${out%$'\n'*}"
  printf '%s\n' "${out%$'\n'*}"
}

secret() { printf 'Pw-%s' "$(od -An -tx1 -N9 /dev/urandom | tr -d ' \n')"; }
user() { printf '{"name":"%s","email":"%s","password":"%s"}' "$1" "$2" "$3"; }

# Every table of the public schema, one line per column: <table> TAB <column>.
columns() {
  sql "select c.relname || chr(9) || a.attname from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = c.oid
       where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
       " | LC_ALL=C sort > "$1"
}

# Every row of every table <columns file> names, one line each: <table> TAB <the row as JSON>,
# without the columns <added file> names for its table; sorted.
dump() { # <columns file> <added file> <out>
  local table drop
  : > "$3"
  for table in $(cut -f 1 "$1" | uniq); do
    drop=$(awk -F '\t' -v t="$table" '$1 == t { printf "%s%s", sep, $2; sep = "," }' "$2")
    sql "select '$table' || chr(9) || (to_jsonb(r) - '{$drop}'::text[])::text from public.\"$table\" r" >> "$3"
  done
  LC_ALL=C sort -o "$3" "$3"
}

applied() { sql "select count(*) from drizzle.__drizzle_migrations"; }

# /health, once the app listens: 200 when it can serve someone.
health() {
  local code=000
  for _ in $(seq 60); do
    code=$(curl --silent --max-time 5 --write-out '%{http_code}' --output /dev/null "$base/health") || true
    [ "$code" = 000 ] || break
    sleep 1
  done
  echo "$code"
}

# `migrate` of the image under test, once, as `docker compose up` starts it.
migrate() { # <log file>
  "${compose[@]}" run --rm --no-deps migrate > "$1" 2>&1 ||
    fail "migrate of $tag failed: $(tail -n 15 "$1")"
}

# 1. The release, as an owner installed it.
export GOUSSET_VERSION=$from GOUSSET_PORT=127.0.0.1:$port BETTER_AUTH_URL=$origin
"${compose[@]}" up --detach --no-build --pull missing --wait --wait-timeout 180 > "$work/up" 2>&1 ||
  fail "$from did not come up: $(tail -n 5 "$work/up")"
code=$(health)
[ "$code" = 200 ] || fail "/health of $from answered $code."
say "$from is installed."

# 2. Its users, through its own API: the administrator by sign-up; Camille given a temporary
# password, which she replaced with her own; Dominique still on the temporary one; Eden banned.
admin_password=$(secret) camille_temporary=$(secret) camille_password=$(secret)
dominique_password=$(secret) eden_password=$(secret)
admin=$(call admin POST /api/auth/sign-up/email 200 "$(user "Ada Exemple" admin@example.com "$admin_password")" | jq -r .user.id)
camille=$(call admin POST /api/auth/admin/create-user 200 \
  "$(user "Camille Exemple" camille@example.com "$camille_temporary")" | jq -r .user.id)
call admin POST /api/auth/admin/create-user 200 \
  "$(user "Dominique Exemple" dominique@example.com "$dominique_password")" > /dev/null
eden=$(call admin POST /api/auth/admin/create-user 200 \
  "$(user "Eden Exemple" eden@example.com "$eden_password")" | jq -r .user.id)
call admin POST /api/auth/admin/ban-user 200 "{\"userId\":\"$eden\",\"banReason\":\"invented\"}" > /dev/null
call camille POST /api/auth/sign-in/email 200 \
  "{\"email\":\"camille@example.com\",\"password\":\"$camille_temporary\"}" > /dev/null
call camille POST /api/auth/change-password 200 \
  "{\"currentPassword\":\"$camille_temporary\",\"newPassword\":\"$camille_password\",\"revokeOtherSessions\":false}" > /dev/null
[ "$(call camille GET /api/auth/get-session 200 | jq -r .user.email)" = camille@example.com ] ||
  fail "Camille's session does not work on $from."

# 3. What the release offers no route for, through the tables' owner (tools/check-upgrade.sql).
"${compose[@]}" exec -T postgres psql -X -q -U gousset -d gousset -v camille="$camille" -v admin="$admin" \
  -f - < "$root/tools/check-upgrade.sql" > /dev/null || fail "tools/check-upgrade.sql did not fill $from."

# 4. The data as the release leaves it, the app stopped (an owner's update replaces it).
"${compose[@]}" stop web > /dev/null 2>&1
columns "$work/columns-before"
: > "$work/none"
dump "$work/columns-before" "$work/none" "$work/before"
say "$from holds $(wc -l < "$work/before") rows in $(cut -f 1 "$work/columns-before" | uniq | wc -l) tables:"
say "  $(cut -f 1 "$work/before" | uniq -c | awk '{ printf "%s %s, ", $2, $1 }')"

# 5. The image under test in its place: `migrate` runs and ends, and has applied every migration.
export GOUSSET_VERSION=$tag
migrate "$work/migrate-1"
count=$(applied)
[ "$count" = "$expected" ] || fail "migrate applied $count migrations, the tree has $expected."

# 6. What changed in the tables: only what the new migrations add, by name.
columns "$work/columns-after"
LC_ALL=C comm -23 "$work/columns-before" "$work/columns-after" > "$work/removed"
[ ! -s "$work/removed" ] ||
  fail "the update removed or renamed these columns (a destructive change goes in two releases, docs/data-model.md, \"Migrations\"): $(tr '\t\n' '. ' < "$work/removed")"
LC_ALL=C comm -13 "$work/columns-before" "$work/columns-after" > "$work/added"
cut -f 1 "$work/columns-before" | uniq > "$work/tables-before"
while IFS=$'\t' read -r table column; do
  if grep -qxF "$table" "$work/tables-before"; then
    grep -Eiq "alter table (if exists )?(\"?public\"?\.)?\"?$table\"? add column (if not exists )?\"?$column\"?[ ;]" "$work/new-migrations.sql" ||
      fail "column $table.$column appeared, but no new migration adds it by name (ALTER TABLE \"$table\" ADD COLUMN \"$column\")."
    say "  added by the new migrations: $table.$column"
  else
    grep -Eiq "create table (if not exists )?(\"?public\"?\.)?\"?$table\"?[ (]" "$work/new-migrations.sql" ||
      fail "table $table appeared, but no new migration creates it by name (CREATE TABLE \"$table\")."
  fi
done < "$work/added"
cut -f 1 "$work/added" | uniq | grep -vxF -f "$work/tables-before" | sed 's/^/check-upgrade.sh:   a new table: /' || true

# Every row, but in the columns added, as it was.
dump "$work/columns-before" "$work/added" "$work/after"
if ! diff "$work/before" "$work/after" > "$work/rows.diff"; then
  echo "check-upgrade.sh: rows changed (< before the update, > after), the first lines:" >&2
  head -n 20 "$work/rows.diff" | cut -c 1-300 >&2
  fail "the update changed, removed or added rows of existing tables."
fi
say "migrate of $tag applied the $brought new migrations and ended; every row is as it was."

# 7. Run again on a database that has them: nothing more applied, nothing changed.
migrate "$work/migrate-2"
[ "$(applied)" = "$expected" ] || fail "migrate run again applied more migrations."
dump "$work/columns-before" "$work/added" "$work/again"
diff -q "$work/after" "$work/again" > /dev/null || fail "migrate run again changed rows."

# 8. The installation as `docker compose up` brings it back: migrate, then the app.
"${compose[@]}" up --detach --no-build --pull never --wait --wait-timeout 180 > "$work/up" 2>&1 ||
  fail "$tag did not come up over $from's data: $(tail -n 5 "$work/up")"
migrated=$("${compose[@]}" ps --all --format '{{.ExitCode}}' migrate)
[ "$migrated" = 0 ] || fail "migrate exited with $migrated."
code=$(health)
[ "$code" = 200 ] || fail "/health of $tag answered $code."
say "$tag serves: /health answers 200."

# 9. Everyone signs in as before; the session made before still works.
signin() { call "$1" POST /api/auth/sign-in/email "$4" "{\"email\":\"$2\",\"password\":\"$3\"}"; }
signin admin-after admin@example.com "$admin_password" 200 > /dev/null
signin camille-after camille@example.com "$camille_password" 200 > /dev/null
signin wrong camille@example.com "$camille_temporary" 401 > /dev/null
signin dominique dominique@example.com "$dominique_password" 200 > /dev/null
[ "$(call dominique GET /api/auth/get-session 200 | jq -r .user.mustChangePassword)" = true ] ||
  fail "Dominique's temporary password no longer has to be replaced."
signin eden eden@example.com "$eden_password" 403 > /dev/null
[ "$(call camille GET /api/auth/get-session 200 | jq -r .user.email)" = camille@example.com ] ||
  fail "Camille's session made on $from no longer works."
say "the administrator, Camille and Dominique sign in with their passwords, Eden is still banned,"
say "and Camille's session made on $from still works."

# 10. Camille's export (#22): her rows of each table as they were, and her files.
curl --silent --show-error --fail --max-time 30 --cookie "$work/camille-after" \
  --output "$work/export.zip" "$base/api/export" || fail "Camille's export failed."
for pair in accounts:account account-balances:account_balance statement-lines:statement_line \
  imports:import import-profiles:import_profile; do
  file=${pair%%:*} table=${pair#*:}
  drop=$(awk -F '\t' -v t="$table" '$1 == t { print $2 }' "$work/added" | jq -R . | jq -sc .)
  unzip -p "$work/export.zip" "$file.json" > "$work/export.json" || fail "the export has no $file.json."
  jq -c -S --argjson drop "$drop" '.[] | reduce $drop[] as $c (.; del(.[$c]))' "$work/export.json" |
    LC_ALL=C sort > "$work/exported"
  awk -F '\t' -v t="$table" '$1 == t { print $2 }' "$work/before" |
    jq -c -S --arg u "$camille" 'select(.user_id == $u)' | LC_ALL=C sort > "$work/held"
  [ -s "$work/held" ] || fail "Camille had no row of $table to export: tools/check-upgrade.sql fills one."
  diff -q "$work/held" "$work/exported" > /dev/null ||
    fail "Camille's export of $table is not her rows as $from held them."
done
awk -F '\t' '$1 == "import_file" { print $2 }' "$work/before" | jq -r --arg u "$camille" \
  'select(.user_id == $u) | [.import_id, (.content | ltrimstr("\\x"))] | @tsv' > "$work/files"
while IFS=$'\t' read -r id content; do
  name=$(awk -F '\t' -v i="$id" '$1 == "import" { print $2 }' "$work/before" | jq -r --arg i "$id" 'select(.id == $i) | .file_name')
  exported=$(unzip -p "$work/export.zip" "import-files/$id/$name" | od -An -tx1 -v | tr -d ' \n')
  [ "$exported" = "$content" ] || fail "the export's file of import $id is not the one imported."
done < "$work/files"
say "Camille's export holds her rows of every table and her $(wc -l < "$work/files") files as $from held them."

# 11. The upgraded schema is a fresh installation's.
sql "create database gousset_fresh" > /dev/null
"${compose[@]}" run --rm --no-deps --env DATABASE_URL=postgresql://gousset@postgres:5432/gousset_fresh \
  migrate > "$work/migrate-fresh" 2>&1 || fail "migrate of $tag on an empty database failed: $(tail -n 15 "$work/migrate-fresh")"
schema() {
  "${compose[@]}" exec -T postgres pg_dump -U gousset -d "$1" --schema-only --schema=public |
    grep -Ev '^(--|\\(un)?restrict |$)'
}
schema gousset > "$work/schema-upgraded"
schema gousset_fresh > "$work/schema-fresh"
if ! diff "$work/schema-fresh" "$work/schema-upgraded" > "$work/schema.diff"; then
  echo "check-upgrade.sh: the schemas differ (< fresh, > upgraded), the first lines:" >&2
  head -n 20 "$work/schema.diff" >&2
  fail "the upgraded schema is not a fresh installation's."
fi
say "the upgraded schema is the one a fresh installation of $tag gets."
say "$from updates to $tag."
