import 'server-only';

import { BadRequestError, NotFoundError } from '@/app/api/v1/_lib/handler';
import { requireFeature, type WorkspaceContext } from '@/lib/auth/require-workspace';
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
import { logoCreateSchema, logoUpdateSchema } from '@/lib/validation/logo';
import type { Logo } from '@/lib/types';

// The flag locker (per-workspace logo library) is an experimental, gated
// feature. The gate is enforced server-side on every endpoint — not just by
// hiding the card — since the routes could be hit directly.

export async function listLogos(workspace: WorkspaceContext): Promise<Logo[]> {
  requireFeature(workspace, 'logo-library');
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
  if (stored) {
    const stillUsed = await repos.logos.locatorReferencedElsewhere(
      stored.locator,
      id,
    );
    if (!stillUsed) await deleteLogo(stored.locator);
  }
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
