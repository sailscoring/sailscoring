import { describe, it, expect } from 'vitest';
import {
  MAX_SORT_KEYS,
  comparatorFor,
  compareNumeric,
  compareText,
  sortDirectionFor,
  sortPositionFor,
  toggleSortKey,
  type SortKey,
} from '@/lib/table-sort';

describe('toggleSortKey', () => {
  it('sorts ascending on a first plain click', () => {
    expect(toggleSortKey([], 'club', false)).toEqual([{ columnId: 'club', dir: 'asc' }]);
  });

  it('reverses on a second click and clears on a third', () => {
    const asc = toggleSortKey([], 'club', false);
    const desc = toggleSortKey(asc, 'club', false);
    expect(desc).toEqual([{ columnId: 'club', dir: 'desc' }]);
    expect(toggleSortKey(desc, 'club', false)).toEqual([]);
  });

  it('replaces the whole stack on a plain click', () => {
    const stack: SortKey[] = [
      { columnId: 'nationality', dir: 'asc' },
      { columnId: 'club', dir: 'desc' },
    ];
    expect(toggleSortKey(stack, 'age', false)).toEqual([{ columnId: 'age', dir: 'asc' }]);
  });

  it('does not clear a multi-key stack when clicking one of its columns', () => {
    // The third-click-clears shortcut only applies to a lone key; here the
    // click means "sort by this one instead".
    const stack: SortKey[] = [
      { columnId: 'nationality', dir: 'desc' },
      { columnId: 'club', dir: 'asc' },
    ];
    expect(toggleSortKey(stack, 'nationality', false)).toEqual([
      { columnId: 'nationality', dir: 'asc' },
    ]);
  });

  it('appends with an additive click', () => {
    let keys = toggleSortKey([], 'nationality', false);
    keys = toggleSortKey(keys, 'gender', true);
    keys = toggleSortKey(keys, 'sailNumber', true);
    expect(keys).toEqual([
      { columnId: 'nationality', dir: 'asc' },
      { columnId: 'gender', dir: 'asc' },
      { columnId: 'sailNumber', dir: 'asc' },
    ]);
  });

  it('cycles a column already in the stack in place, without reordering it', () => {
    const stack: SortKey[] = [
      { columnId: 'nationality', dir: 'asc' },
      { columnId: 'club', dir: 'asc' },
    ];
    const reversed = toggleSortKey(stack, 'nationality', true);
    expect(reversed).toEqual([
      { columnId: 'nationality', dir: 'desc' },
      { columnId: 'club', dir: 'asc' },
    ]);
    expect(toggleSortKey(reversed, 'nationality', true)).toEqual([
      { columnId: 'club', dir: 'asc' },
    ]);
  });

  it('caps the stack, dropping the oldest key', () => {
    let keys: SortKey[] = [];
    for (const id of ['a', 'b', 'c', 'd']) keys = toggleSortKey(keys, id, true);
    expect(keys).toHaveLength(MAX_SORT_KEYS);
    expect(keys.map((k) => k.columnId)).toEqual(['b', 'c', 'd']);
  });
});

describe('sortDirectionFor / sortPositionFor', () => {
  const keys: SortKey[] = [
    { columnId: 'nationality', dir: 'asc' },
    { columnId: 'club', dir: 'desc' },
  ];

  it('reports the direction of a sorted column only', () => {
    expect(sortDirectionFor(keys, 'club')).toBe('desc');
    expect(sortDirectionFor(keys, 'age')).toBeUndefined();
  });

  it('numbers the stack positions', () => {
    expect(sortPositionFor(keys, 'nationality')).toBe(1);
    expect(sortPositionFor(keys, 'club')).toBe(2);
    expect(sortPositionFor(keys, 'age')).toBeUndefined();
  });

  it('has no position to show for a single key', () => {
    expect(sortPositionFor([{ columnId: 'club', dir: 'asc' }], 'club')).toBeUndefined();
  });
});

describe('compareText', () => {
  it('ignores case and accents', () => {
    expect(compareText('howth', 'Howth')).toBe(0);
    expect(compareText('Dún Laoghaire', 'Dun Laoghaire')).toBe(0);
  });

  it('orders embedded numbers numerically', () => {
    expect(['Fleet 10', 'Fleet 2'].sort(compareText)).toEqual(['Fleet 2', 'Fleet 10']);
  });

  it('puts blanks last ascending, first reversed', () => {
    expect(['', 'Howth', null].sort(compareText)).toEqual(['Howth', '', null]);
    expect(compareText(undefined, 'Howth')).toBeGreaterThan(0);
  });
});

describe('compareNumeric', () => {
  it('orders numbers, blanks last', () => {
    expect([30, null, 8].sort(compareNumeric)).toEqual([8, 30, null]);
  });

  it('treats zero as a value, not a blank', () => {
    expect(compareNumeric(0, 5)).toBeLessThan(0);
    expect(compareNumeric(0, null)).toBeLessThan(0);
  });
});

interface Row {
  nat: string;
  gender: string;
  sail: number;
}

const columns = [
  { id: 'nat', compare: (a: Row, b: Row) => compareText(a.nat, b.nat) },
  { id: 'gender', compare: (a: Row, b: Row) => compareText(a.gender, b.gender) },
  { id: 'sail', compare: (a: Row, b: Row) => compareNumeric(a.sail, b.sail) },
];

describe('comparatorFor', () => {
  const rows: Row[] = [
    { nat: 'IRL', gender: 'M', sail: 7 },
    { nat: 'GBR', gender: 'F', sail: 3 },
    { nat: 'IRL', gender: 'F', sail: 21 },
    { nat: 'IRL', gender: 'F', sail: 4 },
  ];

  it('returns undefined when nothing is sorted', () => {
    expect(comparatorFor([], columns)).toBeUndefined();
  });

  it('breaks ties with the later keys', () => {
    const cmp = comparatorFor(
      [
        { columnId: 'nat', dir: 'asc' },
        { columnId: 'gender', dir: 'asc' },
        { columnId: 'sail', dir: 'asc' },
      ],
      columns,
    )!;
    expect([...rows].sort(cmp)).toEqual([
      { nat: 'GBR', gender: 'F', sail: 3 },
      { nat: 'IRL', gender: 'F', sail: 4 },
      { nat: 'IRL', gender: 'F', sail: 21 },
      { nat: 'IRL', gender: 'M', sail: 7 },
    ]);
  });

  it('reverses only the key that is descending', () => {
    const cmp = comparatorFor(
      [
        { columnId: 'nat', dir: 'asc' },
        { columnId: 'sail', dir: 'desc' },
      ],
      columns,
    )!;
    expect([...rows].sort(cmp).map((r) => r.sail)).toEqual([3, 21, 7, 4]);
  });

  it('leaves tied rows in their existing order', () => {
    const cmp = comparatorFor([{ columnId: 'nat', dir: 'asc' }], columns)!;
    expect([...rows].sort(cmp).map((r) => r.sail)).toEqual([3, 7, 21, 4]);
  });

  it('ignores keys for columns that are not shown', () => {
    const cmp = comparatorFor(
      [
        { columnId: 'hidden', dir: 'asc' },
        { columnId: 'sail', dir: 'asc' },
      ],
      columns,
    )!;
    expect([...rows].sort(cmp).map((r) => r.sail)).toEqual([3, 4, 7, 21]);
  });

  it('returns undefined when every key names a hidden column', () => {
    expect(comparatorFor([{ columnId: 'hidden', dir: 'asc' }], columns)).toBeUndefined();
  });
});
