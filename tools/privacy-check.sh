#!/usr/bin/env bash
# Refuses what is personal before it reaches this public repository (AGENTS.md, "Security and
# privacy"): an e-mail address outside example.com and example.org, an IBAN that is not one of the
# invented ones (packages/fixture/src/ibans.ts), an absolute home path, and any word of a private
# list kept outside the repository, in the file GOUSSET_PRIVATE_WORDS names (one word or phrase a
# line, `#` starts a comment). Its messages say what matched and where, never a word of that list.
#   tools/privacy-check.sh --staged              the lines the staged diff adds (pre-commit hook)
#   tools/privacy-check.sh --range <base> <head> the lines added since base, and the messages of
#                                                the commits of base..head (CI)
#   tools/privacy-check.sh <file>...             text files: a commit message, a pull request's
#                                                title and description
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IBANS_FILE="packages/fixture/src/ibans.ts"

# The invented IBANs, as one string with a space around each, for a plain substring test.
ALLOWED_IBANS=" $(grep -oE '[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}' "$ROOT/$IBANS_FILE" | paste -sd' ') "

PRIVATE_WORDS=()
if [ -n "${GOUSSET_PRIVATE_WORDS:-}" ]; then
  if ! [ -r "$GOUSSET_PRIVATE_WORDS" ]; then
    echo "GOUSSET_PRIVATE_WORDS names a file that cannot be read" >&2
    exit 2
  fi
  while IFS= read -r word || [ -n "$word" ]; do
    word="${word%%#*}"
    word="${word#"${word%%[![:space:]]*}"}"
    word="${word%"${word##*[![:space:]]}"}"
    if [ -n "$word" ]; then PRIVATE_WORDS+=("${word,,}"); fi
  done < "$GOUSSET_PRIVATE_WORDS"
else
  echo "note: GOUSSET_PRIVATE_WORDS is not set, so the private words are not checked" >&2
fi

EMAIL='[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}'
# Two letters, two check digits, then 11 to 30 letters or digits, maybe grouped by spaces.
IBAN='(^|[^A-Za-z0-9])([A-Z]{2}[0-9]{2}( ?[A-Z0-9]){11,30})([^A-Za-z0-9]|$)'
# A user's folder under home (Linux), Users (macOS) or C:\Users (Windows); not a URL's page of
# that name.
HOME_PATH='(^|[^A-Za-z0-9_.~/-])(/(home|Users)/[A-Za-z0-9._-]+|[A-Za-z]:\\Users\\[A-Za-z0-9._-]+)'

found=0

refuse() { # <where> <what>
  echo "$1: $2" >&2
  found=1
}

iban_valid() { # <IBAN without spaces>: its mod-97 checksum holds
  local iban=$1 moved rem=0 i c v
  [[ $iban =~ ^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$ ]] || return 1
  moved="${iban:4}${iban:0:4}"
  for ((i = 0; i < ${#moved}; i++)); do
    c=${moved:i:1}
    if [[ $c == [0-9] ]]; then
      rem=$(((rem * 10 + c) % 97))
    else
      printf -v v '%d' "'$c"
      rem=$(((rem * 100 + v - 55) % 97))
    fi
  done
  [ "$rem" -eq 1 ]
}

# The IBAN a candidate holds, if any: grouped by spaces, it may have run on into the next words,
# so its last groups are dropped one by one until the checksum holds.
iban_of() { # <candidate>
  local -a groups
  read -ra groups <<< "$1"
  local n=${#groups[@]} joined
  while [ "$n" -ge 1 ]; do
    joined=$(printf '%s' "${groups[@]:0:n}")
    if [ "${#joined}" -lt 15 ]; then return 1; fi
    if iban_valid "$joined"; then
      echo "$joined"
      return 0
    fi
    n=$((n - 1))
  done
  return 1
}

check_line() { # <where> <text>
  local where=$1 text=$2 rest match domain iban lower word

  rest=$text
  while [[ $rest =~ $EMAIL ]]; do
    match=${BASH_REMATCH[0]}
    domain=${match##*@}
    domain=${domain,,}
    case "$domain" in
      example.com | example.org | *.example.com | *.example.org) ;;
      *)
        # A package at its version (typescript@7.1.0-beta.next) is not an address.
        if ! [[ $domain =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]]; then
          refuse "$where" "e-mail address $match: only example.com and example.org are allowed"
        fi
        ;;
    esac
    rest=${rest#*"$match"}
  done

  rest=$text
  while [[ $rest =~ $IBAN ]]; do
    match=${BASH_REMATCH[2]}
    if iban=$(iban_of "$match") && [[ $ALLOWED_IBANS != *" $iban "* ]]; then
      refuse "$where" "IBAN $iban: only the invented ones of $IBANS_FILE are allowed"
    fi
    rest=${rest#*"$match"}
  done

  if [[ $text =~ $HOME_PATH ]]; then
    refuse "$where" "absolute home path ${BASH_REMATCH[2]}: write a path relative to the repository or ~"
  fi

  if [ "${#PRIVATE_WORDS[@]}" -gt 0 ]; then
    lower=${text,,}
    for word in "${PRIVATE_WORDS[@]}"; do
      if [[ $lower == *"$word"* ]]; then
        refuse "$where" "a word of the private list (GOUSSET_PRIVATE_WORDS)"
        break
      fi
    done
  fi
}

# Reads "<where>\t<text>" lines.
check_lines() {
  local where text
  while IFS=$'\t' read -r where text; do
    check_line "$where" "$text"
  done
}

# The lines a diff adds, as "<path>:<line>\t<text>".
added_lines() { # <git diff arguments>...
  git -c core.quotePath=false diff --no-color --no-ext-diff --no-renames -U0 "$@" | awk '
    /^diff --git / { header = 1; next }
    header && /^\+\+\+ / { path = substr($0, 7); next }
    /^@@/ { header = 0; match($0, /\+[0-9]+/); line = substr($0, RSTART + 1, RLENGTH - 1); next }
    !header && /^\+/ { print path ":" line "\t" substr($0, 2); line++ }
  '
}

# A text, as "<where>:<line>\t<text>".
numbered() { # <where>
  awk -v where="$1" '{ print where ":" NR "\t" $0 }'
}

case "${1:-}" in
  --staged)
    check_lines < <(added_lines --cached)
    ;;
  --range)
    [ $# -eq 3 ] || { echo "usage: $0 --range <base> <head>" >&2; exit 2; }
    check_lines < <(added_lines "$2...$3")
    while read -r sha; do
      check_lines < <(git log -1 --format=%B "$sha" | numbered "commit ${sha:0:8}")
    done < <(git rev-list "$2..$3")
    ;;
  "" | -*)
    echo "usage: $0 --staged | --range <base> <head> | <file>..." >&2
    exit 2
    ;;
  *)
    for file in "$@"; do
      check_lines < <(numbered "${file##*/}" < "$file")
    done
    ;;
esac

exit $found
