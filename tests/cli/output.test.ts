// @vitest-environment node

/** ADR-009 M4 — the CLI output helper (format resolution, row coercion, table). */
import { afterEach, describe, expect, test, vi } from 'vitest';

import { printTable, resolveFormat, toRows } from '@/cli/output';

describe('resolveFormat', () => {
  test('--json and --output json select json; default is table', () => {
    expect(resolveFormat({ json: 'true' })).toBe('json');
    expect(resolveFormat({ output: 'json' })).toBe('json');
    expect(resolveFormat({ o: 'json' })).toBe('json');
    expect(resolveFormat({})).toBe('table');
    expect(resolveFormat({ output: 'table' })).toBe('table');
  });
});

describe('toRows', () => {
  test('accepts arrays, {items} envelopes, and single objects', () => {
    expect(toRows([{ a: 1 }, { a: 2 }])).toHaveLength(2);
    expect(toRows({ items: [{ a: 1 }] })).toEqual([{ a: 1 }]);
    expect(toRows({ a: 1 })).toEqual([{ a: 1 }]);
    expect(toRows(null)).toEqual([]);
  });
});

describe('printTable', () => {
  afterEach(() => vi.restoreAllMocks());

  test('prints a header and a row per item; coerces arrays/objects', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    printTable([{ id: 'x1', name: 'Alpha', features: ['a', 'b'] }], ['id', 'name', 'features']);
    const lines = log.mock.calls.map((c) => c[0] as string);
    expect(lines[0]).toContain('id');
    expect(lines[0]).toContain('features');
    expect(lines[1]).toContain('x1');
    expect(lines[1]).toContain('Alpha');
    expect(lines[1]).toContain('a,b'); // array cell joined
  });

  test('empty rows print (none)', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    printTable([], ['id']);
    expect(log).toHaveBeenCalledWith('(none)');
  });
});
