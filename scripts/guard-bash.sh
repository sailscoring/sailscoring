#!/usr/bin/env bash
#
# PreToolUse Bash hook — blocks the recurring command-decoration regressions
# tracked in https://github.com/sailscoring/sailscoring/issues/113.
#
# Reads PreToolUse JSON on stdin. When the command matches an anti-pattern,
# emits a hookSpecificOutput.permissionDecision=deny with a reason that
# points at the named pnpm script the agent should have used. Otherwise
# exits 0 silently.

set -euo pipefail

input=$(cat)
cmd=$(jq -r '.tool_input.command // empty' <<<"$input")
[[ -z "$cmd" ]] && exit 0

reason=""

if [[ "$cmd" =~ (^|[$'\n';\&\|\(])[[:space:]]*DATABASE_URL= ]]; then
  reason="Blocked: command uses a DATABASE_URL= env prefix (issue #113).

Use a named pnpm script instead — they bake in the right URL and stay inside
the permission allowlist. See docs/local-dev-scripts.md for the full table.
Common mappings:
  vitest                 -> pnpm test:unit  (or pnpm test:unit:db for DB tests)
  playwright             -> pnpm test:e2e
  drizzle migrations     -> pnpm db:migrate:test
  ad-hoc psql            -> pnpm db:psql:test
  scripts/provision-org  -> pnpm provision-org:test
  scripts/change-email   -> pnpm change-email:test
  scripts/user-stats     -> pnpm user-stats:test

If you genuinely need a combination that isn't covered by a named script,
add one to package.json rather than running inline."
elif [[ "$cmd" =~ pnpm[[:space:]]+exec[[:space:]]+(playwright|vitest|tsx)([[:space:]]|$) ]]; then
  reason="Blocked: 'pnpm exec ${BASH_REMATCH[1]}' wraps tooling that already has a
named pnpm script (issue #113).

Use the wrapper instead:
  pnpm exec playwright       -> pnpm test:e2e
  pnpm exec vitest           -> pnpm test:unit  (or pnpm test:unit:db)
  pnpm exec tsx scripts/...  -> the matching pnpm script in package.json

See docs/local-dev-scripts.md."
elif [[ "$cmd" =~ pnpm[[:space:]]+tsx[[:space:]]+scripts/ ]]; then
  reason="Blocked: invoking a scripts/ file directly via 'pnpm tsx scripts/...'
(issue #113).

Every script under scripts/ has a named pnpm wrapper in package.json. See the
'Files under scripts/' table in docs/local-dev-scripts.md for the full mapping."
fi

if [[ -n "$reason" ]]; then
  jq -nc --arg reason "$reason" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
fi

exit 0
