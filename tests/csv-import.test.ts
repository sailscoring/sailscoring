import { describe, it, expect } from 'vitest';
import { parseFleetCell, autoDetectField, isGroupingHeader, matchSubdivisionAxis, routeSeedingColumn, splitPersonCell, parseExcludedCell } from '@/lib/csv-import';

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
    expect(autoDetectField('IRC TCC')).toBe('tcc');
    expect(autoDetectField('PY')).toBe('py');
  });

  it('reads Sailor ID headers as the World Sailing ID, not the sail number', () => {
    // Every spelling of the header contains "sail", which the sail-number rule
    // would otherwise claim.
    expect(autoDetectField('World Sailing ID')).toBe('worldSailingId');
    expect(autoDetectField('WS Sailor ID')).toBe('worldSailingId');
    expect(autoDetectField('Sailor ID')).toBe('worldSailingId');
    expect(autoDetectField('sailorId')).toBe('worldSailingId');
    expect(autoDetectField('ISAF ID')).toBe('worldSailingId');
    expect(autoDetectField('IFPersonID')).toBe('worldSailingId');
    // Sailwave's HelmID column is documented as holding a sailor
    // identification string, so it is not the helm's name.
    expect(autoDetectField('HelmID')).toBe('worldSailingId');
    expect(autoDetectField('Helm Name')).toBe('helm');
    // And a plain sail-number column is unaffected.
    expect(autoDetectField('Sail Number')).toBe('sailNumber');
  });

  it('maps division/category/subdivision headers to subdivision, not fleet', () => {
    // Regression (issue #158): "Division" used to fall through to `fleet`,
    // conflating the prize-giving subdivision with the scoring group.
    expect(autoDetectField('Division')).toBe('subdivision');
    expect(autoDetectField('division')).toBe('subdivision');
    expect(autoDetectField('Category')).toBe('subdivision');
    expect(autoDetectField('Subdivision')).toBe('subdivision');
    // And none of them is mistaken for the grouping column.
    expect(isGroupingHeader('Division')).toBe(false);
    expect(isGroupingHeader('Category')).toBe(false);
  });

  it('detects the grouping column separately from any field role', () => {
    // Grouping is not a competitor field, so a Fleet header claims no role
    // and stays free to be mapped — which is how one column can both split
    // the fleets and record each boat's class.
    expect(autoDetectField('Fleet')).toBe('ignore');
    expect(isGroupingHeader('Fleet')).toBe(true);
    expect(isGroupingHeader('fleet')).toBe(true);
    expect(isGroupingHeader('Fleet Name')).toBe(true);
    // Class means boat class and never stands in for grouping.
    expect(isGroupingHeader('Class')).toBe(false);
    expect(autoDetectField('Class')).toBe('boatClass');
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

describe('seeding rank detection', () => {
  it('detects the seeding-rank column', () => {
    expect(autoDetectField('Seeding rank')).toBe('seed');
    expect(autoDetectField('Rank')).toBe('seed');
    expect(autoDetectField('Seed')).toBe('seed');
  });
});

describe('tally-number detection', () => {
  it('detects a header naming the safety tally', () => {
    expect(autoDetectField('Tally')).toBe('tallyNumber');
    expect(autoDetectField('Tally number')).toBe('tallyNumber');
    expect(autoDetectField('Tally No.')).toBe('tallyNumber');
  });

  it('does not claim an unrelated header that merely contains the letters', () => {
    expect(autoDetectField('Totally Awesome')).not.toBe('tallyNumber');
  });
});

describe('excluded detection', () => {
  it('detects an Excluded column however it is headed', () => {
    expect(autoDetectField('Excluded')).toBe('excluded');
    expect(autoDetectField('Exclude')).toBe('excluded');
    expect(autoDetectField('Excluded from series')).toBe('excluded');
  });

  it('reads a mark as excluded and an empty or negative cell as entered', () => {
    for (const v of ['1', 'Y', 'yes', 'TRUE', 'x', '✓', 'excluded']) {
      expect(parseExcludedCell(v), v).toBe(true);
    }
    for (const v of ['', ' ', '0', 'N', 'no', 'FALSE', '-']) {
      expect(parseExcludedCell(v), JSON.stringify(v)).toBe(false);
    }
  });
});

describe('initial-fleet detection', () => {
  it('detects a header naming the fleet the committee assigned', () => {
    expect(autoDetectField('Initial fleet')).toBe('initialFleet');
    expect(autoDetectField('Assigned fleet')).toBe('initialFleet');
    expect(autoDetectField('Seeding fleet')).toBe('initialFleet');
    expect(autoDetectField('Qualifying group')).toBe('initialFleet');
    expect(autoDetectField('Starting colour')).toBe('initialFleet');
  });

  it('reads a qualified fleet header as the assignment, not as grouping', () => {
    expect(isGroupingHeader('Initial fleet')).toBe(false);
    expect(isGroupingHeader('Assigned Fleet')).toBe(false);
  });

  it('leaves a bare fleet column as the grouping column', () => {
    // On an ordinary series that column splits the entry list into fleets;
    // a split-fleet series routes it by its cells instead.
    expect(isGroupingHeader('Fleet')).toBe(true);
    expect(autoDetectField('Fleet')).toBe('ignore');
  });
});

describe('routeSeedingColumn', () => {
  it('reads whole numbers as a ranking', () => {
    expect(routeSeedingColumn(['1', '2', '3', '4'])).toBe('seed');
  });

  it('reads labels as an assignment', () => {
    expect(routeSeedingColumn(['Yellow', 'Blue', 'Red', 'Yellow'])).toBe('initialFleet');
  });

  it('reads a single non-numeric cell as an assignment', () => {
    // A partly-filled column still says which kind it is.
    expect(routeSeedingColumn(['', 'Yellow', '', ''])).toBe('initialFleet');
  });

  it('ignores blanks when deciding', () => {
    expect(routeSeedingColumn(['1', '', ' 2 ', ''])).toBe('seed');
  });

  it('reads a mixed column as an assignment', () => {
    // "Yellow / 2" is not a ranking, whatever else it is.
    expect(routeSeedingColumn(['1', 'Yellow'])).toBe('initialFleet');
  });

  it('declines to decide an empty column', () => {
    expect(routeSeedingColumn(['', '  ', ''])).toBeNull();
    expect(routeSeedingColumn([])).toBeNull();
  });

  it('reads fleets numbered 1/2/3 as a ranking — the case it cannot see', () => {
    // Documented, not desired: the scorer re-points the column in the
    // mapping dropdown, and the seed dialog shows the fleet sizes before
    // anything commits.
    expect(routeSeedingColumn(['1', '2', '3', '1', '2', '3'])).toBe('seed');
  });
});
