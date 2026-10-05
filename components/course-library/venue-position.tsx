'use client';

import { useState } from 'react';
import { formatPosition, parsePosition, type Position } from '@sailscoring/course-cards';

import { Button } from '@/components/ui/button';
import { centroid, formatVariation, todayIso, variationAt } from '@/lib/bearings';

/**
 * Where the racing is: the position a course with no marks of its own — a
 * pasted leg table — takes its magnetic variation from. A course built from
 * marks is placed by them and never needs it. Shown with the variation it
 * gives today, so the scorer can see what the conversion will apply.
 */
export function VenuePosition({
  value,
  marks,
  canEdit,
  onSave,
}: {
  value: Position | undefined;
  /** The library's marks, whose centre is offered as the position. */
  marks: readonly Position[];
  canEdit: boolean;
  onSave: (position: Position | undefined) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const marksCentre = centroid(marks);

  function start() {
    setText(value ? formatPosition(value, { minuteDecimals: 3 }) : '');
    setError('');
    setEditing(true);
  }

  async function save(position: Position | undefined) {
    await onSave(position);
    setEditing(false);
  }

  function submit() {
    if (!text.trim()) {
      void save(undefined);
      return;
    }
    const parsed = parsePosition(text);
    if (!parsed) {
      setError('Enter a position as latitude and longitude, e.g. 51° 48.000′ N 008° 18.000′ W or 51.8, -8.3.');
      return;
    }
    void save(parsed);
  }

  if (editing) {
    return (
      <div className="space-y-1.5 rounded-md border p-3" data-testid="venue-position">
        <label htmlFor="venue-position-input" className="text-sm font-medium">Venue position</label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="venue-position-input"
            className="flex h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-sm font-mono"
            value={text}
            placeholder="51° 48.000′ N 008° 18.000′ W"
            onChange={(e) => { setText(e.target.value); setError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            autoFocus
          />
          {marksCentre && (
            <Button type="button" variant="outline" size="sm" onClick={() => setText(formatPosition(marksCentre, { minuteDecimals: 3 }))}>
              Use the marks&apos; centre
            </Button>
          )}
          <Button type="button" size="sm" onClick={submit} data-testid="venue-position-save">Save</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <p className="text-sm text-muted-foreground" data-testid="venue-position">
      {value ? (
        <>
          Venue position <span className="font-mono">{formatPosition(value, { minuteDecimals: 3 })}</span>
          {' '}· variation {formatVariation(variationAt(value, todayIso()))} today. Bearings and wind are shown in
          °M, worked out at each course&apos;s marks or, for a leg table, here.
        </>
      ) : (
        <>
          No venue position. Courses built from marks show their bearings in °M; a leg table has no marks to
          place it, so its bearings stay in °T until the venue position is set.
        </>
      )}
      {canEdit && (
        <Button variant="link" size="sm" className="h-auto px-1 py-0" onClick={start} data-testid="venue-position-edit">
          {value ? 'Change' : 'Set it'}
        </Button>
      )}
    </p>
  );
}
