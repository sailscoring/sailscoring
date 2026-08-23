import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  isOrcCertExpired,
  mergeOrcFeeds,
  orcActiveCertsUrl,
  orcCertificatePageUrl,
  orcRecordNumber,
  orcRmsUrl,
  orcVppYears,
  parseOrcActiveCerts,
  parseOrcRmsJson,
} from '@/lib/orc-certificate';

// Real records from the IRL DownRMS feed (fetched 2026-08-22), trimmed to the
// five boats the AL 2025 ORC experiment report analyses. The file carries the
// live feed's UTF-8 BOM so the parser's BOM stripping is exercised.
const RMS_FIXTURE = readFileSync(
  join(process.cwd(), 'tests/fixtures/orc/downrms-irl-sample.json'),
  'utf-8',
);
const ACTIVECERTS_FIXTURE = readFileSync(
  join(process.cwd(), 'tests/fixtures/orc/activecerts-irl-sample.xml'),
  'utf-8',
);

describe('parseOrcRmsJson', () => {
  it('parses records through the feed BOM', () => {
    expect(RMS_FIXTURE.charCodeAt(0)).toBe(0xfeff);
    const { rms } = parseOrcRmsJson(RMS_FIXTURE);
    expect(rms).toHaveLength(5);
    const names = rms.map((r) => r.YachtName);
    expect(names).toContain('IMPETUOUS');
    expect(names).toContain('JAMBALYA');
  });

  it('exposes the published single numbers and the allowance matrix', () => {
    const { rms } = parseOrcRmsJson(RMS_FIXTURE);
    const jambalya = rms.find((r) => r.YachtName === 'JAMBALYA')!;
    expect(jambalya.RefNo).toBe('05180004WJU');
    expect(jambalya.C_Type).toBe('INTL');
    expect(jambalya.Family).toBe('ORC');
    expect(jambalya.CDL).toBeCloseTo(6.473, 3);
    expect(jambalya.APHD).toBeCloseTo(651.1, 1);
    // ToT is 600 / ToD (rule 403.3) — the published pair must agree.
    expect(jambalya.APHT).toBeCloseTo(600 / jambalya.APHD!, 3);
    expect(jambalya.TMF_Inshore).toBeCloseTo(600 / jambalya.ILCWA!, 3);
    const allowances = jambalya.Allowances!;
    expect(allowances.WindSpeeds).toEqual([4, 6, 8, 10, 12, 14, 16, 20, 24]);
    expect(allowances.Beat).toHaveLength(9);
    expect(allowances.Run).toHaveLength(9);
  });

  it('carries the ScoringOptions catalog', () => {
    const { scoringOptions } = parseOrcRmsJson(RMS_FIXTURE);
    const apht = scoringOptions.find((o) => o.Fieldname === 'APHT');
    expect(apht?.Kind).toBe('TOT');
    // The Irish five-band W/L set is a national option in the same catalog.
    const fiveBand = scoringOptions.find((o) => o.Fieldname === 'IRL_5B_WL_M_TOT');
    expect(fiveBand?.Kind).toBe('TOT');
    expect(fiveBand?.CountryId).toBe('IRL');
  });

  it('reads national-option rating fields by name', () => {
    const { rms } = parseOrcRmsJson(RMS_FIXTURE);
    const impetuous = rms.find((r) => r.YachtName === 'IMPETUOUS')!;
    expect(orcRecordNumber(impetuous, 'APHT')).toBeCloseTo(0.9631, 4);
    expect(orcRecordNumber(impetuous, 'IRL_5B_WL_M_TOT')).toBeGreaterThan(0);
    expect(orcRecordNumber(impetuous, 'NoSuchField')).toBeUndefined();
    // Non-numeric fields are not ratings.
    expect(orcRecordNumber(impetuous, 'YachtName')).toBeUndefined();
  });

  it('rejects a payload without an rms array', () => {
    expect(() => parseOrcRmsJson('{"foo": 1}')).toThrow(/rms array/);
  });
});

describe('parseOrcActiveCerts + mergeOrcFeeds', () => {
  it('extracts expiry and VPP year per reference number', () => {
    const rows = parseOrcActiveCerts(ACTIVECERTS_FIXTURE);
    expect(rows).toHaveLength(5);
    const jambalya = rows.find((r) => r.refNo === '05180004WJU')!;
    expect(jambalya.expiryDate).toBe('2026-12-31T00:00:00.000Z');
    expect(jambalya.vppYear).toBe(2026);
  });

  it('merges index fields onto records, tolerating gaps', () => {
    const { rms } = parseOrcRmsJson(RMS_FIXTURE);
    const rows = parseOrcActiveCerts(ACTIVECERTS_FIXTURE).filter(
      (r) => r.refNo !== '05180004WJU',
    );
    const merged = mergeOrcFeeds(rms, rows);
    expect(merged).toHaveLength(5);
    const jambalya = merged.find((e) => e.record.YachtName === 'JAMBALYA')!;
    expect(jambalya.expiryDate).toBeUndefined();
    const mojo = merged.find((e) => e.record.YachtName === 'MOJO')!;
    expect(mojo.expiryDate).toBe('2026-12-31T00:00:00.000Z');
    expect(mojo.vppYear).toBe(2026);
  });
});

describe('certificate validity helpers', () => {
  it('treats a certificate as valid through its printed expiry day', () => {
    const cert = { expiryDate: '2026-12-31T00:00:00.000Z' };
    expect(isOrcCertExpired(cert, Date.parse('2026-12-31T18:00:00Z'))).toBe(false);
    expect(isOrcCertExpired(cert, Date.parse('2027-01-01T06:00:00Z'))).toBe(true);
    expect(isOrcCertExpired({}, Date.parse('2030-01-01T00:00:00Z'))).toBe(false);
  });

  it('collects distinct VPP years for the same-year warning', () => {
    expect(orcVppYears([{ vppYear: 2026 }, { vppYear: 2026 }, {}])).toEqual([2026]);
    expect(orcVppYears([{ vppYear: 2025 }, { vppYear: 2026 }])).toEqual([2025, 2026]);
  });
});

describe('endpoint URLs', () => {
  it('builds the documented WPub.dll queries', () => {
    expect(orcRmsUrl('IRL', 'ORC')).toBe(
      'https://data.orc.org/public/WPub.dll?action=DownRMS&CountryId=IRL&ext=json',
    );
    expect(orcRmsUrl('IRL', 'DH')).toContain('&Family=DH&');
    expect(orcActiveCertsUrl('IRL', 'NS')).toContain('Family=5');
    expect(orcCertificatePageUrl('05180004WJU')).toBe(
      'https://data.orc.org/public/WPub.dll/CC/05180004WJU',
    );
  });
});
