'use client';

import { useEffect, useRef, useState } from 'react';

import { log } from '@/lib/debug';
import {
  deriveFinishState,
  entryKey,
  makeFinish,
  type FinishEntry,
  type NonFinisherView,
} from '@/lib/finish-entry';
import { normalizeTimeInput } from '@/lib/time-parse';
import type { Competitor, Finish, Fleet, RaceStart } from '@/lib/types';

export interface UseFinishInputArgs {
  raceId: string;
  isHandicapSeries: boolean;
  competitors: Competitor[];
  fleetById: Map<string, Fleet>;
  raceStarts: RaceStart[];
  derived: ReturnType<typeof deriveFinishState>;
  /** Competitors not yet in the finishing order — suggestions filter these. */
  nonFinishers: NonFinisherView[];
  finishedIds: Set<string>;
  saveFinish: { mutate: (f: Finish) => unknown };
  patchCache: (updater: (rows: Finish[]) => Finish[]) => void;
  /** From `useFinishRowOps` — the shared renumber/retag writer. */
  commitOrderChange: (targetOrder: FinishEntry[], targetTies: Set<string>) => void;
  /** From `useFinishRowOps` — briefly highlight a row (auto-slot feedback). */
  flashRow: (entryId: string) => void;
  /** True once race + competitors have loaded; gates initial focus. */
  ready: boolean;
}

/**
 * The "type a sail number, slot a row" entry flow: input text state,
 * autocomplete suggestions, the pending finish-time step, unknown-sail
 * recording, and the optimistic insert of a new finisher. Committed-row
 * operations live in `useFinishRowOps`.
 */
export function useFinishInput(args: UseFinishInputArgs) {
  const {
    raceId, isHandicapSeries,
    competitors, fleetById, raceStarts,
    derived, nonFinishers, finishedIds,
    saveFinish, patchCache,
    commitOrderChange, flashRow,
    ready,
  } = args;
  const { finishingOrder, finishTimes, tiedWithPrevious, finishByCompetitorId } = derived;

  // Input field state
  const [sailInput, setSailInput] = useState('');
  const [inputError, setInputError] = useState('');
  const [pendingUnknownSail, setPendingUnknownSail] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  // Pending time entry: competitor confirmed, waiting for finish time
  const [pendingTimeEntry, setPendingTimeEntry] = useState<{ competitor: Competitor } | null>(null);
  const [pendingTimeValue, setPendingTimeValue] = useState('');
  const [pendingTimeError, setPendingTimeError] = useState('');

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

  // Derived collections
  const sailMap = new Map<string, Competitor[]>();
  for (const c of competitors) {
    const key = c.sailNumber.toUpperCase();
    const arr = sailMap.get(key);
    if (arr) arr.push(c);
    else sailMap.set(key, [c]);
  }

  // Only timed starts count here: needsFinishTime / hasStartForRace gate the
  // handicap elapsed-time entry, which a membership-only start can't satisfy.
  const fleetIdsWithStartTimes = new Set(
    raceStarts.filter((s) => s.startTime).flatMap((s) => s.fleetIds),
  );
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

  const suggestions = sailInput.trim()
    ? nonFinishers.filter(({ competitor }) =>
        competitor.sailNumber.toUpperCase().startsWith(sailInput.trim().toUpperCase()),
      )
    : [];

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
    if (finishTime) flashRow(competitor.id);
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

  /** Clear every in-progress entry state (used after a CSV import replaces
   *  the sheet wholesale). Does not move focus. */
  function reset() {
    setSailInput('');
    setInputError('');
    setPendingUnknownSail(null);
    setHighlightedIndex(-1);
    setPendingTimeEntry(null);
    setPendingTimeValue('');
    setPendingTimeError('');
  }

  return {
    /** The sail-number box: value, error, unknown-sail prompt, highlight. */
    input: {
      value: sailInput,
      setValue: setSailInput,
      error: inputError,
      setError: setInputError,
      pendingUnknownSail,
      setPendingUnknownSail,
      highlightedIndex,
      setHighlightedIndex,
      ref: inputRef,
    },
    /** The "competitor confirmed, waiting for finish time" step. */
    pendingTime: {
      entry: pendingTimeEntry,
      value: pendingTimeValue,
      setValue: setPendingTimeValue,
      error: pendingTimeError,
      setError: setPendingTimeError,
      inputRef: pendingTimeInputRef,
      confirm: confirmPendingTime,
      cancel: cancelPendingTime,
    },
    suggestions,
    needsFinishTime,
    addFinisher,
    commitCompetitor,
    recordAsUnknown,
    reset,
  };
}
