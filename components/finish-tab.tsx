'use client';

import { useRef, useState, type Ref } from 'react';
import { X, Activity, AlertTriangle, Ban, ChevronDown, ChevronRight, Flag, Scale, MoreHorizontal, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FinishSheetImport, type FinishSheetImportHandle } from '@/components/finish-sheet-import';
import { SortableList, DragHandle } from '@/components/ui/sortable-list';
import { useFeatures } from '@/components/features-provider';
import { cn } from '@/lib/utils';
import { competitorFleetNames, displayCompetitorLabel } from '@/lib/competitor-fields';
import { competitorMatchesFilter } from '@/lib/competitor-filter';
import { ordinal } from '@/lib/ordinal';
import { hasTrackData, trackDataStrip } from '@/lib/track-data';
import { useShortcuts } from '@/hooks/use-keyboard-shortcut';
import { formatElapsedInput, normalizeTimeInput, parseElapsedInput } from '@/lib/time-parse';
import {
  deriveFinishState,
  entryKey,
  type FinishEntry,
} from '@/lib/finish-entry';
import type { Competitor, CompetitorFieldKey, Finish, FinishRecording, Fleet, ResultCode } from '@/lib/types';

/** One badge per fleet a competitor belongs to, scoped to the fleets actually
 *  racing this sheet. Multi-fleet boats (e.g. a handicap fleet and a scratch
 *  fleet sharing a start) still get a pill each when both fleets are in the
 *  race — the badge disambiguates scoring context — but a fleet the boat
 *  carries that isn't in this race is dropped as noise. `raceFleetIds` is the
 *  race's started fleets; an empty set means no starts are recorded, so every
 *  fleet is implied racing and all memberships show. A boat force-entered from
 *  outside the started fleets (no overlap) falls back to all its memberships
 *  rather than rendering blank. Falls back to a single "—" when none resolve.
 *
 *  Badges shrink and ellipsize rather than holding their full width: a long
 *  fleet name in the narrow non-finishers panel would otherwise push the rest
 *  of its row out past the panel's right edge. The full name stays available
 *  as the badge's tooltip. */
function FleetBadges({
  fleetIds,
  raceFleetIds,
  fleetById,
  variant,
  testId,
}: {
  fleetIds: string[];
  raceFleetIds: Set<string>;
  fleetById: Map<string, Fleet>;
  variant: 'secondary' | 'outline';
  testId?: string;
}) {
  const inRace = raceFleetIds.size > 0
    ? fleetIds.filter((id) => raceFleetIds.has(id))
    : fleetIds;
  const names = competitorFleetNames(inRace.length > 0 ? inRace : fleetIds, fleetById);
  const labels = names.length > 0 ? names : ['—'];
  return (
    <span data-testid={testId} className="flex items-center gap-1 min-w-0">
      {labels.map((name, i) => (
        <Badge key={`${name}-${i}`} variant={variant} className="text-xs shrink" title={name}>
          <span className="truncate">{name}</span>
        </Badge>
      ))}
    </span>
  );
}
import type { ParseFinishSheetResult } from '@/lib/finish-sheet-csv';
import {
  FINISHER_CODE_LABELS,
  NON_FINISHER_CODE_LABELS,
  partitionNonFinishers,
  type FinisherCode,
  type NonFinisherCode,
  type NonFinisherView,
} from '@/lib/finish-entry';
import type { useFinishInput } from '@/hooks/use-finish-input';
import type { useFinishRowOps } from '@/hooks/use-finish-row-ops';

type Derived = ReturnType<typeof deriveFinishState>;

export interface FinishTabProps {
  /** The sail-number entry flow (see hooks/use-finish-input.ts). */
  finishInput: ReturnType<typeof useFinishInput>;
  /** Committed-row operations (see hooks/use-finish-row-ops.ts). */
  rowOps: ReturnType<typeof useFinishRowOps>;
  nonFinishers: NonFinisherView[];
  /** Boats in this race's fleets that are excluded from the series. Not
   *  non-finishers — they are not entrants — so they sit in their own
   *  collapsed group under the panel, each with an Include action. */
  excludedCompetitors?: Competitor[];
  /** Bring an excluded boat into the series. Absent on a read-only sheet. */
  onIncludeCompetitor?: (competitor: Competitor) => void | Promise<unknown>;
  competitors: Competitor[];
  competitorMap: Map<string, Competitor>;
  fleetById: Map<string, Fleet>;
  /** The fleets with a start in this race — badges are scoped to these so a
   *  multi-fleet boat only shows the tags relevant to the sheet being entered.
   *  Empty when no starts are recorded (every fleet implied racing). */
  raceFleetIds: Set<string>;
  showFleetBadge: boolean;
  showCrew: boolean;
  enabledCompetitorFields: CompetitorFieldKey[];
  /** How this race's sheet was taken down; absent means times of day. */
  finishRecording?: FinishRecording;
  /** Set the recording mode. Absent on a read-only sheet, which hides the
   *  control entirely. */
  onSetFinishRecording?: (mode: FinishRecording) => void;
  derived: Derived;
  savedFinishes: Finish[] | undefined;
  finishSheetImportRef: Ref<FinishSheetImportHandle>;
  applyCsvImport: (result: ParseFinishSheetResult) => void | Promise<void>;
  setEditingPenaltyEntryId: (competitorId: string) => void;
  openRedressDialog: (competitorId: string, isFinisher: boolean) => void;
  setResolvingEntry: (entry: FinishEntry & { kind: 'unknown' }) => void;
  /** Persistence helpers used by the inline finish-time editor. */
  patchCache: (updater: (rows: Finish[]) => Finish[]) => void;
  saveFinish: { mutate: (f: Finish) => unknown };
  /** Called when the user presses Escape with no input + no suggestions. */
  leave: () => void;
  /**
   * Show the sheet without any way to change it: no entry box, no drag
   * handles, no row actions, and recorded times as text rather than inputs.
   *
   * The series is read-only — archived, finalised, a role that can't score,
   * or a spectator view of published results (#475). Every write from here
   * would be refused by the server anyway; this is what stops the sheet
   * inviting one. Reading stays complete: the order, the times, the
   * penalties and redress, and the track data all still show.
   */
  readOnly?: boolean;
}

export function FinishTab(props: FinishTabProps) {
  const { has } = useFeatures();
  const {
    finishInput, rowOps, nonFinishers,
    excludedCompetitors = [], onIncludeCompetitor,
    competitors, competitorMap, fleetById, raceFleetIds,
    showFleetBadge, showCrew, enabledCompetitorFields,
    finishRecording, onSetFinishRecording, derived, savedFinishes,
    finishSheetImportRef, applyCsvImport,
    setEditingPenaltyEntryId, openRedressDialog, setResolvingEntry,
    patchCache, saveFinish, leave, readOnly = false,
  } = props;
  const {
    finishingOrder, tiedWithPrevious, finishTimes, elapsedSecs,
    finisherPenalties, redressEntries, finishByCompetitorId, finisherCodes,
  } = derived;
  // The placed rows that score on a code rather than their place, in sheet
  // order. A chip on the row says so where the row is; this list says so at
  // the top of the sheet, since a chip on row 19 of 42 is easy to pass over
  // and the combination is usually a leftover — a boat coded RET from the
  // jury sheet before the finish sheet placed her — rather than the
  // intended DSQ-after-finishing.
  const codedFinishers = finishingOrder.flatMap((entry) => {
    if (entry.kind !== 'known') return [];
    const code = finisherCodes.get(entry.competitorId);
    const competitor = competitorMap.get(entry.competitorId);
    return code && competitor ? [{ sailNumber: competitor.sailNumber, code }] : [];
  });
  // How this race's sheet was taken down. The time column is one column
  // either way — ADR-007's premise is that the scorer transcribes one piece
  // of paper, and a stopwatch sheet is a stopwatch sheet throughout.
  const byElapsed = finishRecording === 'elapsed';
  const recordedText = (competitorId: string): string => {
    if (byElapsed) {
      const secs = elapsedSecs.get(competitorId);
      return secs != null ? formatElapsedInput(secs) : '';
    }
    return finishTimes.get(competitorId) ?? '';
  };
  const readRecorded = (raw: string): { finishTime: string } | { elapsedSecs: number } | null => {
    if (byElapsed) {
      const secs = parseElapsedInput(raw);
      return secs != null && secs >= 0 ? { elapsedSecs: secs } : null;
    }
    const finishTime = normalizeTimeInput(raw);
    return finishTime ? { finishTime } : null;
  };
  // Alias-destructure the two hooks back to the local names the JSX below
  // has always used — the markup is unchanged from the single-hook days.
  const {
    suggestions, alreadyEntered, revealFinishedRow, canRecordUnknown, needsFinishTime,
    addFinisher, commitCompetitor, recordAsUnknown, recordCurrentAsUnknown,
  } = finishInput;
  // The dropdown opens for committable suggestions and for already-entered
  // matches alike — typing a number that's already in the order must answer
  // with the existing row, never with silence.
  const showDropdown = suggestions.length > 0 || alreadyEntered.length > 0;
  // The suggestions dropdown gains a trailing "record as unknown" row when the
  // typed text isn't an exact sail; it sits at index === suggestions.length for
  // keyboard navigation. Only offered alongside real rows — a fully unmatched
  // number still goes through the not-found confirmation panel below.
  const showUnknownRow = showDropdown && canRecordUnknown;
  const maxHighlightIndex = suggestions.length - 1 + (showUnknownRow ? 1 : 0);
  const {
    value: sailInput, setValue: setSailInput,
    error: inputError, setError: setInputError,
    notice: inputNotice, setNotice: setInputNotice,
    pendingUnknownSail, setPendingUnknownSail,
    pendingExcluded, includePendingExcluded, cancelPendingExcluded,
    highlightedIndex, setHighlightedIndex,
    ref: inputRef,
  } = finishInput.input;
  const {
    entry: pendingTimeEntry,
    value: pendingTimeValue, setValue: setPendingTimeValue,
    error: pendingTimeError, setError: setPendingTimeError,
    inputRef: pendingTimeInputRef,
    confirm: confirmPendingTime, cancel: cancelPendingTime,
  } = finishInput.pendingTime;
  const {
    flashedRowId, editingTimes, setEditingTimes,
    removeFinisher, toggleTiedWithPrevious, moveRowTo, reslotTimedRow,
    setNonFinisherCode, setFinisherCode,
  } = rowOps;
  const codeLabels = NON_FINISHER_CODE_LABELS;

  // The non-finishers panel is a narrow triage list, not a peer of the
  // finishing order. When it's empty the finishing order takes the full width
  // (no blank half on a completed race); when populated it sits beside the
  // order but gets the smaller share. A manual collapse lets the scorer
  // reclaim the width mid-entry while the list is still non-empty.
  const [nonFinishersCollapsed, setNonFinishersCollapsed] = useState(false);
  const hasNonFinishers = nonFinishers.length > 0;
  const hasExcluded = excludedCompetitors.length > 0;
  const showNonFinishersPanel = (hasNonFinishers || hasExcluded) && !nonFinishersCollapsed;
  // The excluded group opens on demand: those boats need no attention on an
  // ordinary race day, and the group is there so they can be found, not read.
  const [excludedOpen, setExcludedOpen] = useState(false);

  // Free-text filter over the panel — early in entry it holds the whole
  // started field, and picking one boat out to assign a code means scrolling
  // otherwise. Same predicate as the competitors-page filter. Assigning a
  // code deliberately leaves the filter in place: the row stays visible with
  // its new code, so the scorer can see the assignment took.
  const [nonFinisherFilter, setNonFinisherFilter] = useState('');
  const nonFinisherFilterRef = useRef<HTMLInputElement>(null);
  const nonFinisherFilterActive = nonFinisherFilter.trim().length > 0;
  const filteredNonFinishers = nonFinishers.filter(({ competitor }) =>
    competitorMatchesFilter(competitor, nonFinisherFilter));
  const { recorded: recordedNonFinishers, didNotCompete: didNotCompeteNonFinishers } =
    partitionNonFinishers(filteredNonFinishers);
  const filteredExcluded = excludedCompetitors.filter((c) => competitorMatchesFilter(c, nonFinisherFilter));

  // Which rows have their track data showing. A set rather than a single open
  // row: comparing two boats is the point of looking at all, and there is no
  // table to compare them in.
  const [openTrackData, setOpenTrackData] = useState<ReadonlySet<string>>(new Set());
  const toggleTrackData = (eid: string) =>
    setOpenTrackData((open) => {
      const next = new Set(open);
      if (!next.delete(eid)) next.add(eid);
      return next;
    });

  useShortcuts([
    {
      key: '/',
      description: 'Filter non-finishers',
      section: 'Finish entry',
      when: () => showNonFinishersPanel,
      handler: () => nonFinisherFilterRef.current?.focus(),
    },
  ]);

  // One non-finisher row: sail, fleet, name, a redress shortcut for RDG, and
  // the result-code dropdown. Shared by both the recorded and did-not-compete
  // groups so the two lists render identically.
  const renderNonFinisherRow = ({ competitor, code }: NonFinisherView) => (
    <div
      key={competitor.id}
      data-testid={`non-finisher-${competitor.sailNumber}`}
      className={cn(
        'flex items-center gap-3 border rounded-lg px-4 py-2 transition-colors',
        code === 'RDG'
          ? 'border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900'
          : 'hover:bg-muted/50',
      )}
    >
      <span className="font-mono font-medium w-16 shrink-0">
        {competitor.sailNumber}
      </span>
      {showFleetBadge && (
        <FleetBadges fleetIds={competitor.fleetIds} raceFleetIds={raceFleetIds} fleetById={fleetById} variant="outline" />
      )}
      {/* flex-auto, not flex-1: with a zero basis the name is the first thing
          squeezed to nothing, leaving the fleet badge to overflow the row on
          its own. Sized from its content, name and badge share the squeeze and
          both ellipsize. */}
      <span className="text-sm flex-auto truncate">{displayCompetitorLabel(competitor, { enabledCompetitorFields, showCrew })}</span>
      {code === 'RDG' && !readOnly && (
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
      {readOnly ? (
        <span
          className="w-36 shrink-0 text-xs text-muted-foreground text-right"
          data-testid={`non-finisher-code-${competitor.sailNumber}`}
        >
          {codeLabels[code]}
        </span>
      ) : (
      <Select
        value={code}
        onValueChange={(v) => {
          if (v === 'RDG') {
            openRedressDialog(competitor.id, false);
          } else {
            setNonFinisherCode(competitor.id, v as NonFinisherCode);
          }
        }}
      >
        <SelectTrigger className="w-36 h-8 text-xs shrink-0">
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
      )}
    </div>
  );

  // The code choices for a boat in the finishing order, as one radio group
  // shared by the chip on a coded row and the row-actions submenu on any
  // row. "Finished" is the clear: she scores her place again. Selecting
  // the value already set is a no-op in the hook.
  const renderFinisherCodeChoices = (competitorId: string, current: ResultCode | null) => (
    <DropdownMenuRadioGroup
      value={current ?? 'finished'}
      onValueChange={(v) => setFinisherCode(competitorId, v === 'finished' ? null : (v as ResultCode))}
    >
      <DropdownMenuRadioItem value="finished">Finished — no code</DropdownMenuRadioItem>
      {(Object.keys(FINISHER_CODE_LABELS) as FinisherCode[]).map((c) => (
        <DropdownMenuRadioItem key={c} value={c}>
          {FINISHER_CODE_LABELS[c]}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );

  // Most club races are position-only — no fleet has a start, so no boat needs
  // a finish time. In that common case the time cell (input or "—" placeholder)
  // is pure dead width, so drop it entirely and give the room to the name. This
  // is race-level (every competitor, not just current finishers) so the column
  // doesn't flicker in and out as boats are added.
  const showFinishTimeColumn = competitors.some((c) => needsFinishTime(c.id));
  // Switching mode can't convert what's already written down — an elapsed
  // time and a time of day are different measurements — so the choice locks
  // once the sheet carries either. Clearing the rows unlocks it.
  const hasRecordedTimes = finishTimes.size > 0 || elapsedSecs.size > 0;

  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-8',
        showNonFinishersPanel && 'md:grid-cols-[3fr_2fr]',
      )}
    >
      {/* Left: finishing order. min-w-0 lets the grid track honour its
          fraction instead of growing to its content's min size (which would
          push the panel out of the card). */}
      <div className="space-y-4 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-medium">Finishing order</h3>
          <div className="flex items-center gap-2">
          {hasNonFinishers && nonFinishersCollapsed && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setNonFinishersCollapsed(false)}
              title="Show non-finishers"
            >
              <PanelRightOpen className="h-4 w-4" />
              Non-finishers ({nonFinishers.length})
            </Button>
          )}
          {showFinishTimeColumn && onSetFinishRecording && (
            <Select
              value={finishRecording ?? 'clock'}
              onValueChange={(v) => onSetFinishRecording(v as FinishRecording)}
              disabled={hasRecordedTimes}
            >
              <SelectTrigger
                size="sm"
                className="w-[9.5rem]"
                aria-label="How finishes are recorded"
                data-testid="finish-recording-mode"
                title={hasRecordedTimes
                  ? 'This sheet already has times recorded. Clear them to record it the other way round.'
                  : 'Whether the sheet records a time of day per boat or an elapsed time'}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="clock">Times of day</SelectItem>
                <SelectItem value="elapsed">Elapsed times</SelectItem>
              </SelectContent>
            </Select>
          )}
          {has('csv-finish-import') && !readOnly && (
            <FinishSheetImport
              ref={finishSheetImportRef}
              candidates={competitors}
              needsFinishTime={needsFinishTime}
              existingFinishes={savedFinishes ?? []}
              onConfirm={applyCsvImport}
              trigger={
                <Button variant="outline" size="sm" title="Import finish sheet from CSV or Excel (i)">
                  Import sheet
                </Button>
              }
            />
          )}
          </div>
        </div>

        <div className="relative">
          {readOnly ? null : pendingTimeEntry ? (
            <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
              <span className="font-mono font-medium text-sm shrink-0">{pendingTimeEntry.competitor.sailNumber}</span>
              {showFleetBadge && (
                <FleetBadges
                  fleetIds={pendingTimeEntry.competitor.fleetIds}
                  raceFleetIds={raceFleetIds}
                  fleetById={fleetById}
                  variant="secondary"
                />
              )}
              <span className="text-sm text-muted-foreground truncate">{displayCompetitorLabel(pendingTimeEntry.competitor, { enabledCompetitorFields, showCrew })}</span>
              <input
                ref={pendingTimeInputRef}
                type="text"
                value={pendingTimeValue}
                onChange={(e) => { setPendingTimeValue(e.target.value); setPendingTimeError(''); }}
                placeholder={byElapsed ? 'H:MM:SS' : 'HH:MM:SS'}
                aria-label={byElapsed ? 'Elapsed time' : 'Finish time'}
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
                  setInputNotice('');
                  setHighlightedIndex(-1);
                  setPendingUnknownSail(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setHighlightedIndex((i) => Math.min(i + 1, maxHighlightIndex));
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
                    if (highlightedIndex === suggestions.length && showUnknownRow) {
                      recordCurrentAsUnknown();
                    } else {
                      const idx = highlightedIndex >= 0 && highlightedIndex < suggestions.length
                        ? highlightedIndex : 0;
                      commitCompetitor(
                        suggestions[idx].competitor,
                        suggestions[idx].matchedOn,
                        suggestions[idx].entered,
                      );
                    }
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    // Shift+Enter files the typed text as unknown directly — the
                    // escape hatch when Enter would otherwise prefix-complete to
                    // a registered boat.
                    if (e.shiftKey) {
                      recordCurrentAsUnknown();
                    } else if (pendingUnknownSail) {
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
          {showDropdown && !pendingTimeEntry && (
            <ul
              role="listbox"
              className="absolute z-10 top-full mt-1 w-full rounded-md border bg-popover shadow-md"
            >
              {suggestions.map(({ competitor, matchedOn, entered }, i) => (
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
                    commitCompetitor(competitor, matchedOn, entered);
                  }}
                >
                  <span className="font-mono font-medium w-16 shrink-0">{competitor.sailNumber}</span>
                  {matchedOn !== 'sail' && (
                    <Badge variant="outline" className="shrink-0">
                      {matchedOn === 'bow' ? 'matched on bow' : 'sails as'} {entered}
                    </Badge>
                  )}
                  {showFleetBadge && (
                    <FleetBadges fleetIds={competitor.fleetIds} raceFleetIds={raceFleetIds} fleetById={fleetById} variant="secondary" />
                  )}
                  <span className="flex-auto truncate">{displayCompetitorLabel(competitor, { enabledCompetitorFields, showCrew })}</span>
                </li>
              ))}
              {alreadyEntered.map(({ competitor, matchedOn, entered, position, rowKey }, i) => (
                <li
                  key={`already-${rowKey}`}
                  role="option"
                  aria-selected={false}
                  data-testid={`already-entered-${competitor.sailNumber}`}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 cursor-pointer text-sm text-muted-foreground hover:bg-accent',
                    i === 0 && suggestions.length > 0 && 'border-t',
                  )}
                  title="Show the existing row"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    revealFinishedRow(rowKey);
                  }}
                >
                  <span className="font-mono font-medium w-16 shrink-0">{competitor.sailNumber}</span>
                  {matchedOn !== 'sail' && (
                    <Badge variant="outline" className="shrink-0">
                      {matchedOn === 'bow' ? 'matched on bow' : 'sails as'} {entered}
                    </Badge>
                  )}
                  <span className="flex-auto truncate">{displayCompetitorLabel(competitor, { enabledCompetitorFields, showCrew })}</span>
                  <Badge variant="secondary" className="shrink-0">
                    already entered — {ordinal(position)}
                  </Badge>
                </li>
              ))}
              {showUnknownRow && (
                <li
                  role="option"
                  aria-selected={highlightedIndex === suggestions.length}
                  data-testid="record-unknown-option"
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 cursor-pointer text-sm border-t text-muted-foreground',
                    highlightedIndex === suggestions.length ? 'bg-accent' : 'hover:bg-accent',
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    recordCurrentAsUnknown();
                  }}
                >
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                  <span>
                    Record <span className="font-mono font-medium text-foreground">{sailInput.trim()}</span> as unknown
                  </span>
                </li>
              )}
            </ul>
          )}
        </div>
        {inputError && !pendingUnknownSail && !pendingExcluded && (
          <p className="text-sm text-destructive">{inputError}</p>
        )}
        {pendingExcluded && (
          <div className="space-y-2" data-testid="pending-excluded">
            <p className="text-sm text-amber-600 dark:text-amber-500">
              <span className="font-mono font-medium">{pendingExcluded.competitor.sailNumber}</span>{' '}
              {displayCompetitorLabel(pendingExcluded.competitor, { enabledCompetitorFields, showCrew })} is
              excluded from this series. Recording a finish enters the boat.
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => void includePendingExcluded()}>
                Include and record finish
              </Button>
              <Button size="sm" variant="ghost" onClick={cancelPendingExcluded}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {inputNotice && !inputError && !pendingUnknownSail && (
          <p className="text-sm text-amber-600 dark:text-amber-500" data-testid="already-entered-notice">
            {inputNotice}
          </p>
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
            {readOnly
              ? 'No finishers recorded for this race.'
              : 'Enter sail numbers in finishing order above.'}
          </p>
        )}

        {codedFinishers.length > 0 && (
          <p
            className="text-sm text-amber-700 dark:text-amber-400"
            data-testid="finisher-code-note"
          >
            Scored on a result code, not on the place:{' '}
            {codedFinishers.map(({ sailNumber, code }, i) => (
              <span key={sailNumber}>
                {i > 0 && ', '}
                <span className="font-mono font-medium">{sailNumber}</span> {code}
              </span>
            ))}
            .
          </p>
        )}

        <ol className="space-y-1.5">
          <SortableList
            items={finishingOrder.map((entry, index) => ({ id: entryKey(entry), entry, index }))}
            isDisabled={(it) =>
              readOnly || (it.entry.kind === 'known' && needsFinishTime(it.entry.competitorId))
            }
            onReorder={(_, { fromIndex, toIndex }) => moveRowTo(fromIndex, toIndex)}
          >
          {({ entry, index }, { ref, style, handleProps }) => {
            const eid = entryKey(entry);
            const rowNumber = index + 1;
            const isFlashed = flashedRowId === eid;
            const isTimed = entry.kind === 'known' && needsFinishTime(entry.competitorId);

            if (entry.kind === 'unknown') {
              return (
                <li
                  ref={ref}
                  style={style}
                  data-entry-key={eid}
                  className={cn(
                    'flex items-center gap-3 border border-amber-400 rounded-lg px-4 py-2.5 bg-amber-50 dark:bg-amber-950 transition-colors hover:bg-amber-100 dark:hover:bg-amber-900',
                    isFlashed && 'ring-2 ring-primary',
                  )}
                >
                  <span className="w-6 text-right text-sm font-mono text-muted-foreground shrink-0">
                    {rowNumber}
                  </span>
                  {readOnly
                    ? <div className="w-4 shrink-0" aria-hidden />
                    : <DragHandle {...handleProps} data-testid={`drag-handle-${entry.sailNumber}`} />}
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                  <span className="font-mono font-medium">{entry.sailNumber}</span>
                  <span className="text-sm text-muted-foreground flex-1">Unknown — not registered</span>
                  {showFinishTimeColumn && (
                    <span className="w-24 text-center text-sm font-mono text-muted-foreground shrink-0">—</span>
                  )}
                  {!readOnly && (
                    <>
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
                    </>
                  )}
                </li>
              );
            }

            const competitor = competitorMap.get(entry.competitorId);
            if (!competitor) return null;
            const penalty = finisherPenalties.get(entry.competitorId);
            const finisherCode = finisherCodes.get(entry.competitorId);
            const hasRedress = redressEntries.has(entry.competitorId);
            // Track data rides on the finish row itself, so its presence is
            // the whole gate: nothing but the RaceSense import puts it there.
            const finish = finishByCompetitorId.get(entry.competitorId);
            const showTrackData = hasTrackData(finish?.trackData);
            const trackDataOpen = showTrackData && openTrackData.has(eid);
            return (
              <li
                ref={ref}
                style={style}
                data-entry-key={eid}
                className={cn(
                  'border rounded-lg px-4 py-2.5 transition-colors',
                  // Hover highlight anchors the eye across the now-wider row when
                  // scanning out to the finish time / actions.
                  hasRedress
                    ? 'border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900'
                    : 'hover:bg-muted/50',
                  isFlashed && 'ring-2 ring-primary',
                )}
              >
                <div className="flex items-center gap-3">
                <span className="w-6 text-right text-sm font-mono text-muted-foreground shrink-0">
                  {rowNumber}
                </span>
                {isTimed || readOnly ? (
                  // Timed rows are position-locked by the time-order invariant.
                  // Not draggable — scorer edits the time instead. A read-only
                  // sheet keeps the same spacer so the columns still line up.
                  <div className="w-4 shrink-0" aria-hidden />
                ) : (
                  <DragHandle {...handleProps} data-testid={`drag-handle-${competitor.sailNumber}`} />
                )}
                <span className="font-mono font-medium">{competitor.sailNumber}</span>
                {(() => {
                  const f = finishByCompetitorId.get(entry.competitorId);
                  if (!f?.matchedOn) return null;
                  const entered = f.enteredSailNumber ?? competitor.bowNumber ?? '';
                  return (
                    <Badge
                      variant="outline"
                      className="shrink-0"
                      data-testid={`${f.matchedOn}-match-${competitor.sailNumber}`}
                    >
                      {f.matchedOn === 'bow' ? 'entered by bow' : 'sailed as'} {entered}
                    </Badge>
                  );
                })()}
                {showFleetBadge && (
                  <FleetBadges
                    fleetIds={competitor.fleetIds}
                    raceFleetIds={raceFleetIds}
                    fleetById={fleetById}
                    variant="secondary"
                    testId={`fleet-badge-${competitor.sailNumber}`}
                  />
                )}
                <span className="text-sm truncate flex-auto">{displayCompetitorLabel(competitor, { enabledCompetitorFields, showCrew })}</span>
                {showFinishTimeColumn && (isTimed && readOnly ? (
                  <span
                    className="w-24 text-center text-sm font-mono shrink-0"
                    data-testid={`finish-time-${competitor.sailNumber}`}
                  >
                    {recordedText(entry.competitorId) || '—'}
                  </span>
                ) : isTimed ? (
                  <input
                    type="text"
                    value={editingTimes.get(entry.competitorId) ?? recordedText(entry.competitorId)}
                    onChange={(e) =>
                      setEditingTimes((prev) => new Map(prev).set(entry.competitorId, e.target.value))
                    }
                    onBlur={(e) => {
                      const competitorId = entry.competitorId;
                      const next = readRecorded(e.target.value);
                      setEditingTimes((prev) => {
                        const nextMap = new Map(prev);
                        nextMap.delete(competitorId);
                        return nextMap;
                      });
                      if (!next) return;
                      if ('elapsedSecs' in next
                        ? next.elapsedSecs === elapsedSecs.get(competitorId)
                        : next.finishTime === finishTimes.get(competitorId)) return;
                      const finish = finishByCompetitorId.get(competitorId);
                      if (!finish) return;
                      const updated: Finish = { ...finish, ...next };
                      patchCache((rows) => rows.map((r) => (r.id === finish.id ? updated : r)));
                      saveFinish.mutate(updated);
                      reslotTimedRow(competitorId, next);
                    }}
                    onKeyDown={(e) => {
                      // Enter commits the edit (blur runs the normalize + save
                      // path); Escape discards it. Without this, the only way to
                      // persist was to Tab/click away, which scorers don't expect.
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        e.currentTarget.blur();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        // Restore the saved value before blurring so onBlur sees
                        // no change and skips the save.
                        e.currentTarget.value = recordedText(entry.competitorId);
                        e.currentTarget.blur();
                      }
                    }}
                    placeholder={byElapsed ? 'H:MM:SS' : 'HH:MM:SS'}
                    aria-label={`${byElapsed ? 'Elapsed' : 'Finish'} time for ${competitor.sailNumber}`}
                    data-testid={`finish-time-${competitor.sailNumber}`}
                    className="w-24 shrink-0 font-mono text-sm text-center rounded px-2 py-0.5 border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                ) : (
                  <span className="w-24 text-center text-sm font-mono text-muted-foreground shrink-0">—</span>
                ))}
                {readOnly ? (
                  // Only say "tie" where there is one: an empty checkbox on
                  // every row is an offer, and there is nothing on offer here.
                  tiedWithPrevious.has(eid) && (
                    <span
                      className="text-xs text-muted-foreground shrink-0"
                      title="Tied with the previous row (simultaneous finish, RRS A8.1)"
                      data-testid={`tie-${competitor.sailNumber}`}
                    >
                      tie
                    </span>
                  )
                ) : !isTimed && index > 0 && !((() => { const prev = finishingOrder[index - 1]; return prev.kind === 'known' && needsFinishTime(prev.competitorId); })()) && (
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
                {finisherCode && (readOnly ? (
                  // The row keeps its crossing position; the code says the
                  // boat scores no place for it. Red, unlike a penalty chip:
                  // a penalty adjusts a finish, this replaces it.
                  <Badge
                    variant="outline"
                    className="text-xs shrink-0 border-destructive/50 text-destructive"
                    title={`Scored ${finisherCode}, not ${ordinal(rowNumber)}`}
                    data-testid={`finisher-code-${competitor.sailNumber}`}
                  >
                    {finisherCode}
                  </Badge>
                ) : (
                  // Same chip, and the way to change or clear the code: a
                  // reinstated boat loses hers here, not by being deleted
                  // from the order and added again.
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={`Result code for ${competitor.sailNumber}`}
                        title={`Scored ${finisherCode}, not ${ordinal(rowNumber)} — change or clear`}
                        className="shrink-0"
                      >
                        <Badge
                          variant="outline"
                          className="text-xs border-destructive/50 text-destructive cursor-pointer"
                          data-testid={`finisher-code-${competitor.sailNumber}`}
                        >
                          {finisherCode}
                        </Badge>
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {renderFinisherCodeChoices(entry.competitorId, finisherCode)}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ))}
                {penalty && (
                  <Badge
                    variant="outline"
                    className={cn('text-xs shrink-0', !readOnly && 'cursor-pointer')}
                    onClick={readOnly ? undefined : () => setEditingPenaltyEntryId(entry.competitorId)}
                  >
                    {penalty.code}
                    {penalty.override != null ? ` (${penalty.override}${penalty.code === 'DPI' ? 'pts' : '%'})` : ''}
                  </Badge>
                )}
                {hasRedress && (
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-xs shrink-0 border-amber-400 text-amber-700 dark:text-amber-400',
                      !readOnly && 'cursor-pointer',
                    )}
                    onClick={readOnly ? undefined : () => openRedressDialog(entry.competitorId, true)}
                  >
                    RDG
                  </Badge>
                )}
                {showTrackData && (
                  <button
                    type="button"
                    onClick={() => toggleTrackData(eid)}
                    aria-label={`Track data for ${competitor.sailNumber}`}
                    aria-expanded={trackDataOpen}
                    title="What the device recorded"
                    data-testid={`track-data-toggle-${competitor.sailNumber}`}
                    className={cn(
                      'shrink-0 hover:text-foreground',
                      trackDataOpen ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    <Activity className="h-4 w-4" />
                  </button>
                )}
                {/* Penalty and redress are infrequent — keep them off the row
                    behind an overflow menu so the boat name keeps the width.
                    The aria-labels below carry the sail number for addressing. */}
                {!readOnly && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label={`Row actions for ${competitor.sailNumber}`}
                      title="Penalty, redress…"
                      className="text-muted-foreground hover:text-foreground shrink-0"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditingPenaltyEntryId(entry.competitorId)}>
                      <Flag className="h-3.5 w-3.5" />
                      Set scoring penalty
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => openRedressDialog(entry.competitorId, true)}>
                      <Scale className="h-3.5 w-3.5" />
                      {hasRedress ? 'Edit redress (RDG)' : 'Set redress (RDG)'}
                    </DropdownMenuItem>
                    {/* A boat who crossed the line and is then scored DSQ,
                        OCS, RET… stays at her crossing position with the
                        code on the row. */}
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <Ban className="h-3.5 w-3.5" />
                        Result code
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {renderFinisherCodeChoices(entry.competitorId, finish?.resultCode ?? null)}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  </DropdownMenuContent>
                </DropdownMenu>
                )}
                {!readOnly && (
                <button
                  onClick={() => removeFinisher(eid)}
                  aria-label={`Remove ${competitor.sailNumber}`}
                  className="text-muted-foreground hover:text-foreground shrink-0"
                >
                  <X className="h-4 w-4" />
                </button>
                )}
                </div>
                {trackDataOpen && (
                  // Read-only, and styled to say so: this is what the device
                  // recorded, sitting under a row of fields the scorer edits.
                  <p
                    className="mt-1.5 pl-9 text-xs font-mono text-muted-foreground"
                    data-testid={`track-data-${competitor.sailNumber}`}
                  >
                    {trackDataStrip(finish).join(' \u00b7 ')}
                  </p>
                )}
              </li>
            );
          }}
          </SortableList>
        </ol>
      </div>

      {/* Right: non-finishers. Only rendered when there are any and the panel
          isn't manually collapsed — otherwise the finishing order spans full
          width (see the adaptive grid above). */}
      {showNonFinishersPanel && (
      <div className="space-y-4 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-medium">
            Non-finishers{' '}
            <span className="text-sm font-normal text-muted-foreground">
              ({nonFinisherFilterActive
                ? `${filteredNonFinishers.length} of ${nonFinishers.length}`
                : nonFinishers.length})
            </span>
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setNonFinishersCollapsed(true)}
            aria-label="Collapse non-finishers"
            title="Collapse non-finishers"
          >
            <PanelRightClose className="h-4 w-4" />
          </Button>
        </div>

        <Input
          ref={nonFinisherFilterRef}
          value={nonFinisherFilter}
          onChange={(e) => setNonFinisherFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              // stopPropagation keeps the page-level Escape (leave the race)
              // from also firing: this input blurs, and by the time the
              // window listener runs the focus guard no longer protects us.
              e.stopPropagation();
              setNonFinisherFilter('');
              e.currentTarget.blur();
            }
          }}
          placeholder="Filter non-finishers…"
          aria-label="Filter non-finishers"
        />

        <div className="space-y-1.5">
            {filteredNonFinishers.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No non-finishers match &ldquo;{nonFinisherFilter.trim()}&rdquo;.
              </p>
            )}
            {recordedNonFinishers.map(renderNonFinisherRow)}
            {/* Auto-DNC / did-not-compete boats sink below the ones with a
                recorded result — usually most of the fleet, needing no action.
                The divider is only drawn when both groups are present, so a
                race with only one kind reads as a plain list. */}
            {recordedNonFinishers.length > 0 && didNotCompeteNonFinishers.length > 0 && (
              <div className="flex items-center gap-2 pt-2 text-xs font-medium text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                Did not compete ({didNotCompeteNonFinishers.length})
                <span className="h-px flex-1 bg-border" />
              </div>
            )}
            {didNotCompeteNonFinishers.map(renderNonFinisherRow)}
            {hasExcluded && (
              <>
                <button
                  type="button"
                  onClick={() => setExcludedOpen((o) => !o)}
                  aria-expanded={excludedOpen}
                  className="flex w-full items-center gap-2 pt-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <span className="h-px flex-1 bg-border" />
                  {excludedOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  Excluded ({nonFinisherFilterActive ? `${filteredExcluded.length} of ${excludedCompetitors.length}` : excludedCompetitors.length})
                  <span className="h-px flex-1 bg-border" />
                </button>
                {excludedOpen && filteredExcluded.map((competitor) => (
                  <div
                    key={competitor.id}
                    data-testid={`excluded-${competitor.sailNumber}`}
                    className="flex items-center gap-3 rounded-lg border border-dashed px-4 py-2 text-muted-foreground"
                  >
                    <span className="font-mono font-medium w-16 shrink-0">{competitor.sailNumber}</span>
                    {showFleetBadge && (
                      <FleetBadges fleetIds={competitor.fleetIds} raceFleetIds={raceFleetIds} fleetById={fleetById} variant="outline" />
                    )}
                    <span className="text-sm flex-auto truncate">{displayCompetitorLabel(competitor, { enabledCompetitorFields, showCrew })}</span>
                    {onIncludeCompetitor && !readOnly && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 shrink-0 text-xs"
                        onClick={() => void onIncludeCompetitor(competitor)}
                      >
                        Include
                      </Button>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
      </div>
      )}
    </div>
  );
}
