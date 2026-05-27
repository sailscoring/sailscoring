'use client';

/**
 * Experimental-feature gating, client side (#155). Carries the effective
 * feature set — computed server-side in the root layout via Model B — down to
 * client components that gate UI (importer buttons, the ECHO/NHC settings
 * controls, the keyboard-help list).
 *
 * Mirrors `workspace-memberships-provider`: data already resolved once per
 * render, made available without a client round-trip. Server callers should
 * use `WorkspaceContext.features` / `requireFeature` instead.
 */
import { createContext, useContext, type ReactNode } from 'react';

import type { FeatureKey } from '@/lib/features';

const FeaturesContext = createContext<readonly FeatureKey[] | null>(null);

export function FeaturesProvider({
  features,
  children,
}: {
  features: readonly FeatureKey[];
  children: ReactNode;
}) {
  return (
    <FeaturesContext.Provider value={features}>
      {children}
    </FeaturesContext.Provider>
  );
}

/**
 * Returns the effective feature set and a `has()` predicate. Defaults to no
 * features when no provider is present (e.g. signed-out), so callers can gate
 * with `has('x')` without a null check.
 */
export function useFeatures(): {
  features: readonly FeatureKey[];
  has: (key: FeatureKey) => boolean;
} {
  const features = useContext(FeaturesContext) ?? [];
  return { features, has: (key) => features.includes(key) };
}
