'use client';

// The one split-fleet configuration surface: the Format section of the Split
// Fleets tab. A series is a split-fleet championship from the moment it is
// created (the setup wizard asks), so there is nothing to enable here — every
// change saves as it is made.
//
// Two things shape the design. First, scorers configure this once every year
// or two, from an SI or NoR someone else wrote — so every field says what it
// does in words, shows what it means for the boats actually entered, and the
// whole configuration is restated as sailing-instruction prose to check
// against that document — and reaching a setting, by pointer or by keyboard,
// marks the sentences that setting writes, so which clause a checkbox governs
// doesn't have to be discovered by flipping it.

import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useSaveSplitFleetConfig } from '@/hooks/use-split-fleets';
import { SiTranslation } from '@/components/split-fleet-si';
import { SENTENCES_BY_SETTING } from '@/lib/split-fleets-si';
import type { SplitFleetSentenceId } from '@/lib/split-fleets-si';
import {
  QUALIFYING_COLOR_SETS,
  FINAL_FLEET_SET,
  finalBlockSizes,
  UNBANDED_FLEET,
  capitaliseStage,
  resolveRaceLabels,
  resolveVocabulary,
  VOCABULARY_OPTIONS,
  applyRaceLabelScheme,
  RACE_LABEL_SCHEMES,
  raceLabelSchemeKey,
  stageRaceLabel,
  STAGES,
  type CarryTransform,
  type RaceLabelSchemeKey,
  type SplitFleetConfig,
  type Vocabulary,
  type VocabularyKey,
} from '@/lib/split-fleets';

export function SplitFleetEditor({
  seriesId,
  config,
  competitorCount,
  canEdit,
  locked,
}: {
  seriesId: string;
  config: SplitFleetConfig;
  /** Entries so far, for the "what this means for your event" numbers. */
  competitorCount: number;
  canEdit: boolean;
  /** Racing has started: the structural fields are settled. */
  locked?: boolean;
}) {
  const save = useSaveSplitFleetConfig(seriesId);
  // Which sentences the setting the scorer has reached writes. Hover and
  // focus are held apart so that focus can win: someone tabbing through the
  // fields should see the field they are on, not wherever the pointer came to
  // rest.
  const [hovered, setHovered] = useState<readonly SplitFleetSentenceId[] | null>(null);
  // Asked for a scheme of their own: the prefixes are shown to be typed. A
  // series already carrying one shows them without asking.
  const [labelsByHand, setLabelsByHand] = useState(false);
  const [focused, setFocused] = useState<readonly SplitFleetSentenceId[] | null>(null);

  const value = config;
  // A championship that never bands its fleet has no second stage, so the
  // settings that describe one describe nothing. Hidden rather than disabled:
  // a greyed-out "how boats are divided" invites the scorer to wonder which
  // answer is in force, and none is.
  const unbanded = config.split.kind === 'none';
  const vocab = resolveVocabulary(value);
  // A worked example rather than a description: five races, then the first
  // race of each stage after them. That is where the difference shows — a
  // scheme numbering on writes Q6 where one restarting writes F1 or QE1.
  const labelsFor = (config: SplitFleetConfig) => {
    const rest = [
      stageRaceLabel(config, 'final', 1, 5),
      ...(config.medal ? [stageRaceLabel(config, 'medal', 1)] : []),
    ];
    return `${stageRaceLabel(config, 'qualifying', 1)} … ${stageRaceLabel(config, 'qualifying', 5)}, then ${rest.join(', then ')}`;
  };
  const exampleLabels = labelsFor(value);
  // Which tabulated scheme this is, derived like the format above it, so a
  // scorer who types a prefix back to a tabulated one has that scheme again.
  const labelScheme = raceLabelSchemeKey(value);
  const raceLabels = resolveRaceLabels(value);

  function patch(p: Partial<SplitFleetConfig>) {
    save.mutate({ ...value, ...p });
  }

  function setFleetCount(n: number) {
    // One fleet is the unbanded championship: nothing to band into, and no
    // second stage to band at. Going back up restores the split rule, since
    // the sizing answer it needs was never meaningful while there was one.
    if (n === 1) {
      patch({
        qualifyingFleets: [UNBANDED_FLEET],
        finalFleets: [],
        split: { kind: 'none' },
      });
      return;
    }
    patch({
      qualifyingFleets: QUALIFYING_COLOR_SETS.slice(0, n),
      finalFleets: FINAL_FLEET_SET.slice(0, n),
      ...(value.split.kind === 'none' ? { split: { kind: 'equal-blocks' as const } } : {}),
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
  const finalSizes = entries > 0 ? finalBlockSizes(entries, value.finalFleets.length) : [];

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

  const fields = (
    <div className="space-y-4">
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
            worded in it, as are the standings and the published pages.
          </p>
        </div>
      </div>

      <div {...row('raceLabels')}>
        <label className="font-medium" htmlFor="sf-race-labels">
          What the notice board calls the races
        </label>
        <div className="space-y-1">
          <select
            id="sf-race-labels"
            className={selectClass}
            disabled={!canEdit}
            value={labelsByHand ? 'custom' : (labelScheme ?? 'custom')}
            onChange={(e) => {
              if (e.target.value === 'custom') return setLabelsByHand(true);
              setLabelsByHand(false);
              patch({
                raceLabels: applyRaceLabelScheme(value, e.target.value as RaceLabelSchemeKey),
              });
            }}
          >
            {RACE_LABEL_SCHEMES.map((scheme) => (
              <option key={scheme.key} value={scheme.key}>
                {labelsFor({ ...value, raceLabels: applyRaceLabelScheme(value, scheme.key) })}
              </option>
            ))}
            <option value="custom">{labelScheme ? 'Something else…' : exampleLabels}</option>
          </select>
          {(labelScheme === null || labelsByHand) && (
            <div className="flex flex-wrap items-center gap-2">
              {STAGES.filter((stage) => stage !== 'medal' || value.medal).map((stage) => (
                <label key={stage} className="flex items-center gap-1 text-xs">
                  {capitaliseStage(vocab.stages[stage].name)}
                  <input
                    className="w-14 rounded-md border bg-background px-2 py-1 text-sm"
                    disabled={!canEdit}
                    value={raceLabels.prefixes[stage]}
                    maxLength={3}
                    aria-label={`${capitaliseStage(vocab.stages[stage].name)} race prefix`}
                    onChange={(e) => {
                      const next = {
                        ...raceLabels,
                        prefixes: {
                          ...raceLabels.prefixes,
                          [stage]: e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase(),
                        },
                      };
                      // A prefix shared by the first two stages labels two
                      // races the same unless the numbering runs on, and is
                      // refused on the way in. Hold the last good value
                      // rather than save a rejected one; the hint below says
                      // why the field is not taking the letter.
                      if (
                        next.prefixes.qualifying &&
                        next.prefixes.final &&
                        (next.continuousOpeningNumbers ||
                          next.prefixes.qualifying !== next.prefixes.final)
                      ) {
                        patch({ raceLabels: next });
                      }
                    }}
                  />
                </label>
              ))}
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={raceLabels.continuousOpeningNumbers}
                  onChange={(e) =>
                    patch({
                      raceLabels: { ...raceLabels, continuousOpeningNumbers: e.target.checked },
                    })
                  }
                />
                numbered on from the {vocab.stages.qualifying.name}
              </label>
              <span className="text-xs text-muted-foreground">
                One to three letters each, and the first two differ unless the numbering runs
                on.
              </span>
            </div>
          )}
          <p className={hint}>
            Races here read {exampleLabels}. Sailing instructions and notice boards disagree
            about this even within one class, and the label is what a competitor writes on a
            scoring enquiry &mdash; so it is set here rather than following the words above.
            The standings columns, the races list and the published pages all use it.
          </p>
        </div>
      </div>

      <div {...row('fleetCount')}>
        <label className="font-medium" htmlFor="sf-fleet-count">
          {capitaliseStage(vocab.stages.qualifying.fleetNoun)}
          {unbanded ? '' : 's'}
        </label>
        <div className="space-y-1">
          {locked ? (
            // Frozen once boats have raced — changing the count now would
            // re-deal fleets that have already sailed. The count still has to
            // be *readable*, and on an unbanded championship it is the one
            // setting that decides the shape of the event: without it said
            // here, nothing on the screen tells the scorer their fleet is
            // never split.
            <p>
              {value.qualifyingFleets.map((f) => f.label).join(', ')}
              {unbanded ? ' — one fleet, never split' : ''}
            </p>
          ) : (
            <select
              id="sf-fleet-count"
              className={selectClass}
              disabled={!canEdit}
              value={fleetCount}
              onChange={(e) => setFleetCount(Number(e.target.value))}
            >
              <option value={1}>1 — one fleet, never split</option>
              {[2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n} — {QUALIFYING_COLOR_SETS.slice(0, n).map((f) => f.label).join(', ')}
                </option>
              ))}
            </select>
          )}
          {/* With one fleet there is nothing to divide the entry into and
              nothing to reassign between, so neither the band sizes nor the
              daily reassignment has anything to say. */}
          <p className={hint}>
            {unbanded
              ? `Every boat sails every race in one fleet${
                  entries > 0 ? `, all ${entries} of them` : ''
                }. There is no split and no reassignment.`
              : entries > 0
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

      {!unbanded && (
      <div {...row('fleetCount')}>
        <span className="font-medium">
          How boats are divided for the {vocab.stages.final.name}
        </span>
        <p className={hint}>
          {entries > 0
            ? `${entries} entries → ${value.finalFleets
                .map((f, i) => `${f.label} ${finalSizes[i] ?? 0}`)
                .join(', ')}, by rank.`
            : `The ${vocab.stages.qualifying.name} ranking is divided into ${value.finalFleets.map((f) => f.label).join(', ')}, as nearly as possible equal, the top fleet largest.`}
        </p>
      </div>
      )}

      <div {...row('discards')}>
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
          <p className={hint}>
            Applied across the whole line
            {unbanded
              ? '.'
              : `, with at most one from the ${vocab.stages.final.name}, and never a lone ${vocab.stages.final.raceNoun}.`}{' '}
            {capitaliseStage(vocab.stages.medal.name)} never count toward these rules and are
            never excluded.
          </p>
        </div>
      </div>

      <div {...row('medal', 'medalCarryTransform', 'medalTieBreak')}>
        <span className="font-medium">{capitaliseStage(vocab.stages.medal.name)}</span>
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span>Sailed by the top</span>
            <input
              type="number"
              aria-label={`${capitaliseStage(vocab.stages.medal.fleetNoun)} size`}
              min={2}
              className="w-16 rounded-md border bg-background px-2 py-1 text-sm"
              disabled={!canEdit}
              value={value.medal.size}
              onChange={(e) =>
                patch({ medal: { ...value.medal, size: Math.max(2, Number(e.target.value)) } })
              }
            />
            <span>boats, at</span>
            <select
              aria-label={`${capitaliseStage(vocab.stages.medal.name)} points`}
              className="rounded-md border bg-background px-2 py-1 text-sm"
              disabled={!canEdit}
              value={value.medal.multiplier}
              onChange={(e) =>
                patch({ medal: { ...value.medal, multiplier: Number(e.target.value) as 1 | 2 } })
              }
            >
              <option value={1}>single points</option>
              <option value={2}>double points</option>
            </select>
          </div>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              disabled={!canEdit}
              checked={!!value.medal.carryTransform}
              onChange={(e) =>
                patch({
                  medal: {
                    ...value.medal,
                    carryTransform: e.target.checked
                      ? { kind: 'divide', by: 2, rounding: 'half-up' }
                      : undefined,
                  },
                })
              }
            />
            First halve the score so far, rounding 0.5 up
          </label>
          <label className="flex flex-wrap items-center gap-1.5">
            Ties between these boats
            <select
              className="rounded-md border bg-background px-2 py-1 text-sm"
              aria-label="How ties between the top boats are broken"
              disabled={!canEdit}
              value={value.medal.tieBreak}
              onChange={(e) =>
                patch({
                  medal: {
                    ...value.medal,
                    tieBreak: e.target.value as SplitFleetConfig['medal']['tieBreak'],
                  },
                })
              }
            >
              <option value="medal-race-then-a8">
                break on the {vocab.stages.medal.raceNoun} first, then under rule A8
              </option>
              <option value="last-race">break on the last race, in place of rule A8</option>
            </select>
          </label>
          <p className={hint}>
            Never discarded.{' '}
            {unbanded
              ? `Everyone else has finished racing and has no score for it. They rank below these boats whatever the points say, so the two groups are scored over different numbers of races and are shown as two tables.`
              : `Everyone else stays in their fleet and sails its remaining races, and in the fleet they left the last one scores from ${value.medal.size + 1}.`}
            {value.medal.carryTransform
              ? ` Halving the score so far pulls the leaders together before the last races, so a qualified boat’s championship score is that one carried number plus her ${vocab.stages.medal.name}. If no ${vocab.stages.medal.raceNoun} is completed, the undivided score stands.`
              : ''}
          </p>
        </div>
      </div>

      {save.isError && <p className="text-destructive">{String(save.error)}</p>}
    </div>
  );

  // The settings and their sailing-instruction translation side by side, so
  // the scorer reads one against the other without scrolling. The settings
  // column is much the taller of the two, so the panel sticks to the top of
  // the window rather than scrolling away with its own column — which is the
  // whole point of marking a setting's sentences as the scorer reaches it.
  return (
    <div className="grid gap-6 text-sm lg:grid-cols-2" data-testid="split-fleets-editor">
      {fields}
      <SiTranslation config={value} marked={marked} alwaysOpen sticky />
    </div>
  );
}
