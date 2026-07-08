import { describe, it, expect } from 'vitest';

import { disabledConfigFeatures } from '@/lib/series-feature-hints';
import type { FeatureKey } from '@/lib/features';

/** A `has()` predicate over a fixed enabled set. */
const hasFrom = (enabled: FeatureKey[]) => (k: FeatureKey) => enabled.includes(k);

describe('disabledConfigFeatures (#280)', () => {
  it('hints a feature whose config is present but which is off', () => {
    const out = disabledConfigFeatures({ 'sub-series': true }, hasFrom([]));
    expect(out.map((h) => h.feature)).toEqual(['sub-series']);
    expect(out[0].label).toBe('Sub-series');
    expect(out[0].noun).toBe('sub-series');
  });

  it('stays silent when the feature is enabled', () => {
    expect(
      disabledConfigFeatures({ 'sub-series': true }, hasFrom(['sub-series'])),
    ).toEqual([]);
  });

  it('stays silent when the series carries no such config', () => {
    expect(disabledConfigFeatures({ 'sub-series': false }, hasFrom([]))).toEqual([]);
    expect(disabledConfigFeatures({}, hasFrom([]))).toEqual([]);
  });

  it('hints several disabled config features at once', () => {
    const out = disabledConfigFeatures(
      { 'sub-series': true, 'combined-pages': true },
      hasFrom([]),
    );
    expect(out.map((h) => h.feature).sort()).toEqual(['combined-pages', 'sub-series']);
  });

  it('hints only the disabled ones in a mixed state', () => {
    const out = disabledConfigFeatures(
      { 'sub-series': true, 'combined-pages': true },
      hasFrom(['combined-pages']),
    );
    expect(out.map((h) => h.feature)).toEqual(['sub-series']);
  });
});
