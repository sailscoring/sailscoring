'use client';

import { useState } from 'react';
import { formatPosition, parsePosition, type Position } from '@sailscoring/course-cards';

import { Button } from '@/components/ui/button';
import { useFeatures } from '@/components/features-provider';
import { useSeriesMarks } from '@/hooks/use-course-library';
import { useUpdateSeries } from '@/hooks/use-series';
import { centroid, formatVariation, todayIso, variationAt } from '@/lib/bearings';
import type { Series } from '@/lib/types';

/**
 * Where the racing is: the position course legs with no position of their
 * own take their magnetic variation from — legs typed into a start, or a
 * course imported without saying where it starts. A course built from marks
 * is placed by them and never needs it. Shown with the variation it gives
 * today, so the scorer can see what the conversion will apply.
 */
export function VenuePositionCard({
  seriesId,
  series,
}: {
  seriesId: string;
  series: Series;
}) {
  const updateSeries = useUpdateSeries();
  const { has } = useFeatures();
  const [editing, setEditing] = useState(false);
  // The series' marks, whose centre is offered as the position while it is
  // being edited, where the library that holds them is in sight.
  const { data: marks } = useSeriesMarks(seriesId, { enabled: editing && has('orc') && has('course-library') });
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const value = series.venuePosition;
  const marksCentre = centroid(marks ?? []);

  function start() {
    setText(value ? formatPosition(value, { minuteDecimals: 3 }) : '');
    setError('');
    setEditing(true);
  }

  async function save(venuePosition: Position | undefined) {
    await updateSeries.mutateAsync({ id: seriesId, patch: { venuePosition, lastModifiedAt: Date.now() } });
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

  return (
    <div className="bg-card border rounded-lg p-5 space-y-3" data-testid="venue-position">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Venue position</h2>
        {!editing && (
          <Button variant="ghost" size="sm" onClick={start} data-testid="venue-position-edit">
            Edit ▸
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Where the racing is. Legs typed into a start, or a course imported
        without saying where it starts, take their magnetic variation from
        here. Until it is set, typed legs are entered and shown in °T.
      </p>
      {editing ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="Venue position"
              className="flex h-8 min-w-[16rem] flex-1 rounded-md border border-input bg-transparent px-2 text-sm font-mono"
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
      ) : (
        <p className="text-sm text-muted-foreground">
          {value ? (
            <>
              <span className="font-mono">{formatPosition(value, { minuteDecimals: 3 })}</span>
              {' '}· variation {formatVariation(variationAt(value, todayIso()))} today
            </>
          ) : (
            'Not set'
          )}
        </p>
      )}
    </div>
  );
}
