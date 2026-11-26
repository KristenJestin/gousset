#!/usr/bin/env bash
# Updates an installation of the last release to an image, as its owner would (docs/releases.md,
# "Every release is an upgrade"): the release's image with its own docker-compose.yml, filled with
# invented data, then the image under test in its place. Checks that `migrate` runs and ends, twice
# with the same result; that no row of any table changed, went or came, but in the columns and
# tables the new migrations add, which must be named in them, and as the changes they declare in
# tools/check-upgrade.changes.json, each found in the release's rows; that the upgraded schema is
# the one a fresh installation gets; that the app answers, that every user signs in with the same
# password (a banned one still cannot), that a session made before still works, that a user's
# export holds their rows as they were, and that a statement the release imported adds nothing
# when imported again, and that a merchant's colour and logo (#204) set after the update survive
# migrate run again and come out in the export. Removes everything it started, whatever happened.
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
: > "$work/new-migration-names"
brought=0
for folder in "$migrations"/*/; do
  name=$(basename "$folder")
  if ! grep -qxF "$name" "$work/old-migrations"; then
    cat "$folder/migration.sql" >> "$work/new-migrations.sql"
    echo "$name" >> "$work/new-migration-names"
    brought=$((brought + 1))
  fi
done

# The changes to existing rows the new migrations declare (tools/check-upgrade.changes.json, by
# migration): each finds rows of a table by some of their values (`where`) and gives the values they
# take (`set`). No other row may change.
jq -c --rawfile names "$work/new-migration-names" \
  '. as $declared | [$names | split("\n")[] | select(. != "") | ($declared[.] // [])[]]' \
  "$root/tools/check-upgrade.changes.json" > "$work/changes" ||
  fail "tools/check-upgrade.changes.json cannot be read."
echo '[]' > "$work/no-changes"
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

# A dump's rows, each written again by jq, with the changes of <changes file> applied to the rows
# they find; sorted. Run on the rows before the update, it gives the rows expected after it.
expect() { # <dump> <changes file> <out>
  jq -R -r --slurpfile changes "$2" '
    index("\t") as $at | .[:$at] as $table | (.[$at + 1:] | fromjson) as $row
    | reduce ($changes[0][] | select(.table == $table and (.where | to_entries | all(.value == $row[.key]))))
        as $change ($row; . + $change.set)
    | "\($table)\t\(tojson)"' "$1" | LC_ALL=C sort > "$3"
}

# Uploads a file as the jar's user, through the import route, as the import screen does; prints
# the import's id, or nothing when the release has no such route.
upload() { # <jar> <file>
  local jar=$work/$1 out code
  out=$(curl --silent --show-error --max-time 30 --cookie "$jar" --cookie-jar "$jar" \
    --header "Origin: $origin" --header 'Content-Type: application/octet-stream' \
    --data-binary "@$2" --write-out '\n%{http_code}' "$base/api/imports?name=$(basename "$2")") ||
    fail "the upload of $(basename "$2") did not answer."
  code=${out##*$'\n'}
  [ "$code" != 404 ] || return 0
  [ "$code" = 200 ] || fail "the upload of $(basename "$2") answered $code: ${out%$'\n'*}"
  printf '%s\n' "${out%$'\n'*}" | jq -r .importId
}

# An import, once its job has ended: its status, lines added and lines found already known.
settled() { # <import id>
  local row
  for _ in $(seq 90); do
    row=$(sql "select status || ' ' || lines_added || ' ' || lines_duplicate from import where id = '$1'")
    case $row in
      queued* | reading* | saving* | '') sleep 1 ;;
      *) echo "$row"; return 0 ;;
    esac
  done
  fail "the import $1 did not end within 90 seconds."
}

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

# 3b. A statement through the release's own import route, where it has one (from 0.2.0): an
# invented OFX whose bank encodes entities twice (#132), read as that release reads it, into
# Camille's account, which its IBAN names. Imported again after the update, below.
statement=$root/tools/check-upgrade.ofx
first_import=$(upload camille "$statement")
if [ -n "$first_import" ]; then
  ended=$(settled "$first_import")
  [ "$ended" = "done 15 0" ] ||
    fail "$from did not import $(basename "$statement") whole: $ended, not \"done 15 0\"."
  say "Camille imported $(basename "$statement") through $from's own route."
  # A release before #194 named merchants from a label's operation prefix: the update reads them
  # again at boot, below.
  prefixed=$(sql "select count(*) from merchant where user_id = '$camille'
    and name in ('Ann Carte Cafe Exemple', 'F Cotisation')")
  say "$from made $prefixed merchant(s) of an operation prefix."
  # A release before #193 made a merchant per town of a shop's card labels: the update merges those
  # Camille never touched, once, at boot, below. Pizza Nova, Freshmart and Bookmill, each paid in
  # Riverton and in Lakeside, show the towns. Camille split Bookmill's by town herself (after
  # merging them): the boot leaves it so. Cafe Bora Bora ends with a doubled word, which is no sure
  # town: the boot leaves it whole.
  per_town=$(sql "select count(*) from merchant where user_id = '$camille' and name in
    ('Pizza Nova Riverton', 'Pizza Nova Lakeside', 'Freshmart Riverton', 'Freshmart Lakeside',
     'Bookmill Riverton', 'Bookmill Lakeside', 'Cafe Bora Bora')")
  case $from in
    0.1.* | 0.2.*) ;;
    *)
      [ "$per_town" = 7 ] || fail "$from made $per_town merchant(s) of a shop in a town, not 7."
      # Her merge of Bookmill's two merchants, as the release does it: the labels move, the merged
      # one goes, the one kept is changed. Then her split: a new merchant, named as recognition
      # names it, takes the Lakeside label.
      sql "update merchant_alias set merchant_id = (select id from merchant where user_id = '$camille'
        and name = 'Bookmill Riverton') where user_id = '$camille' and alias = 'BOOKMILL LAKESIDE';
        delete from merchant where user_id = '$camille' and name = 'Bookmill Lakeside';
        update merchant set updated_at = clock_timestamp() where user_id = '$camille'
          and name = 'Bookmill Riverton'" > /dev/null
      sql "insert into merchant (user_id, name) values ('$camille', 'Bookmill Lakeside');
        update merchant_alias set merchant_id = (select id from merchant where user_id = '$camille'
        and name = 'Bookmill Lakeside') where user_id = '$camille' and alias = 'BOOKMILL LAKESIDE'" > /dev/null
      ;;
  esac
  say "$from made $per_town merchant(s) of a shop in a town."
else
  say "$from has no import route: $(basename "$statement") is not imported."
fi

# 4. The data as the release leaves it, the app stopped (an owner's update replaces it).
"${compose[@]}" stop web > /dev/null 2>&1
columns "$work/columns-before"
: > "$work/none"
dump "$work/columns-before" "$work/none" "$work/before"
say "$from holds $(wc -l < "$work/before") rows in $(cut -f 1 "$work/columns-before" | uniq | wc -l) tables:"
say "  $(cut -f 1 "$work/before" | uniq -c | awk '{ printf "%s %s, ", $2, $1 }')"

# The counted lines with an amount that lack their one entry paid by the whole line (v0.3, #23), or
# that are a side of a transfer (#26) and have one: none, from a release that has entries on.
unclassified() {
  sql "select count(*) from statement_line l where l.state = 'counted' and l.amount_minor <> 0
    and case when exists (select 1 from transfer t where l.id in (t.out_line_id, t.in_line_id))
      then exists (select 1 from entry_part p where p.line_id = l.id)
      else (select count(*) from entry_part p where p.line_id = l.id) <> 1
        or exists (select 1 from entry_part p where p.line_id = l.id
          and (p.role <> 'payment' or p.amount_minor <> abs(l.amount_minor))) end"
}

# A release that has entries writes each with its line: invented data without them is data the
# release could not hold, and the update would be blamed for it.
if [ "$(sql "select to_regclass('public.entry_part') is not null")" = t ]; then
  held=$(unclassified)
  [ "$held" = 0 ] ||
    fail "$held counted lines of $from have no entry of their own, or more than one, before the update: tools/check-upgrade.sql writes them as $from does."
fi

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

# Every row, but in the columns added, as it was, or as the new migrations declare it changes; each
# declared change found in the release's rows, once a statement came through its import route.
if [ -n "$first_import" ]; then
  unmatched=$(jq -R -s -r --slurpfile changes "$work/changes" '
    [split("\n")[] | select(. != "") | index("\t") as $at
      | {table: .[:$at], row: (.[$at + 1:] | fromjson)}] as $rows
    | $changes[0][] | . as $change
    | select(any($rows[]; .table == $change.table
        and (.row as $row | $change.where | to_entries | all(.value == $row[.key]))) | not)
    | .why' "$work/before")
  [ -z "$unmatched" ] ||
    fail "a change the new migrations declare (tools/check-upgrade.changes.json) finds no row of $from: $unmatched"
fi
expect "$work/before" "$work/no-changes" "$work/before-rows"
expect "$work/before" "$work/changes" "$work/expected"
dump "$work/columns-before" "$work/added" "$work/after"
expect "$work/after" "$work/no-changes" "$work/after-rows"
if ! diff "$work/expected" "$work/after-rows" > "$work/rows.diff"; then
  echo "check-upgrade.sh: rows changed (< expected after the update, > after), the first lines:" >&2
  head -n 20 "$work/rows.diff" | cut -c 1-300 >&2
  fail "the update changed, removed or added rows of existing tables, beyond what its migrations declare."
fi
say "migrate of $tag applied the $brought new migrations and ended; every row is as it was,"
say "  but the $(LC_ALL=C comm -13 "$work/before-rows" "$work/expected" | wc -l) rows its migrations declare they change, changed as declared."

# 7. Run again on a database that has them: nothing more applied, nothing changed.
migrate "$work/migrate-2"
[ "$(applied)" = "$expected" ] || fail "migrate run again applied more migrations."
dump "$work/columns-before" "$work/added" "$work/again"
diff -q "$work/after" "$work/again" > /dev/null || fail "migrate run again changed rows."

# Every counted line with an amount has its one entry, paid by the whole line (v0.3, #23), but a
# side of a transfer (#26), which has none: the update gives one to each line the release held,
# once, however often migrate runs.
unclassified=$(unclassified)
[ "$unclassified" = 0 ] || fail "$unclassified counted lines have no entry of their own, or more than one, or are a transfer's side with one, after the update."
say "every counted line with an amount has its one entry."

# The categories that take an operation's lines (#194): Camille's untouched defaults are marked,
# Bank fees for the fees and Interest for the interest, by the update's migration.
marked=$(sql "select string_agg(name || ':' || operation, ',' order by name) from category
  where user_id = '$camille' and operation is not null")
[ "$marked" = "Bank fees:fee,Interest:interest" ] ||
  fail "Camille's categories marked with an operation are \"$marked\", not Bank fees and Interest."
say "Camille's Bank fees and Interest take the fees and the interest."

# Two of Camille's old transfer lines, classified where the release could (from 0.3.0,
# tools/check-upgrade.sql), one by hand, one by a rule of hers: their expenses before the app
# starts, which the boot must leave as they are. Beside them she classified only the refund of
# BRICOBOX by hand (#208, below).
line() { printf '019a0000-0000-7000-8000-000000000%s' "$1"; }
decided() {
  sql "select coalesce(string_agg(to_jsonb(e)::text, ' ' order by p.line_id), '') from entry e
    join entry_part p on p.entry_id = e.id
    where (p.line_id = '$(line 414)' and e.classified_by = 'user')
      or (p.line_id = '$(line 415)' and e.classified_by = 'rule' and e.rule_id is not null)"
}
hand=$(decided)
[ -z "$hand" ] || [ "$(sql "select count(*) from entry e where e.classified_by <> 'default' and e.user_id = '$camille'
  and not exists (select 1 from entry_part p where p.entry_id = e.id and p.line_id = '$(line 416)')")" = 2 ] ||
  fail "Camille's two old transfer lines are not classified, one by hand and one by a rule, before the boot."

# Camille's rows of the release (the dump of step 4) that a table names, kept by a jq filter.
held_rows() { # <table> <jq filter>
  awk -F '\t' -v t="$1" '$1 == t { print $2 }' "$work/before" |
    jq -s --arg u "$camille" "[.[] | select(.user_id == \$u) | select($2)] | length"
}

# Money coming back that may be a refund is no income until the user answers (#208), read from
# the lines and only the user's answer stored (statement_line.refund_refused): the refund Camille
# left unanswered on the release (tools/check-upgrade.sql, from 0.3.0) is answered by nothing after
# the update, still the only line of its income classified by default, with the purchase it may
# cancel, so the app shows it apart; the one she classified by hand stays hers, an income.
if [ "$(held_rows entry_part '.line_id == "019a0000-0000-7000-8000-000000000409"')" = 1 ]; then
  waiting=$(sql "select count(*) from statement_line l
    join entry_part p on p.line_id = l.id join entry e on e.id = p.entry_id
    where l.id = '019a0000-0000-7000-8000-000000000409' and not l.refund_refused
      and e.kind = 'income' and e.classified_by = 'default'
      and (select count(*) from entry_part q where q.entry_id = e.id) = 1
      and exists (select 1 from statement_line b join entry_part bp on bp.line_id = b.id
        where b.id = '019a0000-0000-7000-8000-000000000408' and bp.role = 'payment'
          and b.label = l.label and b.booked_on <= l.booked_on and -b.amount_minor >= l.amount_minor)")
  [ "$waiting" = 1 ] ||
    fail "the refund Camille left unanswered on $from is no longer one that waits for her answer."
  kept=$(sql "select e.kind || ' ' || e.classified_by || ' ' || l.refund_refused from statement_line l
    join entry_part p on p.line_id = l.id join entry e on e.id = p.entry_id
    where l.id = '019a0000-0000-7000-8000-000000000416'")
  [ "$kept" = "income user false" ] ||
    fail "the refund Camille classified by hand on $from reads \"$kept\", not \"income user false\"."
  say "Camille's unanswered refund waits apart for her answer; the one she classified stays an income."
fi

# 8. The installation as `docker compose up` brings it back: migrate, then the app.
booted=$(sql "select now()")
"${compose[@]}" up --detach --no-build --pull never --wait --wait-timeout 180 > "$work/up" 2>&1 ||
  fail "$tag did not come up over $from's data: $(tail -n 5 "$work/up")"
migrated=$("${compose[@]}" ps --all --format '{{.ExitCode}}' migrate)
[ "$migrated" = 0 ] || fail "migrate exited with $migrated."
code=$(health)
[ "$code" = 200 ] || fail "/health of $tag answered $code."
say "$tag serves: /health answers 200."

# At boot the app sends each user's merchants job and balances job (apps/web, jobs/runtime.server.ts):
# the checks below read Camille's rows once both have completed, as pg-boss records them.
boot_jobs=0
for _ in $(seq 60); do
  boot_jobs=$(sql "select count(distinct name) from pgboss.job
    where name in ('recognise-merchants', 'remake-balance-lines') and data ->> 'owner' = '$camille'
    and created_on >= '$booted' and state = 'completed'")
  [ "$boot_jobs" != 2 ] || break
  sleep 1
done
[ "$boot_jobs" = 2 ] || fail "Camille's merchants and balances jobs did not complete within a minute of the app's start."

# The app recognises every user's merchants at boot (#24): Camille's lines, kept before merchants
# existed, get theirs without an import. From 0.3.0 the release's own import recognised them
# already (step 3b): the boot then loses none but the cleaned labels of the merchants it made from
# an operation prefix, which the boot reads again (#194, below): a card's cancellation, a fee, and
# the free text of her `VIR` transfers between her own accounts (tools/check-upgrade.sql), which
# names no one; only an update from before merchants shows that it makes them.
held_aliases=$(held_rows merchant_alias '.alias != "ANN CARTE CAFE EXEMPLE" and .alias != "F COTISATION"
  and (.alias | (startswith("VERS LIVRET") or startswith("DEPUIS COMPTE") or startswith("EPARGNE PROJET")) | not)')
recognised=$(sql "select count(*) from merchant_alias where user_id = '$camille'")
[ "$recognised" != 0 ] || fail "Camille's lines got no merchant at the app's start."
[ "$recognised" -ge "$held_aliases" ] ||
  fail "Camille had $held_aliases cleaned label(s) on $from, $recognised once $tag started."
if [ "$held_aliases" = 0 ]; then
  say "Camille's lines got their merchants at boot: $recognised cleaned label(s)."
else
  say "Camille's merchants came from $from's import ($held_aliases cleaned label(s)); after the boot, $recognised."
fi

# The app makes the movement lines of the accounts kept by their balance at boot (#31): the balance
# Camille noted on her Livret A before they existed gets its line, of the whole balance (the account
# opened at zero, with no other line), and that line its one entry. From 0.3.0 the release's own
# import made that line already (step 3b): the boot then makes no second one, and only an update
# from before movement lines shows that it makes them.
held_moved=$(held_rows statement_line '.source == "balance" and .amount_minor == 1230000')
moved=$(sql "select count(*) from statement_line l where l.user_id = '$camille' and l.source = 'balance'
  and l.amount_minor = 1230000 and (select count(*) from entry_part p where p.line_id = l.id) = 1")
lines=$(sql "select count(*) from statement_line where user_id = '$camille' and source = 'balance'")
[ "$moved" = 1 ] && [ "$lines" = 1 ] ||
  fail "Camille's noted balance has $lines movement line(s), $moved of the whole balance with its entry, not 1 once the boot's jobs completed."
if [ "$held_moved" = 0 ]; then
  say "Camille's noted balance got its movement line at boot."
else
  say "Camille's noted balance has the movement line $from's import made, and the boot made no second one."
fi

# The merchants the release made from an operation prefix (#194), which Camille never touched, are
# forgotten at boot, and her card's cancellation names its shop.
if [ -n "$first_import" ]; then
  reread=
  for _ in $(seq 60); do
    left=$(sql "select count(*) from merchant where user_id = '$camille'
      and name in ('Ann Carte Cafe Exemple', 'F Cotisation')")
    shop=$(sql "select count(*) from merchant_alias where user_id = '$camille' and alias = 'CAFE EXEMPLE'")
    fee=$(sql "select c.operation from statement_line l join entry_part p on p.line_id = l.id
      join entry e on e.id = p.entry_id join category c on c.id = e.category_id
      where l.user_id = '$camille' and l.label = 'F COTISATION CARTE'")
    if [ "$left" = 0 ] && [ "$shop" = 1 ] && [ "$fee" = fee ]; then
      reread=yes
      break
    fi
    sleep 1
  done
  [ -n "$reread" ] ||
    fail "the merchants $from made from an operation prefix were not read again, or its fee not put in Bank fees, within a minute of the app's start."
  say "the $prefixed merchant(s) $from made from an operation prefix were read again at boot, and its fee went to Bank fees."

  # The merchants the release made one per town (#193), which Camille never touched, are one per
  # shop after the boot, named after it, each with both its cleaned labels; Bookmill's, which she
  # split, and Cafe Bora Bora stay as they were. From a release before merchants, the boot's
  # recognition names each shop without its town, and Cafe Bora Bora after its doubled word.
  case $from in
    0.1.* | 0.2.*)
      one_per_shop="Bookmill:BOOKMILL LAKESIDE,Bookmill:BOOKMILL RIVERTON,Cafe:CAFE BORA BORA" ;;
    *)
      one_per_shop="Bookmill Lakeside:BOOKMILL LAKESIDE,Bookmill Riverton:BOOKMILL RIVERTON,Cafe Bora Bora:CAFE BORA BORA" ;;
  esac
  one_per_shop="$one_per_shop,Freshmart:FRESHMART LAKESIDE,Freshmart:FRESHMART RIVERTON,Pizza Nova:PIZZA NOVA LAKESIDE,Pizza Nova:PIZZA NOVA RIVERTON"
  shops=
  for _ in $(seq 60); do
    shops=$(sql "select coalesce(string_agg(m.name || ':' || a.alias, ',' order by m.name, a.alias), '')
      from merchant m join merchant_alias a on a.merchant_id = m.id
      where m.user_id = '$camille' and a.alias in ('PIZZA NOVA RIVERTON', 'PIZZA NOVA LAKESIDE',
        'FRESHMART RIVERTON', 'FRESHMART LAKESIDE', 'BOOKMILL RIVERTON', 'BOOKMILL LAKESIDE',
        'CAFE BORA BORA')")
    [ "$shops" != "$one_per_shop" ] || break
    sleep 1
  done
  [ "$shops" = "$one_per_shop" ] ||
    fail "Camille's merchants of a shop in two towns are \"$shops\" a minute after the app's start, not \"$one_per_shop\"."
  [ "$(sql "select merchant_towns_merged from auth_user where id = '$camille'")" = t ] ||
    fail "Camille is not marked as having had her merchants of a shop in a town merged."
  say "the $per_town merchant(s) $from made per town are one per shop after the boot, once: Pizza Nova and"
  say "  Freshmart; Bookmill's, which Camille split, and Cafe Bora Bora, of no sure town, stay as they were."
fi

# The boot jobs of <n> starts of the app, for every user, ended: none waits or runs any more, and
# the pairing's, sent last for each user, completed once per user and start.
boot_ended() { # <starts>
  local users left completed
  users=$(sql "select count(*) from auth_user")
  for _ in $(seq 120); do
    left=$(sql "select count(*) from pgboss.job where state in ('created', 'retry', 'active')
      and name in ('recognise-merchants', 'remake-balance-lines', 'pair-transfers')")
    completed=$(sql "select count(*) from pgboss.job where name = 'pair-transfers' and state = 'completed'")
    [ "$left" != 0 ] || [ "$completed" != $((users * $1)) ] || return 0
    sleep 1
  done
  fail "the boot jobs of $1 start(s) did not all end within two minutes: $left left, $completed of $((users * $1)) pairings completed."
}

# The app pairs every user's transfers at boot (#192), with the import's rules: Camille's lines kept
# before v0.3, never paired (tools/check-upgrade.sql), are paired where each is the other's only
# candidate, a day apart and across her savings account's fortnight (#131), and lose their entries;
# the money out with two candidates, and those two, are left to the review, each an expense or an
# income of its own. The two clear pairs whose side she, or a rule of hers, classified are left as
# they are, their expenses unchanged; from a release with no entries she could not have, and they
# are paired.
boot_ended 1
expected="$(line 411)>$(line 421) $(line 413)>$(line 424)"
[ -n "$hand" ] || expected="$expected $(line 414)>$(line 425) $(line 415)>$(line 426)"
pairs=$(sql "select string_agg(t.out_line_id::text || '>' || t.in_line_id::text, ' ' order by t.out_line_id)
  from transfer t where t.user_id = '$camille'")
[ "$pairs" = "$expected" ] ||
  fail "Camille's transfers after boot are \"$pairs\", not \"$expected\"."
if [ -n "$hand" ]; then
  [ "$(decided)" = "$hand" ] ||
    fail "the expenses of the lines Camille and her rule classified changed at boot: $(decided), not $hand."
  say "the old transfer lines Camille classified, by hand and by a rule, stay unpaired, their expenses unchanged."
fi
waiting=$(sql "select count(*) from statement_line l where l.id in ('$(line 412)', '$(line 422)', '$(line 423)')
  and l.review_state = 'to_review' and l.transfer_refused = false
  and (select count(*) from entry_part p where p.line_id = l.id) = 1")
[ "$waiting" = 3 ] || fail "Camille's ambiguous transfer is not left to the review: $waiting of its 3 lines are."
count=$(unclassified)
[ "$count" = 0 ] || fail "$count counted lines have no entry of their own, or more than one, or are a transfer's side with one, after the boot."
say "Camille's transfers kept before v0.3 are paired at boot: the clear pair and the fortnight's;"
say "  the ambiguous one waits in the review."

# A second start of the app changes no row: every boot job finds nothing left to do.
dump "$work/columns-after" "$work/none" "$work/booted"
"${compose[@]}" restart web > "$work/restart" 2>&1 || fail "$tag did not start again: $(tail -n 5 "$work/restart")"
code=$(health)
[ "$code" = 200 ] || fail "/health of $tag answered $code once started again."
boot_ended 2
dump "$work/columns-after" "$work/none" "$work/booted-again"
if ! diff "$work/booted" "$work/booted-again" > "$work/boot.diff"; then
  echo "check-upgrade.sh: rows changed at the second start (< after the first, > after the second), the first lines:" >&2
  head -n 20 "$work/boot.diff" | cut -c 1-300 >&2
  fail "the second start of the app changed rows."
fi
say "a second start of $tag changes no row."

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

# 9b. The default categories in the user's language (#195): the update leaves Camille's in English,
# as her account got them, and unmarked. She renamed one; her first page in French renames those
# she never touched, once, and keeps hers; a second page changes nothing.
sql "update category set name = 'Home' where user_id = '$camille' and kind = 'expense'
  and parent_id is null and name = 'Housing'" > /dev/null
[ "$(sql "select default_categories_settled from auth_user where id = '$camille'")" = f ] ||
  fail "Camille's default categories are marked as in her language before any page of hers."
categories_page() {
  curl --silent --show-error --fail --max-time 30 --cookie "$work/camille-after" \
    --header 'Accept-Language: fr-FR,fr;q=0.9' --output /dev/null "$base/settings/categories" ||
    fail "Camille's page of categories did not open."
}
category_names() {
  sql "select c.kind || ':' || coalesce(p.name || ' > ', '') || c.name from category c
    left join category p on p.id = c.parent_id where c.user_id = '$camille'" | LC_ALL=C sort > "$1"
}
categories_page
category_names "$work/categories-french"
for name in 'expense:Courses' 'expense:Courses > Supermarché' 'expense:Autre' 'income:Autre' \
  'income:Salaire > Paie' 'expense:Home' 'expense:Home > Rent'; do
  grep -qxF "$name" "$work/categories-french" ||
    fail "Camille's categories hold no \"$name\" after her first page in French."
done
! grep -qxF 'expense:Groceries' "$work/categories-french" ||
  fail "Camille's untouched \"Groceries\" is still in English after her first page in French."
[ "$(sql "select default_categories_settled from auth_user where id = '$camille'")" = t ] ||
  fail "Camille's default categories are not marked as in her language after her first page."
categories_page
category_names "$work/categories-again"
diff -q "$work/categories-french" "$work/categories-again" > /dev/null ||
  fail "Camille's second page renamed her categories again."
say "Camille's untouched default categories took her language at her first page, the one she"
say "  renamed kept; a second page changed nothing."

# 10. Camille's export (#22): her rows of each table as they were, and her files; a movement line
# the app made at boot from her noted balance (#31, above) is the update's, not the release's, but
# one the release made already (from 0.3.0) is among her rows.
curl --silent --show-error --fail --max-time 30 --cookie "$work/camille-after" \
  --output "$work/export.zip" "$base/api/export" || fail "Camille's export failed."
for pair in accounts:account account-balances:account_balance statement-lines:statement_line \
  imports:import import-profiles:import_profile; do
  file=${pair%%:*} table=${pair#*:}
  drop=$(awk -F '\t' -v t="$table" '$1 == t { print $2 }' "$work/added" | jq -R . | jq -sc .)
  unzip -p "$work/export.zip" "$file.json" > "$work/export.json" || fail "the export has no $file.json."
  awk -F '\t' -v t="$table" '$1 == t { print $2 }' "$work/expected" |
    jq -c -S --arg u "$camille" 'select(.user_id == $u)' | LC_ALL=C sort > "$work/held"
  [ -s "$work/held" ] || fail "Camille had no row of $table to export: tools/check-upgrade.sql fills one."
  jq -c -S --argjson drop "$drop" --slurpfile held "$work/held" '[$held[].id] as $ids
    | .[] | select(.source != "balance" or (.id as $id | any($ids[]; . == $id)))
    | reduce $drop[] as $c (.; del(.[$c]))' "$work/export.json" |
    LC_ALL=C sort > "$work/exported"
  if ! diff "$work/held" "$work/exported" > "$work/export.diff"; then
    echo "check-upgrade.sh: Camille's $table (< as $from held them, > exported), the first lines:" >&2
    head -n 20 "$work/export.diff" | cut -c 1-600 >&2
    fail "Camille's export of $table is not her rows as $from held them."
  fi
done
awk -F '\t' '$1 == "import_file" { print $2 }' "$work/before" | jq -r --arg u "$camille" \
  'select(.user_id == $u) | [.import_id, (.content | ltrimstr("\\x"))] | @tsv' > "$work/files"
while IFS=$'\t' read -r id content; do
  name=$(awk -F '\t' -v i="$id" '$1 == "import" { print $2 }' "$work/before" | jq -r --arg i "$id" 'select(.id == $i) | .file_name')
  exported=$(unzip -p "$work/export.zip" "import-files/$id/$name" | od -An -tx1 -v | tr -d ' \n')
  [ "$exported" = "$content" ] || fail "the export's file of import $id is not the one imported."
done < "$work/files"
say "Camille's export holds her rows of every table and her $(wc -l < "$work/files") files as $from held them."

# 11. The statement the release imported, imported again (#132): every line is found under the key
# the update gave it, and nothing is added twice.
if [ -n "$first_import" ]; then
  second_import=$(upload camille-after "$statement")
  [ -n "$second_import" ] || fail "$tag has no import route."
  ended=$(settled "$second_import")
  [ "$ended" = "done 0 15" ] ||
    fail "$(basename "$statement") imported again after the update: $ended, not \"done 0 15\" (nothing added, 15 found)."
  say "$(basename "$statement"), imported again on $tag, adds nothing: its 15 lines are found."
fi

# 11b. A merchant's look (#204), which no release up to 0.4.0 had: Camille gives one of her
# merchants a logo through the app's own route, and a colour as the tables' owner (no plain HTTP
# route sets it: a server function does); both survive migrate run again, the app serves the logo
# byte for byte, and her export carries both.
look_merchant=$(sql "select id from merchant where user_id = '$camille' order by id limit 1")
[ -n "$look_merchant" ] || fail "Camille has no merchant to give a look to."
printf '\x89PNG\r\n\x1a\n\0\0\0\r' > "$work/logo.png"
logo_answer=$(curl --silent --show-error --max-time 20 --cookie "$work/camille-after" \
  --cookie-jar "$work/camille-after" --header "Origin: $origin" \
  --header 'Content-Type: application/octet-stream' --data-binary "@$work/logo.png" \
  --write-out '\n%{http_code}' "$base/api/merchants/$look_merchant/logo") ||
  fail "the upload of Camille's logo did not answer."
[ "${logo_answer##*$'\n'}" = 200 ] ||
  fail "the upload of Camille's logo answered ${logo_answer##*$'\n'}: ${logo_answer%$'\n'*}"
logo_version=$(printf '%s\n' "${logo_answer%$'\n'*}" | jq -r .version)
sql "update merchant set color = 'teal' where id = '$look_merchant'" > /dev/null
migrate "$work/migrate-3"
[ "$(sql "select coalesce(color, '') from merchant where id = '$look_merchant'")" = teal ] ||
  fail "Camille's merchant lost its colour when migrate ran again."
[ "$(sql "select left(sha256, 16) from merchant_logo where merchant_id = '$look_merchant'")" = "$logo_version" ] ||
  fail "Camille's merchant lost its logo when migrate ran again."
logo_bytes=$(od -An -tx1 -v "$work/logo.png" | tr -d ' \n')
served=$(curl --silent --show-error --fail --max-time 20 --cookie "$work/camille-after" \
  "$base/api/merchants/$look_merchant/logo?v=$logo_version" | od -An -tx1 -v | tr -d ' \n') ||
  fail "Camille's logo is not served."
[ "$served" = "$logo_bytes" ] || fail "Camille's logo is not served as she uploaded it."
curl --silent --show-error --fail --max-time 30 --cookie "$work/camille-after" \
  --output "$work/export-look.zip" "$base/api/export" || fail "Camille's export failed."
exported_logo=$(unzip -p "$work/export-look.zip" "merchant-logos/$look_merchant.png" | od -An -tx1 -v | tr -d ' \n')
[ "$exported_logo" = "$logo_bytes" ] || fail "Camille's export does not carry her merchant's logo."
[ "$(unzip -p "$work/export-look.zip" merchants.json | jq -r --arg id "$look_merchant" '.[] | select(.id == $id) | .color')" = teal ] ||
  fail "Camille's export does not carry her merchant's colour."
say "Camille's merchant keeps its colour and logo when migrate runs again, and her export carries them."

# 12. The upgraded schema is a fresh installation's.
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
