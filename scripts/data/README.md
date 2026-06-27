# scripts/data

Static data files that the generators in `scripts/` read at build time,
colocated with the scripts that consume them. These are **build inputs**, not
runtime data — the app never reads them directly; it reads the generated
artifacts they produce.

| Path | Consumed by | Refresh policy |
|------|-------------|----------------|
| `rya-py/` | `generate-rya-py.ts` (`pnpm generate:rya-py`) → `lib/rya-py/generated/py-list.ts` | ⚠ **Refresh annually** — live build input; the RYA republishes the PY lists about once a year. See `rya-py/README.md`. |
| `irc-echo-ratings.csv` | `generate-sample-series.ts` (`pnpm generate:sample-series`) → the club-racing sample series | **Frozen — do not refresh.** A one-off snapshot of the Irish Sailing IRC/ECHO listing, kept only as seed input for the synthetic sample series. The app fetches Irish Sailing **live** (`lib/irish-sailing-ratings.ts`), so a stale snapshot here affects nothing real. |

The distinction is a deliberate rule: a committed data file survives only if
the app serves data generated from it. PY is bundled (no live fetch), so its
sources are load-bearing and must stay current. IRC and Irish Sailing fetch
live at runtime, so `irc-echo-ratings.csv` survives only as frozen sample-series
seed input.
