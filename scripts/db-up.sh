#!/usr/bin/env bash
#
# scripts/db-up.sh
#
# Bring up the local Postgres container used by `pnpm test:unit:db`,
# `pnpm test:e2e:server`, and `pnpm db:migrate`. Idempotent: safe to
# run repeatedly; verifies the existing container's port mapping and
# fails loudly if it has drifted from the expected value.
#
# Container name and port come from scripts/local-env.sh (defaults:
# `sailscoring-pg` on 5432; a secondary worktree overrides them via
# .env.worktree). The connection URL matches what local-env.sh exports
# as SS_PG_URL and what the `*:test` scripts force as DATABASE_URL.
#
# See docs/local-dev-scripts.md for the full picture.

set -euo pipefail

# shellcheck disable=SC1091
source "$(dirname "$0")/local-env.sh"

NAME="$SS_PG_CONTAINER"
PORT="$SS_PG_PORT"
IMAGE=docker.io/library/postgres:17

if podman container exists "$NAME"; then
  # Container exists — verify the port mapping matches PORT. If someone
  # previously created it with a different mapping (e.g. -p 5433:5432
  # because 5432 was busy), every script downstream that assumes 5432
  # would silently connect to the wrong place. Fail loudly instead.
  #
  # Read the *configured* binding rather than `podman port`, which reports
  # the live mapping and so prints nothing at all for a stopped container —
  # the normal state here, given this script exists to start one. Reading
  # the live mapping turned every ordinary "it isn't running" into a drift
  # report, whose stated remedy is to delete the database.
  MAPPED=$(podman inspect \
    --format '{{with index .HostConfig.PortBindings "5432/tcp"}}{{(index . 0).HostPort}}{{end}}' \
    "$NAME" 2>/dev/null)
  if [ "$MAPPED" != "$PORT" ]; then
    if [ -z "$MAPPED" ]; then
      echo "Container '$NAME' publishes no host port for 5432/tcp, expected '$PORT'." >&2
    else
      echo "Container '$NAME' maps host port '$MAPPED', expected '$PORT'." >&2
    fi
    echo "Recreate it with (this discards the local database):" >&2
    echo "  podman rm -f $NAME && $0" >&2
    exit 1
  fi
  podman start "$NAME" >/dev/null
else
  podman run -d --name "$NAME" -p "$PORT:5432" \
    -e POSTGRES_USER=sailscoring \
    -e POSTGRES_PASSWORD=sailscoring \
    -e POSTGRES_DB=sailscoring \
    "$IMAGE" >/dev/null
fi

# Wait until the server is actually ready to accept connections.
# pg_isready returns 0 once the server is listening; up to ~15s.
for _ in $(seq 1 30); do
  if podman exec "$NAME" pg_isready -U sailscoring >/dev/null 2>&1; then
    exit 0
  fi
  sleep 0.5
done

echo "Postgres in '$NAME' did not become ready within 15s." >&2
echo "Check logs with: podman logs $NAME" >&2
exit 1
