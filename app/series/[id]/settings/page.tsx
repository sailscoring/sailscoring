'use client';

import { use, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import * as repos from '@/lib/api-repository';
import { useSeries, useUpdateSeries } from '@/hooks/use-series';
import { useFleetsBySeries } from '@/hooks/use-fleets';
import { queryKeys } from '@/hooks/query-keys';
import { isDuplicateSeriesName } from '@/lib/series-name';
import { formatDayStamp } from '@/lib/format-date';
import { BasicsCard } from '@/components/series-settings/basics-card';
import { ScoringCard } from '@/components/series-settings/scoring-card';
import { FleetsCard } from '@/components/series-settings/fleets-card';
import { ScoringModeCard } from '@/components/series-settings/scoring-mode-card';
import { CompetitorFieldsCard } from '@/components/series-settings/competitor-fields-card';
import { PublishingCard } from '@/components/series-settings/publishing-card';
import { ArchiveCard } from '@/components/series-settings/archive-card';
import { CopySeriesToWorkspaceCard } from '@/components/copy-series-to-workspace-card';
import { Button } from '@/components/ui/button';
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
  openSeriesFromFile,
  updateSeriesFromFile,
  type SeriesFile,
} from '@/lib/series-file';
import { parseSailwaveBlw, SailwaveImportError } from '@/lib/sailwave-import';
import { SAILWAVE_HANDOFF_KEY } from '@/app/series/import-sailwave/page';
import { useFeatures } from '@/components/features-provider';
import type { Series } from '@/lib/types';
import { SeriesTabFallback } from '@/components/series-tab-fallback';


type UpdateFlow =
  | { step: 'idle' }
  | { step: 'confirm'; file: SeriesFile }
  | { step: 'working' }
  | { step: 'error'; message: string };

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
  const { has } = useFeatures();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sailwaveInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [updateFlow, setUpdateFlow] = useState<UpdateFlow>({ step: 'idle' });

  if (isLoading || series === undefined) return <SeriesTabFallback status="loading" />;
  if (series === null) return <SeriesTabFallback status="missing" />;

  const anyProgressiveFleet = fleets.some((f) => f.scoringSystem === 'nhc' || f.scoringSystem === 'echo');

  const isModified =
    series.lastSavedAt !== null && series.lastModifiedAt > series.lastSavedAt;

  async function handleSaveToFile() {
    setSaving(true);
    try {
      await saveSeriesFile(seriesId, repos);
      // saveSeriesFile writes lastSavedAt directly via the seriesRepo,
      // bypassing the React Query cache. Force a refetch so the file card
      // reflects the new "Last saved" state.
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

  function handleUpdateFromSailwave() {
    sailwaveInputRef.current?.click();
  }

  // Re-import over this series from a fresh Sailwave export. Parse here, then
  // hand the wizard the raw data plus this series id so it runs in update mode
  // (retain identity + publishing config, replace the competition data).
  async function handleSailwaveSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const bytes = await file.arrayBuffer();
      const raw = parseSailwaveBlw(bytes);
      sessionStorage.setItem(
        SAILWAVE_HANDOFF_KEY,
        JSON.stringify({ fileName: file.name, raw, updateSeriesId: seriesId }),
      );
      router.push('/series/import-sailwave');
    } catch (err) {
      setUpdateFlow({
        step: 'error',
        message:
          err instanceof SailwaveImportError
            ? err.message
            : `Could not read Sailwave file: ${(err as Error).message}`,
      });
    }
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

      setUpdateFlow({ step: 'confirm', file: parsed });
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
      <div className={`bg-card border rounded-lg p-5 space-y-4 ${!series.lastSavedAt ? 'opacity-70' : ''}`}>
        <div>
          <h2 className="text-sm font-medium">File</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {series.lastSavedAt
              ? <>Last saved: {formatDayStamp(series.lastSavedAt)}{isModified && <span className="ml-2 text-amber-600 dark:text-amber-400">· modified since last save</span>}</>
              : 'Not saved to file'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSaveToFile} disabled={saving} variant="outline">
            {saving ? 'Saving…' : 'Save to File'}
          </Button>
          {!series.archived && (
            <Button onClick={handleUpdateFromFile} variant="outline">
              Update from File
            </Button>
          )}
          {/* Re-import over a Sailwave-born series. Independent of the
              .sailscoring file history above — a Sailwave import may never have
              been saved to a file. (#155 feature-gated.) */}
          {series.source === 'sailwave' && has('sailwave-import') && !series.archived && (
            <Button
              onClick={handleUpdateFromSailwave}
              variant="outline"
              data-testid="update-from-sailwave"
            >
              Update from Sailwave file
            </Button>
          )}
        </div>
        {!series.lastSavedAt && (
          <p className="text-xs text-muted-foreground">
            Save to a file to share this series with co-scorers or back it up.
          </p>
        )}
        {series.source === 'sailwave' && has('sailwave-import') && !series.archived && (
          <p className="text-xs text-muted-foreground">
            This series was imported from Sailwave. &ldquo;Update from Sailwave
            file&rdquo; replaces its competitors, fleets, races and results from
            a fresh export, keeping the name, venue, competitor fields and
            publishing destination.
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
      <input
        ref={sailwaveInputRef}
        type="file"
        accept=".blw"
        className="hidden"
        data-testid="update-from-sailwave-input"
        onChange={handleSailwaveSelected}
      />

      {/* Confirm update from file */}
      <Dialog
        open={updateFlow.step === 'confirm'}
        onOpenChange={(open) => { if (!open) setUpdateFlow({ step: 'idle' }); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update &ldquo;{series.name}&rdquo; from file?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Your workspace copy will be replaced with the contents of this file.
                  This cannot be undone.
                </p>
                {updateFlow.step === 'confirm' && (
                  <div className="text-sm">
                    <p>This file: saved {new Date(updateFlow.file.exportedAt).toLocaleString()}</p>
                    <p>Workspace copy: last modified {formatDayStamp(series.lastModifiedAt)}</p>
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
            <Button onClick={() => handleConfirmUpdate(false)}>Update</Button>
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
