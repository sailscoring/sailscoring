import { describe, it, expect } from 'vitest';
import {
  reorderFinisher,
  reorderWithTies,
  computePositions,
  deriveFinishState,
  deriveNonFinishers,
  finishedCompetitorIds,
  makeFinish,
  partitionNonFinishers,
  resolveSailEntry,
} from '@/lib/finish-entry';
import type { Competitor } from '@/lib/types';
import type { NonFinisherCode, NonFinisherView } from '@/lib/finish-entry';

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
    names: [`Helm ${sailNumber}`],
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

describe('resolveSailEntry', () => {
  const competitor = (id: string, sailNumber: string, bowNumber?: string): Competitor => ({
    id,
    seriesId: 's1',
    fleetIds: ['f1'],
    sailNumber,
    ...(bowNumber ? { bowNumber } : {}),
    names: [`Helm ${sailNumber}`],
    club: 'HYC',
    gender: '',
    age: null,
    createdAt: 0,
  });

  it('returns empty for blank input', () => {
    expect(resolveSailEntry('  ', [competitor('a', '101')], new Set()).kind).toBe('empty');
  });

  it('commits an exact, unfinished match', () => {
    const boats = [competitor('a', '101'), competitor('b', '202')];
    const res = resolveSailEntry('101', boats, new Set());
    expect(res).toEqual({ kind: 'commit', competitor: boats[0], matchedOn: 'sail' });
  });

  it('matches case-insensitively and ignores surrounding space', () => {
    const boats = [competitor('a', 'IRL101')];
    const res = resolveSailEntry(' irl101 ', boats, new Set());
    expect(res).toEqual({ kind: 'commit', competitor: boats[0], matchedOn: 'sail' });
  });

  it('reports an exact match already in the finishing order', () => {
    const boats = [competitor('a', '101')];
    expect(resolveSailEntry('101', boats, new Set(['a'])).kind).toBe('already-finished');
  });

  it('reports duplicate sail numbers among unfinished boats', () => {
    const boats = [competitor('a', '101'), competitor('b', '101')];
    expect(resolveSailEntry('101', boats, new Set()).kind).toBe('duplicate-sail');
  });

  it('commits a unique prefix match', () => {
    const boats = [competitor('a', '218456'), competitor('b', '331')];
    const res = resolveSailEntry('218', boats, new Set());
    expect(res).toEqual({ kind: 'commit', competitor: boats[0], matchedOn: 'sail' });
  });

  it('lets an exact match win over a longer boat it is a prefix of', () => {
    const boats = [competitor('a', '7'), competitor('b', '72')];
    const res = resolveSailEntry('7', boats, new Set());
    expect(res).toEqual({ kind: 'commit', competitor: boats[0], matchedOn: 'sail' });
  });

  it('prefix-completes to a registered boat even when the input could be a standalone unknown', () => {
    // The collision the decoupled record-as-unknown path exists for: typing
    // "12" commits 12345, so recording unknown "12" needs its own trigger.
    const boats = [competitor('a', '12345')];
    const res = resolveSailEntry('12', boats, new Set());
    expect(res).toEqual({ kind: 'commit', competitor: boats[0], matchedOn: 'sail' });
  });

  it('defers an ambiguous prefix to the dropdown', () => {
    const boats = [competitor('a', '218456'), competitor('b', '219789')];
    expect(resolveSailEntry('21', boats, new Set()).kind).toBe('ambiguous-prefix');
  });

  it('reports unknown when nothing matches', () => {
    const boats = [competitor('a', '101')];
    expect(resolveSailEntry('999', boats, new Set()).kind).toBe('unknown');
  });

  it('ignores finished boats when prefix matching', () => {
    // 12345 already finished → "12" is no longer a live prefix → unknown.
    const boats = [competitor('a', '12345')];
    expect(resolveSailEntry('12', boats, new Set(['a'])).kind).toBe('unknown');
  });

  // ─── Bow-number matching (#234) ───────────────────────────────────────────

  it('matches on bow number when no sail matches, flagging matchedOn: bow', () => {
    const boats = [competitor('a', '567', '1234'), competitor('b', '890')];
    const res = resolveSailEntry('1234', boats, new Set());
    expect(res).toEqual({ kind: 'commit', competitor: boats[0], matchedOn: 'bow' });
  });

  it('prefers a sail-number match over another boat’s bow number', () => {
    // "1234" is boat b's sail number and boat a's bow number — the sail match
    // wins, so the typed value never silently resolves to the bow-number boat.
    const boats = [competitor('a', '567', '1234'), competitor('b', '1234')];
    const res = resolveSailEntry('1234', boats, new Set());
    expect(res).toEqual({ kind: 'commit', competitor: boats[1], matchedOn: 'sail' });
  });

  it('commits a unique bow-number prefix', () => {
    const boats = [competitor('a', '567', '1234'), competitor('b', '890', '5678')];
    const res = resolveSailEntry('12', boats, new Set());
    expect(res).toEqual({ kind: 'commit', competitor: boats[0], matchedOn: 'bow' });
  });

  it('defers to the dropdown when a bow number is shared by two unfinished boats', () => {
    const boats = [competitor('a', '567', '1234'), competitor('b', '890', '1234')];
    expect(resolveSailEntry('1234', boats, new Set()).kind).toBe('ambiguous-prefix');
  });

  it('matches bow numbers case-insensitively', () => {
    const boats = [competitor('a', '567', 'BOW9')];
    const res = resolveSailEntry(' bow9 ', boats, new Set());
    expect(res).toEqual({ kind: 'commit', competitor: boats[0], matchedOn: 'bow' });
  });

  it('ignores a finished boat’s bow number', () => {
    const boats = [competitor('a', '567', '1234')];
    expect(resolveSailEntry('1234', boats, new Set(['a'])).kind).toBe('unknown');
  });

  it('does not treat an empty bow number as a match for empty-ish input', () => {
    // Boats without a bow number must never collide on a blank/prefix.
    const boats = [competitor('a', '567'), competitor('b', '890')];
    expect(resolveSailEntry('999', boats, new Set()).kind).toBe('unknown');
  });
});

describe('partitionNonFinishers', () => {
  const view = (id: string, code: NonFinisherCode): NonFinisherView => ({
    competitor: {
      id,
      seriesId: 's1',
      fleetIds: ['f1'],
      sailNumber: id,
      names: [`Helm ${id}`],
      club: 'HYC',
      gender: '',
      age: null,
      createdAt: 0,
    },
    code,
  });

  it('sinks auto-DNC and explicit DNC into did-not-compete', () => {
    const { recorded, didNotCompete } = partitionNonFinishers([
      view('a', 'implicit-dnc'),
      view('b', 'DNC'),
    ]);
    expect(recorded).toEqual([]);
    expect(didNotCompete.map((v) => v.competitor.id)).toEqual(['a', 'b']);
  });

  it('keeps real result codes in recorded', () => {
    const codes: NonFinisherCode[] = ['DNF', 'DNS', 'RET', 'OCS', 'DSQ', 'RDG'];
    const { recorded, didNotCompete } = partitionNonFinishers(codes.map((c) => view(c, c)));
    expect(recorded.map((v) => v.code)).toEqual(codes);
    expect(didNotCompete).toEqual([]);
  });

  it('treats a checked-in default DNF as recorded, not did-not-compete', () => {
    const { recorded, didNotCompete } = partitionNonFinishers([view('a', 'DNF')]);
    expect(recorded.map((v) => v.competitor.id)).toEqual(['a']);
    expect(didNotCompete).toEqual([]);
  });

  it('preserves input order within each group', () => {
    const { recorded, didNotCompete } = partitionNonFinishers([
      view('a', 'RET'),
      view('b', 'implicit-dnc'),
      view('c', 'OCS'),
      view('d', 'DNC'),
    ]);
    expect(recorded.map((v) => v.competitor.id)).toEqual(['a', 'c']);
    expect(didNotCompete.map((v) => v.competitor.id)).toEqual(['b', 'd']);
  });
});
