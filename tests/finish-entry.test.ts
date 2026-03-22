import { describe, it, expect } from 'vitest';
import { reorderFinisher } from '@/lib/finish-entry';

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
