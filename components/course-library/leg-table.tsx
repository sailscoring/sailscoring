'use client';

import { Fragment, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  bearingFigure,
  describeVariation,
  enteredTrue,
  parseBearing,
  toTrue,
  type BearingRef,
  type Variation,
} from '@/lib/bearings';
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
 *
 * Bearings and winds are stored true and shown in the caller's reference —
 * magnetic wherever there is a variation to apply — so a row also keeps the
 * stored figure each of those fields was filled from. A field the scorer
 * leaves alone then saves back exactly, rather than through a rounding.
 */

/** A stored figure and the text a field was filled with from it. Stored
 *  figures are true, except on a start whose course is kept in magnetic. */
export interface KeptFigure {
  text: string;
  trueDeg: number;
}

export interface LegTableRow {
  /** The race committee's label for the leg ("Start – 1"), where the course
   *  came with one. Unused where the name column is off. */
  name: string;
  distance: string;
  bearing: string;
  /** Wind direction on the leg. Unused where the wind columns are off. */
  wind: string;
  /** Recorded wind speed on the leg. */
  windSpeed: string;
  bearingKept?: KeptFigure;
  windKept?: KeptFigure;
  /** The current on the leg (true), where a course arrived with one. There
   *  is no entry for it: it is carried through, and shown under the table
   *  because it is scored. */
  current?: { speedKts: number; directionDeg: number };
}

export function emptyLegRow(defaults?: Partial<LegTableRow>): LegTableRow {
  return { name: '', distance: '', bearing: '', wind: '', windSpeed: '', ...defaults };
}

/** Which north a table's bearings and winds are shown and typed in, and the
 *  variation that converts them to the true they are stored in. With no
 *  variation there is no choice: the figures are shown and typed in the
 *  north they are stored in — true, or magnetic on a start whose course is
 *  kept in magnetic (`RaceStartCourse.north`). */
export interface BearingDisplay {
  ref: BearingRef;
  variation?: Variation;
}

/** A field's text as the figure to store, or null when it is not a bearing
 *  or can't be stored as one. With no variation, a figure marked in the
 *  other north has nothing to convert it by. */
export function storedFigure(text: string, display: BearingDisplay, kept?: KeptFigure): number | null {
  if (display.variation) return enteredTrue(text, display.ref, display.variation, kept);
  if (kept && kept.text.trim() === text.trim()) return kept.trueDeg;
  const parsed = parseBearing(text, display.ref);
  return parsed && parsed.ref === display.ref ? parsed.deg : null;
}

/** A field filled from a stored (true) figure. */
export function figureField(trueDeg: number, display: BearingDisplay): { text: string; kept: KeptFigure } {
  const text = bearingFigure(trueDeg, display.ref, display.variation);
  return { text, kept: { text, trueDeg } };
}

/** A row's bearing as stored (see `storedFigure`), or null when it is not
 *  one. */
export function rowBearingTrue(row: LegTableRow, display: BearingDisplay): number | null {
  return storedFigure(row.bearing, display, row.bearingKept);
}

/** A row's wind direction as stored, likewise. */
export function rowWindTrue(row: LegTableRow, display: BearingDisplay): number | null {
  return storedFigure(row.wind, display, row.windKept);
}

/** The rows re-shown in another reference. A figure that does not read is
 *  left as typed, for the scorer to see and fix. */
export function rowsInRef(rows: LegTableRow[], from: BearingDisplay, to: BearingDisplay): LegTableRow[] {
  return rows.map((row) => {
    const next = { ...row };
    const b = rowBearingTrue(row, from);
    if (b != null && row.bearing.trim()) {
      const f = figureField(b, to);
      next.bearing = f.text;
      next.bearingKept = f.kept;
    }
    const w = rowWindTrue(row, from);
    if (w != null && row.wind.trim()) {
      const f = figureField(w, to);
      next.wind = f.text;
      next.windKept = f.kept;
    }
    return next;
  });
}

/**
 * The dialog-level choice of reference, with the variation it applies — so
 * a reader knows what was used, and when. Without a variation there is no
 * choice, and the figures are in the north they are stored in: `missing`
 * says why.
 */
export function BearingRefControl({
  display,
  onChange,
  missing,
}: {
  display: BearingDisplay;
  onChange: (ref: BearingRef) => void;
  /** Shown in place of the choice where no variation is known. */
  missing: ReactNode;
}) {
  if (!display.variation) {
    return <p className="text-xs text-muted-foreground" data-testid="bearing-ref">Bearings in °{display.ref}. {missing}</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground" data-testid="bearing-ref">
      <span>Bearings in</span>
      <div role="radiogroup" aria-label="Bearings in" className="inline-flex rounded-md border">
        {(['M', 'T'] as const).map((ref) => (
          <button
            key={ref}
            type="button"
            role="radio"
            aria-checked={display.ref === ref}
            className={`px-2 py-0.5 font-mono ${display.ref === ref ? 'bg-muted text-foreground' : ''}`}
            onClick={() => { if (display.ref !== ref) onChange(ref); }}
          >
            °{ref}
          </button>
        ))}
      </div>
      <span>{describeVariation(display.variation)}</span>
    </div>
  );
}

export interface LegTableProps {
  rows: LegTableRow[];
  onChange: (rows: LegTableRow[]) => void;
  /** The reference bearings and winds are shown and typed in. */
  display: BearingDisplay;
  /** The wind-direction column — a race start's table, not a course's. */
  showWind?: boolean;
  /** The recorded wind-speed column, where the option scores at one. */
  showWindSpeed?: boolean;
  /** The leg-name column, where the course came with names. */
  showName?: boolean;
  /** The "Paste a table" box. A caller with its own way in turns it off. */
  paste?: boolean;
  /** Beside "Add leg": the caller's own way of filling the table. */
  actions?: ReactNode;
  /** What a row the scorer adds starts out holding. */
  newRow?: Partial<LegTableRow>;
  /** The note under the table; each caller's own. */
  children?: ReactNode;
}

export function LegTable({
  rows,
  onChange,
  display,
  showWind,
  showWindSpeed,
  showName,
  paste = true,
  actions,
  newRow,
  children,
}: LegTableProps) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState('');

  const total = rows.reduce((sum, r) => sum + (Number(r.distance) || 0), 0);
  // A style rather than a class: Tailwind finds class names by scanning
  // this file's text, and the columns vary by which ones are on.
  const columns = [
    ...(showName ? ['minmax(0,1.6fr)'] : []),
    'minmax(0,1fr)',
    'minmax(0,1fr)',
    ...(showWind ? ['minmax(0,1fr)'] : []),
    ...(showWindSpeed ? ['minmax(0,1fr)'] : []),
    'auto',
  ].join(' ');
  const currents = rows.flatMap((r, i) => (r.current ? [{ leg: i + 1, ...r.current }] : []));

  function setRow(i: number, field: keyof LegTableRow, value: string) {
    onChange(rows.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
  }

  // What the paste says, before it is committed: a table read the wrong way
  // round, or one that lost half its rows to a stray column, is visible here
  // rather than after saving.
  // A bearing the table marks M or T is read that way; the rest are in the
  // reference the dialog is in, which is the scorer's answer to "which north
  // is this table from?".
  const parsed = pasted.trim() ? parseLegTable(pasted) : null;
  const pastedRefs = new Set(parsed?.legs.map((leg) => leg.bearingRef ?? display.ref) ?? []);
  const unmarked = parsed?.legs.some((leg) => !leg.bearingRef) ?? false;
  const cannotConvert = pastedRefs.has('M') && !display.variation;

  function addPasted() {
    if (!parsed || parsed.legs.length === 0 || cannotConvert) return;
    onChange([
      ...rows,
      ...parsed.legs.map((leg) => {
        const f = figureField(toTrue(leg.bearingDeg, leg.bearingRef ?? display.ref, display.variation), display);
        return emptyLegRow({
          ...newRow,
          distance: String(legDistance(leg.distanceNm)),
          bearing: f.text,
          bearingKept: f.kept,
        });
      }),
    ]);
    setPasted('');
    setPasteOpen(false);
  }

  function pastedSummary(): string {
    if (!parsed) return '';
    const refs = [...pastedRefs].map((r) => `°${r}`).join(' and ');
    return `${parsed.legs.length} leg${parsed.legs.length === 1 ? '' : 's'} · ${parsed.legs
      .reduce((sum, l) => sum + l.distanceNm, 0)
      .toFixed(2)} NM · bearings in ${refs}${unmarked && display.variation ? ` (unmarked ones read as °${display.ref})` : ''}${
      parsed.skipped > 0 ? ` · ${parsed.skipped} line${parsed.skipped === 1 ? '' : 's'} skipped` : ''}`;
  }

  return (
    <div className="space-y-1">
      {/* Headers and rows share one grid, so the columns are sized once. As
          separate grids they are not: the trailing column holds the remove
          button in a row and nothing in the header, so it resolves to a
          different width and the 1fr columns drift out from under their
          headers. */}
      <div className="grid gap-1" style={{ gridTemplateColumns: columns }}>
        {showName && <span className="text-xs text-muted-foreground">Leg</span>}
        <span className="text-xs text-muted-foreground">Distance (NM)</span>
        <span className="text-xs text-muted-foreground">Bearing (°{display.ref})</span>
        {showWind && <span className="text-xs text-muted-foreground">Wind dir (°{display.ref})</span>}
        {showWindSpeed && <span className="text-xs text-muted-foreground">Wind (kt)</span>}
        <span />
        {rows.map((row, i) => (
          <Fragment key={i}>
            {showName && (
              <input
                aria-label={`Leg ${i + 1} name`}
                className="flex h-8 min-w-0 rounded-md border border-input bg-transparent px-2 text-sm"
                value={row.name}
                onChange={(e) => setRow(i, 'name', e.target.value)}
              />
            )}
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
          {paste && (
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
          )}
          {actions}
        </div>
        {total > 0 && (
          <span className="text-xs text-muted-foreground font-mono">{total.toFixed(2)} NM total</span>
        )}
      </div>
      {currents.length > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="leg-currents">
          Current, as the course gave it, and scored:{' '}
          {currents
            .map((c) => `leg ${c.leg} ${c.speedKts} kt to ${bearingFigure(c.directionDeg, display.ref, display.variation)}°${display.ref}`)
            .join(' · ')}
        </p>
      )}
      {paste && pasteOpen && (
        <div className="space-y-1.5 rounded-md border p-2">
          <textarea
            aria-label="Leg table to paste"
            className="w-full h-28 rounded-md border border-input bg-transparent px-2 py-1 text-sm font-mono"
            value={pasted}
            placeholder={'2.09\t162\n0.06\t060\n1.91\t340M'}
            onChange={(e) => setPasted(e.target.value)}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground" data-testid="paste-legs-preview">
              {parsed == null
                ? 'One leg per line: its distance in miles, then its bearing, with M or T after it where the table says (105M). Anything after those two is ignored, so a table with the wind on it pastes as it stands.'
                : parsed.legs.length === 0
                  ? 'No legs found — each line needs a distance and a bearing.'
                  : cannotConvert
                    ? 'These bearings are magnetic, and there is no position to work out the variation at — set the venue position on the Courses tab, or mark them T if they are true.'
                    : pastedSummary()}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!parsed || parsed.legs.length === 0 || cannotConvert}
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
