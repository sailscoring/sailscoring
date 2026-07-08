'use client';

import Link from 'next/link';

/**
 * Inline hint on the series Settings tab when the series carries config for a
 * self-service feature that's currently switched off (#280). The gate hides the
 * feature's authoring card, so without this the scorer sees the rendered output
 * (sub-series blocks, combined pages) with no signal the feature exists or that
 * they could turn it on. Read-only-safe: the config keeps rendering and
 * publishing regardless — this only restores discoverability and editability.
 */
export function DisabledFeatureHint({
  label,
  noun,
  canManageWorkspace,
}: {
  label: string;
  noun: string;
  canManageWorkspace: boolean;
}) {
  return (
    <section className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
      <p>
        This series uses <strong className="text-foreground">{label}</strong>, which isn&apos;t
        enabled for this workspace, so its controls are hidden.{' '}
        {canManageWorkspace ? (
          <>
            <Link
              href="/workspace"
              className="text-foreground underline underline-offset-2"
            >
              Enable it in Workspace settings
            </Link>{' '}
            to view and edit.
          </>
        ) : (
          <>Ask a workspace admin to enable it in Workspace settings to view and edit.</>
        )}{' '}
        The existing {noun} keep publishing either way.
      </p>
    </section>
  );
}
