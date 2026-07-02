#!/bin/sh
# Generate the Basic Auth password file from environment variables before nginx
# starts. Runs automatically via the official nginx image entrypoint.
set -e

PANEL_USER="${PANEL_USER:-admin}"

if [ -z "${PANEL_PASSWORD:-}" ]; then
  PANEL_PASSWORD="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 16)"
  echo "[basic-auth] PANEL_PASSWORD not set — generated one for user '${PANEL_USER}': ${PANEL_PASSWORD}"
fi

htpasswd -bc /etc/nginx/.htpasswd "${PANEL_USER}" "${PANEL_PASSWORD}" >/dev/null 2>&1
echo "[basic-auth] Basic Auth enabled for user '${PANEL_USER}'"
