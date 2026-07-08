/**
 * Disabled-feature hints (#280).
 *
 * Feature gating (#155) contains the *authoring surface*, not the data: a
 * series that already carries config for a gated feature keeps rendering and
 * publishing it even when the feature is off. So a series can arrive — seeded,
 * imported, or copied — carrying sub-series or combined-page config into a
 * workspace that has the feature switched off, and the scorer sees the rendered
 * output with no card to explain or edit it.
 *
 * This module enumerates the gated features that own persistent *series* config
 * and, given which of them a series actually carries, returns the ones whose
 * feature is off — the set the Settings tab shows a hint for. Pure (no React, no
 * DB) so it unit-tests directly.
 */

import { FEATURES, isSelfServiceFeature, type FeatureDef, type FeatureKey } from './features';

/** A config-owning feature to hint about: its key, human label, and a short
 *  noun for the config the series carries. */
export interface ConfigOwningFeature {
  feature: FeatureKey;
  label: string;
  /** Short lower-case noun for what the series carries, e.g. "sub-series". */
  noun: string;
}

/** The gated features whose persistent config lives on (or hangs off) a series.
 *  To add one: register its key + noun here and feed its presence into
 *  `disabledConfigFeatures`. */
const CONFIG_OWNING: { feature: FeatureKey; noun: string }[] = [
  { feature: 'sub-series', noun: 'sub-series' },
  { feature: 'combined-pages', noun: 'combined pages' },
];

/**
 * The config-owning features this series carries but whose feature is currently
 * off — the ones to hint about. `present` marks which config the series
 * actually has; `has` is the effective-feature predicate.
 *
 * Restricted to self-service features: an operator-managed feature can't be
 * flipped from the settings card, so an "enable it yourself" hint would only
 * mislead — those stay silent for the first cut.
 */
export function disabledConfigFeatures(
  present: Partial<Record<FeatureKey, boolean>>,
  has: (key: FeatureKey) => boolean,
): ConfigOwningFeature[] {
  return CONFIG_OWNING.filter(
    (c) => present[c.feature] && !has(c.feature) && isSelfServiceFeature(c.feature),
  ).map((c) => ({
    feature: c.feature,
    label: (FEATURES[c.feature] as FeatureDef).label,
    noun: c.noun,
  }));
}
