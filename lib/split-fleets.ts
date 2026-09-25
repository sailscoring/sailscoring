// Split-fleet (qualifying/final series) scoring engine.
// See docs/design/split-fleets.md and docs/design/ux/flows/split-fleets.md.
// Scope: one continuous series over the opening stages, a deciding stage on
// top; RDG average points per RRS A9(a)/(b); SCP/DPI/ZFP penalties; A8.1+A8.2
// tie-breaking; the end-of-qualifying validity gate.

import type { Competitor, Finish, Fleet, Race, RaceStart } from './types';
import { compareSailNumbersIgnoringPrefix } from './sail-number-sort';
import { applyAdditivePenalty, resolveEntrants } from './scoring';
import { weightedRacePoints } from './race-scoring-options';

/**
 * The three stages of a split-fleet championship, as **structural
 * identifiers** — not as words anyone reads.
 *
 * They are stored: on `race_starts.stage`, on `split_rounds.stage`, in the
 * series file and in the public export. So they are fixed, and they are
 * deliberately *not* the vocabulary. What each stage is called depends on the
 * series' `vocabulary` (see `Vocabulary` below), and under the ILCA 2026
 * wording every one of these three names is misleading:
 *
 *   `qualifying`  stage 1 — fleets re-dealt by rank between rounds.
 *                 ILCA 2026 calls it the *Preliminary* series, and reserves
 *                 "Qualification series" for stages 1 and 2 together.
 *   `final`       stage 2 — fleets locked into Gold / Silver / Bronze.
 *                 ILCA 2026 calls it the *Elimination* series.
 *   `medal`       stage 3 — the short deciding stage for the leading boats.
 *                 ILCA 2026 calls it the *Final* series, and sails no medal
 *                 race at all.
 *
 * Never render one of these. Every user-visible word for a stage comes from
 * `resolveVocabulary(config)`, and `tests/split-fleets-vocabulary.test.ts`
 * fails the build if the raw words reappear in the split-fleet surfaces.
 */
export type SeriesStage = 'qualifying' | 'final' | 'medal';

/** The three stages in event order. */
export const STAGES: readonly SeriesStage[] = ['qualifying', 'final', 'medal'];

/** Stored on series.qf_config — the split-fleet series' full scoring
 *  configuration (docs/design/split-fleets.md). */
export interface SplitFleetConfig {
  /** Qualifying fleet labels in SI order (the reassignment-pattern order). */
  qualifyingFleets: { label: string; color: string }[];
  /** Final fleet labels in tier order (Gold first). */
  finalFleets: { label: string; color: string }[];
  /** Whether the opening series is divided. `equal-blocks`: after the first
   *  stage the ranking is divided into the final fleets, near-equal and the
   *  top fleet largest, and the two stages score as one continuous series
   *  (ILCA 2026 SI 18). `none`: the fleet is never divided, and one opening
   *  series leads straight to the deciding stage (the Irish Sailing Junior
   *  Champions' Cup, NoR 8.1). `finalFleets` is empty under `none`.
   *
   *  What follows from each is fixed rather than configured: a non-finisher
   *  scores the largest first-stage fleet plus one, and her own final fleet
   *  plus one in the second stage; a first-stage race counts only once every
   *  fleet of its round has sailed it; and at most one excluded score may come
   *  from the second stage, never from a lone completed race of it. */
  split: { kind: 'equal-blocks' } | { kind: 'none' };
  /** Discard thresholds over the opening series' races combined:
   *  [{minRaces, discardCount}]. Medal races neither count toward these
   *  thresholds nor may be discarded. */
  discardThresholds: { minRaces: number; discardCount: number }[];
  /** Which set of words this championship's sailing instructions use for its
   *  stages and races (see `Vocabulary`). */
  vocabulary: VocabularyKey;
  /** The deciding stage. `size` is also what draws the provisional cut line
   *  before the fleet is selected. `carryTransform` halves the medal boats'
   *  opening-series score before the medal races add to it. The scorer adds
   *  medal races as the sailing instructions say; nothing here counts them. */
  medal: {
    size: number;
    multiplier: 1 | 2;
    carryTransform?: CarryTransform;
    /** How a tie between two medal boats is settled.
     *  - `last-race` replaces RRS A8 outright with its own single comparison —
     *    the boats' scores in the last race, with no count-of-places step
     *    before it and nothing behind it (2026 ILCA SI 18.7.4).
     *  - `medal-race-then-a8` puts the deciding race *ahead* of A8 rather
     *    than after it, and leaves A8 to finish the job: "Ties in the series
     *    score between boats with different Medal Race point scores shall be
     *    broken in favour of the boat with the lower score in the medal race.
     *    This changes RRS Appendix A8" (Irish Sailing Junior Champions' Cup
     *    NoR 15.3). The clause speaks only to boats whose medal scores
     *    differ, so boats level there are not addressed by it and A8 decides
     *    them as written.
     *  A championship that compresses the carry needs one of them: rounding
     *  scores to whole numbers manufactures ties among the very boats
     *  deciding the title. */
    tieBreak: 'last-race' | 'medal-race-then-a8';
  };
}

/** At most this many excluded scores may come from the second stage. */
export const MAX_FINAL_DISCARDS = 1;

/**
 * How the fleets of one stage race finish: onto a single sheet or onto a
 * sheet each.
 *
 * - `combined` — the handwritten case. The fleets start in sequence and cross
 *   one finish line, so the race committee keeps one sheet with the fleets
 *   interleaved: one `Race` per stage race number, one start per fleet.
 * - `per-fleet` — electronic capture, where each fleet's starts and finishes
 *   come back as their own export, as RaceSense writes them. Each fleet gets
 *   its own `Race`, which is what the medal stage always does.
 *
 * Scoring cannot tell the difference: a fleet is ranked among its own members
 * by their relative order, so an interleaved sheet and a sheet per fleet give
 * the same points. What changes is what an abandonment acts on — a race
 * rather than one start within it. It is chosen as each race is added, not
 * for the championship, so one stage can hold both.
 */
export type FinishSheets = 'combined' | 'per-fleet';

/**
 * The layout the championship's races have used so far, which is what a race
 * added without saying takes: the most recent race of a stage with more than
 * one fleet, read off its starts. `combined` before there is any such race.
 */
export function finishSheetsInUse(input: {
  rounds: readonly { stage: SeriesStage; fleetIds: readonly string[] }[];
  races: readonly { id: string; raceNumber: number }[];
  raceStarts: readonly { raceId: string; fleetIds: readonly string[]; stage?: SeriesStage | null }[];
}): FinishSheets {
  const roundSize = new Map<string, number>();
  for (const round of input.rounds) {
    if (round.stage === 'medal') continue;
    for (const fleetId of round.fleetIds) roundSize.set(fleetId, round.fleetIds.length);
  }
  const newestFirst = [...input.races].sort((a, b) => b.raceNumber - a.raceNumber);
  for (const race of newestFirst) {
    const starts = input.raceStarts.filter(
      (s) => s.raceId === race.id && s.stage && s.stage !== 'medal',
    );
    if (starts.length === 0) continue;
    if ((roundSize.get(starts[0].fleetIds[0] ?? '') ?? 0) < 2) continue;
    return starts.length > 1 || starts[0].fleetIds.length > 1 ? 'combined' : 'per-fleet';
  }
  return 'combined';
}

/**
 * A complete, coherent set of words for a split-fleet championship.
 *
 * This is one choice, not a bag of labels, because the two vocabularies in
 * circulation reuse each other's words for different things. Both say
 * "qualifying/qualification series" and both say "final series", and they mean
 * different stages by each:
 *
 *   role                          opening-medal        qualification-final
 *   ────────────────────────────  ───────────────────  ────────────────────
 *   stages 1+2 together           opening series       Qualification series
 *   stage 1 (fleets re-dealt)     qualifying series    Preliminary series
 *   stage 2 (fleets locked)       final series         Elimination series
 *   stage 3 (the decider)         medal races          Final series
 *   race labels in its SIs        Q… / F… / M…         Q… running on / F…
 *
 * So mixing them is not a cosmetic slip: "the final series begins when
 * qualifying ends" is true under the first and false under the second, where
 * six races of the Qualification series remain. A series therefore picks one
 * vocabulary and **every** stage word it shows comes from that pick — no term
 * from the other one appears anywhere.
 *
 * Names are stored as they read mid-sentence; `capitaliseStage` makes a
 * heading of one. The generic vocabulary is lowercase because its terms are
 * descriptive; ILCA's is capitalised because its SIs define them as names.
 */
export interface StageWords {
  /** The stage: "qualifying series", "Preliminary series". */
  name: string;
  /** One of its races: "qualifying race", "Preliminary series race". */
  raceNoun: string;
  /** One of its fleets: "qualifying fleet", "Preliminary fleet". */
  fleetNoun: string;
}

export interface Vocabulary {
  /** Stages 1 and 2 together, which both vocabularies name and neither names
   *  after a stage: "opening series", "Qualification series". */
  seriesName: string;
  stages: Record<SeriesStage, StageWords>;
  /** Race-label prefixes ("Q3", "F1"). Fixed per vocabulary, and each stage
   *  numbers its own races from 1: the label is what a competitor writes on a
   *  scoring enquiry, so it is not a setting. */
  prefixes: Record<SeriesStage, string>;
}

export type VocabularyKey = 'opening-medal' | 'qualification-final';

export const VOCABULARIES: Record<VocabularyKey, Vocabulary> = {
  /** Appendix LE's wording, and with it ILCA through 2025, IODA, 420, 470 and
   *  the 29er: an opening series of a qualifying and a final series, with a
   *  medal race on top. */
  'opening-medal': {
    seriesName: 'opening series',
    stages: {
      qualifying: {
        name: 'qualifying series',
        raceNoun: 'qualifying race',
        fleetNoun: 'qualifying fleet',
      },
      final: {
        name: 'final series',
        raceNoun: 'final series race',
        fleetNoun: 'final fleet',
      },
      medal: {
        name: 'medal races',
        raceNoun: 'medal race',
        fleetNoun: 'medal fleet',
      },
    },
    prefixes: { qualifying: 'Q', final: 'F', medal: 'M' },
  },
  /** The 2026 ILCA Worlds wording: a Qualification series divided into a
   *  Preliminary and an Elimination series, then a Final series for the top
   *  ten. Races QP1…, QE1…, then F1–F2, as the 2026 notice boards wrote
   *  them. */
  'qualification-final': {
    seriesName: 'Qualification series',
    stages: {
      qualifying: {
        name: 'Preliminary series',
        raceNoun: 'Preliminary series race',
        fleetNoun: 'Preliminary fleet',
      },
      final: {
        name: 'Elimination series',
        raceNoun: 'Elimination series race',
        fleetNoun: 'Elimination fleet',
      },
      medal: {
        name: 'Final series',
        raceNoun: 'Final series race',
        fleetNoun: 'Final series fleet',
      },
    },
    prefixes: { qualifying: 'QP', final: 'QE', medal: 'F' },
  },
};

/** The picker: one control, and the terms themselves are the description —
 *  a scorer recognises their own sailing instructions in the second line. */
export const VOCABULARY_OPTIONS: { key: VocabularyKey; label: string; terms: string }[] = [
  {
    key: 'opening-medal',
    label: 'Opening series, then medal races',
    terms: 'Races Q1, Q2 …, then M1. Divided: a qualifying series and a final series, races Q and F.',
  },
  {
    key: 'qualification-final',
    label: 'Qualification series, then Final series',
    terms:
      'Races Q1, Q2 …, then F1. Divided: a Preliminary series and an Elimination series, races QP and QE. ILCA from 2026.',
  },
];

export const DEFAULT_VOCABULARY: VocabularyKey = 'opening-medal';

/** A vocabulary key arriving from outside the type system — a query
 *  parameter, a stored preference — or null for anything else. */
export function parseVocabularyKey(value: unknown): VocabularyKey | null {
  return typeof value === 'string' && Object.hasOwn(VOCABULARIES, value)
    ? (value as VocabularyKey)
    : null;
}

/** The words this series uses. */
export function resolveVocabulary(config: SplitFleetConfig): Vocabulary {
  return adaptVocabulary(VOCABULARIES[config.vocabulary ?? DEFAULT_VOCABULARY], config);
}

/**
 * Bend a tabulated vocabulary to the shape of the championship using it.
 *
 * Both tables describe an opening series divided into two stages, because
 * that is what their sailing instructions describe. An event that never
 * divides its fleet has one stage, and calling it the "qualifying series" or
 * the "Preliminary series" would be a term its own notice of race does not
 * use — the Junior Champions' Cup NoR says "opening series" throughout, which
 * is the name the table already holds for stages 1 and 2 together. So the
 * surviving stage takes it, and its race noun with it ("opening series
 * races", as that NoR writes them). Its races are Q1, Q2 and so on under
 * either wording: the QP of a Preliminary series names a part the event does
 * not have.
 *
 * Number is deliberately left alone. A stage whose name is plural — "medal
 * races" — is named as a stage, not counted, and the vocabulary already has
 * the singular where one race is meant: `raceNoun`. Bending the name to the
 * race noun for a one-race finale would read correctly in a heading and
 * wrongly everywhere the name is a container of races ("races in the medal
 * race, M1, M2 and so on").
 */
function adaptVocabulary(base: Vocabulary, config: SplitFleetConfig): Vocabulary {
  if (config.split?.kind !== 'none') return base;
  return {
    ...base,
    stages: {
      ...base.stages,
      qualifying: {
        name: base.seriesName,
        raceNoun: `${base.seriesName} race`,
        fleetNoun: `${stageAdjective(base.seriesName)} fleet`,
      },
    },
    prefixes: { ...base.prefixes, qualifying: 'Q' },
  };
}

/** A stage name as a heading or the start of a sentence. */
export function capitaliseStage(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** "qualifying series" -> "qualifying", so the stage name works as an
 *  adjective in front of a noun the vocabulary doesn't supply. */
export function stageAdjective(name: string): string {
  return name.replace(/\s+series$/i, '');
}

/** A race's label as the notice board writes it ("Q3", "F1"). Stage race 0 is
 *  not a race but the carried score a halved carry mints. */
export function stageRaceLabel(config: SplitFleetConfig, stage: SeriesStage, n: number): string {
  if (n === 0) return 'Carried';
  return `${resolveVocabulary(config).prefixes[stage]}${n}`;
}

/** How a medal boat's opening-series score is compressed before the medal
 *  races are added to it — the survey's F3 "compressed carry". The scores
 *  earned so far are divided and rounded, which pulls the leaders together so
 *  the last races can still change the order.
 *
 *  Real instances: the 2026 ILCA 7 Worlds divide by 2 and round to the nearest
 *  whole number, 0.5 upward (SI 18.7.3); the 2026 skiff Worlds divide by 2.25
 *  and truncate. */
export interface CarryTransform {
  kind: 'divide';
  by: 2;
  rounding: 'half-up';
}

/*
 * The halved score takes effect from the first completed medal race, so an
 * abandoned medal stage decides the event on the undivided opening score
 * (2026 ILCA SI 18.7.5 from Amendment 5). It matters more than the printed
 * numbers suggest: dividing and rounding never reverses two boats, but it
 * lands boats a point apart on the same score, and the tie-break then settles
 * them on the last race — so the boat behind could finish ahead purely
 * because the medal series never sailed.
 */

/** Apply a carry transform to an opening-series score. */
export function applyCarryTransform(points: number, transform: CarryTransform): number {
  // The epsilon keeps a value that is exactly on a boundary in decimal from
  // falling the wrong way through its binary representation.
  return Math.floor(points / transform.by + 0.5 + 1e-9);
}

export interface SplitRound {
  id: string;
  seriesId: string;
  stage: SeriesStage;
  fromStageRace: number;
  /** The round's fleets in SI/tier order. */
  fleetIds: string[];
  method: 'seeded' | 'rank-pattern' | 'split' | 'medal-select' | 'manual';
  basis: { throughStageRace: number; capturedAt: number } | null;
  /** Manual placements layered over the computed assignment (late entry,
   *  RC/jury move, redress promotion): competitorId → fleetId. The stored
   *  fleet memberships already reflect these; the map records which boats
   *  were hand-placed so the round card can show computed-vs-override. */
  overrides?: Record<string, string>;
  /** When the round's assignment lists were published (rolling page). */
  publishedAt?: number;
  createdAt: number;
}

export const QUALIFYING_COLOR_SETS: { label: string; color: string }[] = [
  { label: 'Yellow', color: '#eab308' },
  { label: 'Blue', color: '#3b82f6' },
  { label: 'Red', color: '#ef4444' },
  { label: 'Green', color: '#22c55e' },
];

export const FINAL_FLEET_SET: { label: string; color: string }[] = [
  { label: 'Gold', color: '#ca8a04' },
  { label: 'Silver', color: '#94a3b8' },
  { label: 'Bronze', color: '#b45309' },
  { label: 'Emerald', color: '#059669' },
];

/** The medal stage's colours, by position in the round. Unlike the other two
 *  sets these are not part of the series config — the medal ceremony names
 *  its fleet from the series' own vocabulary, so only the colours are
 *  fixed. */
export const MEDAL_FLEET_COLORS: string[] = ['#f59e0b', '#94a3b8'];

/**
 * fleetId → the colour the fleet is drawn in, everywhere a split-fleet series
 * is shown: the standings cells and their legend, the assignment lists, the
 * in-app tables. Three sources, in order:
 *
 *   1. the fleet's own colour, recorded when the round committed it — for a
 *      medal fleet, the only place it is written down at all;
 *   2. the series config's qualifying/final lists, matched by fleet name,
 *      which is where fleets created before the colour was stored have it;
 *   3. failing both, the stage's palette by position in the round.
 *
 * Absent from the map means no colour resolved — draw the fleet untinted.
 */
export function fleetColorById(data: SplitFleetData): Map<string, string> {
  const byName = new Map(
    [...data.config.qualifyingFleets, ...data.config.finalFleets].map((f) => [f.label, f.color]),
  );
  const colors = new Map<string, string>();
  for (const fleet of data.fleets) {
    const color = fleet.color ?? byName.get(fleet.name);
    if (color) colors.set(fleet.id, color);
  }
  for (const round of data.rounds) {
    const palette =
      round.stage === 'qualifying'
        ? data.config.qualifyingFleets.map((f) => f.color)
        : round.stage === 'final'
          ? data.config.finalFleets.map((f) => f.color)
          : MEDAL_FLEET_COLORS;
    round.fleetIds.forEach((fleetId, i) => {
      const color = palette[Math.min(i, palette.length - 1)];
      if (color && !colors.has(fleetId)) colors.set(fleetId, color);
    });
  }
  return colors;
}

export function defaultSplitFleetConfig(fleetCount: number): SplitFleetConfig {
  return {
    qualifyingFleets: QUALIFYING_COLOR_SETS.slice(0, fleetCount),
    finalFleets: FINAL_FLEET_SET.slice(0, fleetCount),
    split: { kind: 'equal-blocks' },
    discardThresholds: [
      { minRaces: 4, discardCount: 1 },
      { minRaces: 10, discardCount: 2 },
    ],
    vocabulary: DEFAULT_VOCABULARY,
    medal: { size: 10, multiplier: 2, tieBreak: 'medal-race-then-a8' },
  };
}

/** Fill defaults for configs stored before the full surface existed (the
 *  prototype's sparse shape), and drop the settings that are now fixed
 *  behaviour. */
export function normalizeSplitFleetConfig(raw: Partial<SplitFleetConfig>): SplitFleetConfig {
  const d = defaultSplitFleetConfig(raw.qualifyingFleets?.length ?? 3);
  const {
    raceLabels: _raceLabels,
    plannedDays: _plannedDays,
    finishSheets: _finishSheets,
    vocabularyOverride: _vocabularyOverride,
    stageNaming,
    carry: _carry,
    codeBasis: _codeBasis,
    equalization: _equalization,
    maxFinalDiscards: _maxFinalDiscards,
    protectLoneFinalRace: _protectLoneFinalRace,
    reassignmentTieOrder: _reassignmentTieOrder,
    ...rest
  } = raw as Partial<SplitFleetConfig> & Record<string, unknown>;
  const medal = (raw.medal ?? d.medal) as SplitFleetConfig['medal'] & {
    companionRace?: unknown;
    carryTransform?: CarryTransform & { appliesFrom?: unknown };
  };
  const {
    companionRace: _companionRace,
    raceCount: _raceCount,
    carryTransform,
    ...medalRest
  } = medal as typeof medal & { raceCount?: unknown };
  return {
    ...d,
    ...rest,
    split: raw.split?.kind === 'none' ? { kind: 'none' } : { kind: 'equal-blocks' },
    // Series-file v33 carried the words as an authored `stageNaming` block;
    // continuous numbering was the 2026 ILCA wording's mark.
    vocabulary:
      raw.vocabulary ??
      ((stageNaming as { continuousOpeningNumbers?: boolean } | undefined)?.continuousOpeningNumbers
        ? 'qualification-final'
        : DEFAULT_VOCABULARY),
    medal: {
      ...medalRest,
      tieBreak: medalRest.tieBreak ?? 'medal-race-then-a8',
      ...(carryTransform ? { carryTransform: { kind: 'divide', by: 2, rounding: 'half-up' } } : {}),
    },
  } as SplitFleetConfig;
}

/** What a new split-fleet series starts from: the simplest championship
 *  scored with split fleets, the Irish Sailing Junior Champions' Cup. One
 *  fleet sails an undivided opening series with one discard from three races,
 *  and the top ten sail a medal race at double points, ties broken on the
 *  medal race and then by rule A8. Everything else is shaped from the cards. */
export function newSplitFleetConfig(vocabulary: VocabularyKey = DEFAULT_VOCABULARY): SplitFleetConfig {
  return {
    qualifyingFleets: [UNBANDED_FLEET],
    finalFleets: [],
    split: { kind: 'none' },
    discardThresholds: [{ minRaces: 3, discardCount: 1 }],
    vocabulary,
    medal: { size: 10, multiplier: 2, tieBreak: 'medal-race-then-a8' },
  };
}

/** The label and colour a championship that never bands its fleet gives the
 *  one fleet it has. Neutral on both counts: the colours elsewhere tell
 *  fleets apart, and there is nothing here to tell apart. */
export const UNBANDED_FLEET: { label: string; color: string } = {
  label: 'Fleet',
  color: '#64748b',
};

// ---------------------------------------------------------------------------
// Assignment

/** Rank index (0-based) → fleet index, walking down the fleet list and back
 *  (1 Yellow, 2 Blue, 3 Red, 4 Red, 5 Blue, 6 Yellow, 7 Yellow, …). */
export function rankPatternFleetIndex(rankIndex: number, fleetCount: number): number {
  const cycle = 2 * fleetCount;
  const pos = rankIndex % cycle;
  return pos < fleetCount ? pos : cycle - 1 - pos;
}

/** Distribute an ordered competitor list into `fleetCount` fleets by the
 *  reassignment pattern. Returns one array of competitor ids per fleet,
 *  in the given fleet order. */
export function assignByRankPattern(orderedIds: string[], fleetCount: number): string[][] {
  const fleets: string[][] = Array.from({ length: fleetCount }, () => []);
  orderedIds.forEach((id, i) => fleets[rankPatternFleetIndex(i, fleetCount)].push(id));
  return fleets;
}

export type SeedOrder = 'seed-rank' | 'sail-number' | 'nationality-spread' | 'entry-order';

/** Initial seeding order. Prototype sources: numeric-ish sail-number order,
 *  nationality-then-sail (spreads compatriots across fleets when fed through
 *  the rank pattern), or plain entry order. */
/** Fleets not owned by a split round — what general-purpose fleet pickers
 *  (competitor assignment, start sequences, publishing groups, prize
 *  conditions) should offer. Round fleets' membership belongs to the Split
 *  Fleets ceremonies. */
export function pickableFleets<T extends { splitRoundId?: string }>(fleets: T[]): T[] {
  return fleets.filter((f) => !f.splitRoundId);
}

/**
 * The assignment a seeding committee already made, read off the entry list.
 *
 * A committee's fleets are "as nearly as possible, equal size *and ability*",
 * and the ability half is a human judgment — so when they hand over the
 * assignment rather than an order to deal from, no ordering reproduces it and
 * the labels themselves are the input. `Competitor.initialFleet` carries them
 * as written; this matches them against the configured fleets.
 *
 * Matching is case- and spacing-insensitive. A cell holding a plain number is
 * taken as a 1-based position in the fleet list, which is how a committee that
 * numbers its fleets writes them — unambiguous here, where the scorer has
 * already said this column is the assignment.
 *
 * Nothing is guessed at beyond that: a label matching no fleet, and a boat
 * carrying none at all, are both reported for the scorer to place by hand.
 */
export interface ImportedAssignment {
  /** competitorId → index into `fleets`. Boats with no usable label are absent. */
  assignments: Record<string, number>;
  /** Competitors the entry list assigned nowhere, in the order given. */
  unassigned: string[];
  /** Labels the entry list carried that no fleet matches, first-seen order. */
  unknownLabels: string[];
}

function normalizeFleetLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function assignFromInitialFleet(
  competitors: Competitor[],
  fleets: { label: string }[],
): ImportedAssignment {
  const indexByLabel = new Map(fleets.map((f, i) => [normalizeFleetLabel(f.label), i]));
  const assignments: Record<string, number> = {};
  const unassigned: string[] = [];
  const unknownLabels: string[] = [];
  for (const c of competitors) {
    const raw = c.initialFleet?.trim() ?? '';
    if (!raw) {
      unassigned.push(c.id);
      continue;
    }
    let index = indexByLabel.get(normalizeFleetLabel(raw));
    if (index == null && /^\d+$/.test(raw)) {
      const position = parseInt(raw, 10);
      if (position >= 1 && position <= fleets.length) index = position - 1;
    }
    if (index == null) {
      unassigned.push(c.id);
      if (!unknownLabels.some((l) => normalizeFleetLabel(l) === normalizeFleetLabel(raw))) {
        unknownLabels.push(raw);
      }
      continue;
    }
    assignments[c.id] = index;
  }
  return { assignments, unassigned, unknownLabels };
}

/** How sailors the seeding rank doesn't reach are ordered among themselves.
 *  They sort below every ranked sailor either way; this decides the order
 *  within that tail. At a championship where boats are chartered the sail
 *  number carries no information, so spreading compatriots is the useful
 *  choice — otherwise the unranked tail hands one fleet a national bloc. */
export type SeedTailOrder = 'sail-number' | 'nationality-spread';

export function seedOrder(
  competitors: Competitor[],
  order: SeedOrder,
  tailOrder: SeedTailOrder = 'sail-number',
): string[] {
  // Deliberately prefix-blind: at a championship where boats are chartered
  // the national letters say nothing about the boat, and grouping by nation
  // is the outcome seeding exists to avoid.
  const bySail = (a: Competitor, b: Competitor) =>
    compareSailNumbersIgnoringPrefix(a.sailNumber, b.sailNumber);
  const byNationality = (a: Competitor, b: Competitor) =>
    (a.nationality ?? '').localeCompare(b.nationality ?? '') || bySail(a, b);
  const sorted = [...competitors];
  if (order === 'seed-rank') {
    const tail = tailOrder === 'nationality-spread' ? byNationality : bySail;
    sorted.sort((a, b) => {
      const ra = a.seed ?? Infinity;
      const rb = b.seed ?? Infinity;
      if (ra !== rb) return ra - rb;
      // Both unranked: the tail order decides. Both ranked and equal can only
      // happen if two seeds collide, where sail number is as good as anything.
      return ra === Infinity ? tail(a, b) : bySail(a, b);
    });
  }
  else if (order === 'sail-number') sorted.sort(bySail);
  else if (order === 'nationality-spread')
    sorted.sort(
      (a, b) => (a.nationality ?? '').localeCompare(b.nationality ?? '') || bySail(a, b),
    );
  else sorted.sort((a, b) => a.createdAt - b.createdAt);
  return sorted.map((c) => c.id);
}

/** Near-equal final-fleet block sizes: earlier fleets never smaller than
 *  later ones (Gold ≥ Silver ≥ Bronze). */
export function finalBlockSizes(total: number, fleetCount: number): number[] {
  const base = Math.floor(total / fleetCount);
  const rem = total % fleetCount;
  return Array.from({ length: fleetCount }, (_, i) => base + (i < rem ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Scoring

/** One physical race: one fleet's sailing of a stage race. A stored `Race`
 *  is the on-water start sequence; the start carries which stage race its
 *  fleets are sailing, so the (race, start, fleet) triple is the scoring
 *  unit. */
export interface StageRaceRef {
  race: Race;
  start: RaceStart;
  fleetId: string;
}

export interface LogicalRace {
  stageRaceNumber: number;
  round: SplitRound | null;
  /** fleetId → physical race (may miss fleets that haven't got one yet). */
  races: Map<string, StageRaceRef>;
  /** Every fleet of the covering round has a completed physical race. */
  valid: boolean;
}

export interface SplitFleetData {
  config: SplitFleetConfig;
  rounds: SplitRound[];
  fleets: Fleet[];
  competitors: Competitor[];
  /** The series' races — the lookup behind the starts; a race is one start
   *  sequence and may hold several fleets' stage races. */
  races: Race[];
  /** All starts; those with `stage` set carry the split-fleet identity. */
  raceStarts: RaceStart[];
  finishes: Finish[];
}

/** Enumerate the physical races — one ref per (race, start, fleet) for every
 *  start carrying a stage identity, optionally restricted to one stage. */
export function stageRaceRefs(data: SplitFleetData, stage?: SeriesStage): StageRaceRef[] {
  const raceById = new Map(data.races.map((r) => [r.id, r]));
  const refs: StageRaceRef[] = [];
  for (const start of data.raceStarts) {
    if (!start.stage || start.stageRaceNumber == null) continue;
    if (stage && start.stage !== stage) continue;
    const race = raceById.get(start.raceId);
    if (!race) continue;
    for (const fleetId of start.fleetIds) refs.push({ race, start, fleetId });
  }
  return refs;
}

export function roundsForStage(rounds: SplitRound[], stage: SeriesStage): SplitRound[] {
  return rounds
    .filter((r) => r.stage === stage)
    .sort((a, b) => a.fromStageRace - b.fromStageRace || a.createdAt - b.createdAt);
}

export function coveringRound(
  rounds: SplitRound[],
  stage: SeriesStage,
  stageRaceNumber: number,
): SplitRound | null {
  const eligible = roundsForStage(rounds, stage).filter(
    (r) => r.fromStageRace <= stageRaceNumber,
  );
  return eligible.length ? eligible[eligible.length - 1] : null;
}

/** A physical race is complete when its fleet has rows on the race's sheet
 *  (a crossing or a code). Per fleet: one sequence's combined sheet may
 *  complete some of its fleets before others. */
export function physicalRaceCompleted(
  ref: StageRaceRef,
  competitors: Competitor[],
  finishes: Finish[],
): boolean {
  const members = new Set(
    competitors.filter((c) => c.fleetIds.includes(ref.fleetId)).map((c) => c.id),
  );
  return finishes.some(
    (f) =>
      f.raceId === ref.race.id &&
      f.competitorId !== null &&
      members.has(f.competitorId) &&
      (f.sortOrder !== null || f.resultCode !== null),
  );
}

/** Group a stage's physical races into logical races with validity. Two
 *  starts can claim the same (fleet, stage race number) — an abandoned
 *  attempt lingering beside its resail — so the grouping prefers a complete
 *  physical race over an incomplete one, and the later-created race (the
 *  resail) among equals, rather than depending on start order. */
export function logicalRaces(data: SplitFleetData, stage: SeriesStage): LogicalRace[] {
  const prefer = (a: StageRaceRef | undefined, b: StageRaceRef): StageRaceRef => {
    if (!a) return b;
    const aDone = physicalRaceCompleted(a, data.competitors, data.finishes);
    const bDone = physicalRaceCompleted(b, data.competitors, data.finishes);
    if (aDone !== bDone) return aDone ? a : b;
    return b.race.raceNumber >= a.race.raceNumber ? b : a;
  };
  const byNumber = new Map<number, Map<string, StageRaceRef>>();
  for (const ref of stageRaceRefs(data, stage)) {
    let entry = byNumber.get(ref.start.stageRaceNumber!);
    if (!entry) byNumber.set(ref.start.stageRaceNumber!, (entry = new Map()));
    entry.set(ref.fleetId, prefer(entry.get(ref.fleetId), ref));
  }
  return [...byNumber.entries()]
    .sort(([a], [b]) => a - b)
    .map(([stageRaceNumber, races]) => {
      const round = coveringRound(data.rounds, stage, stageRaceNumber);
      const valid =
        !!round &&
        round.fleetIds.every((fid) => {
          const ref = races.get(fid);
          return !!ref && physicalRaceCompleted(ref, data.competitors, data.finishes);
        });
      return { stageRaceNumber, round, races, valid };
    });
}

/** A round as the export and render paths receive it: wide enough for both
 *  the server repo's `SplitRound` and the file-shaped rounds the client repo
 *  hands back (no `seriesId`, `method` as a bare string, `basis` optional). */
export type RenderSplitRound = Omit<SplitRound, 'seriesId' | 'method' | 'basis'> & {
  seriesId?: string;
  method: string;
  basis?: SplitRound['basis'];
};

/** Build the engine's `SplitFleetData` from the pieces a caller holds — the
 *  one place the widened rounds are narrowed and the entry list is resolved,
 *  so every page and every data file is built from the same boats. */
export function assembleSplitFleetData(input: {
  config: SplitFleetConfig;
  rounds: readonly RenderSplitRound[];
  fleets: Fleet[];
  competitors: Competitor[];
  races: Race[];
  raceStarts: RaceStart[];
  finishes: Finish[];
}): SplitFleetData {
  return dropNonEntrants({
    config: input.config,
    rounds: input.rounds.map((r) => ({
      ...r,
      seriesId: r.seriesId ?? '',
      method: r.method as SplitRound['method'],
      basis: r.basis ?? null,
    })),
    fleets: input.fleets,
    competitors: input.competitors,
    races: input.races,
    raceStarts: input.raceStarts,
    finishes: input.finishes,
  });
}

/**
 * The same data with the boats that are not entered dropped.
 *
 * A competitor the scorer marked `excluded` is on the list but not an entrant,
 * and a non-entrant is scored nowhere: off the standings, out of the fleet she
 * was dealt into, and out of the count that sets everyone else's replacement
 * score. That is the semantic `resolveEntrants` gives the plain engine, and a
 * championship owes its competitors the same one.
 *
 * Every construction of a `SplitFleetData` goes through here, so that the
 * fleet memberships every later pass reads are already the entered boats.
 */
export function dropNonEntrants(data: SplitFleetData): SplitFleetData {
  const entrants = resolveEntrants(data.competitors, data.races, data.finishes);
  return entrants.length === data.competitors.length
    ? data
    : { ...data, competitors: entrants };
}

export function fleetMembers(competitors: Competitor[], fleetId: string): Competitor[] {
  return competitors.filter((c) => c.fleetIds.includes(fleetId));
}

function largestFleetSize(data: SplitFleetData, round: SplitRound): number {
  return Math.max(...round.fleetIds.map((fid) => fleetMembers(data.competitors, fid).length));
}

export interface CellScore {
  stage: SeriesStage;
  stageRaceNumber: number;
  fleetId: string;
  raceId: string;
  points: number;
  code: string | null; // 'DNC', a result/penalty code, or 'RDG'
  discarded: boolean;
  counts: boolean; // false while the logical race is not yet valid
  discardable: boolean;
  /** A medal boat's compressed opening-series score, carried into the medal
   *  races (see `CarryTransform`). Not a race result. */
  carriedTransform?: boolean;
  /** A race score replaced by the carried cell — the opening-series scores
   *  under a carry transform. Shown, but out of the championship score. */
  superseded?: boolean;
  /** The RDG finish awaiting A9 resolution (engine-internal). */
  rdg?: Finish | null;
}

export interface SplitStandingRow {
  competitor: Competitor;
  cells: CellScore[];
  total: number;
  net: number;
  /** Rank in the current phase's ordering (qualifying: combined; after the
   *  split: within-tier, continuing across tiers). */
  rank: number;
  /** Final fleet id once split (display grouping), else null. */
  finalFleetId: string | null;
  medal: boolean;
}

/** Score one physical race — one fleet's sailing of a stage race — over the
 *  race's sheet. Rows are scoped to `members` — the boats sailing it — so a
 *  combined sheet interleaving a sequence's fleets yields correct per-fleet
 *  places, and a row for anyone else scores nothing and takes no place.
 *  - Finishers score their place within the fleet + start.firstPlaceOffset
 *    (the companion "last race" primitive), multiplied by `multiplier`.
 *  - Coded finishes and absentees (implicit DNC) score `codeBase`, multiplied
 *    the same way.
 *
 *    A medal-race instruction reads "double the number of points specified in
 *    RRS Appendix A4" (2024 ILCA SI 18.6; Irish Sailing Junior Champions' Cup
 *    NoR 15.2), and A4 is a table of *finishing place* to points. A5.2 scores
 *    a boat who did not sail the course "points for the finishing place one
 *    more than the number of boats entered" — that is a place, and A4 is what
 *    turns it into points — so the code score doubles with the rest. The
 *    junior event's published results are the worked example: six boats
 *    outside a ten-boat medal fleet, scored 34.0 DNC on an entry list of 16.
 *  - SCP/ZFP add a percentage of the race's DNF score and DPI adds stated
 *    points, both through the engine-wide `applyAdditivePenalty` (RRS
 *    44.3(c) rounding and DNF cap). Penalties apply to finishers only (a
 *    coded boat is already at the base). The cap is the *weighted* DNF score,
 *    because that is this race's score for DNF; a stated DPI stays the points
 *    the protest committee awarded, added after the doubling, which is what
 *    SI 18.6's "with any [SP] then added" says.
 *  - RDG rows are emitted with `rdg` set and points 0; the standings pass
 *    resolves them per RRS A9 once all other cells exist.
 */
function scorePhysicalRace(
  ref: StageRaceRef,
  members: Competitor[],
  finishes: Finish[],
  codeBase: number,
  multiplier: number,
): Map<string, { points: number; code: string | null; rdg: Finish | null }> {
  const offset = ref.start.firstPlaceOffset ?? 0;
  const memberIds = new Set(members.map((m) => m.id));
  const rows = finishes.filter(
    (f) => f.raceId === ref.race.id && f.competitorId && memberIds.has(f.competitorId),
  );
  const finishers = rows
    .filter((f) => f.sortOrder !== null && !f.resultCode)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  // This race's score for a boat that did not sail the course: the weighting
  // reaches it, so it is also the DNF cap the penalties below are measured
  // against.
  const codePoints = weightedRacePoints(codeBase, multiplier);
  const out = new Map<string, { points: number; code: string | null; rdg: Finish | null }>();
  finishers.forEach((f, i) => {
    const placePoints = weightedRacePoints(i + 1 + offset, multiplier);
    // One implementation of RRS 44.3(c) for both engines: the percentage is of
    // the race's DNF score, rounded to the nearest tenth (0.05 up), and the
    // penalty never makes her worse than DNF.
    const points = applyAdditivePenalty(placePoints, f, codePoints, ref.fleetId);
    out.set(f.competitorId!, { points, code: f.penaltyCode ?? null, rdg: null });
  });
  for (const f of rows) {
    if (out.has(f.competitorId!)) continue;
    if (f.resultCode === 'RDG') {
      out.set(f.competitorId!, { points: 0, code: 'RDG', rdg: f });
    } else if (f.resultCode) {
      out.set(f.competitorId!, { points: codePoints, code: f.resultCode, rdg: null });
    }
  }
  for (const m of members) {
    if (out.has(m.id)) continue;
    out.set(m.id, { points: codePoints, code: 'DNC', rdg: null });
  }
  return out;
}

/** RRS A8.1: compare best-to-worst score lists (ascending, lexicographic).
 *  Returns negative when a ranks ahead of b. */
function compareScoreLists(a: number[], b: number[]): number {
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
    if (sa[i] !== sb[i]) return sa[i] - sb[i];
  }
  return 0;
}

/** Sort key putting a row's cells in the order they were sailed. */
function stageRaceKey(c: CellScore): number {
  return STAGES.indexOf(c.stage) * 1000 + c.stageRaceNumber;
}

/** RRS A8.2: last race, then next-to-last, and so on — over counting cells
 *  in stage/race order, including discarded scores. */
function compareLastRace(a: CellScore[], b: CellScore[]): number {
  const key = stageRaceKey;
  const la = a.filter((c) => c.counts).sort((x, y) => key(x) - key(y));
  const lb = b.filter((c) => c.counts).sort((x, y) => key(x) - key(y));
  for (let i = 0; i < Math.min(la.length, lb.length); i++) {
    const ca = la[la.length - 1 - i];
    const cb = lb[lb.length - 1 - i];
    if (ca.points !== cb.points) return ca.points - cb.points;
  }
  return 0;
}

/** The last race and nothing else — the tie-break some sailing instructions
 *  put in place of RRS A8 rather than after it ("If there is a tie between
 *  two or more boats, they shall be ranked in order of their scores in the
 *  last race. This changes RRS A8.").
 *
 *  Two departures from `compareLastRace`, both of them that sentence read
 *  literally:
 *
 *  - It stops after one race. A8 is gone, so a tie the last race cannot
 *    break — two boats coded alike in it — stays a tie rather than falling
 *    back to the race before.
 *  - It reads real race scores, superseded ones included. Where a carry
 *    transform has replaced a boat's earlier cells with one carried number
 *    and no race of the last stage has been sailed, the last race is still a
 *    race she sailed, and the transform must not hide it.
 */
function compareLastRaceOnly(a: CellScore[], b: CellScore[]): number {
  const last = (cells: CellScore[]) => {
    const sailed = cells.filter((c) => c.raceId).sort((x, y) => stageRaceKey(x) - stageRaceKey(y));
    return sailed[sailed.length - 1] ?? null;
  };
  const ca = last(a);
  const cb = last(b);
  if (!ca || !cb) return 0;
  return ca.points - cb.points;
}

/** The boats' scores in the deciding stage's races, compared — the tie-break
 *  a notice of race puts ahead of RRS A8 ("broken in favour of the boat with
 *  the lower score in the medal race").
 *
 *  The clause is written for the single medal race its event sails, so a
 *  stage of several is read as what that sentence generalises to: the boat's
 *  score for the stage, which for one race is her score in it. The carried
 *  cell a compressed carry mints is not a race and is left out — it is the
 *  opening series, and comparing it here would decide the tie on the very
 *  scores the boats are tied on.
 */
function compareMedalRaceScore(a: CellScore[], b: CellScore[]): number {
  const stageScore = (cells: CellScore[]) =>
    cells
      .filter((c) => c.stage === 'medal' && c.raceId && c.counts)
      .reduce((sum, c) => sum + c.points, 0);
  return stageScore(a) - stageScore(b);
}

function discardCount(config: SplitFleetConfig, countedRaces: number): number {
  let n = 0;
  for (const t of config.discardThresholds) {
    if (countedRaces >= t.minRaces) n = Math.max(n, t.discardCount);
  }
  return n;
}

/** Apply the discard ladder over a row's cells. Medal cells are never
 *  discardable and do not count toward the thresholds (2024 ILCA SI 18.6). At
 *  most `MAX_FINAL_DISCARDS` may fall on final-series cells, and a lone
 *  completed final race is protected (ILCA: "if only one Final series race is
 *  completed it will not be excluded"). Ties in badness discard the earliest
 *  race (RRS A2.1). Mutates cell.discarded. */
function applyDiscards(config: SplitFleetConfig, cells: CellScore[]): void {
  const counting = cells.filter((c) => c.counts);
  const thresholdRaces = counting.filter((c) => c.stage !== 'medal').length;
  const n = discardCount(config, thresholdRaces);
  const finalCells = counting.filter((c) => c.stage === 'final');
  const loneFinalProtected = finalCells.length === 1;
  const order: SeriesStage[] = ['qualifying', 'final', 'medal'];
  const raceKey = (c: CellScore) => order.indexOf(c.stage) * 1000 + c.stageRaceNumber;
  let finalDiscards = 0;
  const candidates = counting
    .filter((c) => c.discardable && c.stage !== 'medal')
    .sort((a, b) => b.points - a.points || raceKey(a) - raceKey(b));
  let applied = 0;
  for (const c of candidates) {
    if (applied >= n) break;
    if (c.stage === 'final') {
      if (loneFinalProtected) continue;
      if (finalDiscards >= MAX_FINAL_DISCARDS) continue;
      finalDiscards++;
    }
    c.discarded = true;
    applied++;
  }
}

/**
 * Combined standings over qualifying (+ final + medal once they exist).
 * Ordering: medal boats first (by net), then final-fleet tiers in order
 * (each by net), then — before any split — everyone by net over the
 * combined line. Returns rows with per-cell detail for rendering.
 */
export function splitFleetStandings(input: SplitFleetData): SplitStandingRow[] {
  // Applied here as well as at every construction site: the entry list is what
  // the replacement score is counted from, so scoring a list that still holds
  // non-entrants is wrong for every boat in the fleet, not just for them.
  const data = dropNonEntrants(input);
  const { config, rounds, competitors } = data;

  const qRaces = logicalRaces(data, 'qualifying');
  const fRaces = logicalRaces(data, 'final');
  const mRaces = logicalRaces(data, 'medal');

  const splitRound = roundsForStage(rounds, 'final')[0] ?? null;
  const medalRound = roundsForStage(rounds, 'medal')[0] ?? null;
  const medalFleetId = medalRound?.fleetIds[0] ?? null;

  const rowByCompetitor = new Map<string, SplitStandingRow>();
  for (const c of competitors) {
    rowByCompetitor.set(c.id, {
      competitor: c,
      cells: [],
      total: 0,
      net: 0,
      rank: 0,
      finalFleetId: splitRound?.fleetIds.find((fid) => c.fleetIds.includes(fid)) ?? null,
      medal: !!medalFleetId && c.fleetIds.includes(medalFleetId),
    });
  }

  const medalMembers = medalFleetId
    ? new Set(fleetMembers(competitors, medalFleetId).map((c) => c.id))
    : null;

  const addStage = (lrs: LogicalRace[], stage: SeriesStage) => {
    for (const lr of lrs) {
      if (!lr.round) continue;
      const qualifying = stage === 'qualifying';
      // RRS A5.2 replacement base: the largest fleet of the round in the
      // first stage, the boat's own fleet after it.
      const codeBaseQ = largestFleetSize(data, lr.round) + 1;
      for (const fleetId of lr.round.fleetIds) {
        const ref = lr.races.get(fleetId);
        if (!ref) continue;
        const members = fleetMembers(competitors, fleetId);
        const codeBase = qualifying ? codeBaseQ : members.length + 1;
        const isMedalFleet = stage === 'medal' && fleetId === lr.round.fleetIds[0];
        const multiplier = isMedalFleet ? config.medal.multiplier : 1;
        // Selecting the medal fleet does not remove a boat from the fleet she
        // came from — she is still ranked inside it, and its assigned size
        // still sets the score base. It does mean she stops sailing its
        // races: where the SIs give the boats who missed the medal fleet one
        // more race of their own (2026 ILCA SI 7.7), that race is not hers.
        // She is absent from it rather than DNC, and a row for her on its
        // sheet scores nothing and takes no place from the boats who sailed
        // it. That race is the one whose start carries the companion offset,
        // in the final series or — where the fleet is never divided — the
        // opening series; every race before the cut was sailed by everyone.
        const companion =
          stage !== 'medal' && (ref.start.firstPlaceOffset ?? 0) > 0 && medalMembers !== null;
        const sailing = companion ? members.filter((m) => !medalMembers!.has(m.id)) : members;
        const scores = scorePhysicalRace(ref, sailing, data.finishes, codeBase, multiplier);
        for (const [competitorId, sc] of scores) {
          const row = rowByCompetitor.get(competitorId);
          if (!row) continue;
          row.cells.push({
            stage,
            stageRaceNumber: lr.stageRaceNumber,
            fleetId,
            raceId: ref.race.id,
            points: sc.points,
            code: sc.code,
            // qualifying: only valid logical races count; final/medal races
            // count as soon as they're completed
            counts: qualifying ? lr.valid : physicalRaceCompleted(ref, competitors, data.finishes),
            discardable: stage !== 'medal',
            discarded: false,
            rdg: sc.rdg,
          });
        }
      }
    }
  };

  addStage(qRaces, 'qualifying');
  addStage(fRaces, 'final');
  addStage(mRaces, 'medal');

  const rows = [...rowByCompetitor.values()];

  // Resolve RDG cells per RRS A9: average points, to the nearest tenth
  // (0.05 rounded up), over the boat's other counting non-RDG cells --
  // honouring the finish's method and include/exclude race-id sets. Stated
  // points pass straight through. Resolution reads only non-RDG cells, so
  // two RDG cells never feed each other.
  const stageOrder: SeriesStage[] = ['qualifying', 'final', 'medal'];
  const cellKey = (c: CellScore) => stageOrder.indexOf(c.stage) * 1000 + c.stageRaceNumber;
  for (const row of rows) {
    for (const cell of row.cells) {
      if (!cell.rdg) continue;
      const f = cell.rdg;
      if (f.redressMethod === 'stated' && f.redressPoints != null) {
        cell.points = f.redressPoints;
        continue;
      }
      let pool = row.cells.filter((c) => c !== cell && c.counts && !c.rdg);
      if (f.redressMethod === 'races_before') {
        pool = pool.filter((c) => cellKey(c) < cellKey(cell));
      }
      if (f.redressIncludeRaceIds?.length) {
        pool = pool.filter((c) => f.redressIncludeRaceIds!.includes(c.raceId));
      } else if (f.redressExcludeRaceIds?.length) {
        pool = pool.filter((c) => !f.redressExcludeRaceIds!.includes(c.raceId));
      }
      if (pool.length === 0) {
        cell.points = 0;
        continue;
      }
      const mean = pool.reduce((sum, c) => sum + c.points, 0) / pool.length;
      cell.points = Math.round(mean * 10 + 1e-9) / 10;
    }
  }

  const totalRow = (row: SplitStandingRow) => {
    const counting = row.cells.filter((c) => c.counts);
    row.total = counting.reduce((s, c) => s + c.points, 0);
    row.net = counting.filter((c) => !c.discarded).reduce((s, c) => s + c.points, 0);
  };

  for (const row of rows) {
    applyDiscards(config, row.cells);
    totalRow(row);
  }

  // Compressed carry: each medal boat's opening-series net is divided and
  // rounded, and that one number — not her race scores — is what the medal
  // races add to (2026 ILCA SI 18.7.2/18.7.3). Applied after the discards
  // because the transform's input is her net.
  //
  // The carried cell exists from the moment the medal fleet is committed —
  // the qualified boats and everyone watching them need to see the scores
  // the deciding races will add to. It counts only once a medal race has
  // been completed, so a medal stage that never sails leaves the undivided
  // opening score as the event result (2026 ILCA SI 18.7.5 from
  // Amendment 5).
  const transform = config.medal.carryTransform;
  const medalRaceCompleted = mRaces.some((lr) => lr.valid);
  if (transform && medalRound) {
    const applies = medalRaceCompleted;
    for (const row of rows) {
      if (!row.medal) continue;
      const opening = row.cells.filter((c) => c.counts && c.stage !== 'medal');
      if (opening.length === 0) continue;
      const carried = applyCarryTransform(
        opening.filter((c) => !c.discarded).reduce((s, c) => s + c.points, 0),
        transform,
      );
      if (applies) {
        for (const cell of opening) {
          cell.counts = false;
          cell.superseded = true;
        }
      }
      row.cells.push({
        stage: 'medal',
        stageRaceNumber: 0,
        fleetId: medalFleetId ?? '',
        raceId: '',
        points: carried,
        code: null,
        counts: applies,
        discardable: false,
        discarded: false,
        carriedTransform: true,
      });
      if (applies) totalRow(row);
    }
  }

  // RRS A8: A8.1 (best score lists, excluded scores out) then A8.2 (last
  // race backwards, including excluded scores).
  const byA8 = (a: SplitStandingRow, b: SplitStandingRow) =>
    a.net - b.net ||
    compareScoreLists(
      a.cells.filter((c) => c.counts && !c.discarded).map((c) => c.points),
      b.cells.filter((c) => c.counts && !c.discarded).map((c) => c.points),
    ) ||
    compareLastRace(a.cells, b.cells);

  // The medal boats' own tie-break, where the SIs give them one. Scoped to
  // them because they are the boats a carry transform rounds together;
  // everywhere else A8 stands as written.
  //
  // Scoped in time as well as to the boats: the SI tie-break belongs to the
  // event score the medal stage defines, so it waits until a row is actually
  // ranked on a medal-stage score — the carried cell counting, or a medal
  // race sailed. Before that the ranking on display is the opening series'
  // own (2026 ILCA SI 18.7.5 from Amendment 5: with no medal race completed,
  // the unadjusted score decides), and A8 must break its ties.
  const onMedalScore = (r: SplitStandingRow) =>
    r.cells.some((c) => c.stage === 'medal' && c.counts);
  const byNet = (a: SplitStandingRow, b: SplitStandingRow) => {
    const medalScored = a.medal && b.medal && onMedalScore(a) && onMedalScore(b);
    // `last-race` is not a step after A8 but a replacement for it: no
    // count-of-places comparison first, and no next-to-last race behind.
    if (config.medal.tieBreak === 'last-race' && medalScored) {
      return a.net - b.net || compareLastRaceOnly(a.cells, b.cells);
    }
    // `medal-race-then-a8` runs before A8 rather than after it, and hands
    // back whatever it cannot separate: `byA8` leads with the nets, which are
    // equal by the time it is reached, so what remains of it is A8.1 then
    // A8.2 — the rule as written, for the boats the clause does not address.
    if (config.medal.tieBreak === 'medal-race-then-a8' && medalScored) {
      return (
        a.net - b.net || compareMedalRaceScore(a.cells, b.cells) || byA8(a, b)
      );
    }
    return byA8(a, b);
  };

  // Tier ordering: medal first, then final fleets in order, then the rest.
  const tierIndex = (row: SplitStandingRow): number => {
    if (row.medal) return -1;
    if (!splitRound || !row.finalFleetId) return splitRound ? 999 : 0;
    return splitRound.fleetIds.indexOf(row.finalFleetId);
  };
  const byOverall = (a: SplitStandingRow, b: SplitStandingRow) =>
    tierIndex(a) - tierIndex(b) || byNet(a, b);
  rows.sort(byOverall);
  // A tie the tie-break steps cannot separate stays a tie: the boats share
  // the rank and the next boat skips past it. The comparator leads with the
  // tier, so boats in different tiers never share even when their scores do.
  rows.forEach((row, i) => {
    row.rank = i > 0 && byOverall(rows[i - 1], row) === 0 ? rows[i - 1].rank : i + 1;
  });
  return rows;
}

/** Provisional final-series cut boundaries over a pre-split qualifying
 *  ranking: returns the 0-based row indexes after which a cut line renders. */
export function provisionalCutIndexes(total: number, fleetCount: number): number[] {
  const sizes = finalBlockSizes(total, fleetCount);
  const cuts: number[] = [];
  let acc = 0;
  for (let i = 0; i < sizes.length - 1; i++) {
    acc += sizes[i];
    cuts.push(acc - 1);
  }
  return cuts;
}
