import 'server-only';

import { eq } from 'drizzle-orm';

import {
  ForbiddenError,
  type WorkspaceContext,
} from '@/lib/auth/require-workspace';
import { getDb } from '@/lib/db/client';
import { organization } from '@/lib/db/schema/auth';
import { recordActivity } from '@/lib/activity-log';
import {
  applyFeatureToggle,
  FEATURES,
  isSelfServiceFeature,
  listedInDirectory,
  parseOrgMetadata,
  serializeOrgMetadata,
  type FeatureDef,
  type FeatureKey,
  type DirectorySettings,
} from '@/lib/features';
import { purgeDirectoryCache } from '@/lib/published-cache';
import {
  directorySettingsSchema,
  featureToggleSchema,
} from '@/lib/validation/workspace';

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

async function readMetadata(workspace: WorkspaceContext) {
  const [row] = await getDb()
    .select({ metadata: organization.metadata })
    .from(organization)
    .where(eq(organization.id, workspace.workspaceId))
    .limit(1);
  return parseOrgMetadata(row?.metadata ?? null, workspace.workspaceSlug);
}

export async function getDirectorySettings(
  workspace: WorkspaceContext,
): Promise<DirectorySettings> {
  const meta = await readMetadata(workspace);
  return {
    kind: meta.kind,
    listed: listedInDirectory(meta),
    description: meta.directory?.description ?? '',
  };
}

/**
 * Set the active workspace's directory entry: whether it is listed, and its
 * description. A personal workspace is never listed, so it can't be opted in
 * (a 403, not a silent no-op). Logged to the activity feed — whether a club
 * is advertised is a decision the rest of its panel should be able to see —
 * and the directory's CDN copy is dropped so the change shows at once.
 */
export async function setDirectorySettings(
  workspace: WorkspaceContext,
  body: unknown,
): Promise<DirectorySettings> {
  const input = directorySettingsSchema.parse(body);
  const meta = await readMetadata(workspace);
  if (meta.kind !== 'club') {
    throw new ForbiddenError('directory-club-only');
  }
  const before = await getDirectorySettings(workspace);
  const next = {
    ...meta,
    directory: {
      ...(input.listed ? {} : { unlisted: true }),
      ...(input.description ? { description: input.description } : {}),
    },
  };
  await getDb()
    .update(organization)
    .set({ metadata: serializeOrgMetadata(next) })
    .where(eq(organization.id, workspace.workspaceId));
  const after: DirectorySettings = {
    kind: meta.kind,
    listed: input.listed,
    description: input.description,
  };

  if (before.listed !== after.listed || before.description !== after.description) {
    await recordActivity(workspace, {
      action: 'publish.directory-updated',
      summary:
        before.listed !== after.listed
          ? after.listed
            ? 'Listed the workspace in the public directory'
            : 'Took the workspace out of the public directory'
          : 'Changed the workspace’s directory description',
    });
    await purgeDirectoryCache();
  }
  return after;
}
