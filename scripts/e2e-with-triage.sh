#!/usr/bin/env bash
#
# Pre-push e2e: run the full Playwright suite (retries make it tolerant of
# flakes) then triage any flaky tests into `flake`-labelled GitHub issues.
#
# Exits with the SUITE's status, so a hard failure still blocks the push while
# tests that merely flaked (failed then passed on retry) are filed and the run
# stays green. Any extra args are forwarded to `pnpm test:e2e`.
#
# The JSON report the triage reads is written by the reporter configured in
# playwright.config.ts, so don't pass `--reporter=…` here.
set -uo pipefail

pnpm test:e2e "$@"
suite_code=$?

# Always triage — even after a hard failure, flakes seen alongside it are worth
# filing. Missing/empty report is handled inside the script.
pnpm flake:triage || true

exit "$suite_code"
