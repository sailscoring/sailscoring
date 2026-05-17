import { describe, it, expect } from 'vitest';
import { parseFleetCell, autoDetectField } from '@/lib/csv-import';

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

describe('autoDetectField', () => {
  it('detects spaced headers', () => {
    expect(autoDetectField('Sail Number')).toBe('sailNumber');
    expect(autoDetectField('Boat Name')).toBe('boatName');
    expect(autoDetectField('Crew Name')).toBe('crewName');
    expect(autoDetectField('Class')).toBe('boatClass');
    expect(autoDetectField('Helm')).toBe('helm');
    expect(autoDetectField('Owner')).toBe('owner');
    expect(autoDetectField('Club')).toBe('club');
    expect(autoDetectField('Fleet')).toBe('fleet');
    expect(autoDetectField('Division')).toBe('fleet');
    expect(autoDetectField('IRC TCC')).toBe('tcc');
    expect(autoDetectField('PY')).toBe('py');
  });

  it('detects camelCase headers (echo-example reference CSV)', () => {
    // Regression: before the camelCase split, `boatName` lowercased to
    // `boatname` (one word) so `\bboat\b` missed and the generic `/name/`
    // rule shadowed it as `primary`. Same shape for `initialEcho` —
    // `\becho\b` missed and the column fell through to `ignore`.
    expect(autoDetectField('sailNumber')).toBe('sailNumber');
    expect(autoDetectField('boatName')).toBe('boatName');
    expect(autoDetectField('crewName')).toBe('crewName');
    expect(autoDetectField('ircTcc')).toBe('tcc');
    expect(autoDetectField('initialEcho')).toBe('echoStartingTcf');
    expect(autoDetectField('startingTcf')).toBe('nhcStartingTcf');
  });

  it('falls back to primary for a generic name column', () => {
    expect(autoDetectField('name')).toBe('primary');
    expect(autoDetectField('Name')).toBe('primary');
  });

  it('returns ignore for unrecognised headers', () => {
    expect(autoDetectField('type')).toBe('ignore');
    expect(autoDetectField('notes')).toBe('ignore');
    expect(autoDetectField('')).toBe('ignore');
  });

  it('detects ECHO and NHC handicap columns by various spellings', () => {
    expect(autoDetectField('ECHO handicap')).toBe('echoStartingTcf');
    expect(autoDetectField('echo rating')).toBe('echoStartingTcf');
    expect(autoDetectField('NHC')).toBe('nhcStartingTcf');
    expect(autoDetectField('NHC TCF')).toBe('nhcStartingTcf');
  });

  it('detects nationality columns by nat / nationality / country', () => {
    // The IODAI Nationals reference CSV uses literally "nat"; Sailwave-derived
    // sheets sometimes spell it "nationality"; entry-form exports often say
    // "country". All three should land on the same field.
    expect(autoDetectField('nat')).toBe('nationality');
    expect(autoDetectField('Nat')).toBe('nationality');
    expect(autoDetectField('Nationality')).toBe('nationality');
    expect(autoDetectField('Country')).toBe('nationality');
  });

  it('does not let a header that merely contains "nat" leak into nationality', () => {
    // Sanity: "name" still maps to primary even though it shares letters
    // with "nat"; the rule is anchored on \bnat\b.
    expect(autoDetectField('Name')).toBe('primary');
  });
});
