#!/usr/bin/env bash
#
# scripts/bw-fields.sh
#
# Sourced, not executed: the shared Bitwarden half of the operator
# wrappers (prod-env.sh, vercel-env.sh). Defines one function,
#
#   bw_export_fields NAME…
#
# which reads the operator's Bitwarden item and exports each named
# custom field as the environment variable of the same name. Fields
# not named are ignored, so each wrapper hands its command only the
# secrets that command needs.
#
# The item is named by BW_ITEM (an item id, as `bw list items --search …`
# reports it) in an untracked `.env.operator` at the repo root:
#
#   BW_ITEM=00000000-0000-0000-0000-000000000000
#
# Like `.env.worktree`, that is a file Next.js never loads, so it cannot
# leak into the app's env handling.
#
# The vault session never leaves the calling process: the key from
# `bw unlock` is passed to the one `bw get item` call with --session and
# is not exported. If the calling shell already holds an unlocked
# BW_SESSION it is used and left alone; otherwise the vault is unlocked
# for this run and an EXIT trap in the caller locks it again when the
# caller exits, whatever its outcome — so the caller must run its
# command as a child, not `exec` it.
#
# `bw unlock` reads the master password from the terminal, so this must
# be run from an interactive shell. It refuses, rather than hangs, when
# there is no terminal, which is what keeps production access from
# running unattended from an agent's shell: the agent prepares the
# command, the operator runs it.
#
# See docs/account-admin.md for the operator-side setup.

_bw_die() {
  echo "${BW_WRAPPER:-bw-fields}: $*" >&2
  exit 1
}

bw_export_fields() {
  local root operator_env session item name value
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  operator_env="${root}/.env.operator"

  command -v bw >/dev/null 2>&1 || _bw_die "the Bitwarden CLI (bw) is not installed"
  command -v jq >/dev/null 2>&1 || _bw_die "jq is not installed"
  [ -f "$operator_env" ] || _bw_die "no .env.operator at the repo root; it should set BW_ITEM=<bitwarden item id> (see docs/account-admin.md)"

  BW_ITEM=""
  # shellcheck disable=SC1090
  source "$operator_env"
  [ -n "$BW_ITEM" ] || _bw_die ".env.operator does not set BW_ITEM"

  # Resolve a vault session. A valid inherited one is used as-is and left
  # unlocked afterwards; otherwise unlock here and lock on exit.
  session="${BW_SESSION:-}"
  if [ -z "$session" ] || ! bw unlock --check --session "$session" >/dev/null 2>&1; then
    case "$(bw status | jq -r .status)" in
      unauthenticated) _bw_die "bw is not logged in; run 'bw login' first" ;;
    esac
    [ -t 0 ] || _bw_die "the vault is locked and there is no terminal to read the master password from; run this from an interactive shell"
    echo "${BW_WRAPPER:-bw-fields}: unlocking the Bitwarden vault for this run" >&2
    session="$(bw unlock --raw)"
    [ -n "$session" ] || _bw_die "bw unlock returned no session"
    trap 'bw lock >/dev/null 2>&1 || true' EXIT
  fi

  item="$(bw get item "$BW_ITEM" --session "$session")" || _bw_die "could not read item ${BW_ITEM} (run 'bw sync' if it was added recently)"
  unset session

  for name in "$@"; do
    value="$(jq -r --arg n "$name" '[.fields[]? | select(.name == $n) | .value] | first // empty' <<<"$item")"
    if [ -n "$value" ]; then
      export "$name=$value"
    fi
  done
  unset item value
}
