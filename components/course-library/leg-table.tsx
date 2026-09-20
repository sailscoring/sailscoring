'use client';

import { Fragment, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { legDistance, parseLegTable } from '@/lib/course-geometry';

/**
 * A constructed course's legs as a table (ORC rule 402.5) — the one control
 * behind both the library course defined by legs and the race start's own
 * table. A course carries distance and bearing; a start adds the wind, which
 * belongs to the race and not to the course, so the wind columns are the
 * caller's choice.
 *
 * Rows are the caller's state, held as strings: a half-typed number is a
 * legitimate state and the caller validates on save, where it can say what
 * is wrong about the course as a whole.
 */

export interface LegTableRow {
  distance: string;
  bearing: string;
  /** Wind direction on the leg. Unused where the wind columns are off. */
  wind: string;
  /** Recorded wind speed on the leg. */
  windSpeed: string;
}

export function emptyLegRow(defaults?: Partial<LegTableRow>): LegTableRow {
  return { distance: '', bearing: '', wind: '', windSpeed: '', ...defaults };
}

export interface LegTableProps {
  rows: LegTableRow[];
  onChange: (rows: LegTableRow[]) => void;
  /** The wind-direction column — a race start's table, not a course's. */
  showWind?: boolean;
  /** The recorded wind-speed column, where the option scores at one. */
  showWindSpeed?: boolean;
  /** What a row the scorer adds starts out holding. */
  newRow?: Partial<LegTableRow>;
  /** The note under the table; each caller's own. */
  children?: ReactNode;
}

export function LegTable({ rows, onChange, showWind, showWindSpeed, newRow, children }: LegTableProps) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState('');

  const total = rows.reduce((sum, r) => sum + (Number(r.distance) || 0), 0);
  // Spelled out rather than built: Tailwind finds class names by scanning
  // this file's text, so a computed one produces no CSS at all.
  const grid = showWind && showWindSpeed
    ? 'grid-cols-[1fr_1fr_1fr_1fr_auto]'
    : showWind || showWindSpeed
      ? 'grid-cols-[1fr_1fr_1fr_auto]'
      : 'grid-cols-[1fr_1fr_auto]';

  function setRow(i: number, field: keyof LegTableRow, value: string) {
    onChange(rows.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
  }

  // What the paste says, before it is committed: a table read the wrong way
  // round, or one that lost half its rows to a stray column, is visible here
  // rather than after saving.
  const parsed = pasted.trim() ? parseLegTable(pasted) : null;

  function addPasted() {
    if (!parsed || parsed.legs.length === 0) return;
    onChange([
      ...rows,
      ...parsed.legs.map((leg) => emptyLegRow({
        ...newRow,
        distance: String(legDistance(leg.distanceNm)),
        bearing: String(leg.bearingDeg),
      })),
    ]);
    setPasted('');
    setPasteOpen(false);
  }

  return (
    <div className="space-y-1">
      {/* Headers and rows share one grid, so the columns are sized once. As
          separate grids they are not: the trailing column holds the remove
          button in a row and nothing in the header, so it resolves to a
          different width and the 1fr columns drift out from under their
          headers. */}
      <div className={`grid ${grid} gap-1`}>
        <span className="text-xs text-muted-foreground">Distance (NM)</span>
        <span className="text-xs text-muted-foreground">Bearing (°)</span>
        {showWind && <span className="text-xs text-muted-foreground">Wind dir (°)</span>}
        {showWindSpeed && <span className="text-xs text-muted-foreground">Wind (kt)</span>}
        <span />
        {rows.map((row, i) => (
          <Fragment key={i}>
            <input
              aria-label={`Leg ${i + 1} distance`}
              className="flex h-8 rounded-md border border-input bg-transparent px-2 text-sm font-mono"
              value={row.distance}
              inputMode="decimal"
              onChange={(e) => setRow(i, 'distance', e.target.value)}
            />
            <input
              aria-label={`Leg ${i + 1} bearing`}
              className="flex h-8 rounded-md border border-input bg-transparent px-2 text-sm font-mono"
              value={row.bearing}
              inputMode="decimal"
              onChange={(e) => setRow(i, 'bearing', e.target.value)}
            />
            {showWind && (
              <input
                aria-label={`Leg ${i + 1} wind direction`}
                className="flex h-8 rounded-md border border-input bg-transparent px-2 text-sm font-mono"
                value={row.wind}
                inputMode="decimal"
                onChange={(e) => setRow(i, 'wind', e.target.value)}
              />
            )}
            {showWindSpeed && (
              <input
                aria-label={`Leg ${i + 1} wind speed`}
                className="flex h-8 rounded-md border border-input bg-transparent px-2 text-sm font-mono"
                value={row.windSpeed}
                inputMode="decimal"
                onChange={(e) => setRow(i, 'windSpeed', e.target.value)}
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2"
              aria-label={`Remove leg ${i + 1}`}
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
            >
              ×
            </Button>
          </Fragment>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange([...rows, emptyLegRow(newRow)])}
          >
            Add leg
          </Button>
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground"
            onClick={() => setPasteOpen((v) => !v)}
            aria-expanded={pasteOpen}
            data-testid="paste-legs-disclosure"
          >
            <ChevronRight className={`h-3 w-3 transition-transform ${pasteOpen ? 'rotate-90' : ''}`} />
            Paste a table
          </button>
        </div>
        {total > 0 && (
          <span className="text-xs text-muted-foreground font-mono">{total.toFixed(2)} NM total</span>
        )}
      </div>
      {pasteOpen && (
        <div className="space-y-1.5 rounded-md border p-2">
          <textarea
            aria-label="Leg table to paste"
            className="w-full h-28 rounded-md border border-input bg-transparent px-2 py-1 text-sm font-mono"
            value={pasted}
            placeholder={'2.09\t162\n0.06\t060\n1.91\t340'}
            onChange={(e) => setPasted(e.target.value)}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground" data-testid="paste-legs-preview">
              {parsed == null
                ? 'One leg per line: its distance in miles, then its bearing. Anything after those two is ignored, so a table with the wind on it pastes as it stands.'
                : parsed.legs.length === 0
                  ? 'No legs found — each line needs a distance and a bearing.'
                  : `${parsed.legs.length} leg${parsed.legs.length === 1 ? '' : 's'} · ${parsed.legs
                      .reduce((sum, l) => sum + l.distanceNm, 0)
                      .toFixed(2)} NM${parsed.skipped > 0 ? ` · ${parsed.skipped} line${parsed.skipped === 1 ? '' : 's'} skipped` : ''}`}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!parsed || parsed.legs.length === 0}
              onClick={addPasted}
              data-testid="paste-legs-add"
            >
              Add these legs
            </Button>
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
