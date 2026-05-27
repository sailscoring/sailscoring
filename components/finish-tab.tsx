'use client';

import type { Ref } from 'react';
import { X, AlertTriangle, Flag, Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FinishSheetImport, type FinishSheetImportHandle } from '@/components/finish-sheet-import';
import { useFeatures } from '@/components/features-provider';
import { cn } from '@/lib/utils';
import { competitorFleetNames, displayCompetitorLabel } from '@/lib/competitor-fields';
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
import type { useFinishEntry, NonFinisherCode } from '@/hooks/use-finish-entry';

type Derived = ReturnType<typeof deriveFinishState>;
type FinishEntryHook = ReturnType<typeof useFinishEntry>;

export interface FinishTabProps {
  finishEntry: FinishEntryHook;
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
  setNonFinisherCode: (competitorId: string, code: NonFinisherCode) => void;
  codeLabels: Record<NonFinisherCode, string>;
  /** Persistence helpers used by the inline finish-time editor. */
  patchCache: (updater: (rows: Finish[]) => Finish[]) => void;
  saveFinish: { mutate: (f: Finish) => unknown };
  touchSeries: { mutateAsync: (id: string) => Promise<unknown> };
  seriesId: string;
  /** Called when the user presses Escape with no input + no suggestions. */
  leave: () => void;
}

export function FinishTab(props: FinishTabProps) {
  const { has } = useFeatures();
  const {
    finishEntry, competitors, competitorMap, fleetById,
    showFleetBadge, showCrew, enabledCompetitorFields, derived, savedFinishes,
    finishSheetImportRef, applyCsvImport,
    setEditingPenaltyEntryId, openRedressDialog, setResolvingEntry,
    setNonFinisherCode, codeLabels,
    patchCache, saveFinish, touchSeries, seriesId, leave,
  } = props;
  const {
    finishingOrder, tiedWithPrevious, finishTimes,
    finisherPenalties, redressEntries, finishByCompetitorId,
  } = derived;
  const {
    sailInput, setSailInput,
    inputError, setInputError,
    pendingUnknownSail, setPendingUnknownSail,
    highlightedIndex, setHighlightedIndex,
    pendingTimeEntry,
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
    removeFinisher, toggleTiedWithPrevious, moveRow, reslotTimedRow,
  } = finishEntry;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      {/* Left: finishing order */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Finishing order</h3>
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
                    <FleetBadges fleetIds={competitor.fleetIds} fleetById={fleetById} variant="secondary" />
                  )}
                  <span className="flex-1 truncate">{displayCompetitorLabel(competitor, { enabledCompetitorFields, showCrew })}</span>
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
                  <FleetBadges
                    fleetIds={competitor.fleetIds}
                    fleetById={fleetById}
                    variant="secondary"
                    testId={`fleet-badge-${competitor.sailNumber}`}
                  />
                )}
                <span className="text-sm truncate flex-1">{displayCompetitorLabel(competitor, { enabledCompetitorFields, showCrew })}</span>
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
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
