'use client';

import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { seriesRepo, fleetRepo, raceRepo } from '@/lib/dexie-repository';
import { db } from '@/lib/db';
import type { CompetitorFieldKey } from '@/lib/types';
import { BasicsCard } from '@/components/series-settings/basics-card';
import { ScoringCard } from '@/components/series-settings/scoring-card';
import { FleetsCard } from '@/components/series-settings/fleets-card';
import { ALL_COMPETITOR_FIELDS, COMPETITOR_FIELD_LABELS, defaultEnabledCompetitorFields } from '@/lib/competitor-fields';
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
import type { Series } from '@/lib/types';

function ScoringModeCard({ seriesId, series }: { seriesId: string; series: Series }) {
  const [expanded, setExpanded] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockReason, setLockReason] = useState('');

  // Check if any race in the series has finishes — if so, scoring mode is locked
  useEffect(() => {
    (async () => {
      const races = await raceRepo.listBySeries(seriesId);
      if (races.length === 0) { setLocked(false); return; }
      const raceIds = races.map((r) => r.id);
      const finishes = await db.finishes.where('raceId').anyOf(raceIds).limit(1).toArray();
      if (finishes.length > 0) {
        setLocked(true);
        setLockReason('Scoring mode is locked because races have finishes. Remove all finishes to change it.');
      } else {
        setLocked(false);
      }
    })();
  }, [seriesId]);

  async function handleChange(mode: 'scratch' | 'handicap') {
    if (locked || mode === series.scoringMode) return;
    await db.series.update(seriesId, { scoringMode: mode });
    // When switching to scratch, reset all fleet scoring systems to scratch
    if (mode === 'scratch') {
      const fleets = await fleetRepo.listBySeries(seriesId);
      for (const f of fleets) {
        if (f.scoringSystem !== 'scratch') {
          await fleetRepo.save({ ...f, scoringSystem: 'scratch' });
        }
      }
    }
    await seriesRepo.touch(seriesId);
  }

  const summary = series.scoringMode === 'handicap'
    ? 'Handicap (time-corrected)'
    : 'Scratch (position-based)';

  return (
    <div className="border rounded-lg p-5 space-y-4">
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


function CompetitorFieldsCard({ seriesId, series }: { seriesId: string; series: Series }) {
  const [expanded, setExpanded] = useState(false);
  // Mirror the persisted array into local state so the checkbox updates
  // instantly on click — the async db.update that follows would otherwise
  // leave the controlled <input> at the old value until useLiveQuery reruns.
  const persisted = series.enabledCompetitorFields ?? defaultEnabledCompetitorFields();
  const [localEnabled, setLocalEnabled] = useState<CompetitorFieldKey[]>(persisted);
  useEffect(() => {
    setLocalEnabled(persisted);
  }, [persisted.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const enabledSet = new Set<CompetitorFieldKey>(localEnabled);

  async function toggle(field: CompetitorFieldKey, checked: boolean) {
    const next = new Set(enabledSet);
    if (checked) next.add(field); else next.delete(field);
    const nextArray = ALL_COMPETITOR_FIELDS.filter((f) => next.has(f));
    setLocalEnabled(nextArray);
    await db.series.update(seriesId, {
      enabledCompetitorFields: nextArray,
      lastModifiedAt: Date.now(),
    });
  }

  const shownLabels = ALL_COMPETITOR_FIELDS
    .filter((f) => enabledSet.has(f))
    .map((f) => COMPETITOR_FIELD_LABELS[f]);
  const summary = shownLabels.length === 0
    ? 'Only sail number and helm name'
    : `Sail, Helm, ${shownLabels.join(', ')}`;

  const fieldHints: Partial<Record<CompetitorFieldKey, string>> = {
    boatClass: 'Enable for PY fleets with mixed classes (Laser, Firefly, Mirror).',
    crewName: 'Enable for two-person classes (420, Fireball, GP14).',
  };

  return (
    <div className="border rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Competitor fields</h2>
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
          <p className="text-xs text-muted-foreground">
            Sail number and helm name are always shown. Toggle the optional fields you want
            displayed in the competitor list, standings, and exported results.
          </p>
          <div className="space-y-2">
            {ALL_COMPETITOR_FIELDS.map((field) => (
              <div key={field} className="flex items-start gap-2.5">
                <input
                  id={`field-${field}`}
                  type="checkbox"
                  checked={enabledSet.has(field)}
                  onChange={(e) => toggle(field, e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <div>
                  <label htmlFor={`field-${field}`} className="text-sm font-medium cursor-pointer">
                    {COMPETITOR_FIELD_LABELS[field]}
                  </label>
                  {fieldHints[field] && (
                    <p className="text-xs text-muted-foreground mt-0.5">{fieldHints[field]}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => setExpanded(false)}>
            Done
          </Button>
        </div>
      )}
    </div>
  );
}

function PublishingCard({ seriesId, series, anyNhcFleet }: { seriesId: string; series: Series; anyNhcFleet: boolean }) {
  const [expanded, setExpanded] = useState(false);

  const includeJson = series.includeJsonExport ?? true;
  const publishRatingCalcs = series.publishRatingCalculations ?? true;
  const summaryParts = [
    includeJson ? 'JSON export included' : 'JSON export excluded',
    ...(anyNhcFleet ? [publishRatingCalcs ? 'rating calculations published' : 'rating calculations hidden'] : []),
  ];
  const summary = summaryParts.join(' · ');

  return (
    <div className="border rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Publishing</h2>
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
          <div className="flex items-start gap-2.5">
            <input
              id="includeJsonExport"
              type="checkbox"
              checked={includeJson}
              onChange={(e) => {
                db.series.update(seriesId, { includeJsonExport: e.target.checked });
              }}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <div>
              <label htmlFor="includeJsonExport" className="text-sm font-medium cursor-pointer">
                Include data export in published results
              </label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Embeds a JSON snapshot of the results in every exported HTML file, with a
                &ldquo;Download results (JSON)&rdquo; link in the footer. Disable if you prefer
                to share results without the underlying data.
              </p>
            </div>
          </div>
          {anyNhcFleet && (
            <div className="flex items-start gap-2.5">
              <input
                id="publishRatingCalculations"
                type="checkbox"
                checked={publishRatingCalcs}
                onChange={(e) => {
                  db.series.update(seriesId, { publishRatingCalculations: e.target.checked });
                }}
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <div>
                <label htmlFor="publishRatingCalculations" className="text-sm font-medium cursor-pointer">
                  Publish NHC rating calculations alongside results
                </label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Adds per-race rating-calculation columns (CT ratio, Fair TCF, Adjustment, New TCF)
                  and a fleet header line so competitors can verify each new TCF with a calculator.
                  The rating, finish, elapsed, and corrected-time columns are always shown.
                </p>
              </div>
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => setExpanded(false)}>
            Done
          </Button>
        </div>
      )}
    </div>
  );
}

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
  const fleets = useLiveQuery(() => fleetRepo.listBySeries(seriesId), [seriesId]) ?? [];
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [updateFlow, setUpdateFlow] = useState<UpdateFlow>({ step: 'idle' });

  if (series === undefined) return <p className="text-muted-foreground">Loading…</p>;
  if (series === null) return <p className="text-muted-foreground">Series not found.</p>;

  const anyNhcFleet = fleets.some((f) => f.scoringSystem === 'nhc');

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

      <BasicsCard
        value={series}
        onChange={async (patch) => {
          const trimmed: typeof patch = { ...patch };
          await db.series.update(seriesId, { ...trimmed, lastModifiedAt: Date.now() });
        }}
      />
      <ScoringModeCard seriesId={seriesId} series={series} />
      <FleetsCard seriesId={seriesId} series={series} />
      <ScoringCard
        value={series}
        onChange={async (patch) => {
          await db.series.update(seriesId, { ...patch, lastModifiedAt: Date.now() });
        }}
      />
      <CompetitorFieldsCard seriesId={seriesId} series={series} />
      <PublishingCard seriesId={seriesId} series={series} anyNhcFleet={anyNhcFleet} />

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
