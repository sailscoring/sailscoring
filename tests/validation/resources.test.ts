import { describe, test, expect } from 'vitest';

import { competitorSchema } from '@/lib/validation/competitor';
import { fleetSchema, scoringSystemSchema } from '@/lib/validation/fleet';
import { raceSchema } from '@/lib/validation/race';
import { raceStartSchema } from '@/lib/validation/race-start';
import type { Competitor, Fleet, Race, RaceStart } from '@/lib/types';

const UUID_A = crypto.randomUUID();
const UUID_B = crypto.randomUUID();
const UUID_C = crypto.randomUUID();

const FLEET: Fleet = {
  id: UUID_A,
  seriesId: UUID_B,
  name: 'NHC',
  displayOrder: 0,
  scoringSystem: 'nhc',
};

const COMPETITOR: Competitor = {
  id: UUID_A,
  seriesId: UUID_B,
  fleetIds: [UUID_C],
  sailNumber: 'IRL-1',
  name: 'Helm',
  club: 'HYC',
  gender: 'M',
  age: 40,
  createdAt: 1,
};

const RACE: Race = {
  id: UUID_A,
  seriesId: UUID_B,
  raceNumber: 3,
  date: '2026-04-12',
  createdAt: 1,
};

const RACE_START: RaceStart = {
  id: UUID_A,
  raceId: UUID_B,
  fleetIds: [UUID_C],
  startTime: '11:00:00',
};

describe('fleetSchema', () => {
  test('accepts a valid NHC fleet', () => {
    expect(() => fleetSchema.parse(FLEET)).not.toThrow();
  });

  test('rejects an unknown scoringSystem', () => {
    expect(() => fleetSchema.parse({ ...FLEET, scoringSystem: 'foo' })).toThrow();
  });

  test('scoringSystemSchema accepts every known system', () => {
    for (const s of ['scratch', 'irc', 'py', 'nhc', 'echo']) {
      expect(() => scoringSystemSchema.parse(s)).not.toThrow();
    }
  });
});

describe('competitorSchema', () => {
  test('accepts a minimal competitor', () => {
    expect(() => competitorSchema.parse(COMPETITOR)).not.toThrow();
  });

  test('accepts every gender enum', () => {
    for (const g of ['M', 'F', '']) {
      expect(() => competitorSchema.parse({ ...COMPETITOR, gender: g })).not.toThrow();
    }
  });

  test('rejects an unknown gender', () => {
    expect(() => competitorSchema.parse({ ...COMPETITOR, gender: 'X' })).toThrow();
  });

  test('rejects a non-uuid fleetId', () => {
    expect(() => competitorSchema.parse({ ...COMPETITOR, fleetIds: ['nope'] })).toThrow();
  });

  test('age may be null', () => {
    expect(() => competitorSchema.parse({ ...COMPETITOR, age: null })).not.toThrow();
  });

  test('nationality accepts any 3-letter uppercase code', () => {
    expect(() => competitorSchema.parse({ ...COMPETITOR, nationality: 'IRL' })).not.toThrow();
    expect(() => competitorSchema.parse({ ...COMPETITOR, nationality: 'ZZZ' })).not.toThrow();
  });

  test('nationality rejects malformed codes', () => {
    // Lowercase, wrong length, and stray characters all rejected — the
    // dropdown normalises to uppercase before this point. Forward-compat
    // with dataset bumps is preserved (no enum check here).
    expect(() => competitorSchema.parse({ ...COMPETITOR, nationality: 'irl' })).toThrow();
    expect(() => competitorSchema.parse({ ...COMPETITOR, nationality: 'IR' })).toThrow();
    expect(() => competitorSchema.parse({ ...COMPETITOR, nationality: 'IRLD' })).toThrow();
    expect(() => competitorSchema.parse({ ...COMPETITOR, nationality: 'IR1' })).toThrow();
  });
});

describe('raceSchema', () => {
  test('accepts a valid race', () => {
    expect(() => raceSchema.parse(RACE)).not.toThrow();
  });

  test('rejects raceNumber 0', () => {
    expect(() => raceSchema.parse({ ...RACE, raceNumber: 0 })).toThrow();
  });

  test('rejects negative raceNumber', () => {
    expect(() => raceSchema.parse({ ...RACE, raceNumber: -1 })).toThrow();
  });
});

describe('raceStartSchema', () => {
  test('accepts a valid race start', () => {
    expect(() => raceStartSchema.parse(RACE_START)).not.toThrow();
  });

  test('rejects a non-uuid raceId', () => {
    expect(() => raceStartSchema.parse({ ...RACE_START, raceId: 'no' })).toThrow();
  });
});
