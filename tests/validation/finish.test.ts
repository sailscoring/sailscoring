import { describe, test, expect } from 'vitest';

import {
  finishSchema,
  finishesBulkInputSchema,
  penaltyCodeSchema,
  redressMethodSchema,
  resultCodeSchema,
} from '@/lib/validation/finish';
import type { Finish } from '@/lib/types';

const FINISH_BASE: Finish = {
  id: crypto.randomUUID(),
  raceId: crypto.randomUUID(),
  competitorId: crypto.randomUUID(),
  sortOrder: 1,
  finishTime: '12:00:00',
  resultCode: null,
  startPresent: true,
  penaltyCode: null,
  penaltyOverride: null,
  redressMethod: null,
  redressExcludeRaces: null,
  redressIncludeRaces: null,
  tiedWithPrevious: false, redressIncludeAllLater: false,
  redressPoints: null,
};

describe('finishSchema', () => {
  test('accepts a plain finishing record', () => {
    expect(() => finishSchema.parse(FINISH_BASE)).not.toThrow();
  });

  test('accepts a coded finish (DNF)', () => {
    expect(() =>
      finishSchema.parse({
        ...FINISH_BASE,
        sortOrder: null,
        finishTime: undefined,
        resultCode: 'DNF',
      }),
    ).not.toThrow();
  });

  test('accepts an unresolved unknown finish', () => {
    expect(() =>
      finishSchema.parse({
        ...FINISH_BASE,
        competitorId: null,
        unknownSailNumber: '1234',
      }),
    ).not.toThrow();
  });

  test('accepts an RDG finish with full redress payload', () => {
    expect(() =>
      finishSchema.parse({
        ...FINISH_BASE,
        resultCode: 'RDG',
        redressMethod: 'races_before',
        redressExcludeRaces: [2],
        redressIncludeRaces: [1, 3],
        redressIncludeAllLater: true,
        redressPoints: 4,
      }),
    ).not.toThrow();
  });

  test('accepts a finish with a ZFP penalty', () => {
    expect(() =>
      finishSchema.parse({ ...FINISH_BASE, penaltyCode: 'ZFP' }),
    ).not.toThrow();
  });

  test('rejects unknown resultCode', () => {
    expect(() =>
      finishSchema.parse({ ...FINISH_BASE, resultCode: 'XYZ' }),
    ).toThrow();
  });

  test('rejects unknown penaltyCode', () => {
    expect(() =>
      finishSchema.parse({ ...FINISH_BASE, penaltyCode: 'WHO' }),
    ).toThrow();
  });

  test('rejects unknown redressMethod', () => {
    expect(() =>
      finishSchema.parse({ ...FINISH_BASE, redressMethod: 'random' }),
    ).toThrow();
  });

  test('rejects non-integer redressExcludeRaces entries', () => {
    expect(() =>
      finishSchema.parse({ ...FINISH_BASE, redressExcludeRaces: [1.5] }),
    ).toThrow();
  });
});

describe('finishesBulkInputSchema', () => {
  test('accepts a list of finishes', () => {
    expect(() =>
      finishesBulkInputSchema.parse({ finishes: [FINISH_BASE, FINISH_BASE] }),
    ).not.toThrow();
  });

  test('rejects when a finish is malformed', () => {
    expect(() =>
      finishesBulkInputSchema.parse({
        finishes: [{ ...FINISH_BASE, resultCode: 'XYZ' }],
      }),
    ).toThrow();
  });
});

describe('enum schemas', () => {
  test('resultCodeSchema covers every code in the union', () => {
    for (const code of ['DNC', 'DNS', 'OCS', 'NSC', 'DNF', 'RET', 'DSQ', 'DNE', 'UFD', 'BFD', 'RDG']) {
      expect(() => resultCodeSchema.parse(code)).not.toThrow();
    }
  });

  test('penaltyCodeSchema covers every code in the union', () => {
    for (const code of ['ZFP', 'SCP', 'DPI']) {
      expect(() => penaltyCodeSchema.parse(code)).not.toThrow();
    }
  });

  test('redressMethodSchema covers every method', () => {
    for (const m of ['all_races', 'races_before', 'stated']) {
      expect(() => redressMethodSchema.parse(m)).not.toThrow();
    }
  });
});
