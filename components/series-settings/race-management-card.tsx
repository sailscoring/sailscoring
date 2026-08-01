'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { OfficialsEditor } from '@/components/officials-editor';
import { useUpdateSeries } from '@/hooks/use-series';
import { formatOfficials, hasOfficials, namedOfficials } from '@/lib/race-officials';
import type { RaceOfficial, Series } from '@/lib/types';

/**
 * The event's standing race management team, and whether it is published.
 *
 * Kept separate from each race's own team: neither inherits from nor overrides
 * the other, so a series that fills in both shows both. A regatta is expected
 * to use this one; a club series where the duty rotates week to week is
 * expected to use the per-race list instead.
 *
 * The publish switch lives here rather than on the Publishing card so the
 * whole feature appears and disappears with its gate. It is off by default —
 * these are the names of non-competitors, and the card says so inline rather
 * than leaving a scorer to wonder why the team they entered isn't on the page.
 */
export function RaceManagementCard({
  seriesId,
  series,
}: {
  seriesId: string;
  series: Series;
}) {
  const updateSeries = useUpdateSeries();
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<RaceOfficial[]>(series.officials ?? []);
  const [changed, setChanged] = useState(false);

  // Re-sync when the persisted value changes identity (another tab saved).
  // Render-time compare, not an effect — as ProtestTimeLimitCard does.
  const [prevOfficials, setPrevOfficials] = useState(series.officials);
  if (prevOfficials !== series.officials) {
    setPrevOfficials(series.officials);
    setDraft(series.officials ?? []);
    setChanged(false);
  }

  const published = series.publishOfficials === true;

  async function save() {
    // Half-filled rows are editing artefacts, not members.
    const named = namedOfficials(draft).map((o) => ({ ...o, name: o.name.trim() }));
    await updateSeries.mutateAsync({
      id: seriesId,
      patch: { officials: named, lastModifiedAt: Date.now() },
    });
    setDraft(named);
    setChanged(false);
  }

  const summary = hasOfficials(series.officials)
    ? `${formatOfficials(series.officials)} — ${published ? 'published' : 'not published'}`
    : 'No standing team recorded';

  return (
    <div className="bg-card border rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Race management team</h2>
        {!expanded && (
          <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
            Edit ▸
          </Button>
        )}
      </div>
      {!expanded ? (
        <p className="text-sm text-muted-foreground">{summary}</p>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            The standing team for this event, in World Sailing&apos;s terms — an
            Officer of the Day is a Race Officer here. Who ran an individual
            race is set on that race instead; neither list replaces the other.
          </p>

          <OfficialsEditor value={draft} onChange={(next) => { setDraft(next); setChanged(true); }} idPrefix="series" />

          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={!changed} onClick={() => void save()}>
              {changed ? 'Save' : 'Saved'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded(false)}>
              Done
            </Button>
          </div>

          <div className="flex items-start gap-2.5 border-t pt-4">
            <input
              id="publishOfficials"
              type="checkbox"
              checked={published}
              onChange={(e) => {
                updateSeries.mutate({
                  id: seriesId,
                  patch: { publishOfficials: e.target.checked, lastModifiedAt: Date.now() },
                });
              }}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <div>
              <label htmlFor="publishOfficials" className="text-sm font-medium cursor-pointer">
                Publish the race management team
              </label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Off by default. These are the names of people who aren&apos;t
                competitors, so nothing here — the standing team or any
                race&apos;s own — reaches a published page or the data export
                until you turn this on.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
