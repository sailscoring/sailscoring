'use client';

import { useMemo, useState } from 'react';
import { formatPosition, parsePosition, type Position } from '@sailscoring/course-cards';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { drawnMarks, positionFrom, proposeMarkName, toMetres, type DistanceUnit, type NamingContext } from '@/lib/course-geometry';
import type { SeriesMark } from '@/lib/types';

import { CourseDrawing } from './course-drawing';

export type MarkDialogMode =
  | { kind: 'new'; proposedBase?: string }
  | { kind: 'edit'; mark: SeriesMark };

const INPUT = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm';

/**
 * New / Edit mark. A position is given as coordinates, read the way the
 * log is written (degrees and decimal minutes, decimal degrees, either
 * hemisphere style), or as a bearing and distance from a mark already in
 * the library — how a laid windward mark is actually recorded. Whatever is
 * typed, the canonical rendering is echoed underneath and the drawing
 * shows the new mark among the ones already there.
 */
export function MarkDialog({
  mode,
  seriesId,
  marks,
  naming,
  onSave,
  onCancel,
}: {
  mode: MarkDialogMode | null;
  seriesId: string;
  marks: SeriesMark[];
  naming: NamingContext;
  onSave: (mark: SeriesMark) => Promise<void>;
  onCancel: () => void;
}) {
  if (!mode) return null;
  return (
    <MarkDialogInner
      key={mode.kind === 'edit' ? mode.mark.id : 'new'}
      mode={mode}
      seriesId={seriesId}
      marks={marks}
      naming={naming}
      onSave={onSave}
      onCancel={onCancel}
    />
  );
}

function MarkDialogInner({
  mode,
  seriesId,
  marks,
  naming,
  onSave,
  onCancel,
}: {
  mode: MarkDialogMode;
  seriesId: string;
  marks: SeriesMark[];
  naming: NamingContext;
  onSave: (mark: SeriesMark) => Promise<void>;
  onCancel: () => void;
}) {
  const editing = mode.kind === 'edit' ? mode.mark : null;
  const others = marks.filter((m) => m.id !== editing?.id);
  const [name, setName] = useState(
    editing?.name ?? (mode.kind === 'new' && mode.proposedBase ? proposeMarkName(mode.proposedBase, naming) : ''),
  );
  const [method, setMethod] = useState<'coordinates' | 'bearing'>(editing?.from ? 'bearing' : 'coordinates');
  const [coordinates, setCoordinates] = useState(
    editing ? formatPosition({ lat: editing.lat, lng: editing.lng }, { minuteDecimals: 3 }) : '',
  );
  const [originId, setOriginId] = useState(editing?.from?.markId ?? others[0]?.id ?? '');
  const [bearing, setBearing] = useState(editing?.from ? String(editing.from.bearingDeg) : '');
  const [distance, setDistance] = useState(editing?.from ? String(editing.from.distanceM) : '');
  const [unit, setUnit] = useState<DistanceUnit>(editing?.from ? 'm' : 'nm');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const origin = others.find((m) => m.id === originId);
  const position: Position | null = useMemo(() => {
    if (method === 'coordinates') return parsePosition(coordinates);
    const b = Number(bearing.trim());
    const d = Number(distance.trim());
    if (!origin || !bearing.trim() || !distance.trim()) return null;
    if (!Number.isFinite(b) || b < 0 || b > 360 || !Number.isFinite(d) || d <= 0) return null;
    return positionFrom({ lat: origin.lat, lng: origin.lng }, b, d, unit);
  }, [method, coordinates, origin, bearing, distance, unit]);

  // The drawing: every other mark, plus this one where it is so far.
  const drawn = useMemo(() => {
    const base = drawnMarks(others);
    if (!position) return base;
    return [...base, { id: '__new__', label: name.split(' — ')[0] || '?', position }];
  }, [others, position, name]);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give the mark a name — the date and race help you find it again.');
      return;
    }
    if (!position) {
      setError(
        method === 'coordinates'
          ? 'Enter a position as latitude and longitude, e.g. 53° 23.740′ N 006° 04.210′ W or 53.3957, -6.0702.'
          : 'Pick the mark it was laid from, then a bearing (0–360) and a distance.',
      );
      return;
    }
    const from =
      method === 'bearing' && origin
        ? { markId: origin.id, bearingDeg: Number(bearing.trim()), distanceM: Math.round(toMetres(Number(distance.trim()), unit) * 100) / 100 }
        : undefined;
    setSaving(true);
    try {
      await onSave({
        ...(editing ?? { id: crypto.randomUUID(), seriesId, createdAt: Date.now() }),
        name: trimmed,
        lat: position.lat,
        lng: position.lng,
        ...(from ? { from } : { from: undefined }),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the mark.');
      setSaving(false);
    }
  }

  const readOnlyCard = Boolean(editing?.card);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent
        className="max-w-lg max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto]"
        onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void handleSave(); } }}
      >
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit mark' : 'New mark'}</DialogTitle>
          <DialogDescription>
            {readOnlyCard
              ? 'A mark from the course card: its position is the club’s. Rename it here; re-adopt the card to refresh its position.'
              : 'A position on the water — the line, the finish, a mark the race committee laid.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 min-h-0 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="mark-name">Name</label>
            <input
              id="mark-name"
              className={INPUT}
              value={name}
              onChange={(e) => { setName(e.target.value); setError(''); }}
              placeholder="Z outer — 6 Sep R2"
              autoFocus
            />
          </div>
          {!readOnlyCard && (
            <>
              <div className="space-y-1.5">
                <span className="text-sm font-medium">Position</span>
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="mark-method" checked={method === 'coordinates'} onChange={() => { setMethod('coordinates'); setError(''); }} />
                    Coordinates
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="mark-method" checked={method === 'bearing'} disabled={others.length === 0} onChange={() => { setMethod('bearing'); setError(''); }} />
                    Bearing &amp; distance
                  </label>
                </div>
              </div>
              {method === 'coordinates' ? (
                <div className="space-y-1.5">
                  <label className="sr-only" htmlFor="mark-coordinates">Coordinates</label>
                  <input
                    id="mark-coordinates"
                    className={`${INPUT} font-mono`}
                    value={coordinates}
                    onChange={(e) => { setCoordinates(e.target.value); setError(''); }}
                    placeholder="53° 23.740′ N 006° 04.210′ W"
                    inputMode="text"
                  />
                  <p className="text-xs text-muted-foreground">
                    Degrees and decimal minutes, or decimal degrees, as the log has them.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-[auto_1fr] items-center gap-2 text-sm">
                    <span>from</span>
                    <Select value={originId} onValueChange={(v) => { setOriginId(v); setError(''); }}>
                      <SelectTrigger className="w-full" aria-label="From mark" data-testid="mark-origin">
                        <SelectValue placeholder="Pick a mark" />
                      </SelectTrigger>
                      <SelectContent>
                        {others.map((m) => (
                          <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
                    <input
                      aria-label="Bearing"
                      className={`${INPUT} font-mono`}
                      value={bearing}
                      onChange={(e) => { setBearing(e.target.value); setError(''); }}
                      placeholder="190"
                      inputMode="decimal"
                    />
                    <span className="text-sm">°</span>
                    <input
                      aria-label="Distance"
                      className={`${INPUT} font-mono`}
                      value={distance}
                      onChange={(e) => { setDistance(e.target.value); setError(''); }}
                      placeholder={unit === 'nm' ? '0.54' : unit === 'cables' ? '5.4' : '1000'}
                      inputMode="decimal"
                    />
                    <Select value={unit} onValueChange={(v) => setUnit(v as DistanceUnit)}>
                      <SelectTrigger className="w-24" aria-label="Distance unit"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="nm">NM</SelectItem>
                        <SelectItem value="cables">cables</SelectItem>
                        <SelectItem value="m">metres</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
              <p className="text-sm font-mono text-muted-foreground min-h-5" data-testid="mark-position-echo">
                {position ? `→ ${formatPosition(position, { minuteDecimals: 3 })}` : ''}
              </p>
            </>
          )}
          {readOnlyCard && editing && (
            <p className="text-sm font-mono text-muted-foreground">
              {formatPosition({ lat: editing.lat, lng: editing.lng }, { minuteDecimals: 3 })}
            </p>
          )}
          <CourseDrawing marks={drawn} highlight={position ? '__new__' : undefined} width={480} title="Marks drawing" />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => void handleSave()} disabled={saving}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
