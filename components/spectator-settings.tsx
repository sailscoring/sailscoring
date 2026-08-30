'use client';

import {
  COMPETITOR_FIELD_LABELS,
  defaultEnabledCompetitorFields,
} from '@/lib/competitor-fields';
import { summarizeDiscardRules } from '@/lib/discard-rules';
import type { Fleet, Series } from '@/lib/types';

/**
 * How an event was set up, read-only (#475, ADR-012).
 *
 * The settings cards can't serve a spectator view: they auto-save, so every
 * one of them would bounce. But how a series is scored is exactly what a
 * reader came to find out — it is the question a published results page never
 * answers, and the reason someone would open the data behind one. So the same
 * facts are stated instead of offered for editing, which reads better than a
 * page of disabled form controls would.
 */
export function SpectatorSettings({
  series,
  fleets,
}: {
  series: Series;
  fleets: Fleet[];
}) {
  const enabled = series.enabledCompetitorFields ?? defaultEnabledCompetitorFields();
  const rows: { label: string; value: string }[] = [
    {
      label: 'Scoring mode',
      value:
        series.scoringMode === 'handicap'
          ? 'Handicap (time-corrected)'
          : 'Scratch (position-based)',
    },
    { label: 'Discards', value: discardsLabel(series) },
    { label: 'Non-finishers', value: dnfLabel(series) },
    ...(series.protestTimeLimit
      ? [
          {
            label: 'Protest time limit',
            value: `${series.protestTimeLimit.minutes} minutes after the last boat ${
              series.protestTimeLimit.basis === 'day'
                ? 'finishes the last race of the day'
                : 'finishes the race'
            }`,
          },
        ]
      : []),
    {
      label: 'Competitor details',
      value: enabled.length
        ? enabled.map((f) => COMPETITOR_FIELD_LABELS[f] ?? f).join(', ')
        : 'Sail number and name only',
    },
  ];

  return (
    <div className="space-y-6 max-w-lg" data-testid="spectator-settings">
      <div className="bg-card border rounded-lg p-5 space-y-3">
        <h2 className="text-sm font-medium">How this series is scored</h2>
        <dl className="space-y-2 text-sm">
          {rows.map((row) => (
            <div key={row.label} className="flex gap-3">
              <dt className="w-40 shrink-0 text-muted-foreground">{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="bg-card border rounded-lg p-5 space-y-3">
        <h2 className="text-sm font-medium">
          {fleets.length === 1 ? 'Fleet' : `Fleets (${fleets.length})`}
        </h2>
        <dl className="space-y-2 text-sm">
          {fleets.map((fleet) => (
            <div key={fleet.id} className="flex gap-3">
              <dt className="w-40 shrink-0 text-muted-foreground">{fleet.name}</dt>
              <dd>{SCORING_SYSTEM_LABELS[fleet.scoringSystem] ?? fleet.scoringSystem}</dd>
            </div>
          ))}
        </dl>
      </div>

      <p className="text-sm text-muted-foreground">
        Save these results to a workspace to change any of this and re-score
        them for yourself.
      </p>
    </div>
  );
}

const SCORING_SYSTEM_LABELS: Record<Fleet['scoringSystem'], string> = {
  scratch: 'Scratch — finish order as sailed',
  irc: 'IRC — corrected time',
  py: 'Portsmouth Yardstick — corrected time',
  vprs: 'VPRS — corrected time',
  orc: 'ORC — corrected time',
  nhc: 'NHC — progressive handicap',
  echo: 'ECHO — progressive handicap',
};

function discardsLabel(series: Series): string {
  if (series.proportionalDiscard) {
    const { firstAt, everyRaces } = series.proportionalDiscard;
    return `First discard at ${firstAt} races, then one per ${everyRaces} more`;
  }
  return summarizeDiscardRules(series.discardThresholds ?? []);
}

function dnfLabel(series: Series): string {
  switch (series.dnfScoring) {
    case 'startingArea':
      return 'Scored on boats that came to the starting area (RRS A5.3)';
    case 'startingAreaInclDnc':
      return 'Scored on boats that came to the starting area, DNC included';
    default:
      return 'Scored on series entries (RRS A5.2)';
  }
}
