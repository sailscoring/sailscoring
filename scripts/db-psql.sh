#!/usr/bin/env bash
#
# scripts/db-psql.sh
#
# `pnpm db:psql:test` — a psql session against the local Postgres container.
#
# Prefers the host's psql, which gives readline, \e, and the local pager. A
# host without the client installed (the container is the only Postgres this
# checkout needs, so there is no reason for one) falls back to the psql inside
# the container, reached through podman.
#
# Arguments pass through either way, so `pnpm db:psql:test -c "select 1"`
# works on both. Connection settings come from local-env.sh, which has
# already exported the PG* variables by the time this runs.
#
# See docs/local-dev-scripts.md.

set -euo pipefail

# shellcheck disable=SC1091
source "$(dirname "$0")/local-env.sh"

if command -v psql >/dev/null 2>&1; then
  exec psql "$@"
fi

if ! command -v podman >/dev/null 2>&1; then
  echo "db:psql:test: no psql on this host and no podman to reach the container." >&2
  exit 1
fi

if ! podman container exists "$SS_PG_CONTAINER"; then
  echo "db:psql:test: container '$SS_PG_CONTAINER' is not there — run 'pnpm db:up' first." >&2
  exit 1
fi

# -i so a heredoc or piped script still reaches psql's stdin; -t only when
# this is a terminal, or podman refuses on a non-tty (CI, a captured run).
tty_flag=()
[ -t 0 ] && tty_flag=(-t)

exec podman exec -i "${tty_flag[@]}" \
  -e PGPASSWORD="$PGPASSWORD" \
  "$SS_PG_CONTAINER" \
  psql -U "$PGUSER" -d "$PGDATABASE" "$@"
