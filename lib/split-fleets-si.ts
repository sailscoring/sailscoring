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

import { resolveVocabulary, stageAdjective } from './split-fleets';
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

/**
 * Which sentence is which, independent of where it lands in the list — the
 * list is not positionally stable, since a medal stage opens with two
 * sentences instead of one, the second equalization clause appears only when
 * chosen, and each carry model writes a different middle.
 *
 * These are the anchors the editor points its settings at. Renaming one is
 * free; the ids are not stored or shared anywhere.
 */
export type SplitFleetSentenceId =
  | 'format'
  | 'series-division'
  | 'fleet-assignment'
  | 'reassignment'
  | 'fleet-equalisation'
  | 'boat-equalisation'
  | 'split'
  | 'totals'
  | 'discards'
  | 'final-discard-cap'
  | 'non-finisher'
  | 'medal'
  | 'medal-carry-transform'
  | 'medal-tie-break';

export type SplitFleetSentence = { id: SplitFleetSentenceId; text: string };

/**
 * Which sentences each of the editor's settings writes, so the editor can
 * mark them when the scorer reaches the field. Kept here beside the sentences
 * themselves: apart, the two drift.
 *
 * A setting that writes no sentence has no entry and marks nothing. Finish
 * sheets is a layout choice and says so; the reassignment tie order settles a
 * case the prose doesn't state; and the format and vocabulary pickers rewrite
 * every sentence, where marking all of them would be noise pretending to be
 * information.
 */
export const SENTENCES_BY_SETTING = {
  fleetCount: ['fleet-assignment', 'split'],
  carry: ['totals', 'discards', 'final-discard-cap'],
  split: ['split'],
  discards: ['discards'],
  finalDiscardCap: ['final-discard-cap'],
  equalization: ['fleet-equalisation', 'boat-equalisation'],
  codeBasis: ['non-finisher'],
  // Turning the medal stage on is what divides the event into a series and
  // then that stage, so it writes the opening sentences too.
  medal: ['format', 'series-division', 'medal'],
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
  if (config.medal) {
    push('format', `The championship will be sailed as ${article(vocab.seriesName)} followed by the ${m}.`);
    push(
      'series-division',
      `The ${vocab.seriesName} will be divided into ${article(q)} and ${article(f)}.`,
    );
  } else {
    push('format', `The championship will be sailed as ${article(q)} followed by ${article(f)}.`);
  }
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
  if (config.equalization === 'exclude-extra-scores') {
    push(
      'boat-equalisation',
      `If at the end of the ${q} some boats have more race scores than others, scores for the most recent races will be excluded so that all boats have the same number of race scores.`,
    );
  }
  push(
    'split',
    config.split.kind === 'fixed-top'
      ? `At the end of the ${q} the first ${config.split.topSize} boats will be assigned to the ${topFleet} fleet on the basis of their ranks, and the remaining boats to the ${config.finalFleets.slice(1).map((f) => f.label).join(' and ') || 'other'} fleet.`
      : `At the end of the ${q} boats will be assigned on the basis of their ranks to the ${finals} fleets, of, as nearly as possible, equal size.`,
  );

  if (config.carry === 'points') {
    // Scoped to the series over stages one and two where a third stage
    // exists: its own total is the medal block's business (2026 ILCA
    // SI 18.6.1 says "in the Qualification series", not "in the event").
    push(
      'totals',
      `The ${q} races and the ${f} races will count for total points in the ${config.medal ? vocab.seriesName : 'championship'}.`,
    );
    push('discards', discardClause(config));
    const cap =
      config.maxFinalDiscards === 0
        ? `No excluded score may come from ${article(`${f} race`)}.`
        : `No more than ${countWord(config.maxFinalDiscards)} excluded score${config.maxFinalDiscards === 1 ? '' : 's'} may come from the ${f}`;
    if (config.maxFinalDiscards === 0) {
      push('final-discard-cap', cap);
    } else {
      push(
        'final-discard-cap',
        config.protectLoneFinalRace
          ? `${cap}, and if only one ${f} race has been completed that score will not be excluded.`
          : `${cap}.`,
      );
    }
  } else if (config.carry === 'net-plus-net') {
    push(
      'totals',
      `A boat’s championship score will be the total of her ${q} score plus her ${f} score.`,
    );
    push(
      'discards',
      `${discardClause(config)} This applies separately to the ${q} and the ${f}.`,
    );
  } else {
    push(
      'totals',
      `The position of each boat in the ${q} will be carried forward to the ${f} as non-excludable points, and her ${q} race scores will not otherwise count.`,
    );
    push(
      'discards',
      `${discardClause(config)} The carried ${qAdj} position may not be excluded.`,
    );
  }

  const qualifyingBase =
    config.codeBasis.qualifying === 'fixed' && config.codeBasis.fixedPoints != null
      ? `${config.codeBasis.fixedPoints} points`
      : `the number of boats in the largest ${qAdj} fleet, plus one`;
  const finalBase =
    config.codeBasis.final === 'largest-qualifying'
      ? `the number of boats in the largest ${qAdj} fleet, plus one`
      : `the number of boats in her own ${vocab.stages.final.fleetNoun}, plus one`;
  push(
    'non-finisher',
    `A boat that does not start, does not finish, retires or is disqualified will be scored ${qualifyingBase} in the ${q}, and ${finalBase} in the ${f}.`,
  );

  if (config.medal) {
    const score =
      config.medal.multiplier === 1
        ? 'A boat’s score there may not be excluded'
        : `A boat’s score there will be multiplied by ${config.medal.multiplier} and may not be excluded`;
    // What the boats who miss the cut sail is part of the same clause in the
    // SIs, and a scorer checking ours against theirs looks for it: one more
    // race of the second stage in their own fleets (2024 ILCA SI 7.4, 2026
    // ILCA SI 7.7), scored below the medal fleet where the SIs say so (2024
    // SI 18.3.4, 2026 SI 18.5.3).
    const rest =
      `; the boats that do not qualify for it will sail one more ${vocab.stages.final.raceNoun} in their own fleets` +
      (config.medal.companionRace === 'scored-below'
        ? `, in which the first ${topFleet} boat will be scored ${config.medal.size + 1} points, the second ${config.medal.size + 2}, and so on`
        : '');
    push(
      'medal',
      `The first ${config.medal.size} boats in the ${topFleet} fleet will sail the ${m}. ${score}${rest}.`,
    );
    const transform = config.medal.carryTransform;
    if (transform) {
      const rounding =
        transform.rounding === 'half-up'
          ? 'rounded to the nearest whole number (0.5 rounded upward)'
          : 'with any fraction discarded';
      push(
        'medal-carry-transform',
        `Before the ${m}, each qualified boat's series score will be divided by ${transform.by}, ${rounding}, and her scores from the ${m} added to that.`,
      );
    }
    if (config.medal.tieBreak === 'stage-rank') {
      push(
        'medal-tie-break',
        `For the boats in the ${m}, ties will be broken applying rule A8. If a tie remains, it will be broken in favour of the boat ranked higher in the ${f}, then in the ${q}.`,
      );
    } else if (config.medal.tieBreak === 'last-race') {
      // Not a step after A8 but a replacement for it, so the sentence says so
      // rather than reading as an addition.
      push(
        'medal-tie-break',
        `For the boats in the ${m}, a tie will be broken in favour of the boat with the better score in the last race. This changes rule A8.`,
      );
    }
  }

  return lines;
}
