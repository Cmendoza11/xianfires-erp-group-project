#!/bin/sh
# Container start: wait for MySQL, create/upgrade the tables (safe to repeat), make the first
# administrator if the database has none, then start the server.
set -e

echo "[accounting] waiting for MySQL at ${DB_HOST}:${DB_PORT} ..."
tries=0
until node migrate.js --yes; do
  tries=$((tries + 1))
  if [ "$tries" -ge 30 ]; then
    echo "[accounting] MySQL did not answer after 30 tries; giving up." >&2
    exit 1
  fi
  sleep 3
done

if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
  # Fails harmlessly when that login already exists (for example after a restart).
  node user.js create --name "${ADMIN_NAME:-Administrator}" --email "$ADMIN_EMAIL" --password "$ADMIN_PASSWORD" \
    >/dev/null 2>&1 && echo "[accounting] first administrator created: $ADMIN_EMAIL" \
    || echo "[accounting] administrator $ADMIN_EMAIL already exists"
fi

echo "[accounting] starting on port ${PORT:-3000}"
exec node index.js
