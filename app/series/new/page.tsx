'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { seriesRepo } from '@/lib/dexie-repository';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Series } from '@/lib/types';
import { defaultEnabledCompetitorFields } from '@/lib/competitor-fields';
import { log } from '@/lib/debug';

export default function NewSeriesPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [venue, setVenue] = useState('');
  const [startDate, setStartDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Series name is required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const now = Date.now();
      const series: Series = {
        id: crypto.randomUUID(),
        name: name.trim(),
        venue: venue.trim(),
        startDate: startDate,
        endDate: '',
        venueLogoUrl: '',
        eventLogoUrl: '',
        createdAt: now,
        lastSnapshotId: null,
        lastSavedAt: null,
        lastModifiedAt: now,
        snapshotHistory: [],
        discardThresholds: [],
        dnfScoring: 'seriesEntries',
        ftpHost: '',
        ftpPath: '',
        bilgeBundle: null,
        includeJsonExport: true,
        enabledCompetitorFields: defaultEnabledCompetitorFields(),
      };
      log('series', 'creating', series);
      await seriesRepo.save(series);
      router.push(`/series/${series.id}/competitors`);
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
