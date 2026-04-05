import { describe, it, expect } from 'vitest';
import { reorderFinisher, computePositions } from '@/lib/finish-entry';

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
