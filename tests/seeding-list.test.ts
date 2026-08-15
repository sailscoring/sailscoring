import { describe, expect, it } from 'vitest';

import {
  autoDetectSeedingColumn,
  normalizePersonName,
  planSeedingImport,
  type SeedingCandidate,
  type SeedingListRow,
} from '@/lib/seeding-list';

function row(rowNumber: number, rank: number, extra: Partial<SeedingListRow> = {}): SeedingListRow {
  return { rowNumber, rank, ...extra };
}

const ENTRIES: SeedingCandidate[] = [
  { id: 'a', worldSailingId: 'IRLMM1', names: ['Mark McLoughlin'], nationality: 'IRL' },
  { id: 'b', worldSailingId: 'GBRHM15', names: ['Hannah Mills'], nationality: 'GBR' },
  { id: 'c', names: ['Séamus Ó Briain'], nationality: 'IRL' },
];

describe('planSeedingImport', () => {
  it('joins on the Sailor ID and keeps the ranking’s own numbers', () => {
    const plan = planSeedingImport(
      [row(1, 3, { worldSailingId: 'IRLMM1' }), row(2, 240, { worldSailingId: 'gbrhm15' })],
      ENTRIES,
    );
    expect(plan.matched.map((m) => [m.competitorId, m.row.rank])).toEqual([
      ['a', 3],
      ['b', 240],
    ]);
    // Global ranks are preserved rather than densified to 1..n.
    expect(plan.matched.every((m) => m.basis === 'world-sailing-id')).toBe(true);
  });

  it('suggests a sailor the ranking spells differently', () => {
    // The ranking's spelling, the entry list's spelling — same sailor.
    const entries: SeedingCandidate[] = [
      { id: 'z', names: ['Zachary Littlewood'], nationality: 'AUS' },
      { id: 'g', names: ['Philipp Grochtmann'], nationality: 'BRA' },
    ];
    const plan = planSeedingImport(
      [
        row(1, 4, { name: 'Zac Littlewood', nationality: 'AUS' }),
        row(2, 9, { name: 'Philipp Andreas Grochtmann', nationality: 'BRA' }),
      ],
      entries,
    );
    expect(plan.suggested.map((m) => m.competitorId)).toEqual(['z', 'g']);
    expect(plan.unmatchedRows).toEqual([]);
  });

  it('will not guess between two sailors a loose name reaches', () => {
    const brothers: SeedingCandidate[] = [
      { id: 'a', names: ['Chris Murphy'], nationality: 'IRL' },
      { id: 'b', names: ['Christopher Murphy'], nationality: 'IRL' },
    ];
    const plan = planSeedingImport([row(1, 1, { name: 'Christo Murphy', nationality: 'IRL' })], brothers);
    expect(plan.suggested).toEqual([]);
    expect(plan.unmatchedRows).toHaveLength(1);
  });

  it('gives one competitor to one row, however many rows reach them', () => {
    const entries: SeedingCandidate[] = [
      { id: 'z', names: ['Zachary Littlewood'], nationality: 'AUS' },
    ];
    const plan = planSeedingImport(
      [
        row(1, 4, { name: 'Zac Littlewood', nationality: 'AUS' }),
        row(2, 5, { name: 'Zachary Littlewood', nationality: 'AUS' }),
      ],
      entries,
    );
    expect(plan.suggested).toHaveLength(1);
    expect(plan.unmatchedRows).toHaveLength(1);
  });

  it('reports competitors the ranking never reached', () => {
    const plan = planSeedingImport([row(1, 3, { worldSailingId: 'IRLMM1' })], ENTRIES);
    expect(plan.unrankedCompetitorIds).toEqual(['b', 'c']);
  });

  it('reports ranking rows that match nobody without treating them as errors', () => {
    // The ranking covers a class; the entry list covers an event.
    const plan = planSeedingImport(
      [row(1, 1, { worldSailingId: 'AUSTB3', name: 'Tom Burton', nationality: 'AUS' })],
      ENTRIES,
    );
    expect(plan.matched).toEqual([]);
    expect(plan.unmatchedRows.map((r) => r.rowNumber)).toEqual([1]);
    expect(plan.rejected).toEqual([]);
  });

  it('offers a name-and-nation match as a suggestion, never as a match', () => {
    const plan = planSeedingImport(
      [row(1, 7, { name: 'Ó Briain, Séamus', nationality: 'IRL' })],
      ENTRIES,
    );
    expect(plan.matched).toEqual([]);
    expect(plan.suggested).toEqual([
      { row: expect.objectContaining({ rank: 7 }), competitorId: 'c', basis: 'name-and-nation' },
    ]);
  });

  it('leaves an ambiguous name unmatched rather than guessing', () => {
    const twins: SeedingCandidate[] = [
      { id: 'x', names: ['John Murphy'], nationality: 'IRL' },
      { id: 'y', names: ['John Murphy'], nationality: 'IRL' },
    ];
    const plan = planSeedingImport([row(1, 1, { name: 'John Murphy', nationality: 'IRL' })], twins);
    expect(plan.suggested).toEqual([]);
    expect(plan.unmatchedRows).toHaveLength(1);
  });

  it('never lets a name match steal a competitor an ID match claimed', () => {
    // The name row comes first in the document; the ID row still wins.
    const plan = planSeedingImport(
      [
        row(1, 1, { name: 'Hannah Mills', nationality: 'GBR' }),
        row(2, 2, { worldSailingId: 'GBRHM15' }),
      ],
      ENTRIES,
    );
    expect(plan.matched).toEqual([
      { row: expect.objectContaining({ rank: 2 }), competitorId: 'b', basis: 'world-sailing-id' },
    ]);
    expect(plan.suggested).toEqual([]);
    expect(plan.unmatchedRows.map((r) => r.rank)).toEqual([1]);
  });

  it('rejects a repeated rank rather than breaking the assignment pattern', () => {
    // Two boats on the same seed would break the alternation the reassignment
    // pattern walks; a repeated rank is nearly always a mis-mapped column.
    const plan = planSeedingImport(
      [row(1, 5, { worldSailingId: 'IRLMM1' }), row(2, 5, { worldSailingId: 'GBRHM15' })],
      ENTRIES,
    );
    expect(plan.matched.map((m) => m.competitorId)).toEqual(['a']);
    expect(plan.rejected).toEqual([
      { row: expect.objectContaining({ rowNumber: 2 }), reason: 'rank 5 appears more than once' },
    ]);
  });

  it('rejects a row with no usable rank', () => {
    const plan = planSeedingImport([row(1, 0, { worldSailingId: 'IRLMM1' })], ENTRIES);
    expect(plan.matched).toEqual([]);
    expect(plan.rejected[0].reason).toBe('no usable rank');
  });

  it('refuses to guess when one Sailor ID is on two entries', () => {
    const dupes: SeedingCandidate[] = [
      { id: 'p', worldSailingId: 'IRLMM1', names: ['Mark McLoughlin'] },
      { id: 'q', worldSailingId: 'IRLMM1', names: ['Mark McLoughlin'] },
    ];
    const plan = planSeedingImport([row(1, 1, { worldSailingId: 'IRLMM1' })], dupes);
    expect(plan.matched).toEqual([]);
    expect(plan.rejected[0].reason).toContain('more than one entry');
  });
});

describe('normalizePersonName', () => {
  it('folds accents, case, punctuation, and name order', () => {
    expect(normalizePersonName('Séamus Ó Briain')).toBe(normalizePersonName('O Briain, Seamus'));
    expect(normalizePersonName('Mills, Hannah')).toBe(normalizePersonName('Hannah Mills'));
  });

  it('is empty for a blank name so nothing matches on it', () => {
    expect(normalizePersonName('   ')).toBe('');
    expect(normalizePersonName(undefined)).toBe('');
  });
});

describe('autoDetectSeedingColumn', () => {
  it('reads the columns a published ranking uses', () => {
    expect(autoDetectSeedingColumn('Rank')).toBe('rank');
    expect(autoDetectSeedingColumn('Position')).toBe('rank');
    expect(autoDetectSeedingColumn('Seeding')).toBe('rank');
    expect(autoDetectSeedingColumn('World Sailing ID')).toBe('worldSailingId');
    expect(autoDetectSeedingColumn('Sailor')).toBe('name');
    expect(autoDetectSeedingColumn('Competitor Name')).toBe('name');
    expect(autoDetectSeedingColumn('NOC')).toBe('nationality');
    expect(autoDetectSeedingColumn('Points')).toBe('ignore');
  });
});
