# HalSail — public reference material

Curated catalogue of the public sources for understanding HalSail's model and
operation (#235, Output 2). Annotated with what each is good for and its current
extraction status, so we know what's been mined and what still needs a manual
pass. Companion to [`data-model.md`](data-model.md).

These are **external sources**, catalogued here (not copied into `reference/`,
which is for files we vendor). Where a source has been mined, the findings live in
`data-model.md`, not here.

## Official HalSail (live site)

| Source | What it is | Good for | Status |
|---|---|---|---|
| <https://halsail.com/Help/Faq> | Official FAQ | **Concepts & terminology** — confirms the tandem-series definition verbatim; series = per-class; handicap systems; discard table. | ✅ mined → `data-model.md` |
| <https://halsail.com/HalApi> | Public read-only JSON API docs | **Data model** — entity list and ~14 GET endpoints (`GetSeries`, `GetSeriesResult`, `GetDiscards`, `GetScoreBases`, …). | ✅ skimmed; **TODO** capture real payloads to verify fields + whether tandem membership is exposed |
| <https://halsail.com/Help> | Help index | Entry point to the help topics; map what's covered. | ⬜ not yet reviewed |
| <https://halsail.com/Help/Videos> | Video tutorials | **Operator workflow** — likely the clearest view of tandem creation / result entry UI. | ⬜ not yet reviewed |
| <https://halsail.com/Blog> | Product blog | Feature history, recent changes, intent behind features. | ⬜ not yet reviewed |

## Offline predecessor

| Source | What it is | Good for | Status |
|---|---|---|---|
| <https://www.halsraceresults.com/Documents/HRRMk2Manual2018.pdf> | HRR Mk2 desktop manual (2018) | The **underlying scoring concepts** predating the web app — discards, handicaps, series structure, likely the origin of "tandem". | ⬜ not yet reviewed |

## Club race-officer instructions (third-party, operational)

How real clubs document operating HalSail — closest public proxy for "how DBSC
uses it", useful to contrast against the DBSC methodology we're capturing.

| Source | What it is | Good for | Status |
|---|---|---|---|
| <https://www.ccrc.co.uk/wp-content/uploads/CCRC-Halsail-Instructions-for-PROs-2026-Issue-1.pdf> | Coniston CRC PRO instructions, **2026** | Current operator workflow + terminology. | ⚠ image/compressed PDF — did not text-extract via fetch; **needs manual read** (saved locally) |
| <https://royaldart.co.uk/wp-content/uploads/2024/03/Halsail-Instructions-for-RO-Training-2024-v2.pdf> | Royal Dart YC RO training, 2024 | RO training walkthrough. | ⚠ image-heavy PDF — did not text-extract; **needs manual read** |
| <https://www.youtube.com/watch?v=OecRRxXldL0> | HalSail RO video | Operator workflow (screen capture). | ⬜ not yet reviewed |

## Our own derived material

| Source | What it is |
|---|---|
| `sailscoring/dbsc-archive` (`README.md`, `SOURCES.md`, `CLARIFICATIONS.md`) | The reconstruction: the archive AJAX model, the class→tandem join, and the Q1–Q5 divergences. The primary evidence base. |
| `docs/requirements/glossary.md` | Canonical definitions: **Tandem series**, **Star (a race)**, **Flick (a race / a competitor)**. |
| `docs/design/dbsc-parity-plan.md` | Existing parity design. |
