import { describe, it, expect } from 'vitest';
import type { Competitor, Fleet } from '@/lib/types';
import {
  fleetRatingLabel,
  missingRatings,
  formatMissingRatings,
  requiredForFleetsHint,
  competitorRatings,
  ratingSystemLabel,
  ratingUnitLabel,
  configuredRatingSystems,
  formatRatingValue,
  ratingGaps,
} from '@/lib/competitor-ratings';

function mkFleet(over: Partial<Fleet> & { id: string; name: string; scoringSystem: Fleet['scoringSystem'] }): Fleet {
  return {
    seriesId: 's1',
    displayOrder: 0,
    ...over,
  };
}

function mkCompetitor(over: Partial<Competitor> & { id: string; fleetIds: string[] }): Competitor {
  return {
    seriesId: 's1',
    sailNumber: '1',
    names: ['Helm'],
    clubs: [],
    gender: '',
    age: null,
    createdAt: 0,
    ...over,
  };
}

function fleetMap(fleets: Fleet[]): Map<string, Fleet> {
  return new Map(fleets.map((f) => [f.id, f]));
}

describe('fleetRatingLabel', () => {
  it('names each handicap rating', () => {
    expect(fleetRatingLabel(mkFleet({ id: 'a', name: 'A', scoringSystem: 'irc' }))).toBe('IRC TCC');
    expect(fleetRatingLabel(mkFleet({ id: 'b', name: 'B', scoringSystem: 'py' }))).toBe('PY number');
    expect(fleetRatingLabel(mkFleet({ id: 'c', name: 'C', scoringSystem: 'nhc' }))).toBe('NHC starting TCF');
  });

  it('returns null for scratch fleets (no rating required)', () => {
    expect(fleetRatingLabel(mkFleet({ id: 'd', name: 'D', scoringSystem: 'scratch' }))).toBeNull();
  });

  it('asks for a fixed TCF by the club name for it', () => {
    const hph = mkFleet({ id: 'e', name: 'Class 1 HPH', scoringSystem: 'tcf', ratingLabel: 'HPH' });
    expect(fleetRatingLabel(hph)).toBe('HPH');
  });

  it('falls back to the generic word when the club has named nothing', () => {
    const unnamed = mkFleet({ id: 'f', name: 'Class 1', scoringSystem: 'tcf' });
    expect(fleetRatingLabel(unnamed)).toBe('TCF');
    expect(ratingSystemLabel(unnamed)).toBe('TCF');
    expect(ratingUnitLabel(unnamed)).toBe('TCF');
  });

  it('treats a blank label as unnamed rather than heading a column with nothing', () => {
    const blank = mkFleet({ id: 'g', name: 'Class 1', scoringSystem: 'tcf', ratingLabel: '  ' });
    expect(ratingUnitLabel(blank)).toBe('TCF');
  });
});

describe('missingRatings', () => {
  const irc = mkFleet({ id: 'irc', name: 'Cruisers', scoringSystem: 'irc' });
  const py = mkFleet({ id: 'py', name: 'Whitesails', scoringSystem: 'py' });
  const nhc = mkFleet({ id: 'nhc', name: 'Echo', scoringSystem: 'nhc' });
  const scratch = mkFleet({ id: 's', name: 'OD', scoringSystem: 'scratch' });

  it('flags a single missing IRC rating', () => {
    const c = mkCompetitor({ id: 'c1', fleetIds: ['irc'] });
    const result = missingRatings(c, fleetMap([irc]));
    expect(result).toEqual([{ fleetName: 'Cruisers', ratingLabel: 'IRC TCC' }]);
  });

  it('does not flag when the IRC rating is set', () => {
    const c = mkCompetitor({ id: 'c1', fleetIds: ['irc'], ircTcc: 0.972 });
    expect(missingRatings(c, fleetMap([irc]))).toEqual([]);
  });

  it('flags only the missing rating when competitor is in multiple fleets', () => {
    const c = mkCompetitor({ id: 'c1', fleetIds: ['irc', 'py'], ircTcc: 0.972 });
    const result = missingRatings(c, fleetMap([irc, py]));
    expect(result).toEqual([{ fleetName: 'Whitesails', ratingLabel: 'PY number' }]);
  });

  it('never flags scratch fleets', () => {
    const c = mkCompetitor({ id: 'c1', fleetIds: ['s'] });
    expect(missingRatings(c, fleetMap([scratch]))).toEqual([]);
  });

  it('uses nhcStartingTcf for NHC fleets', () => {
    const missing = mkCompetitor({ id: 'c1', fleetIds: ['nhc'] });
    const set = mkCompetitor({ id: 'c2', fleetIds: ['nhc'], nhcStartingTcf: 1.005 });
    expect(missingRatings(missing, fleetMap([nhc]))).toEqual([
      { fleetName: 'Echo', ratingLabel: 'NHC starting TCF' },
    ]);
    expect(missingRatings(set, fleetMap([nhc]))).toEqual([]);
  });

  it('skips fleet ids that do not resolve (stale reference)', () => {
    const c = mkCompetitor({ id: 'c1', fleetIds: ['ghost'] });
    expect(missingRatings(c, fleetMap([irc]))).toEqual([]);
  });
});

describe('formatMissingRatings', () => {
  it('returns an empty string when nothing is missing', () => {
    expect(formatMissingRatings([])).toBe('');
  });

  it('names the rating and fleet for a single missing entry', () => {
    expect(
      formatMissingRatings([{ fleetName: 'Cruisers', ratingLabel: 'IRC TCC' }]),
    ).toBe('Missing IRC TCC for Cruisers fleet');
  });

  it('joins multiple missing entries', () => {
    expect(
      formatMissingRatings([
        { fleetName: 'Cruisers', ratingLabel: 'IRC TCC' },
        { fleetName: 'Echo', ratingLabel: 'NHC starting TCF' },
      ]),
    ).toBe('Missing: IRC TCC (Cruisers), NHC starting TCF (Echo)');
  });
});

describe('formatRatingValue', () => {
  it('pads the multiplier ratings to three decimals', () => {
    expect(formatRatingValue(1.13, 'irc')).toBe('1.130');
    expect(formatRatingValue(1, 'vprs')).toBe('1.000');
    expect(formatRatingValue(0.9725, 'nhc')).toBe('0.973');
    expect(formatRatingValue(1.02, 'echo')).toBe('1.020');
  });

  it('leaves PY numbers whole', () => {
    expect(formatRatingValue(1034, 'py')).toBe('1034');
  });

  it('keeps a genuinely fractional PY number but drops float noise', () => {
    expect(formatRatingValue(1034.5, 'py')).toBe('1034.5');
    expect(formatRatingValue(4.899999999999977, 'py')).toBe('4.9');
  });

  it('shows an em dash for a missing rating', () => {
    expect(formatRatingValue(null, 'irc')).toBe('—');
    expect(formatRatingValue(undefined, 'py')).toBe('—');
  });
});

describe('competitorRatings', () => {
  const irc = mkFleet({ id: 'irc', name: 'Cruisers', scoringSystem: 'irc' });
  const py = mkFleet({ id: 'py', name: 'Whitesails', scoringSystem: 'py' });
  const nhc = mkFleet({ id: 'nhc', name: 'NHC', scoringSystem: 'nhc' });
  const echo = mkFleet({ id: 'echo', name: 'ECHO', scoringSystem: 'echo' });
  const scratch = mkFleet({ id: 's', name: 'OD', scoringSystem: 'scratch' });

  it('returns the rating value for a single-fleet competitor', () => {
    const c = mkCompetitor({ id: 'c1', fleetIds: ['irc'], ircTcc: 0.972 });
    expect(competitorRatings(c, fleetMap([irc]))).toEqual([
      { system: 'irc', label: 'IRC', value: '0.972' },
    ]);
  });

  it('pads a rating whose stored value has fewer decimals', () => {
    const c = mkCompetitor({ id: 'c1', fleetIds: ['irc'], ircTcc: 1.13 });
    expect(competitorRatings(c, fleetMap([irc]))).toEqual([
      { system: 'irc', label: 'IRC', value: '1.130' },
    ]);
  });

  it('labels a fixed-TCF rating with the club name for it', () => {
    const hph = mkFleet({ id: 'hph', name: 'Class 1 HPH', scoringSystem: 'tcf', ratingLabel: 'HPH' });
    const c = mkCompetitor({ id: 'c1', fleetIds: ['hph'], fixedTcf: 0.865 });
    expect(competitorRatings(c, fleetMap([hph]))).toEqual([
      { system: 'tcf', label: 'HPH', value: '0.865' },
    ]);
  });

  it('shows em-dash placeholder when the rating is missing', () => {
    const c = mkCompetitor({ id: 'c1', fleetIds: ['py'] });
    expect(competitorRatings(c, fleetMap([py]))).toEqual([
      { system: 'py', label: 'PY', value: '—' },
    ]);
  });

  it('returns one entry per distinct system across multiple fleets', () => {
    const c = mkCompetitor({
      id: 'c1',
      fleetIds: ['irc', 'echo'],
      ircTcc: 0.972,
      echoStartingTcf: 1.018,
    });
    expect(competitorRatings(c, fleetMap([irc, echo]))).toEqual([
      { system: 'irc', label: 'IRC', value: '0.972' },
      { system: 'echo', label: 'ECHO', value: '1.018' },
    ]);
  });

  it('skips scratch fleets', () => {
    const c = mkCompetitor({ id: 'c1', fleetIds: ['s', 'py'], pyNumber: 1034 });
    expect(competitorRatings(c, fleetMap([scratch, py]))).toEqual([
      { system: 'py', label: 'PY', value: '1034' },
    ]);
  });

  it('returns an empty list when no fleets contribute a rating', () => {
    const c = mkCompetitor({ id: 'c1', fleetIds: ['s'] });
    expect(competitorRatings(c, fleetMap([scratch]))).toEqual([]);
  });

  it('uses NHC starting TCF for NHC fleets', () => {
    const c = mkCompetitor({ id: 'c1', fleetIds: ['nhc'], nhcStartingTcf: 1.005 });
    expect(competitorRatings(c, fleetMap([nhc]))).toEqual([
      { system: 'nhc', label: 'NHC', value: '1.005' },
    ]);
  });
});

describe('configuredRatingSystems', () => {
  const irc = mkFleet({ id: 'irc', name: 'Cruisers', scoringSystem: 'irc' });
  const echo = mkFleet({ id: 'echo', name: 'ECHO', scoringSystem: 'echo' });
  const echo2 = mkFleet({ id: 'echo2', name: 'ECHO 2', scoringSystem: 'echo' });
  const scratch = mkFleet({ id: 's', name: 'OD', scoringSystem: 'scratch' });

  it('returns distinct non-scratch systems in fleet order', () => {
    expect(configuredRatingSystems([scratch, echo, irc, echo2])).toEqual(['echo', 'irc']);
  });

  it('returns an empty list when only scratch fleets exist', () => {
    expect(configuredRatingSystems([scratch])).toEqual([]);
  });
});

describe('requiredForFleetsHint', () => {
  it('singular fleet', () => {
    expect(requiredForFleetsHint(['Cruisers'])).toBe('Required for Cruisers fleet.');
  });

  it('plural fleets', () => {
    expect(requiredForFleetsHint(['Cruisers', 'ECHO'])).toBe('Required for Cruisers, ECHO fleets.');
  });

  it('empty list produces empty string', () => {
    expect(requiredForFleetsHint([])).toBe('');
  });
});


describe('ratingGaps', () => {
  const scratch = mkFleet({ id: 'sc', name: 'Cruisers 1', scoringSystem: 'scratch' });
  const irc = mkFleet({ id: 'irc', name: 'Cruisers 1 (IRC)', scoringSystem: 'irc' });
  const nhc = mkFleet({ id: 'nhc', name: 'Cruisers 1 (NHC)', scoringSystem: 'nhc' });

  it('reports the unrated boats in a rated fleet', () => {
    const gaps = ratingGaps(
      [
        mkCompetitor({ id: 'a', fleetIds: ['sc', 'irc'], ircTcc: 1.02 }),
        mkCompetitor({ id: 'b', fleetIds: ['sc', 'irc'] }),
        mkCompetitor({ id: 'c', fleetIds: ['sc', 'irc'] }),
      ],
      [scratch, irc],
    );
    expect(gaps).toEqual([
      {
        system: 'irc',
        ratingLabel: 'IRC TCC',
        fleets: [{ id: 'irc', name: 'Cruisers 1 (IRC)' }],
        missing: 2,
        total: 3,
      },
    ]);
  });

  it('says nothing about a fleet everybody is rated for', () => {
    const gaps = ratingGaps(
      [mkCompetitor({ id: 'a', fleetIds: ['irc'], ircTcc: 1.02 })],
      [scratch, irc],
    );
    expect(gaps).toEqual([]);
  });

  it('ignores scratch fleets and boats outside the rated fleet', () => {
    const gaps = ratingGaps(
      [
        mkCompetitor({ id: 'a', fleetIds: ['sc'] }),
        mkCompetitor({ id: 'b', fleetIds: ['irc'], ircTcc: 1.02 }),
      ],
      [scratch, irc],
    );
    expect(gaps).toEqual([]);
  });

  it('leaves excluded boats out — a non-entrant needs no rating', () => {
    const gaps = ratingGaps(
      [
        mkCompetitor({ id: 'a', fleetIds: ['irc'], ircTcc: 1.02 }),
        mkCompetitor({ id: 'b', fleetIds: ['irc'], excluded: true }),
      ],
      [irc],
    );
    expect(gaps).toEqual([]);
  });

  it('has nothing to offer for NHC, which no list publishes', () => {
    const gaps = ratingGaps([mkCompetitor({ id: 'a', fleetIds: ['nhc'] })], [nhc]);
    expect(gaps).toEqual([]);
  });

  it('counts a boat in two fleets of one system once', () => {
    const irc2 = mkFleet({ id: 'irc2', name: 'Cruisers 2 (IRC)', scoringSystem: 'irc' });
    const gaps = ratingGaps(
      [mkCompetitor({ id: 'a', fleetIds: ['irc', 'irc2'] })],
      [irc, irc2],
    );
    expect(gaps).toEqual([
      {
        system: 'irc',
        ratingLabel: 'IRC TCC',
        fleets: [
          { id: 'irc', name: 'Cruisers 1 (IRC)' },
          { id: 'irc2', name: 'Cruisers 2 (IRC)' },
        ],
        missing: 1,
        total: 1,
      },
    ]);
  });

  it('reports each system separately, in source-list order', () => {
    const echo = mkFleet({ id: 'echo', name: 'Cruisers 1 (ECHO)', scoringSystem: 'echo' });
    const gaps = ratingGaps(
      [mkCompetitor({ id: 'a', fleetIds: ['irc', 'echo'] })],
      [echo, irc],
    );
    expect(gaps.map((g) => g.system)).toEqual(['irc', 'echo']);
  });
});
