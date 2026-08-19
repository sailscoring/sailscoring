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

import { DEFAULT_STAGE_NAMING } from './split-fleets';
import type { SplitFleetConfig } from './split-fleets';

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];

function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
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
 * The configuration as a numbered set of sailing-instruction sentences, in
 * the order an SI's scoring section usually runs: format, fleets,
 * reassignment, split, how the series totals, discards, non-finisher scores,
 * medal race.
 */
export function describeSplitFleetConfig(config: SplitFleetConfig): string[] {
  const lines: string[] = [];
  // The stages by the names the sailing instructions give them: an SI
  // translation that used our words for them would not be one.
  const naming = config.stageNaming ?? DEFAULT_STAGE_NAMING;
  const lower = (label: string) => label.charAt(0).toLowerCase() + label.slice(1);
  const q = lower(naming.labels.qualifying);
  const f = lower(naming.labels.final);
  const m = lower(naming.labels.medal);
  // "the qualifying series" -> "a qualifying fleet": the stage name works as
  // an adjective once its trailing "series" is dropped.
  const qAdj = q.replace(/\s+series$/i, '');
  const qualifying = listLabels(config.qualifyingFleets);
  const finals = listLabels(config.finalFleets);
  const topFleet = config.finalFleets[0]?.label ?? 'the top fleet';

  lines.push(
    `The championship will be sailed as a ${q} followed by a ${f}.`,
  );
  if (config.minimumRaces > 0) {
    lines.push(
      `A minimum of ${countWord(config.minimumRaces)} races is required to be completed to constitute the championship.`,
    );
  }
  lines.push(
    `Boats will be assigned to ${countWord(config.qualifyingFleets.length)} ${qAdj} fleets (${qualifying}) of, as nearly as possible, equal size and ability.`,
  );
  lines.push(
    `After each day of racing, boats will be reassigned to the ${qAdj} fleets on the basis of their ranks in the ${q}.`,
  );
  lines.push(
    `If at the end of the ${q} some ${qAdj} fleets have more race scores than others, the extra races will be abandoned and cancelled so that all fleets have the same number of race scores.`,
  );
  if (config.equalization === 'exclude-extra-scores') {
    lines.push(
      `If at the end of the ${q} some boats have more race scores than others, scores for the most recent races will be excluded so that all boats have the same number of race scores.`,
    );
  }
  lines.push(
    config.split.kind === 'fixed-top'
      ? `At the end of the ${q} the first ${config.split.topSize} boats will be assigned to the ${topFleet} fleet on the basis of their ranks, and the remaining boats to the ${config.finalFleets.slice(1).map((f) => f.label).join(' and ') || 'other'} fleet.`
      : `At the end of the ${q} boats will be assigned on the basis of their ranks to the ${finals} fleets, of, as nearly as possible, equal size.`,
  );

  if (config.carry === 'points') {
    lines.push(
      `The ${q} races and the ${f} races will count for total points in the championship.`,
    );
    lines.push(discardClause(config));
    if (config.maxFinalDiscards >= 0) {
      lines.push(
        config.maxFinalDiscards === 0
          ? `No excluded score may come from a ${f} race.`
          : `No more than ${countWord(config.maxFinalDiscards)} excluded score${config.maxFinalDiscards === 1 ? '' : 's'} may come from the ${f}.`,
      );
    }
    if (config.protectLoneFinalRace) {
      lines.push(
        `If only one ${f} race has been completed, that score will not be excluded.`,
      );
    }
  } else if (config.carry === 'net-plus-net') {
    lines.push(
      `A boat’s championship score will be the total of her ${q} score plus her ${f} score.`,
    );
    lines.push(`${discardClause(config)} This applies separately to the ${q} and the ${f}.`);
  } else {
    lines.push(
      `The position of each boat in the ${q} will be carried forward to the ${f} as non-excludable points, and her ${q} race scores will not otherwise count.`,
    );
    lines.push(`${discardClause(config)} The carried ${qAdj} position may not be excluded.`);
  }

  const qualifyingBase =
    config.codeBasis.qualifying === 'fixed' && config.codeBasis.fixedPoints != null
      ? `${config.codeBasis.fixedPoints} points`
      : `the number of boats in the largest ${qAdj} fleet, plus one`;
  const finalBase =
    config.codeBasis.final === 'largest-qualifying'
      ? `the number of boats in the largest ${qAdj} fleet, plus one`
      : `the number of boats in her own ${f} fleet, plus one`;
  lines.push(
    `A boat that does not start, does not finish, retires or is disqualified will be scored ${qualifyingBase} in the ${q}, and ${finalBase} in the ${f}.`,
  );

  if (config.medal) {
    const score =
      config.medal.multiplier === 1
        ? 'Her score there may not be excluded'
        : `Her score there will be multiplied by ${config.medal.multiplier} and may not be excluded`;
    lines.push(
      `The first ${config.medal.size} boats in the ${topFleet} fleet will sail the ${m}. ${score}; the remaining ${topFleet} boats will sail one more race, scored from ${config.medal.size + 1}.`,
    );
    const transform = config.medal.carryTransform;
    if (transform) {
      const rounding =
        transform.rounding === 'half-up'
          ? 'rounded to the nearest whole number (0.5 rounded upward)'
          : 'with any fraction discarded';
      lines.push(
        `Before the ${m}, each qualified boat's series score will be divided by ${transform.by}, ${rounding}, and her scores from the ${m} added to that.`,
      );
    }
    if (config.medal.tieBreak === 'stage-rank') {
      lines.push(
        `For the boats in the ${m}, ties will be broken applying rule A8. If a tie remains, it will be broken in favour of the boat ranked higher in the ${f}, then in the ${q}.`,
      );
    }
  }

  return lines;
}
