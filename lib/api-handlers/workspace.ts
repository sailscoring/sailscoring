import 'server-only';

import { eq } from 'drizzle-orm';

import {
  ForbiddenError,
  type WorkspaceContext,
} from '@/lib/auth/require-workspace';
import { getDb } from '@/lib/db/client';
import { organization } from '@/lib/db/schema/auth';
import {
  applyFeatureToggle,
  FEATURES,
  isSelfServiceFeature,
  parseOrgMetadata,
  serializeOrgMetadata,
  type FeatureDef,
  type FeatureKey,
} from '@/lib/features';
import { featureToggleSchema, homeClubSchema } from '@/lib/validation/workspace';

/**
 * ADR-009 M4 — the caller's resolved identity and active workspace, for
 * `GET /api/v1/workspace` (the CLI's `whoami`). Everything here is already in
 * the request's `WorkspaceContext`, so there is no extra query: it just
 * projects the safe, caller-owned fields.
 */
export interface WorkspaceIdentity {
  userId: string;
  email: string;
  workspaceId: string;
  workspaceSlug: string;
  role: WorkspaceContext['role'];
  features: WorkspaceContext['features'];
}

export function workspaceIdentity(workspace: WorkspaceContext): WorkspaceIdentity {
  return {
    userId: workspace.userId,
    email: workspace.email,
    workspaceId: workspace.workspaceId,
    workspaceSlug: workspace.workspaceSlug,
    role: workspace.role,
    features: workspace.features,
  };
}

/**
 * Set (or clear) the workspace's home club (#507). In a club's own workspace
 * most competitors carry no club — everyone is assumed to be a member, and
 * only visitors to open events get the field filled in — so the identity
 * matcher reads a blank club as this one, and a visitor's stated club
 * genuinely fails to corroborate against a member's blank row.
 *
 * Stored on `organization.metadata` beside the feature flags, and read only by
 * the identity pass: the value is never written onto competitor rows, because
 * a workspace that scores an open event would then publish the assumption as
 * fact.
 */
export async function setWorkspaceHomeClub(
  workspace: WorkspaceContext,
  body: unknown,
): Promise<{ homeClub: string | null }> {
  const input = homeClubSchema.parse(body);
  const homeClub = input.homeClub.trim() || null;
  const db = getDb();
  const [row] = await db
    .select({ metadata: organization.metadata })
    .from(organization)
    .where(eq(organization.id, workspace.workspaceId))
    .limit(1);
  const meta = parseOrgMetadata(row?.metadata ?? null, workspace.workspaceSlug);
  await db
    .update(organization)
    .set({ metadata: serializeOrgMetadata({ ...meta, homeClub }) })
    .where(eq(organization.id, workspace.workspaceId));
  return { homeClub };
}

/**
 * Self-service feature toggle for the active workspace (#278). The route
 * already enforces `manage-workspace` (owner/admin); this handler adds the
 * self-service guard — operator-managed keys (`selfService: false`) are the
 * CLI's alone, so an attempt to flip one from the UI is a 403 rather than a
 * silent write. The mutation itself is the shared `applyFeatureToggle` policy,
 * read-modify-written server-side so the client only ever names one key.
 *
 * The first time a feature carrying a `demoSample` is switched on, we also seed
 * its worked example into the workspace (#256) so the scorer lands on a live,
 * editable demonstration rather than an empty affordance. Seeded once — a marker
 * in `seededFeatureSamples` keeps a later disable/re-enable (or a re-enable after
 * the demo was deleted) from resurrecting it — and best-effort, so a seeding
 * failure logs but never fails the toggle.
 */
export async function setWorkspaceFeature(
  workspace: WorkspaceContext,
  body: unknown,
): Promise<{ enabledFeatures: FeatureKey[]; disabledFeatures: FeatureKey[] }> {
  const input = featureToggleSchema.parse(body);
  if (!isSelfServiceFeature(input.feature)) {
    throw new ForbiddenError(`feature-not-self-service:${input.feature}`);
  }
  const db = getDb();
  const [row] = await db
    .select({ metadata: organization.metadata })
    .from(organization)
    .where(eq(organization.id, workspace.workspaceId))
    .limit(1);
  const meta = parseOrgMetadata(row?.metadata ?? null, workspace.workspaceSlug);
  const wasEnabled = meta.enabledFeatures.includes(input.feature);
  const next = applyFeatureToggle(meta, input.feature, input.enabled);

  // First-time enable of a feature with a worked example → seed it.
  const demoSample = (FEATURES[input.feature] as FeatureDef).demoSample;
  if (
    input.enabled &&
    !wasEnabled &&
    demoSample &&
    !meta.seededFeatureSamples.includes(input.feature)
  ) {
    try {
      const { seedFeatureSample } = await import('@/lib/sample-series/seed');
      await seedFeatureSample(input.feature, workspace.workspaceId, db);
      next.seededFeatureSamples = [...next.seededFeatureSamples, input.feature];
    } catch (err) {
      console.error(
        '[feature-sample] seeding failed for',
        input.feature,
        workspace.workspaceId,
        err,
      );
    }
  }

  await db
    .update(organization)
    .set({ metadata: serializeOrgMetadata(next) })
    .where(eq(organization.id, workspace.workspaceId));
  return {
    enabledFeatures: next.enabledFeatures,
    disabledFeatures: next.disabledFeatures,
  };
}
