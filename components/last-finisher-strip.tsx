'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  lastKnownFinish,
  protestTimeLimitEnd,
} from '@/lib/race-status';
import { parseHmsToSeconds } from '@/lib/time-parse';
import type { Finish, Race, Series } from '@/lib/types';

/** Local-date ISO string ("YYYY-MM-DD") for comparing against race dates. */
function localIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatAgo(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m ago` : `${m}m ago`;
}

function formatClock(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Race-day recency strip: how long since the last known race's last
 * finisher, and where the protest time limit stands. Shown only while it's
 * actionable — the race was today, or a configured limit hasn't passed yet —
 * so a series whose last race was weeks ago shows nothing rather than a
 * useless "504h ago".
 */
export function LastFinisherStrip({
  series,
  races,
  finishes,
}: {
  series: Series;
  races: Race[];
  finishes: Finish[];
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const finishesByRace = useMemo(() => {
    const map = new Map<string, Finish[]>();
    for (const f of finishes) {
      const list = map.get(f.raceId) ?? [];
      list.push(f);
      map.set(f.raceId, list);
    }
    return map;
  }, [finishes]);

  const known = useMemo(
    () => lastKnownFinish(races, finishesByRace),
    [races, finishesByRace],
  );
  if (!known) return null;

  const limitEnd = protestTimeLimitEnd(
    series.protestTimeLimit,
    known.race,
    races,
    finishesByRace,
  );
  const isToday = known.race.date === localIsoDate(now);
  const limitPending = limitEnd !== null && limitEnd > now;
  if (!isToday && !limitPending) return null;

  const finishSeconds = parseHmsToSeconds(known.lastFinisher.time);
  const finishedAt =
    known.race.date && finishSeconds != null
      ? new Date(
          new Date(`${known.race.date}T00:00:00`).getTime() +
            finishSeconds * 1000,
        )
      : null;

  return (
    <div
      className="rounded-lg border bg-muted/30 px-4 py-2.5 text-sm"
      data-testid="last-finisher-strip"
    >
      <span className="font-medium">
        Last finisher (Race {known.race.raceNumber}): {known.lastFinisher.time}
      </span>
      {finishedAt && finishedAt <= now && (
        <span className="text-muted-foreground">
          {' '}
          · {formatAgo(now.getTime() - finishedAt.getTime())}
        </span>
      )}
      {limitEnd &&
        (limitPending ? (
          <span className="text-muted-foreground">
            {' '}
            · protest time limit until {formatClock(limitEnd)}
          </span>
        ) : (
          <span className="text-muted-foreground">
            {' '}
            · protest time limit passed at {formatClock(limitEnd)}
          </span>
        ))}
    </div>
  );
}
