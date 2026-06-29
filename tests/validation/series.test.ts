import { describe, test, expect } from 'vitest';

import {
  competitorFieldKeySchema,
  discardThresholdSchema,
  primaryPersonLabelSchema,
  seriesInputSchema,
  seriesSchema,
  startGroupSchema,
} from '@/lib/validation/series';
import type { Series } from '@/lib/types';

const VALID_SERIES: Series = {
  id: crypto.randomUUID(),
  name: 'Test',
  venue: 'HYC',
  startDate: '2026-04-01',
  endDate: '2026-04-30',
  venueLogoUrl: '',
  eventLogoUrl: '',
  venueUrl: '',
  eventUrl: '',
  createdAt: 1_700_000_000_000,
  lastSavedAt: null,
  lastModifiedAt: 1_700_000_000_000,
  scoringMode: 'handicap',
  defaultStartSequence: [{ fleetIds: [], intervalMinutes: 0 }],
  discardThresholds: [{ minRaces: 4, discardCount: 1 }],
  dnfScoring: 'seriesEntries',
  ftpHost: '',
  ftpPath: '',
  ftpPaths: {},
  includeJsonExport: true,
  publishRatingCalculations: true,
  enabledCompetitorFields: ['boatName', 'club'],
  primaryPersonLabel: 'helm',
  subdivisionAxes: [],
};

describe('seriesSchema', () => {
  test('accepts a fully-populated valid series', () => {
    expect(() => seriesSchema.parse(VALID_SERIES)).not.toThrow();
  });

  test('rejects unknown scoringMode', () => {
    expect(() =>
      seriesSchema.parse({ ...VALID_SERIES, scoringMode: 'invalid' }),
    ).toThrow();
  });

  test('rejects unknown dnfScoring', () => {
    expect(() =>
      seriesSchema.parse({ ...VALID_SERIES, dnfScoring: 'something' }),
    ).toThrow();
  });

  test('rejects unknown primaryPersonLabel', () => {
    expect(() =>
      seriesSchema.parse({ ...VALID_SERIES, primaryPersonLabel: 'skipper' }),
    ).toThrow();
  });

  test('rejects non-uuid id', () => {
    expect(() => seriesSchema.parse({ ...VALID_SERIES, id: 'not-a-uuid' })).toThrow();
  });

  test('rejects when discardThresholds entry is malformed', () => {
    expect(() =>
      seriesSchema.parse({
        ...VALID_SERIES,
        discardThresholds: [{ minRaces: -1, discardCount: 1 }],
      }),
    ).toThrow();
  });
});

describe('seriesInputSchema', () => {
  test('id is optional', () => {
    const { id: _id, ...withoutId } = VALID_SERIES;
    void _id;
    expect(() => seriesInputSchema.parse(withoutId)).not.toThrow();
  });
});

describe('discardThresholdSchema', () => {
  test('rejects negative minRaces', () => {
    expect(() => discardThresholdSchema.parse({ minRaces: -1, discardCount: 0 })).toThrow();
  });

  test('rejects non-integer discardCount', () => {
    expect(() => discardThresholdSchema.parse({ minRaces: 4, discardCount: 1.5 })).toThrow();
  });
});

describe('startGroupSchema', () => {
  test('accepts zero intervalMinutes', () => {
    expect(() => startGroupSchema.parse({ fleetIds: [], intervalMinutes: 0 })).not.toThrow();
  });

  test('rejects negative intervalMinutes', () => {
    expect(() => startGroupSchema.parse({ fleetIds: [], intervalMinutes: -5 })).toThrow();
  });
});

describe('competitorFieldKeySchema', () => {
  test('accepts every known key', () => {
    for (const key of [
      'boatName',
      'boatClass',
      'helm',
      'owner',
      'crewName',
      'club',
      'nationality',
      'gender',
      'age',
    ]) {
      expect(() => competitorFieldKeySchema.parse(key)).not.toThrow();
    }
  });

  test('rejects unknown key', () => {
    expect(() => competitorFieldKeySchema.parse('rating')).toThrow();
  });
});

describe('primaryPersonLabelSchema', () => {
  test('accepts every known label', () => {
    for (const label of ['competitor', 'entrant', 'helm', 'owner']) {
      expect(() => primaryPersonLabelSchema.parse(label)).not.toThrow();
    }
  });
});
