import { z } from 'zod';

import { ALL_FEATURE_KEYS, type FeatureKey } from '@/lib/features';

/**
 * A single self-service feature toggle from the Workspace-settings features
 * card (#278). The `feature` must be a registered key; the handler additionally
 * rejects operator-managed (non-self-service) keys. `enabled` is the target
 * state, not a delta — the toggle is idempotent.
 */
export const featureToggleSchema = z.object({
  feature: z.enum(ALL_FEATURE_KEYS as unknown as [FeatureKey, ...FeatureKey[]]),
  enabled: z.boolean(),
});

export type FeatureToggleInput = z.infer<typeof featureToggleSchema>;

/**
 * The workspace's home club (#507) — the club whose workspace this is, as the
 * scorer would write it. An empty string clears it; the handler trims and
 * stores null. Capped well above any real club name so a paste accident is a
 * 400 rather than a stored essay.
 */
export const homeClubSchema = z.object({
  homeClub: z.string().max(120),
});

export type HomeClubInput = z.infer<typeof homeClubSchema>;
