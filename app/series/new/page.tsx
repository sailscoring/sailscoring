'use client';

import { Suspense, useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { seriesRepo, listSeriesNames } from '@/lib/dexie-repository';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Series } from '@/lib/types';
import { defaultEnabledCompetitorFields, DEFAULT_PRIMARY_PERSON_LABEL } from '@/lib/competitor-fields';
import { generateUniquePlaceholderName } from '@/lib/placeholder-names';
import { isDuplicateSeriesName } from '@/lib/series-name';
import { log } from '@/lib/debug';

async function doCreateSeries(
  seriesName: string,
  seriesVenue: string,
  seriesDate: string,
): Promise<string> {
  const now = Date.now();
  const series: Series = {
    id: crypto.randomUUID(),
    name: seriesName,
    venue: seriesVenue,
    startDate: seriesDate,
    endDate: '',
    venueLogoUrl: '',
    eventLogoUrl: '',
    createdAt: now,
    lastSnapshotId: null,
    lastSavedAt: null,
    lastModifiedAt: now,
    snapshotHistory: [],
    scoringMode: 'scratch',
    discardThresholds: [],
    dnfScoring: 'seriesEntries',
    ftpHost: '',
    ftpPath: '',
    bilgeBundle: null,
    includeJsonExport: true,
    enabledCompetitorFields: defaultEnabledCompetitorFields(),
    primaryPersonLabel: DEFAULT_PRIMARY_PERSON_LABEL,
  };
  log('series', 'creating', series);
  await seriesRepo.save(series);
  return series.id;
}

function NewSeriesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isQuick = searchParams.get('quick') === '1';
  const didCreate = useRef(false);

  const [name, setName] = useState('');
  const [venue, setVenue] = useState('');
  const [startDate, setStartDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Normal mode: auto-create series with placeholder name and redirect to wizard
  useEffect(() => {
    if (isQuick || didCreate.current) return;
    didCreate.current = true;
    (async () => {
      const existing = await listSeriesNames();
      return doCreateSeries(generateUniquePlaceholderName(existing), '', '');
    })().then((id) => {
      router.push(`/series/${id}/setup`);
    }).catch((err) => {
      console.error(err);
      setError('Failed to create series.');
    });
  }, [isQuick, router]);

  if (!isQuick) {
    return (
      <div className="max-w-md space-y-6">
        <p className="text-muted-foreground">Creating series…</p>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  // Quick mode: the traditional form (preserves existing e2e test flows)
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Series name is required.');
      return;
    }
    if (isDuplicateSeriesName(trimmed, await listSeriesNames())) {
      setError('A series with this name already exists.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const id = await doCreateSeries(trimmed, venue.trim(), startDate);
      router.push(`/series/${id}/competitors`);
    } catch (err) {
      console.error(err);
      setError('Failed to save series. Please try again.');
      setSaving(false);
    }
  }

  return (
    <div className="max-w-md space-y-6">
      <h1 className="text-2xl font-semibold">New series</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. The Brassed-Off Cup"
            autoFocus
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="venue">Venue</Label>
          <Input
            id="venue"
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            placeholder="e.g. Howth Yacht Club"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="startDate">Date</Label>
          <Input
            id="startDate"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-3 pt-2">
          <Button type="submit" disabled={saving}>
            {saving ? 'Creating…' : 'Create series'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={saving}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

export default function NewSeriesPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
      <NewSeriesContent />
    </Suspense>
  );
}
