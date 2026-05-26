import 'server-only';
import { and, desc, eq } from 'drizzle-orm';

import { BadRequestError } from '@/app/api/v1/_lib/handler';
import { sendOrgRequestEmail } from '@/lib/auth/email';
import { getDb } from '@/lib/db/client';
import { orgRequest } from '@/lib/db/schema/auth';
import { orgRequestInputSchema } from '@/lib/validation/org-request';
import type { OrgRequest } from '@/lib/types';

/**
 * Self-service org-creation requests (#153, iteration 3). A signed-in user
 * asks for a shared workspace; the project owner is notified and fulfils it
 * with the provision-org CLI. The request is always recorded in the DB so the
 * owner can find it via `provision-org list-requests` even if email is down.
 */

type OrgRequestRow = typeof orgRequest.$inferSelect;

function toDto(row: OrgRequestRow): OrgRequest {
  return {
    id: row.id,
    requestedName: row.requestedName,
    note: row.note,
    status: row.status as OrgRequest['status'],
    createdAt: row.createdAt.toISOString(),
  };
}

/** The caller's most recent request, or null — drives the /account status line. */
export async function getMyOrgRequest(userId: string): Promise<{ request: OrgRequest | null }> {
  const [row] = await getDb()
    .select()
    .from(orgRequest)
    .where(eq(orgRequest.userId, userId))
    .orderBy(desc(orgRequest.createdAt))
    .limit(1);
  return { request: row ? toDto(row) : null };
}

export async function submitOrgRequest(
  actor: { userId: string; email: string },
  body: unknown,
): Promise<OrgRequest> {
  const input = orgRequestInputSchema.parse(body);
  const db = getDb();

  // One open request at a time (also enforced by the partial unique index;
  // this gives a friendly 400 instead of a constraint error).
  const [pending] = await db
    .select({ id: orgRequest.id })
    .from(orgRequest)
    .where(and(eq(orgRequest.userId, actor.userId), eq(orgRequest.status, 'pending')))
    .limit(1);
  if (pending) {
    throw new BadRequestError('You already have a pending workspace request.');
  }

  const [row] = await db
    .insert(orgRequest)
    .values({
      id: crypto.randomUUID(),
      userId: actor.userId,
      userEmail: actor.email,
      requestedName: input.requestedName,
      note: input.note ?? null,
    })
    .returning();

  // Best-effort owner notification; the DB row is the source of truth.
  const to = process.env.ORG_REQUEST_TO || process.env.FEEDBACK_TO;
  if (to) {
    try {
      await sendOrgRequestEmail({
        to,
        requesterEmail: actor.email,
        requestedName: input.requestedName,
        note: input.note,
      });
    } catch (err) {
      console.error('org-request notification email failed (non-fatal):', err);
    }
  }

  return toDto(row);
}
