import 'server-only';

import { and, eq } from 'drizzle-orm';

import { BadRequestError, NotFoundError } from '@/app/api/v1/_lib/handler';
import {
  ForbiddenError,
  requireFeature,
  type WorkspaceContext,
} from '@/lib/auth/require-workspace';
import { getDb } from '@/lib/db/client';
import { member } from '@/lib/db/schema';
import {
  isAllowedLogoContentType,
  LOGO_CONTENT_TYPES,
  logoBlobKey,
  MAX_LOGO_BYTES,
} from '@/lib/flag-locker';
import {
  deleteLogo,
  putLogo,
  readLogo,
  sha256Hex,
} from '@/lib/flag-locker-storage';
import { createRepos } from '@/lib/postgres-repository';
import {
  logoCopySchema,
  logoCreateSchema,
  logoDefaultsSchema,
  logoUpdateSchema,
} from '@/lib/validation/logo';
import type { Logo, LogoDefaults } from '@/lib/types';

// The flag locker (per-workspace logo library) is an experimental, gated
// feature. The gate is enforced server-side on every endpoint — not just by
// hiding the card — since the routes could be hit directly.

/** Throw unless the caller is a member of `workspaceId`. The active workspace
 *  is already resolved by `workspaceRoute`; this guards reads/copies that reach
 *  into *another* workspace the caller claims to belong to (Phase 4). */
async function assertMember(userId: string, workspaceId: string): Promise<void> {
  const [row] = await getDb()
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, workspaceId), eq(member.userId, userId)))
    .limit(1);
  if (!row) throw new ForbiddenError('not-a-member-of-source-workspace');
}

/**
 * List the active workspace's logos, or — when `fromWorkspaceId` names another
 * workspace the caller belongs to — that workspace's logos (the source picker
 * for cross-workspace copy, Phase 4).
 */
export async function listLogos(
  workspace: WorkspaceContext,
  fromWorkspaceId?: string,
): Promise<Logo[]> {
  requireFeature(workspace, 'logo-library');
  if (fromWorkspaceId && fromWorkspaceId !== workspace.workspaceId) {
    await assertMember(workspace.userId, fromWorkspaceId);
    return createRepos({ workspaceId: fromWorkspaceId }).logos.list();
  }
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  return repos.logos.list();
}

export async function createLogo(
  workspace: WorkspaceContext,
  body: unknown,
): Promise<Logo> {
  requireFeature(workspace, 'logo-library');
  const input = logoCreateSchema.parse(body);

  if (!isAllowedLogoContentType(input.contentType)) {
    throw new BadRequestError(
      `unsupported logo format: ${input.contentType} (allowed: ${Object.keys(LOGO_CONTENT_TYPES).join(', ')})`,
    );
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(input.data, 'base64');
  } catch {
    throw new BadRequestError('logo data is not valid base64');
  }
  if (bytes.length === 0) throw new BadRequestError('logo data is empty');
  if (bytes.length > MAX_LOGO_BYTES) {
    throw new BadRequestError(
      `logo is too large: ${bytes.length} bytes (max ${MAX_LOGO_BYTES})`,
    );
  }

  const sha256 = sha256Hex(bytes);
  const key = logoBlobKey(workspace.workspaceId, sha256, input.contentType);
  const locator = await putLogo(key, bytes, input.contentType);

  const repos = createRepos({ workspaceId: workspace.workspaceId });
  return repos.logos.create(
    {
      id: input.id,
      displayName: input.displayName.trim(),
      logoClass: input.logoClass,
      locator,
      contentType: input.contentType,
      byteSize: bytes.length,
      sha256,
      sourceUrl: input.sourceUrl.trim(),
    },
    { updatedBy: workspace.userId },
  );
}

export async function updateLogo(
  workspace: WorkspaceContext,
  id: string,
  body: unknown,
): Promise<Logo> {
  requireFeature(workspace, 'logo-library');
  const input = logoUpdateSchema.parse(body);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const updated = await repos.logos.updateMeta(
    id,
    {
      displayName: input.displayName.trim(),
      logoClass: input.logoClass,
      sourceUrl: input.sourceUrl.trim(),
    },
    { updatedBy: workspace.userId },
  );
  if (!updated) throw new NotFoundError('logo');
  return updated;
}

export async function deleteLogoEntry(
  workspace: WorkspaceContext,
  id: string,
): Promise<void> {
  requireFeature(workspace, 'logo-library');
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const stored = await repos.logos.getStored(id);
  // Drop the row first, then the bytes — but only when no other logo (a
  // duplicate upload sharing the content-addressed key) still references them.
  await repos.logos.delete(id);
  // A workspace default pointing at this logo would now dangle — clear it.
  await repos.logos.clearDefaultsReferencingLogo(id);
  if (stored) {
    const stillUsed = await repos.logos.locatorReferencedElsewhere(
      stored.locator,
      id,
    );
    if (!stillUsed) await deleteLogo(stored.locator);
  }
}

export async function getLogoDefaults(
  workspace: WorkspaceContext,
): Promise<LogoDefaults> {
  requireFeature(workspace, 'logo-library');
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  return repos.logos.getDefaults();
}

export async function setLogoDefaults(
  workspace: WorkspaceContext,
  body: unknown,
): Promise<LogoDefaults> {
  requireFeature(workspace, 'logo-library');
  const input = logoDefaultsSchema.parse(body);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  return repos.logos.setDefaults(
    { venueLogoUrl: input.venueLogoUrl.trim(), eventLogoUrl: input.eventLogoUrl.trim() },
    { updatedBy: workspace.userId },
  );
}

/**
 * Copy a logo from another workspace the caller belongs to into the active
 * one (Phase 4). Copy, not reference: the bytes are re-stored under the target
 * workspace's own content-addressed key and a fresh row is created, so the copy
 * is unaffected if the source later edits or deletes its original.
 */
export async function copyLogoFromWorkspace(
  workspace: WorkspaceContext,
  body: unknown,
): Promise<Logo> {
  requireFeature(workspace, 'logo-library');
  const input = logoCopySchema.parse(body);
  if (input.sourceWorkspaceId === workspace.workspaceId) {
    throw new BadRequestError('source workspace must differ from the active one');
  }
  await assertMember(workspace.userId, input.sourceWorkspaceId);

  // Read the source row + bytes (scoped to the source workspace).
  const sourceRepos = createRepos({ workspaceId: input.sourceWorkspaceId });
  const meta = (await sourceRepos.logos.list()).find(
    (l) => l.id === input.sourceLogoId,
  );
  const stored = await sourceRepos.logos.getStored(input.sourceLogoId);
  if (!meta || !stored) throw new NotFoundError('logo');
  const bytes = await readLogo(stored.locator);
  if (!bytes) throw new NotFoundError('logo bytes');

  // Re-store under the target workspace's own key and create its own row.
  const key = logoBlobKey(workspace.workspaceId, meta.sha256, meta.contentType);
  const locator = await putLogo(key, bytes, meta.contentType);
  const targetRepos = createRepos({ workspaceId: workspace.workspaceId });
  return targetRepos.logos.create(
    {
      id: crypto.randomUUID(),
      displayName: meta.displayName,
      logoClass: meta.logoClass,
      locator,
      contentType: meta.contentType,
      byteSize: meta.byteSize,
      sha256: meta.sha256,
      sourceUrl: meta.sourceUrl,
    },
    { updatedBy: workspace.userId },
  );
}

/** Asset bytes for the management thumbnail, workspace-scoped. The public,
 *  unauthenticated indirection URL the renderer links to is a later phase. */
export async function readLogoBytes(
  workspace: WorkspaceContext,
  id: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  requireFeature(workspace, 'logo-library');
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const stored = await repos.logos.getStored(id);
  if (!stored) throw new NotFoundError('logo');
  const bytes = await readLogo(stored.locator);
  if (!bytes) throw new NotFoundError('logo bytes');
  return { bytes, contentType: stored.contentType };
}
