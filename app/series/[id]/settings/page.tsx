'use client';

import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import * as repos from '@/lib/api-repository';
import {
  useSeries,
  useArchiveSeries,
  useDeleteSeriesCascade,
  useTouchSeries,
  useUpdateSeries,
} from '@/hooks/use-series';
import { useFleetsBySeries, useSaveFleet } from '@/hooks/use-fleets';
import { queryKeys } from '@/hooks/query-keys';
import { isDuplicateSeriesName } from '@/lib/series-name';
import type { CompetitorFieldKey, PrimaryPersonLabel } from '@/lib/types';
import { BasicsCard } from '@/components/series-settings/basics-card';
import { ScoringCard } from '@/components/series-settings/scoring-card';
import { FleetsCard } from '@/components/series-settings/fleets-card';
import { CopySeriesToWorkspaceCard } from '@/components/copy-series-to-workspace-card';
import {
  ALL_COMPETITOR_FIELDS,
  COMPETITOR_FIELD_LABELS,
  DEFAULT_PRIMARY_PERSON_LABEL,
  DEFAULT_SUBDIVISION_LABEL,
  PRIMARY_PERSON_LABELS,
  PRIMARY_PERSON_LABEL_TEXT,
  PRIMARY_PERSON_LABEL_HINTS,
  SUBDIVISION_LABEL_PRESETS,
  SUBDIVISION_LABEL_MAX_LENGTH,
  defaultEnabledCompetitorFields,
  isFieldDisabledByPrimary,
} from '@/lib/competitor-fields';
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
  const { raceRepo, finishRepo, fleetRepo } = repos;
  const updateSeries = useUpdateSeries();
  const touchSeries = useTouchSeries();
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
    await updateSeries.mutateAsync({ id: seriesId, patch: { scoringMode: mode } });
    // When switching to scratch, reset all fleet scoring systems to scratch
    if (mode === 'scratch') {
      const fleets = await fleetRepo.listBySeries(seriesId);
      for (const f of fleets) {
        if (f.scoringSystem !== 'scratch') {
          await saveFleet.mutateAsync({ ...f, scoringSystem: 'scratch' });
        }
      }
    }
    await touchSeries.mutateAsync(seriesId);
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
  const updateSeries = useUpdateSeries();
  const [expanded, setExpanded] = useState(false);
  // Mirror the persisted array into local state so the checkbox updates
  // instantly on click — the async save that follows would otherwise leave
  // the controlled <input> at the old value until the query refetches.
  const persisted = series.enabledCompetitorFields ?? defaultEnabledCompetitorFields();
  const primaryLabel: PrimaryPersonLabel = series.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL;
  const [localEnabled, setLocalEnabled] = useState<CompetitorFieldKey[]>(persisted);
  // Re-sync when the persisted fields actually change. Render-time compare
  // (not an effect) so this works cleanly with the React Compiler. See
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const persistedKey = persisted.join(',');
  const [prevPersistedKey, setPrevPersistedKey] = useState(persistedKey);
  if (prevPersistedKey !== persistedKey) {
    setPrevPersistedKey(persistedKey);
    setLocalEnabled(persisted);
  }
  const enabledSet = new Set<CompetitorFieldKey>(localEnabled);

  // Subdivision label, mirrored locally so the text input stays responsive
  // while the controlled value catches up to the async save (same pattern as
  // the enabled-fields array above).
  const persistedSubdivisionLabel = series.subdivisionLabel ?? DEFAULT_SUBDIVISION_LABEL;
  const [localSubdivisionLabel, setLocalSubdivisionLabel] = useState(persistedSubdivisionLabel);
  const [prevSubdivisionLabel, setPrevSubdivisionLabel] = useState(persistedSubdivisionLabel);
  if (prevSubdivisionLabel !== persistedSubdivisionLabel) {
    setPrevSubdivisionLabel(persistedSubdivisionLabel);
    setLocalSubdivisionLabel(persistedSubdivisionLabel);
  }

  async function toggle(field: CompetitorFieldKey, checked: boolean) {
    const next = new Set(enabledSet);
    if (checked) next.add(field); else next.delete(field);
    const nextArray = ALL_COMPETITOR_FIELDS.filter((f) => next.has(f));
    setLocalEnabled(nextArray);
    await updateSeries.mutateAsync({
      id: seriesId,
      patch: {
        enabledCompetitorFields: nextArray,
        // eslint-disable-next-line react-hooks/purity -- Date.now() runs inside an async event handler, not render.
        lastModifiedAt: Date.now(),
      },
    });
  }

  async function changePrimary(label: PrimaryPersonLabel) {
    await updateSeries.mutateAsync({
      id: seriesId,
      patch: {
        primaryPersonLabel: label,
        // eslint-disable-next-line react-hooks/purity -- Date.now() runs inside an async event handler, not render.
        lastModifiedAt: Date.now(),
      },
    });
  }

  // Commit a subdivision label. Empty/whitespace falls back to the default so
  // the field always has a usable heading. No-op when nothing changed.
  async function commitSubdivisionLabel(raw: string) {
    const trimmed = raw.trim().slice(0, SUBDIVISION_LABEL_MAX_LENGTH) || DEFAULT_SUBDIVISION_LABEL;
    setLocalSubdivisionLabel(trimmed);
    if (trimmed === persistedSubdivisionLabel) return;
    await updateSeries.mutateAsync({
      id: seriesId,
      patch: {
        subdivisionLabel: trimmed,
        lastModifiedAt: Date.now(),
      },
    });
  }

  const primaryFieldLabel = PRIMARY_PERSON_LABEL_TEXT[primaryLabel];
  // The subdivision field's heading is the scorer-chosen label; every other
  // field uses its static label.
  const fieldDisplayLabel = (f: CompetitorFieldKey) =>
    f === 'subdivision' ? localSubdivisionLabel : COMPETITOR_FIELD_LABELS[f];
  const shownLabels = ALL_COMPETITOR_FIELDS
    .filter((f) => enabledSet.has(f) && !isFieldDisabledByPrimary(f, primaryLabel))
    .map((f) => fieldDisplayLabel(f));
  const summary = shownLabels.length === 0
    ? `Only sail number and ${primaryFieldLabel.toLowerCase()}`
    : `Sail, ${primaryFieldLabel}, ${shownLabels.join(', ')}`;

  const fieldHints: Partial<Record<CompetitorFieldKey, string>> = {
    boatClass: 'Enable for PY fleets with mixed classes (Laser, Firefly, Mirror).',
    crewName: 'Enable for two-person classes (420, Fireball, GP14).',
    helm: 'Record the helm separately when the primary identifier is not the helm.',
    owner: 'Record the owner separately when the primary identifier is not the owner.',
    subdivision: 'A prize-giving subdivision within a fleet (e.g. Gold/Silver/Bronze, or age categories). Not used for scoring.',
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
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Tip: when you import a CSV, the wizard proposes these settings automatically.
            Most scorers won’t need to configure this by hand.
          </p>
          <div className="space-y-2">
            <p className="text-sm font-medium">Primary identifier</p>
            <p className="text-xs text-muted-foreground">
              The required name on every competitor. Shown as a column heading throughout results.
            </p>
            <div className="space-y-1.5">
              {PRIMARY_PERSON_LABELS.map((label) => (
                <label key={label} className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="radio"
                    name="primaryPersonLabel"
                    value={label}
                    checked={primaryLabel === label}
                    onChange={() => changePrimary(label)}
                    className="mt-0.5 h-4 w-4 shrink-0"
                  />
                  <div>
                    <span className="text-sm font-medium">{PRIMARY_PERSON_LABEL_TEXT[label]}</span>
                    <p className="text-xs text-muted-foreground mt-0.5">{PRIMARY_PERSON_LABEL_HINTS[label]}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-2 pt-2 border-t">
            <p className="text-sm font-medium">Optional fields</p>
            <p className="text-xs text-muted-foreground">
              Toggle the optional fields you want displayed in the competitor list, standings, and exported results.
            </p>
            {ALL_COMPETITOR_FIELDS.map((field) => {
              const disabledByPrimary = isFieldDisabledByPrimary(field, primaryLabel);
              return (
                <div
                  key={field}
                  className={`flex items-start gap-2.5 ${disabledByPrimary ? 'opacity-50' : ''}`}
                >
                  <input
                    id={`field-${field}`}
                    type="checkbox"
                    checked={enabledSet.has(field) && !disabledByPrimary}
                    onChange={(e) => toggle(field, e.target.checked)}
                    disabled={disabledByPrimary}
                    className="mt-0.5 h-4 w-4 shrink-0"
                  />
                  <div>
                    <label htmlFor={`field-${field}`} className="text-sm font-medium cursor-pointer">
                      {fieldDisplayLabel(field)}
                    </label>
                    {disabledByPrimary ? (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Already the primary identifier.
                      </p>
                    ) : fieldHints[field] ? (
                      <p className="text-xs text-muted-foreground mt-0.5">{fieldHints[field]}</p>
                    ) : null}
                  </div>
                </div>
              );
            })}
            {enabledSet.has('subdivision') && (
              <div className="ml-6 mt-1 space-y-1.5 border-l pl-3">
                <Label htmlFor="subdivision-label" className="text-sm font-medium">
                  Subdivision label
                </Label>
                <p className="text-xs text-muted-foreground">
                  What to call this field in the competitor list, standings, and results.
                </p>
                <Input
                  id="subdivision-label"
                  value={localSubdivisionLabel}
                  maxLength={SUBDIVISION_LABEL_MAX_LENGTH}
                  onChange={(e) => setLocalSubdivisionLabel(e.target.value)}
                  onBlur={(e) => commitSubdivisionLabel(e.target.value)}
                  className="max-w-xs"
                />
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {SUBDIVISION_LABEL_PRESETS.map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      variant={localSubdivisionLabel === preset ? 'secondary' : 'outline'}
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => commitSubdivisionLabel(preset)}
                    >
                      {preset}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => setExpanded(false)}>
            Done
          </Button>
        </div>
      )}
    </div>
  );
}

function PublishingCard({ seriesId, series, anyProgressiveFleet }: { seriesId: string; series: Series; anyProgressiveFleet: boolean }) {
  const updateSeries = useUpdateSeries();
  const [expanded, setExpanded] = useState(false);

  const includeJson = series.includeJsonExport ?? true;
  const publishRatingCalcs = series.publishRatingCalculations ?? true;
  const showPerRaceRatings = series.showPerRaceRatingsInSummary ?? true;
  const summaryParts = [
    includeJson ? 'JSON export included' : 'JSON export excluded',
    ...(anyProgressiveFleet
      ? [
          publishRatingCalcs ? 'rating calculations published' : 'rating calculations hidden',
          showPerRaceRatings ? 'per-race ratings shown in summary' : 'per-race ratings hidden in summary',
        ]
      : []),
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
                updateSeries.mutate({ id: seriesId, patch: { includeJsonExport: e.target.checked } });
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
          {anyProgressiveFleet && (
            <div className="flex items-start gap-2.5">
              <input
                id="publishRatingCalculations"
                type="checkbox"
                checked={publishRatingCalcs}
                onChange={(e) => {
                  updateSeries.mutate({ id: seriesId, patch: { publishRatingCalculations: e.target.checked } });
                }}
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <div>
                <label htmlFor="publishRatingCalculations" className="text-sm font-medium cursor-pointer">
                  Publish progressive rating calculations alongside results
                </label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Adds per-race rating-calculation columns and a brief explainer so competitors can
                  verify each rating update with a calculator. NHC fleets get CT ratio, Fair TCF,
                  and Adjustment; ECHO fleets get 1/T_E, PI, and Adjustment. The rating, finish,
                  elapsed, corrected-time, and next-rating columns are always shown.
                </p>
              </div>
            </div>
          )}
          {anyProgressiveFleet && (
            <div className="flex items-start gap-2.5">
              <input
                id="showPerRaceRatingsInSummary"
                type="checkbox"
                checked={showPerRaceRatings}
                onChange={(e) => {
                  updateSeries.mutate({ id: seriesId, patch: { showPerRaceRatingsInSummary: e.target.checked } });
                }}
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <div>
                <label htmlFor="showPerRaceRatingsInSummary" className="text-sm font-medium cursor-pointer">
                  Show per-race ratings in summary table
                </label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  For NHC and ECHO fleets, adds a seed-rating column to the summary table and
                  prints the applied rating in small text beneath each score from race 2 onwards.
                  Race 1&rsquo;s rating is the seed, shown in the dedicated column.
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

/**
 * Series lifecycle (#154). Archiving makes the series read-only and collapses
 * it into the home Archived section; delete is gated behind archiving first
 * (the server enforces this too), so the destructive action takes two
 * deliberate steps.
 */
function ArchiveCard({ seriesId, series }: { seriesId: string; series: Series }) {
  const router = useRouter();
  const archiveSeries = useArchiveSeries();
  const deleteCascade = useDeleteSeriesCascade();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const archived = series.archived ?? false;

  async function handleDelete() {
    setConfirmDelete(false);
    await deleteCascade.mutateAsync(seriesId);
    router.push('/');
  }

  return (
    <div className="border rounded-lg p-5 space-y-4">
      <div>
        <h2 className="text-sm font-medium">Archive</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          {archived
            ? 'This series is archived and read-only. Unarchive it to edit, or delete it permanently.'
            : 'Archiving moves this series into the Archived section and makes it read-only. You can unarchive at any time.'}
        </p>
      </div>
      <div className="flex gap-2">
        {archived ? (
          <>
            <Button
              variant="outline"
              disabled={archiveSeries.isPending}
              onClick={() => archiveSeries.mutate({ id: seriesId, archived: false })}
            >
              <ArchiveRestore className="h-4 w-4" />
              Unarchive
            </Button>
            <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" />
              Delete series
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            disabled={archiveSeries.isPending}
            onClick={() => archiveSeries.mutate({ id: seriesId, archived: true })}
          >
            <Archive className="h-4 w-4" />
            Archive series
          </Button>
        )}
      </div>
      {!archived && (
        <p className="text-xs text-muted-foreground">
          A series must be archived before it can be deleted.
        </p>
      )}

      <Dialog open={confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{series.name}&rdquo;?</DialogTitle>
            <DialogDescription>
              This permanently deletes the series and all its competitors,
              races, and results. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete series
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function SettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: seriesId } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { listSeriesNames } = repos;
  const { data: series, isLoading } = useSeries(seriesId);
  const { data: fleetsData } = useFleetsBySeries(seriesId);
  const fleets = fleetsData ?? [];
  const updateSeries = useUpdateSeries();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [updateFlow, setUpdateFlow] = useState<UpdateFlow>({ step: 'idle' });

  if (isLoading || series === undefined) return <p className="text-muted-foreground">Loading…</p>;
  if (series === null) return <p className="text-muted-foreground">Series not found.</p>;

  const anyProgressiveFleet = fleets.some((f) => f.scoringSystem === 'nhc' || f.scoringSystem === 'echo');

  const hasFileHistory = series.lastSnapshotId !== null;
  const isModified =
    series.lastSavedAt !== null && series.lastModifiedAt > series.lastSavedAt;

  async function handleSaveToFile() {
    setSaving(true);
    try {
      await saveSeriesFile(seriesId, repos);
      // saveSeriesFile writes lastSnapshotId / lastSavedAt directly via
      // the seriesRepo, bypassing the React Query cache. Force a refetch
      // so the file card reflects the new state and the "Update from File"
      // button becomes visible.
      await queryClient.invalidateQueries({ queryKey: queryKeys.series.detail(seriesId) });
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
            'This file is for a different series. Use "Import Series" on the home screen to open it as a new series.',
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
        const newId = await openSeriesFromFile(file, repos);
        await queryClient.invalidateQueries({ queryKey: queryKeys.series.list() });
        router.push(`/series/${newId}/races`);
      } else {
        await updateSeriesFromFile(seriesId, file, repos);
        // updateSeriesFromFile bypasses the React Query cache. The series
        // row keeps its id so invalidate is fine, but every child entity
        // (fleets, competitors, races, race-starts, finishes) is reissued
        // a fresh UUID inside writeFleetsCompetitorsRaces. Plain
        // invalidate leaves the stale OLD lists in cache; the next page
        // mount renders them stale-while-revalidate, then the components
        // fetch by-OLD-id child queries that 404 because the old rows
        // are gone. removeQueries forces the next mount to fetch fresh.
        await queryClient.invalidateQueries({ queryKey: queryKeys.series.detail(seriesId) });
        await queryClient.invalidateQueries({ queryKey: queryKeys.series.list() });
        queryClient.removeQueries({ queryKey: queryKeys.fleets.all });
        queryClient.removeQueries({ queryKey: queryKeys.competitors.all });
        queryClient.removeQueries({ queryKey: queryKeys.races.all });
        queryClient.removeQueries({ queryKey: queryKeys.finishes.all });
        queryClient.removeQueries({ queryKey: queryKeys.raceStarts.all });
        router.push(`/series/${seriesId}/races`);
      }
    } catch (err) {
      console.error(err);
      setUpdateFlow({ step: 'error', message: 'Failed to update series. Please try again.' });
    }
  }

  return (
    <div className="space-y-6 max-w-lg">
      <ArchiveCard seriesId={seriesId} series={series} />
      <CopySeriesToWorkspaceCard seriesId={seriesId} seriesName={series.name} />
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
          {hasFileHistory && !series.archived && (
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

      {/* Editing cards are hidden while archived — the series is read-only,
          and these auto-save (which the server would reject). Unarchive from
          the card above to edit. Copy-to-workspace and Save-to-file stay
          available because they don't mutate the series. (#154) */}
      {!series.archived && (
        <>
          <BasicsCard
            value={series}
            includeName
            validateName={async (name) => {
              const trimmed = name.trim();
              if (!trimmed) return 'Series name is required.';
              const existing = await listSeriesNames({ excludeId: seriesId });
              return isDuplicateSeriesName(trimmed, existing)
                ? 'A series with this name already exists.'
                : null;
            }}
            onChange={async (patch) => {
              await updateSeries.mutateAsync({
                id: seriesId,
                patch: { ...patch, lastModifiedAt: Date.now() },
              });
            }}
          />
          <ScoringModeCard seriesId={seriesId} series={series} />
          <FleetsCard seriesId={seriesId} series={series} />
          <ScoringCard
            value={series}
            onChange={async (patch) => {
              await updateSeries.mutateAsync({
                id: seriesId,
                patch: { ...patch, lastModifiedAt: Date.now() },
              });
            }}
          />
          <CompetitorFieldsCard seriesId={seriesId} series={series} />
          <PublishingCard seriesId={seriesId} series={series} anyProgressiveFleet={anyProgressiveFleet} />
        </>
      )}

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
