# Naming Conventions

## Project Name

The project has one name used in three forms depending on context:

| Form | Usage | Examples |
|------|-------|---------|
| **Sail Scoring** | Brand / display name. Use in prose, UI, marketing, documentation headings. | "Welcome to Sail Scoring", page titles, about pages |
| **sailscoring** | Identifiers. Use for repos, domains, accounts, packages, imports, and anywhere a single lowercase token is needed. | `sailscoring.ie`, `github.com/…/sailscoring`, `import sailscoring`, `sailscoring_db` |
| **SailScoring** | PascalCase. Use only where a coding convention requires it. | `class SailScoringApp`, `SailScoringConfig` |

## Guidelines

- When in doubt, use **sailscoring** (all lowercase, one word).
- Never use `sail_scoring` or `sail-scoring` — the compound reads fine without a separator.
- In running prose and user-facing text, prefer **Sail Scoring** (two words, title case).
- **SailScoring** should only appear where PascalCase is the established convention (e.g. class names). Do not use it in filenames, URLs, or prose.
