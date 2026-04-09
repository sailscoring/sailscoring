import { describe, it, expect } from 'vitest';
import { parseFleetCell } from '@/lib/csv-import';

describe('parseFleetCell', () => {
  it('returns a single name for a plain cell', () => {
    expect(parseFleetCell('PY')).toEqual(['PY']);
  });

  it('splits pipe-delimited names', () => {
    expect(parseFleetCell('PY|M15')).toEqual(['PY', 'M15']);
  });

  it('trims whitespace around each name', () => {
    expect(parseFleetCell('  PY  |  M15  ')).toEqual(['PY', 'M15']);
  });

  it('returns an empty array for an empty cell', () => {
    expect(parseFleetCell('')).toEqual([]);
  });

  it('returns an empty array for a whitespace-only cell', () => {
    expect(parseFleetCell('   ')).toEqual([]);
  });

  it('drops empty segments from trailing or repeated separators', () => {
    expect(parseFleetCell('PY|')).toEqual(['PY']);
    expect(parseFleetCell('|M15')).toEqual(['M15']);
    expect(parseFleetCell('PY||M15')).toEqual(['PY', 'M15']);
  });

  it('deduplicates case-insensitively, preserving the first spelling', () => {
    expect(parseFleetCell('PY|py')).toEqual(['PY']);
    expect(parseFleetCell('py|PY|M15')).toEqual(['py', 'M15']);
  });

  it('handles the Sailwave Melges 15 example from the reference CSV', () => {
    expect(parseFleetCell('PY|M15')).toEqual(['PY', 'M15']);
  });
});
