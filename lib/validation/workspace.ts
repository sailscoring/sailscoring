import { z } from 'zod';

import {
  ALL_FEATURE_KEYS,
  DIRECTORY_DESCRIPTION_MAX,
  type FeatureKey,
} from '@/lib/features';

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
 * The workspace's entry in the public directory at `/p/`: whether it is
 * listed, and the one line under its name. Target state, not a delta.
 */
export const directorySettingsSchema = z.object({
  listed: z.boolean(),
  description: z.string().trim().max(DIRECTORY_DESCRIPTION_MAX),
});

export type DirectorySettingsInput = z.infer<typeof directorySettingsSchema>;
