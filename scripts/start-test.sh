#!/usr/bin/env bash
#
# scripts/start-test.sh
#
# Build and start the Next.js app with the test environment baked in.
# Used by Playwright's `webServer.command` (see playwright.config.ts).
# Not normally run by hand — invoke via `pnpm start:test`.
#
# Why this exists:
#   - Playwright's webServer subprocess inherits Next.js's standard
#     env-file loading, which reads .env.local — the developer's
#     personal config, typically pointed at Neon prod. Tests need
#     deterministic, local values instead.
#   - .env.test holds the committed test config (BETTER_AUTH_SECRET,
#     BETTER_AUTH_URL, NEXT_PUBLIC_APP_URL). Sourcing it here puts
#     those values in the environment for both `next build` (which
#     bakes NEXT_PUBLIC_* into the bundle) and `next start`.
#   - DATABASE_URL is *not* in .env.test — there's no useful default
#     to commit (the local URL only works on a host running db-up.sh,
#     not in CI which uses a service container). Instead we default
#     it here to the same URL db-up.sh exposes, while letting any
#     caller-provided value win.
#
# See docs/local-dev-scripts.md for the full picture.

set -euo pipefail

# Source .env.test into the environment. `set -a` exports every
# variable defined while it is on; `set +a` reverts to normal scoping.
if [ -f .env.test ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.test
  set +a
fi

# Resolve this checkout's app port and local Postgres URL. A secondary
# git worktree overrides both via .env.worktree; the primary checkout
# gets the historical defaults (3000, 5432).
# shellcheck disable=SC1091
source "$(dirname "$0")/local-env.sh"

# Default DATABASE_URL to db-up.sh's local Postgres. A caller-provided
# value (e.g. CI, or someone running against a different DB) wins
# because ${VAR:-default} only substitutes when VAR is unset or empty.
export DATABASE_URL="${DATABASE_URL:-$SS_PG_URL}"

# On a non-default app port, the URLs sourced from .env.test must be
# re-derived — Better Auth validates redirects against BETTER_AUTH_URL,
# and NEXT_PUBLIC_APP_URL is baked into the bundle by `pnpm build`
# below, so both have to match the origin the server actually serves.
if [ "$SS_APP_PORT" != "3000" ]; then
  export BETTER_AUTH_URL="http://localhost:${SS_APP_PORT}"
  export NEXT_PUBLIC_APP_URL="http://localhost:${SS_APP_PORT}"
fi

# `next start` listens on PORT.
export PORT="$SS_APP_PORT"

# Build with the test env in scope (NEXT_PUBLIC_* values are baked in
# at build time), then start. `exec` replaces this shell with `next
# start` so signals reach Next.js directly — important for Playwright,
# which sends SIGTERM when the test run ends.
#
# --keepAliveTimeout: Node's 5s default closes idle keep-alive sockets
# right in the window where a loaded Playwright worker reuses one — the
# reuse races the close and surfaces as ECONNRESET on API calls or
# ERR_ABORTED on navigations. 70s puts the close far beyond any gap
# between requests within a test.
pnpm build
exec pnpm start --keepAliveTimeout 70000
