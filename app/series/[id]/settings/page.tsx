'use client';

import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { seriesRepo } from '@/lib/dexie-repository';
import { db } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  saveSeriesFile,
  parseSeriesFile,
  checkLineage,
  openSeriesFromFile,
  updateSeriesFromFile,
  type SeriesFile,
  type LineageStatus,
} from '@/lib/series-file';
import type { DiscardThreshold } from '@/lib/types';

type UpdateFlow =
  | { step: 'idle' }
  | { step: 'confirm'; file: SeriesFile; status: LineageStatus }
  | { step: 'working' }
  | { step: 'error'; message: string };

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `today at ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `yesterday at ${time}`;
  return d.toLocaleDateString();
}

export default function SettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: seriesId } = use(params);
  const router = useRouter();
  const series = useLiveQuery(async () => (await seriesRepo.get(seriesId)) ?? null, [seriesId]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [updateFlow, setUpdateFlow] = useState<UpdateFlow>({ step: 'idle' });

  const [venue, setVenue] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [venueLogoUrl, setVenueLogoUrl] = useState('');
  const [eventLogoUrl, setEventLogoUrl] = useState('');
  const [basicsChanged, setBasicsChanged] = useState(false);

  const [thresholds, setThresholds] = useState<DiscardThreshold[]>([]);
  const [scoringChanged, setScoringChanged] = useState(false);

  useEffect(() => {
    if (series) {
      setVenue(series.venue);
      setStartDate(series.startDate);
      setEndDate(series.endDate);
      setVenueLogoUrl(series.venueLogoUrl);
      setEventLogoUrl(series.eventLogoUrl);
      setBasicsChanged(false);
      setThresholds(series.discardThresholds ?? []);
      setScoringChanged(false);
    }
  }, [series?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSaveBasics(e: React.FormEvent) {
    e.preventDefault();
    try {
      await db.series.update(seriesId, {
        venue: venue.trim(),
        startDate,
        endDate,
        venueLogoUrl: venueLogoUrl.trim(),
        eventLogoUrl: eventLogoUrl.trim(),
        lastModifiedAt: Date.now(),
      });
      setBasicsChanged(false);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleSaveScoring(e: React.FormEvent) {
    e.preventDefault();
    try {
      await db.series.update(seriesId, {
        discardThresholds: thresholds,
        lastModifiedAt: Date.now(),
      });
      setScoringChanged(false);
    } catch (err) {
      console.error(err);
    }
  }

  function updateThreshold(index: number, field: keyof DiscardThreshold, value: number) {
    setThresholds((prev) => {
      const next = prev.map((t, i) => i === index ? { ...t, [field]: value } : t);
      setScoringChanged(true);
      return next;
    });
  }

  function addThreshold() {
    setThresholds((prev) => {
      const maxMinRaces = prev.reduce((m, t) => Math.max(m, t.minRaces), 0);
      const maxDiscardCount = prev.reduce((m, t) => Math.max(m, t.discardCount), 0);
      setScoringChanged(true);
      return [...prev, { minRaces: maxMinRaces + 1, discardCount: maxDiscardCount + 1 }];
    });
  }

  function removeThreshold(index: number) {
    setThresholds((prev) => {
      setScoringChanged(true);
      return prev.filter((_, i) => i !== index);
    });
  }

  if (series === undefined) return <p className="text-muted-foreground">Loading…</p>;
  if (series === null) return <p className="text-muted-foreground">Series not found.</p>;

  const hasFileHistory = series.lastSnapshotId !== null;
  const isModified =
    series.lastSavedAt !== null && series.lastModifiedAt > series.lastSavedAt;

  async function handleSaveToFile() {
    setSaving(true);
    try {
      await saveSeriesFile(seriesId);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  function handleUpdateFromFile() {
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const content = await file.text();
      const parsed = parseSeriesFile(content);

      if (parsed.seriesId !== series!.id) {
        setUpdateFlow({
          step: 'error',
          message:
            'This file is for a different series. Use "Open Series" on the home screen to open it as a new series.',
        });
        return;
      }

      const status = checkLineage(series!, parsed);
      setUpdateFlow({ step: 'confirm', file: parsed, status });
    } catch (err) {
      setUpdateFlow({
        step: 'error',
        message: err instanceof Error ? err.message : 'Could not read file.',
      });
    }
  }

  async function handleConfirmUpdate(asNewCopy: boolean) {
    if (updateFlow.step !== 'confirm') return;
    const { file } = updateFlow;
    setUpdateFlow({ step: 'working' });
    try {
      if (asNewCopy) {
        const newId = await openSeriesFromFile(file);
        router.push(`/series/${newId}/races`);
      } else {
        await updateSeriesFromFile(seriesId, file);
        router.push(`/series/${seriesId}/races`);
      }
    } catch (err) {
      console.error(err);
      setUpdateFlow({ step: 'error', message: 'Failed to update series. Please try again.' });
    }
  }

  return (
    <div className="space-y-6 max-w-lg">
      {/* Basics card */}
      <form onSubmit={handleSaveBasics} className="border rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-medium">Basics</h2>
        <div className="space-y-1.5">
          <Label htmlFor="venue">Venue</Label>
          <Input
            id="venue"
            value={venue}
            onChange={(e) => { setVenue(e.target.value); setBasicsChanged(true); }}
            placeholder="e.g. Howth Yacht Club"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="startDate">Start date</Label>
            <Input
              id="startDate"
              type="date"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setBasicsChanged(true); }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="endDate">End date</Label>
            <Input
              id="endDate"
              type="date"
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setBasicsChanged(true); }}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="venueLogoUrl">Venue logo URL</Label>
          <Input
            id="venueLogoUrl"
            type="url"
            value={venueLogoUrl}
            onChange={(e) => { setVenueLogoUrl(e.target.value); setBasicsChanged(true); }}
            placeholder="https://…"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="eventLogoUrl">Event logo URL</Label>
          <Input
            id="eventLogoUrl"
            type="url"
            value={eventLogoUrl}
            onChange={(e) => { setEventLogoUrl(e.target.value); setBasicsChanged(true); }}
            placeholder="https://…"
          />
        </div>
        <Button type="submit" variant="outline" disabled={!basicsChanged}>
          {basicsChanged ? 'Save' : 'Saved'}
        </Button>
      </form>

      {/* Scoring card */}
      <form onSubmit={handleSaveScoring} className="border rounded-lg p-5 space-y-4">
        <div>
          <h2 className="text-sm font-medium">Scoring</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Discard rules — drop each competitor&apos;s worst race(s) from the series total.
            Each rule sets the <em>total</em> number of discards once that many races have been sailed.
          </p>
        </div>
        {thresholds.length === 0 ? (
          <p className="text-sm text-muted-foreground">No discards configured.</p>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs text-muted-foreground px-1">
              <span>From (races)</span>
              <span>Total discards</span>
              <span />
            </div>
            {[...thresholds]
              .sort((a, b) => a.minRaces - b.minRaces)
              .map((t, i, sorted) => {
                const origIndex = thresholds.indexOf(t);
                const minDiscard = i === 0 ? 1 : sorted[i - 1].discardCount + 1;
                return (
                  <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                    <Input
                      type="number"
                      min={1}
                      value={t.minRaces}
                      onChange={(e) => updateThreshold(origIndex, 'minRaces', Math.max(1, parseInt(e.target.value) || 1))}
                      className="h-8 text-sm"
                    />
                    <Input
                      type="number"
                      min={minDiscard}
                      max={t.minRaces - 1}
                      value={t.discardCount}
                      onChange={(e) => updateThreshold(origIndex, 'discardCount', Math.max(minDiscard, parseInt(e.target.value) || minDiscard))}
                      className="h-8 text-sm"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-muted-foreground"
                      onClick={() => removeThreshold(origIndex)}
                    >
                      ×
                    </Button>
                  </div>
                );
              })}
          </div>
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={addThreshold}>
            Add rule
          </Button>
          <Button type="submit" variant="outline" size="sm" disabled={!scoringChanged}>
            {scoringChanged ? 'Save' : 'Saved'}
          </Button>
        </div>
      </form>

      {/* File card */}
      <div className={`border rounded-lg p-5 space-y-4 ${!hasFileHistory ? 'opacity-70' : ''}`}>
        <div>
          <h2 className="text-sm font-medium">File</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {series.lastSavedAt
              ? <>Last saved: {formatTimestamp(series.lastSavedAt)}{isModified && <span className="ml-2 text-amber-600 dark:text-amber-400">· modified since last save</span>}</>
              : hasFileHistory
              ? 'Opened from file — not yet saved from this device'
              : 'Not saved to file'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSaveToFile} disabled={saving} variant="outline">
            {saving ? 'Saving…' : 'Save to File'}
          </Button>
          {hasFileHistory && (
            <Button onClick={handleUpdateFromFile} variant="outline">
              Update from File
            </Button>
          )}
        </div>
        {!hasFileHistory && (
          <p className="text-xs text-muted-foreground">
            Save to a file to share this series with co-scorers or back it up.
          </p>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".sailscoring,application/json"
        className="hidden"
        onChange={handleFileSelected}
      />

      {/* Identical snapshot */}
      <Dialog
        open={updateFlow.step === 'confirm' && updateFlow.status === 'identical'}
        onOpenChange={(open) => { if (!open) setUpdateFlow({ step: 'idle' }); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nothing to update</DialogTitle>
            <DialogDescription>
              This file matches your local copy. No changes were made.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setUpdateFlow({ step: 'idle' })}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clean update */}
      <Dialog
        open={updateFlow.step === 'confirm' && updateFlow.status === 'clean'}
        onOpenChange={(open) => { if (!open) setUpdateFlow({ step: 'idle' }); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update &ldquo;{series.name}&rdquo;?</DialogTitle>
            <DialogDescription>
              This file is a newer version of your local copy.{' '}
              {updateFlow.step === 'confirm' &&
                `Saved on ${new Date(updateFlow.file.exportedAt).toLocaleString()}.`}
              {' '}Your local copy will be replaced. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdateFlow({ step: 'idle' })}>
              Cancel
            </Button>
            <Button onClick={() => handleConfirmUpdate(false)}>Update</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diverged */}
      <Dialog
        open={updateFlow.step === 'confirm' && updateFlow.status === 'diverged'}
        onOpenChange={(open) => { if (!open) setUpdateFlow({ step: 'idle' }); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>⚠ This file conflicts with your local copy</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2">
                <p>
                  This file and your local copy appear to have diverged — both have changes
                  the other doesn&apos;t.
                </p>
                {updateFlow.step === 'confirm' && (
                  <div className="text-sm">
                    <p>This file: saved {new Date(updateFlow.file.exportedAt).toLocaleString()}</p>
                    <p>Local copy: last modified {formatTimestamp(series.lastModifiedAt)}</p>
                  </div>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdateFlow({ step: 'idle' })}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => handleConfirmUpdate(true)}>
              Open as a new copy
            </Button>
            <Button variant="destructive" onClick={() => handleConfirmUpdate(false)}>
              Replace local copy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Error */}
      <Dialog
        open={updateFlow.step === 'error'}
        onOpenChange={(open) => { if (!open) setUpdateFlow({ step: 'idle' }); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Could not open file</DialogTitle>
            <DialogDescription>
              {updateFlow.step === 'error' ? updateFlow.message : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setUpdateFlow({ step: 'idle' })}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
