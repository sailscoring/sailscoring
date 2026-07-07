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
  isSelfServiceFeature,
  parseOrgMetadata,
  serializeOrgMetadata,
  type FeatureKey,
} from '@/lib/features';
import { featureToggleSchema } from '@/lib/validation/workspace';

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
 * Self-service feature toggle for the active workspace (#278). The route
 * already enforces `manage-workspace` (owner/admin); this handler adds the
 * self-service guard — operator-managed keys (`selfService: false`) are the
 * CLI's alone, so an attempt to flip one from the UI is a 403 rather than a
 * silent write. The mutation itself is the shared `applyFeatureToggle` policy,
 * read-modify-written server-side so the client only ever names one key.
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
  const next = applyFeatureToggle(meta, input.feature, input.enabled);
  await db
    .update(organization)
    .set({ metadata: serializeOrgMetadata(next) })
    .where(eq(organization.id, workspace.workspaceId));
  return {
    enabledFeatures: next.enabledFeatures,
    disabledFeatures: next.disabledFeatures,
  };
}
