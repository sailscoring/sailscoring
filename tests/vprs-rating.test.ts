import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  formatLastModified,
  parseVprsClubIndex,
  parseVprsListing,
  sailFromCertHref,
} from '@/lib/vprs-rating';

const FIXTURE = readFileSync(
  join(process.cwd(), 'tests/fixtures/vprs/dublin_bay_ratings_2026.html'),
  'utf-8',
);

const INDEX_FIXTURE = readFileSync(
  join(process.cwd(), 'tests/fixtures/vprs/ratings_index_2026.html'),
  'utf-8',
);

describe('sailFromCertHref', () => {
  it('reads the sail number segment before _cert_', () => {
    expect(sailFromCertHref('certificates/boomerang_irl1367_cert_2026.pdf')).toBe('IRL1367');
    expect(sailFromCertHref('certificates/jambiya_gbr605_cert_2026.pdf')).toBe('GBR605');
  });

  it('handles multi-word boat-name slugs', () => {
    expect(sailFromCertHref('certificates/just_jasmin_irl3506_cert_2026.pdf')).toBe('IRL3506');
    expect(sailFromCertHref('certificates/sweet_martini_irl5013_cert_2026.pdf')).toBe('IRL5013');
  });

  it('handles country-less sail numbers', () => {
    expect(sailFromCertHref('certificates/jay-z_433_cert_2026.pdf')).toBe('433');
    expect(sailFromCertHref('certificates/sea_jade_918_cert_2026.pdf')).toBe('918');
  });

  it('returns empty for a non-certificate href', () => {
    expect(sailFromCertHref('index.html')).toBe('');
  });
});

describe('parseVprsListing', () => {
  const records = parseVprsListing(FIXTURE);
  const bySail = (sail: string) => records.find((r) => r.sailNumber === sail);

  it('parses only the live (current-season) rows, not commented-out prior seasons', () => {
    // The fixture keeps 2025 and 2024 boats inside an HTML comment block.
    expect(records).toHaveLength(24);
    // "Boojum" IRL2112 is a 2025 (commented) boat.
    expect(bySail('IRL2112')).toBeUndefined();
  });

  it('maps Yacht / Design / TCC / No spin / Issued for a two-coefficient boat', () => {
    expect(bySail('IRL1367')).toEqual({
      sailNumber: 'IRL1367',
      boatName: 'Boomerang',
      design: 'Beneteau First 36.7',
      vprsTcc: 0.992,
      vprsNonSpinTcc: 0.945,
      issued: '19 Mar',
    });
  });

  it('treats a "-" spin TCC as absent (no-spinnaker-only boat)', () => {
    const calypso = bySail('IRL5643');
    expect(calypso?.vprsTcc).toBeUndefined();
    expect(calypso?.vprsNonSpinTcc).toBe(0.873);
  });

  it('reads the highest and lowest TCCs on the sheet', () => {
    expect(bySail('IRL1725')?.vprsTcc).toBe(1.003); // Optique, Cork 1720
    expect(bySail('IRL5013')?.vprsNonSpinTcc).toBe(0.789); // Sweet Martini, SHE 31
  });

  it('keeps every record TCC to 3 decimal places as published', () => {
    for (const r of records) {
      for (const v of [r.vprsTcc, r.vprsNonSpinTcc]) {
        if (v != null) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});

describe('parseVprsClubIndex', () => {
  const clubs = parseVprsClubIndex(INDEX_FIXTURE);
  const byId = (id: string) => clubs.find((c) => c.id === id);

  it('extracts per-club listings with their region and absolute URL', () => {
    expect(byId('dublin_bay_ratings_2026')).toEqual({
      id: 'dublin_bay_ratings_2026',
      name: 'Dublin Bay Sailing Club',
      region: 'Ireland',
      url: 'https://vprs.org/dublin_bay_ratings_2026.html',
    });
  });

  it('tags clubs with the region heading they sit under', () => {
    expect(byId('pyra_ratings_2026')?.region).toBe('Poole Harbour');
    expect(byId('royal_southern_ratings_2026')?.region).toBe('Solent');
    expect(byId('plym_ratings_2026')?.region).toBe('Plymouth');
    expect(byId('bahia_ratings_2026')?.region).toBe('Brazil');
  });

  it('preserves document order', () => {
    const ids = clubs.map((c) => c.id);
    expect(ids.indexOf('pyra_ratings_2026')).toBeLessThan(ids.indexOf('dublin_bay_ratings_2026'));
  });

  it('excludes the VPRS Championship (not a _ratings_ listing) and the archive', () => {
    expect(clubs.some((c) => /championship/i.test(c.id))).toBe(false);
    expect(byId('ratings_2025')).toBeUndefined();
    expect(byId('ratings_2024')).toBeUndefined();
  });

  it('skips commented-out clubs (e.g. the inactive Brazilian fleets)', () => {
    expect(byId('frevo_ratings_2026')).toBeUndefined();
    expect(byId('guanabara_ratings_2026')).toBeUndefined();
  });
});

describe('formatLastModified', () => {
  it('formats an HTTP date as DD/MM/YYYY', () => {
    expect(formatLastModified('Wed, 19 Mar 2026 10:00:00 GMT')).toBe('19/03/2026');
  });

  it('returns null for a missing or unparseable header', () => {
    expect(formatLastModified(null)).toBeNull();
    expect(formatLastModified('not a date')).toBeNull();
  });
});
