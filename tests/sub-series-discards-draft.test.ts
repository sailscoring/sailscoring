import { describe, it, expect } from 'vitest';
import { subSeriesDiscardsDraft, subSeriesDiscardsOfDraft } from '@/components/series-settings/sub-series-discards';
import { summarizeDiscards, summarizeSubSeriesDiscards } from '@/lib/discard-rules';
import type { SubSeriesDiscards } from '@/lib/types';

const seriesSteps = [{ minRaces: 4, discardCount: 1 }];

describe('the sub-series dialog\'s discard draft', () => {
  it('round-trips every stored rule', () => {
    const rules: (SubSeriesDiscards | undefined)[] = [
      undefined,
      { kind: 'none' },
      { kind: 'countBest', countBest: 3 },
      { kind: 'steps', thresholds: [{ minRaces: 3, discardCount: 1 }] },
      { kind: 'proportional', firstAt: 2, everyRaces: 4 },
    ];
    for (const rule of rules) {
      expect(subSeriesDiscardsOfDraft(subSeriesDiscardsDraft(rule, seriesSteps)).discards).toEqual(rule);
    }
  });

  it('starts a rule of its own from the series\' thresholds', () => {
    const draft = { ...subSeriesDiscardsDraft(undefined, seriesSteps), choice: 'own' as const };
    expect(subSeriesDiscardsOfDraft(draft).discards).toEqual({ kind: 'steps', thresholds: seriesSteps });
  });

  it('saves step rules in order, and refuses a count of no races', () => {
    const draft = subSeriesDiscardsDraft(undefined, []);
    expect(subSeriesDiscardsOfDraft({
      ...draft, choice: 'own', thresholds: [{ minRaces: 8, discardCount: 2 }, { minRaces: 4, discardCount: 1 }],
    }).discards).toEqual({ kind: 'steps', thresholds: [{ minRaces: 4, discardCount: 1 }, { minRaces: 8, discardCount: 2 }] });
    expect(subSeriesDiscardsOfDraft({ ...draft, choice: 'countBest', countBest: 0 }).error).toMatch(/at least 1/);
  });
});

describe('a discard rule in a line', () => {
  it('states whichever rule scores', () => {
    expect(summarizeDiscards(seriesSteps, { countBest: 5 })).toBe('Best 5 count');
    expect(summarizeDiscards(seriesSteps, undefined)).toBe('1 discard from 4 races');
    expect(summarizeDiscards([], undefined)).toBe('No discards');
  });
  it('states a sub-series\' own rule', () => {
    expect(summarizeSubSeriesDiscards({ kind: 'none' })).toBe('No discards');
    expect(summarizeSubSeriesDiscards({ kind: 'countBest', countBest: 3 })).toBe('Best 3 count');
    expect(summarizeSubSeriesDiscards({ kind: 'proportional', firstAt: 3, everyRaces: 3 })).toBe('1 discard per 3 races sailed, from 3 races');
  });
});
