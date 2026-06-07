import { z } from 'zod';

import { LOGO_CLASSES } from '@/lib/flag-locker';
import type { LogoClass } from '@/lib/types';

import { uuidSchema } from './common';

/** The logo classes as a Zod enum, derived from the single source in
 *  `flag-locker.ts` so the two never drift. */
export const logoClassSchema = z.enum(
  LOGO_CLASSES as unknown as [LogoClass, ...LogoClass[]],
);

/**
 * Create payload from the upload card. `data` is the asset bytes base64-encoded
 * (the JSON `apiFetch` wrapper can't carry binary); the handler decodes it,
 * enforces the size and content-type limits, and computes the `sha256` — none
 * of which is trusted from the client.
 */
export const logoCreateSchema = z.object({
  id: uuidSchema,
  displayName: z.string().min(1).max(200),
  logoClass: logoClassSchema,
  contentType: z.string().min(1),
  data: z.string().min(1),
  sourceUrl: z.string().max(2000).optional().default(''),
});

/** Metadata-only edit (rename / reclassify / re-source). Never touches bytes. */
export const logoUpdateSchema = z.object({
  displayName: z.string().min(1).max(200),
  logoClass: logoClassSchema,
  sourceUrl: z.string().max(2000).optional().default(''),
});

/** Workspace default venue/event logo URLs (Phase 3). '' = no default. */
export const logoDefaultsSchema = z.object({
  venueLogoUrl: z.string().max(2000),
  eventLogoUrl: z.string().max(2000),
});

/** Copy a logo from another workspace the caller belongs to into the active
 *  one (Phase 4). Copy, not reference — the target gets its own bytes + row. */
export const logoCopySchema = z.object({
  sourceWorkspaceId: z.string().min(1),
  sourceLogoId: uuidSchema,
});

/** The workspace's own logo URL (`organization.logo`). '' clears it. */
export const workspaceLogoSchema = z.object({
  logo: z.string().max(2000),
});

export type LogoCreateInput = z.infer<typeof logoCreateSchema>;
export type LogoUpdateInput = z.infer<typeof logoUpdateSchema>;
