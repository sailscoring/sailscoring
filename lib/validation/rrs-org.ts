import { z } from 'zod';

import type { RrsOrgCompetitor } from '@/lib/rrs-org';

import { uuidSchema } from './common';

/** One competitor row as the rrs.org API expects it — every field a string,
 *  empty (never null) when absent. Built client-side by `lib/rrs-org.ts` so
 *  the dialog can preview exactly what will be sent; re-validated here at the
 *  API boundary like every other `/api/v1` body. */
export const rrsOrgCompetitorSchema = z.object({
  competitor_id: z.string().min(1),
  sail_number: z.string(),
  country_code: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  boat_name: z.string(),
  boat_class: z.string(),
  division: z.string(),
  club_name: z.string(),
  email: z.string(),
  phone: z.string(),
  mna_code: z.string(),
  mna_number: z.string(),
});

/** Body for POST /api/v1/series/:id/rrs-org-push. The division-source pair is
 *  included so the handler can persist it (with the event UUID) as the
 *  series' remembered push settings. */
export const rrsOrgPushInputSchema = z.object({
  eventUuid: uuidSchema,
  divisionSource: z.enum(['none', 'fleet', 'axis']),
  divisionAxisId: z.string().optional(),
  competitors: z.array(rrsOrgCompetitorSchema).min(1),
});

export type RrsOrgPushInput = z.infer<typeof rrsOrgPushInputSchema>;

// ─── Type-fidelity guard ─────────────────────────────────────────────────────
// Keeps the row schema aligned with the payload type in `lib/rrs-org.ts`.
const _rowFromZod: RrsOrgCompetitor = undefined as unknown as z.infer<typeof rrsOrgCompetitorSchema>;
const _rowFromTs: z.infer<typeof rrsOrgCompetitorSchema> = undefined as unknown as RrsOrgCompetitor;
void _rowFromZod;
void _rowFromTs;
