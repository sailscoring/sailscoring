'use client';

import { use, useState, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { RowConflictDialog } from '@/components/row-conflict-dialog';
import { useFinishConflictDialog } from '@/hooks/use-finish-conflict-dialog';
import {
  useFinishEntry,
  type NonFinisherCode,
} from '@/hooks/use-finish-entry';
import { useSeries } from '@/hooks/use-series';
import { useCompetitorsBySeries, useSaveCompetitor } from '@/hooks/use-competitors';
import { useFleetsBySeries } from '@/hooks/use-fleets';
import { useRace, useRacesBySeries, useSaveRace } from '@/hooks/use-races';
import { useSeriesReadOnly } from '@/components/series-read-only';
import {
  useDeleteFinish,
  useFinishesByRace,
  useSaveFinish,
  useSaveFinishes,
} from '@/hooks/use-finishes';
import { queryKeys } from '@/hooks/query-keys';
import {
  useDeleteRaceStart,
  useRaceStartsByRace,
  useSaveRaceStart,
} from '@/hooks/use-race-starts';
import {
  defaultEnabledCompetitorFields,
  DEFAULT_PRIMARY_PERSON_LABEL,
  PRIMARY_PERSON_LABEL_TEXT,
} from '@/lib/competitor-fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { X, AlertTriangle, Flag, Scale, Plus, Pencil, Trash2 } from 'lucide-react';
import type { Competitor, Finish, ResultCode, RaceStart } from '@/lib/types';
import {
  deriveFinishState,
  entryKey,
  makeFinish,
  type FinishEntry,
  type RedressEntry,
} from '@/lib/finish-entry';
import { calculateStandings } from '@/lib/scoring';
import { CheckSquare, Square } from 'lucide-react';
import { log } from '@/lib/debug';
import { cn } from '@/lib/utils';
import { useGlobalKeyDown } from '@/hooks/use-keyboard-shortcut';
import { useFeatures } from '@/components/features-provider';
import { normalizeTimeInput } from '@/lib/time-parse';
import { FinishSheetImport, type FinishSheetImportHandle } from '@/components/finish-sheet-import';
import {
  RaceStartDialog,
  type RaceStartDialogMode,
  type RaceStartDraft,
} from '@/components/race-start-dialog';
import {
  PenaltyEditorDialog,
  type PenaltyDraft,
} from '@/components/penalty-editor-dialog';
import { RedressDialog } from '@/components/redress-dialog';
import { ResolveUnknownDialog } from '@/components/resolve-unknown-dialog';
import { CheckInTab } from '@/components/check-in-tab';
import { FinishTab } from '@/components/finish-tab';
import { RatingsTab } from '@/components/ratings-tab';
import type { ParseFinishSheetResult } from '@/lib/finish-sheet-csv';

/** Inline editor for a race's date. Renders the date as a subtle button that
 *  swaps to a native date input on click; commits on change/blur, cancels on
 *  Escape. Read-only series show plain text. */
function RaceDateEditor({
  race,
  readOnly,
  onSave,
}: {
  race: { date: string; raceNumber: number };
  readOnly: boolean;
  onSave: (date: string) => Promise<void>;
}) {
  // `draft === null` means not editing; otherwise it holds the in-progress
  // value. Keeping the edit buffer separate from the `race.date` prop avoids
  // syncing state in an effect when the race updates underneath us.
  const [draft, setDraft] = useState<string | null>(null);

  if (readOnly) {
    return <p className="text-sm text-muted-foreground">{race.date || '—'}</p>;
  }

  async function commit() {
    const next = draft;
    setDraft(null);
    if (next && next !== race.date) {
      await onSave(next);
    }
  }

  if (draft !== null) {
    return (
      <Input
        type="date"
        autoFocus
        value={draft}
        aria-label={`Date for Race ${race.raceNumber}`}
        className="h-7 w-auto text-sm"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(null);
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setDraft(race.date)}
      className="group flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      aria-label={`Edit date for Race ${race.raceNumber}`}
    >
      <span>{race.date || 'Set date'}</span>
      <Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

export default function ResultEntryPage({
  params,
}: {
  params: Promise<{ id: string; raceId: string }>;
}) {
  const { id: seriesId, raceId } = use(params);
  const router = useRouter();
  const qc = useQueryClient();

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

  const saveCompetitor = useSaveCompetitor();
  const saveFinish = useSaveFinish();
  const saveFinishes = useSaveFinishes();
  const deleteFinish = useDeleteFinish();
  const saveRaceStart = useSaveRaceStart();
  const deleteRaceStartMutation = useDeleteRaceStart();
  const saveRace = useSaveRace();
  const readOnly = useSeriesReadOnly();

  // Source of truth: every visible "view model" derives from savedFinishes.
  // No parallel useState collections + Save button — each interaction writes
  // through to the server immediately (ADR-008 Phase 6).
  const derived = useMemo(
    () => deriveFinishState(savedFinishes ?? []),
    [savedFinishes],
  );
  const {
    finishingOrder,
    finishTimes,
    tiedWithPrevious,
    finisherPenalties,
    redressEntries,
    finishByEntryKey,
    finishByCompetitorId,
  } = derived;

  const { has } = useFeatures();
  const [activeTab, setActiveTab] = useState<'finish' | 'checkin' | 'ratings'>('finish');
  const [resolvingEntry, setResolvingEntry] = useState<(FinishEntry & { kind: 'unknown' }) | null>(null);
  // Race starts section
  const [startsExpanded, setStartsExpanded] = useState(false);
  // Race starts dialog
  const [startDialogMode, setStartDialogMode] = useState<RaceStartDialogMode | null>(null);
  const [redressDialog, setRedressDialog] = useState<{ competitorId: string; isFinisher: boolean } | null>(null);
  // Penalty editor dialog: competitorId of the row being edited, or null.
  const [editingPenaltyEntryId, setEditingPenaltyEntryId] = useState<string | null>(null);
  const finishSheetImportRef = useRef<FinishSheetImportHandle>(null);

  const conflictDialog = useFinishConflictDialog({
    raceId,
    competitors,
    finishingOrder,
    saveFinish,
    deleteFinish,
  });

  // Optimistic cache patch: write the new shape immediately so the UI
  // updates before the server round-trip resolves. Mutation onError will
  // roll back by invalidating the query if the save fails.
  function patchCache(updater: (rows: Finish[]) => Finish[]) {
    const key = queryKeys.finishes.byRace(raceId);
    const prev = qc.getQueryData<Finish[]>(key) ?? [];
    qc.setQueryData<Finish[]>(key, updater(prev));
  }

  const fleetById = new Map((fleets ?? []).map((f) => [f.id, f]));
  const isHandicapSeries = series?.scoringMode === 'handicap';

  const finishEntry = useFinishEntry({
    raceId,
    isHandicapSeries,
    competitors: competitors ?? [],
    fleets: fleets ?? [],
    fleetById,
    raceStarts,
    savedFinishes,
    derived,
    saveFinish,
    deleteFinish,
    patchCache,
    ready: race != null && competitors != null,
  });
  const {
    sailInput, setSailInput,
    inputError, setInputError,
    pendingUnknownSail, setPendingUnknownSail,
    highlightedIndex, setHighlightedIndex,
    pendingTimeEntry, setPendingTimeEntry,
    pendingTimeValue, setPendingTimeValue,
    pendingTimeError, setPendingTimeError,
    pendingTimeInputRef,
    flashedRowId,
    editingTimes, setEditingTimes,
    inputRef,
    nonFinishers, suggestions,
    needsFinishTime,
    addFinisher, commitCompetitor,
    confirmPendingTime, cancelPendingTime, recordAsUnknown,
    removeFinisher, toggleTiedWithPrevious, moveRowTo, reslotTimedRow,
  } = finishEntry;

  // No isDirty / leave-confirm — every interaction persists immediately.
  function leave() {
    router.push(`/series/${seriesId}/races`);
  }

  // Esc to leave; c to toggle check-in tab
  function openAddStart() {
    setStartsExpanded(true);
    setStartDialogMode({ kind: 'add' });
  }

  function openEditStart(s: RaceStart) {
    setStartDialogMode({ kind: 'edit', start: s });
  }

  async function handleSaveStart(draft: RaceStartDraft) {
    const raceStart: RaceStart = {
      id: draft.editingId ?? crypto.randomUUID(),
      raceId,
      fleetIds: draft.fleetIds,
      startTime: draft.startTime,
    };
    await saveRaceStart.mutateAsync(raceStart);
    setStartDialogMode(null);
  }

  async function handleDeleteStart(id: string) {
    await deleteRaceStartMutation.mutateAsync({ id, raceId });
  }

  useGlobalKeyDown((e) => {
    if (
      e.key === 'Escape' &&
      !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName ?? '')
    ) {
      e.preventDefault();
      leave();
    } else if (
      e.key === 'c' &&
      !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName ?? '')
    ) {
      e.preventDefault();
      setActiveTab((t) => t === 'checkin' ? 'finish' : 'checkin');
    } else if (
      e.key === 's' &&
      !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName ?? '') &&
      fleets?.some((f) => f.scoringSystem !== 'scratch')
    ) {
      e.preventDefault();
      openAddStart();
    } else if (
      e.key === 'i' &&
      has('csv-finish-import') &&
      !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName ?? '') &&
      activeTab === 'finish'
    ) {
      e.preventDefault();
      finishSheetImportRef.current?.trigger();
    }
  });

  if (race === undefined || competitors === undefined) {
    return <p className="text-muted-foreground">Loading…</p>;
  }
  if (race === null) {
    return <p className="text-muted-foreground">Race not found.</p>;
  }

  const competitorMap = new Map(competitors.map((c) => [c.id, c]));
  const showFleetBadge = (fleets ?? []).length > 1 || (fleets ?? []).some((f) => f.name !== 'Default');
  const finishedIds = finishEntry.finishedIds;

  function applyPenalty(draft: PenaltyDraft) {
    if (!editingPenaltyEntryId) return;
    const finish = finishByCompetitorId.get(editingPenaltyEntryId);
    if (!finish) {
      setEditingPenaltyEntryId(null);
      return;
    }
    const next: Finish = {
      ...finish,
      penaltyCode: draft.code,
      penaltyOverride: draft.override,
    };
    patchCache((rows) => rows.map((r) => (r.id === finish.id ? next : r)));
    saveFinish.mutate(next);
    setEditingPenaltyEntryId(null);
  }

  function openRedressDialog(competitorId: string, isFinisher: boolean) {
    setRedressDialog({ competitorId, isFinisher });
  }

  function applyRedress(entry: RedressEntry) {
    if (!redressDialog) return;
    const { competitorId } = redressDialog;
    const redressFields: Partial<Finish> = {
      redressMethod: entry.method,
      redressExcludeRaces: entry.poolMode === 'exclude' ? entry.excludeRaces : null,
      redressIncludeRaces: entry.poolMode === 'include' ? entry.includeRaces : null,
      redressIncludeAllLater: entry.poolMode === 'include' ? entry.includeAllLater : false,
      redressPoints: entry.method === 'stated' ? (Number(entry.statedPoints) || null) : null,
    };
    const existing = finishByCompetitorId.get(competitorId);
    let next: Finish;
    if (existing) {
      // RDG marks redress in both the engine and the derived view-model,
      // for finishers and non-finishers alike. The finisher row keeps its
      // sortOrder; the scoring engine treats the row as RDG (replaces points
      // with the A9 average) but the display still shows the position.
      next = {
        ...existing,
        ...redressFields,
        resultCode: 'RDG' as ResultCode,
      };
    } else {
      next = makeFinish(raceId, {
        id: crypto.randomUUID(),
        competitorId,
        sortOrder: null,
        resultCode: 'RDG',
        ...redressFields,
      });
    }
    patchCache((rows) => existing
      ? rows.map((r) => (r.id === existing.id ? next : r))
      : [...rows, next]);
    saveFinish.mutate(next);
    setRedressDialog(null);
  }

  function removeRedress() {
    if (!redressDialog) return;
    const { competitorId, isFinisher } = redressDialog;
    const existing = finishByCompetitorId.get(competitorId);
    if (!existing) {
      setRedressDialog(null);
      return;
    }
    if (isFinisher) {
      // Clear redress fields, keep the finisher row.
      const next: Finish = {
        ...existing,
        resultCode: null,
        redressMethod: null,
        redressExcludeRaces: null,
        redressIncludeRaces: null,
        redressIncludeAllLater: false,
        redressPoints: null,
      };
      patchCache((rows) => rows.map((r) => (r.id === existing.id ? next : r)));
      saveFinish.mutate(next);
    } else {
      // Non-finisher RDG → revert to implicit DNC: drop the row entirely.
      patchCache((rows) => rows.filter((r) => r.id !== existing.id));
      deleteFinish.mutate({ id: existing.id, raceId });
    }
    setRedressDialog(null);
  }

  /**
   * Replace the finishing order, finish times, and non-finisher codes from a
   * CSV import. Destructive: deletes the existing finishes for this race
   * before writing the imported batch. Clears state not expressible in the
   * v1 CSV format (ties, penalties, redress) — the scorer re-adds those in
   * the editor afterwards. The imported batch is authoritative by
   * construction, so the new rows go through one bulk save rather than the
   * per-row CAS path used for interactive autosave. The existing rows are
   * still deleted one at a time pending a bulk-DELETE endpoint (#110).
   */
  async function applyCsvImport(imported: ParseFinishSheetResult) {
    const finishers = imported.finishes
      .filter((f) => f.sortOrder !== null)
      .sort((a, b) => a.sortOrder! - b.sortOrder!);
    const newRows: Finish[] = [];
    finishers.forEach((f, i) => {
      if (f.competitorId !== null) {
        newRows.push(makeFinish(raceId, {
          id: crypto.randomUUID(),
          competitorId: f.competitorId,
          sortOrder: i + 1,
          ...(f.finishTime ? { finishTime: f.finishTime } : {}),
        }));
      } else {
        newRows.push(makeFinish(raceId, {
          id: crypto.randomUUID(),
          competitorId: null,
          unknownSailNumber: f.unknownSailNumber ?? '',
          sortOrder: i + 1,
          ...(f.finishTime ? { finishTime: f.finishTime } : {}),
        }));
      }
    });
    for (const f of imported.finishes) {
      if (f.sortOrder === null && f.resultCode && f.competitorId) {
        newRows.push(makeFinish(raceId, {
          id: crypto.randomUUID(),
          competitorId: f.competitorId,
          sortOrder: null,
          resultCode: f.resultCode,
        }));
      }
    }
    const existing = savedFinishes ?? [];
    patchCache(() => newRows);
    await Promise.all(
      existing.map((f) => deleteFinish.mutateAsync({ id: f.id, raceId })),
    );
    await saveFinishes.mutateAsync(newRows);
    setSailInput('');
    setInputError('');
    setPendingUnknownSail(null);
    setPendingTimeEntry(null);
    log('result-entry', 'csv import applied', {
      finishers: imported.summary.finishers,
      coded: imported.summary.coded,
      unresolved: imported.summary.unresolved,
    });
  }

  function setNonFinisherCode(competitorId: string, code: NonFinisherCode) {
    const existing = finishByCompetitorId.get(competitorId);
    if (code === 'implicit-dnc') {
      // Clear the explicit code. If the row holds nothing else (no
      // startPresent), drop it entirely; otherwise just null the code.
      if (!existing) return;
      if (existing.startPresent === null) {
        patchCache((rows) => rows.filter((r) => r.id !== existing.id));
        deleteFinish.mutate({ id: existing.id, raceId });
      } else {
        const next: Finish = { ...existing, resultCode: null };
        patchCache((rows) => rows.map((r) => (r.id === existing.id ? next : r)));
        saveFinish.mutate(next);
      }
    } else if (existing) {
      // Clear redress fields when switching away from RDG to another code.
      const next: Finish = {
        ...existing,
        resultCode: code,
        sortOrder: null,
        tiedWithPrevious: false,
        redressMethod: null,
        redressExcludeRaces: null,
        redressIncludeRaces: null,
        redressIncludeAllLater: false,
        redressPoints: null,
      };
      patchCache((rows) => rows.map((r) => (r.id === existing.id ? next : r)));
      saveFinish.mutate(next);
    } else {
      const next = makeFinish(raceId, {
        id: crypto.randomUUID(),
        competitorId,
        sortOrder: null,
        resultCode: code,
      });
      patchCache((rows) => [...rows, next]);
      saveFinish.mutate(next);
    }
  }

  async function toggleStartPresent(competitor: Competitor) {
    const existing = savedFinishes?.find((f) => f.competitorId === competitor.id);
    const isExplicitlyAbsent = existing?.startPresent === false;
    // A finisher in the unsaved finishing order is implicitly present unless explicitly un-checked
    const isImplicitlyPresent = finishedIds.has(competitor.id) && !isExplicitlyAbsent;
    const isPresent = existing?.startPresent === true || isImplicitlyPresent;

    if (isPresent) {
      // Un-check: remove startPresent flag
      if (existing && existing.sortOrder === null && existing.resultCode === null) {
        if (isImplicitlyPresent) {
          // Check-in-only record but competitor is also in finishing order — mark explicitly absent
          await saveFinish.mutateAsync({ ...existing, startPresent: false });
        } else {
          // Pure check-in-only record — delete it entirely
          await deleteFinish.mutateAsync({ id: existing.id, raceId });
        }
      } else if (existing) {
        // Has other data — clear just the flag
        await saveFinish.mutateAsync({ ...existing, startPresent: false });
      } else {
        // Implicitly present via finishing order but no DB record yet — create explicit absence record
        await saveFinish.mutateAsync({
          id: crypto.randomUUID(),
          raceId,
          competitorId: competitor.id,
          sortOrder: null,
          tiedWithPrevious: false,
          resultCode: null,
          startPresent: false,
          penaltyCode: null,
          penaltyOverride: null,
          redressMethod: null,
          redressExcludeRaces: null,
          redressIncludeRaces: null,
          redressIncludeAllLater: false,
          redressPoints: null,
        });
      }
    } else {
      // Check: set startPresent = true
      if (existing) {
        await saveFinish.mutateAsync({ ...existing, startPresent: true });
      } else {
        await saveFinish.mutateAsync({
          id: crypto.randomUUID(),
          raceId,
          competitorId: competitor.id,
          sortOrder: null,
          tiedWithPrevious: false,
          resultCode: null,
          startPresent: true,
          penaltyCode: null,
          penaltyOverride: null,
          redressMethod: null,
          redressExcludeRaces: null,
          redressIncludeRaces: null,
          redressIncludeAllLater: false,
          redressPoints: null,
        });
      }
    }
  }

  function closeResolveDialog() {
    setResolvingEntry(null);
    inputRef.current?.focus();
  }

  function linkUnknownToCompetitor(competitorId: string) {
    if (!resolvingEntry) return;
    const finish = finishByEntryKey.get(resolvingEntry.finishId);
    if (finish) {
      const next: Finish = {
        ...finish,
        competitorId,
        unknownSailNumber: undefined,
      };
      patchCache((rows) => rows.map((r) => (r.id === finish.id ? next : r)));
      saveFinish.mutate(next);
    }
    closeResolveDialog();
  }

  async function handleResolveNew(input: { sailNumber: string; name: string; fleetId: string }) {
    if (!resolvingEntry) return;
    const createdAt = Date.now();
    const competitor: Competitor = {
      id: crypto.randomUUID(),
      seriesId,
      fleetIds: input.fleetId ? [input.fleetId] : [],
      sailNumber: input.sailNumber,
      name: input.name,
      club: '',
      gender: '',
      age: null,
      createdAt,
    };
    await saveCompetitor.mutateAsync(competitor);

    const finish = finishByEntryKey.get(resolvingEntry.finishId);
    if (finish) {
      const next: Finish = {
        ...finish,
        competitorId: competitor.id,
        unknownSailNumber: undefined,
      };
      patchCache((rows) => rows.map((r) => (r.id === finish.id ? next : r)));
      await saveFinish.mutateAsync(next);
    }
    closeResolveDialog();
  }

  const codeLabels: Record<NonFinisherCode, string> = {
    'implicit-dnc': 'DNC (absent)',
    // Common operational codes — shown first
    DNS: 'DNS',
    DNF: 'DNF',
    OCS: 'OCS',
    NSC: 'NSC',
    RET: 'RET',
    // Protest committee codes
    DSQ: 'DSQ',
    DNE: 'DNE',
    UFD: 'UFD',
    BFD: 'BFD',
    // Explicit absence
    DNC: 'DNC',
    // Redress
    RDG: 'RDG (redress)',
  };

  // A competitor is effectively present if they are in the unsaved finishing order OR explicitly
  // checked in via savedFinishes, unless they have been explicitly un-checked (startPresent === false).
  const explicitlyAbsentIds = new Set(
    (savedFinishes ?? [])
      .filter((f): f is Finish & { competitorId: string } => f.competitorId !== null && f.startPresent === false)
      .map((f) => f.competitorId),
  );
  const effectivelyPresent = (id: string) =>
    !explicitlyAbsentIds.has(id) &&
    (finishedIds.has(id) || (savedFinishes?.some((f) => f.competitorId === id && f.startPresent === true) ?? false));
  const presentCount = (competitors ?? []).filter((c) => effectivelyPresent(c.id)).length;

  const unknownCount = finishingOrder.filter((e) => e.kind === 'unknown').length;

  // Status pill: any in-flight save / delete / reorder reads "Saving…",
  // otherwise "All changes saved." Phase 7 will swap the otherwise-static
  // "saved" text for richer collaboration affordances; chunk-5's row-conflict
  // dialog will surface 409s alongside this pill.
  const isSaving =
    saveFinish.isPending || saveFinishes.isPending || deleteFinish.isPending;
  const statusLabel = isSaving ? 'Saving…' : 'All changes saved';

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Race {race.raceNumber} — results</h2>
          <RaceDateEditor
            race={race}
            readOnly={readOnly}
            onSave={async (date) => {
              await saveRace.mutateAsync({ ...race, date });
            }}
          />
        </div>
        <div
          role="status"
          aria-live="polite"
          data-testid="autosave-status"
          className={cn(
            'shrink-0 rounded-full border px-2.5 py-0.5 text-xs',
            isSaving
              ? 'border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
              : 'border-muted bg-muted/40 text-muted-foreground',
          )}
        >
          {statusLabel}
        </div>
      </div>

      {/* Tab selector */}
      <div className="inline-flex flex-wrap gap-1 rounded-lg border bg-card p-1 shadow-sm">
        <button
          type="button"
          onClick={() => setActiveTab('finish')}
          className={cn(
            'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
            activeTab === 'finish'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
          )}
        >
          Finish entry
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('checkin')}
          className={cn(
            'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
            activeTab === 'checkin'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-background/70 hover:text-foreground',
          )}
        >
          Start check-in
          {presentCount > 0 && (
            <span className="ml-1.5 text-xs text-muted-foreground">({presentCount})</span>
          )}
        </button>
        {isHandicapSeries && (
          <button
            type="button"
            onClick={() => setActiveTab('ratings')}
            className={cn(
              'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
              activeTab === 'ratings'
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            Ratings
          </button>
        )}
      </div>

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

      {/* Race starts — only shown for handicap series */}
      {activeTab === 'finish' && isHandicapSeries && (
        <div className="bg-card border rounded-lg px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-sm">Race starts</h3>
            {!startsExpanded ? (
              <Button variant="ghost" size="sm" onClick={() => setStartsExpanded(true)}>
                Edit ▸
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={openAddStart}>
                  <Plus className="h-3.5 w-3.5 mr-1" />Add start
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setStartsExpanded(false)}>
                  Done
                </Button>
              </div>
            )}
          </div>
          {!startsExpanded ? (
            raceStarts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No start times recorded.</p>
            ) : (
              <div className="space-y-1">
                {[...raceStarts].sort((a, b) => a.startTime.localeCompare(b.startTime)).map((s) => (
                  <p key={s.id} className="text-sm text-muted-foreground">
                    <span className="font-mono">{s.startTime}</span>
                    {' — '}
                    {s.fleetIds.map((id) => fleetById.get(id)?.name ?? id).join(', ')}
                  </p>
                ))}
              </div>
            )
          ) : (
            <div className="space-y-1">
              {raceStarts.length === 0 && (
                <p className="text-sm text-muted-foreground">No start times recorded. Press <kbd className="px-1 py-0.5 text-xs border rounded">s</kbd> or click Add start.</p>
              )}
              {[...raceStarts].sort((a, b) => a.startTime.localeCompare(b.startTime)).map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-sm px-3 py-2 border rounded-md">
                  <span className="font-mono font-medium">{s.startTime}</span>
                  <span className="text-muted-foreground">—</span>
                  <span className="flex-1">{s.fleetIds.map((id) => fleetById.get(id)?.name ?? id).join(', ')}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEditStart(s)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDeleteStart(s.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <RaceStartDialog
        mode={startDialogMode}
        raceStarts={raceStarts}
        fleets={fleets ?? []}
        onSave={handleSaveStart}
        onCancel={() => setStartDialogMode(null)}
      />

      {activeTab === 'finish' && (
        <div className="bg-card border rounded-lg p-5">
        <FinishTab
          finishEntry={finishEntry}
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
          setEditingPenaltyEntryId={setEditingPenaltyEntryId}
          openRedressDialog={openRedressDialog}
          setResolvingEntry={setResolvingEntry}
          setNonFinisherCode={setNonFinisherCode}
          codeLabels={codeLabels}
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

      <ResolveUnknownDialog
        unknownSailNumber={resolvingEntry?.sailNumber ?? null}
        candidates={nonFinishers.map((nf) => nf.competitor)}
        fleets={fleets ?? []}
        primaryFieldLabel={primaryFieldLabel}
        showCrew={showCrew}
        enabledCompetitorFields={enabledCompetitorFields}
        onResolveExisting={linkUnknownToCompetitor}
        onResolveNew={handleResolveNew}
        onCancel={closeResolveDialog}
      />

      <PenaltyEditorDialog
        competitor={
          editingPenaltyEntryId
            ? { id: editingPenaltyEntryId, sailNumber: competitorMap.get(editingPenaltyEntryId)?.sailNumber ?? '' }
            : null
        }
        initialPenalty={editingPenaltyEntryId ? finisherPenalties.get(editingPenaltyEntryId) ?? null : null}
        onApply={applyPenalty}
        onCancel={() => setEditingPenaltyEntryId(null)}
      />

      <RedressDialog
        competitor={
          redressDialog
            ? { id: redressDialog.competitorId, sailNumber: competitorMap.get(redressDialog.competitorId)?.sailNumber ?? '' }
            : null
        }
        currentFinishPosition={(() => {
          if (!redressDialog?.isFinisher) return null;
          const idx = finishingOrder.findIndex(
            (e) => e.kind === 'known' && e.competitorId === redressDialog.competitorId,
          );
          return idx >= 0 ? idx + 1 : null;
        })()}
        seedEntry={redressDialog ? redressEntries.get(redressDialog.competitorId) ?? null : null}
        currentRaceNumber={race?.raceNumber}
        availableRaces={allSeriesRaces ?? []}
        canRemove={redressDialog ? redressEntries.has(redressDialog.competitorId) : false}
        onApply={applyRedress}
        onRemove={removeRedress}
        onCancel={() => setRedressDialog(null)}
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
