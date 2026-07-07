import { describe, it, expect } from 'vitest';
import {
  matchLikelySameBoat,
  normalizeIdentity,
  type MatchEntry,
} from '@/lib/competitor-matching';

function entry(
  item: string,
  fields: Partial<Omit<MatchEntry<string>, 'item'>> = {},
): MatchEntry<string> {
  return { item, fleetKey: 'F', boatName: '', name: '', helm: '', ...fields };
}

describe('normalizeIdentity', () => {
  it('trims, collapses whitespace, and case-folds', () => {
    expect(normalizeIdentity('  White   Mischief ')).toBe('white mischief');
    expect(normalizeIdentity('WHITE MISCHIEF')).toBe('white mischief');
  });

  it('normalises empty and undefined to the empty string', () => {
    expect(normalizeIdentity(undefined)).toBe('');
    expect(normalizeIdentity('   ')).toBe('');
  });
});

describe('matchLikelySameBoat', () => {
  it('pairs on matching boat name within the same fleet', () => {
    const pairs = matchLikelySameBoat(
      [entry('row1', { boatName: 'White Mischief' })],
      [entry('comp1', { boatName: 'white mischief' })],
    );
    expect(pairs).toEqual([{ a: 'row1', b: 'comp1', matchedOn: 'boat name' }]);
  });

  it('pairs on matching primary name', () => {
    const pairs = matchLikelySameBoat(
      [entry('row1', { name: 'J. Bloggs' })],
      [entry('comp1', { name: 'j. bloggs' })],
    );
    expect(pairs).toEqual([{ a: 'row1', b: 'comp1', matchedOn: 'name' }]);
  });

  it('pairs when a person moves between the primary and helm columns', () => {
    const pairs = matchLikelySameBoat(
      [entry('row1', { name: 'A. Owner', helm: 'J. Bloggs' })],
      [entry('comp1', { name: 'J. Bloggs' })],
    );
    expect(pairs).toHaveLength(1);
  });

  it('never pairs across different fleet sets', () => {
    const pairs = matchLikelySameBoat(
      [entry('row1', { fleetKey: 'A', boatName: 'White Mischief' })],
      [entry('comp1', { fleetKey: 'B', boatName: 'White Mischief' })],
    );
    expect(pairs).toEqual([]);
  });

  it('never pairs on empty identity fields', () => {
    const pairs = matchLikelySameBoat(
      [entry('row1'), entry('row2', { boatName: '  ' })],
      [entry('comp1'), entry('comp2')],
    );
    expect(pairs).toEqual([]);
  });

  it('drops ambiguous pairings — two rows claiming one competitor', () => {
    const pairs = matchLikelySameBoat(
      [
        entry('row1', { boatName: 'White Mischief' }),
        entry('row2', { boatName: 'White Mischief' }),
      ],
      [entry('comp1', { boatName: 'White Mischief' })],
    );
    expect(pairs).toEqual([]);
  });

  it('drops ambiguous pairings — one row matching two competitors', () => {
    const pairs = matchLikelySameBoat(
      [entry('row1', { name: 'J. Bloggs' })],
      [
        entry('comp1', { name: 'J. Bloggs' }),
        entry('comp2', { helm: 'J. Bloggs' }),
      ],
    );
    expect(pairs).toEqual([]);
  });

  it('an ambiguous entry does not poison an unrelated unique pair', () => {
    const pairs = matchLikelySameBoat(
      [
        entry('row1', { boatName: 'White Mischief' }),
        entry('row2', { boatName: 'White Mischief' }),
        entry('row3', { boatName: 'Sea Biscuit' }),
      ],
      [
        entry('comp1', { boatName: 'White Mischief' }),
        entry('comp3', { boatName: 'Sea Biscuit' }),
      ],
    );
    expect(pairs).toEqual([{ a: 'row3', b: 'comp3', matchedOn: 'boat name' }]);
  });

  it('a boat-name match and a person match to different partners is ambiguous', () => {
    // row1's boat name matches comp1 but its helm matches comp2 — two edges
    // from row1, so neither pairing survives.
    const pairs = matchLikelySameBoat(
      [entry('row1', { boatName: 'White Mischief', helm: 'J. Bloggs' })],
      [
        entry('comp1', { boatName: 'White Mischief' }),
        entry('comp2', { name: 'J. Bloggs' }),
      ],
    );
    expect(pairs).toEqual([]);
  });
});
