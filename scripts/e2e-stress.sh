#!/usr/bin/env bash
#
# scripts/e2e-stress.sh
#
# Stress harness for the e2e suite: run the full suite while synthetic
# CPU load occupies half the machine's cores, reproducing the "suite ran
# while the machine was busy with something else" conditions that the
# load-sensitive flakes correlate with. Invoke via `pnpm test:e2e:stress`;
# extra args are forwarded to `pnpm test:e2e`.
#
# Deliberately plain `pnpm test:e2e` underneath — no flake triage — since
# a run under artificial load over-reports: read the outcome as an
# aggregate signal (does the suite hold up? what flakes first?), not as a
# list of bugs to file.
#
# The burners start only once the app server answers, so the build inside
# start-test.sh runs at full speed and can't trip Playwright's webServer
# timeout; the load lands on the test phase, which is the part that runs
# alongside real-world background work.

set -uo pipefail

# Resolve this checkout's app port so the readiness probe below watches
# the server the suite will actually start. Sourcing leaves shell
# options untouched (this script deliberately runs without -e).
# shellcheck disable=SC1091
source "$(dirname "$0")/local-env.sh"

cores=$(nproc)
burners=$(( cores / 2 ))
(( burners < 1 )) && burners=1

burner_pids_file=$(mktemp)

# Waits for the server, then spins the burners. The burners are recorded
# in a file rather than tracked as shell jobs: they outlive their parent
# subshell (re-parented on its exit), so the EXIT trap must kill them by
# recorded pid.
(
  until curl -sfo /dev/null "http://localhost:${SS_APP_PORT}"; do sleep 2; done
  echo "e2e-stress: server up — starting ${burners} CPU burners (of ${cores} cores)"
  for ((i = 0; i < burners; i++)); do
    yes > /dev/null &
    echo $! >> "$burner_pids_file"
  done
  wait
) &
loader_pid=$!

cleanup() {
  kill "$loader_pid" 2>/dev/null || true
  while read -r pid; do
    kill "$pid" 2>/dev/null || true
  done < "$burner_pids_file"
  rm -f "$burner_pids_file"
}
trap cleanup EXIT

pnpm test:e2e "$@"
