#!/usr/bin/env bash
# The version of a build, computed from the Angular commits since the last release, never typed
# (docs/releases.md, "The version"):
#   tools/version.sh stable [--at <rev>]  X.Y.Z, the release of that commit
#   tools/version.sh beta [--at <rev>]    X.Y.Z-beta.N, the beta of that commit of dev
# Both exit 3, printing nothing, when the commit is a release itself (nothing since it).
#   tools/version.sh base [--at <rev>]    "<tag> <commit>" the versions count from; nothing
#                                         before the first release
# `--at` is the commit to compute for, HEAD by default. The last release is the highest tag
# `vX.Y.Z` in that commit's history, compared as versions. `feat` bumps the minor from 1.0 on and
# the patch before it, `fix` and `perf` the patch, `!` or a `BREAKING CHANGE:` footer the major (the
# minor before 1.0), and nothing that bumps is the next patch. A `Release-As: X.Y.Z` footer sets the
# next version when it is above the computed one; below it, or not X.Y.Z, it is ignored with a
# warning naming the commit, never fatal (commits of dev cannot be changed). N is the commit's
# place on its first-parent line, counted from the first commit: it never restarts, so no two
# commits of dev ever share a beta's name, whichever commit is released when.
set -euo pipefail

channel=${1:-}
case "$channel" in stable | beta | base) ;; *)
  echo "version.sh: the channel is stable, beta or base" >&2
  exit 2
  ;;
esac
shift
at=HEAD
while [ $# -gt 0 ]; do
  case "$1" in
    --at) at=${2:?version.sh: --at needs a commit} ;;
    *)
      echo "version.sh: unknown argument $1" >&2
      exit 2
      ;;
  esac
  shift 2
done
at=$(git rev-parse --verify "$at^{commit}")

# The highest release the commit holds, compared as versions; pre-release tags do not count.
base=$(git tag --merged "$at" --list 'v*' | grep -E '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' | sort -V | tail -n 1 || true)
since=
if [ -n "$base" ]; then since=$(git rev-parse --verify "$base^{commit}"); fi

if [ "$channel" = base ]; then
  if [ -n "$base" ]; then echo "$base $since"; fi
  exit 0
fi

range=$at
if [ -n "$since" ]; then range="$since..$at"; fi
count=$(git rev-list --count --first-parent "$range")
if [ "$count" -eq 0 ]; then
  echo "version.sh: $at is ${base:-the first commit} itself: nothing since it" >&2
  exit 3
fi
place=$(git rev-list --count --first-parent "$at")
IFS=. read -r major minor patch <<< "${base#v}"
major=${major:-0} minor=${minor:-0} patch=${patch:-0}

BREAKING='^[a-z]+(\([a-z0-9-]+\))?!: '
FOOTER=$'(^|\n)BREAKING[ -]CHANGE: '
FEATURE='^feat(\([a-z0-9-]+\))?: '
FIX='^(fix|perf)(\([a-z0-9-]+\))?: '
RELEASE_AS='^Release-As:[[:space:]]*(.*[^[:space:]])?[[:space:]]*$'
SEMVER='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'

# 3 a breaking change, 2 a feature, 1 a fix, 0 nothing that bumps.
bump=0
requested=() requested_by=()
while IFS= read -r -d '' record; do
  commit=${record%%$'\n'*}
  message=${record#*$'\n'}
  subject=${message%%$'\n'*}
  level=0
  if [[ $subject =~ $BREAKING ]] || [[ $message =~ $FOOTER ]]; then
    level=3
  elif [[ $subject =~ $FEATURE ]]; then
    level=2
  elif [[ $subject =~ $FIX ]]; then
    level=1
  fi
  if [ "$level" -gt "$bump" ]; then bump=$level; fi
  while IFS= read -r line; do
    if [[ $line =~ $RELEASE_AS ]]; then
      requested+=("${BASH_REMATCH[1]}")
      requested_by+=("$commit")
    fi
  done <<< "$message"
done < <(git log -z --first-parent --no-merges --format=%H%n%B "$range")

# Before 1.0, everything bumps one level less: a breaking change the minor, a feature the patch.
if [ "$major" -eq 0 ] && [ "$bump" -gt 0 ]; then bump=$((bump - 1)); fi
case "$bump" in
  3) major=$((major + 1)) minor=0 patch=0 ;;
  2) minor=$((minor + 1)) patch=0 ;;
  *) patch=$((patch + 1)) ;;
esac
next="$major.$minor.$patch"

# The highest of the valid requests at or above the computed version wins; the others are ignored,
# saying so: a commit of dev cannot be changed, and must not block every build after it.
computed=$next
for i in "${!requested[@]}"; do
  wanted=${requested[$i]}
  if ! [[ $wanted =~ $SEMVER ]]; then
    echo "version.sh: commit ${requested_by[$i]} says Release-As: '$wanted', which is not X.Y.Z: ignored" >&2
  elif [ "$(printf '%s\n%s\n' "$wanted" "$computed" | sort -V | head -n 1)" != "$computed" ]; then
    echo "version.sh: commit ${requested_by[$i]} says Release-As: $wanted, below the computed $computed: ignored" >&2
  elif [ "$(printf '%s\n%s\n' "$wanted" "$next" | sort -V | tail -n 1)" = "$wanted" ]; then
    next=$wanted
  fi
done

case "$channel" in
  stable) echo "$next" ;;
  beta) echo "$next-beta.$place" ;;
esac
