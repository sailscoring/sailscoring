#!/usr/bin/env bash
# The phone sheet: run the e2e suite at phone size with screenshot capture on,
# then gather one shot of each page and dialog it reached into a single page,
# screenshots/phone/index.html, for looking over by eye. Extra args go to
# Playwright (`pnpm phone-sheet e2e/foo.spec.ts` for one spec's screens).
#
# The index is built whatever the suite's result: a failing phone check is
# exactly when the sheet is worth a look.
set -uo pipefail
cd "$(dirname "$0")/.."
rm -rf screenshots/phone
E2E_PHONE_SHEET=1 pnpm test:e2e:mobile "$@"
status=$?
pnpm phone-sheet:index
exit $status
