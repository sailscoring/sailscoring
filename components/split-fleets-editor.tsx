'use client';

// The one split-fleet configuration surface, used identically wherever a
// scorer meets it: the series setup wizard, the Settings card's enable path,
// and the Settings card once the series is running.
//
// Two things shape the design. First, scorers configure this once every year
// or two, from an SI or NoR someone else wrote — so every field says what it
// does in words, shows what it means for the boats actually entered, and the
// whole configuration is restated as sailing-instruction prose to check
// against that document. Second, a class format is a *filler*: picking one
// writes the fields below, which stay visible and editable.

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useSaveSplitFleetConfig } from '@/hooks/use-split-fleets';
import { describeSplitFleetConfig } from '@/lib/split-fleets-si';
import {
  QUALIFYING_COLOR_SETS,
  FINAL_FLEET_SET,
  defaultSplitFleetConfig,
  finalBlockSizes,
  iodaSplitFleetConfig,
  type SplitFleetConfig,
} from '@/lib/split-fleets';

type FormatKey = 'ilca' | 'ioda' | 'net-plus-net' | 'rank-seed';

/** Known class formats. Each is a complete configuration; picking one fills
 *  every field below, which the scorer then adjusts to match their SIs. */
const FORMATS: Record<FormatKey, { label: string; build: (fleetCount: number) => SplitFleetConfig }> = {
  ilca: {
    label: 'ILCA World/European Championship',
    build: defaultSplitFleetConfig,
  },
  ioda: {
    label: 'IODA (Optimist) Championship',
    build: iodaSplitFleetConfig,
  },
  'net-plus-net': {
    label: 'Two series added together (29er and similar)',
    build: (n) => ({
      ...defaultSplitFleetConfig(n),
      carry: 'net-plus-net',
      discardThresholds: [{ minRaces: 3, discardCount: 1 }],
      medal: undefined,
    }),
  },
  'rank-seed': {
    label: 'Qualifying position carried forward (470, Topper)',
    build: (n) => ({
      ...defaultSplitFleetConfig(n),
      carry: 'rank-seed',
      discardThresholds: [{ minRaces: 4, discardCount: 1 }],
      medal: undefined,
    }),
  },
};

const CARRY_OPTIONS: { value: SplitFleetConfig['carry']; label: string; hint: string }[] = [
  {
    value: 'points',
    label: 'One continuous series',
    hint: 'Qualifying and final race scores are totalled together for the championship, and discards apply across the whole line.',
  },
  {
    value: 'net-plus-net',
    label: 'Two series, added together',
    hint: 'The qualifying and final series are each scored as their own series, with their own discards; the championship score is the sum of the two.',
  },
  {
    value: 'rank-seed',
    label: 'Qualifying position carried forward',
    hint: 'A boat carries her qualifying finishing position into the final series as one score that can never be discarded; her qualifying race scores drop out.',
  },
];

export function SplitFleetEditor({
  seriesId,
  config,
  competitorCount,
  canEdit,
  locked,
  onEnabled,
}: {
  seriesId: string;
  /** The stored configuration, or null on a series that isn't split-fleet
   *  yet — then the fields edit a local draft until Enable is pressed. */
  config: SplitFleetConfig | null;
  /** Entries so far, for the "what this means for your event" numbers. */
  competitorCount: number;
  canEdit: boolean;
  /** Racing has started: the two structural fields are settled. */
  locked?: boolean;
  onEnabled?: () => void;
}) {
  const save = useSaveSplitFleetConfig(seriesId);
  const [format, setFormat] = useState<FormatKey>('ilca');
  const [customised, setCustomised] = useState(false);
  const [draft, setDraft] = useState<SplitFleetConfig>(() => defaultSplitFleetConfig(3));

  const value = config ?? draft;
  const isDraft = config === null;

  function patch(p: Partial<SplitFleetConfig>) {
    setCustomised(true);
    if (isDraft) setDraft({ ...draft, ...p });
    else save.mutate({ ...value, ...p });
  }

  function pickFormat(next: FormatKey) {
    setFormat(next);
    setCustomised(false);
    const built = FORMATS[next].build(value.qualifyingFleets.length);
    if (isDraft) setDraft(built);
    else save.mutate(built);
  }

  function setFleetCount(n: number) {
    patch({
      qualifyingFleets: QUALIFYING_COLOR_SETS.slice(0, n),
      finalFleets: FINAL_FLEET_SET.slice(0, n),
    });
  }

  const fleetCount = value.qualifyingFleets.length;
  const entries = competitorCount;
  // What the settings mean for the boats actually entered.
  const qualifyingSizes = entries > 0 ? finalBlockSizes(entries, fleetCount) : [];
  const finalSizes =
    entries > 0
      ? value.split.kind === 'fixed-top'
        ? [Math.min(value.split.topSize, entries), Math.max(entries - value.split.topSize, 0)]
        : finalBlockSizes(entries, value.finalFleets.length)
      : [];
  const largestQualifying = qualifyingSizes[0] ?? 0;
  const goldSize = finalSizes[0] ?? 0;

  const rowClass = 'grid gap-1.5 sm:grid-cols-[13rem_1fr] sm:items-baseline sm:gap-3';
  const selectClass = 'w-full max-w-full rounded-md border bg-background px-2 py-1 text-sm';
  const hint = 'text-xs text-muted-foreground';

  return (
    <div className="space-y-4 text-sm" data-testid="split-fleets-editor">
      <div className={rowClass}>
        <label className="font-medium" htmlFor="sf-format">Format</label>
        <div className="space-y-1">
          <select
            id="sf-format"
            className={selectClass}
            disabled={!canEdit}
            value={format}
            onChange={(e) => pickFormat(e.target.value as FormatKey)}
          >
            {(Object.keys(FORMATS) as FormatKey[]).map((k) => (
              <option key={k} value={k}>{FORMATS[k].label}</option>
            ))}
          </select>
          <p className={hint}>
            {customised
              ? `Custom — started from ${FORMATS[format].label}. Every setting below is yours to change.`
              : 'Fills the settings below. Change any of them to match your sailing instructions.'}
          </p>
        </div>
      </div>

      <div className={rowClass}>
        <label className="font-medium" htmlFor="sf-fleet-count">Qualifying fleets</label>
        <div className="space-y-1">
          {locked ? (
            <p>{value.qualifyingFleets.map((f) => f.label).join(', ')}</p>
          ) : (
            <select
              id="sf-fleet-count"
              className={selectClass}
              disabled={!canEdit}
              value={fleetCount}
              onChange={(e) => setFleetCount(Number(e.target.value))}
            >
              {[2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n} — {QUALIFYING_COLOR_SETS.slice(0, n).map((f) => f.label).join(', ')}
                </option>
              ))}
            </select>
          )}
          <p className={hint}>
            {entries > 0
              ? `${entries} entries → ${value.qualifyingFleets
                  .map((f, i) => `${f.label} ${qualifyingSizes[i]}`)
                  .join(', ')}. Boats are reassigned by series rank after each day of racing.`
              : 'Boats are reassigned by series rank after each day of racing.'}
          </p>
        </div>
      </div>

      <fieldset className={rowClass}>
        <legend className="font-medium">How scores carry into the final series</legend>
        <div className="space-y-2">
          {CARRY_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-start gap-2">
              <input
                type="radio"
                name="sf-carry"
                className="mt-1"
                disabled={!canEdit || locked}
                checked={value.carry === opt.value}
                onChange={() => patch({ carry: opt.value })}
              />
              <span>
                <span className={value.carry === opt.value ? 'font-medium' : undefined}>
                  {opt.label}
                </span>
                <span className={`block ${hint}`}>{opt.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className={rowClass}>
        <label className="font-medium" htmlFor="sf-split">
          How boats are divided for the final series
        </label>
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <select
              id="sf-split"
              className={`${selectClass} sm:w-auto`}
              disabled={!canEdit}
              value={value.split.kind}
              onChange={(e) =>
                patch({
                  split:
                    e.target.value === 'fixed-top'
                      ? {
                          kind: 'fixed-top',
                          topSize: value.split.kind === 'fixed-top' ? value.split.topSize : 25,
                        }
                      : { kind: 'equal-blocks' },
                })
              }
            >
              <option value="equal-blocks">Near-equal fleets by rank</option>
              <option value="fixed-top">A fixed number in the top fleet</option>
            </select>
            {value.split.kind === 'fixed-top' && (
              <input
                type="number"
                aria-label="Boats in the top fleet"
                min={1}
                className="w-20 rounded-md border bg-background px-2 py-1 text-sm"
                disabled={!canEdit}
                value={value.split.topSize}
                onChange={(e) =>
                  patch({ split: { kind: 'fixed-top', topSize: Math.max(1, Number(e.target.value)) } })
                }
              />
            )}
          </div>
          <p className={hint}>
            {entries > 0
              ? `${entries} entries → ${value.finalFleets
                  .map((f, i) => `${f.label} ${finalSizes[i] ?? 0}`)
                  .join(', ')}.`
              : `The qualifying ranking is divided into ${value.finalFleets.map((f) => f.label).join(', ')}.`}
          </p>
        </div>
      </div>

      <div className={rowClass}>
        <span className="font-medium">Discards</span>
        <div className="space-y-1">
          <p>
            {value.discardThresholds.length === 0
              ? 'No discards.'
              : value.discardThresholds
                  .map((t) => `${t.discardCount} from ${t.minRaces} races`)
                  .join(', ')}
            {value.carry === 'points' && (
              <>
                {' · '}at most {value.maxFinalDiscards} from the final series
                {value.protectLoneFinalRace && ' · a lone final race is never discarded'}
              </>
            )}
            {value.carry === 'net-plus-net' && ' · applied to each series separately'}
          </p>
          <p className={hint}>
            {isDraft
              ? 'Set by the format above; editable in the Scoring settings once this is enabled.'
              : 'Edited in the Scoring card below, with the rest of this series’ discard rules.'}
          </p>
        </div>
      </div>

      <div className={rowClass}>
        <label className="font-medium" htmlFor="sf-code-q">
          Scoring a boat that doesn’t start or finish
        </label>
        <div className="space-y-2">
          <div className="space-y-1">
            <select
              id="sf-code-q"
              className={selectClass}
              disabled={!canEdit}
              value={value.codeBasis.qualifying}
              onChange={(e) =>
                patch({
                  codeBasis: {
                    ...value.codeBasis,
                    qualifying: e.target.value as 'largest-fleet' | 'fixed',
                  },
                })
              }
            >
              <option value="largest-fleet">
                Qualifying: boats in the largest qualifying fleet, plus one
              </option>
              <option value="fixed">Qualifying: a fixed number of points</option>
            </select>
            {value.codeBasis.qualifying === 'fixed' && (
              <input
                type="number"
                aria-label="Fixed non-finisher score"
                min={1}
                className="w-24 rounded-md border bg-background px-2 py-1 text-sm"
                disabled={!canEdit}
                value={value.codeBasis.fixedPoints ?? largestQualifying + 1}
                onChange={(e) =>
                  patch({ codeBasis: { ...value.codeBasis, fixedPoints: Number(e.target.value) } })
                }
              />
            )}
          </div>
          <select
            className={selectClass}
            aria-label="Scoring a boat that doesn’t start or finish a final-series race"
            disabled={!canEdit}
            value={value.codeBasis.final}
            onChange={(e) =>
              patch({
                codeBasis: {
                  ...value.codeBasis,
                  final: e.target.value as 'own-fleet' | 'largest-qualifying',
                },
              })
            }
          >
            <option value="own-fleet">Final series: boats in her own final fleet, plus one</option>
            <option value="largest-qualifying">
              Final series: boats in the largest qualifying fleet, plus one
            </option>
          </select>
          {entries > 0 && (
            <p className={hint}>
              With {entries} entries that is{' '}
              {value.codeBasis.qualifying === 'fixed'
                ? (value.codeBasis.fixedPoints ?? largestQualifying + 1)
                : largestQualifying + 1}{' '}
              in the qualifying series and{' '}
              {value.codeBasis.final === 'largest-qualifying'
                ? largestQualifying + 1
                : goldSize + 1}{' '}
              in {value.finalFleets[0]?.label ?? 'the top fleet'}.
            </p>
          )}
        </div>
      </div>

      <div className={rowClass}>
        <label className="font-medium" htmlFor="sf-tie">
          If two boats are exactly tied when fleets are assigned
        </label>
        <div className="space-y-1">
          <select
            id="sf-tie"
            className={selectClass}
            disabled={!canEdit}
            value={value.reassignmentTieOrder}
            onChange={(e) =>
              patch({
                reassignmentTieOrder: e.target.value as 'a8-then-entry-order' | 'fleet-order',
              })
            }
          >
            <option value="a8-then-entry-order">The better seeding rank goes to the higher fleet</option>
            <option value="fleet-order">Alternate tied boats down the fleet list</option>
          </select>
          <p className={hint}>
            Only matters when a tie the racing rules can’t break falls exactly on a fleet boundary.
          </p>
        </div>
      </div>

      <div className={rowClass}>
        <span className="font-medium">Medal race</span>
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={!!value.medal}
                onChange={(e) =>
                  patch({
                    medal: e.target.checked ? { size: 10, raceCount: 1, multiplier: 2 } : undefined,
                  })
                }
              />
              Sailed by the top
            </label>
            {value.medal && (
              <>
                <input
                  type="number"
                  aria-label="Medal fleet size"
                  min={2}
                  className="w-16 rounded-md border bg-background px-2 py-1 text-sm"
                  disabled={!canEdit}
                  value={value.medal.size}
                  onChange={(e) =>
                    patch({ medal: { ...value.medal!, size: Math.max(2, Number(e.target.value)) } })
                  }
                />
                <span>boats, scoring ×</span>
                <input
                  type="number"
                  aria-label="Medal points multiplier"
                  min={1}
                  className="w-16 rounded-md border bg-background px-2 py-1 text-sm"
                  disabled={!canEdit}
                  value={value.medal.multiplier}
                  onChange={(e) =>
                    patch({
                      medal: { ...value.medal!, multiplier: Math.max(1, Number(e.target.value)) },
                    })
                  }
                />
              </>
            )}
          </div>
          {value.medal && (
            <p className={hint}>
              Never discarded. The rest of {value.finalFleets[0]?.label ?? 'the top fleet'} sail a
              companion race scored from {value.medal.size + 1}.
            </p>
          )}
        </div>
      </div>

      <SiTranslation config={value} />

      {isDraft && (
        <div className="flex items-center gap-2">
          <Button disabled={!canEdit || save.isPending} onClick={async () => {
            await save.mutateAsync(draft);
            onEnabled?.();
          }}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Enable split fleets
          </Button>
        </div>
      )}
      {save.isError && <p className="text-destructive">{String(save.error)}</p>}
    </div>
  );
}

/** The configuration restated as sailing-instruction prose, for checking
 *  against the document the scorer was handed. */
function SiTranslation({ config }: { config: SplitFleetConfig }) {
  const [open, setOpen] = useState(false);
  const lines = describeSplitFleetConfig(config);
  return (
    <div className="rounded-md border bg-muted/30 p-3" data-testid="sf-si-translation">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left font-medium"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        How this configuration translates to sailing instructions
        <span className="text-muted-foreground">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted-foreground">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-muted-foreground">
            Read this against the scoring section of your sailing instructions. Where it
            disagrees, change the setting above — not the boats.
          </p>
        </>
      )}
    </div>
  );
}
