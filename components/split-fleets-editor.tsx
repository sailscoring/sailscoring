'use client';

// The one split-fleet configuration surface, used identically wherever a
// scorer meets it: the series setup wizard, the Settings card's enable path,
// and the Settings card once the series is running.
//
// Two things shape the design. First, scorers configure this once every year
// or two, from an SI or NoR someone else wrote — so every field says what it
// does in words, shows what it means for the boats actually entered, and the
// whole configuration is restated as sailing-instruction prose to check
// against that document — and reaching a setting, by pointer or by keyboard,
// marks the sentences that setting writes, so which clause a checkbox governs
// doesn't have to be discovered by flipping it. Second, a class format is a
// *filler*: picking one writes the fields below, which stay visible and
// editable.

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useSaveSplitFleetConfig } from '@/hooks/use-split-fleets';
import { describeSplitFleetConfig, SENTENCES_BY_SETTING } from '@/lib/split-fleets-si';
import type { SplitFleetSentenceId } from '@/lib/split-fleets-si';
import {
  QUALIFYING_COLOR_SETS,
  FINAL_FLEET_SET,
  defaultSplitFleetConfig,
  finalBlockSizes,
  ilca2026SplitFleetConfig,
  ilcaSplitFleetConfig,
  iodaSplitFleetConfig,
  capitaliseStage,
  resolveVocabulary,
  VOCABULARY_OPTIONS,
  stageRaceLabel,
  type SplitFleetConfig,
  type Vocabulary,
  type VocabularyKey,
} from '@/lib/split-fleets';

type FormatKey = 'ilca-2026' | 'ilca-2025' | 'ioda' | 'net-plus-net' | 'rank-seed';

/** Known class formats. Each is a complete configuration; picking one fills
 *  every field below, which the scorer then adjusts to match their SIs. */
const FORMATS: Record<FormatKey, { label: string; build: (fleetCount: number) => SplitFleetConfig }> = {
  'ilca-2026': {
    label: 'ILCA World/European Championship (2026 onward)',
    build: ilca2026SplitFleetConfig,
  },
  'ilca-2025': {
    label: 'ILCA World/European Championship (through 2025)',
    build: ilcaSplitFleetConfig,
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
    label: 'First-stage position carried forward (470, Topper)',
    build: (n) => ({
      ...defaultSplitFleetConfig(n),
      carry: 'rank-seed',
      discardThresholds: [{ minRaces: 4, discardCount: 1 }],
      medal: undefined,
    }),
  },
};

/** What a new series starts from, and so what the settings below show first. */
const INITIAL_FORMAT: FormatKey = 'ilca-2026';

/**
 * Whether a config is still exactly the class format it was built from.
 *
 * Compared field by field against a freshly built one rather than tracked as
 * "has been edited", so undoing an edit restores the format's name instead of
 * leaving the series marked Custom forever. The fleet count is passed through
 * because it is a choice of its own, not a departure from the format.
 */
function matchesFormat(config: SplitFleetConfig, format: FormatKey): boolean {
  const built = FORMATS[format].build(config.qualifyingFleets.length);
  return JSON.stringify(canonical(built)) === JSON.stringify(canonical(config));
}

/** Key order varies with how a config was assembled; sort it away. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

/** Built from the series' vocabulary rather than fixed, like every other
 *  stage word here: "the qualifying series" and "the final series" name
 *  different stages depending on which wording the championship uses. */
function carryOptions(
  vocab: Vocabulary,
): { value: SplitFleetConfig['carry']; label: string; hint: string }[] {
  const q = vocab.stages.qualifying.name;
  const f = vocab.stages.final.name;
  return [
    {
      value: 'points',
      label: 'One continuous series',
      hint: `${capitaliseStage(q)} and ${f} race scores are totalled together for the championship, and discards apply across the whole line.`,
    },
    {
      value: 'net-plus-net',
      label: 'Two series, added together',
      hint: `The ${q} and the ${f} are each scored as their own series, with their own discards; the championship score is the sum of the two.`,
    },
    {
      value: 'rank-seed',
      label: `${capitaliseStage(q)} position carried forward`,
      hint: `A boat carries her ${q} finishing position into the ${f} as one score that can never be discarded; her ${q} race scores drop out.`,
    },
  ];
}

export function SplitFleetEditor({
  seriesId,
  config,
  competitorCount,
  canEdit,
  locked,
  layout = 'stacked',
  onEnabled,
}: {
  seriesId: string;
  /** The stored configuration, or null on a series that isn't split-fleet
   *  yet — then the fields edit a local draft until Enable is pressed. */
  config: SplitFleetConfig | null;
  /** Entries so far, for the "what this means for your event" numbers. */
  competitorCount: number;
  canEdit: boolean;
  /** Racing has started: the structural fields are settled. */
  locked?: boolean;
  /** 'wide' uses the full width of the Split Fleets tab's Format section:
   *  settings on the left, the sailing-instruction translation beside them.
   *  'stacked' is the narrow card/wizard form. */
  layout?: 'stacked' | 'wide';
  onEnabled?: () => void;
}) {
  const save = useSaveSplitFleetConfig(seriesId);
  const [picked, setPicked] = useState<FormatKey>(INITIAL_FORMAT);
  // Which sentences the setting the scorer has reached writes. Hover and
  // focus are held apart so that focus can win: someone tabbing through the
  // fields should see the field they are on, not wherever the pointer came to
  // rest.
  const [hovered, setHovered] = useState<readonly SplitFleetSentenceId[] | null>(null);
  const [focused, setFocused] = useState<readonly SplitFleetSentenceId[] | null>(null);
  // The draft must be the format the picker is showing, or the settings below
  // describe a format nobody chose.
  const [draft, setDraft] = useState<SplitFleetConfig>(() => FORMATS[INITIAL_FORMAT].build(3));

  const value = config ?? draft;
  const isDraft = config === null;
  // Which format this *is*, derived rather than remembered. A scorer who
  // changes a setting and changes it back has the class format again, and
  // being told otherwise leaves them wondering what else they disturbed. It
  // also means a series opened later shows the format it matches instead of
  // whatever the picker happened to default to.
  const matched = (Object.keys(FORMATS) as FormatKey[]).find((k) => matchesFormat(value, k));
  const format = matched ?? picked;
  const customised = matched === undefined;
  const vocab = resolveVocabulary(value);
  const exampleLabels = [
    stageRaceLabel(value, 'qualifying', 1),
    stageRaceLabel(value, 'final', 1, 5),
    ...(value.medal ? [stageRaceLabel(value, 'medal', 1)] : []),
  ].join(', ');

  function patch(p: Partial<SplitFleetConfig>) {
    if (isDraft) setDraft({ ...draft, ...p });
    else save.mutate({ ...value, ...p });
  }

  function pickFormat(next: FormatKey) {
    setPicked(next);
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

  function setThreshold(index: number, field: 'minRaces' | 'discardCount', n: number) {
    patch({
      discardThresholds: value.discardThresholds.map((t, i) =>
        i === index ? { ...t, [field]: Math.max(1, n) } : t,
      ),
    });
  }

  function addThreshold() {
    const last = [...value.discardThresholds].sort((a, b) => a.minRaces - b.minRaces).at(-1);
    patch({
      discardThresholds: [
        ...value.discardThresholds,
        { minRaces: (last?.minRaces ?? 3) + 1, discardCount: (last?.discardCount ?? 0) + 1 },
      ],
    });
  }

  function removeThreshold(index: number) {
    patch({ discardThresholds: value.discardThresholds.filter((_, i) => i !== index) });
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
  const marked = focused ?? hovered;

  /**
   * A settings row that marks the sentences it writes while the scorer is on
   * it. Rows are the unit rather than individual controls: a row is one
   * heading's worth of settings, and its sentences are that heading's.
   *
   * A row for settings the prose doesn't state — finish sheets, the
   * reassignment tie order, and the two pickers that rewrite everything —
   * takes plain `rowClass` instead, and marks nothing.
   */
  function row(...settings: (keyof typeof SENTENCES_BY_SETTING)[]) {
    const ids = settings.flatMap((k) => SENTENCES_BY_SETTING[k] as SplitFleetSentenceId[]);
    return {
      className: rowClass,
      onMouseEnter: () => setHovered(ids),
      onMouseLeave: () => setHovered(null),
      // React's onFocus and onBlur are focusin and focusout, so the controls
      // inside the row report through it without wiring each one.
      onFocus: () => setFocused(ids),
      onBlur: () => setFocused(null),
    };
  }
  const selectClass = 'w-full max-w-full rounded-md border bg-background px-2 py-1 text-sm';
  const hint = 'text-xs text-muted-foreground';

  const wide = layout === 'wide';
  const fields = (
    <div className="space-y-4">
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
        <label className="font-medium" htmlFor="sf-vocabulary">
          What the sailing instructions call the stages
        </label>
        <div className="space-y-1">
          <select
            id="sf-vocabulary"
            className={selectClass}
            disabled={!canEdit}
            value={value.vocabulary}
            onChange={(e) => patch({ vocabulary: e.target.value as VocabularyKey })}
          >
            {VOCABULARY_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
          <p className={hint}>
            {VOCABULARY_OPTIONS.find((o) => o.key === value.vocabulary)?.terms}. Both sets of
            words are in use and each borrows the other&rsquo;s for a different stage, so this
            is one choice rather than a name per stage. Set it first: every setting below is
            worded in it, as are the standings and the published pages. Races here read{' '}
            {exampleLabels}.
          </p>
        </div>
      </div>

      <div {...row('fleetCount')}>
        <label className="font-medium" htmlFor="sf-fleet-count">
          {capitaliseStage(vocab.stages.qualifying.fleetNoun)}s
        </label>
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

      <div className={rowClass}>
        <label className="font-medium" htmlFor="sf-finish-sheets">
          Finish sheets
        </label>
        <div className="space-y-1">
          {locked ? (
            <p>
              {value.finishSheets === 'per-fleet'
                ? `One per ${vocab.stages.qualifying.fleetNoun}`
                : 'One per race, all fleets on it'}
            </p>
          ) : (
            <select
              id="sf-finish-sheets"
              className={selectClass}
              disabled={!canEdit}
              value={value.finishSheets}
              onChange={(e) =>
                patch({
                  finishSheets: e.target.value as SplitFleetConfig['finishSheets'],
                })
              }
            >
              <option value="combined">One per race, all fleets on it</option>
              <option value="per-fleet">One per {vocab.stages.qualifying.fleetNoun}</option>
            </select>
          )}
          <p className={hint}>
            The fleets start in sequence and cross one line, so a race committee writing
            by hand keeps one sheet with the fleets interleaved. Choose one sheet per{' '}
            {vocab.stages.qualifying.fleetNoun} when each fleet&rsquo;s finishes come back
            separately, as electronic timing records them. It changes how the races are
            laid out, not how they score: a boat is ranked among her own fleet either way.
          </p>
        </div>
      </div>

      {/* Not a fieldset/legend: a legend is rendered as the fieldset's caption,
          outside the grid flow, which would drop the options into the narrow
          label column. The shared radio `name` still groups them natively. */}
      <div {...row('carry')} role="radiogroup" aria-labelledby="sf-carry-label">
        <span className="font-medium" id="sf-carry-label">
          How scores carry into the {vocab.stages.final.name}
        </span>
        <div className="space-y-2">
          {carryOptions(vocab).map((opt) => (
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
      </div>

      <div {...row('split')}>
        <label className="font-medium" htmlFor="sf-split">
          How boats are divided for the {vocab.stages.final.name}
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

      <div {...row('discards', 'finalDiscardCap')}>
        <span className="font-medium">Discards</span>
        <div className="space-y-2">
          {value.discardThresholds.length === 0 ? (
            <p>No scores are excluded.</p>
          ) : (
            <div className="space-y-1.5">
              {value.discardThresholds.map((t, i) => (
                <div key={i} className="flex flex-wrap items-center gap-1.5">
                  <span>Exclude</span>
                  <input
                    type="number"
                    aria-label="Scores excluded"
                    min={1}
                    className="w-14 rounded-md border bg-background px-2 py-1 text-sm"
                    disabled={!canEdit}
                    value={t.discardCount}
                    onChange={(e) => setThreshold(i, 'discardCount', Number(e.target.value))}
                  />
                  <span>score{t.discardCount === 1 ? '' : 's'} from</span>
                  <input
                    type="number"
                    aria-label="Races completed"
                    min={1}
                    className="w-14 rounded-md border bg-background px-2 py-1 text-sm"
                    disabled={!canEdit}
                    value={t.minRaces}
                    onChange={(e) => setThreshold(i, 'minRaces', Number(e.target.value))}
                  />
                  <span>races</span>
                  {canEdit && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-muted-foreground"
                      aria-label="Remove discard rule"
                      onClick={() => removeThreshold(i)}
                    >
                      ×
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
          {canEdit && (
            <Button type="button" variant="outline" size="sm" onClick={addThreshold}>
              Add a rule
            </Button>
          )}
          {value.carry === 'points' && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
              <label className="flex items-center gap-1.5">
                At most
                <input
                  type="number"
                  aria-label={`Discards allowed from the ${vocab.stages.final.name}`}
                  min={0}
                  className="w-14 rounded-md border bg-background px-2 py-1 text-sm"
                  disabled={!canEdit}
                  value={value.maxFinalDiscards}
                  onChange={(e) =>
                    patch({ maxFinalDiscards: Math.max(0, Number(e.target.value)) })
                  }
                />
                from the {vocab.stages.final.name}
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={value.protectLoneFinalRace}
                  onChange={(e) => patch({ protectLoneFinalRace: e.target.checked })}
                />
                never exclude a lone {vocab.stages.final.raceNoun}
              </label>
            </div>
          )}
          <p className={hint}>
            {value.carry === 'net-plus-net'
              ? `Applied separately to the ${vocab.stages.qualifying.name} and the ${vocab.stages.final.name}.`
              : value.carry === 'rank-seed'
                ? `Applied to the ${vocab.stages.final.name}; the carried ${vocab.stages.qualifying.name} position is never excluded.`
                : 'Applied across the whole line.'}{' '}
            {capitaliseStage(vocab.stages.medal.name)} never count toward these rules and are
            never excluded.
          </p>
        </div>
      </div>

      <div {...row('equalization')}>
        <label className="font-medium" htmlFor="sf-equalization">
          Boats end the {vocab.stages.qualifying.name} on different race counts
        </label>
        <div className="space-y-1">
          <select
            id="sf-equalization"
            className={selectClass}
            disabled={!canEdit}
            value={value.equalization}
            onChange={(e) =>
              patch({
                equalization: e.target.value as SplitFleetConfig['equalization'],
              })
            }
          >
            <option value="abandon-extra-races">
              Abandon and cancel the extra races
            </option>
            <option value="exclude-extra-scores">
              Abandon them, and also drop any boat’s leftover extra scores
            </option>
          </select>
          <p className={hint}>
            Either way, a {vocab.stages.qualifying.raceNoun} counts for nobody until every
            fleet has sailed it — so a race one fleet sailed and another didn’t is struck for
            everyone, and the fleets come out level. That is the whole of the first option, and
            what most sailing instructions say. The second adds the clause a few carry for what
            might still be left over: a boat holding more scores than the rest drops her most
            recent until the counts match. It only comes into play if boats within a fleet end
            up with different counts, so choose the first unless your sailing instructions
            clearly say otherwise.
          </p>
        </div>
      </div>

      <div {...row('codeBasis')}>
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
                {capitaliseStage(vocab.stages.qualifying.name)}: boats in the largest{' '}
                {vocab.stages.qualifying.fleetNoun}, plus one
              </option>
              <option value="fixed">
                {capitaliseStage(vocab.stages.qualifying.name)}: a fixed number of points
              </option>
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
            <option value="own-fleet">
              {capitaliseStage(vocab.stages.final.name)}: boats in her own{' '}
              {vocab.stages.final.fleetNoun}, plus one
            </option>
            <option value="largest-qualifying">
              {capitaliseStage(vocab.stages.final.name)}: boats in the largest{' '}
              {vocab.stages.qualifying.fleetNoun}, plus one — the same score all championship
            </option>
          </select>
          {entries > 0 && (
            <p className={hint}>
              With {entries} entries that is{' '}
              {value.codeBasis.qualifying === 'fixed'
                ? (value.codeBasis.fixedPoints ?? largestQualifying + 1)
                : largestQualifying + 1}{' '}
              in the {vocab.stages.qualifying.name} and{' '}
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

      <div {...row('medal', 'medalCarryTransform', 'medalTieBreak')}>
        <span className="font-medium">{capitaliseStage(vocab.stages.medal.name)}</span>
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={!!value.medal}
                onChange={(e) =>
                  patch({
                    medal: e.target.checked
                      ? { size: 10, raceCount: 1, multiplier: 2, companionRace: 'scored-below' as const }
                      : undefined,
                  })
                }
              />
              Sailed by the top
            </label>
            {value.medal && (
              <>
                <input
                  type="number"
                  aria-label={`${capitaliseStage(vocab.stages.medal.fleetNoun)} size`}
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
                  aria-label={`${capitaliseStage(vocab.stages.medal.name)} points multiplier`}
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
            <>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    checked={!!value.medal.carryTransform}
                    onChange={(e) =>
                      patch({
                        medal: {
                          ...value.medal!,
                          carryTransform: e.target.checked
                            ? { kind: 'divide', by: 2, rounding: 'half-up' }
                            : undefined,
                        },
                      })
                    }
                  />
                  First divide the score so far by
                </label>
                {value.medal.carryTransform && (
                  <>
                    <input
                      type="number"
                      aria-label="Carried score divisor"
                      min={1}
                      step="0.25"
                      className="w-20 rounded-md border bg-background px-2 py-1 text-sm"
                      disabled={!canEdit}
                      value={value.medal.carryTransform.by}
                      onChange={(e) =>
                        patch({
                          medal: {
                            ...value.medal!,
                            carryTransform: {
                              ...value.medal!.carryTransform!,
                              by: Math.max(1, Number(e.target.value)),
                            },
                          },
                        })
                      }
                    />
                    <select
                      aria-label="Carried score rounding"
                      className="rounded-md border bg-background px-2 py-1 text-sm"
                      disabled={!canEdit}
                      value={value.medal.carryTransform.rounding}
                      onChange={(e) =>
                        patch({
                          medal: {
                            ...value.medal!,
                            carryTransform: {
                              ...value.medal!.carryTransform!,
                              rounding: e.target.value as 'half-up' | 'truncate',
                            },
                          },
                        })
                      }
                    >
                      <option value="half-up">rounding 0.5 up</option>
                      <option value="truncate">dropping the fraction</option>
                    </select>
                  </>
                )}
              </div>
              <label className="flex flex-wrap items-center gap-1.5">
                Ties between these boats
                <select
                  className="rounded-md border bg-background px-2 py-1 text-sm"
                  aria-label="How ties between the top boats are broken"
                  disabled={!canEdit}
                  value={value.medal.tieBreak ?? 'a8'}
                  onChange={(e) =>
                    patch({
                      medal: {
                        ...value.medal!,
                        tieBreak:
                          e.target.value === 'a8'
                            ? undefined
                            : (e.target.value as 'stage-rank' | 'last-race'),
                      },
                    })
                  }
                >
                  <option value="a8">break under rule A8 alone</option>
                  <option value="stage-rank">
                    fall to {vocab.stages.final.name} rank, then{' '}
                    {vocab.stages.qualifying.name} rank
                  </option>
                  <option value="last-race">break on the last race, in place of rule A8</option>
                </select>
              </label>
              <p className={hint}>
                Never discarded. Everyone else stays in their fleet and sails its remaining races
                {value.medal.companionRace === 'scored-below'
                  ? `, the first finisher of the last one scoring ${value.medal.size + 1}`
                  : ''}
                .
                {value.medal.carryTransform
                  ? ` Dividing the score so far pulls the leaders together before the last races, so a qualified boat’s championship score is that one carried number plus her ${vocab.stages.medal.name}.`
                  : ''}
              </p>
            </>
          )}
        </div>
      </div>

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

  // Wide: the settings and their sailing-instruction translation side by
  // side, so the scorer reads one against the other without scrolling.
  if (wide) {
    return (
      <div className="grid gap-6 text-sm lg:grid-cols-2" data-testid="split-fleets-editor">
        {fields}
        <SiTranslation config={value} marked={marked} alwaysOpen />
      </div>
    );
  }
  return (
    <div className="space-y-4 text-sm" data-testid="split-fleets-editor">
      {fields}
      <SiTranslation config={value} marked={marked} />
    </div>
  );
}

/** The configuration restated as sailing-instruction prose, for checking
 *  against the document the scorer was handed. */
function SiTranslation({
  config,
  marked,
  alwaysOpen = false,
}: {
  config: SplitFleetConfig;
  /** Sentences written by the setting the scorer is on, if any. Marking is
   *  only ever an answer to a question the panel is already open for, so a
   *  collapsed panel is left collapsed rather than opened underneath them. */
  marked?: readonly SplitFleetSentenceId[] | null;
  alwaysOpen?: boolean;
}) {
  const [userOpen, setUserOpen] = useState(false);
  const open = alwaysOpen || userOpen;
  const lines = describeSplitFleetConfig(config);
  return (
    <div className="rounded-md border bg-muted/30 p-3" data-testid="sf-si-translation">
      {alwaysOpen ? (
        <p className="font-medium">How this configuration translates to sailing instructions</p>
      ) : (
        <button
          type="button"
          className="flex w-full items-center justify-between text-left font-medium"
          onClick={() => setUserOpen((o) => !o)}
          aria-expanded={open}
        >
          How this configuration translates to sailing instructions
          <span className="text-muted-foreground">{open ? '▾' : '▸'}</span>
        </button>
      )}
      {open && (
        <>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted-foreground">
            {lines.map((line) => {
              const isMarked = !!marked?.includes(line.id);
              return (
                <li
                  key={line.id}
                  data-sentence={line.id}
                  data-marked={isMarked || undefined}
                  // A ring as well as a wash, so the mark isn't hue alone —
                  // and neither shifts the sentence a pixel, which matters
                  // when the scorer is reading down the list.
                  className={
                    isMarked
                      ? '-mx-1 rounded-sm bg-primary/10 px-1 text-foreground ring-1 ring-primary/40'
                      : undefined
                  }
                >
                  {line.text}
                </li>
              );
            })}
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
