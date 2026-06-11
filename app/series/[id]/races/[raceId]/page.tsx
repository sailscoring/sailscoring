'use client';

import { use, useState, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { RowConflictDialog } from '@/components/row-conflict-dialog';
import { useFinishConflictDialog } from '@/hooks/use-finish-conflict-dialog';
import { useFinishInput } from '@/hooks/use-finish-input';
import { useFinishRowOps } from '@/hooks/use-finish-row-ops';
import { useStartCheckIn } from '@/hooks/use-start-check-in';
import { useSeries } from '@/hooks/use-series';
import { useCompetitorsBySeries } from '@/hooks/use-competitors';
import { useFleetsBySeries } from '@/hooks/use-fleets';
import { useRace, useRacesBySeries, useSaveRace } from '@/hooks/use-races';
import { useSeriesReadOnly } from '@/components/series-read-only';
import {
  useDeleteFinish,
  useFinishCachePatch,
  useFinishesByRace,
  useSaveFinish,
  useSaveFinishes,
} from '@/hooks/use-finishes';
import { useRaceStartsByRace } from '@/hooks/use-race-starts';
import {
  defaultEnabledCompetitorFields,
  DEFAULT_PRIMARY_PERSON_LABEL,
  PRIMARY_PERSON_LABEL_TEXT,
} from '@/lib/competitor-fields';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  deriveFinishState,
  deriveNonFinishers,
  finishedCompetitorIds,
} from '@/lib/finish-entry';
import { useCsvFinishImport } from '@/hooks/use-csv-finish-import';
import { isInputFocused, useGlobalKeyDown, useShortcutHelp } from '@/hooks/use-keyboard-shortcut';
import { useFeatures } from '@/components/features-provider';
import { type FinishSheetImportHandle } from '@/components/finish-sheet-import';
import { RaceEntryHeader } from '@/components/race-entry/race-entry-header';
import { RaceEntryTabs } from '@/components/race-entry/race-entry-tabs';
import {
  RaceStartsSection,
  type RaceStartsSectionHandle,
} from '@/components/race-entry/race-starts-section';
import {
  PenaltyEditorController,
  type PenaltyEditorHandle,
} from '@/components/race-entry/penalty-editor-controller';
import {
  RedressController,
  type RedressControllerHandle,
} from '@/components/race-entry/redress-controller';
import {
  ResolveUnknownController,
  type ResolveUnknownHandle,
} from '@/components/race-entry/resolve-unknown-controller';
import { CheckInTab } from '@/components/check-in-tab';
import { FinishTab } from '@/components/finish-tab';
import { RatingsTab } from '@/components/ratings-tab';
import { SeriesTabFallback } from '@/components/series-tab-fallback';

export default function ResultEntryPage({
  params,
}: {
  params: Promise<{ id: string; raceId: string }>;
}) {
  const { id: seriesId, raceId } = use(params);
  const router = useRouter();

  const { data: competitors } = useCompetitorsBySeries(seriesId);
  const { data: series } = useSeries(seriesId);
  const enabledCompetitorFields =
    series?.enabledCompetitorFields ?? defaultEnabledCompetitorFields();
  const showCrew = enabledCompetitorFields.includes('crewName');
  const primaryFieldLabel =
    PRIMARY_PERSON_LABEL_TEXT[series?.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL];
  const { data: race } = useRace(raceId);
  const { data: savedFinishes } = useFinishesByRace(raceId);
  const { data: fleets } = useFleetsBySeries(seriesId);
  const { data: allSeriesRaces } = useRacesBySeries(seriesId);
  const { data: raceStartsData } = useRaceStartsByRace(raceId);
  const raceStarts = raceStartsData ?? [];

  const saveFinish = useSaveFinish();
  const saveFinishes = useSaveFinishes();
  const deleteFinish = useDeleteFinish();
  const saveRace = useSaveRace();
  const readOnly = useSeriesReadOnly();
  const patchCache = useFinishCachePatch(raceId);

  // Source of truth: every visible "view model" derives from savedFinishes.
  // No parallel useState collections + Save button — each interaction writes
  // through to the server immediately (ADR-008 Phase 6).
  const derived = useMemo(
    () => deriveFinishState(savedFinishes ?? []),
    [savedFinishes],
  );
  const { finishingOrder, finishByCompetitorId } = derived;

  const { has } = useFeatures();
  const [activeTab, setActiveTab] = useState<'finish' | 'checkin' | 'ratings'>('finish');
  const finishSheetImportRef = useRef<FinishSheetImportHandle>(null);
  const startsRef = useRef<RaceStartsSectionHandle>(null);
  const penaltyRef = useRef<PenaltyEditorHandle>(null);
  const redressRef = useRef<RedressControllerHandle>(null);
  const resolveRef = useRef<ResolveUnknownHandle>(null);

  const conflictDialog = useFinishConflictDialog({
    raceId,
    competitors,
    finishingOrder,
    saveFinish,
    deleteFinish,
  });

  const fleetById = new Map((fleets ?? []).map((f) => [f.id, f]));
  const isHandicapSeries = series?.scoringMode === 'handicap';

  const finishedIds = finishedCompetitorIds(finishingOrder);
  const nonFinishers = deriveNonFinishers(
    competitors ?? [],
    finishedIds,
    derived.nonFinisherCodes,
    savedFinishes,
  );

  const rowOps = useFinishRowOps({
    raceId,
    derived,
    saveFinish,
    deleteFinish,
    patchCache,
  });
  const finishInput = useFinishInput({
    raceId,
    isHandicapSeries,
    competitors: competitors ?? [],
    fleetById,
    raceStarts,
    derived,
    nonFinishers,
    finishedIds,
    saveFinish,
    patchCache,
    commitOrderChange: rowOps.commitOrderChange,
    flashRow: rowOps.flashRow,
    ready: race != null && competitors != null,
  });

  const { presentCount, effectivelyPresent, toggleStartPresent } = useStartCheckIn({
    raceId,
    competitors: competitors ?? [],
    savedFinishes,
    finishedIds,
    saveFinish,
    deleteFinish,
  });

  const applyCsvImport = useCsvFinishImport({
    raceId,
    savedFinishes,
    saveFinishes,
    deleteFinish,
    patchCache,
    onApplied: finishInput.reset,
  });

  // No isDirty / leave-confirm — every interaction persists immediately.
  function leave() {
    router.push(`/series/${seriesId}/races`);
  }

  // Esc to leave; c to toggle check-in tab; s to add a start; i to import.
  // A raw handler rather than useShortcuts: the conditions mix tab state,
  // fleet shape, and feature gates per key. The help rows register below.
  useGlobalKeyDown((e) => {
    if (e.key === 'Escape' && !isInputFocused()) {
      e.preventDefault();
      leave();
    } else if (e.key === 'c' && !isInputFocused()) {
      e.preventDefault();
      setActiveTab((t) => t === 'checkin' ? 'finish' : 'checkin');
    } else if (
      e.key === 's' &&
      !isInputFocused() &&
      fleets?.some((f) => f.scoringSystem !== 'scratch')
    ) {
      e.preventDefault();
      startsRef.current?.openAddStart();
    } else if (
      e.key === 'i' &&
      has('csv-finish-import') &&
      !isInputFocused() &&
      activeTab === 'finish'
    ) {
      e.preventDefault();
      finishSheetImportRef.current?.trigger();
    }
  });
  useShortcutHelp([
    { key: '↑', displayKeys: ['↑', '↓'], description: 'Navigate autocomplete', section: 'Finish entry' },
    { key: '↵', description: 'Confirm / add finisher (or record as unknown)', section: 'Finish entry' },
    { key: 'Esc', description: 'Clear input or go back', section: 'Finish entry' },
    { key: 'Tab', description: 'Move between fields', section: 'Finish entry' },
    { key: 'c', description: 'Toggle start check-in tab', section: 'Finish entry' },
    ...(has('csv-finish-import')
      ? [{ key: 'i', description: 'Import finish sheet from CSV', section: 'Finish entry' }]
      : []),
    { key: 's', description: 'Add start (handicap series only)', section: 'Finish entry' },
  ]);

  if (race === undefined || competitors === undefined) {
    return <SeriesTabFallback status="loading" />;
  }
  if (race === null) {
    return <p className="text-muted-foreground">Race not found.</p>;
  }

  const competitorMap = new Map(competitors.map((c) => [c.id, c]));
  const showFleetBadge = (fleets ?? []).length > 1 || (fleets ?? []).some((f) => f.name !== 'Default');

  const unknownCount = finishingOrder.filter((e) => e.kind === 'unknown').length;

  const isSaving =
    saveFinish.isPending || saveFinishes.isPending || deleteFinish.isPending;

  return (
    <div className="space-y-6">
      <RaceEntryHeader
        race={race}
        readOnly={readOnly}
        onSaveDate={async (date) => {
          await saveRace.mutateAsync({ ...race, date });
        }}
        isSaving={isSaving}
      />

      <RaceEntryTabs
        activeTab={activeTab}
        onSelect={setActiveTab}
        presentCount={presentCount}
        showRatings={isHandicapSeries}
      />

      {activeTab === 'checkin' && (
        <div className="bg-card border rounded-lg p-5">
        <CheckInTab
          competitors={competitors}
          showCrew={showCrew}
          enabledCompetitorFields={enabledCompetitorFields}
          presentCount={presentCount}
          effectivelyPresent={effectivelyPresent}
          toggleStartPresent={toggleStartPresent}
        />
        </div>
      )}

      {activeTab === 'ratings' && (
        <div className="bg-card border rounded-lg p-5">
        <RatingsTab
          seriesId={seriesId}
          raceId={raceId}
          competitors={competitors}
          fleets={fleets ?? []}
        />
        </div>
      )}

      <RaceStartsSection
        ref={startsRef}
        raceId={raceId}
        raceStarts={raceStarts}
        fleets={fleets ?? []}
        fleetById={fleetById}
        visible={activeTab === 'finish' && isHandicapSeries}
      />

      {activeTab === 'finish' && (
        <div className="bg-card border rounded-lg p-5">
        <FinishTab
          finishInput={finishInput}
          rowOps={rowOps}
          nonFinishers={nonFinishers}
          competitors={competitors}
          competitorMap={competitorMap}
          fleetById={fleetById}
          showFleetBadge={showFleetBadge}
          showCrew={showCrew}
          enabledCompetitorFields={enabledCompetitorFields}
          derived={derived}
          savedFinishes={savedFinishes}
          finishSheetImportRef={finishSheetImportRef}
          applyCsvImport={applyCsvImport}
          setEditingPenaltyEntryId={(id) => penaltyRef.current?.open(id)}
          openRedressDialog={(id, isFinisher) => redressRef.current?.open(id, isFinisher)}
          setResolvingEntry={(entry) => resolveRef.current?.open(entry)}
          patchCache={patchCache}
          saveFinish={saveFinish}
          leave={leave}
        />
        </div>
      )}

      <div className="flex gap-3 items-center border-t pt-4">
        <Button variant="outline" onClick={leave} data-testid="back-to-races">
          Done
        </Button>
        <div className="ml-auto text-sm text-muted-foreground">
          {finishingOrder.length} finisher{finishingOrder.length === 1 ? '' : 's'}
          {unknownCount > 0 && ` (${unknownCount} unknown)`},{' '}
          {nonFinishers.length} non-finisher{nonFinishers.length === 1 ? '' : 's'}
        </div>
      </div>

      <RowConflictDialog {...conflictDialog.dialogProps} />

      <ResolveUnknownController
        ref={resolveRef}
        seriesId={seriesId}
        finishByEntryKey={derived.finishByEntryKey}
        nonFinishers={nonFinishers}
        fleets={fleets ?? []}
        primaryFieldLabel={primaryFieldLabel}
        showCrew={showCrew}
        enabledCompetitorFields={enabledCompetitorFields}
        patchCache={patchCache}
        saveFinish={saveFinish}
        onClosed={() => finishInput.input.ref.current?.focus()}
      />

      <PenaltyEditorController
        ref={penaltyRef}
        finishByCompetitorId={finishByCompetitorId}
        finisherPenalties={derived.finisherPenalties}
        competitorMap={competitorMap}
        patchCache={patchCache}
        saveFinish={saveFinish}
      />

      <RedressController
        ref={redressRef}
        raceId={raceId}
        raceNumber={race?.raceNumber}
        finishingOrder={finishingOrder}
        redressEntries={derived.redressEntries}
        finishByCompetitorId={finishByCompetitorId}
        competitorMap={competitorMap}
        availableRaces={allSeriesRaces ?? []}
        patchCache={patchCache}
        saveFinish={saveFinish}
        deleteFinish={deleteFinish}
      />

      {/* Summary badges */}
      {nonFinishers.some((nf) => nf.code !== 'implicit-dnc') && (
        <div className="flex flex-wrap gap-1.5">
          {nonFinishers
            .filter((nf) => nf.code !== 'implicit-dnc')
            .map(({ competitor, code }) => (
              <Badge key={competitor.id} variant="secondary">
                {competitor.sailNumber} — {code}
              </Badge>
            ))}
        </div>
      )}
    </div>
  );
}
