#!/bin/sh
# The image's entry point (Dockerfile): `serve` (the default) starts the app, `migrate` applies the
# database migrations and exits, anything else runs as given.
#
# Each `<NAME>_FILE` variable names a file whose content becomes `<NAME>` (Compose secrets,
# docker-compose.yml), so that a secret is never written in the container's declared environment.
set -eu

for name in $(env | sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)_FILE=.*$/\1/p'); do
  file=$(printenv "${name}_FILE")
  if printenv "$name" > /dev/null; then
    echo "gousset: both $name and ${name}_FILE are set; keep one." >&2
    exit 1
  fi
  if [ ! -r "$file" ]; then
    echo "gousset: ${name}_FILE names $file, which cannot be read." >&2
    exit 1
  fi
  # The command substitution drops the file's final newlines, as a secret file often has one.
  value=$(cat "$file")
  export "$name=$value"
  unset "${name}_FILE"
done

case "${1:-serve}" in
  serve) exec node /app/server/index.mjs ;;
  migrate) exec node /app/db/migrate.mjs ;;
  *) exec "$@" ;;
esac
