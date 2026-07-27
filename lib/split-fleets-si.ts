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
  const qualifying = listLabels(config.qualifyingFleets);
  const finals = listLabels(config.finalFleets);
  const topFleet = config.finalFleets[0]?.label ?? 'the top fleet';

  lines.push(
    'The championship will be sailed as a qualifying series followed by a final series.',
  );
  lines.push(
    `Boats will be assigned to ${countWord(config.qualifyingFleets.length)} qualifying fleets (${qualifying}) of, as nearly as possible, equal size and ability.`,
  );
  lines.push(
    'After each day of racing, boats will be reassigned to the qualifying fleets on the basis of their ranks in the qualifying series.',
  );
  lines.push(
    config.split.kind === 'fixed-top'
      ? `At the end of the qualifying series the first ${config.split.topSize} boats will be assigned to the ${topFleet} fleet on the basis of their ranks, and the remaining boats to the ${config.finalFleets.slice(1).map((f) => f.label).join(' and ') || 'other'} fleet.`
      : `At the end of the qualifying series boats will be assigned on the basis of their ranks to the ${finals} fleets, of, as nearly as possible, equal size.`,
  );

  if (config.carry === 'points') {
    lines.push(
      'The qualifying series races and the final series races will count for total points in the championship.',
    );
    lines.push(discardClause(config));
    if (config.maxFinalDiscards >= 0) {
      lines.push(
        config.maxFinalDiscards === 0
          ? 'No excluded score may come from a final series race.'
          : `No more than ${countWord(config.maxFinalDiscards)} excluded score${config.maxFinalDiscards === 1 ? '' : 's'} may come from the final series.`,
      );
    }
    if (config.protectLoneFinalRace) {
      lines.push(
        'If only one final series race has been completed, that score will not be excluded.',
      );
    }
  } else if (config.carry === 'net-plus-net') {
    lines.push(
      'A boat’s championship score will be the total of her qualifying series score plus her final series score.',
    );
    lines.push(`${discardClause(config)} This applies separately to the qualifying series and the final series.`);
  } else {
    lines.push(
      'The position of each boat in the qualifying series will be carried forward to the final series as non-excludable points, and her qualifying race scores will not otherwise count.',
    );
    lines.push(`${discardClause(config)} The carried qualifying position may not be excluded.`);
  }

  const qualifyingBase =
    config.codeBasis.qualifying === 'fixed' && config.codeBasis.fixedPoints != null
      ? `${config.codeBasis.fixedPoints} points`
      : 'the number of boats in the largest qualifying fleet, plus one';
  const finalBase =
    config.codeBasis.final === 'largest-qualifying'
      ? 'the number of boats in the largest qualifying fleet, plus one'
      : 'the number of boats in her own final series fleet, plus one';
  lines.push(
    `A boat that does not start, does not finish, retires or is disqualified will be scored ${qualifyingBase} in the qualifying series, and ${finalBase} in the final series.`,
  );

  if (config.medal) {
    lines.push(
      `The first ${config.medal.size} boats in the ${topFleet} fleet will sail a medal race. Her medal race score will be multiplied by ${config.medal.multiplier} and may not be excluded; the remaining ${topFleet} boats will sail a final race scored from ${config.medal.size + 1}.`,
    );
  }

  return lines;
}
