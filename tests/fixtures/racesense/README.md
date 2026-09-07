# RaceSense player fixtures

Regatta documents captured from the RaceSense player, as the Firestore REST
API returns them, for `tests/racesense-regatta.test.ts`. The document
format is described in `docs/notes/racesense/player-document.md`.

| File | What it is |
|---|---|
| `ilca7-elimination-series.json` | The ILCA 7 Worlds 2026 Elimination Series (regatta `5JsqWPmBU6P7G5rk15ic`): three divisions (Gold, Silver, Bronze) of 46–47 boats, six finished races each, every start under P flag, no general recalls. Its Gold division pairs with `tests/fixtures/xlsx/racesense-ilca7-gold.xlsx`, the workbook the race committee exported from the same regatta, and the test walks the two race by race. |

Captured with

```
pnpm racesense:inspect https://player.vakaros.com/watch/5JsqWPmBU6P7G5rk15ic --save tests/fixtures/racesense/ilca7-elimination-series.json
```

which prunes the per-boat positions and headings, line geometry, device
serial numbers, courses and committee devices (`PRUNED_FIELDS` in
`lib/racesense-regatta.ts`) — the import reads none of them, they are most
of the 10 MB, and the identifiers have no business in a repo. What remains
is the published record: sail numbers, names, starts, OCS lists, finishes.
