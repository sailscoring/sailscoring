'use client';

import { useRef, useState, type Ref } from 'react';
import { X, AlertTriangle, Flag, Scale, MoreHorizontal, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { useShortcuts } from '@/hooks/use-keyboard-shortcut';
import { normalizeTimeInput } from '@/lib/time-parse';
import {
  deriveFinishState,
  entryKey,
  type FinishEntry,
} from '@/lib/finish-entry';
import type { Competitor, CompetitorFieldKey, Finish, Fleet } from '@/lib/types';

/** One badge per fleet a competitor belongs to. Multi-fleet boats (e.g. a
 *  handicap fleet and a scratch fleet sharing a start) get a pill each rather
 *  than only the first. Falls back to a single "—" when none resolve. */
function FleetBadges({
  fleetIds,
  fleetById,
  variant,
  testId,
}: {
  fleetIds: string[];
  fleetById: Map<string, Fleet>;
  variant: 'secondary' | 'outline';
  testId?: string;
}) {
  const names = competitorFleetNames(fleetIds, fleetById);
  const labels = names.length > 0 ? names : ['—'];
  return (
    <span data-testid={testId} className="flex items-center gap-1 shrink-0">
      {labels.map((name, i) => (
        <Badge key={`${name}-${i}`} variant={variant} className="text-xs shrink-0">
          {name}
        </Badge>
      ))}
    </span>
  );
}
import type { ParseFinishSheetResult } from '@/lib/finish-sheet-csv';
import {
  NON_FINISHER_CODE_LABELS,
  partitionNonFinishers,
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
  competitors: Competitor[];
  competitorMap: Map<string, Competitor>;
  fleetById: Map<string, Fleet>;
  showFleetBadge: boolean;
  showCrew: boolean;
  enabledCompetitorFields: CompetitorFieldKey[];
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
}

export function FinishTab(props: FinishTabProps) {
  const { has } = useFeatures();
  const {
    finishInput, rowOps, nonFinishers,
    competitors, competitorMap, fleetById,
    showFleetBadge, showCrew, enabledCompetitorFields, derived, savedFinishes,
    finishSheetImportRef, applyCsvImport,
    setEditingPenaltyEntryId, openRedressDialog, setResolvingEntry,
    patchCache, saveFinish, leave,
  } = props;
  const {
    finishingOrder, tiedWithPrevious, finishTimes,
    finisherPenalties, redressEntries, finishByCompetitorId,
  } = derived;
  // Alias-destructure the two hooks back to the local names the JSX below
  // has always used — the markup is unchanged from the single-hook days.
  const {
    suggestions, canRecordUnknown, needsFinishTime,
    addFinisher, commitCompetitor, recordAsUnknown, recordCurrentAsUnknown,
  } = finishInput;
  // The suggestions dropdown gains a trailing "record as unknown" row when the
  // typed text isn't an exact sail; it sits at index === suggestions.length for
  // keyboard navigation. Only offered alongside real suggestions — a fully
  // unmatched number still goes through the not-found confirmation panel below.
  const showUnknownRow = suggestions.length > 0 && canRecordUnknown;
  const maxHighlightIndex = suggestions.length - 1 + (showUnknownRow ? 1 : 0);
  const {
    value: sailInput, setValue: setSailInput,
    error: inputError, setError: setInputError,
    pendingUnknownSail, setPendingUnknownSail,
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
    setNonFinisherCode,
  } = rowOps;
  const codeLabels = NON_FINISHER_CODE_LABELS;

  // The non-finishers panel is a narrow triage list, not a peer of the
  // finishing order. When it's empty the finishing order takes the full width
  // (no blank half on a completed race); when populated it sits beside the
  // order but gets the smaller share. A manual collapse lets the scorer
  // reclaim the width mid-entry while the list is still non-empty.
  const [nonFinishersCollapsed, setNonFinishersCollapsed] = useState(false);
  const hasNonFinishers = nonFinishers.length > 0;
  const showNonFinishersPanel = hasNonFinishers && !nonFinishersCollapsed;

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
        <FleetBadges fleetIds={competitor.fleetIds} fleetById={fleetById} variant="outline" />
      )}
      <span className="text-sm flex-1 truncate">{displayCompetitorLabel(competitor, { enabledCompetitorFields, showCrew })}</span>
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
  );

  // Most club races are position-only — no fleet has a start, so no boat needs
  // a finish time. In that common case the time cell (input or "—" placeholder)
  // is pure dead width, so drop it entirely and give the room to the name. This
  // is race-level (every competitor, not just current finishers) so the column
  // doesn't flicker in and out as boats are added.
  const showFinishTimeColumn = competitors.some((c) => needsFinishTime(c.id));

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
          {has('csv-finish-import') && (
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
          )}
          </div>
        </div>

        <div className="relative">
          {pendingTimeEntry ? (
            <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
              <span className="font-mono font-medium text-sm shrink-0">{pendingTimeEntry.competitor.sailNumber}</span>
              {showFleetBadge && (
                <FleetBadges
                  fleetIds={pendingTimeEntry.competitor.fleetIds}
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
                      commitCompetitor(suggestions[idx].competitor);
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
                    <FleetBadges fleetIds={competitor.fleetIds} fleetById={fleetById} variant="secondary" />
                  )}
                  <span className="flex-1 truncate">{displayCompetitorLabel(competitor, { enabledCompetitorFields, showCrew })}</span>
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
          <SortableList
            items={finishingOrder.map((entry, index) => ({ id: entryKey(entry), entry, index }))}
            isDisabled={(it) => it.entry.kind === 'known' && needsFinishTime(it.entry.competitorId)}
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
                  className={cn(
                    'flex items-center gap-3 border border-amber-400 rounded-lg px-4 py-2.5 bg-amber-50 dark:bg-amber-950 transition-colors hover:bg-amber-100 dark:hover:bg-amber-900',
                    isFlashed && 'ring-2 ring-primary',
                  )}
                >
                  <span className="w-6 text-right text-sm font-mono text-muted-foreground shrink-0">
                    {rowNumber}
                  </span>
                  <DragHandle {...handleProps} data-testid={`drag-handle-${entry.sailNumber}`} />
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                  <span className="font-mono font-medium">{entry.sailNumber}</span>
                  <span className="text-sm text-muted-foreground flex-1">Unknown — not registered</span>
                  {showFinishTimeColumn && (
                    <span className="w-24 text-center text-sm font-mono text-muted-foreground shrink-0">—</span>
                  )}
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
            return (
              <li
                ref={ref}
                style={style}
                className={cn(
                  'flex items-center gap-3 border rounded-lg px-4 py-2.5 transition-colors',
                  // Hover highlight anchors the eye across the now-wider row when
                  // scanning out to the finish time / actions.
                  hasRedress
                    ? 'border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900'
                    : 'hover:bg-muted/50',
                  isFlashed && 'ring-2 ring-primary',
                )}
              >
                <span className="w-6 text-right text-sm font-mono text-muted-foreground shrink-0">
                  {rowNumber}
                </span>
                {isTimed ? (
                  // Timed rows are position-locked by the time-order invariant.
                  // Not draggable — scorer edits the time instead.
                  <div className="w-4 shrink-0" aria-hidden />
                ) : (
                  <DragHandle {...handleProps} data-testid={`drag-handle-${competitor.sailNumber}`} />
                )}
                <span className="font-mono font-medium">{competitor.sailNumber}</span>
                {showFleetBadge && (
                  <FleetBadges
                    fleetIds={competitor.fleetIds}
                    fleetById={fleetById}
                    variant="secondary"
                    testId={`fleet-badge-${competitor.sailNumber}`}
                  />
                )}
                <span className="text-sm truncate flex-1">{displayCompetitorLabel(competitor, { enabledCompetitorFields, showCrew })}</span>
                {showFinishTimeColumn && (isTimed ? (
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
                      reslotTimedRow(competitorId, normalized);
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
                        e.currentTarget.value = finishTimes.get(entry.competitorId) ?? '';
                        e.currentTarget.blur();
                      }
                    }}
                    placeholder="HH:MM:SS"
                    aria-label={`Finish time for ${competitor.sailNumber}`}
                    data-testid={`finish-time-${competitor.sailNumber}`}
                    className="w-24 shrink-0 font-mono text-sm text-center rounded px-2 py-0.5 border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                ) : (
                  <span className="w-24 text-center text-sm font-mono text-muted-foreground shrink-0">—</span>
                ))}
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
                {hasRedress && (
                  <Badge
                    variant="outline"
                    className="text-xs shrink-0 cursor-pointer border-amber-400 text-amber-700 dark:text-amber-400"
                    onClick={() => openRedressDialog(entry.competitorId, true)}
                  >
                    RDG
                  </Badge>
                )}
                {/* Penalty and redress are infrequent — keep them off the row
                    behind an overflow menu so the boat name keeps the width.
                    The aria-labels below carry the sail number for addressing. */}
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
                  </DropdownMenuContent>
                </DropdownMenu>
                <button
                  onClick={() => removeFinisher(eid)}
                  aria-label={`Remove ${competitor.sailNumber}`}
                  className="text-muted-foreground hover:text-foreground shrink-0"
                >
                  <X className="h-4 w-4" />
                </button>
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
          </div>
      </div>
      )}
    </div>
  );
}
