#!/bin/sh
# The image's entry point (Dockerfile): `serve` (the default) starts the app, `migrate` applies the
# database migrations and exits, `recover-admin <e-mail>` gives the administrator a temporary
# password, anything else runs as given. Installed as `gousset`, so that a command run in the
# running container reads its secrets too: `docker compose exec web gousset recover-admin <e-mail>`.
#
# Each `<NAME>_FILE` variable names a file whose content becomes `<NAME>` (Compose secrets,
# docker-compose.yml), so that a secret is never written in the container's declared environment.
#
# DATABASE_PASSWORD, when set, goes into DATABASE_URL (which then holds none) percent-encoded: a
# password pasted raw into a URL breaks on `/`, `#`, `@` or `%`, and any character is safe here.
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

if [ -n "${DATABASE_PASSWORD:-}" ]; then
  # shellcheck disable=SC2016 # The quoted text is JavaScript, read by node: no shell expands it.
  DATABASE_URL=$(node -e '
    const { DATABASE_URL: given = "", DATABASE_PASSWORD: password = "" } = process.env;
    let url;
    try {
      url = new URL(given);
    } catch {
      console.error("gousset: DATABASE_PASSWORD is set, but DATABASE_URL is not a URL to put it in.");
      process.exit(1);
    }
    if (url.password) {
      console.error("gousset: both DATABASE_URL and DATABASE_PASSWORD give a password; keep one.");
      process.exit(1);
    }
    // encodeURIComponent, not the setter alone, which leaves `%` as it is: the driver decodes the
    // password with decodeURIComponent.
    url.password = encodeURIComponent(password);
    process.stdout.write(url.href);
  ')
  export DATABASE_URL
  unset DATABASE_PASSWORD
fi

case "${1:-serve}" in
  serve) exec node /app/server/index.mjs ;;
  migrate) exec node /app/db/migrate.mjs ;;
  recover-admin) shift && exec node /app/auth/recover-admin.mjs "$@" ;;
  *) exec "$@" ;;
esac
