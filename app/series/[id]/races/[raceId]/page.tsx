'use client';

import { use, useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { competitorRepo, raceRepo, finishRepo, seriesRepo } from '@/lib/dexie-repository';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
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
import { X } from 'lucide-react';
import type { Competitor, Finish, ResultCode } from '@/lib/types';
import { CheckSquare, Square } from 'lucide-react';
import { log } from '@/lib/debug';
import { cn } from '@/lib/utils';
import { reorderFinisher, computePositions } from '@/lib/finish-entry';
import { useGlobalKeyDown } from '@/hooks/use-keyboard-shortcut';

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

  const competitors = useLiveQuery(
    () => competitorRepo.listBySeries(seriesId),
    [seriesId],
  );
  const race = useLiveQuery(async () => (await raceRepo.get(raceId)) ?? null, [raceId]);
  const savedFinishes = useLiveQuery(
    () => finishRepo.listByRace(raceId),
    [raceId],
  );

  // Finishing order: list of competitor IDs in order
  const [finishingOrder, setFinishingOrder] = useState<string[]>([]);
  // Non-finisher codes: competitorId → code (only explicit overrides from implicit DNC)
  const [nonFinisherCodes, setNonFinisherCodes] = useState<Map<string, ResultCode>>(
    new Map(),
  );

  const [tiedWithPrevious, setTiedWithPrevious] = useState<Set<string>>(new Set());
  const initialTiedRef = useRef<Set<string>>(new Set());

  const [editingPosition, setEditingPosition] = useState<{
    competitorId: string;
    value: string;
  } | null>(null);

  const [activeTab, setActiveTab] = useState<'finish' | 'checkin'>('finish');
  const [sailInput, setSailInput] = useState('');
  const [checkinInput, setCheckinInput] = useState('');
  const [inputError, setInputError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const initialOrderRef = useRef<string[]>([]);
  const initialCodesRef = useRef<Map<string, ResultCode>>(new Map());

  // Initialize form state from saved finishes once loaded
  if (!initialized && competitors !== undefined && savedFinishes !== undefined) {
    // Sort by finishPosition to detect consecutive equal positions (ties)
    const positionedFinishes = savedFinishes
      .filter((f) => f.finishPosition !== null)
      .sort((a, b) => a.finishPosition! - b.finishPosition!);

    const order: string[] = [];
    const ties = new Set<string>();
    let lastPos: number | null = null;
    for (const finish of positionedFinishes) {
      order.push(finish.competitorId);
      if (lastPos !== null && finish.finishPosition === lastPos) {
        ties.add(finish.competitorId);
      }
      lastPos = finish.finishPosition;
    }

    const finishedIds = new Set(order);
    const codes = new Map<string, ResultCode>();
    for (const finish of savedFinishes) {
      if (finish.finishPosition === null && finish.resultCode && finish.resultCode !== 'DNC' && !finishedIds.has(finish.competitorId)) {
        codes.set(finish.competitorId, finish.resultCode);
      }
    }

    initialOrderRef.current = [...order];
    initialCodesRef.current = new Map(codes);
    initialTiedRef.current = new Set(ties);
    setFinishingOrder(order);
    setNonFinisherCodes(codes);
    setTiedWithPrevious(ties);
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

  function isDirty(): boolean {
    if (!initialized) return false;
    const initOrder = initialOrderRef.current;
    if (finishingOrder.length !== initOrder.length) return true;
    if (finishingOrder.some((id, i) => id !== initOrder[i])) return true;
    const initCodes = initialCodesRef.current;
    if (nonFinisherCodes.size !== initCodes.size) return true;
    for (const [k, v] of nonFinisherCodes) {
      if (initCodes.get(k) !== v) return true;
    }
    const initTied = initialTiedRef.current;
    if (tiedWithPrevious.size !== initTied.size) return true;
    for (const id of tiedWithPrevious) {
      if (!initTied.has(id)) return true;
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
    }
  });

  if (race === undefined || competitors === undefined) {
    return <p className="text-muted-foreground">Loading…</p>;
  }
  if (race === null) {
    return <p className="text-muted-foreground">Race not found.</p>;
  }

  const competitorMap = new Map(competitors.map((c) => [c.id, c]));
  const sailMap = new Map(
    competitors.map((c) => [c.sailNumber.toUpperCase(), c]),
  );

  // Competitors not yet in the finishing order
  const finishedIds = new Set(finishingOrder);
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

  function selectSuggestion(competitor: Competitor) {
    setFinishingOrder((order) => [...order, competitor.id]);
    setSailInput('');
    setInputError('');
    setHighlightedIndex(-1);
    inputRef.current?.focus();
    log('result-entry', 'added finisher via suggestion', { sail: competitor.sailNumber, competitorId: competitor.id });
  }

  function addFinisher() {
    if (highlightedIndex >= 0 && suggestions[highlightedIndex]) {
      selectSuggestion(suggestions[highlightedIndex].competitor);
      return;
    }

    const sail = sailInput.trim().toUpperCase();
    if (!sail) return;

    const competitor = sailMap.get(sail);
    if (!competitor) {
      setInputError(`Sail number "${sail}" not found in this series.`);
      return;
    }
    if (finishedIds.has(competitor.id)) {
      setInputError(`${sail} is already in the finishing order.`);
      return;
    }

    setFinishingOrder((order) => [...order, competitor.id]);
    setInputError('');
    setSailInput('');
    inputRef.current?.focus();
    log('result-entry', 'added finisher', { sail, competitorId: competitor.id });
  }

  function removeFinisher(competitorId: string) {
    const currentIdx = finishingOrder.indexOf(competitorId);
    setFinishingOrder((order) => order.filter((id) => id !== competitorId));
    setTiedWithPrevious((prev) => {
      const next = new Set(prev);
      next.delete(competitorId);
      // The boat after the removed boat was tied with it — break that tie
      const successorId = finishingOrder[currentIdx + 1];
      if (successorId && next.has(successorId)) {
        next.delete(successorId);
      }
      return next;
    });
  }

  function commitPositionEdit() {
    if (!editingPosition) return;
    const { competitorId, value } = editingPosition;
    setEditingPosition(null);

    const parsed = parseInt(value, 10);
    if (isNaN(parsed) || !Number.isInteger(Number(value))) return;

    const positions = computePositions(finishingOrder, tiedWithPrevious);
    const currentIdx = finishingOrder.indexOf(competitorId);
    const currentPos = positions[currentIdx];
    if (parsed === currentPos) return;

    // Check if typed position matches another boat — tie request
    const matchIdx = positions.findIndex((p, i) => p === parsed && i !== currentIdx);

    if (matchIdx !== -1) {
      // Find the last boat in the group with that position
      let groupEnd = matchIdx;
      while (groupEnd + 1 < positions.length && positions[groupEnd + 1] === parsed) {
        groupEnd++;
      }

      // Move this boat to right after the group
      const newOrder = [...finishingOrder];
      newOrder.splice(currentIdx, 1);
      const adjustedGroupEnd = groupEnd > currentIdx ? groupEnd - 1 : groupEnd;
      newOrder.splice(adjustedGroupEnd + 1, 0, competitorId);

      setFinishingOrder(newOrder);
      setTiedWithPrevious((prev) => {
        const next = new Set(prev);
        // Break old successor's tie (its anchor is moving away)
        const oldSuccessorId = finishingOrder[currentIdx + 1];
        if (oldSuccessorId && next.has(oldSuccessorId)) {
          next.delete(oldSuccessorId);
        }
        next.add(competitorId);
        return next;
      });
      return;
    }

    // Normal reorder (no tie match) — also clears any existing tie on this boat
    const clamped = Math.max(1, Math.min(finishingOrder.length, parsed));
    const newOrder = reorderFinisher(finishingOrder, competitorId, clamped);
    const newIdx = newOrder.indexOf(competitorId);

    setFinishingOrder(newOrder);
    setTiedWithPrevious((prev) => {
      const next = new Set(prev);
      next.delete(competitorId);
      // Break old successor's tie (its anchor moved away)
      const oldSuccessorId = finishingOrder[currentIdx + 1];
      if (oldSuccessorId && next.has(oldSuccessorId)) {
        next.delete(oldSuccessorId);
      }
      // Break new successor's tie (it was tied with its former predecessor, not this boat)
      const newSuccessorId = newOrder[newIdx + 1];
      if (newSuccessorId && next.has(newSuccessorId)) {
        next.delete(newSuccessorId);
      }
      return next;
    });
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
    const isPresent = existing?.startPresent === true;

    if (isPresent) {
      // Un-check: remove startPresent flag
      if (existing && existing.finishPosition === null && existing.resultCode === null) {
        // Check-in-only record — delete it entirely
        await finishRepo.delete(existing.id);
      } else if (existing) {
        // Has other data — clear just the flag
        await finishRepo.save({ ...existing, startPresent: false });
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
          finishPosition: null,
          resultCode: null,
          startPresent: true,
        });
      }
    }
    await seriesRepo.touch(seriesId);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError('');
    try {
      // Preserve startPresent data from existing finishes (set via check-in)
      const existing = await finishRepo.listByRace(raceId);
      const startPresentMap = new Map(
        existing
          .filter((f) => f.startPresent !== null)
          .map((f) => [f.competitorId, f.startPresent as boolean]),
      );

      const finishes: Finish[] = [];

      // Finishers — use computed positions to preserve ties
      const savedPositions = computePositions(finishingOrder, tiedWithPrevious);
      finishingOrder.forEach((competitorId, index) => {
        finishes.push({
          id: crypto.randomUUID(),
          raceId,
          competitorId,
          finishPosition: savedPositions[index],
          resultCode: null,
          startPresent: startPresentMap.get(competitorId) ?? null,
        });
      });

      // Non-finishers with explicit codes
      for (const [competitorId, code] of nonFinisherCodes) {
        if (!finishedIds.has(competitorId)) {
          finishes.push({
            id: crypto.randomUUID(),
            raceId,
            competitorId,
            finishPosition: null,
            resultCode: code,
            startPresent: startPresentMap.get(competitorId) ?? null,
          });
        }
      }

      // Check-in-only records: competitors with startPresent=true but not in finish list or codes
      const accountedIds = new Set([
        ...finishingOrder,
        ...nonFinisherCodes.keys(),
      ]);
      for (const [competitorId, present] of startPresentMap) {
        if (present && !accountedIds.has(competitorId)) {
          finishes.push({
            id: crypto.randomUUID(),
            raceId,
            competitorId,
            finishPosition: null,
            resultCode: null,
            startPresent: true,
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
    DNC: 'DNC',
    DNF: 'DNF',
    OCS: 'OCS',
  };

  const presentCount = savedFinishes?.filter((f) => f.startPresent === true).length ?? 0;

  const checkinSuggestions = checkinInput.trim()
    ? (competitors ?? []).filter((c) =>
        c.sailNumber.toUpperCase().startsWith(checkinInput.trim().toUpperCase()),
      )
    : [];

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
          <p className="text-sm font-medium">
            Present at start: {presentCount} / {competitors?.length ?? 0}
          </p>
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
                  const present = savedFinishes?.find((f) => f.competitorId === c.id)?.startPresent === true;
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
                      <span className="flex-1 truncate">{c.name}</span>
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
            {(competitors ?? []).map((c) => {
              const present = savedFinishes?.find((f) => f.competitorId === c.id)?.startPresent === true;
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
                  <span className="text-sm flex-1 truncate">{c.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'finish' && <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Left: finishing order */}
        <div className="space-y-4">
          <h3 className="font-medium">Finishing order</h3>

          <div className="relative">
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                value={sailInput}
                onChange={(e) => { setSailInput(e.target.value); setInputError(''); setHighlightedIndex(-1); }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setHighlightedIndex((i) => Math.min(i + 1, suggestions.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setHighlightedIndex((i) => Math.max(i - 1, -1));
                  } else if (e.key === 'Escape') {
                    if (suggestions.length > 0 || sailInput.trim()) {
                      setHighlightedIndex(-1);
                      setSailInput('');
                    } else {
                      tryLeave();
                    }
                  } else if (e.key === 'Tab' && suggestions.length > 0) {
                    e.preventDefault();
                    selectSuggestion(suggestions[Math.max(highlightedIndex, 0)].competitor);
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    addFinisher();
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
            {suggestions.length > 0 && (
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
                      selectSuggestion(competitor);
                    }}
                  >
                    <span className="font-mono font-medium w-16 shrink-0">{competitor.sailNumber}</span>
                    <span className="flex-1 truncate">{competitor.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {inputError && <p className="text-sm text-destructive">{inputError}</p>}

          {finishingOrder.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Enter sail numbers in finishing order above.
            </p>
          )}

          {(() => {
            const displayPositions = computePositions(finishingOrder, tiedWithPrevious);
            return (
              <ol className="space-y-1.5">
                {finishingOrder.map((competitorId, index) => {
                  const competitor = competitorMap.get(competitorId);
                  if (!competitor) return null;
                  const displayPos = displayPositions[index];
                  const isTied = tiedWithPrevious.has(competitorId);
                  return (
                    <li
                      key={competitorId}
                      className="flex items-center gap-3 border rounded-lg px-4 py-2.5"
                    >
                      <div className="flex items-center shrink-0">
                        <input
                          type="number"
                          min={1}
                          max={finishingOrder.length}
                          data-testid={`position-input-${competitor.sailNumber}`}
                          aria-label={`Position for ${competitor.sailNumber}`}
                          value={
                            editingPosition?.competitorId === competitorId
                              ? editingPosition.value
                              : String(displayPos)
                          }
                          className="w-10 text-right text-sm font-mono text-muted-foreground rounded px-1 border border-transparent bg-transparent focus:border-input focus:bg-background focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          onFocus={() =>
                            setEditingPosition({ competitorId, value: String(displayPos) })
                          }
                          onChange={(e) =>
                            setEditingPosition({ competitorId, value: e.target.value })
                          }
                          onBlur={commitPositionEdit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitPositionEdit();
                              (e.target as HTMLInputElement).blur();
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              setEditingPosition(null);
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                        />
                        <span className={cn('w-3 text-xs font-mono text-muted-foreground', isTied ? '' : 'invisible')} aria-hidden>
                          =
                        </span>
                      </div>
                      <span className="font-mono font-medium">{competitor.sailNumber}</span>
                      <span className="text-sm flex-1 truncate">{competitor.name}</span>
                      <button
                        onClick={() => removeFinisher(competitorId)}
                        aria-label={`Remove ${competitor.sailNumber}`}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  );
                })}
              </ol>
            );
          })()}
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
                  className="flex items-center gap-3 border rounded-lg px-4 py-2"
                >
                  <span className="font-mono font-medium w-16 shrink-0">
                    {competitor.sailNumber}
                  </span>
                  <span className="text-sm flex-1 truncate">{competitor.name}</span>
                  <Select
                    value={code}
                    onValueChange={(v) =>
                      setNonFinisherCode(competitor.id, v as NonFinisherCode)
                    }
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
          {finishingOrder.length} finisher{finishingOrder.length === 1 ? '' : 's'},{' '}
          {nonFinishers.length} non-finisher{nonFinishers.length === 1 ? '' : 's'}
        </div>
        {saveError && <p className="text-sm text-destructive">{saveError}</p>}
      </div>

      <Dialog open={showLeaveConfirm} onOpenChange={(open) => { if (!open) setShowLeaveConfirm(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">You have unsaved changes. Save before leaving?</p>
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
