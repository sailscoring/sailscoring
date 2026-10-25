import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ORC_STANDARD_OPTIONS,
  OrcSourceError,
  fetchOrcCertificates,
  isOrcCertExpired,
  mergeOrcFeeds,
  orcActiveCertsUrl,
  orcCertificatePageUrl,
  orcConstructedOption,
  orcCurveOption,
  orcOptionKind,
  orcProfileRating,
  orcRecordNumber,
  orcRecordedWindOption,
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

describe('scoring options', () => {
  it('the recorded-wind options are computed over the start\'s own course', () => {
    for (const option of ['CC_TOT', 'CC_TOD']) {
      expect(ORC_STANDARD_OPTIONS.some((o) => o.option === option)).toBe(true);
      expect(orcRecordedWindOption(option)).toBe(true);
      expect(orcCurveOption(option)).toBe(true);
      expect(orcConstructedOption(option)).toBe(true);
    }
    // The kind is the correction, so the engine reaches them the same way it
    // reaches a certificate field.
    expect(orcOptionKind('CC_TOT')).toBe('tot');
    expect(orcOptionKind('CC_TOD')).toBe('tod');
  });

  it('performance curves are computed too, but derive their own wind', () => {
    for (const option of ['WL', 'CR', 'OC', 'CC']) {
      expect(orcCurveOption(option)).toBe(true);
      expect(orcRecordedWindOption(option)).toBe(false);
    }
    expect(orcConstructedOption('CC')).toBe(true);
    expect(orcConstructedOption('WL')).toBe(false);
  });

  it('a certificate field is read, not computed', () => {
    for (const option of ['APHT', 'APHD', 'IRL_5B_WL_M_TOT', 'TN_Inshore_Low']) {
      expect(orcCurveOption(option)).toBe(false);
      expect(orcRecordedWindOption(option)).toBe(false);
      expect(orcConstructedOption(option)).toBe(false);
    }
    // No rating is read off the certificate for a computed option, even
    // though the name ends the way a time-on-time field does.
    expect(orcProfileRating(
      { orcCert: { record: { APHT: 0.95, CC_TOT: 1.23 }, importedAt: 0 } },
      { option: 'CC_TOT', kind: 'tot' },
    )).toBeNull();
  });
});

describe('endpoint URLs', () => {
  it('builds the documented ORC API queries, with the key in the path', () => {
    expect(orcRmsUrl('orc_abc', 'IRL', 'ORC')).toBe(
      'https://sas.orc.org/api/orc_abc/DownRMS?CountryId=IRL&ext=json',
    );
    expect(orcRmsUrl('orc_abc', 'IRL', 'DH')).toContain('&Family=DH&');
    expect(orcActiveCertsUrl('orc_abc', 'IRL', 'NS')).toBe(
      'https://sas.orc.org/api/orc_abc/activecerts?CountryId=IRL&Family=5&format=xml',
    );
  });

  it('links people to the certificate page, which needs no key', () => {
    expect(orcCertificatePageUrl('05180004WJU')).toBe(
      'https://sas.orc.org/open.html?kind=cc&id=05180004WJU',
    );
  });
});

describe('fetchOrcCertificates', () => {
  afterEach(() => vi.unstubAllGlobals());

  const KEY = 'orc_0123456789abcdef';

  it('merges the two feeds, both fetched on the key', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      new Response(url.includes('/DownRMS?') ? RMS_FIXTURE : ACTIVECERTS_FIXTURE, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const listing = await fetchOrcCertificates(KEY, 'IRL', 'ORC');
    expect(listing.records.length).toBeGreaterThan(0);
    expect(listing.records.some((r) => r.expiryDate)).toBe(true);
    expect(fetchMock.mock.calls.map(([url]) => url).every((url) => url.includes(`/api/${KEY}/`))).toBe(true);
  });

  it('a refused key is a sentence for the scorer, and never names the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      Response.json({ errors: ['Missing or invalid API key.'] }, { status: 401 })));

    const err = await fetchOrcCertificates(KEY, 'IRL', 'ORC').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OrcSourceError);
    expect((err as Error).message).toMatch(/refused Sail Scoring’s API key/);
    expect((err as Error).message).not.toContain(KEY);
  });

  it('passes on the API’s own reason for other failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      Response.json({ errors: ['CountryId is required.'] }, { status: 400 })));

    await expect(fetchOrcCertificates(KEY, 'IRL', 'ORC')).rejects.toThrow(
      'The ORC certificate database answered HTTP 400 (CountryId is required.). Try again later.',
    );
  });

  it('an unreachable database fails without the URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { throw new TypeError(`fetch failed: ${url}`); }));

    const err = await fetchOrcCertificates(KEY, 'IRL', 'ORC').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OrcSourceError);
    expect((err as Error).message).not.toContain(KEY);
  });
});
