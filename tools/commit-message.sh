#!/usr/bin/env bash
# Checks a commit subject against AGENTS.md ("Git and pull requests"):
# `<type>(<scope>): <subject>`, the scope required, 72 characters at most, a lowercase start and
# no final period.
#   tools/commit-message.sh <file>           one message (the commit-msg hook, a pull request title)
#   tools/commit-message.sh --range <a..b>   every commit of a range (CI)
set -euo pipefail

# The types and scopes are the ones AGENTS.md lists ("Types: `feat`, …" and "Scopes: `web`, …",
# which may wrap onto the next lines): one list, read where people read it, so that this check
# cannot drift from it.
AGENTS="$(dirname "${BASH_SOURCE[0]}")/../AGENTS.md"

listed() { # <label>: the backquoted words after "<label>:" in AGENTS.md, as a|b|c
  tr '\n' ' ' < "$AGENTS" | grep -oE "$1: (\`[a-z0-9-]+\`,? *)+" | awk 'NR == 1' | grep -oE '`[a-z0-9-]+`' | tr -d '`' | paste -sd'|'
}

TYPES=$(listed Types)
SCOPES=$(listed Scopes)
if [ -z "$TYPES" ] || [ -z "$SCOPES" ]; then
  echo "no types or scopes found in AGENTS.md (its \"Types:\" and \"Scopes:\" lists)" >&2
  exit 2
fi

check() { # <subject> <where>
  local subject=$1 where=$2 type scope text length

  # Git writes these itself; a squash or a revert keeps the subject it was given.
  case "$subject" in Merge\ * | Revert\ * | fixup!* | squash!* | amend!*) return 0 ;; esac

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

if [ "${1:-}" = "--range" ]; then
  [ $# -eq 2 ] || { echo "usage: $0 --range <a..b>" >&2; exit 2; }
  status=0
  while read -r sha; do
    check "$(git log -1 --format=%s "$sha")" "${sha:0:8}" || status=1
  done < <(git rev-list "$2")
  exit $status
fi

[ $# -eq 1 ] || { echo "usage: $0 <file> | --range <a..b>" >&2; exit 2; }
check "$(awk '!/^#/ { print; exit }' "$1")" "${1##*/}"
