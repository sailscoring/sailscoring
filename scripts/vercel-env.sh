#!/usr/bin/env bash
#
# scripts/vercel-env.sh
#
# Run a command with the Vercel CLI authenticated by a token fetched from
# Bitwarden for the duration of one run and never written to disk.
#
# The Vercel CLI is a route to production as direct as DATABASE_URL: it
# can pull the production environment, or deploy code that reads it. So
# the CLI is not left logged in (`vercel logout`; there is no token in
# its own credential store) and gets its token the way prod-env.sh gets
# the database URL — from the same Bitwarden item, field VERCEL_TOKEN,
# exported as the variable the CLI reads. scripts/bw-fields.sh describes
# the vault-session handling and the `.env.operator` file.
#
# Only VERCEL_TOKEN is exported; the item's database and blob secrets
# are not handed to anything run through here.
#
# `pnpm vercel …` runs the CLI itself through this; `pnpm deploy`,
# `pnpm deploy:prod` and `pnpm firewall:*` wrap their commands in it.
#
# See docs/account-admin.md for the operator-side setup.

set -euo pipefail

BW_WRAPPER=vercel-env
# shellcheck source=scripts/bw-fields.sh
source "$(dirname "${BASH_SOURCE[0]}")/bw-fields.sh"

[ $# -gt 0 ] || _bw_die "usage: scripts/vercel-env.sh <command> [args…]"

bw_export_fields VERCEL_TOKEN

[ -n "${VERCEL_TOKEN:-}" ] || _bw_die "item ${BW_ITEM} has no VERCEL_TOKEN field"

"$@"
