#!/usr/bin/env bash
# Checks a commit subject against AGENTS.md ("Git and pull requests"):
# `<type>(<scope>): <subject>`, the scope required, 72 characters at most, a lowercase start and
# no final period.
#   tools/commit-message.sh <file>           one commit message (the commit-msg hook)
#   tools/commit-message.sh --title <file>   a pull request's title, its squashed subject (CI)
#   tools/commit-message.sh --range <a..b>   every commit of a range (CI)
# Any error of git or of a read stops the check with exit code 2: a check that could not run
# never passes.
set -euo pipefail

fail() { # <message>: the check could not run
  echo "commit message check: $1" >&2
  exit 2
}

# The types and scopes are the ones AGENTS.md lists ("Types: `feat`, …" and "Scopes: `web`, …",
# which may wrap onto the next lines): one list, read where people read it, so that this check
# cannot drift from it.
AGENTS="$(dirname "${BASH_SOURCE[0]}")/../AGENTS.md"
[ -r "$AGENTS" ] || fail "cannot read AGENTS.md"

listed() { # <label>: the backquoted words after "<label>:" in AGENTS.md, as a|b|c
  { tr '\n' ' ' < "$AGENTS" | grep -oE "$1: (\`[a-z0-9-]+\`,? *)+" | awk 'NR == 1' | grep -oE '`[a-z0-9-]+`' | tr -d '`' | paste -sd'|'; } || true
}

TYPES=$(listed Types)
SCOPES=$(listed Scopes)
if [ -z "$TYPES" ] || [ -z "$SCOPES" ]; then
  fail "no types or scopes found in AGENTS.md (its \"Types:\" and \"Scopes:\" lists)"
fi

check() { # <subject> <where> <Git's own subjects pass: yes|no>
  local subject=$1 where=$2 type scope text length

  # Git writes these itself in a commit; a squash or a revert keeps the subject it was given. A
  # pull request's title is never one of them: it becomes a subject on dev.
  if [ "$3" = yes ]; then
    case "$subject" in Merge\ * | Revert\ * | fixup!* | squash!* | amend!*) return 0 ;; esac
  fi

  if ! [[ $subject =~ ^([a-z]+)\(([a-z0-9-]*)\)!?:\ (.+)$ ]]; then
    echo "$where: \"$subject\" is not <type>(<scope>): <subject>, the scope is required (example: \"feat(web): show the month's total\")" >&2
    return 1
  fi

  type=${BASH_REMATCH[1]}
  scope=${BASH_REMATCH[2]}
  text=${BASH_REMATCH[3]}

  if ! [[ "|$TYPES|" == *"|$type|"* ]]; then
    echo "$where: unknown type \"$type\" (types: ${TYPES//|/, })" >&2
    return 1
  fi

  if ! [[ "|$SCOPES|" == *"|$scope|"* ]]; then
    echo "$where: unknown scope \"$scope\" (scopes: ${SCOPES//|/, })" >&2
    return 1
  fi

  if [[ $text == [A-Z]* ]]; then
    echo "$where: the subject starts with a capital letter: \"$text\"" >&2
    return 1
  fi

  if [[ $text == *. ]]; then
    echo "$where: the subject ends with a period: \"$text\"" >&2
    return 1
  fi

  # GitHub adds " (#n)" to a squashed pull request's title: it does not count.
  length=${subject% (#[0-9]*)}
  length=${#length}
  if [ "$length" -gt 72 ]; then
    echo "$where: the subject is $length characters, 72 at most" >&2
    return 1
  fi
}

subject_of() { # <file>: its first line that is not a comment
  [ -f "$1" ] && [ -r "$1" ] || fail "cannot read $1"
  awk '!/^#/ { sub(/\r$/, ""); print; exit }' "$1" || fail "cannot read $1"
}

case "${1:-}" in
  --range)
    [ $# -eq 2 ] || fail "usage: $0 --range <a..b>"
    commits=$(git rev-list "$2") || fail "git rev-list $2 failed"
    status=0
    while IFS= read -r sha; do
      [ -n "$sha" ] || continue
      subject=$(git log -1 --format=%s "$sha") || fail "cannot read the subject of $sha"
      check "$subject" "${sha:0:8}" yes || status=1
    done <<< "$commits"
    exit $status
    ;;
  --title)
    [ $# -eq 2 ] || fail "usage: $0 --title <file>"
    subject=$(subject_of "$2")
    check "$subject" "title" no
    ;;
  "" | -*)
    fail "usage: $0 <file> | --title <file> | --range <a..b>"
    ;;
  *)
    [ $# -eq 1 ] || fail "usage: $0 <file> | --title <file> | --range <a..b>"
    subject=$(subject_of "$1")
    check "$subject" "${1##*/}" yes
    ;;
esac
