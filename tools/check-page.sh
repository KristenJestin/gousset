#!/usr/bin/env bash
# The page of a fresh installation, as tools/check-image.sh leaves it: no session and no
# administrator yet, so `/` sends the visitor to /setup, and /setup is Gousset's page. Exits 1
# saying what differs.
#   tools/check-page.sh <the app's address>   e.g. http://127.0.0.1:3901
set -euo pipefail

base=${1:?check-page.sh: give the address of the app, as http://127.0.0.1:3901}

fail() {
  echo "check-page.sh: $1" >&2
  exit 1
}

# The status and where it leads (curl resolves a relative Location against the request).
answer=$(curl --silent --show-error --max-time 10 --output /dev/null \
  --write-out '%{http_code} %{redirect_url}' "$base/") ||
  fail "/ did not answer."
code=${answer%% *}
target=${answer#* }
[[ $code == 30[12378] ]] ||
  fail "/ answered $code, not a redirect to /setup: a fresh installation sends a visitor there."

# Only the path counts: the app may name its host as the request or its configuration does.
path=/${target#*://*/}
[[ $target == *://*/* && $path == /setup ]] ||
  fail "/ redirects to '$target', not to /setup: a fresh installation has no administrator yet."

page=$(curl --silent --show-error --max-time 10 --write-out '\n%{http_code}' "$base/setup") ||
  fail "/setup did not answer."
code=${page##*$'\n'}
[ "$code" = 200 ] || fail "/setup answered $code, not 200."
[[ $page == *"<title>Gousset</title>"* ]] || fail "/setup is not Gousset's page: no <title>Gousset</title>."

echo "check-page.sh: / redirects to /setup, which answers 200 with Gousset's page."
