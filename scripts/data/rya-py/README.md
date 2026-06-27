# RYA Portsmouth Yardstick source data

> ⚠ **Refresh annually.** These are live build inputs — the RYA republishes the
> PY lists about once a year. When they do, replace the files here and
> regenerate (see [Refreshing](#refreshing-annually) below). Unlike IRC and
> Irish Sailing, there is no live fetch: the bundled dataset is only ever as
> current as these committed sources.

External source material for the bundled PY dataset (`lib/rya-py/generated/py-list.ts`),
read by the "RYA Portsmouth Yardstick" source in the Update-handicaps dialog. The
PY numbers change at most once a year, so the dataset is generated at build time
and committed — there is no live fetch (unlike IRC / Irish Sailing).

## Files

| File | Source |
|------|--------|
| `rya-classes.csv` | The official RYA class register (Class ID → Standard Name, Class Name, config). `https://www.pyonline.org.uk/reports/classes.csv` |
| `rya-py-base-list.pdf` | National base PN list (incl. catamaran "Multi" section + an experimental section). Linked from `https://www.rya.org.uk/racing/portsmouth-yardstick/` |
| `rya-py-limited-data-list.pdf` | Limited-data list (classes with too few returns for the base list). Same RYA page. |
| `base-list.txt`, `limited-data.txt` | `pdftotext -layout` of the two PDFs — the generator's parse inputs (committed so the build is reproducible without poppler). |

## Refreshing (annually)

1. Download the two PDFs and `classes.csv` from the RYA page above, replacing the files here.
2. Regenerate the layout text:
   ```sh
   pdftotext -layout rya-py-base-list.pdf base-list.txt
   pdftotext -layout rya-py-limited-data-list.pdf limited-data.txt
   ```
3. Run `pnpm generate:rya-py` and **read the printed summary + warnings against the PDFs.**
   - The **RYA Class ID is the join key**: a row that carries one takes its
     canonical name + config from `classes.csv`.
   - A Class ID printed on a PY list but missing from the register is kept as a
     **name-only** entry (matched by the printed name) and warned about — the
     RYA's own documents occasionally drift (e.g. the Spitfire catamaran is
     printed as id 354, which the register doesn't carry). Reconcile if you can.
   - Wrapped-name cross-check warnings (the printed name is a fragment of the
     register name) are benign — the register name is used regardless.
4. Commit the regenerated `lib/rya-py/generated/py-list.ts` alongside the updated sources.
