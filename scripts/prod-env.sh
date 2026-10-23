#!/usr/bin/env bash
#
# scripts/prod-env.sh
#
# Run an operator script against production, with the production secrets
# fetched from Bitwarden for the duration of one run and never written to
# disk. The production counterpart of local-env.sh (which builds the
# local-container DATABASE_URL): the `*:prod` scripts in package.json wrap
# their commands in this.
#
# The secrets live in one Bitwarden item whose custom fields are named
# after the environment variables they hold; scripts/bw-fields.sh reads
# it, and describes the vault-session handling and the `.env.operator`
# file that names the item.
#
# Only the variables in ALLOWED_VARS are exported; any other field on the
# item — VERCEL_TOKEN, which vercel-env.sh reads, among them — is ignored.
# DATABASE_URL is required, the rest are optional.
#
# See docs/account-admin.md for the operator-side setup.

set -euo pipefail

BW_WRAPPER=prod-env
# shellcheck source=scripts/bw-fields.sh
source "$(dirname "${BASH_SOURCE[0]}")/bw-fields.sh"

ALLOWED_VARS=(DATABASE_URL BLOB_READ_WRITE_TOKEN NEXT_PUBLIC_APP_URL)

[ $# -gt 0 ] || _bw_die "usage: scripts/prod-env.sh <command> [args…]"

bw_export_fields "${ALLOWED_VARS[@]}"

[ -n "${DATABASE_URL:-}" ] || _bw_die "item ${BW_ITEM} has no DATABASE_URL field"

# Say where this is going before it goes there. Host only: the URL
# carries the password.
db_host="$(sed -E 's#^[a-z]+://([^@/]*@)?([^/:?]+).*#\2#' <<<"$DATABASE_URL")"
echo "prod-env: running against ${db_host}" >&2

"$@"
