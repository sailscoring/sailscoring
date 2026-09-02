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
# after the environment variables they hold. Which item is named by
# BW_ITEM (an item id, as `bw list items --search …` reports it) in an
# untracked `.env.operator` at the repo root:
#
#   BW_ITEM=00000000-0000-0000-0000-000000000000
#
# Like `.env.worktree`, that is a file Next.js never loads, so it cannot
# leak into the app's env handling.
#
# Only the variables in ALLOWED_VARS are exported; any other field on the
# item is ignored. DATABASE_URL is required, the rest are optional.
#
# The vault session never leaves this process: the key from `bw unlock`
# is passed to the one `bw get item` call with --session and is not
# exported. If the calling shell already holds an unlocked BW_SESSION it
# is used and left alone; otherwise the vault is unlocked for this run
# and locked again when the command exits, whatever its outcome.
#
# `bw unlock` reads the master password from the terminal, so this must
# be run from an interactive shell. It refuses, rather than hangs, when
# there is no terminal, which is what keeps a production write from
# running unattended from an agent's shell: the agent prepares the
# command, the operator runs it.
#
# See docs/account-admin.md for the operator-side setup.

set -euo pipefail

_ss_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
operator_env="${_ss_root}/.env.operator"

ALLOWED_VARS=(DATABASE_URL BLOB_READ_WRITE_TOKEN NEXT_PUBLIC_APP_URL)

die() {
  echo "prod-env: $*" >&2
  exit 1
}

[ $# -gt 0 ] || die "usage: scripts/prod-env.sh <command> [args…]"
command -v bw >/dev/null 2>&1 || die "the Bitwarden CLI (bw) is not installed"
command -v jq >/dev/null 2>&1 || die "jq is not installed"
[ -f "$operator_env" ] || die "no .env.operator at the repo root; it should set BW_ITEM=<bitwarden item id> (see docs/account-admin.md)"

BW_ITEM=""
# shellcheck disable=SC1090
source "$operator_env"
[ -n "$BW_ITEM" ] || die ".env.operator does not set BW_ITEM"

# Resolve a vault session. A valid inherited one is used as-is and left
# unlocked afterwards; otherwise unlock here and lock on exit.
session="${BW_SESSION:-}"
if [ -z "$session" ] || ! bw unlock --check --session "$session" >/dev/null 2>&1; then
  case "$(bw status | jq -r .status)" in
    unauthenticated) die "bw is not logged in; run 'bw login' first" ;;
  esac
  [ -t 0 ] || die "the vault is locked and there is no terminal to read the master password from; run this from an interactive shell"
  echo "prod-env: unlocking the Bitwarden vault for this run" >&2
  session="$(bw unlock --raw)"
  [ -n "$session" ] || die "bw unlock returned no session"
  trap 'bw lock >/dev/null 2>&1 || true' EXIT
fi

item="$(bw get item "$BW_ITEM" --session "$session")" || die "could not read item ${BW_ITEM} (run 'bw sync' if it was added recently)"
unset session

for name in "${ALLOWED_VARS[@]}"; do
  value="$(jq -r --arg n "$name" '[.fields[]? | select(.name == $n) | .value] | first // empty' <<<"$item")"
  if [ -n "$value" ]; then
    export "$name=$value"
  fi
done
unset item

[ -n "${DATABASE_URL:-}" ] || die "item ${BW_ITEM} has no DATABASE_URL field"

# Say where this is going before it goes there. Host only: the URL
# carries the password.
db_host="$(sed -E 's#^[a-z]+://([^@/]*@)?([^/:?]+).*#\2#' <<<"$DATABASE_URL")"
echo "prod-env: running against ${db_host}" >&2

"$@"
