'use client';

import { use, useState, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ConflictApiError, type ConflictDetail } from '@/lib/api-client';
import { RowConflictDialog } from '@/components/row-conflict-dialog';
import { useSeries, useTouchSeries } from '@/hooks/use-series';
import { useCompetitorsBySeries, useSaveCompetitor } from '@/hooks/use-competitors';
import { useFleetsBySeries } from '@/hooks/use-fleets';
import { useRace, useRacesBySeries } from '@/hooks/use-races';
import {
  useDeleteFinish,
  useFinishesByRace,
  useSaveFinish,
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
  displayHelmCrew,
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
import type { ParseFinishSheetResult } from '@/lib/finish-sheet-csv';

type NonFinisherCode = ResultCode | 'implicit-dnc';

interface NonFinisherEntry {
  competitor: Competitor;
  code: NonFinisherCode;
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
  const showCrew =
    (series?.enabledCompetitorFields ?? defaultEnabledCompetitorFields()).includes('crewName');
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
  const deleteFinish = useDeleteFinish();
  const saveRaceStart = useSaveRaceStart();
  const deleteRaceStartMutation = useDeleteRaceStart();
  const touchSeries = useTouchSeries();

  // Source of truth: every visible "view model" derives from savedFinishes.
  // No parallel useState collections + Save button — each interaction writes
  // through to the server immediately (ADR-008 Phase 6).
  const derived = useMemo(
    () => deriveFinishState(savedFinishes ?? []),
    [savedFinishes],
  );
  const {
    finishingOrder,
    nonFinisherCodes,
    finishTimes,
    tiedWithPrevious,
    finisherPenalties,
    redressEntries,
    finishByEntryKey,
    finishByCompetitorId,
  } = derived;

  // Entry-key of a row to briefly flash (recent auto-slot, scratch reorder).
  const [flashedRowId, setFlashedRowId] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'finish' | 'checkin'>('finish');
  const [sailInput, setSailInput] = useState('');
  const [checkinInput, setCheckinInput] = useState('');
  const [inputError, setInputError] = useState('');
  const [pendingUnknownSail, setPendingUnknownSail] = useState<string | null>(null);
  const [resolvingEntry, setResolvingEntry] = useState<(FinishEntry & { kind: 'unknown' }) | null>(null);
  // Pending time entry: competitor confirmed, waiting for finish time before adding to list
  const [pendingTimeEntry, setPendingTimeEntry] = useState<{ competitor: Competitor } | null>(null);
  const [pendingTimeValue, setPendingTimeValue] = useState('');
  const [pendingTimeError, setPendingTimeError] = useState('');
  const pendingTimeInputRef = useRef<HTMLInputElement>(null);
  // Race starts section
  const [startsExpanded, setStartsExpanded] = useState(false);
  // Race starts dialog
  const [startDialogMode, setStartDialogMode] = useState<RaceStartDialogMode | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [showAllCheckin, setShowAllCheckin] = useState(false);
  // Per-row UI overlay for the finish-time inputs: while a row's input is
  // focused we show the in-progress text; on blur we normalize and persist.
  const [editingTimes, setEditingTimes] = useState<Map<string, string>>(new Map());
  // Row-scoped conflict state: holds the user's payload that 409'd plus the
  // server-side detail (updatedAt, actor) for the dialog. Only one conflict
  // is shown at a time — sequentially-fired mutations queue behind the
  // dialog's resolution.
  const [conflict, setConflict] = useState<
    | {
        finishId: string;
        rowLabel: string;
        /**
         * The user's intended change. For saves, the Finish payload they
         * tried to write. For deletes, a sentinel — "Keep mine" retries
         * the delete; "Use current" dismisses.
         */
        pendingPayload: Finish | { kind: 'delete' };
        detail?: ConflictDetail;
      }
    | null
  >(null);
  const [retryingConflict, setRetryingConflict] = useState(false);
  const [redressDialog, setRedressDialog] = useState<{ competitorId: string; isFinisher: boolean } | null>(null);
  // Penalty editor dialog: competitorId of the row being edited, or null.
  const [editingPenaltyEntryId, setEditingPenaltyEntryId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const finishSheetImportRef = useRef<FinishSheetImportHandle>(null);

  // Optimistic cache patch: write the new shape immediately so the UI
  // updates before the server round-trip resolves. Mutation onError will
  // roll back by invalidating the query if the save fails.
  function patchCache(updater: (rows: Finish[]) => Finish[]) {
    const key = queryKeys.finishes.byRace(raceId);
    const prev = qc.getQueryData<Finish[]>(key) ?? [];
    qc.setQueryData<Finish[]>(key, updater(prev));
  }

  /**
   * Build a human-readable label for the conflict dialog: "Row 4 (sail
   * 1234, Alice)" for a finisher; "Sail 1234 (Alice)" for a non-finisher
   * row with a code; "Unknown sail 9999" for unresolved entries.
   */
  function rowLabelForFinish(finish: Finish | undefined, fallbackId: string): string {
    if (!finish) return `Finish ${fallbackId.slice(0, 8)}`;
    if (finish.competitorId === null) {
      return `Unknown sail ${finish.unknownSailNumber ?? '?'}`;
    }
    const competitor = competitors?.find((c) => c.id === finish.competitorId);
    const sail = competitor?.sailNumber ?? '?';
    const name = competitor?.name ?? '';
    if (finish.sortOrder !== null) {
      // Position in the visible list — re-derived from the cache.
      const idx = finishingOrder.findIndex((e) => entryKey(e) === finish.competitorId);
      const pos = idx >= 0 ? idx + 1 : finish.sortOrder;
      return `Row ${pos} (sail ${sail}${name ? `, ${name}` : ''})`;
    }
    return `Sail ${sail}${name ? ` (${name})` : ''}`;
  }

  // Subscribe to mutation 409s scoped to `finishes` and surface them in
  // the row-scoped conflict dialog. The global ConflictMutationSubscriber
  // skips these explicitly (see app/providers.tsx).
  useEffect(() => {
    const unsub = qc.getMutationCache().subscribe((event) => {
      if (event.type !== 'updated') return;
      if (event.mutation.options.scope?.id !== 'finishes') return;
      const error = event.mutation.state.error;
      if (!(error instanceof ConflictApiError)) return;
      // If we're already showing a dialog for the same row, leave it alone.
      if (conflict !== null) return;
      const variables = event.mutation.state.variables as
        | Finish
        | { id: string; raceId: string };
      if (!variables || typeof variables !== 'object') return;
      let finishId: string;
      let pending: Finish | { kind: 'delete' };
      if ('competitorId' in variables) {
        // Single-row save (Finish).
        finishId = (variables as Finish).id;
        pending = variables as Finish;
      } else {
        // Single-row delete.
        finishId = (variables as { id: string }).id;
        pending = { kind: 'delete' };
      }
      // Refresh the cache so the dialog shows server truth behind it.
      void qc.invalidateQueries({ queryKey: queryKeys.finishes.byRace(raceId) });
      const cached = qc.getQueryData<Finish[]>(queryKeys.finishes.byRace(raceId));
      const liveRow = cached?.find((r) => r.id === finishId);
      setConflict({
        finishId,
        rowLabel: rowLabelForFinish(liveRow, finishId),
        pendingPayload: pending,
        detail: error.detail,
      });
    });
    return () => unsub();
    // The subscriber closes over `conflict` and `competitors` for label
    // building; recreate on changes so labels stay current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, raceId, conflict, competitors, finishingOrder]);

  async function resolveConflictKeepMine() {
    if (!conflict) return;
    setRetryingConflict(true);
    try {
      // Refetch to get the fresh version, then retry the user's payload
      // against that baseline.
      await qc.invalidateQueries({ queryKey: queryKeys.finishes.byRace(raceId) });
      const fresh = qc.getQueryData<Finish[]>(queryKeys.finishes.byRace(raceId));
      const current = fresh?.find((r) => r.id === conflict.finishId);
      if (conflict.pendingPayload && 'kind' in conflict.pendingPayload) {
        // Delete retry — fire it again; the row is gone now if it never existed.
        if (current) {
          await deleteFinish.mutateAsync({ id: conflict.finishId, raceId });
        }
      } else {
        const retry: Finish = {
          ...conflict.pendingPayload,
          version: current?.version,
        };
        patchCache((rows) =>
          rows.some((r) => r.id === retry.id)
            ? rows.map((r) => (r.id === retry.id ? retry : r))
            : [...rows, retry],
        );
        await saveFinish.mutateAsync(retry);
      }
      setConflict(null);
    } catch {
      // If the retry itself 409s, the subscriber re-opens with fresh detail.
    } finally {
      setRetryingConflict(false);
    }
  }

  function resolveConflictUseCurrent() {
    void qc.invalidateQueries({ queryKey: queryKeys.finishes.byRace(raceId) });
    setConflict(null);
  }

  /**
   * Apply a new ordered list of entries (with optional ties) to the
   * server: write distinct sortOrders and the `tiedWithPrevious` flag
   * for every row whose values changed. Caller is responsible for
   * inserts/deletes — this only renumbers + retags existing rows.
   */
  function commitOrderChange(targetOrder: FinishEntry[], targetTies: Set<string>) {
    const updates: Finish[] = [];
    for (let i = 0; i < targetOrder.length; i++) {
      const entry = targetOrder[i];
      const finish = finishByEntryKey.get(entryKey(entry));
      if (!finish) continue;
      const targetSortOrder = i + 1;
      const targetTied = i > 0 && targetTies.has(entryKey(entry));
      if (
        finish.sortOrder !== targetSortOrder ||
        finish.tiedWithPrevious !== targetTied
      ) {
        updates.push({ ...finish, sortOrder: targetSortOrder, tiedWithPrevious: targetTied });
      }
    }
    if (updates.length === 0) return;
    const updatedById = new Map(updates.map((u) => [u.id, u]));
    patchCache((rows) => rows.map((r) => updatedById.get(r.id) ?? r));
    // Each row needs its own save (sortOrder + boolean both change). The
    // shared `finishes` mutation scope serializes these writes against
    // the per-row save path, so a follow-on edit waits for the last
    // reorder save's onSuccess to land the bumped version.
    for (const u of updates) saveFinish.mutate(u);
    void touchSeries.mutateAsync(seriesId);
  }

  // Focus sail input as soon as the UI first renders (race + competitors loaded)
  const didFocusRef = useRef(false);
  useEffect(() => {
    if (!didFocusRef.current && race != null && competitors != null) {
      didFocusRef.current = true;
      inputRef.current?.focus();
    }
  }, [race, competitors]);

  // Focus the time input when a pending time entry appears; return focus to sail input when it clears
  useEffect(() => {
    if (pendingTimeEntry) {
      pendingTimeInputRef.current?.focus();
    } else {
      inputRef.current?.focus();
    }
  }, [pendingTimeEntry]);

  // Clear the row flash after a short delay so the animation only plays once per trigger.
  useEffect(() => {
    if (flashedRowId === null) return;
    const t = setTimeout(() => setFlashedRowId(null), 900);
    return () => clearTimeout(t);
  }, [flashedRowId]);

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
    await touchSeries.mutateAsync(seriesId);
    setStartDialogMode(null);
  }

  async function handleDeleteStart(id: string) {
    await deleteRaceStartMutation.mutateAsync({ id, raceId });
    await touchSeries.mutateAsync(seriesId);
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
  const sailMap = new Map<string, Competitor[]>();
  for (const c of competitors) {
    const key = c.sailNumber.toUpperCase();
    const arr = sailMap.get(key);
    if (arr) arr.push(c);
    else sailMap.set(key, [c]);
  }
  const fleetById = new Map((fleets ?? []).map((f) => [f.id, f]));
  const showFleetBadge = (fleets ?? []).length > 1 || (fleets ?? []).some((f) => f.name !== 'Default');
  const hasNonScratchFleets = (fleets ?? []).some((f) => f.scoringSystem !== 'scratch');
  const isHandicapSeries = series?.scoringMode === 'handicap';
  // Fleet IDs that have a recorded start time for this race
  const fleetIdsWithStartTimes = new Set(raceStarts.flatMap((s) => s.fleetIds));
  // Returns true if this competitor needs a finish time recorded.
  // Both conditions must hold: the fleet has a start time AND uses handicap scoring.
  // Scratch fleets never need finish times, even when they have a recorded start.
  const needsFinishTime = (competitorId: string): boolean => {
    const c = competitorMap.get(competitorId);
    if (!c) return false;
    return c.fleetIds.some((id) => {
      const fleet = fleetById.get(id);
      return fleet !== undefined && fleet.scoringSystem !== 'scratch' && fleetIdsWithStartTimes.has(id);
    });
  };

  // Returns true if this competitor has at least one fleet with a start configured
  // for this race. When any handicap fleet exists in the series, every finished
  // competitor must have a corresponding start — otherwise we can't determine
  // whether they need a finish time.
  const hasStartForRace = (competitorId: string): boolean => {
    const c = competitorMap.get(competitorId);
    if (!c) return false;
    return c.fleetIds.some((id) => fleetIdsWithStartTimes.has(id));
  };

  // Competitors not yet in the finishing order (only known finishers consume a competitor slot)
  const finishedIds = new Set(
    finishingOrder.flatMap((e) => e.kind === 'known' ? [e.competitorId] : []),
  );
  const nonFinishers: NonFinisherEntry[] = competitors
    .filter((c) => !finishedIds.has(c.id))
    .map((c) => {
      const explicitCode = nonFinisherCodes.get(c.id);
      const isPresent = savedFinishes?.some((f) => f.competitorId === c.id && f.startPresent === true);
      return {
        competitor: c,
        code: explicitCode ?? (isPresent ? 'DNF' : 'implicit-dnc'),
      };
    });
  const suggestions = sailInput.trim()
    ? nonFinishers.filter(({ competitor }) =>
        competitor.sailNumber.toUpperCase().startsWith(sailInput.trim().toUpperCase()),
      )
    : [];

  // Core "add this competitor to the finishing order" — optionally with a pre-known finish time.
  // Timed entries are auto-slotted immediately before the next later-timed row, preserving
  // the relative order of scratch rows (time-order invariant, ADR-007).
  function addKnownFinisher(competitor: Competitor, finishTime?: string) {
    // Compute the target insertion index in the visible finishing order.
    let insertAt = finishingOrder.length;
    if (finishTime) {
      for (let i = 0; i < finishingOrder.length; i++) {
        const existingTime = finishTimes.get(entryKey(finishingOrder[i]));
        if (existingTime !== undefined && existingTime > finishTime) {
          insertAt = i;
          break;
        }
      }
    }

    // Reuse the existing Finish row if the competitor was already checked in;
    // otherwise insert a fresh row.
    const existing = finishByCompetitorId.get(competitor.id);
    const finishId = existing?.id ?? crypto.randomUUID();
    const newRow: Finish = existing
      ? {
          ...existing,
          sortOrder: insertAt + 1,
          tiedWithPrevious: false,
          ...(finishTime ? { finishTime } : {}),
        }
      : makeFinish(raceId, {
          id: finishId,
          competitorId: competitor.id,
          sortOrder: insertAt + 1,
          startPresent: true,
          ...(finishTime ? { finishTime } : {}),
        });

    // Build the order *after* insertion so commitOrderChange can renumber
    // displaced rows.
    const newEntry: FinishEntry = {
      kind: 'known', competitorId: competitor.id, finishId, version: existing?.version,
    };
    const targetOrder = [
      ...finishingOrder.slice(0, insertAt),
      newEntry,
      ...finishingOrder.slice(insertAt),
    ];

    patchCache((rows) => existing
      ? rows.map((r) => (r.id === existing.id ? newRow : r))
      : [...rows, newRow]);
    saveFinish.mutate(newRow);
    if (finishTime) setFlashedRowId(competitor.id);
    // Renumber displaced rows.
    commitOrderChange(targetOrder, tiedWithPrevious);
    setSailInput('');
    setInputError('');
    setPendingUnknownSail(null);
    setHighlightedIndex(-1);
    inputRef.current?.focus();
    log('result-entry', 'added finisher', { sail: competitor.sailNumber, competitorId: competitor.id });
  }

  // Route a resolved competitor through time-entry if their fleet has a start time.
  // In a handicap series, block competitors whose fleet has no start configured.
  // The scorer needs to add a start for every fleet before entering finishes.
  function commitCompetitor(competitor: Competitor) {
    if (isHandicapSeries && !hasStartForRace(competitor.id)) {
      const fleetNames = competitor.fleetIds
        .map((id) => fleetById.get(id)?.name)
        .filter(Boolean)
        .join(', ');
      setSailInput('');
      setHighlightedIndex(-1);
      setPendingUnknownSail(null);
      setInputError(`${competitor.sailNumber} cannot be finished — no start configured for fleet ${fleetNames}. Add a start for this fleet first.`);
      return;
    }
    if (needsFinishTime(competitor.id)) {
      setSailInput('');
      setInputError('');
      setHighlightedIndex(-1);
      setPendingTimeEntry({ competitor });
      setPendingTimeValue('');
      setPendingTimeError('');
    } else {
      addKnownFinisher(competitor);
    }
  }

  function confirmPendingTime() {
    if (!pendingTimeEntry) return;
    if (!pendingTimeValue.trim()) {
      setPendingTimeError('Finish time is required.');
      return;
    }
    const time = normalizeTimeInput(pendingTimeValue);
    if (!time) {
      setPendingTimeError('Enter a valid time, e.g. 14:32:10 or 143210.');
      return;
    }
    addKnownFinisher(pendingTimeEntry.competitor, time);
    setPendingTimeEntry(null);
    setPendingTimeValue('');
    setPendingTimeError('');
  }

  function cancelPendingTime() {
    setPendingTimeEntry(null);
    setPendingTimeValue('');
    setPendingTimeError('');
    inputRef.current?.focus();
  }

  function recordAsUnknown(sail: string) {
    const finishId = crypto.randomUUID();
    const newRow = makeFinish(raceId, {
      id: finishId,
      competitorId: null,
      unknownSailNumber: sail,
      sortOrder: finishingOrder.length + 1,
    });
    patchCache((rows) => [...rows, newRow]);
    saveFinish.mutate(newRow);
    setPendingUnknownSail(null);
    setSailInput('');
    setInputError('');
    inputRef.current?.focus();
    log('result-entry', 'recorded unknown finisher', { sail });
  }

  function addFinisher() {
    if (highlightedIndex >= 0 && suggestions[highlightedIndex]) {
      commitCompetitor(suggestions[highlightedIndex].competitor);
      return;
    }

    const sail = sailInput.trim().toUpperCase();
    if (!sail) return;

    const candidates = sailMap.get(sail);
    if (!candidates || candidates.length === 0) {
      setPendingUnknownSail(sail);
      setInputError(`Sail number "${sail}" not found in this series.`);
      return;
    }
    const unfinished = candidates.filter((c) => !finishedIds.has(c.id));
    if (unfinished.length === 0) {
      setInputError(`${sail} is already in the finishing order.`);
      return;
    }
    if (unfinished.length > 1) {
      setInputError(`Multiple boats with sail ${sail} — select from the list.`);
      return;
    }

    commitCompetitor(unfinished[0]);
  }

  function removeFinisher(eid: string) {
    const finish = finishByEntryKey.get(eid);
    if (!finish) return;
    // Preserve startPresent across remove: if the row was checked in,
    // retain it as a check-in-only record (sortOrder=null, fields cleared).
    const next: Finish | null =
      finish.startPresent === true
        ? {
            ...finish,
            sortOrder: null,
            tiedWithPrevious: false,
            resultCode: null,
            penaltyCode: null,
            penaltyOverride: null,
            redressMethod: null,
            redressExcludeRaces: null,
            redressIncludeRaces: null,
            redressIncludeAllLater: false,
            redressPoints: null,
            ...(finish.finishTime ? { finishTime: undefined } : {}),
          }
        : null;
    if (next) {
      patchCache((rows) => rows.map((r) => (r.id === finish.id ? next : r)));
      saveFinish.mutate(next);
    } else {
      patchCache((rows) => rows.filter((r) => r.id !== finish.id));
      deleteFinish.mutate({ id: finish.id, raceId });
    }
    // Renumber remaining rows so sortOrders stay 1-based contiguous.
    const remaining = finishingOrder.filter((e) => entryKey(e) !== eid);
    const remainingTies = new Set(tiedWithPrevious);
    remainingTies.delete(eid);
    commitOrderChange(remaining, remainingTies);
  }

  function toggleTiedWithPrevious(eid: string) {
    const newTies = new Set(tiedWithPrevious);
    if (newTies.has(eid)) newTies.delete(eid);
    else newTies.add(eid);
    commitOrderChange(finishingOrder, newTies);
  }

  /**
   * Move a scratch row by one step in the given direction. No-op if it would
   * fall off the list. Scratch rows can freely move past timed rows; the
   * moved row briefly flashes at its new position as a visual confirmation.
   * Timed rows never have move affordances — their position is determined by
   * the time-order invariant.
   */
  function moveRow(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= finishingOrder.length) return;
    const next = [...finishingOrder];
    const movedEid = entryKey(next[index]);
    const newTies = new Set(tiedWithPrevious);

    // If the row immediately below the moved row was tied with it,
    // that tie now refers to the row above the vacated slot — preserve it
    // only if the moved row was itself tied (i.e. the group continues).
    const belowIndex = index + 1;
    if (belowIndex < next.length) {
      const belowEid = entryKey(next[belowIndex]);
      if (newTies.has(belowEid) && !newTies.has(movedEid)) {
        newTies.delete(belowEid);
      }
    }
    // Always clear the tie on the moved row itself.
    newTies.delete(movedEid);

    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved);
    setFlashedRowId(entryKey(moved));
    commitOrderChange(next, newTies);
  }

  /**
   * Re-slot a row that already has a finish time after its time has been edited
   * so the time-order invariant holds. Scratch rows keep their relative order;
   * the moved row briefly flashes at its new position.
   */
  function reslotTimedRow(eid: string, nextTime: string) {
    const currentIndex = finishingOrder.findIndex((e) => entryKey(e) === eid);
    if (currentIndex === -1) return;
    const without = [
      ...finishingOrder.slice(0, currentIndex),
      ...finishingOrder.slice(currentIndex + 1),
    ];
    let insertAt = without.length;
    for (let i = 0; i < without.length; i++) {
      const otherId = entryKey(without[i]);
      if (otherId === eid) continue;
      const otherTime = finishTimes.get(otherId);
      if (otherTime !== undefined && otherTime > nextTime) {
        insertAt = i;
        break;
      }
    }
    if (insertAt === currentIndex) return;
    const reordered = [
      ...without.slice(0, insertAt),
      finishingOrder[currentIndex],
      ...without.slice(insertAt),
    ];
    setFlashedRowId(eid);
    commitOrderChange(reordered, tiedWithPrevious);
  }

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
    void touchSeries.mutateAsync(seriesId);
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
    void touchSeries.mutateAsync(seriesId);
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
    void touchSeries.mutateAsync(seriesId);
    setRedressDialog(null);
  }

  /**
   * Replace the finishing order, finish times, and non-finisher codes from a
   * CSV import. Destructive: deletes the existing finishes for this race
   * before writing the imported batch. Clears state not expressible in the
   * v1 CSV format (ties, penalties, redress) — the scorer re-adds those in
   * the editor afterwards. Each row is saved individually so the per-row
   * version model stays consistent with the rest of the autosave path.
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
    await Promise.all(newRows.map((f) => saveFinish.mutateAsync(f)));
    void touchSeries.mutateAsync(seriesId);
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
    void touchSeries.mutateAsync(seriesId);
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
    await touchSeries.mutateAsync(seriesId);
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
      void touchSeries.mutateAsync(seriesId);
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
    await touchSeries.mutateAsync(seriesId);

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

  const checkinSuggestions = checkinInput.trim()
    ? (competitors ?? []).filter((c) =>
        c.sailNumber.toUpperCase().startsWith(checkinInput.trim().toUpperCase()),
      )
    : [];

  const unknownCount = finishingOrder.filter((e) => e.kind === 'unknown').length;

  // Status pill: any in-flight save / delete / reorder reads "Saving…",
  // otherwise "All changes saved." Phase 7 will swap the otherwise-static
  // "saved" text for richer collaboration affordances; chunk-5's row-conflict
  // dialog will surface 409s alongside this pill.
  const isSaving = saveFinish.isPending || deleteFinish.isPending;
  const statusLabel = isSaving ? 'Saving…' : 'All changes saved';

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Race {race.raceNumber} — results</h2>
          <p className="text-sm text-muted-foreground">{race.date}</p>
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
      <div className="flex gap-1 border-b">
        <button
          type="button"
          onClick={() => setActiveTab('finish')}
          className={cn(
            'px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors',
            activeTab === 'finish'
              ? 'border-foreground text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          Finish entry
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('checkin')}
          className={cn(
            'px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors',
            activeTab === 'checkin'
              ? 'border-foreground text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          Start check-in
          {presentCount > 0 && (
            <span className="ml-1.5 text-xs text-muted-foreground">({presentCount})</span>
          )}
        </button>
      </div>

      {activeTab === 'checkin' && (
        <div className="space-y-4 max-w-lg">
          <p className="text-sm text-muted-foreground">
            Mark competitors as present in the starting area before the race.
            This data is used for A5.3 scoring (DNF/OCS score starting-area entries + 1).
          </p>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              Present at start: {presentCount} / {competitors?.length ?? 0}
            </p>
            {presentCount > 0 && (
              <button
                type="button"
                onClick={() => setShowAllCheckin((v) => !v)}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
              >
                {showAllCheckin ? 'Hide checked-in' : `Show all`}
              </button>
            )}
          </div>
          <div className="relative">
            <Input
              value={checkinInput}
              onChange={(e) => setCheckinInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setCheckinInput('');
                  return;
                }
                if (e.key !== 'Enter' && e.key !== 'Tab') return;
                if (!checkinInput.trim() || checkinSuggestions.length === 0) return;
                e.preventDefault();
                toggleStartPresent(checkinSuggestions[0]);
                setCheckinInput('');
              }}
              placeholder="Sail number to search…"
              autoComplete="off"
            />
            {checkinSuggestions.length > 0 && checkinInput.trim() && (
              <ul className="absolute z-10 top-full mt-1 w-full rounded-md border bg-popover shadow-md">
                {checkinSuggestions.map((c) => {
                  const present = effectivelyPresent(c.id);
                  return (
                    <li
                      key={c.id}
                      className="flex items-center gap-3 px-3 py-2 cursor-pointer text-sm hover:bg-accent"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        toggleStartPresent(c);
                        setCheckinInput('');
                      }}
                    >
                      <span className="font-mono font-medium w-16 shrink-0">{c.sailNumber}</span>
                      <span className="flex-1 truncate">{displayHelmCrew(c, showCrew)}</span>
                      {present ? (
                        <CheckSquare className="h-4 w-4 text-green-600 shrink-0" />
                      ) : (
                        <Square className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="space-y-1.5">
            {(() => {
              const visible = showAllCheckin
                ? (competitors ?? [])
                : (competitors ?? []).filter((c) => !effectivelyPresent(c.id));
              if (visible.length === 0 && presentCount > 0) {
                return (
                  <p className="text-sm text-muted-foreground">
                    All competitors checked in.{' '}
                    <button
                      type="button"
                      onClick={() => setShowAllCheckin(true)}
                      className="underline underline-offset-2 hover:text-foreground"
                    >
                      Show all
                    </button>
                  </p>
                );
              }
              return visible.map((c) => {
                const present = effectivelyPresent(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleStartPresent(c)}
                    className={cn(
                      'w-full flex items-center gap-3 border rounded-lg px-4 py-2.5 text-left transition-colors',
                      present ? 'bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800' : 'hover:bg-accent',
                    )}
                  >
                    {present ? (
                      <CheckSquare className="h-4 w-4 text-green-600 shrink-0" />
                    ) : (
                      <Square className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <span className="font-mono font-medium w-16 shrink-0">{c.sailNumber}</span>
                    <span className="text-sm flex-1 truncate">{displayHelmCrew(c, showCrew)}</span>
                  </button>
                );
              });
            })()}
          </div>
        </div>
      )}

      {/* Race starts — only shown for handicap series */}
      {activeTab === 'finish' && isHandicapSeries && (
        <div className="border rounded-lg px-4 py-3 space-y-2">
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

      {activeTab === 'finish' && <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Left: finishing order */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Finishing order</h3>
            <FinishSheetImport
              ref={finishSheetImportRef}
              candidates={competitors}
              existingFinishCount={savedFinishes?.filter((f) => f.sortOrder !== null || f.resultCode !== null).length ?? 0}
              onConfirm={applyCsvImport}
              trigger={
                <Button variant="outline" size="sm" title="Import finish sheet from CSV (i)">
                  Import CSV
                </Button>
              }
            />
          </div>

          <div className="relative">
            {pendingTimeEntry ? (
              <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
                <span className="font-mono font-medium text-sm shrink-0">{pendingTimeEntry.competitor.sailNumber}</span>
                {(() => {
                  const pf = fleetById.get(pendingTimeEntry.competitor.fleetIds[0]);
                  if (!pf || ((fleets ?? []).length <= 1 && pf.name === 'Default')) return null;
                  return <Badge variant="secondary" className="text-xs shrink-0">{pf.name}</Badge>;
                })()}
                <span className="text-sm text-muted-foreground truncate">{displayHelmCrew(pendingTimeEntry.competitor, showCrew)}</span>
                <input
                  ref={pendingTimeInputRef}
                  type="text"
                  value={pendingTimeValue}
                  onChange={(e) => { setPendingTimeValue(e.target.value); setPendingTimeError(''); }}
                  placeholder="HH:MM:SS"
                  aria-label="Finish time"
                  className="w-28 shrink-0 font-mono text-sm rounded px-2 py-1 border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === 'Tab') {
                      e.preventDefault();
                      confirmPendingTime();
                    } else if (e.key === 'Escape') {
                      cancelPendingTime();
                    }
                  }}
                />
                <Button size="sm" onClick={confirmPendingTime}>Add</Button>
                <button onClick={cancelPendingTime} aria-label="Cancel" className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                value={sailInput}
                onChange={(e) => {
                  setSailInput(e.target.value);
                  setInputError('');
                  setHighlightedIndex(-1);
                  setPendingUnknownSail(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setHighlightedIndex((i) => Math.min(i + 1, suggestions.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setHighlightedIndex((i) => Math.max(i - 1, -1));
                  } else if (e.key === 'Escape') {
                    if (pendingUnknownSail) {
                      setPendingUnknownSail(null);
                      setInputError('');
                    } else if (suggestions.length > 0 || sailInput.trim()) {
                      setHighlightedIndex(-1);
                      setSailInput('');
                    } else {
                      leave();
                    }
                  } else if (e.key === 'Tab' && suggestions.length > 0) {
                    e.preventDefault();
                    commitCompetitor(suggestions[Math.max(highlightedIndex, 0)].competitor);
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (pendingUnknownSail) {
                      recordAsUnknown(pendingUnknownSail);
                    } else {
                      addFinisher();
                    }
                  }
                }}
                placeholder="Sail number…"
                aria-label="Sail number"
                aria-autocomplete="list"
                autoComplete="off"
              />
              <Button type="button" onClick={addFinisher}>
                Add
              </Button>
            </div>
            )}
            {pendingTimeError && (
              <p className="text-sm text-destructive mt-1">{pendingTimeError}</p>
            )}
            {suggestions.length > 0 && !pendingTimeEntry && (
              <ul
                role="listbox"
                className="absolute z-10 top-full mt-1 w-full rounded-md border bg-popover shadow-md"
              >
                {suggestions.map(({ competitor }, i) => (
                  <li
                    key={competitor.id}
                    role="option"
                    aria-selected={i === highlightedIndex}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 cursor-pointer text-sm',
                      i === highlightedIndex ? 'bg-accent' : 'hover:bg-accent',
                    )}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      commitCompetitor(competitor);
                    }}
                  >
                    <span className="font-mono font-medium w-16 shrink-0">{competitor.sailNumber}</span>
                    {showFleetBadge && (
                      <Badge variant="secondary" className="text-xs shrink-0">
                        {fleetById.get(competitor.fleetIds[0])?.name ?? '—'}
                      </Badge>
                    )}
                    <span className="flex-1 truncate">{displayHelmCrew(competitor, showCrew)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {inputError && !pendingUnknownSail && (
            <p className="text-sm text-destructive">{inputError}</p>
          )}
          {pendingUnknownSail && (
            <div className="space-y-2">
              <p className="text-sm text-destructive">
                Sail number &ldquo;{pendingUnknownSail}&rdquo; is not registered in this series.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => recordAsUnknown(pendingUnknownSail)}
                >
                  Record as unknown
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setPendingUnknownSail(null);
                    setInputError('');
                    setSailInput('');
                    inputRef.current?.focus();
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {finishingOrder.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Enter sail numbers in finishing order above.
            </p>
          )}

          <ol className="space-y-1.5">
            {finishingOrder.map((entry, index) => {
              const eid = entryKey(entry);
              const rowNumber = index + 1;
              const isFlashed = flashedRowId === eid;
              const isTimed = entry.kind === 'known' && needsFinishTime(entry.competitorId);

              if (entry.kind === 'unknown') {
                return (
                  <li
                    key={entry.finishId}
                    className={cn(
                      'flex items-center gap-3 border border-amber-400 rounded-lg px-4 py-2.5 bg-amber-50 dark:bg-amber-950 transition-colors',
                      isFlashed && 'ring-2 ring-primary',
                    )}
                  >
                    <span className="w-6 text-right text-sm font-mono text-muted-foreground shrink-0">
                      {rowNumber}
                    </span>
                    <div className="flex flex-col shrink-0">
                      <button
                        type="button"
                        aria-label={`Move row ${rowNumber} up`}
                        disabled={index === 0}
                        onClick={() => moveRow(index, -1)}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none leading-none text-sm"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Move row ${rowNumber} down`}
                        disabled={index === finishingOrder.length - 1}
                        onClick={() => moveRow(index, 1)}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none leading-none text-sm"
                      >
                        ↓
                      </button>
                    </div>
                    <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                    <span className="font-mono font-medium">{entry.sailNumber}</span>
                    <span className="text-sm text-muted-foreground flex-1">Unknown — not registered</span>
                    <span className="w-24 text-center text-sm font-mono text-muted-foreground shrink-0">—</span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => setResolvingEntry(entry)}
                    >
                      Resolve
                    </Button>
                    <button
                      onClick={() => removeFinisher(eid)}
                      aria-label={`Remove unknown ${entry.sailNumber}`}
                      className="text-muted-foreground hover:text-foreground shrink-0"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                );
              }

              const competitor = competitorMap.get(entry.competitorId);
              if (!competitor) return null;
              const penalty = finisherPenalties.get(entry.competitorId);
              const hasRedress = redressEntries.has(entry.competitorId);
              const fleetLabel = fleetById.get(competitor.fleetIds[0])?.name ?? '—';
              return (
                <li
                  key={entry.competitorId}
                  className={cn(
                    'flex items-center gap-3 border rounded-lg px-4 py-2.5 transition-colors',
                    hasRedress && 'border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-700',
                    isFlashed && 'ring-2 ring-primary',
                  )}
                >
                  <span className="w-6 text-right text-sm font-mono text-muted-foreground shrink-0">
                    {rowNumber}
                  </span>
                  {isTimed ? (
                    // Timed rows are position-locked by the time-order invariant.
                    // No move affordances — scorer edits the time instead.
                    <div className="w-[14px] shrink-0" aria-hidden />
                  ) : (
                    <div className="flex flex-col shrink-0">
                      <button
                        type="button"
                        data-testid={`move-up-${competitor.sailNumber}`}
                        aria-label={`Move ${competitor.sailNumber} up`}
                        disabled={index === 0}
                        onClick={() => moveRow(index, -1)}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none leading-none text-sm"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        data-testid={`move-down-${competitor.sailNumber}`}
                        aria-label={`Move ${competitor.sailNumber} down`}
                        disabled={index === finishingOrder.length - 1}
                        onClick={() => moveRow(index, 1)}
                        className="text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:pointer-events-none leading-none text-sm"
                      >
                        ↓
                      </button>
                    </div>
                  )}
                  <span className="font-mono font-medium">{competitor.sailNumber}</span>
                  {showFleetBadge && (
                    <Badge variant="secondary" className="text-xs shrink-0" data-testid={`fleet-badge-${competitor.sailNumber}`}>
                      {fleetLabel}
                    </Badge>
                  )}
                  <span className="text-sm truncate flex-1">{displayHelmCrew(competitor, showCrew)}</span>
                  {isTimed ? (
                    <input
                      type="text"
                      value={editingTimes.get(entry.competitorId) ?? finishTimes.get(entry.competitorId) ?? ''}
                      onChange={(e) =>
                        setEditingTimes((prev) => new Map(prev).set(entry.competitorId, e.target.value))
                      }
                      onBlur={(e) => {
                        const competitorId = entry.competitorId;
                        const normalized = normalizeTimeInput(e.target.value);
                        setEditingTimes((prev) => {
                          const nextMap = new Map(prev);
                          nextMap.delete(competitorId);
                          return nextMap;
                        });
                        if (!normalized) return;
                        if (normalized === finishTimes.get(competitorId)) return;
                        const finish = finishByCompetitorId.get(competitorId);
                        if (!finish) return;
                        const updated: Finish = { ...finish, finishTime: normalized };
                        patchCache((rows) => rows.map((r) => (r.id === finish.id ? updated : r)));
                        saveFinish.mutate(updated);
                        void touchSeries.mutateAsync(seriesId);
                        reslotTimedRow(competitorId, normalized);
                      }}
                      placeholder="HH:MM:SS"
                      aria-label={`Finish time for ${competitor.sailNumber}`}
                      data-testid={`finish-time-${competitor.sailNumber}`}
                      className="w-24 shrink-0 font-mono text-sm text-center rounded px-2 py-0.5 border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  ) : (
                    <span className="w-24 text-center text-sm font-mono text-muted-foreground shrink-0">—</span>
                  )}
                  {!isTimed && index > 0 && !((() => { const prev = finishingOrder[index - 1]; return prev.kind === 'known' && needsFinishTime(prev.competitorId); })()) && (
                    <label
                      className="flex items-center gap-1 text-xs text-muted-foreground shrink-0 cursor-pointer"
                      title="Tied with previous row (simultaneous finish, RRS A8.1)"
                    >
                      <input
                        type="checkbox"
                        checked={tiedWithPrevious.has(eid)}
                        onChange={() => toggleTiedWithPrevious(eid)}
                        aria-label={`Tie ${competitor.sailNumber} with previous row`}
                        data-testid={`tie-${competitor.sailNumber}`}
                      />
                      tie
                    </label>
                  )}
                  {penalty && (
                    <Badge
                      variant="outline"
                      className="text-xs shrink-0 cursor-pointer"
                      onClick={() => setEditingPenaltyEntryId(entry.competitorId)}
                    >
                      {penalty.code}
                      {penalty.override != null ? ` (${penalty.override}${penalty.code === 'DPI' ? 'pts' : '%'})` : ''}
                    </Badge>
                  )}
                  <button
                    onClick={() => setEditingPenaltyEntryId(entry.competitorId)}
                    aria-label={`Set penalty for ${competitor.sailNumber}`}
                    title="Set scoring penalty"
                    className="text-muted-foreground hover:text-foreground shrink-0"
                  >
                    <Flag className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => openRedressDialog(entry.competitorId, true)}
                    aria-label={`Set redress for ${competitor.sailNumber}`}
                    title="Set redress (RDG)"
                    className={cn(
                      'shrink-0',
                      hasRedress ? 'text-amber-600 hover:text-amber-700' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Scale className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => removeFinisher(eid)}
                    aria-label={`Remove ${competitor.sailNumber}`}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Right: non-finishers */}
        <div className="space-y-4">
          <h3 className="font-medium">
            Non-finishers{' '}
            <span className="text-sm font-normal text-muted-foreground">
              ({nonFinishers.length})
            </span>
          </h3>

          {nonFinishers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              All competitors are in the finishing order.
            </p>
          ) : (
            <div className="space-y-1.5">
              {nonFinishers.map(({ competitor, code }) => (
                <div
                  key={competitor.id}
                  data-testid={`non-finisher-${competitor.sailNumber}`}
                  className={cn(
                    'flex items-center gap-3 border rounded-lg px-4 py-2',
                    code === 'RDG' && 'border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-700',
                  )}
                >
                  <span className="font-mono font-medium w-16 shrink-0">
                    {competitor.sailNumber}
                  </span>
                  {showFleetBadge && (
                    <Badge variant="outline">
                      {fleetById.get(competitor.fleetIds[0])?.name ?? '—'}
                    </Badge>
                  )}
                  <span className="text-sm flex-1 truncate">{displayHelmCrew(competitor, showCrew)}</span>
                  {code === 'RDG' && (
                    <button
                      type="button"
                      onClick={() => openRedressDialog(competitor.id, false)}
                      aria-label={`Edit redress for ${competitor.sailNumber}`}
                      title="Edit redress"
                      className="text-amber-600 hover:text-amber-700 shrink-0"
                    >
                      <Scale className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <Select
                    value={code}
                    onValueChange={(v) => {
                      if (v === 'RDG') {
                        openRedressDialog(competitor.id, false);
                      } else {
                        // setNonFinisherCode clears redress fields on the row
                        // when transitioning away from RDG.
                        setNonFinisherCode(competitor.id, v as NonFinisherCode);
                      }
                    }}
                  >
                    <SelectTrigger className="w-36 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(codeLabels) as NonFinisherCode[]).map((c) => (
                        <SelectItem key={c} value={c}>
                          {codeLabels[c]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>}

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

      <RowConflictDialog
        info={
          conflict
            ? {
                finishId: conflict.finishId,
                rowLabel: conflict.rowLabel,
                updatedAt: conflict.detail?.updatedAt,
                actor: conflict.detail?.actor,
              }
            : null
        }
        retrying={retryingConflict}
        onKeepMine={resolveConflictKeepMine}
        onUseCurrent={resolveConflictUseCurrent}
        onDismiss={resolveConflictUseCurrent}
      />

      <ResolveUnknownDialog
        unknownSailNumber={resolvingEntry?.sailNumber ?? null}
        candidates={nonFinishers.map((nf) => nf.competitor)}
        fleets={fleets ?? []}
        primaryFieldLabel={primaryFieldLabel}
        showCrew={showCrew}
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
