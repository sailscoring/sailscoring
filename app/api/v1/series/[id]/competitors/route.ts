import {
  bulkDeleteCompetitors,
  bulkPutCompetitors,
  deleteCompetitors,
  listCompetitors,
  updateCompetitors,
} from '@/lib/api-handlers/competitors';
import { BadRequestError, workspaceRoute } from '../../../_lib/handler';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const GET = workspaceRoute<Params, unknown>(async (_req, { workspace, params }) => {
  return listCompetitors(workspace, params.id);
});

/** Bulk upsert. Use the per-competitor PUT route for single-row writes. */
export const POST = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const body = await req.json();
  return bulkPutCompetitors(workspace, params.id, body);
});

/** Bulk field set: write one field to one value across an `{ ids }` selection. */
export const PATCH = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const body = await req.json();
  return updateCompetitors(workspace, params.id, body);
});

/**
 * Collection delete. Without a body, drop every competitor in the series;
 * with an `{ ids }` body, drop just those.
 */
export const DELETE = workspaceRoute<Params, unknown>(async (req, { workspace, params }) => {
  const text = await req.text();
  if (!text) return bulkDeleteCompetitors(workspace, params.id);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new BadRequestError('invalid json body');
  }
  return deleteCompetitors(workspace, params.id, body);
});
