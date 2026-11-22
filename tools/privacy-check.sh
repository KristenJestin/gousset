#!/usr/bin/env bash
# Refuses what is personal before it reaches this public repository (AGENTS.md, "Security and
# privacy"): an e-mail address outside example.com and example.org, an IBAN that is not one of the
# invented ones (packages/fixture/src/ibans.ts), an absolute home path, and any word of a private
# list kept outside the repository, in the file GOUSSET_PRIVATE_WORDS names (one word or phrase a
# line, `#` starts a comment). Its messages say what matched and where, never a word of that list.
#   tools/privacy-check.sh --staged              what the staged change adds: its lines, its file
#                                                names, the commit's identities (pre-commit hook)
#   tools/privacy-check.sh --message <file>      a commit message, without Git's comment lines and
#                                                what follows its scissors line (commit-msg hook)
#   tools/privacy-check.sh --range <base> <head> each commit of base..head: the lines and file names
#                                                it adds (a merge's are in the range's), its
#                                                message, author and committer; and what the
#                                                whole range adds (CI)
#   tools/privacy-check.sh [--base <ref>] <file>...
#                                                text files, every line: a pull request's title and
#                                                description
# The invented IBANs are read as the base has them (HEAD by default, <base> for --range), never
# from the change being checked. Any error of git or of a read stops the check with exit code 2:
# a check that could not run never passes.
set -euo pipefail

IBANS_FILE="packages/fixture/src/ibans.ts"

fail() { # <message>: the check could not run
  echo "privacy check: $1" >&2
  exit 2
}

PRIVATE_WORDS=()
if [ -n "${GOUSSET_PRIVATE_WORDS:-}" ]; then
  [ -r "$GOUSSET_PRIVATE_WORDS" ] || fail "GOUSSET_PRIVATE_WORDS names a file that cannot be read"
  while IFS= read -r word || [ -n "$word" ]; do
    word="${word%$'\r'}"
    word="${word%%#*}"
    word="${word#"${word%%[![:space:]]*}"}"
    word="${word%"${word##*[![:space:]]}"}"
    if [ -n "$word" ]; then PRIVATE_WORDS+=("${word,,}"); fi
  done < "$GOUSSET_PRIVATE_WORDS"
else
  echo "note: GOUSSET_PRIVATE_WORDS is not set, so the private words are not checked" >&2
fi

# The invented IBANs of <ref>, as one string with a space around each, for a substring test. A ref
# that does not exist is an error. A base without the list at all (before the change that adds
# it) takes the change's own, <fallback>: the one time there is no base list to read.
ALLOWED_IBANS=" "
read_allowed_ibans() { # <ref> [<fallback>]
  local ref=$1 text
  git rev-parse --verify --quiet "$ref^{commit}" > /dev/null || fail "no commit $ref to read $IBANS_FILE from"
  if ! git cat-file -e "$ref:$IBANS_FILE" 2> /dev/null; then
    if [ -n "${2:-}" ]; then
      echo "note: $ref has no $IBANS_FILE yet, so the change's own list is read" >&2
      read_allowed_ibans "$2"
    else
      echo "note: $ref has no $IBANS_FILE, so no IBAN is allowed" >&2
    fi
    return 0
  fi
  text=$(git show "$ref:$IBANS_FILE") || fail "cannot read $IBANS_FILE at $ref"
  # The list is the base's: an IBAN the change adds to it is allowed elsewhere only once merged,
  # after a person has read it. The list's own lines are not checked for IBANs.
  ALLOWED_IBANS=" $(grep -oE '[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}' <<< "$text" | paste -sd' ' || true) "
}

EMAIL='[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}'
# Two letters, two check digits, then 11 to 30 letters or digits, maybe grouped by spaces.
IBAN='(^|[^A-Za-z0-9])([A-Z]{2}[0-9]{2}( ?[A-Z0-9]){11,30})([^A-Za-z0-9]|$)'
# A user's folder: under home (Linux, Fedora Atomic's /var/home), Users (macOS), C:\Users
# (Windows, its backslashes maybe escaped, or WSL's /mnt/c/Users); not a URL's page of that name.
NAME='[A-Za-z0-9._-]+'
HOME_PATH="(^|[^A-Za-z0-9_.~-])((/var)?/home/$NAME|(/mnt/[a-z])?/Users/$NAME|[A-Za-z]:(\\\\\\\\|\\\\|/)Users(\\\\\\\\|\\\\|/)$NAME)"
# GitHub's own addresses, which keep a person's e-mail private: allowed for a commit's identities.
GITHUB_NOREPLY='(^|<)([A-Za-z0-9._+-]+@users\.noreply\.github\.com|noreply@github\.com)>?$'

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

check_ibans() { # <where> <text>
  local where=$1 rest=$2 match prefix n joined consumed
  local -a groups
  while [[ $rest =~ $IBAN ]]; do
    match=${BASH_REMATCH[2]}
    prefix=${rest%%"$match"*}
    read -ra groups <<< "$match"
    # Grouped by spaces, a candidate may run on into the next words: its last groups are dropped
    # one by one until the checksum holds.
    n=${#groups[@]}
    consumed=""
    while [ "$n" -ge 1 ]; do
      joined=$(printf '%s' "${groups[@]:0:n}")
      [ "${#joined}" -ge 15 ] || break
      if iban_valid "$joined"; then
        if [[ $ALLOWED_IBANS != *" $joined "* ]]; then
          refuse "$where" "IBAN $joined: only the invented ones of $IBANS_FILE are allowed"
        fi
        consumed="${groups[*]:0:n}"
        break
      fi
      n=$((n - 1))
    done
    # No IBAN starts at its first group: the next one may start at its second.
    [ -n "$consumed" ] || consumed=${groups[0]}
    rest=${rest:$((${#prefix} + ${#consumed}))}
  done
}

check_line() { # <where> <text>
  local where=$1 text=$2 rest match domain lower word

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

  # The list of invented IBANs itself: a person reads what it adds (see read_allowed_ibans).
  if [[ $where != *"$IBANS_FILE:"* ]]; then check_ibans "$where" "$text"; fi

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

# A commit's identity, "Name <e-mail>": GitHub's no-reply addresses pass, the rest is a line.
check_identity() { # <where> <identity>
  if [[ $2 =~ $GITHUB_NOREPLY ]]; then
    check_line "$1" "${2%<*}"
  else
    check_line "$1" "$2"
  fi
}

# Reads "<where>\t<text>" lines. The same text is checked once: a line the range adds is also
# added by one of its commits.
declare -A SEEN=()
check_lines() { # < lines
  local where text
  while IFS=$'\t' read -r where text; do
    [ -z "${SEEN["x$text"]+set}" ] || continue
    SEEN["x$text"]=1
    check_line "$where" "$text"
  done
}

# The lines a diff on stdin adds, as "<label><path>:<line>\t<text>".
added_lines() { # <label>
  awk -v label="$1" '
    /^diff --git / { header = 1; next }
    header && /^\+\+\+ / { path = substr($0, 7); next }
    /^@@/ { header = 0; match($0, /\+[0-9]+/); line = substr($0, RSTART + 1, RLENGTH - 1); next }
    !header && /^\+/ { print label path ":" line "\t" substr($0, 2); line++ }
  '
}

# A text on stdin, as "<where>:<line>\t<text>".
numbered() { # <where>
  awk -v where="$1" '{ sub(/\r$/, ""); print where ":" NR "\t" $0 }'
}

DIFF=(git -c core.quotePath=false diff --no-color --no-ext-diff --no-renames -U0)

check_diff() { # <label> <git diff arguments>...
  local label=$1 out names
  shift
  out=$("${DIFF[@]}" "$@" | added_lines "$label") || fail "git diff $* failed"
  names=$(git -c core.quotePath=false diff --name-only --no-renames --diff-filter=d "$@") || fail "git diff $* failed"
  check_lines <<< "$out"
  if grep -qxF "$IBANS_FILE" <<< "$names"; then
    echo "note: ${label}changes $IBANS_FILE: a person checks that each IBAN it adds is invented" >&2
  fi
  while IFS= read -r name; do
    if [ -n "$name" ]; then check_line "${label}file name $name" "$name"; fi
  done <<< "$names"
}

check_commit() { # <sha>
  local sha=$1 label="commit ${1:0:8}" parent out message identities
  if git rev-parse --verify --quiet "$sha^2" > /dev/null; then
    # A merge brings commits checked on their own; what its resolution adds is in the range's diff.
    :
  elif parent=$(git rev-parse --verify --quiet "$sha^"); then
    check_diff "$label " "$parent" "$sha"
  else
    # A root commit: what it adds is the whole of it.
    check_diff "$label " "$(git hash-object -t tree /dev/null)" "$sha"
  fi
  message=$(git log -1 --format=%B "$sha") || fail "cannot read the message of $sha"
  out=$(numbered "$label message" <<< "$message")
  check_lines <<< "$out"
  identities=$(git log -1 --format='%an <%ae>%n%cn <%ce>' "$sha") || fail "cannot read the identities of $sha"
  check_identity "$label author" "$(sed -n 1p <<< "$identities")"
  check_identity "$label committer" "$(sed -n 2p <<< "$identities")"
}

check_file() { # <file> <strip Git's comments: yes|no>
  local file=$1 text out
  [ -f "$file" ] && [ -r "$file" ] || fail "cannot read $file"
  text=$(cat -- "$file") || fail "cannot read $file"
  if [ "$2" = yes ]; then
    # What Git strips from a message: what follows the scissors line, then the comment lines.
    text=$(awk '/^# -+ >8 -+$/ { exit } !/^#/' <<< "$text")
  fi
  out=$(numbered "${file##*/}" <<< "$text")
  check_lines <<< "$out"
}

case "${1:-}" in
  --staged)
    [ $# -eq 1 ] || fail "usage: $0 --staged"
    if git rev-parse --verify --quiet HEAD > /dev/null; then read_allowed_ibans HEAD; fi
    check_diff "" --cached
    identity=$(git var GIT_AUTHOR_IDENT) || fail "git var GIT_AUTHOR_IDENT failed"
    check_identity "author" "${identity% [0-9]* [-+][0-9]*}"
    identity=$(git var GIT_COMMITTER_IDENT) || fail "git var GIT_COMMITTER_IDENT failed"
    check_identity "committer" "${identity% [0-9]* [-+][0-9]*}"
    ;;
  --message)
    [ $# -eq 2 ] || fail "usage: $0 --message <file>"
    if git rev-parse --verify --quiet HEAD > /dev/null; then read_allowed_ibans HEAD; fi
    check_file "$2" yes
    ;;
  --range)
    [ $# -eq 3 ] || fail "usage: $0 --range <base> <head>"
    read_allowed_ibans "$2" "$3"
    check_diff "" "$2...$3"
    commits=$(git rev-list "$2..$3") || fail "git rev-list $2..$3 failed"
    while IFS= read -r sha; do
      if [ -n "$sha" ]; then check_commit "$sha"; fi
    done <<< "$commits"
    ;;
  *)
    base=HEAD
    if [ "${1:-}" = --base ]; then
      [ $# -ge 2 ] || fail "usage: $0 [--base <ref>] <file>..."
      base=$2
      shift 2
    fi
    [ $# -ge 1 ] && [[ $1 != -* ]] || fail "usage: $0 --staged | --message <file> | --range <base> <head> | [--base <ref>] <file>..."
    read_allowed_ibans "$base" HEAD
    for file in "$@"; do
      check_file "$file" no
    done
    ;;
esac

exit $found
