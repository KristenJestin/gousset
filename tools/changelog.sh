#!/usr/bin/env bash
# The notes of a release (docs/releases.md, "The notes"): the pull requests merged since the last
# release (tools/version.sh base) up to `--at` (HEAD by default), or in the range given, oldest
# first.
#
# They say what the user can do now, in the user's words: the `Note: <sentence>` line of the
# description of each feat, fix and perf pull request (read through GitHub's API with `gh`), the
# features under "What's new", the fixes under "Fixed", each with the number of its pull request.
# A pull request without a note is left out, as is one whose author is not a maintainer; one that
# cannot be read fails the script. Then, under "All changes", the subjects, grouped by type.
#   tools/changelog.sh [--at <rev> | <range>]
set -euo pipefail

range=${1:-}
if [ -z "$range" ] || [ "$range" = --at ]; then
  at=HEAD
  if [ "$range" = --at ]; then at=${2:?changelog.sh: --at needs a commit}; fi
  read -r _ since <<< "$("$(dirname "$0")/version.sh" base --at "$at")" || true
  range=$at
  if [ -n "${since:-}" ]; then range="$since..$at"; fi
fi

ANGULAR='^([a-z]+)(\(([a-z0-9-]+)\))?(!)?: (.*)$'
FOOTER=$'(^|\n)BREAKING[ -]CHANGE: '

# The `Note:` line of a pull request's description, nothing when it has none. The description is
# read after the merge and can have been edited since: only a maintainer's note (the author is the
# OWNER, a MEMBER or a COLLABORATOR) goes into the notes of a release. A pull request that cannot
# be read stops the script: a release published without its notes cannot be mended.
note_of() { # <number>
  local answer body line
  if ! answer=$(gh api "repos/{owner}/{repo}/pulls/$1" --jq '.author_association + "\n" + (.body // "")'); then
    echo "changelog.sh: #$1 could not be read from the API." >&2
    return 1
  fi
  case ${answer%%$'\n'*} in
    OWNER | MEMBER | COLLABORATOR) ;;
    *) return 0 ;;
  esac
  body=${answer#*$'\n'}
  body=${body//$'\r'/}
  while IFS= read -r line; do
    if [[ $line == "Note: "* ]]; then
      line=${line#Note: }
      line=${line%"${line##*[![:space:]]}"}
      printf '%s' "$line"
      return 0
    fi
  done <<< "$body"
}

new='' fixed='' breaking='' features='' fixes='' performance='' other=''
while IFS= read -r -d '' message; do
  subject=${message%%$'\n'*}
  [[ $subject =~ $ANGULAR ]] || continue
  type=${BASH_REMATCH[1]} scope=${BASH_REMATCH[3]} bang=${BASH_REMATCH[4]} text=${BASH_REMATCH[5]}
  line="- $text"
  if [ -n "$scope" ]; then line="- **$scope**: $text"; fi
  if [ -n "$bang" ] || [[ $message =~ $FOOTER ]]; then breaking+="$line"$'\n'; fi
  case "$type" in
    feat | fix | perf)
      # A squash into dev ends its subject with its pull request's number.
      if [[ $text =~ \(#([0-9]+)\)$ ]]; then
        number=${BASH_REMATCH[1]}
        note=$(note_of "$number") || exit 1
        if [ -n "$note" ]; then
          if [ "$type" = fix ]; then
            fixed+="- $note (#$number)"$'\n'
          else
            new+="- $note (#$number)"$'\n'
          fi
        fi
      fi
      ;;
  esac
  case "$type" in
    feat) features+="$line"$'\n' ;;
    fix) fixes+="$line"$'\n' ;;
    perf) performance+="$line"$'\n' ;;
    *) other+="$line"$'\n' ;;
  esac
done < <(git log -z --first-parent --no-merges --reverse --format=%B "$range")

first=1
section() { # <heading> <title> <lines>
  [ -n "$3" ] || return 0
  if [ "$first" -eq 0 ]; then echo; fi
  first=0
  printf '%s %s\n\n%s' "$1" "$2" "$3"
}
section "###" "What's new" "$new"
section "###" "Fixed" "$fixed"
# The raw list: its heading is not a section of its own, its groups are.
if [ -n "$breaking$features$fixes$performance$other" ]; then
  if [ "$first" -eq 0 ]; then echo; fi
  printf '### All changes\n\n'
  first=1
  section "####" "Breaking changes" "$breaking"
  section "####" "Features" "$features"
  section "####" "Fixes" "$fixes"
  section "####" "Performance" "$performance"
  section "####" "Other changes" "$other"
fi
