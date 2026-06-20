import { ApiError, ValidationApiError } from '@/lib/api-client';

/**
 * Turn an error thrown while opening / importing a series file into a message
 * for the "Could not open file" dialog.
 *
 * The point is to stop collapsing every failure into "Please try again." Three
 * outcomes are genuinely different:
 *
 *  - **Validation rejection (400).** The file reached the server but a field is
 *    missing or malformed — typically a sparse file from an external tool. This
 *    is deterministic: retrying does nothing. We name the offending fields so a
 *    user's report is self-diagnosing, and we don't offer a retry.
 *  - **Server / network failure (5xx, fetch reject).** Genuinely transient —
 *    here "try again" is honest advice.
 *  - **Anything else.** Surface the underlying message if we have one, but don't
 *    promise that a retry will help.
 *
 * The `.issues` payload this reads is already carried end-to-end (the API
 * returns it in the 400 body, `apiFetch` stashes it on `ValidationApiError`);
 * it was simply being discarded at the catch site.
 */
export function describeOpenSeriesError(err: unknown): string {
  if (err instanceof ValidationApiError) {
    const fields = validationFieldList(err.issues);
    if (fields.length > 0) {
      return `This file can't be opened: it's missing or has invalid values for ${formatFieldList(fields)}. It may have been produced by an incompatible tool or an older version of Sail Scoring.`;
    }
    return "This file can't be opened: it didn't pass validation. It may have been produced by an incompatible tool or an older version of Sail Scoring.";
  }

  // A server error is worth retrying; the file itself may be fine.
  if (err instanceof ApiError && err.status >= 500) {
    return 'Something went wrong on our end. Please try again.';
  }

  // A bare fetch reject never becomes an ApiError — it's a TypeError whose
  // message mentions "fetch". Treat it as a connectivity problem.
  if (!(err instanceof ApiError) && err instanceof Error && /fetch/i.test(err.message)) {
    return 'Could not reach the server. Check your connection and try again.';
  }

  return err instanceof Error && err.message
    ? `Could not open the file: ${err.message}`
    : 'Could not open the file.';
}

/** How many field names to name before collapsing the rest into "and N more". */
const MAX_NAMED_FIELDS = 8;

/**
 * Pull the distinct leaf field names out of a Zod issues array (as serialized
 * in the 400 body). For a nested path like `["competitors", 3, "club"]` the
 * leaf (`club`) is what's actionable, not the index. Defensive about shape:
 * `issues` is typed `unknown` because it crosses the wire.
 */
function validationFieldList(issues: unknown): string[] {
  if (!Array.isArray(issues)) return [];
  const seen = new Set<string>();
  for (const issue of issues) {
    if (typeof issue !== 'object' || issue === null) continue;
    const path = (issue as { path?: unknown }).path;
    if (!Array.isArray(path) || path.length === 0) continue;
    const leaf = path[path.length - 1];
    if (typeof leaf === 'string') seen.add(leaf);
  }
  return [...seen];
}

function formatFieldList(fields: string[]): string {
  const named = fields.slice(0, MAX_NAMED_FIELDS);
  const remainder = fields.length - named.length;
  const parts = remainder > 0 ? [...named, `${remainder} more`] : named;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}
