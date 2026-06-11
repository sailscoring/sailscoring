'use client';

import { useEffect, useState } from 'react';

import * as repos from '@/lib/api-repository';
import { Button } from '@/components/ui/button';
import { useSaveFleet } from '@/hooks/use-fleets';
import { useUpdateSeries } from '@/hooks/use-series';
import type { Series } from '@/lib/types';

export function ScoringModeCard({ seriesId, series }: { seriesId: string; series: Series }) {
  const { raceRepo, finishRepo, fleetRepo } = repos;
  const updateSeries = useUpdateSeries();
  const saveFleet = useSaveFleet();
  const [expanded, setExpanded] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockReason, setLockReason] = useState('');

  // Check if any race in the series has finishes — if so, scoring mode is locked
  useEffect(() => {
    (async () => {
      const races = await raceRepo.listBySeries(seriesId);
      if (races.length === 0) { setLocked(false); return; }
      let hasAnyFinish = false;
      for (const r of races) {
        const finishes = await finishRepo.listByRace(r.id);
        if (finishes.length > 0) { hasAnyFinish = true; break; }
      }
      if (hasAnyFinish) {
        setLocked(true);
        setLockReason('Scoring mode is locked because races have finishes. Remove all finishes to change it.');
      } else {
        setLocked(false);
      }
    })();
  }, [seriesId, raceRepo, finishRepo]);

  async function handleChange(mode: 'scratch' | 'handicap') {
    if (locked || mode === series.scoringMode) return;
    await updateSeries.mutateAsync({
      id: seriesId,
      patch: { scoringMode: mode, lastModifiedAt: Date.now() },
    });
    // When switching to scratch, reset all fleet scoring systems to scratch
    if (mode === 'scratch') {
      const fleets = await fleetRepo.listBySeries(seriesId);
      for (const f of fleets) {
        if (f.scoringSystem !== 'scratch') {
          await saveFleet.mutateAsync({ ...f, scoringSystem: 'scratch' });
        }
      }
    }
  }

  const summary = series.scoringMode === 'handicap'
    ? 'Handicap (time-corrected)'
    : 'Scratch (position-based)';

  return (
    <div className="bg-card border rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Scoring mode</h2>
        {!expanded && (
          <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
            Edit ▸
          </Button>
        )}
      </div>
      {!expanded ? (
        <p className="text-sm text-muted-foreground">{summary}</p>
      ) : (
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="scoringMode"
                value="scratch"
                checked={series.scoringMode === 'scratch'}
                onChange={() => handleChange('scratch')}
                disabled={locked}
                className="mt-0.5"
              />
              <div>
                <span className="text-sm font-medium">Scratch (position-based)</span>
                <p className="text-xs text-muted-foreground">Boats are ranked by the order they cross the finish line. No finish times needed.</p>
              </div>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name="scoringMode"
                value="handicap"
                checked={series.scoringMode === 'handicap'}
                onChange={() => handleChange('handicap')}
                disabled={locked}
                className="mt-0.5"
              />
              <div>
                <span className="text-sm font-medium">Handicap (time-corrected)</span>
                <p className="text-xs text-muted-foreground">Some or all fleets use IRC, PY, or other time-based scoring. Finish times are recorded for handicap fleets.</p>
              </div>
            </label>
          </div>
          {locked && (
            <p className="text-xs text-muted-foreground">{lockReason}</p>
          )}
          <Button variant="outline" size="sm" onClick={() => setExpanded(false)}>
            Done
          </Button>
        </div>
      )}
    </div>
  );
}
