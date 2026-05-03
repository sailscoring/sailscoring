#!/usr/bin/env bash
#
# scripts/db-up.sh
#
# Bring up the local Postgres container used by `pnpm test:unit:db`,
# `pnpm test:e2e:server`, and `pnpm db:migrate`. Idempotent: safe to
# run repeatedly; verifies the existing container's port mapping and
# fails loudly if it has drifted from the expected value.
#
# Connection details (matches scripts/start-test.sh and
# tests/setup-env.ts defaults):
#   postgres://sailscoring:sailscoring@localhost:5432/sailscoring
#
# This script currently uses `podman-remote` because the canonical dev
# environment is a podman-managed dev container that talks to a
# rootless podman daemon on the host. Generalising to plain `podman`
# and `docker` is a future change.
#
# See docs/local-dev-scripts.md for the full picture.

set -euo pipefail

NAME=sailscoring-pg
PORT=5432
IMAGE=docker.io/library/postgres:17

if podman-remote container exists "$NAME"; then
  # Container exists — verify the port mapping matches PORT. If someone
  # previously created it with a different mapping (e.g. -p 5433:5432
  # because 5432 was busy), every script downstream that assumes 5432
  # would silently connect to the wrong place. Fail loudly instead.
  MAPPED=$(podman-remote port "$NAME" 5432/tcp 2>/dev/null | head -1 | awk -F: '{print $NF}')
  if [ "$MAPPED" != "$PORT" ]; then
    echo "Container '$NAME' maps host port '$MAPPED', expected '$PORT'." >&2
    echo "Recreate it with:" >&2
    echo "  podman-remote rm -f $NAME && $0" >&2
    exit 1
  fi
  podman-remote start "$NAME" >/dev/null
else
  podman-remote run -d --name "$NAME" -p "$PORT:5432" \
    -e POSTGRES_USER=sailscoring \
    -e POSTGRES_PASSWORD=sailscoring \
    -e POSTGRES_DB=sailscoring \
    "$IMAGE" >/dev/null
fi

# Wait until the server is actually ready to accept connections.
# pg_isready returns 0 once the server is listening; up to ~15s.
for _ in $(seq 1 30); do
  if podman-remote exec "$NAME" pg_isready -U sailscoring >/dev/null 2>&1; then
    exit 0
  fi
  sleep 0.5
done

echo "Postgres in '$NAME' did not become ready within 15s." >&2
echo "Check logs with: podman-remote logs $NAME" >&2
exit 1
