'use client';

import { useEffect, useRef, useState } from 'react';

import { log } from '@/lib/debug';
import {
  deriveFinishState,
  entryKey,
  makeFinish,
  matchIdentifierPrefix,
  resolveSailEntry,
  type FinishEntry,
  type MatchTier,
  type NonFinisherView,
} from '@/lib/finish-entry';
import { ordinal } from '@/lib/ordinal';
import { formatElapsedInput, normalizeTimeInput, parseElapsedInput } from '@/lib/time-parse';
import type { Competitor, Finish, FinishRecording, Fleet, RaceStart } from '@/lib/types';

/** What the scorer wrote next to a boat, in whichever of the two forms the
 *  race is being recorded in. Exactly one key is set. */
type RecordedFinish =
  | { finishTime: string; elapsedSecs?: undefined }
  | { elapsedSecs: number; finishTime?: undefined };

/** Read what the scorer typed into the form this race is recorded in. */
function readRecordedFinish(raw: string, byElapsed: boolean): RecordedFinish | null {
  if (byElapsed) {
    const elapsedSecs = parseElapsedInput(raw);
    return elapsedSecs != null && elapsedSecs >= 0 ? { elapsedSecs } : null;
  }
  const finishTime = normalizeTimeInput(raw);
  return finishTime ? { finishTime } : null;
}

export interface UseFinishInputArgs {
  raceId: string;
  isHandicapSeries: boolean;
  /** How this race's sheet was taken down: times of day, or elapsed times off
   *  a stopwatch. Absent means the clock. */
  finishRecording?: FinishRecording;
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
  /** Bring an excluded boat into the series (clear `Competitor.excluded`).
   *  Called when the scorer confirms the "include and record finish" prompt
   *  that a typed excluded sail number raises. Absent on a read-only sheet. */
  onIncludeCompetitor?: (competitor: Competitor) => Promise<unknown>;
}

/**
 * The "type a sail number, slot a row" entry flow: input text state,
 * autocomplete suggestions, the pending finish-time step, unknown-sail
 * recording, and the optimistic insert of a new finisher. Committed-row
 * operations live in `useFinishRowOps`.
 */
export function useFinishInput(args: UseFinishInputArgs) {
  const {
    raceId, isHandicapSeries, finishRecording,
    competitors, fleetById, raceStarts,
    derived, nonFinishers, finishedIds,
    saveFinish, patchCache,
    commitOrderChange, flashRow,
    ready, onIncludeCompetitor,
  } = args;
  const { finishingOrder, finishTimes, elapsedSecs, tiedWithPrevious, finishByCompetitorId } = derived;
  const byElapsed = finishRecording === 'elapsed';

  // Input field state
  const [sailInput, setSailInput] = useState('');
  const [inputError, setInputError] = useState('');
  // Informational, not destructive: "2411 is already entered — 12th at
  // 14:32:10." A duplicate on the paper finish sheet is a finding the scorer
  // needs to act on, not a mistake they made.
  const [inputNotice, setInputNotice] = useState('');
  const [pendingUnknownSail, setPendingUnknownSail] = useState<string | null>(null);
  // A typed sail number that resolved to a boat excluded from the series. The
  // boat is on the list, so this isn't an unknown — but it isn't an entrant
  // either, so recording a finish first means including it. Sailwave's Sail
  // Number Wizard does the same on the "include excluded competitors" tick.
  const [pendingExcluded, setPendingExcluded] = useState<{ competitor: Competitor; matchedOn: MatchTier; entered: string } | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  // Pending time entry: competitor confirmed, waiting for finish time.
  // `matchedOn` is carried through so a bow-number match is still recorded on
  // the finish after the time step, not just on the immediate-commit path.
  const [pendingTimeEntry, setPendingTimeEntry] = useState<{ competitor: Competitor; matchedOn: MatchTier; entered: string } | null>(null);
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

  // Which start a boat's elapsed time is measured from. Times of day are
  // comparable across the whole sheet; elapsed times are only comparable
  // within a start, since two fleets on different guns can post the same
  // duration and cross minutes apart. Boats with no start share the key `''`
  // and are compared with each other.
  const startKeyFor = (competitorId: string): string => {
    const c = competitorMap.get(competitorId);
    if (!c) return '';
    for (const s of raceStarts) {
      if (s.fleetIds.some((id) => c.fleetIds.includes(id))) return s.id;
    }
    return '';
  };

  // Returns true if this competitor has at least one fleet with a start
  // configured for this race.
  const hasStartForRace = (competitorId: string): boolean => {
    const c = competitorMap.get(competitorId);
    if (!c) return false;
    return c.fleetIds.some((id) => fleetIdsWithStartTimes.has(id));
  };

  // Suggestions match on sail number first, then bow number (#234). Each row
  // carries which identifier it matched on, so a bow match can be flagged —
  // the row displays the registered sail number, not what the scorer typed.
  const suggestionQuery = sailInput.trim().toUpperCase();
  type MatchedSuggestion = NonFinisherView & { matchedOn: MatchTier; entered: string };
  const suggestions: MatchedSuggestion[] = suggestionQuery
    ? nonFinishers.flatMap((view): MatchedSuggestion[] => {
        const match = matchIdentifierPrefix(view.competitor, suggestionQuery);
        return match ? [{ ...view, ...match }] : [];
      })
    : [];

  // Already-finished boats matching the typed prefix, in finishing order. The
  // committable suggestions above are filtered to non-finishers, which used to
  // mean a duplicate number was met with an empty dropdown — silence a scorer
  // reads as "did I mistype?". These render as muted rows tagged with their
  // position; activating one reveals its row rather than committing anything.
  type AlreadyEnteredMatch = {
    competitor: Competitor;
    matchedOn: MatchTier;
    entered: string;
    position: number;
    rowKey: string;
  };
  const alreadyEntered: AlreadyEnteredMatch[] = suggestionQuery
    ? finishingOrder.flatMap((entry, index): AlreadyEnteredMatch[] => {
        if (entry.kind !== 'known') return [];
        const competitor = competitorMap.get(entry.competitorId);
        if (!competitor) return [];
        const match = matchIdentifierPrefix(competitor, suggestionQuery);
        return match
          ? [{ competitor, ...match, position: index + 1, rowKey: entryKey(entry) }]
          : [];
      })
    : [];

  /** Flash a finishing-order row and bring it into view. Rows carry their
   *  entry-key as a data attribute (see FinishTab), so the scorer is pointed
   *  at the existing entry rather than left to hunt for it. */
  function revealFinishedRow(rowKey: string) {
    flashRow(rowKey);
    // Scroll on the next frame, not synchronously: the notice line set by the
    // caller renders above the list, so a scroll measured against the current
    // layout would leave the row shifted just below the fold. Centering keeps
    // the row clear of both viewport edges.
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-entry-key="${rowKey}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  /** The typed number belongs to a boat already in the order — most often a
   *  duplicate line on the paper finish sheet. Say where the boat already is
   *  (position and time) and reveal its row, so the scorer can judge which
   *  of the two recorded finishes is right. */
  function noticeAlreadyEntered(matched: Competitor[]) {
    const ids = new Set(matched.map((c) => c.id));
    const index = finishingOrder.findIndex((e) => e.kind === 'known' && ids.has(e.competitorId));
    const entry = finishingOrder[index];
    if (entry === undefined || entry.kind !== 'known') return;
    const boat = matched.find((c) => c.id === entry.competitorId);
    const recorded = byElapsed
      ? (() => {
          const secs = elapsedSecs.get(entryKey(entry));
          return secs != null ? ` in ${formatElapsedInput(secs)}` : '';
        })()
      : (() => {
          const time = finishTimes.get(entryKey(entry));
          return time ? ` at ${time}` : '';
        })();
    setInputNotice(
      `${boat?.sailNumber ?? trimmedSail} is already entered — ${ordinal(index + 1)}${recorded}.`,
    );
    revealFinishedRow(entryKey(entry));
  }

  // Core "add this competitor to the finishing order" — optionally with a pre-known finish time.
  // Timed entries are auto-slotted immediately before the next later-timed row, preserving
  // the relative order of scratch rows (time-order invariant, ADR-007).
  function addKnownFinisher(
    competitor: Competitor,
    recorded?: RecordedFinish,
    matchedOn: MatchTier = 'sail',
    entered?: string,
  ) {
    let insertAt = finishingOrder.length;
    if (recorded) {
      // Slot immediately before the first later-recorded row, preserving the
      // relative order of untimed rows (the ADR-007 invariant). In elapsed
      // mode only rows on the same gun are comparable, so the rest are
      // skipped rather than sorted against.
      const startKey = byElapsed ? startKeyFor(competitor.id) : null;
      for (let i = 0; i < finishingOrder.length; i++) {
        const other = finishingOrder[i];
        if (startKey !== null
          && !(other.kind === 'known' && startKeyFor(other.competitorId) === startKey)) continue;
        const existing = byElapsed
          ? elapsedSecs.get(entryKey(other))
          : finishTimes.get(entryKey(other));
        if (existing === undefined) continue;
        if (recorded.elapsedSecs !== undefined
          ? (existing as number) > recorded.elapsedSecs
          : (existing as string) > recorded.finishTime!) {
          insertAt = i;
          break;
        }
      }
    }

    // Only a row that came in under something other than the registered sail
    // number carries the provenance; a plain sail match clears any stale value
    // left by an earlier entry of the same boat.
    const provenance =
      matchedOn === 'sail'
        ? { matchedOn: undefined, enteredSailNumber: undefined }
        : { matchedOn, enteredSailNumber: entered };
    const existing = finishByCompetitorId.get(competitor.id);
    const finishId = existing?.id ?? crypto.randomUUID();
    const newRow: Finish = existing
      ? {
          ...existing,
          sortOrder: insertAt + 1,
          tiedWithPrevious: false,
          ...provenance,
          ...recorded,
        }
      : makeFinish(raceId, {
          id: finishId,
          competitorId: competitor.id,
          sortOrder: insertAt + 1,
          startPresent: true,
          ...(provenance.matchedOn ? provenance : {}),
          ...recorded,
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
    if (recorded) flashRow(competitor.id);
    commitOrderChange(targetOrder, tiedWithPrevious);
    setSailInput('');
    setInputError('');
    setInputNotice('');
    setPendingUnknownSail(null);
    setHighlightedIndex(-1);
    inputRef.current?.focus();
    log('result-entry', 'added finisher', { sail: competitor.sailNumber, competitorId: competitor.id, matchedOn });
  }

  // Route a resolved competitor through time-entry if their fleet has a start time.
  // In a handicap series, block competitors whose fleet has no start configured.
  function commitCompetitor(
    competitor: Competitor,
    matchedOn: MatchTier = 'sail',
    entered?: string,
    opts?: { includeExcluded?: boolean },
  ) {
    if (competitor.excluded && !opts?.includeExcluded) {
      setSailInput('');
      setHighlightedIndex(-1);
      setPendingUnknownSail(null);
      setInputError('');
      setInputNotice('');
      setPendingExcluded({ competitor, matchedOn, entered: entered ?? competitor.sailNumber });
      return;
    }
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
      setInputNotice('');
      setHighlightedIndex(-1);
      setPendingTimeEntry({ competitor, matchedOn, entered: entered ?? competitor.sailNumber });
      setPendingTimeValue('');
      setPendingTimeError('');
    } else {
      addKnownFinisher(competitor, undefined, matchedOn, entered);
    }
  }

  /** The scorer confirmed the prompt: include the boat, then record it as if
   *  it had been entered all along (the time step still applies). */
  async function includePendingExcluded() {
    if (!pendingExcluded) return;
    const pending = pendingExcluded;
    await onIncludeCompetitor?.(pending.competitor);
    setPendingExcluded(null);
    commitCompetitor(pending.competitor, pending.matchedOn, pending.entered, { includeExcluded: true });
  }

  function cancelPendingExcluded() {
    setPendingExcluded(null);
    inputRef.current?.focus();
  }

  function confirmPendingTime() {
    if (!pendingTimeEntry) return;
    if (!pendingTimeValue.trim()) {
      setPendingTimeError(byElapsed ? 'Elapsed time is required.' : 'Finish time is required.');
      return;
    }
    const recorded = readRecordedFinish(pendingTimeValue, byElapsed);
    if (!recorded) {
      setPendingTimeError(byElapsed
        ? 'Enter a valid elapsed time, e.g. 1:04:32 or 4:32.'
        : 'Enter a valid time, e.g. 14:32:10 or 143210.');
      return;
    }
    addKnownFinisher(
      pendingTimeEntry.competitor,
      recorded,
      pendingTimeEntry.matchedOn,
      pendingTimeEntry.entered,
    );
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
    setInputNotice('');
    inputRef.current?.focus();
    log('result-entry', 'recorded unknown finisher', { sail });
  }

  // Whether the current input could be recorded as an unknown boat: non-empty
  // and not an exact registered sail. Drives the "Record as unknown" dropdown
  // row and the Shift+Enter fast path — the record-as-unknown intent no longer
  // depends on the input being unmatched, so a short number that is a prefix
  // of a registered boat (unknown "12" while "12345" is registered) stays
  // recordable even though Enter would prefix-complete it.
  const trimmedSail = sailInput.trim().toUpperCase();
  const canRecordUnknown = trimmedSail !== '' && !sailMap.has(trimmedSail);

  /** File the current input as an unknown boat, if it qualifies. Shared by the
   *  Shift+Enter fast path, the dropdown row, and the highlighted-row Enter. */
  function recordCurrentAsUnknown() {
    if (canRecordUnknown) recordAsUnknown(trimmedSail);
  }

  function addFinisher() {
    setInputNotice('');
    // An explicitly highlighted row wins: either a suggested boat, or the
    // trailing "record as unknown" row (index === suggestions.length).
    if (highlightedIndex >= 0) {
      if (highlightedIndex < suggestions.length) {
        const s = suggestions[highlightedIndex];
        commitCompetitor(s.competitor, s.matchedOn, s.entered);
      } else {
        recordCurrentAsUnknown();
      }
      return;
    }

    const resolution = resolveSailEntry(sailInput, competitors, finishedIds);
    switch (resolution.kind) {
      case 'empty':
        return;
      case 'commit':
        commitCompetitor(resolution.competitor, resolution.matchedOn, resolution.entered);
        return;
      case 'already-finished':
        noticeAlreadyEntered(resolution.competitors);
        return;
      case 'duplicate-sail':
        setInputError(`Multiple boats with sail ${trimmedSail} — select from the list.`);
        return;
      case 'ambiguous-prefix':
        // Real boats match this prefix — keep the dropdown open so the scorer
        // picks or types more, rather than treating it as an unknown sail.
        return;
      case 'unknown':
        setPendingUnknownSail(trimmedSail);
        setInputError(`Sail number "${trimmedSail}" not found in this series.`);
        return;
    }
  }

  /** Clear every in-progress entry state (used after a CSV import replaces
   *  the sheet wholesale). Does not move focus. */
  function reset() {
    setSailInput('');
    setInputError('');
    setInputNotice('');
    setPendingUnknownSail(null);
    setPendingExcluded(null);
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
      notice: inputNotice,
      setNotice: setInputNotice,
      pendingUnknownSail,
      setPendingUnknownSail,
      /** A typed sail number that belongs to an excluded boat, awaiting the
       *  scorer's decision to include it. */
      pendingExcluded,
      includePendingExcluded,
      cancelPendingExcluded,
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
    /** Already-finished boats matching the typed prefix — the dropdown's
     *  muted "already entered" rows. */
    alreadyEntered,
    /** Flash a finishing-order row and scroll it into view. */
    revealFinishedRow,
    /** True when the typed text can be filed as an unknown boat (non-empty,
     *  no exact sail match) — gates the dropdown row and Shift+Enter path. */
    canRecordUnknown,
    needsFinishTime,
    addFinisher,
    commitCompetitor,
    recordAsUnknown,
    recordCurrentAsUnknown,
    reset,
  };
}
