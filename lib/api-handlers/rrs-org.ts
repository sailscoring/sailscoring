import 'server-only';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  requireFeature,
  type WorkspaceContext,
} from '@/lib/auth/require-workspace';
import { recordActivity } from '@/lib/activity-log';
import { createRepos } from '@/lib/postgres-repository';
import {
  buildRrsOrgPayload,
  RRS_ORG_API_URL,
  type RrsOrgPushResult,
} from '@/lib/rrs-org';
import { rrsOrgPushInputSchema } from '@/lib/validation/rrs-org';
import type { RrsOrgPushConfig } from '@/lib/types';

import { assertSeriesWritable } from './series-access';

export type { RrsOrgPushResult };

/** Where the payload goes. Overridable for e2e, which points it at an
 *  RFC 6761 `.test` host — never routable, and recognised below. */
function rrsOrgUrl(): string {
  return process.env.RRS_ORG_API_URL || RRS_ORG_API_URL;
}

/** E2e stub, mirroring `sendFeedbackEmail`: a `.test` host writes the payload
 *  to `tests/.rrs-org.log` (one JSON line per push) instead of the network,
 *  so the suite can assert on what would have been sent. */
async function logStubPush(payload: unknown): Promise<void> {
  const file = path.join(process.cwd(), 'tests', '.rrs-org.log');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(
    file,
    JSON.stringify({ ts: new Date().toISOString(), payload }) + '\n',
    'utf8',
  );
}

/**
 * Push a competitor list to an rrs.org event and, on success, remember the
 * push settings on the series. The POST happens here, server-side: the event
 * UUID is the rrs.org API's only credential, and the rows may carry
 * CSV-relayed contact details that Sail Scoring never stores — neither
 * belongs on a browser-to-rrs.org hop.
 *
 * rrs.org's import replaces all competitors previously imported via its API
 * (manual entries are kept) — the dialog warns before the call; nothing to
 * enforce here.
 */
export async function pushCompetitorsToRrsOrg(
  workspace: WorkspaceContext,
  seriesId: string,
  body: unknown,
): Promise<RrsOrgPushResult> {
  // The gate is enforced server-side, not just by hiding the UI: the route
  // reaches an external service, so a direct hit must fail closed.
  requireFeature(workspace, 'rrs-import');
  const input = rrsOrgPushInputSchema.parse(body);
  await assertSeriesWritable(workspace, seriesId);

  const payload = buildRrsOrgPayload(input.eventUuid, input.competitors);
  const url = rrsOrgUrl();

  if (new URL(url).hostname.endsWith('.test')) {
    await logStubPush(payload);
  } else {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      return {
        ok: false,
        pushed: input.competitors.length,
        message: `Could not reach rrs.org: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 2000);
      return {
        ok: false,
        pushed: input.competitors.length,
        status: res.status,
        message: text || `rrs.org returned HTTP ${res.status}`,
      };
    }
    // A 200 body is empty by design; per-record warnings live on the rrs.org
    // Event Panel, which the dialog points the scorer at.
  }

  // Remember the settings for the next push. Only after success — a typo'd
  // UUID that rrs.org rejected must not become the remembered one.
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const current = await repos.series.get(seriesId);
  if (current) {
    const rrsOrgPush: RrsOrgPushConfig = {
      eventUuid: input.eventUuid,
      divisionSource: input.divisionSource,
      ...(input.divisionSource === 'axis' && input.divisionAxisId
        ? { divisionAxisId: input.divisionAxisId }
        : {}),
    };
    await repos.series.save(
      { ...current, rrsOrgPush },
      { updatedBy: workspace.userId },
    );
  }

  await recordActivity(workspace, {
    action: 'competitors.rrs_pushed',
    seriesId,
    summary: `Pushed ${input.competitors.length} competitors to rrs.org`,
  });

  return { ok: true, pushed: input.competitors.length };
}
