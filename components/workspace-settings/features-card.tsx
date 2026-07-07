'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { useFeatures } from '@/components/features-provider';
import { Switch } from '@/components/ui/switch';
import { setWorkspaceFeature } from '@/lib/api-repository';
import { FEATURES, SELF_SERVICE_FEATURES, type FeatureKey } from '@/lib/features';

/**
 * Self-service feature toggles for the active workspace (#278). Owners and
 * admins (the page mounts this only under `manage-workspace`) turn optional
 * features on or off for everyone in the workspace, to keep the interface to
 * what the club actually uses. Only self-service features are listed;
 * operator-managed ones stay CLI-only and never appear here.
 *
 * State is read from the effective feature set (`useFeatures`), which the root
 * layout computes server-side; a toggle mutates the workspace metadata and
 * refreshes the router so that set — and every gated affordance across the
 * app — re-resolves.
 */
export function FeaturesCard() {
  const { has } = useFeatures();
  const router = useRouter();
  const [pending, setPending] = useState<FeatureKey | null>(null);

  async function toggle(feature: FeatureKey, enabled: boolean) {
    setPending(feature);
    try {
      await setWorkspaceFeature(feature, enabled);
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="bg-card rounded-lg border p-5 space-y-4">
      <div>
        <h2 className="text-sm font-medium">Features</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Turn optional features on or off for everyone in this workspace.
          Switching one off hides its controls to keep the interface simple;
          any data you already entered is kept.
        </p>
      </div>
      <div className="space-y-2">
        {SELF_SERVICE_FEATURES.map((key) => (
          <div
            key={key}
            className="flex items-center justify-between gap-3 border rounded-md px-3 py-2"
          >
            <label htmlFor={`feature-${key}`} className="text-sm cursor-pointer">
              {FEATURES[key].label}
            </label>
            <div className="flex items-center gap-2">
              {pending === key && (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
              <Switch
                id={`feature-${key}`}
                data-testid={`feature-toggle-${key}`}
                checked={has(key)}
                disabled={pending === key}
                onCheckedChange={(next) => toggle(key, next)}
                aria-label={FEATURES[key].label}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
