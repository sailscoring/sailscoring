import { describe, it, expect } from 'vitest';
import { parseFleetCell, autoDetectField, matchSubdivisionAxis, splitPersonCell } from '@/lib/csv-import';

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
    expect(autoDetectField('IRC TCC')).toBe('tcc');
    expect(autoDetectField('PY')).toBe('py');
  });

  it('maps division/category/subdivision headers to subdivision, not fleet', () => {
    // Regression (issue #158): "Division" used to fall through to `fleet`,
    // conflating the prize-giving subdivision with the scoring group.
    expect(autoDetectField('Division')).toBe('subdivision');
    expect(autoDetectField('division')).toBe('subdivision');
    expect(autoDetectField('Category')).toBe('subdivision');
    expect(autoDetectField('Subdivision')).toBe('subdivision');
    // Fleet still maps to fleet.
    expect(autoDetectField('Fleet')).toBe('fleet');
  });

  it('reads age-band headers as a subdivision, not the numeric age field', () => {
    // "Age Category"/"Age Group"/"Age Band" are prize subdivisions; only a bare
    // age-ish header is the numeric age field.
    expect(autoDetectField('Age Category')).toBe('subdivision');
    expect(autoDetectField('age group')).toBe('subdivision');
    expect(autoDetectField('Age Band')).toBe('subdivision');
    expect(autoDetectField('Age')).toBe('age');
    expect(autoDetectField('Age (years)')).toBe('age');
  });

  it('keeps a bare "Class" column as boat class, not subdivision', () => {
    // "Class" is a valid subdivision label, but a CSV "Class" column is far
    // more often the boat class — auto-detect favours that; the scorer can
    // remap by hand if needed.
    expect(autoDetectField('Class')).toBe('boatClass');
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

describe('matchSubdivisionAxis', () => {
  const axes = ['Division', 'Age category'];

  it('matches a header to the axis with the same label (case/punctuation-insensitive)', () => {
    expect(matchSubdivisionAxis('Division', axes)).toBe(0);
    expect(matchSubdivisionAxis('division', axes)).toBe(0);
    expect(matchSubdivisionAxis('Age Category', axes)).toBe(1);
    expect(matchSubdivisionAxis('age-category', axes)).toBe(1);
  });

  it('falls back to token overlap when there is no exact match', () => {
    // "Age band" shares the "age" token with "Age category".
    expect(matchSubdivisionAxis('Age band', axes)).toBe(1);
    // "Skill Division" shares "division" with "Division".
    expect(matchSubdivisionAxis('Skill Division', axes)).toBe(0);
  });

  it('returns null when nothing matches, so the caller makes a new axis', () => {
    expect(matchSubdivisionAxis('Category', ['Division'])).toBeNull();
    expect(matchSubdivisionAxis('Gender', axes)).toBeNull();
  });

  it('returns null with no configured axes or an empty header', () => {
    expect(matchSubdivisionAxis('Division', [])).toBeNull();
    expect(matchSubdivisionAxis('   ', axes)).toBeNull();
  });

  it('prefers an exact match over a mere token overlap', () => {
    // "Category" exactly matches axis 1 even though axis 0 shares no token.
    expect(matchSubdivisionAxis('Category', ['Division', 'Category'])).toBe(1);
  });
});

describe('splitPersonCell', () => {
  it('splits on Sailwave <br>, newlines, and semicolons', () => {
    expect(splitPersonCell('Alice Byrne<br>Bob Malone')).toEqual(['Alice Byrne', 'Bob Malone']);
    expect(splitPersonCell('Alice Byrne<br/>Bob Malone')).toEqual(['Alice Byrne', 'Bob Malone']);
    expect(splitPersonCell('Alice Byrne\nBob Malone')).toEqual(['Alice Byrne', 'Bob Malone']);
    expect(splitPersonCell('Alice Byrne; Bob Malone ; Carol Doyle')).toEqual([
      'Alice Byrne', 'Bob Malone', 'Carol Doyle',
    ]);
  });

  it('does not split on commas or ampersands', () => {
    expect(splitPersonCell('MOUSE, Micky')).toEqual(['MOUSE, Micky']);
    expect(splitPersonCell('Alice & Bob Byrne')).toEqual(['Alice & Bob Byrne']);
  });

  it('trims and drops empty segments', () => {
    expect(splitPersonCell(' Alice Byrne ;; ')).toEqual(['Alice Byrne']);
    expect(splitPersonCell('')).toEqual([]);
  });
});

describe('autoDetectField — numbered crew columns', () => {
  it('maps Crew 1 / Crew 2 / 2nd Crew to the crew field', () => {
    expect(autoDetectField('Crew 1')).toBe('crewName');
    expect(autoDetectField('Crew 2')).toBe('crewName');
    expect(autoDetectField('2nd Crew')).toBe('crewName');
  });
});
