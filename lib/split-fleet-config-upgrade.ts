// Bring a split-fleet configuration written before series-file v58 and
// public-export v4 up to the current shape, under ADR-013.
//
// Those versions removed settings no scored championship used, and made
// several others fixed behaviour. A stored configuration can still carry any
// of them — in a `.sailscoring` file, a revision snapshot, a Trash tombstone
// or a published data file — so every entry point that reads one of those
// passes it through here. Each removed value is one of:
//
//   lossless        the value we kept as fixed behaviour: dropped
//   presentational  labels, wording, layout, planning hints: upgraded to the
//                   current behaviour, even where it differs
//   scoring         would score the championship differently: the whole
//                   configuration is refused, with the setting named
//
// and a scoring value is accepted where the data it arrives with shows it
// cannot change a result — a championship with no races yet, or a medal
// setting on one whose medal fleet was never selected. Nothing is ever
// quietly rescored.

import type { SplitFleetConfig } from './split-fleets';

/** What the data beside a configuration shows, which decides whether a
 *  scoring-class value can change a result. */
export interface SplitFleetUpgradeContext {
  /** Any race of the championship has been created. */
  hasRaces: boolean;
  /** The medal fleet has been selected. */
  medalFleetSelected: boolean;
  /** A medal race has a finish recorded. */
  medalRaceSailed: boolean;
}

export type SplitFleetUpgradeResult =
  | { ok: true; config: SplitFleetConfig }
  | { ok: false; reasons: string[] };

type Raw = Record<string, unknown>;

const obj = (v: unknown): Raw | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : undefined;

/** The context of a configuration arriving in a `.sailscoring` file or a
 *  public export: both carry their races with starts and finishes, and their
 *  rounds with a stage. Older files hold the stage on the race itself. */
export function splitFleetUpgradeContext(input: {
  races?: unknown;
  rounds?: unknown;
}): SplitFleetUpgradeContext {
  const races = Array.isArray(input.races) ? input.races.map(obj).filter((r) => r) : [];
  const stageOf = (race: Raw): string[] => [
    ...(typeof race.stage === 'string' ? [race.stage] : []),
    ...(Array.isArray(race.starts)
      ? race.starts.map((s) => obj(s)?.stage).filter((s): s is string => typeof s === 'string')
      : []),
  ];
  const staged = races.filter((r) => stageOf(r!).length > 0);
  const rounds = Array.isArray(input.rounds) ? input.rounds.map(obj) : [];
  return {
    hasRaces: staged.length > 0,
    medalFleetSelected: rounds.some((r) => r?.stage === 'medal'),
    medalRaceSailed: staged.some(
      (r) => stageOf(r!).includes('medal') && Array.isArray(r!.finishes) && r!.finishes.length > 0,
    ),
  };
}

/** Bring one stored configuration up to the current shape, or refuse it. */
export function upgradeSplitFleetConfig(
  raw: unknown,
  context: SplitFleetUpgradeContext,
): SplitFleetUpgradeResult {
  const c = obj(raw);
  if (!c) return { ok: false, reasons: ['the split-fleet configuration is unreadable'] };
  const reasons: string[] = [];
  // A value that would score differently counts only where there is a result
  // for it to change.
  const refuse = (material: boolean, setting: string, value: unknown) => {
    if (material) reasons.push(`${setting} (${JSON.stringify(value)})`);
  };
  const racing = context.hasRaces;
  const medalScored = context.medalFleetSelected;

  const split = obj(c.split);
  const divided = split?.kind !== 'none';
  if (c.carry !== undefined && c.carry !== 'points') refuse(racing, 'how scores carry', c.carry);
  if (split?.kind === 'fixed-top') refuse(racing, 'a fixed top-fleet size', split.topSize);

  const codeBasis = obj(c.codeBasis);
  if (codeBasis?.qualifying !== undefined && codeBasis.qualifying !== 'largest-fleet') {
    refuse(racing, 'the non-finisher score', codeBasis.qualifying);
  }
  if (divided && codeBasis?.final !== undefined && codeBasis.final !== 'own-fleet') {
    refuse(racing, 'the final-series non-finisher score', codeBasis.final);
  }
  if (c.equalization !== undefined && c.equalization !== 'abandon-extra-races') {
    refuse(racing, 'equalising scores at the end of qualifying', c.equalization);
  }
  if (divided && c.maxFinalDiscards !== undefined && c.maxFinalDiscards !== 1) {
    refuse(racing, 'the cap on final-series discards', c.maxFinalDiscards);
  }
  if (divided && c.protectLoneFinalRace !== undefined && c.protectLoneFinalRace !== true) {
    refuse(racing, 'protecting a lone final-series race', c.protectLoneFinalRace);
  }
  // `reassignmentTieOrder` orders ties in an assignment the scorer has yet to
  // make: the rounds already committed are frozen, so no result moves.

  const medal = obj(c.medal);
  if (!medal && medalScored) refuse(true, 'no deciding stage', null);
  const multiplier = medal?.multiplier ?? 2;
  if (multiplier !== 1 && multiplier !== 2) refuse(racing, 'the medal race multiplier', multiplier);
  const tieBreak = medal?.tieBreak;
  if (tieBreak !== 'last-race' && tieBreak !== 'medal-race-then-a8') {
    refuse(medalScored, 'the medal tie-break', tieBreak ?? 'rule A8 alone');
  }
  // The companion race's scoring is written onto its start when the race is
  // created, so `scored-below` and `none` change no race that exists. `dnc`
  // is applied when the medal race is scored.
  if (medal?.companionRace === 'dnc') refuse(medalScored, 'scoring DNC in the medal race', 'dnc');
  const transform = obj(medal?.carryTransform);
  if (transform) {
    if (transform.kind !== 'divide' || transform.by !== 2 || transform.rounding !== 'half-up') {
      refuse(medalScored, 'the carried score', {
        by: transform.by,
        rounding: transform.rounding,
      });
    }
    // Only a medal fleet selected with no medal race yet sailed tells the two
    // timings apart.
    if ((transform.appliesFrom ?? 'medal-fleet-selected') !== 'first-medal-race') {
      refuse(
        medalScored && !context.medalRaceSailed,
        'halving the score before a medal race is sailed',
        transform.appliesFrom ?? 'medal-fleet-selected',
      );
    }
  }

  if (reasons.length > 0) return { ok: false, reasons };

  const fleets = (v: unknown) => (Array.isArray(v) ? (v as SplitFleetConfig['qualifyingFleets']) : []);
  const stageNaming = obj(c.stageNaming);
  const vocabulary: SplitFleetConfig['vocabulary'] =
    c.vocabulary === 'qualification-final' || c.vocabulary === 'opening-medal'
      ? c.vocabulary
      : stageNaming?.continuousOpeningNumbers === true
        ? 'qualification-final'
        : 'opening-medal';
  return {
    ok: true,
    config: {
      qualifyingFleets: fleets(c.qualifyingFleets),
      finalFleets: divided ? fleets(c.finalFleets) : [],
      split: divided ? { kind: 'equal-blocks' } : { kind: 'none' },
      discardThresholds: Array.isArray(c.discardThresholds)
        ? (c.discardThresholds as SplitFleetConfig['discardThresholds'])
        : [],
      vocabulary,
      medal: {
        size: typeof medal?.size === 'number' ? medal.size : 10,
        multiplier: multiplier === 1 ? 1 : 2,
        ...(transform ? { carryTransform: { kind: 'divide', by: 2, rounding: 'half-up' } } : {}),
        tieBreak: tieBreak === 'last-race' ? 'last-race' : 'medal-race-then-a8',
      },
    },
  };
}

/** The message a refused configuration is reported with. */
export function refusedSplitFleetConfigMessage(reasons: string[]): string {
  return (
    `This championship is scored with split-fleet settings this version of Sail Scoring no ` +
    `longer supports: ${reasons.join('; ')}. Open it in an earlier release, or write to ` +
    `mark@hyc.ie to ask for the setting back.`
  );
}

const OLD_PREFIXES: Record<SplitFleetConfig['vocabulary'], Record<string, string>> = {
  'opening-medal': { qualifying: 'Q', final: 'F', medal: 'M' },
  'qualification-final': { qualifying: 'Q', final: 'Q', medal: 'F' },
};

const NEW_PREFIXES: Record<SplitFleetConfig['vocabulary'], Record<string, string>> = {
  'opening-medal': { qualifying: 'Q', final: 'F', medal: 'M' },
  'qualification-final': { qualifying: 'QP', final: 'QE', medal: 'F' },
};

/**
 * Rename the races a file or export carries from the labels its old
 * configuration wrote to the ones its upgraded configuration writes.
 *
 * A race's name is written when it is created, so a championship whose
 * labels change on upgrade — the 2026 ILCA wording numbered Q1–Q12 straight
 * through, and now writes QP and QE — would otherwise show the new labels in
 * its standings above a races list still carrying the old. Only a whole label
 * is replaced ("Q6" in "Q6 · Gold", never inside "Q61"), so a name the scorer
 * typed themselves is left alone. Mutates the races in place.
 */
export function upgradeSplitFleetRaceNames(
  races: unknown,
  rawConfig: unknown,
  config: SplitFleetConfig,
): void {
  if (!Array.isArray(races)) return;
  const c = obj(rawConfig) ?? {};
  const labels = obj(c.raceLabels);
  const oldPrefixes = { ...OLD_PREFIXES[config.vocabulary], ...obj(labels?.prefixes) } as Record<
    string,
    string
  >;
  const continuous =
    typeof labels?.continuousOpeningNumbers === 'boolean'
      ? labels.continuousOpeningNumbers
      : config.vocabulary === 'qualification-final';
  const newPrefixes: Record<string, string> = {
    ...NEW_PREFIXES[config.vocabulary],
    ...(config.split.kind === 'none' ? { qualifying: 'Q' } : {}),
  };
  const starts = races.flatMap((race) => {
    const r = obj(race);
    if (!r) return [];
    const own = Array.isArray(r.starts) ? r.starts.map(obj) : [];
    return own.map((s) => ({
      race: r,
      stage: (s?.stage ?? r.stage) as string | undefined,
      n: (s?.stageRaceNumber ?? r.stageRaceNumber) as number | undefined,
    }));
  });
  const qualifyingRaces = Math.max(
    0,
    ...starts.filter((s) => s.stage === 'qualifying' && typeof s.n === 'number').map((s) => s.n!),
  );
  for (const { race, stage, n } of starts) {
    if (!stage || typeof n !== 'number' || typeof race.name !== 'string') continue;
    const before =
      stage === 'final' && continuous
        ? `${oldPrefixes.qualifying}${qualifyingRaces + n}`
        : `${oldPrefixes[stage]}${n}`;
    const after = `${newPrefixes[stage]}${n}`;
    if (before === after) continue;
    race.name = race.name.replace(new RegExp(`(^|[^A-Za-z0-9])${before}(?![0-9])`), `$1${after}`);
  }
}
