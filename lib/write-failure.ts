import {
  ApiError,
  ArchivedApiError,
  ForbiddenApiError,
  NotFoundApiError,
  UpstreamApiError,
  ValidationApiError,
} from '@/lib/api-client';
import { READ_ONLY_MESSAGES } from '@/lib/open-series-error';

/**
 * Turn a write that failed into a sentence for the scorer.
 *
 * The companion of `describeOpenSeriesError`, for the other direction: not a
 * file that wouldn't open, but a change that didn't save. Same principle —
 * collapsing every failure into "try again" tells someone to repeat an action
 * that is either pointless (they don't have permission, the series is
 * read-only) or fine to repeat (the server blipped), and they can't tell
 * which. It is also pure, so the wording is testable without a renderer.
 *
 * Every message says the change wasn't saved, because that is the one thing
 * true of all of them and the thing the scorer has to act on: whatever they
 * just typed is still theirs to re-enter.
 */
export function describeWriteFailure(err: unknown): string {
  // The series can't be written at all, and each state is a different thing
  // to do about it. Same three sentences the file-open path uses.
  if (err instanceof ArchivedApiError) return READ_ONLY_MESSAGES[err.reason];

  // `reason` is a machine code (`permission-denied:manage-series`,
  // `feature-disabled:…`), so it isn't repeated to the scorer. What it comes
  // down to for them is the same either way.
  if (err instanceof ForbiddenApiError) {
    return 'Couldn’t save — you don’t have permission to make that change.';
  }

  if (err instanceof NotFoundApiError) {
    return 'Couldn’t save — that’s no longer there. It may have been deleted. Reload the page.';
  }

  // A third party the server read on the scorer's behalf failed, and the
  // server wrote that sentence for them.
  if (err instanceof UpstreamApiError) return err.message;

  // The server rejected the shape of what we sent. Deterministic, so a retry
  // does nothing; it's ours to fix, not theirs.
  if (err instanceof ValidationApiError) {
    return 'Couldn’t save — the server rejected the change as invalid. Nothing was saved.';
  }

  if (err instanceof ApiError && err.status >= 500) {
    return 'Couldn’t save — something went wrong on our end. Try again.';
  }

  // A bare fetch reject never becomes an ApiError — it's a TypeError whose
  // message mentions "fetch". Treat it as a connectivity problem.
  if (!(err instanceof ApiError) && err instanceof Error && /fetch/i.test(err.message)) {
    return 'Couldn’t save — the server couldn’t be reached. Check your connection and try again.';
  }

  return 'Couldn’t save that change. Try again.';
}
