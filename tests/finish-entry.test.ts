import { describe, it, expect } from 'vitest';
import {
  reorderFinisher,
  reorderWithTies,
  computePositions,
  deriveFinishState,
  deriveNonFinishers,
  finishedCompetitorIds,
  makeFinish,
} from '@/lib/finish-entry';
import type { Competitor } from '@/lib/types';

describe('reorderFinisher', () => {
  const base = ['A', 'B', 'C', 'D'];

  it('moves a competitor up', () => {
    expect(reorderFinisher(base, 'D', 1)).toEqual(['D', 'A', 'B', 'C']);
  });

  it('moves a competitor down', () => {
    expect(reorderFinisher(base, 'A', 4)).toEqual(['B', 'C', 'D', 'A']);
  });

  it('moves to first position', () => {
    expect(reorderFinisher(base, 'C', 1)).toEqual(['C', 'A', 'B', 'D']);
  });

  it('moves to last position', () => {
    expect(reorderFinisher(base, 'B', 4)).toEqual(['A', 'C', 'D', 'B']);
  });

  it('no-op for same position', () => {
    expect(reorderFinisher(base, 'B', 2)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('handles a two-element list', () => {
    expect(reorderFinisher(['A', 'B'], 'B', 1)).toEqual(['B', 'A']);
    expect(reorderFinisher(['A', 'B'], 'A', 2)).toEqual(['B', 'A']);
  });

  it('does not mutate the original array', () => {
    const order = ['A', 'B', 'C'];
    reorderFinisher(order, 'C', 1);
    expect(order).toEqual(['A', 'B', 'C']);
  });
});

describe('reorderWithTies', () => {
  const base = ['A', 'B', 'C', 'D'];

  it('moves a row down by index, preserving untouched ties', () => {
    const { keys, ties } = reorderWithTies(base, new Set(), 0, 2);
    expect(keys).toEqual(['B', 'C', 'A', 'D']);
    expect([...ties]).toEqual([]);
  });

  it('moves a row up by index', () => {
    const { keys } = reorderWithTies(base, new Set(), 3, 0);
    expect(keys).toEqual(['D', 'A', 'B', 'C']);
  });

  it('clears the tie on the moved row', () => {
    // C is tied to B; moving C away drops its tie.
    const { keys, ties } = reorderWithTies(base, new Set(['C']), 2, 0);
    expect(keys).toEqual(['C', 'A', 'B', 'D']);
    expect(ties.has('C')).toBe(false);
  });

  it('drops the follower tie when the moved row was not part of the group', () => {
    // C is tied to B; moving B (untied) out detaches C's anchor.
    const { ties } = reorderWithTies(base, new Set(['C']), 1, 3);
    expect(ties.has('C')).toBe(false);
  });

  it('keeps the follower tie when the moved row continues the group above it', () => {
    // B and C both tied (a 3-way group A·B·C); moving B keeps C tied since the
    // group still continues above C.
    const { ties } = reorderWithTies(base, new Set(['B', 'C']), 1, 3);
    expect(ties.has('C')).toBe(true);
    expect(ties.has('B')).toBe(false); // moved row's own tie cleared
  });

  it('returns the original references on a no-op move', () => {
    const ties = new Set(['C']);
    const same = reorderWithTies(base, ties, 1, 1);
    expect(same.keys).toBe(base);
    expect(same.ties).toBe(ties);
    const oob = reorderWithTies(base, ties, 0, 9);
    expect(oob.keys).toBe(base);
  });

  it('does not mutate the inputs', () => {
    const ties = new Set(['C']);
    reorderWithTies(base, ties, 2, 0);
    expect(base).toEqual(['A', 'B', 'C', 'D']);
    expect([...ties]).toEqual(['C']);
  });
});

describe('computePositions', () => {
  it('returns sequential positions with no ties', () => {
    expect(computePositions(['A', 'B', 'C', 'D'], new Set())).toEqual([1, 2, 3, 4]);
  });

  it('gives tied boat the same position as its predecessor', () => {
    // C tied with B → positions [1, 2, 2, 4]
    expect(computePositions(['A', 'B', 'C', 'D'], new Set(['C']))).toEqual([1, 2, 2, 4]);
  });

  it('handles a tie at position 1', () => {
    // B tied with A → [1, 1, 3, 4]
    expect(computePositions(['A', 'B', 'C', 'D'], new Set(['B']))).toEqual([1, 1, 3, 4]);
  });

  it('handles a three-way tie', () => {
    // B and C both tied with A and each other → [1, 1, 1, 4]
    expect(computePositions(['A', 'B', 'C', 'D'], new Set(['B', 'C']))).toEqual([1, 1, 1, 4]);
  });

  it('handles two separate two-way ties', () => {
    // B tied with A, D tied with C → [1, 1, 3, 3]
    expect(computePositions(['A', 'B', 'C', 'D'], new Set(['B', 'D']))).toEqual([1, 1, 3, 3]);
  });

  it('returns empty array for empty order', () => {
    expect(computePositions([], new Set())).toEqual([]);
  });

  it('returns [1] for a single boat', () => {
    expect(computePositions(['A'], new Set())).toEqual([1]);
  });
});

describe('non-finisher code derivation', () => {
  const competitor = (id: string, sailNumber: string): Competitor => ({
    id,
    seriesId: 's1',
    fleetIds: ['f1'],
    sailNumber,
    name: `Helm ${sailNumber}`,
    club: 'HYC',
    gender: '',
    age: null,
    createdAt: 0,
  });
  const boats = [competitor('c1', '101'), competitor('c2', '202')];

  function nonFinisherCode(finishes: ReturnType<typeof makeFinish>[], competitorId: string) {
    const derived = deriveFinishState(finishes);
    const views = deriveNonFinishers(
      boats,
      finishedCompetitorIds(derived.finishingOrder),
      derived.nonFinisherCodes,
      finishes,
    );
    return views.find((v) => v.competitor.id === competitorId)?.code;
  }

  it('shows implicit DNC for a boat with no finish row', () => {
    expect(nonFinisherCode([], 'c1')).toBe('implicit-dnc');
  });

  it('shows the explicit code for a coded row', () => {
    const finishes = [makeFinish('r1', { id: 'x1', competitorId: 'c1', resultCode: 'RET' })];
    expect(nonFinisherCode(finishes, 'c1')).toBe('RET');
  });

  it('defaults a check-in-only row to DNF', () => {
    const finishes = [makeFinish('r1', { id: 'x1', competitorId: 'c1', startPresent: true })];
    expect(nonFinisherCode(finishes, 'c1')).toBe('DNF');
  });

  it('shows explicit DNC as DNC, not implicit absence', () => {
    const finishes = [makeFinish('r1', { id: 'x1', competitorId: 'c1', resultCode: 'DNC' })];
    expect(nonFinisherCode(finishes, 'c1')).toBe('DNC');
  });

  it('shows explicit DNC on a checked-in boat as DNC, not the check-in DNF default', () => {
    const finishes = [
      makeFinish('r1', { id: 'x1', competitorId: 'c1', resultCode: 'DNC', startPresent: true }),
    ];
    expect(nonFinisherCode(finishes, 'c1')).toBe('DNC');
  });

  it('excludes boats in the finishing order', () => {
    const finishes = [makeFinish('r1', { id: 'x1', competitorId: 'c1', sortOrder: 1, startPresent: true })];
    const derived = deriveFinishState(finishes);
    const views = deriveNonFinishers(
      boats,
      finishedCompetitorIds(derived.finishingOrder),
      derived.nonFinisherCodes,
      finishes,
    );
    expect(views.map((v) => v.competitor.id)).toEqual(['c2']);
  });
});
