import { z } from 'zod';

/**
 * Self-service org-creation request (#153). Validated at the
 * POST /api/v1/org-requests boundary.
 */
export const orgRequestInputSchema = z.object({
  requestedName: z
    .string()
    .trim()
    .min(1, 'A workspace name is required')
    .max(100, 'Workspace name is too long'),
  note: z.string().trim().max(500, 'Note is too long').optional(),
});

export type OrgRequestInput = z.infer<typeof orgRequestInputSchema>;
