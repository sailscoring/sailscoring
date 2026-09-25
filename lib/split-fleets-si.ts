// Render a split-fleet configuration back as sailing-instruction prose.
//
// Scorers set this up once every year or two, holding an SI or NoR someone
// else wrote. The settings are only trustworthy if they can be checked
// against that document, so the editor restates the current configuration in
// the language the scoring section of an SI actually uses — the scorer reads
// down it beside their own paperwork and looks for a sentence that disagrees.
//
// Deliberately our own wording rather than extracts from real events' SIs:
// those are third-party documents, and this has to stay distributable.

import { resolveVocabulary, stageAdjective, stageRaceLabel } from './split-fleets';
import type { SplitFleetConfig } from './split-fleets';

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];

function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}

/** "a Preliminary series", "an opening series" — the SIs' own names start
 *  with either, and getting it wrong is the first thing a scorer notices. */
function article(noun: string): string {
  return `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;
}

function listLabels(items: { label: string }[]): string {
  const labels = items.map((f) => f.label);
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/** The discard ladder as one sentence: "excluding her worst score when 4 or
 *  more races have been completed, and her two worst when 10 or more". */
function discardClause(config: SplitFleetConfig): string {
  const ladder = [...config.discardThresholds].sort((a, b) => a.minRaces - b.minRaces);
  if (ladder.length === 0) return 'A boat’s series score will be the total of her race scores.';
  const parts = ladder.map((t, i) => {
    const scores =
      t.discardCount === 1 ? 'her worst score' : `her ${countWord(t.discardCount)} worst scores`;
    return i === 0
      ? `excluding ${scores} when ${t.minRaces} or more races have been completed`
      : `and ${scores} when ${t.minRaces} or more`;
  });
  return `A boat’s series score will be the total of her race scores, ${parts.join(', ')}.`;
}

/** How the races are numbered, in the labels the notice board will carry:
 *  "Races in the Preliminary series will be numbered QP1, QP2 and so on".
 *  The examples come from `stageRaceLabel`, so the sentence cannot drift from
 *  what the standings and the published pages go on to show. */
function raceLabelClause(config: SplitFleetConfig): string {
  const vocab = resolveVocabulary(config);
  const first = (stage: 'qualifying' | 'final' | 'medal') =>
    `${stageRaceLabel(config, stage, 1)}, ${stageRaceLabel(config, stage, 2)} and so on`;
  const parts = [`races in the ${vocab.stages.qualifying.name} will be numbered ${first('qualifying')}`];
  // A championship that never divides its fleet sails no second stage, so it
  // has no second stage's races to number — and numbering them anyway names
  // a stage in the very document the scorer is checking against their notice
  // of race.
  if (config.split.kind !== 'none') {
    parts.push(`races in the ${vocab.stages.final.name}, ${first('final')}`);
  }
  parts.push(`races in the ${vocab.stages.medal.name}, ${first('medal')}`);
  return `For the purposes of these instructions, ${parts.join('; ')}.`;
}

/**
 * Which sentence is which, independent of where it lands in the list — the
 * list is not positionally stable, since an undivided championship leaves out
 * every sentence about dividing its fleet.
 *
 * These are the anchors the editor points its settings at. Renaming one is
 * free; the ids are not stored or shared anywhere.
 */
export type SplitFleetSentenceId =
  | 'format'
  | 'series-division'
  | 'race-labels'
  | 'fleet-assignment'
  | 'reassignment'
  | 'fleet-equalisation'
  | 'split'
  | 'totals'
  | 'discards'
  | 'final-discard-cap'
  | 'non-finisher'
  | 'medal'
  | 'medal-ranking'
  | 'medal-carry-transform'
  | 'medal-tie-break';

export type SplitFleetSentence = { id: SplitFleetSentenceId; text: string };

/**
 * Which sentences each of the editor's settings writes, so the editor can
 * mark them when the scorer reaches the field. Kept here beside the sentences
 * themselves: apart, the two drift.
 *
 * A setting that writes no sentence has no entry and marks nothing. Finish
 * sheets is a layout choice and says so, and the vocabulary picker rewrites
 * every sentence, where marking all of them would be noise pretending to be
 * information.
 */
export const SENTENCES_BY_SETTING = {
  fleetCount: ['fleet-assignment', 'split'],
  discards: ['discards', 'final-discard-cap'],
  medal: ['medal', 'medal-ranking'],
  medalCarryTransform: ['medal-carry-transform'],
  medalTieBreak: ['medal-tie-break'],
} satisfies Record<string, SplitFleetSentenceId[]>;

/**
 * The configuration as a numbered set of sailing-instruction sentences, in
 * the order an SI's scoring section usually runs: format, fleets,
 * reassignment, split, how the series totals, discards, non-finisher scores,
 * medal race.
 */
export function describeSplitFleetConfig(config: SplitFleetConfig): SplitFleetSentence[] {
  const lines: SplitFleetSentence[] = [];
  const push = (id: SplitFleetSentenceId, text: string) => lines.push({ id, text });
  // The stages by the names the sailing instructions give them: an SI
  // translation that used our words for them would not be one.
  const vocab = resolveVocabulary(config);
  const q = vocab.stages.qualifying.name;
  const f = vocab.stages.final.name;
  const m = vocab.stages.medal.name;
  const qAdj = stageAdjective(q);
  const qualifying = listLabels(config.qualifyingFleets);
  const finals = listLabels(config.finalFleets);
  const topFleet = config.finalFleets[0]?.label ?? 'the top fleet';

  // With a third stage the event's own structure is the series over stages
  // one and two, and then that stage — the 2026 ILCA SI 7.1/7.2 shape ("the
  // event consists of a Qualification series and Final series", the
  // Qualification series "divided into Preliminary series and Elimination
  // series"). Without one, stages one and two are the whole event and the
  // umbrella term would be an empty distinction.
  // A championship that never bands its fleet has one stage and one fleet, so
  // every sentence about dividing, reassigning and equalising them is about
  // nothing. What is left is the shape (`q` is the whole opening series
  // here — see `adaptVocabulary`) and, where there is one, the deciding race.
  const unbanded = config.split.kind === 'none';
  push(
    'format',
    unbanded
      ? `The championship will be sailed as ${article(q)} followed by the ${m}, in one fleet.`
      : `The championship will be sailed as ${article(vocab.seriesName)} followed by the ${m}.`,
  );
  if (!unbanded) {
    push(
      'series-division',
      `The ${vocab.seriesName} will be divided into ${article(q)} and ${article(f)}.`,
    );
  }
  push('race-labels', raceLabelClause(config));
  if (!unbanded) {
    push(
      'fleet-assignment',
      `Boats will be assigned to ${countWord(config.qualifyingFleets.length)} ${qAdj} fleets (${qualifying}) of, as nearly as possible, equal size and ability.`,
    );
    push(
      'reassignment',
      `After each day of racing, boats will be reassigned to the ${qAdj} fleets on the basis of their ranks in the ${q}.`,
    );
    push(
      'fleet-equalisation',
      `If at the end of the ${q} some ${qAdj} fleets have more race scores than others, the extra races will be abandoned and cancelled so that all fleets have the same number of race scores.`,
    );
    push(
      'split',
      `At the end of the ${q} boats will be assigned on the basis of their ranks to the ${finals} fleets, of, as nearly as possible, equal size.`,
    );
  }

  // Scoped to the series over stages one and two: the deciding stage's own
  // total is the medal block's business (2026 ILCA SI 18.6.1 says "in the
  // Qualification series", not "in the event").
  push(
    'totals',
    unbanded
      ? `The ${q} races will count for total points in the championship.`
      : `The ${q} races and the ${f} races will count for total points in the ${vocab.seriesName}.`,
  );
  push('discards', discardClause(config));
  if (!unbanded) {
    push(
      'final-discard-cap',
      `No more than one excluded score may come from the ${f}, and if only one ${f} race has been completed that score will not be excluded.`,
    );
  }

  const qualifyingBase =
    unbanded && config.qualifyingFleets.length === 1
      ? 'the number of boats entered, plus one'
      : `the number of boats in the largest ${qAdj} fleet, plus one`;
  const finalBase = `the number of boats in her own ${vocab.stages.final.fleetNoun}, plus one`;
  push(
    'non-finisher',
    unbanded
      ? `A boat that does not start, does not finish, retires or is disqualified will be scored ${qualifyingBase}.`
      : `A boat that does not start, does not finish, retires or is disqualified will be scored ${qualifyingBase} in the ${q}, and ${finalBase} in the ${f}.`,
  );

  const medal = config.medal;
  const score =
    medal.multiplier === 1
      ? 'A boat’s score there may not be excluded'
      : `A boat’s score there will be multiplied by ${medal.multiplier} and may not be excluded`;
  // What the boats who miss the cut do is part of the same clause in the SIs,
  // and a scorer checking ours against theirs looks for it: where the opening
  // series is divided, one more race of the second stage in their own fleets,
  // scored below the medal fleet (2026 ILCA SI 7.7 and 18.5.3); where it is
  // not, no further racing at all.
  const rest = unbanded
    ? `; the boats that do not qualify for it will have no score for the ${vocab.stages.medal.raceNoun}, and in any one more ${vocab.stages.qualifying.raceNoun} they sail the first of them will be scored ${medal.size + 1} points, the second ${medal.size + 2}, and so on`
    : `; the boats that do not qualify for it will sail one more ${vocab.stages.final.raceNoun} in their own fleets, in which the first ${topFleet} boat will be scored ${medal.size + 1} points, the second ${medal.size + 2}, and so on`;
  push(
    'medal',
    unbanded
      ? `The first ${medal.size} boats in the ${q} will sail the ${m}. ${score}${rest}.`
      : `The first ${medal.size} boats in the ${topFleet} fleet will sail the ${m}. ${score}${rest}.`,
  );
  // The engine ranks the boats of the deciding stage above every other boat
  // whatever the points say, which is a clause — 2024 ILCA SI 18.7 writes
  // it — and not an arithmetic consequence. It decides the podium wherever
  // a boat outside the deciding fleet finishes on fewer or better scores,
  // so it belongs in the list a scorer checks against their own document:
  // an event whose notice of race is silent on it needs to know that.
  push(
    'medal-ranking',
    `The boats qualified to compete in the ${m} will be ranked highest in the event.`,
  );
  if (medal.carryTransform) {
    push(
      'medal-carry-transform',
      `Before the ${m}, each qualified boat's series score will be divided by 2, rounded to the nearest whole number (0.5 rounded upward), and her scores from the ${m} added to that. If no ${vocab.stages.medal.raceNoun} is completed, her ${vocab.seriesName} score will decide the championship without being divided.`,
    );
  }
  if (medal.tieBreak === 'last-race') {
    // Not a step after A8 but a replacement for it, so the sentence says so
    // rather than reading as an addition.
    push(
      'medal-tie-break',
      `For the boats in the ${m}, a tie will be broken in favour of the boat with the better score in the last race. This changes rule A8.`,
    );
  } else {
    // Ahead of A8, not instead of it: the clause addresses only the boats
    // whose scores in the deciding race differ, and rule A8 still has the
    // rest.
    push(
      'medal-tie-break',
      `A tie between boats with different scores in the ${vocab.stages.medal.raceNoun} will be broken in favour of the boat with the lower score in it. This changes rule A8. Any remaining tie will be broken by rule A8.`,
    );
  }

  return lines;
}
