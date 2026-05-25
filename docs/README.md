# Sail Scoring — Project Documentation

Design notes, architecture decisions, requirements, and runbooks for the
Sail Scoring application. The deployed app is `app.sailscoring.ie`; the
source is in this repository. Top-level entry points:

- [`../README.md`](../README.md) — project overview, tech stack, basic
  dev/test/deploy commands.
- [`../CLAUDE.md`](../CLAUDE.md) — instructions for Claude Code working
  in this repo, plus the canonical short list of ADRs.
- [`../DEPLOY.md`](../DEPLOY.md) — end-to-end fresh-deployment runbook
  (Vercel + Neon + Resend + env vars + custom domain).
- [`local-dev-scripts.md`](local-dev-scripts.md) — every `pnpm` script,
  the env-file layout, and how the test paths wire together.

## Requirements (`requirements/`)

What the system needs to do, and for whom.

- [`glossary.md`](requirements/glossary.md) — sailing and racing
  terminology used throughout the codebase and docs.
- [`user-stories.md`](requirements/user-stories.md) — scorer and
  result-viewer needs as user stories.
- [`scorer-collaboration.md`](requirements/scorer-collaboration.md) —
  how multiple scorers work together on a shared series, mapped to the
  ADR-008 phases that implement each requirement.
- [`iodai-use-case.md`](requirements/iodai-use-case.md) — Milestone 1
  target: position-based scratch scoring for IODAI.
- [`hyc-use-case.md`](requirements/hyc-use-case.md) — Milestone 2
  target: time-based handicap scoring for HYC Autumn League.
- [`hyc-frostbite-use-case.md`](requirements/hyc-frostbite-use-case.md)
  — mixed scratch/PY dinghy scoring; drove the ADR-007 finish sheet
  model.

## Design (`design/`)

How it works, and why.

### Architecture Decision Records

- [`decisions/`](design/decisions/) — the full set. See
  [`../CLAUDE.md`](../CLAUDE.md) for the short list with status.
  ADR-008 is the active full-stack architecture; ADR-001, ADR-003,
  and (shortly) ADR-004 are superseded by it.

### Cross-cutting design

- [`data-model.md`](design/data-model.md) — entities, relationships,
  attributes.
- [`handicap-scoring.md`](design/handicap-scoring.md) — IRC, PY, NHC1
  (= SWNHC2015), ECHO — mathematics, implementation, status.
- [`scoring-codes.md`](design/scoring-codes.md) — RRS Appendix A codes
  (DNC, DNS, OCS, DNF, RET, DSQ, DNE, UFD, BFD, RDG, ZFP, SCP, DPI):
  semantics, data model, UX.
- [`libscoring-api.md`](design/libscoring-api.md) — the pure scoring
  engine's input/output shape.
- [`results-renderer.md`](design/results-renderer.md) — how the HTML
  results page is produced.
- [`series-file-format.md`](design/series-file-format.md) — the
  `.sailscoring` JSON export format.
- [`keyboard-navigation.md`](design/keyboard-navigation.md) — keyboard
  shortcut philosophy and reference.
- [`naming.md`](design/naming.md) — when to write "Sail Scoring", when
  "sailscoring", when "SailScoring".
- [`user-docs.md`](design/user-docs.md) — approach to in-app `/help`.
- [`bilge-client.md`](design/bilge-client.md) — design for a separate
  bilge upload UI (superseded by ADR-008 Phase 9's in-app publishing
  path; kept for context).
- [`marketing-site.md`](design/marketing-site.md) — design notes for
  `sailscoring.ie` (the apex marketing site, separate repo).
- [`sailwave-html-template.md`](design/sailwave-html-template.md) —
  reverse-engineered Sailwave HTML structure that the renderer mirrors.
- [`oss-health-report.md`](design/oss-health-report.md) — April 2026
  sustainability review of the Vercel / Next.js / Postgres stack; source
  of the commitments in ADR-008's *Sustainability posture* section.
- [`horizon.md`](design/horizon.md) — long-range possibilities worth
  remembering but not actively tracked as issues. Includes the deferred
  handicap-system work and the residual ADR-008 phases.

### UX flows and screens

- [`ux/screen-inventory.md`](design/ux/screen-inventory.md) — every
  screen in the app, by route (predates ADR-008 in places — see the
  currency note at the top).
- [`ux/flows/`](design/ux/flows/) — per-workflow walkthroughs (finish
  entry, competitor import, series setup, publish, etc.).

### Design notes

- [`notes/`](design/notes/) — short investigations into specific
  technical questions (Next.js static export trade-offs, Playwright
  setup, etc.).

## Operational runbooks

- [`workspace-provisioning.md`](workspace-provisioning.md) — the
  `pnpm provision-org` CLI used to set up org workspaces for scoring
  panels (HYC and similar) until ADR-008 Phase 10 ships self-service
  org admin.
- [`account-admin.md`](account-admin.md) — admin scripts for changing a
  user's login email and inspecting user stats.
- [`database-backup.md`](database-backup.md) — daily Postgres backups
  to S3 with Object Lock; threat model, restore procedure, bootstrap
  for a new instance.

## Notes (`notes/`)

Investigations and reference material that informed implementation.

- [`notes/sailwave-nhc1-reverse-engineering.md`](notes/sailwave-nhc1-reverse-engineering.md)
  — how we identified that Sailwave NHC1 is the SWNHC2015 spreadsheet.
- [`notes/sailwave-excel-handicap-protocol.md`](notes/sailwave-excel-handicap-protocol.md)
  — Sailwave's Excel-based handicap calculation workflow.
- [`notes/sailwave-json-format.md`](notes/sailwave-json-format.md) —
  format notes from inspecting Sailwave exports.
