// @vitest-environment node

/**
 * The publish handler's relative-URL derivation: what the championship
 * standings page writes as the href to its per-race results page. Pages of a
 * publication usually share one event folder, but frozen paths and overrides
 * can put the two anywhere under the slug.
 */
import { describe, expect, it } from 'vitest';

import { relativeSubPath } from '@/lib/api-handlers/publish';

describe('relativeSubPath', () => {
  it('reduces same-folder pages to the bare leaf', () => {
    expect(relativeSubPath('results', 'race-results')).toBe('race-results');
    expect(relativeSubPath('worlds/results', 'worlds/race-results')).toBe('race-results');
  });

  it('climbs out of the from-page folder when the folders differ', () => {
    expect(relativeSubPath('worlds/results', 'race-results')).toBe('../race-results');
    expect(relativeSubPath('a/results', 'b/race-results')).toBe('../b/race-results');
    expect(relativeSubPath('results', 'worlds/race-results')).toBe('worlds/race-results');
  });
});
