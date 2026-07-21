#!/usr/bin/env bash
#
# scripts/local-env.sh
#
# Resolve the per-checkout local dev environment: which app port and
# which Postgres container/port this working directory uses. This is
# the single place the local DATABASE_URL is constructed — the
# package.json scripts wrap their commands in this instead of inlining
# the URL.
#
# Defaults (no .env.worktree present): app on 3000, Postgres container
# `sailscoring-pg` on 5432 — identical to the values that used to be
# hardcoded everywhere, so the primary checkout and CI need no
# configuration.
#
# A secondary git worktree opts into its own container and port with an
# untracked `.env.worktree` at the repo root (Next.js does not auto-load
# files named this way, so it can't leak into the app's env handling):
#
#   SS_APP_PORT=3001
#   SS_PG_PORT=5433
#
# Two modes:
#   - Executed with a command (`./scripts/local-env.sh [--local-db]
#     cmd args…`): exports PORT for Next.js and execs the command.
#     `--local-db` additionally forces DATABASE_URL to the local
#     container URL — deliberately *overriding* any inherited value, so
#     a stray DATABASE_URL in the shell (e.g. pointed at Neon) can
#     never leak into a `*:test` script.
#   - Sourced (db-up.sh, start-test.sh): only exports the SS_* and PG*
#     values; the caller decides what to do with them. Shell options
#     are left untouched in this mode.
#
# See docs/local-dev-scripts.md for the full picture.

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -euo pipefail
fi

_ss_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SS_APP_PORT=3000
SS_PG_PORT=5432

if [ -f "${_ss_root}/.env.worktree" ]; then
  set -a
  # shellcheck disable=SC1091
  source "${_ss_root}/.env.worktree"
  set +a
fi

if [ "$SS_PG_PORT" = "5432" ]; then
  SS_PG_CONTAINER="${SS_PG_CONTAINER:-sailscoring-pg}"
else
  SS_PG_CONTAINER="${SS_PG_CONTAINER:-sailscoring-pg-${SS_PG_PORT}}"
fi
SS_PG_URL="postgres://sailscoring:sailscoring@localhost:${SS_PG_PORT}/sailscoring"

export SS_APP_PORT SS_PG_PORT SS_PG_CONTAINER SS_PG_URL

# psql connects through these (`pnpm db:psql:test` passes no URL
# argument, so one-shot `-c "…"` invocations keep working).
export PGHOST=localhost PGPORT="$SS_PG_PORT" PGUSER=sailscoring \
  PGPASSWORD=sailscoring PGDATABASE=sailscoring

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  if [ "${1:-}" = "--local-db" ]; then
    shift
    export DATABASE_URL="$SS_PG_URL"
  fi
  export PORT="$SS_APP_PORT"
  exec "$@"
fi
