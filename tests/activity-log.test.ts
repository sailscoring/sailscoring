import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_ACTIONS,
  activityKind,
  type ActivityKind,
} from '@/lib/activity-actions';

describe('activityKind', () => {
  const cases: Array<[string, ActivityKind]> = [
    ['series.created', 'series'],
    ['series.deleted', 'series'],
    ['series.recategorized', 'series'],
    ['competitors.imported', 'competitor'],
    ['competitors.handicaps_updated', 'competitor'],
    ['race.added', 'race'],
    ['race.deleted', 'race'],
    ['finishes.recorded', 'finish'],
    ['finishes.entered', 'finish'],
  ];

  it.each(cases)('maps %s to %s', (action, kind) => {
    expect(activityKind(action)).toBe(kind);
  });

  it('classifies every action in the vocabulary as a known kind', () => {
    for (const action of ACTIVITY_ACTIONS) {
      expect(activityKind(action)).not.toBe('other');
    }
  });

  it('degrades unknown actions to "other" instead of throwing', () => {
    expect(activityKind('something.brand.new')).toBe('other');
    expect(activityKind('')).toBe('other');
  });
});
