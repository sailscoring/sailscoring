import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  YTC_FALLBACK_SHEET_ID,
  findListingSheetId,
  parseYtcListing,
  ytcSailNumber,
  ytcSheetCsvUrl,
} from '@/lib/ytc-rating';

/**
 * The RORC's YTC listing, as its Google Sheet exports it. The fixture holds
 * Mayo Sailing Club's seven boats as published, plus invented rows for each
 * shape the live listing has been seen to carry: a placeholder sail number, a
 * name with a comma in it, a boat with no spinnaker, a provisional
 * certificate, a broken number, and two boats sharing a bare sail number.
 */
const csv = readFileSync(join(__dirname, 'fixtures', 'ytc-listing.csv'), 'utf8');
const records = parseYtcListing(csv);
const bySail = (sail: string) => records.filter((r) => r.sailNumber === sail);
const byName = (name: string) => records.find((r) => r.boatName === name);

describe('parseYtcListing', () => {
  it('reads a boat\'s spinnaker and white-sail numbers and what the listing says of it', () => {
    expect(bySail('IRL3062')).toEqual([{
      sailNumber: 'IRL3062',
      boatName: 'CROZZ',
      boatType: 'ELAN 31 1.85',
      lengthM: 9.16,
      ytc: 941,
      ytcWhiteSail: 965,
      club: 'Mayo Sailing Club',
      country: 'Ireland',
      configuration: 'SFIBFTNO',
      provisional: false,
      issueDate: '2026-08-13',
      entryId: '3225',
    }]);
  });

  it('keeps a sail number as published, with or without a country prefix', () => {
    expect(bySail('1552')[0].boatName).toBe('MOVITA');
    expect(bySail('IRL 2552')[0].boatName).toBe('FUSION');
  });

  it('reads a placeholder sail number as no number, leaving the name to match on', () => {
    expect(byName('SEA SPRAY')).toMatchObject({ sailNumber: '', ytc: 1001 });
  });

  it('reads a quoted name with a comma in it', () => {
    expect(byName('SPRAY, TOO')).toMatchObject({ sailNumber: 'GBR4410', ytc: 934 });
  });

  it('reads equal numbers for a boat declared with no spinnaker', () => {
    expect(byName('WHITE HORSES')).toMatchObject({ ytc: 1046, ytcWhiteSail: 1046, configuration: '0FIB3TNO' });
  });

  it('reads the provisional flag', () => {
    expect(byName('QUICKSILVER')?.provisional).toBe(true);
    expect(byName('CROZZ')?.provisional).toBe(false);
  });

  it('drops a row whose YTC is not a plausible number', () => {
    expect(byName('BROKEN CELL')).toBeUndefined();
  });

  it('keeps both boats that share a bare sail number', () => {
    expect(bySail('127').map((r) => r.boatName)).toEqual(['FIRST OF TWO', 'SECOND OF TWO']);
  });

  it('refuses a sheet that has lost its Sail Number or YTC column', () => {
    expect(() => parseYtcListing('Boat Name,Rating\nCROZZ,941\n')).toThrow(/Sail Number or YTC column/);
    expect(() => parseYtcListing('')).toThrow(/empty/);
  });
});

describe('ytcSailNumber', () => {
  it('reads the placeholders the listing uses as no number', () => {
    for (const cell of ['0', '00', 'N/A', 'NA', 'TBC', 'NONE', 'NO NUMBER', '-', '?']) {
      expect(ytcSailNumber(cell)).toBe('');
    }
    expect(ytcSailNumber(' GBR1007L ')).toBe('GBR1007L');
    expect(ytcSailNumber('10')).toBe('10');
  });
});

describe('the listing sheet', () => {
  it('reads the sheet id from the listings page\'s embed', () => {
    const html = '<iframe src="https://docs.google.com/spreadsheets/d/1Se2j64wyx_61Ux8GB08i4gK1M2TezDe8uhZQtZhhtkQ/edit?usp=sharing?widget=true&amp;headers=false"></iframe>';
    expect(findListingSheetId(html)).toBe('1Se2j64wyx_61Ux8GB08i4gK1M2TezDe8uhZQtZhhtkQ');
    expect(findListingSheetId('<p>no sheet here</p>')).toBeNull();
  });

  it('exports the sheet as CSV', () => {
    expect(ytcSheetCsvUrl(YTC_FALLBACK_SHEET_ID)).toBe(
      `https://docs.google.com/spreadsheets/d/${YTC_FALLBACK_SHEET_ID}/export?format=csv`,
    );
  });
});
