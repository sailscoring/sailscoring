'use client';

import { use, useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { competitorRepo, fleetRepo, raceRepo, finishRepo, raceStartRepo, seriesRepo, ensureFleet } from '@/lib/dexie-repository';
import { defaultEnabledCompetitorFields } from '@/lib/competitor-fields';
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
import type { Competitor, Finish, ResultCode, PenaltyCode, RaceStart } from '@/lib/types';
import { calculateStandings } from '@/lib/scoring';
import { CheckSquare, Square } from 'lucide-react';
import { log } from '@/lib/debug';
import { cn } from '@/lib/utils';
import { useGlobalKeyDown } from '@/hooks/use-keyboard-shortcut';

/**
 * Accept flexible time input: "HH:MM:SS", "H:MM:SS", or bare digits "HHMMSS" / "HMMSS".
 * Returns a normalised "HH:MM:SS" string, or null if the input cannot be parsed.
 */
function normalizeTimeInput(raw: string): string | null {
  const s = raw.trim();
  let h: number, m: number, sec: number;
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(s)) {
    [h, m, sec] = s.split(':').map(Number);
  } else if (/^\d{5,6}$/.test(s)) {
    const p = s.padStart(6, '0');
    h = parseInt(p.slice(0, 2), 10);
    m = parseInt(p.slice(2, 4), 10);
    sec = parseInt(p.slice(4, 6), 10);
  } else {
    return null;
  }
  if (m > 59 || sec > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

type NonFinisherCode = ResultCode | 'implicit-dnc';

type RedressMethod = 'all_races' | 'races_before' | 'stated';
type RedressPoolMode = 'none' | 'exclude' | 'include';

interface RedressEntry {
  method: RedressMethod;
  poolMode: RedressPoolMode;
  excludeRaces: number[];
  includeRaces: number[];
  includeAllLater: boolean;
  statedPoints: string;
}

interface RedressDialogState extends RedressEntry {
  competitorId: string;
  isFinisher: boolean;
  previousCode?: NonFinisherCode;   // for non-finisher: revert on cancel
}

interface NonFinisherEntry {
  competitor: Competitor;
  code: NonFinisherCode;
}

type FinishEntry =
  | { kind: 'known'; competitorId: string }
  | { kind: 'unknown'; tempId: string; sailNumber: string };

function entryId(e: FinishEntry): string {
  return e.kind === 'known' ? e.competitorId : e.tempId;
}

/** Render "Helm / Crew" when the series has crew names enabled and a crew is
 *  set; otherwise just the helm. Used in autocomplete rows and finish lists. */
function displayHelmCrew(competitor: Pick<Competitor, 'name' | 'crewName'>, showCrew: boolean): string {
  if (showCrew && competitor.crewName && competitor.crewName.trim()) {
    return `${competitor.name} / ${competitor.crewName}`;
  }
  return competitor.name;
}

export default function ResultEntryPage({
  params,
}: {
  params: Promise<{ id: string; raceId: string }>;
}) {
  const { id: seriesId, raceId } = use(params);
  const router = useRouter();

  const competitors = useLiveQuery(
    () => competitorRepo.listBySeries(seriesId),
    [seriesId],
  );
  const series = useLiveQuery(() => seriesRepo.get(seriesId), [seriesId]);
  const showCrew =
    (series?.enabledCompetitorFields ?? defaultEnabledCompetitorFields()).includes('crewName');
  const race = useLiveQuery(async () => (await raceRepo.get(raceId)) ?? null, [raceId]);
  const savedFinishes = useLiveQuery(
    () => finishRepo.listByRace(raceId),
    [raceId],
  );
  const fleets = useLiveQuery(
    () => fleetRepo.listBySeries(seriesId),
    [seriesId],
  );
  const allSeriesRaces = useLiveQuery(
    () => raceRepo.listBySeries(seriesId),
    [seriesId],
  );
  const raceStarts = useLiveQuery(
    () => raceStartRepo.listByRace(raceId),
    [raceId],
  ) ?? [];

  // Finishing order: unified crossing-order list (row index = sortOrder). ADR-007.
  const [finishingOrder, setFinishingOrder] = useState<FinishEntry[]>([]);
  // Non-finisher codes: competitorId → code (only explicit overrides from implicit DNC)
  const [nonFinisherCodes, setNonFinisherCodes] = useState<Map<string, ResultCode>>(
    new Map(),
  );
  // Entry ID of a row to briefly flash (recent auto-slot, auto-slide, or scratch reorder).
  const [flashedRowId, setFlashedRowId] = useState<string | null>(null);
  // Entry IDs of rows marked "tied with previous row" — simultaneous-finish case on scratch rows.
  // The scoring engine applies RRS A8.1 averaged ranks to boats sharing the same sortOrder.
  const [tiedWithPrevious, setTiedWithPrevious] = useState<Set<string>>(new Set());
  const initialTiesRef = useRef<Set<string>>(new Set());

  const [activeTab, setActiveTab] = useState<'finish' | 'checkin'>('finish');
  const [sailInput, setSailInput] = useState('');
  const [checkinInput, setCheckinInput] = useState('');
  const [inputError, setInputError] = useState('');
  const [pendingUnknownSail, setPendingUnknownSail] = useState<string | null>(null);
  const [resolvingEntry, setResolvingEntry] = useState<(FinishEntry & { kind: 'unknown' }) | null>(null);
  const [showAddCompetitorForm, setShowAddCompetitorForm] = useState(false);
  const [newCompetitorSail, setNewCompetitorSail] = useState('');
  const [newCompetitorName, setNewCompetitorName] = useState('');
  const [newCompetitorFleet, setNewCompetitorFleet] = useState('');
  const [addCompetitorError, setAddCompetitorError] = useState('');
  const [addingCompetitor, setAddingCompetitor] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  // Pending time entry: competitor confirmed, waiting for finish time before adding to list
  const [pendingTimeEntry, setPendingTimeEntry] = useState<{ competitor: Competitor } | null>(null);
  const [pendingTimeValue, setPendingTimeValue] = useState('');
  const [pendingTimeError, setPendingTimeError] = useState('');
  const pendingTimeInputRef = useRef<HTMLInputElement>(null);
  // Race starts section
  const [startsExpanded, setStartsExpanded] = useState(false);
  // Race starts dialog
  const [startDialog, setStartDialog] = useState<{ editingId: string | null } | null>(null);
  const [startTimeInput, setStartTimeInput] = useState('');
  const [startFleetIds, setStartFleetIds] = useState<string[]>([]);
  const [startDialogError, setStartDialogError] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showAllCheckin, setShowAllCheckin] = useState(false);
  // Finish times: competitorId → "HH:MM:SS"
  const [finishTimes, setFinishTimes] = useState<Map<string, string>>(new Map());
  const initialFinishTimesRef = useRef<Map<string, string>>(new Map());
  // Additive penalties: entryId → { code, override }
  const [finisherPenalties, setFinisherPenalties] = useState<Map<string, { code: PenaltyCode; override: number | null }>>(new Map());
  const initialPenaltiesRef = useRef<Map<string, { code: PenaltyCode; override: number | null }>>(new Map());
  // Redress: competitorId → redress entry
  const [redressEntries, setRedressEntries] = useState<Map<string, RedressEntry>>(new Map());
  const initialRedressRef = useRef<Map<string, RedressEntry>>(new Map());
  const [redressDialog, setRedressDialog] = useState<RedressDialogState | null>(null);
  // Penalty editor dialog
  const [editingPenaltyEntryId, setEditingPenaltyEntryId] = useState<string | null>(null);
  const [pendingPenaltyCode, setPendingPenaltyCode] = useState<PenaltyCode | 'none'>('none');
  const [pendingPenaltyOverride, setPendingPenaltyOverride] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);
  const initialOrderRef = useRef<FinishEntry[]>([]);
  const initialCodesRef = useRef<Map<string, ResultCode>>(new Map());

  // Initialize form state from saved finishes once loaded
  if (!initialized && competitors !== undefined && savedFinishes !== undefined) {
    // Row order is crossing order (ADR-007). Build the list sorted by the stored sortOrder.
    const positionedFinishes = savedFinishes
      .filter((f) => f.sortOrder !== null)
      .sort((a, b) => a.sortOrder! - b.sortOrder!);

    const order: FinishEntry[] = positionedFinishes.map((f) => {
      if (f.competitorId !== null) {
        return { kind: 'known', competitorId: f.competitorId };
      } else {
        return { kind: 'unknown', tempId: crypto.randomUUID(), sailNumber: f.unknownSailNumber ?? '' };
      }
    });

    const finishedIds = new Set(
      order.flatMap((e) => e.kind === 'known' ? [e.competitorId] : []),
    );
    const codes = new Map<string, ResultCode>();
    for (const finish of savedFinishes) {
      if (finish.sortOrder === null && finish.resultCode && finish.resultCode !== 'DNC' && finish.competitorId && !finishedIds.has(finish.competitorId)) {
        codes.set(finish.competitorId, finish.resultCode);
      }
    }

    const penalties = new Map<string, { code: PenaltyCode; override: number | null }>();
    for (const finish of savedFinishes) {
      if (finish.penaltyCode && finish.competitorId && finishedIds.has(finish.competitorId)) {
        penalties.set(finish.competitorId, { code: finish.penaltyCode, override: finish.penaltyOverride ?? null });
      }
    }

    const redress = new Map<string, RedressEntry>();
    for (const finish of savedFinishes) {
      if (finish.resultCode === 'RDG' && finish.competitorId && finish.redressMethod) {
        const hasExclude = (finish.redressExcludeRaces?.length ?? 0) > 0;
        const hasInclude = (finish.redressIncludeRaces?.length ?? 0) > 0 || finish.redressIncludeAllLater;
        redress.set(finish.competitorId, {
          method: finish.redressMethod as RedressMethod,
          poolMode: hasExclude ? 'exclude' : hasInclude ? 'include' : 'none',
          excludeRaces: finish.redressExcludeRaces ?? [],
          includeRaces: finish.redressIncludeRaces ?? [],
          includeAllLater: finish.redressIncludeAllLater ?? false,
          statedPoints: finish.redressPoints != null ? String(finish.redressPoints) : '',
        });
      }
    }

    const times = new Map<string, string>();
    for (const finish of savedFinishes) {
      if (finish.finishTime && finish.competitorId) {
        times.set(finish.competitorId, finish.finishTime);
      }
    }

    // Derive the "tied with previous" set from consecutive equal sortOrder values.
    const ties = new Set<string>();
    for (let i = 1; i < positionedFinishes.length; i++) {
      if (positionedFinishes[i].sortOrder === positionedFinishes[i - 1].sortOrder) {
        ties.add(entryId(order[i]));
      }
    }

    initialOrderRef.current = [...order];
    initialCodesRef.current = new Map(codes);
    initialPenaltiesRef.current = new Map(penalties);
    initialRedressRef.current = new Map(redress);
    initialFinishTimesRef.current = new Map(times);
    initialTiesRef.current = new Set(ties);
    setFinishingOrder(order);
    setTiedWithPrevious(ties);
    setNonFinisherCodes(codes);
    setFinisherPenalties(penalties);
    setRedressEntries(redress);
    setFinishTimes(times);
    setInitialized(true);
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

  function isDirty(): boolean {
    if (!initialized) return false;
    // Order matters: compare finishingOrder against initial order by entry ID.
    const initOrder = initialOrderRef.current;
    if (finishingOrder.length !== initOrder.length) return true;
    for (let i = 0; i < finishingOrder.length; i++) {
      if (entryId(finishingOrder[i]) !== entryId(initOrder[i])) return true;
    }
    const initCodes = initialCodesRef.current;
    if (nonFinisherCodes.size !== initCodes.size) return true;
    for (const [k, v] of nonFinisherCodes) {
      if (initCodes.get(k) !== v) return true;
    }
    const initPenalties = initialPenaltiesRef.current;
    if (finisherPenalties.size !== initPenalties.size) return true;
    for (const [k, v] of finisherPenalties) {
      const init = initPenalties.get(k);
      if (!init || init.code !== v.code || init.override !== v.override) return true;
    }
    const initRedress = initialRedressRef.current;
    if (redressEntries.size !== initRedress.size) return true;
    for (const [k, v] of redressEntries) {
      const init = initRedress.get(k);
      if (!init) return true;
      if (init.method !== v.method || init.poolMode !== v.poolMode ||
          init.statedPoints !== v.statedPoints || init.includeAllLater !== v.includeAllLater ||
          JSON.stringify(init.excludeRaces) !== JSON.stringify(v.excludeRaces) ||
          JSON.stringify(init.includeRaces) !== JSON.stringify(v.includeRaces)) return true;
    }
    const initTimes = initialFinishTimesRef.current;
    if (finishTimes.size !== initTimes.size) return true;
    for (const [k, v] of finishTimes) {
      if (initTimes.get(k) !== v) return true;
    }
    const initTies = initialTiesRef.current;
    if (tiedWithPrevious.size !== initTies.size) return true;
    for (const k of tiedWithPrevious) {
      if (!initTies.has(k)) return true;
    }
    return false;
  }

  function tryLeave() {
    if (isDirty()) {
      setShowLeaveConfirm(true);
    } else {
      router.push(`/series/${seriesId}/races`);
    }
  }

  // Ctrl+Enter to save; Esc to cancel; c to toggle check-in tab
  function openAddStart() {
    setStartsExpanded(true);
    setStartTimeInput('');
    setStartFleetIds([]);
    setStartDialogError('');
    setStartDialog({ editingId: null });
  }

  function openEditStart(s: RaceStart) {
    setStartTimeInput(s.startTime);
    setStartFleetIds([...s.fleetIds]);
    setStartDialogError('');
    setStartDialog({ editingId: s.id });
  }

  async function handleSaveStart() {
    const normalizedStart = normalizeTimeInput(startTimeInput);
    if (!normalizedStart) {
      setStartDialogError('Enter a valid time, e.g. 14:05:00 or 140500.');
      return;
    }
    if (startFleetIds.length === 0) {
      setStartDialogError('Select at least one fleet.');
      return;
    }
    // Validate: no fleet in two start groups for this race
    const otherStarts = raceStarts.filter((s) => s.id !== startDialog?.editingId);
    const usedFleetIds = new Set(otherStarts.flatMap((s) => s.fleetIds));
    const conflict = startFleetIds.find((id) => usedFleetIds.has(id));
    if (conflict) {
      const name = fleets?.find((f) => f.id === conflict)?.name ?? conflict;
      setStartDialogError(`Fleet "${name}" is already in another start group.`);
      return;
    }
    const raceStart: RaceStart = {
      id: startDialog?.editingId ?? crypto.randomUUID(),
      raceId,
      fleetIds: startFleetIds,
      startTime: normalizedStart,
    };
    await raceStartRepo.save(raceStart);
    await seriesRepo.touch(seriesId);
    setStartDialog(null);
  }

  async function handleDeleteStart(id: string) {
    await raceStartRepo.delete(id);
    await seriesRepo.touch(seriesId);
  }

  useGlobalKeyDown((e) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (
      e.key === 'Escape' &&
      !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName ?? '')
    ) {
      e.preventDefault();
      tryLeave();
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
    const newEntry: FinishEntry = { kind: 'known', competitorId: competitor.id };

    if (finishTime) {
      setFinishTimes((prev) => new Map(prev).set(competitor.id, finishTime));
      setFinishingOrder((order) => {
        // Find the first existing entry whose stored finishTime is later than the new one.
        let insertAt = order.length;
        for (let i = 0; i < order.length; i++) {
          const existingTime = finishTimes.get(entryId(order[i]));
          if (existingTime !== undefined && existingTime > finishTime) {
            insertAt = i;
            break;
          }
        }
        return [...order.slice(0, insertAt), newEntry, ...order.slice(insertAt)];
      });
      setFlashedRowId(competitor.id);
    } else {
      setFinishingOrder((order) => [...order, newEntry]);
    }
    setSailInput('');
    setInputError('');
    setPendingUnknownSail(null);
    setHighlightedIndex(-1);
    inputRef.current?.focus();
    log('result-entry', 'added finisher', { sail: competitor.sailNumber, competitorId: competitor.id });
  }

  // Route a resolved competitor through time-entry if their fleet has a start time.
  // When any handicap fleet exists in the series, block competitors whose fleet
  // has no start configured — the scorer needs to add a start first.
  function commitCompetitor(competitor: Competitor) {
    if (hasNonScratchFleets && !hasStartForRace(competitor.id)) {
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
    const tempId = crypto.randomUUID();
    setFinishingOrder((order) => [...order, { kind: 'unknown', tempId, sailNumber: sail }]);
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
    setFinishingOrder((order) => order.filter((e) => entryId(e) !== eid));
    setFinisherPenalties((prev) => {
      const next = new Map(prev);
      next.delete(eid);
      return next;
    });
    setRedressEntries((prev) => {
      const next = new Map(prev);
      next.delete(eid);
      return next;
    });
    setFinishTimes((prev) => {
      const next = new Map(prev);
      next.delete(eid);
      return next;
    });
    setTiedWithPrevious((prev) => {
      if (!prev.has(eid)) return prev;
      const next = new Set(prev);
      next.delete(eid);
      return next;
    });
  }

  function toggleTiedWithPrevious(eid: string) {
    setTiedWithPrevious((prev) => {
      const next = new Set(prev);
      if (next.has(eid)) next.delete(eid);
      else next.add(eid);
      return next;
    });
  }

  /**
   * Move a scratch row by one step in the given direction. No-op if it would
   * fall off the list. Scratch rows can freely move past timed rows; the
   * moved row briefly flashes at its new position as a visual confirmation.
   * Timed rows never have move affordances — their position is determined by
   * the time-order invariant.
   */
  function moveRow(index: number, direction: -1 | 1) {
    setFinishingOrder((order) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= order.length) return order;
      const next = [...order];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      setFlashedRowId(entryId(moved));
      return next;
    });
  }

  /**
   * Re-slot a row that already has a finish time after its time has been edited
   * so the time-order invariant holds. Scratch rows keep their relative order;
   * the moved row briefly flashes at its new position.
   */
  function reslotTimedRow(eid: string, nextTime: string) {
    setFinishingOrder((order) => {
      const currentIndex = order.findIndex((e) => entryId(e) === eid);
      if (currentIndex === -1) return order;
      const without = [...order.slice(0, currentIndex), ...order.slice(currentIndex + 1)];
      let insertAt = without.length;
      for (let i = 0; i < without.length; i++) {
        const otherId = entryId(without[i]);
        if (otherId === eid) continue;
        const otherTime = finishTimes.get(otherId);
        if (otherTime !== undefined && otherTime > nextTime) {
          insertAt = i;
          break;
        }
      }
      if (insertAt === currentIndex) return order;
      const next = [...without.slice(0, insertAt), order[currentIndex], ...without.slice(insertAt)];
      setFlashedRowId(eid);
      return next;
    });
  }

  function openPenaltyEditor(eid: string) {
    const existing = finisherPenalties.get(eid);
    setPendingPenaltyCode(existing?.code ?? 'none');
    setPendingPenaltyOverride(existing?.override != null ? String(existing.override) : '');
    setEditingPenaltyEntryId(eid);
  }

  function applyPenalty() {
    if (!editingPenaltyEntryId) return;
    if (pendingPenaltyCode === 'none') {
      // Clear penalty
      setFinisherPenalties((prev) => {
        const next = new Map(prev);
        next.delete(editingPenaltyEntryId);
        return next;
      });
    } else {
      const override = pendingPenaltyOverride.trim() ? Number(pendingPenaltyOverride) : null;
      setFinisherPenalties((prev) =>
        new Map(prev).set(editingPenaltyEntryId, { code: pendingPenaltyCode as PenaltyCode, override }),
      );
    }
    setEditingPenaltyEntryId(null);
  }

  function openRedressDialog(competitorId: string, isFinisher: boolean, previousCode?: NonFinisherCode) {
    const existingEntry = redressEntries.get(competitorId);
    setRedressDialog({
      competitorId,
      isFinisher,
      previousCode,
      method: existingEntry?.method ?? 'all_races',
      poolMode: existingEntry?.poolMode ?? 'none',
      excludeRaces: existingEntry?.excludeRaces ?? [],
      includeRaces: existingEntry?.includeRaces ?? [],
      includeAllLater: existingEntry?.includeAllLater ?? false,
      statedPoints: existingEntry?.statedPoints ?? '',
    });
  }

  function applyRedress() {
    if (!redressDialog) return;
    const { competitorId, isFinisher, ...entry } = redressDialog;
    setRedressEntries((prev) => new Map(prev).set(competitorId, {
      method: entry.method,
      poolMode: entry.poolMode,
      excludeRaces: entry.excludeRaces,
      includeRaces: entry.includeRaces,
      includeAllLater: entry.includeAllLater,
      statedPoints: entry.statedPoints,
    }));
    if (!isFinisher) {
      setNonFinisherCodes((m) => new Map(m).set(competitorId, 'RDG'));
    }
    setRedressDialog(null);
  }

  function removeRedress() {
    if (!redressDialog) return;
    const { competitorId, isFinisher } = redressDialog;
    setRedressEntries((prev) => {
      const next = new Map(prev);
      next.delete(competitorId);
      return next;
    });
    if (!isFinisher) {
      setNonFinisherCodes((m) => {
        const next = new Map(m);
        next.delete(competitorId);
        return next;
      });
    }
    setRedressDialog(null);
  }

  function setNonFinisherCode(competitorId: string, code: NonFinisherCode) {
    if (code === 'implicit-dnc') {
      setNonFinisherCodes((m) => {
        const next = new Map(m);
        next.delete(competitorId);
        return next;
      });
    } else {
      setNonFinisherCodes((m) => new Map(m).set(competitorId, code));
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
          await finishRepo.save({ ...existing, startPresent: false });
        } else {
          // Pure check-in-only record — delete it entirely
          await finishRepo.delete(existing.id);
        }
      } else if (existing) {
        // Has other data — clear just the flag
        await finishRepo.save({ ...existing, startPresent: false });
      } else {
        // Implicitly present via finishing order but no DB record yet — create explicit absence record
        await finishRepo.save({
          id: crypto.randomUUID(),
          raceId,
          competitorId: competitor.id,
          sortOrder: null,
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
        await finishRepo.save({ ...existing, startPresent: true });
      } else {
        await finishRepo.save({
          id: crypto.randomUUID(),
          raceId,
          competitorId: competitor.id,
          sortOrder: null,
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
    await seriesRepo.touch(seriesId);
  }

  function openAddCompetitorForm() {
    setNewCompetitorSail(resolvingEntry?.sailNumber ?? '');
    setNewCompetitorName('');
    setNewCompetitorFleet(fleets?.[0]?.name ?? '');
    setAddCompetitorError('');
    setShowAddCompetitorForm(true);
  }

  function closeResolveDialog() {
    setResolvingEntry(null);
    setShowAddCompetitorForm(false);
    setNewCompetitorSail('');
    setNewCompetitorName('');
    setAddCompetitorError('');
    setAddingCompetitor(false);
    inputRef.current?.focus();
  }

  async function handleAddCompetitor() {
    if (!resolvingEntry) return;
    const name = newCompetitorName.trim();
    const sail = newCompetitorSail.trim().toUpperCase();
    if (!name) { setAddCompetitorError('Helm name is required.'); return; }
    if (!sail) { setAddCompetitorError('Sail number is required.'); return; }

    setAddingCompetitor(true);
    setAddCompetitorError('');
    try {
      const fleetId = await ensureFleet(seriesId, newCompetitorFleet.trim());
      const competitor: Competitor = {
        id: crypto.randomUUID(),
        seriesId,
        fleetIds: [fleetId],
        sailNumber: sail,
        name,
        club: '',
        gender: '',
        age: null,
        createdAt: Date.now(),
      };
      await competitorRepo.save(competitor);
      await seriesRepo.touch(seriesId);

      // Resolve the unknown entry to the new competitor
      const eid = resolvingEntry.tempId;
      setFinishingOrder((order) =>
        order.map((e) =>
          e.kind === 'unknown' && e.tempId === eid
            ? { kind: 'known', competitorId: competitor.id }
            : e,
        ),
      );
      closeResolveDialog();
    } catch (err) {
      console.error(err);
      setAddCompetitorError('Failed to add competitor. Please try again.');
      setAddingCompetitor(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaveError('');
    try {
      // Preserve startPresent data from existing finishes (set via check-in)
      const existing = await finishRepo.listByRace(raceId);
      const startPresentMap = new Map(
        existing
          .filter((f): f is Finish & { competitorId: string } => f.competitorId !== null && f.startPresent !== null)
          .map((f) => [f.competitorId, f.startPresent as boolean]),
      );

      const finishes: Finish[] = [];

      // Finishers — sortOrder is the row index (crossing-order, ADR-007).
      // Rows marked "tied with previous" share sortOrder with the preceding row
      // so the scoring engine applies RRS A8.1 averaged ranks.
      const sortOrders: number[] = [];
      finishingOrder.forEach((entry, index) => {
        const eid = entryId(entry);
        if (index > 0 && tiedWithPrevious.has(eid)) {
          sortOrders.push(sortOrders[index - 1]);
        } else {
          sortOrders.push(index + 1);
        }
      });
      finishingOrder.forEach((entry, index) => {
        const sortOrder = sortOrders[index];
        if (entry.kind === 'known') {
          const penalty = finisherPenalties.get(entry.competitorId);
          const rdg = redressEntries.get(entry.competitorId);
          const ft = finishTimes.get(entry.competitorId);
          finishes.push({
            id: crypto.randomUUID(),
            raceId,
            competitorId: entry.competitorId,
            sortOrder,
            resultCode: rdg ? 'RDG' : null,
            startPresent: startPresentMap.get(entry.competitorId) ?? true,
            penaltyCode: penalty?.code ?? null,
            penaltyOverride: penalty?.override ?? null,
            redressMethod: rdg?.method ?? null,
            redressExcludeRaces: rdg?.poolMode === 'exclude' ? rdg.excludeRaces : null,
            redressIncludeRaces: rdg?.poolMode === 'include' ? rdg.includeRaces : null,
            redressIncludeAllLater: rdg?.poolMode === 'include' ? (rdg.includeAllLater ?? false) : false,
            redressPoints: rdg?.method === 'stated' ? (Number(rdg.statedPoints) || null) : null,
            ...(ft ? { finishTime: ft } : {}),
          });
        } else {
          finishes.push({
            id: crypto.randomUUID(),
            raceId,
            competitorId: null,
            unknownSailNumber: entry.sailNumber,
            sortOrder,
            resultCode: null,
            startPresent: null,
            penaltyCode: null,
            penaltyOverride: null,
            redressMethod: null,
            redressExcludeRaces: null,
            redressIncludeRaces: null,
            redressIncludeAllLater: false,
            redressPoints: null,
          });
        }
      });

      // Non-finishers with explicit codes
      for (const [competitorId, code] of nonFinisherCodes) {
        if (!finishedIds.has(competitorId)) {
          const rdg = code === 'RDG' ? redressEntries.get(competitorId) : undefined;
          finishes.push({
            id: crypto.randomUUID(),
            raceId,
            competitorId,
            sortOrder: null,
            resultCode: code,
            startPresent: startPresentMap.get(competitorId) ?? null,
            penaltyCode: null,
            penaltyOverride: null,
            redressMethod: rdg?.method ?? null,
            redressExcludeRaces: rdg?.poolMode === 'exclude' ? rdg.excludeRaces : null,
            redressIncludeRaces: rdg?.poolMode === 'include' ? rdg.includeRaces : null,
            redressIncludeAllLater: rdg?.poolMode === 'include' ? (rdg.includeAllLater ?? false) : false,
            redressPoints: rdg?.method === 'stated' ? (Number(rdg.statedPoints) || null) : null,
          });
        }
      }

      // Check-in-only records: competitors with startPresent=true but not in finish list or codes
      const accountedIds = new Set([
        ...finishingOrder.flatMap((e) => e.kind === 'known' ? [e.competitorId] : []),
        ...nonFinisherCodes.keys(),
      ]);
      for (const [competitorId, present] of startPresentMap) {
        if (present && !accountedIds.has(competitorId)) {
          finishes.push({
            id: crypto.randomUUID(),
            raceId,
            competitorId,
            sortOrder: null,
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

      log('result-entry', 'saving finishes', { raceId, count: finishes.length });
      await finishRepo.deleteByRace(raceId);
      await finishRepo.saveMany(finishes);
      await seriesRepo.touch(seriesId);
      router.push(`/series/${seriesId}/races`);
    } catch (err) {
      console.error(err);
      setSaveError('Failed to save results. Please try again.');
      setSaving(false);
    }
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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Race {race.raceNumber} — results</h2>
        <p className="text-sm text-muted-foreground">{race.date}</p>
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

      {/* Race starts — only shown for series with non-scratch fleets */}
      {activeTab === 'finish' && hasNonScratchFleets && (
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

      {/* Add / Edit start dialog */}
      <Dialog open={startDialog !== null} onOpenChange={(open) => { if (!open) setStartDialog(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{startDialog?.editingId ? 'Edit start' : 'Add start'}</DialogTitle>
            <DialogDescription>Record the gun time for a group of fleets.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Gun time</label>
              <input
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono shadow-sm"
                value={startTimeInput}
                onChange={(e) => { setStartTimeInput(e.target.value); setStartDialogError(''); }}
                placeholder="14:05:00"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveStart(); }}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Fleets in this start</label>
              <div className="space-y-1.5">
                {(fleets ?? []).map((f) => (
                  <label key={f.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={startFleetIds.includes(f.id)}
                      onChange={(e) => {
                        setStartFleetIds((prev) =>
                          e.target.checked ? [...prev, f.id] : prev.filter((id) => id !== f.id),
                        );
                        setStartDialogError('');
                      }}
                      className="h-4 w-4 rounded border"
                    />
                    {f.name}
                    {f.scoringSystem !== 'scratch' && (
                      <span className="text-xs text-muted-foreground">({f.scoringSystem.toUpperCase()})</span>
                    )}
                  </label>
                ))}
              </div>
            </div>
            {startDialogError && <p className="text-sm text-destructive">{startDialogError}</p>}
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setStartDialog(null)}>Cancel</Button>
            <Button onClick={handleSaveStart}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>

      {activeTab === 'finish' && <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Left: finishing order */}
        <div className="space-y-4">
          <h3 className="font-medium">Finishing order</h3>

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
                      tryLeave();
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
              const eid = entryId(entry);
              const rowNumber = index + 1;
              const isFlashed = flashedRowId === eid;
              const isTimed = entry.kind === 'known' && needsFinishTime(entry.competitorId);

              if (entry.kind === 'unknown') {
                return (
                  <li
                    key={entry.tempId}
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
                      value={finishTimes.get(entry.competitorId) ?? ''}
                      onChange={(e) => setFinishTimes((prev) => new Map(prev).set(entry.competitorId, e.target.value))}
                      onBlur={(e) => {
                        const normalized = normalizeTimeInput(e.target.value);
                        if (normalized) {
                          setFinishTimes((prev) => new Map(prev).set(entry.competitorId, normalized));
                          reslotTimedRow(entry.competitorId, normalized);
                        }
                      }}
                      placeholder="HH:MM:SS"
                      aria-label={`Finish time for ${competitor.sailNumber}`}
                      data-testid={`finish-time-${competitor.sailNumber}`}
                      className="w-24 shrink-0 font-mono text-sm text-center rounded px-2 py-0.5 border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  ) : (
                    <span className="w-24 text-center text-sm font-mono text-muted-foreground shrink-0">—</span>
                  )}
                  {!isTimed && index > 0 && (
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
                      onClick={() => openPenaltyEditor(entry.competitorId)}
                    >
                      {penalty.code}
                      {penalty.override != null ? ` (${penalty.override}${penalty.code === 'DPI' ? 'pts' : '%'})` : ''}
                    </Badge>
                  )}
                  <button
                    onClick={() => openPenaltyEditor(entry.competitorId)}
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
                  <span className="text-sm flex-1 truncate">{displayHelmCrew(competitor, showCrew)}</span>
                  {code === 'RDG' && (
                    <button
                      type="button"
                      onClick={() => openRedressDialog(competitor.id, false, 'RDG')}
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
                        openRedressDialog(competitor.id, false, code);
                      } else {
                        if (code === 'RDG') {
                          setRedressEntries((prev) => {
                            const next = new Map(prev);
                            next.delete(competitor.id);
                            return next;
                          });
                        }
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
        <Button onClick={handleSave} disabled={saving} title="Save results (⌃↵)">
          {saving ? 'Saving…' : 'Save results'}
        </Button>
        <Button
          variant="outline"
          onClick={tryLeave}
          disabled={saving}
        >
          Cancel
        </Button>
        <div className="ml-auto text-sm text-muted-foreground">
          {finishingOrder.length} finisher{finishingOrder.length === 1 ? '' : 's'}
          {unknownCount > 0 && ` (${unknownCount} unknown)`},{' '}
          {nonFinishers.length} non-finisher{nonFinishers.length === 1 ? '' : 's'}
        </div>
        {saveError && <p className="text-sm text-destructive">{saveError}</p>}
      </div>

      <Dialog open={showLeaveConfirm} onOpenChange={(open) => { if (!open) setShowLeaveConfirm(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
            <DialogDescription>You have unsaved changes. Save before leaving?</DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 pt-2">
            <Button onClick={() => { setShowLeaveConfirm(false); handleSave(); }}>
              Save results
            </Button>
            <Button variant="outline" onClick={() => { setShowLeaveConfirm(false); router.push(`/series/${seriesId}/races`); }}>
              Discard
            </Button>
            <Button variant="ghost" onClick={() => setShowLeaveConfirm(false)}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Resolve unknown competitor dialog */}
      <Dialog
        open={resolvingEntry !== null}
        onOpenChange={(open) => { if (!open) closeResolveDialog(); }}
      >
        <DialogContent
          className="max-w-sm"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              closeResolveDialog();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Resolve sail {resolvingEntry?.sailNumber}</DialogTitle>
            <DialogDescription>
              {!showAddCompetitorForm
                ? 'Select a registered competitor, or add a new one.'
                : 'Add a new competitor and link them to this finish.'}
            </DialogDescription>
          </DialogHeader>

          {!showAddCompetitorForm ? (
            <>
              <div className="space-y-1 max-h-52 overflow-y-auto">
                {nonFinishers.length === 0 ? (
                  <p className="text-sm text-muted-foreground px-3 py-2">
                    No unfinished competitors available.
                  </p>
                ) : (
                  nonFinishers.map(({ competitor }) => (
                    <button
                      key={competitor.id}
                      type="button"
                      className="w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-accent text-sm text-left"
                      onClick={() => {
                        if (!resolvingEntry) return;
                        const eid = resolvingEntry.tempId;
                        setFinishingOrder((order) =>
                          order.map((e) =>
                            e.kind === 'unknown' && e.tempId === eid
                              ? { kind: 'known', competitorId: competitor.id }
                              : e,
                          ),
                        );
                        closeResolveDialog();
                      }}
                    >
                      <span className="font-mono font-medium w-16 shrink-0">{competitor.sailNumber}</span>
                      <span className="flex-1 truncate">{displayHelmCrew(competitor, showCrew)}</span>
                    </button>
                  ))
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <div className="flex-1 border-t" />
                <span>or</span>
                <div className="flex-1 border-t" />
              </div>
              <Button variant="outline" size="sm" onClick={openAddCompetitorForm}>
                Add new competitor
              </Button>
              <Button variant="ghost" size="sm" onClick={closeResolveDialog}>
                Keep as unknown
              </Button>
            </>
          ) : (
            <>
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor="resolve-sail">Sail number</label>
                  <Input
                    id="resolve-sail"
                    value={newCompetitorSail}
                    onChange={(e) => setNewCompetitorSail(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor="resolve-name">Helm name *</label>
                  <Input
                    id="resolve-name"
                    value={newCompetitorName}
                    onChange={(e) => setNewCompetitorName(e.target.value)}
                    autoComplete="off"
                    autoFocus
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddCompetitor(); } }}
                  />
                </div>
                {(fleets ?? []).length > 1 && (
                  <div className="space-y-1">
                    <label className="text-sm font-medium" htmlFor="resolve-fleet">Fleet</label>
                    <Select value={newCompetitorFleet} onValueChange={setNewCompetitorFleet}>
                      <SelectTrigger id="resolve-fleet">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(fleets ?? []).map((f) => (
                          <SelectItem key={f.id} value={f.name}>{f.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {addCompetitorError && (
                  <p className="text-sm text-destructive">{addCompetitorError}</p>
                )}
              </div>
              <div className="flex gap-2">
                <Button onClick={handleAddCompetitor} disabled={addingCompetitor} size="sm">
                  {addingCompetitor ? 'Adding…' : 'Add and resolve'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAddCompetitorForm(false)}
                  disabled={addingCompetitor}
                >
                  Back
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Penalty editor dialog */}
      <Dialog open={editingPenaltyEntryId !== null} onOpenChange={(open) => { if (!open) setEditingPenaltyEntryId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Scoring penalty — {editingPenaltyEntryId ? (competitorMap.get(editingPenaltyEntryId)?.sailNumber ?? '') : ''}
            </DialogTitle>
            <DialogDescription>
              Additive penalty codes (A6.2): other boats keep their scores.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Penalty</label>
              <Select value={pendingPenaltyCode} onValueChange={(v) => { setPendingPenaltyCode(v as PenaltyCode | 'none'); setPendingPenaltyOverride(''); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No penalty</SelectItem>
                  <SelectItem value="ZFP">ZFP — Z Flag (20%)</SelectItem>
                  <SelectItem value="SCP">SCP — Scoring Penalty (%)</SelectItem>
                  <SelectItem value="DPI">DPI — Discretionary Points</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(pendingPenaltyCode as string) === 'SCP' && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Percentage (default 20)</label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  placeholder="20"
                  value={pendingPenaltyOverride}
                  onChange={(e) => setPendingPenaltyOverride(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyPenalty(); } }}
                  autoFocus
                />
              </div>
            )}
            {(pendingPenaltyCode as string) === 'DPI' && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Points to add</label>
                <Input
                  type="number"
                  min={1}
                  placeholder="e.g. 2"
                  value={pendingPenaltyOverride}
                  onChange={(e) => setPendingPenaltyOverride(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyPenalty(); } }}
                  autoFocus
                />
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button onClick={applyPenalty}>Apply</Button>
            <Button variant="ghost" onClick={() => setEditingPenaltyEntryId(null)}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Redress dialog */}
      <Dialog open={redressDialog !== null} onOpenChange={(open) => { if (!open) setRedressDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Redress (RDG) — {redressDialog ? (competitorMap.get(redressDialog.competitorId)?.sailNumber ?? '') : ''}
            </DialogTitle>
            <DialogDescription>
              RRS A9: replace score with average from a pool of races.
              {redressDialog?.isFinisher && (() => {
                const idx = finishingOrder.findIndex(
                  (e) => e.kind === 'known' && e.competitorId === redressDialog.competitorId,
                );
                return idx >= 0 ? <> Finish position {idx + 1} is kept.</> : null;
              })()}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Method (RRS A9)</label>
              <div className="space-y-1.5">
                {([
                  { value: 'all_races', label: 'A9(a) — average of all races in the series' },
                  { value: 'races_before', label: `A9(b) — average of races before race ${race?.raceNumber ?? ''}` },
                  { value: 'stated', label: 'A9(c) — scorer-stated points' },
                ] as { value: RedressMethod; label: string }[]).map(({ value, label }) => (
                  <label key={value} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="rdg-method"
                      value={value}
                      checked={redressDialog?.method === value}
                      onChange={() => setRedressDialog((d) => d ? { ...d, method: value } : null)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            {redressDialog?.method === 'stated' && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Points</label>
                <Input
                  type="number"
                  min={0}
                  step="0.1"
                  placeholder="e.g. 3.5"
                  value={redressDialog.statedPoints}
                  onChange={(e) => setRedressDialog((d) => d ? { ...d, statedPoints: e.target.value } : null)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyRedress(); } }}
                  autoFocus
                />
              </div>
            )}

            {redressDialog?.method !== 'stated' && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Pool restriction</label>
                <div className="space-y-1.5">
                  {([
                    { value: 'none', label: 'No restriction' },
                    { value: 'exclude', label: 'Exclude specific races from pool' },
                    { value: 'include', label: 'Include only specific races' },
                  ] as { value: RedressPoolMode; label: string }[]).map(({ value, label }) => (
                    <label key={value} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="radio"
                        name="rdg-pool"
                        value={value}
                        checked={redressDialog?.poolMode === value}
                        onChange={() => setRedressDialog((d) => d ? { ...d, poolMode: value } : null)}
                      />
                      {label}
                    </label>
                  ))}
                </div>

                {redressDialog?.poolMode === 'exclude' && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Races to exclude:</p>
                    <div className="flex flex-wrap gap-1">
                      {(allSeriesRaces ?? []).sort((a, b) => a.raceNumber - b.raceNumber).map((r) => {
                        const selected = redressDialog.excludeRaces.includes(r.raceNumber);
                        return (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => setRedressDialog((d) => {
                              if (!d) return null;
                              const races = selected
                                ? d.excludeRaces.filter((n) => n !== r.raceNumber)
                                : [...d.excludeRaces, r.raceNumber];
                              return { ...d, excludeRaces: races };
                            })}
                            className={cn(
                              'text-xs px-2 py-0.5 rounded border transition-colors',
                              selected
                                ? 'bg-primary text-primary-foreground border-primary'
                                : 'bg-background hover:bg-accent border-input',
                            )}
                          >
                            R{r.raceNumber}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {redressDialog?.poolMode === 'include' && (
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">Races to include:</p>
                    <div className="flex flex-wrap gap-1">
                      {(allSeriesRaces ?? []).sort((a, b) => a.raceNumber - b.raceNumber).map((r) => {
                        const selected = redressDialog.includeRaces.includes(r.raceNumber);
                        return (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => setRedressDialog((d) => {
                              if (!d) return null;
                              const races = selected
                                ? d.includeRaces.filter((n) => n !== r.raceNumber)
                                : [...d.includeRaces, r.raceNumber];
                              return { ...d, includeRaces: races };
                            })}
                            className={cn(
                              'text-xs px-2 py-0.5 rounded border transition-colors',
                              selected
                                ? 'bg-primary text-primary-foreground border-primary'
                                : 'bg-background hover:bg-accent border-input',
                            )}
                          >
                            R{r.raceNumber}
                          </button>
                        );
                      })}
                    </div>
                    {redressDialog.method !== 'races_before' && (
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={redressDialog.includeAllLater}
                          onChange={(e) => setRedressDialog((d) => d ? { ...d, includeAllLater: e.target.checked } : null)}
                        />
                        Include all later races
                      </label>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button onClick={applyRedress}>Apply</Button>
            {redressEntries.has(redressDialog?.competitorId ?? '') && (
              <Button variant="outline" onClick={removeRedress}>Remove redress</Button>
            )}
            <Button variant="ghost" onClick={() => setRedressDialog(null)}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>

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
