import { describe, it, expect } from 'vitest';
import type { Competitor, Fleet } from '@/lib/types';
import {
  fleetRatingLabel,
  missingRatings,
  formatMissingRatings,
  requiredForFleetsHint,
  competitorRatings,
  configuredRatingSystems,
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
    club: '',
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
