import { describe, it, expect } from 'vitest';
import { halsailColumnMap, isHalsailExport } from '@/lib/halsail-export';
import type { ColumnMap } from '@/lib/csv-import';

describe('isHalsailExport', () => {
  it("recognises HalSail's reload instructions above the headings", () => {
    expect(
      isHalsailExport([
        ['INSTRUCTIONS FOR RELOADING THIS SPREADSHEET INTO HALSAIL'],
        ['BOATS IN CLASS CRUISERS MASTER 2026'],
      ]),
    ).toBe(true);
  });

  it('is false for any other preamble, or none', () => {
    expect(isHalsailExport([['Cruisers 2026 entries']])).toBe(false);
    expect(isHalsailExport([])).toBe(false);
  });
});

describe('halsailColumnMap', () => {
  it('maps Name to Boat name when an Owner column can be the primary', () => {
    const map: ColumnMap = { 0: 'sailNumber', 1: 'primary', 2: 'owner' };
    expect(halsailColumnMap(['SAIL NUMBER', 'Name', 'Owner'], map)).toEqual({
      0: 'sailNumber',
      1: 'boatName',
      2: 'owner',
    });
  });

  it('maps Name to Boat name when a Helm column can be the primary', () => {
    const map: ColumnMap = { 0: 'sailNumber', 1: 'primary', 2: 'helm' };
    expect(halsailColumnMap(['SAIL NUMBER', 'Name', 'Helm'], map)[1]).toBe('boatName');
  });

  it('leaves Name as the primary when nothing else can be', () => {
    const map: ColumnMap = { 0: 'sailNumber', 1: 'primary' };
    expect(halsailColumnMap(['SAIL NUMBER', 'Name'], map)).toBe(map);
  });

  it('leaves the map alone when a column is already Boat name', () => {
    const map: ColumnMap = { 0: 'sailNumber', 1: 'primary', 2: 'owner', 3: 'boatName' };
    expect(halsailColumnMap(['SAIL NUMBER', 'Name', 'Owner', 'Boat'], map)).toBe(map);
  });
});
