'use client';

import { useEffect, useRef, useState } from 'react';
import { log } from '@/lib/debug';
import { normalizeTimeInput } from '@/lib/time-parse';
import {
  deriveFinishState,
  entryKey,
  makeFinish,
  reorderWithTies,
  type FinishEntry,
} from '@/lib/finish-entry';
import type { Competitor, Finish, Fleet, RaceStart, ResultCode } from '@/lib/types';

export type NonFinisherCode = ResultCode | 'implicit-dnc';

export interface NonFinisherView {
  competitor: Competitor;
  code: NonFinisherCode;
}

export interface UseFinishEntryArgs {
  raceId: string;
  seriesId: string;
  isHandicapSeries: boolean;
  competitors: Competitor[];
  fleets: Fleet[];
  fleetById: Map<string, Fleet>;
  raceStarts: RaceStart[];
  savedFinishes: Finish[] | undefined;
  derived: ReturnType<typeof deriveFinishState>;
  saveFinish: {
    mutate: (f: Finish) => unknown;
    mutateAsync: (f: Finish) => Promise<unknown>;
  };
  deleteFinish: {
    mutate: (input: { id: string; raceId: string }) => unknown;
    mutateAsync: (input: { id: string; raceId: string }) => Promise<unknown>;
  };
  touchSeries: { mutateAsync: (id: string) => Promise<unknown> };
  patchCache: (updater: (rows: Finish[]) => Finish[]) => void;
  /** True once race + competitors have loaded; gates initial focus. */
  ready: boolean;
}

/**
 * Owns the "type a sail number, slot a row" finish-entry flow: input text
 * state, autocomplete, pending time entry, optimistic row writes, and
 * scratch-row reorder. Splits the race result-entry page into a thin JSX
 * shell over a hook full of mutation closures that all share the same
 * derived view-model.
 */
export function useFinishEntry(args: UseFinishEntryArgs) {
  const {
    raceId, seriesId, isHandicapSeries,
    competitors, fleetById, raceStarts, savedFinishes,
    derived,
    saveFinish, deleteFinish, touchSeries,
    patchCache, ready,
  } = args;
  const {
    finishingOrder, finishTimes, tiedWithPrevious,
    finishByEntryKey, finishByCompetitorId, nonFinisherCodes,
  } = derived;

  // Input field state
  const [sailInput, setSailInput] = useState('');
  const [inputError, setInputError] = useState('');
  const [pendingUnknownSail, setPendingUnknownSail] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  // Pending time entry: competitor confirmed, waiting for finish time
  const [pendingTimeEntry, setPendingTimeEntry] = useState<{ competitor: Competitor } | null>(null);
  const [pendingTimeValue, setPendingTimeValue] = useState('');
  const [pendingTimeError, setPendingTimeError] = useState('');
  // Entry-key of a row to briefly flash (recent auto-slot, scratch reorder).
  const [flashedRowId, setFlashedRowId] = useState<string | null>(null);
  // Per-row UI overlay for the finish-time inputs: while a row's input is
  // focused we show the in-progress text; on blur we normalize and persist.
  const [editingTimes, setEditingTimes] = useState<Map<string, string>>(new Map());

  const inputRef = useRef<HTMLInputElement>(null);
  const pendingTimeInputRef = useRef<HTMLInputElement>(null);

  // Initial focus once race + competitors are loaded.
  const didFocusRef = useRef(false);
  useEffect(() => {
    if (!didFocusRef.current && ready) {
      didFocusRef.current = true;
      inputRef.current?.focus();
    }
  }, [ready]);

  // Focus the time input when a pending time entry appears; return focus
  // to sail input when it clears.
  useEffect(() => {
    if (pendingTimeEntry) {
      pendingTimeInputRef.current?.focus();
    } else {
      inputRef.current?.focus();
    }
  }, [pendingTimeEntry]);

  // Clear the row flash after a short delay so the animation only plays
  // once per trigger.
  useEffect(() => {
    if (flashedRowId === null) return;
    const t = setTimeout(() => setFlashedRowId(null), 900);
    return () => clearTimeout(t);
  }, [flashedRowId]);

  // Derived collections
  const sailMap = new Map<string, Competitor[]>();
  for (const c of competitors) {
    const key = c.sailNumber.toUpperCase();
    const arr = sailMap.get(key);
    if (arr) arr.push(c);
    else sailMap.set(key, [c]);
  }

  const fleetIdsWithStartTimes = new Set(raceStarts.flatMap((s) => s.fleetIds));
  const competitorMap = new Map(competitors.map((c) => [c.id, c]));

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

  // Returns true if this competitor has at least one fleet with a start
  // configured for this race.
  const hasStartForRace = (competitorId: string): boolean => {
    const c = competitorMap.get(competitorId);
    if (!c) return false;
    return c.fleetIds.some((id) => fleetIdsWithStartTimes.has(id));
  };

  const finishedIds = new Set(
    finishingOrder.flatMap((e) => (e.kind === 'known' ? [e.competitorId] : [])),
  );

  const nonFinishers: NonFinisherView[] = competitors
    .filter((c) => !finishedIds.has(c.id))
    .map((c) => {
      const explicitCode = nonFinisherCodes.get(c.id);
      const isPresent = savedFinishes?.some(
        (f) => f.competitorId === c.id && f.startPresent === true,
      );
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

  // Core "add this competitor to the finishing order" — optionally with a pre-known finish time.
  // Timed entries are auto-slotted immediately before the next later-timed row, preserving
  // the relative order of scratch rows (time-order invariant, ADR-007).
  function addKnownFinisher(competitor: Competitor, finishTime?: string) {
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
   * Move a scratch row from one index to another (drag-and-drop reorder).
   * No-op if either index is out of range or unchanged. Scratch rows can move
   * freely past timed rows; the moved row briefly flashes at its new position
   * as a visual confirmation. Timed rows are not draggable — their position is
   * determined by the time-order invariant.
   *
   * Ties ("tied with the row above") are recomputed: the row that followed the
   * moved row loses its tie unless the moved row was itself part of that group
   * (so the group continues above it), and the moved row's own tie is cleared
   * since its new predecessor differs.
   */
  function moveRowTo(fromIndex: number, toIndex: number) {
    const keys = finishingOrder.map(entryKey);
    const result = reorderWithTies(keys, tiedWithPrevious, fromIndex, toIndex);
    if (result.keys === keys) return; // no-op (equal or out-of-range indices)
    const byKey = new Map(finishingOrder.map((e) => [entryKey(e), e]));
    const nextOrder = result.keys
      .map((k) => byKey.get(k))
      .filter((e): e is FinishEntry => e !== undefined);
    setFlashedRowId(keys[fromIndex]);
    commitOrderChange(nextOrder, result.ties);
  }

  /**
   * Re-slot a row that already has a finish time after its time has been
   * edited so the time-order invariant holds. Scratch rows keep their
   * relative order; the moved row briefly flashes at its new position.
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

  return {
    // input state
    sailInput,
    setSailInput,
    inputError,
    setInputError,
    pendingUnknownSail,
    setPendingUnknownSail,
    highlightedIndex,
    setHighlightedIndex,
    // pending time
    pendingTimeEntry,
    setPendingTimeEntry,
    pendingTimeValue,
    setPendingTimeValue,
    pendingTimeError,
    setPendingTimeError,
    pendingTimeInputRef,
    // row flash + inline time edit
    flashedRowId,
    editingTimes,
    setEditingTimes,
    // refs
    inputRef,
    // derived
    sailMap,
    finishedIds,
    nonFinishers,
    suggestions,
    needsFinishTime,
    hasStartForRace,
    // handlers
    addFinisher,
    addKnownFinisher,
    commitCompetitor,
    confirmPendingTime,
    cancelPendingTime,
    recordAsUnknown,
    removeFinisher,
    toggleTiedWithPrevious,
    moveRowTo,
    reslotTimedRow,
  };
}
