#!/usr/bin/env bash
#
# scripts/check-backup.sh
#
# Quick sanity check on a pg_dump custom-format archive without
# restoring it into a database. For each TABLE DATA entry in the
# dump's table of contents, extract the COPY block and count its rows.
#
# Use this as a tier-0 check on a freshly downloaded backup before
# committing to the full restore drill in docs/database-backup.md.
# Passing this proves the file is a valid custom-format archive whose
# TOC and per-table COPY streams decompress cleanly, and gives you
# row counts to eyeball against expectations. It does NOT exercise
# index or constraint rebuild — only an actual pg_restore does that.
#
# Usage:
#   scripts/check-backup.sh path/to/backup.dump
#
# Assumes the dump was produced with `pg_dump -Fc` (the format the
# backup workflow uses). Tables dumped via `--inserts` won't be
# counted because they aren't COPY blocks.
#
# See docs/database-backup.md.

set -euo pipefail

DUMP=${1:-}
if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
  echo "Usage: $0 <path-to-dump>" >&2
  exit 2
fi

BYTES=$(stat -c %s "$DUMP" 2>/dev/null || stat -f %z "$DUMP")
printf 'File: %s (%s bytes)\n\n' "$DUMP" "$BYTES"

# Read table identifiers (schema and name) from the TOC. Hard-coding
# the list would rot every time the schema changes — and Better Auth's
# table names ("user", "organization", "account") aren't what you'd
# guess from the application's vocabulary anyway.
TOC=$(pg_restore --list "$DUMP")

printf '%-40s %10s\n' 'TABLE' 'ROWS'
printf '%-40s %10s\n' '----------------------------------------' '----------'

ZEROS=()
while IFS=$'\t' read -r schema table; do
  # `pg_restore --data-only --schema=S --table=T -f -` decompresses
  # one table's COPY block to stdout. The output frames the data
  # between `COPY ... FROM stdin;` and a terminating `\.` line; awk
  # isolates the lines in between, `grep -c .` counts non-empty ones.
  rows=$(pg_restore --data-only --schema="$schema" --table="$table" -f - "$DUMP" 2>/dev/null \
          | awk '/^COPY /{p=1;next} /^\\\.$/{p=0} p' \
          | grep -c . || true)
  printf '%-40s %10s\n' "$schema.$table" "$rows"
  [ "$rows" = "0" ] && ZEROS+=("$schema.$table")
done < <(printf '%s\n' "$TOC" \
          | awk '/TABLE DATA/ { print $6 "\t" $7 }')

if [ ${#ZEROS[@]} -gt 0 ]; then
  printf '\nEmpty tables (verify these are expected):\n'
  printf '  %s\n' "${ZEROS[@]}"
fi
