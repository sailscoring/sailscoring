'use client';

import { useMemo, useState } from 'react';

import { useSetResultsStatus } from '@/hooks/use-series';
import { usePublicationStatus } from '@/hooks/use-published';
import {
  effectiveLastFinisherTime,
  lastRaceOfSeries,
  protestTimeLimitEnd,
} from '@/lib/race-status';
import type { Finish, Race, Series } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * The "Mark as final" checklist. Finalising is scorer-initiated, but the
 * three conditions that make "Final" mean something (RRS 90.3(e)) are put in
 * front of the scorer as required assertions: the protest / redress time
 * limit has passed, nothing is pending in the protest room, and nothing else
 * is outstanding. The dialog computes what it can — the last race's protest
 * time limit from its last finisher and the configured SI limit — and shows
 * it above the checkboxes; the human still makes the call, so an amber
 * "limit has not yet passed" warns without blocking.
 */
export function FinaliseResultsDialog({
  series,
  races,
  finishes,
  open,
  onClose,
}: {
  series: Series;
  races: Race[];
  finishes: Finish[];
  open: boolean;
  onClose: () => void;
}) {
  const setResultsStatus = useSetResultsStatus();
  const { data: publication } = usePublicationStatus(open ? series.id : null);
  const [checks, setChecks] = useState([false, false, false]);
  // Reset on the way out (not in an effect) so the next open starts unticked.
  function handleClose() {
    setChecks([false, false, false]);
    onClose();
  }

  const context = useMemo(() => {
    if (!open) return null;
    const lastRace = lastRaceOfSeries(races);
    if (!lastRace) return null;
    const finishesByRace = new Map<string, Finish[]>();
    for (const f of finishes) {
      const list = finishesByRace.get(f.raceId) ?? [];
      list.push(f);
      finishesByRace.set(f.raceId, list);
    }
    const lastFinisher = effectiveLastFinisherTime(
      lastRace,
      finishesByRace.get(lastRace.id) ?? [],
    );
    const limitEnd = protestTimeLimitEnd(
      series.protestTimeLimit,
      lastRace,
      races,
      finishesByRace,
    );
    return { lastRace, lastFinisher, limitEnd, now: new Date() };
  }, [open, races, finishes, series.protestTimeLimit]);

  const raceLabel = context
    ? `Race ${context.lastRace.raceNumber}${context.lastRace.name ? ` (${context.lastRace.name})` : ''}`
    : '';
  const limitLabel = context?.limitEnd
    ? context.limitEnd.toLocaleString([], {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;
  const limitPassed =
    context?.limitEnd != null && context.limitEnd <= context.now;

  const allChecked = checks.every(Boolean);
  const toggle = (i: number) =>
    setChecks((prev) => prev.map((c, j) => (j === i ? !c : c)));

  async function confirm() {
    await setResultsStatus.mutateAsync({ id: series.id, status: 'final' });
    handleClose();
  }

  const checklist: { title: string; detail: string }[] = [
    {
      title: 'The protest and request-for-redress time limit has passed.',
      detail:
        'For the last race of the event, per the sailing instructions — or, where they are silent, RRS 60.3(b): two hours after the last boat finishes. Where the notice of race invokes RRS 90.3(e), score changes close 24 hours after this limit.',
    },
    {
      title:
        'No scoring inquiries, protests or requests for redress are pending, and no protest committee decisions are outstanding.',
      detail: 'Nothing in the protest room can still move a score.',
    },
    {
      title:
        'The results team and event organiser are not aware of any other outstanding issues.',
      detail: 'No pending corrections, unresolved finishes, or queries.',
    },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Mark results as final</DialogTitle>
          <DialogDescription>
            Final results are settled: the series becomes read-only until it is
            reopened as provisional, and published pages show a Final stamp
            once republished.
          </DialogDescription>
        </DialogHeader>

        {context && (
          <div
            className={
              context.limitEnd && !limitPassed
                ? 'rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200'
                : 'rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground'
            }
          >
            {context.lastFinisher ? (
              <>
                {raceLabel}&rsquo;s last finisher: {context.lastFinisher.time}{' '}
                on {context.lastRace.date || 'an undated race'}.
                {limitLabel &&
                  (limitPassed ? (
                    <> Protest time limit ({limitLabel}) has passed.</>
                  ) : (
                    <>
                      {' '}
                      <strong>
                        Protest time limit runs until {limitLabel}.
                      </strong>
                    </>
                  ))}
                {!context.limitEnd && series.protestTimeLimit == null && (
                  <>
                    {' '}
                    No protest time limit is configured for this series
                    (Settings).
                  </>
                )}
              </>
            ) : (
              <>
                No last-finisher time is recorded for {raceLabel}, so the
                protest time limit can&rsquo;t be computed.
              </>
            )}
          </div>
        )}

        <div className="space-y-3">
          {checklist.map((item, i) => (
            <label
              key={item.title}
              className="flex cursor-pointer items-start gap-2 text-sm"
            >
              <input
                type="checkbox"
                className="mt-0.5"
                checked={checks[i]}
                onChange={() => toggle(i)}
              />
              <span>
                <span className="font-medium">{item.title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {item.detail}
                </span>
              </span>
            </label>
          ))}
        </div>

        {publication?.published && (
          <p className="text-xs text-muted-foreground">
            This series is published. The public page keeps its provisional
            stamp until you publish again after finalising.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={confirm}
            disabled={!allChecked || setResultsStatus.isPending}
          >
            Mark as final
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
