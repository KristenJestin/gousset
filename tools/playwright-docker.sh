#!/usr/bin/env bash
# Runs packages/ui's browser checks in the official Playwright image, the one CI's `ui-shard` jobs
# run in, so that screenshots render alike here and there. The image's version is the installed
# @playwright/test's. Arguments go to `playwright test`; to refresh the reference screenshots:
#
#   tools/playwright-docker.sh --update-snapshots=all
#
# The lint project needs pnpm, which the image lacks, and draws nothing: it runs with `pnpm test:ui`.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
version=$(node -p "require('$root/packages/ui/node_modules/@playwright/test/package.json').version")

exec docker run --rm --ipc=host \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e PATH="/work/packages/ui/node_modules/.bin:/work/node_modules/.bin:/usr/local/bin:/usr/bin:/bin" \
  -v "$root:/work" \
  -w /work/packages/ui \
  "mcr.microsoft.com/playwright:v$version-noble" \
  playwright test --project chromium --project firefox --project phone "$@"
