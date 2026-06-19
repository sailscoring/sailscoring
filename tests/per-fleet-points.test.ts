import { describe, it, expect } from 'vitest';

import { seedFromFinish, toStorage } from '@/lib/per-fleet-points';

describe('seedFromFinish', () => {
  it('opens uniform from a scalar', () => {
    expect(seedFromFinish(5, null, ['a', 'b'])).toEqual({ mode: 'uniform', value: '5' });
  });

  it('opens uniform and blank when nothing is set', () => {
    expect(seedFromFinish(null, null, ['a'])).toEqual({ mode: 'uniform', value: '' });
  });

  it('opens per-fleet from a populated map, blank where a fleet has no entry', () => {
    expect(seedFromFinish(null, { a: 8, b: 2 }, ['a', 'b'])).toEqual({
      mode: 'perFleet',
      values: { a: '8', b: '2' },
    });
    // 'c' was added to the boat after the map was set → a gap, shown blank.
    expect(seedFromFinish(null, { a: 8 }, ['a', 'b', 'c'])).toEqual({
      mode: 'perFleet',
      values: { a: '8', b: '', c: '' },
    });
  });
});

describe('toStorage', () => {
  it('uniform → scalar, no map', () => {
    expect(toStorage({ mode: 'uniform', value: '5' }, ['a', 'b'])).toEqual({ scalar: 5, byFleet: undefined });
    expect(toStorage({ mode: 'uniform', value: '' }, ['a'])).toEqual({ scalar: null, byFleet: undefined });
  });

  it('differing per-fleet values → a map, no scalar', () => {
    expect(toStorage({ mode: 'perFleet', values: { a: '8', b: '2' } }, ['a', 'b'])).toEqual({
      scalar: null,
      byFleet: { a: 8, b: 2 },
    });
  });

  it('collapses to uniform when every fleet has the same value', () => {
    expect(toStorage({ mode: 'perFleet', values: { a: '5', b: '5' } }, ['a', 'b'])).toEqual({
      scalar: 5,
      byFleet: undefined,
    });
  });

  it('keeps a sparse map when some fleets are blank (deliberate gaps)', () => {
    expect(toStorage({ mode: 'perFleet', values: { a: '8', b: '' } }, ['a', 'b'])).toEqual({
      scalar: null,
      byFleet: { a: 8 },
    });
  });

  it('all-blank per-fleet → nothing stored', () => {
    expect(toStorage({ mode: 'perFleet', values: { a: '', b: '' } }, ['a', 'b'])).toEqual({
      scalar: null,
      byFleet: undefined,
    });
  });
});
