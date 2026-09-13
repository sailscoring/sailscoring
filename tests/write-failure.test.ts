/**
 * A write that fails has one sentence to say what happened, and the scorer
 * acts on it: re-enter the finish, unarchive the series, give up because they
 * were never allowed. Collapsing all of them into "try again" sends someone to
 * repeat an action that can't succeed. These pin what each kind says.
 */
import { describe, expect, test } from 'vitest';

import {
  ApiError,
  ArchivedApiError,
  ForbiddenApiError,
  NotFoundApiError,
  UpstreamApiError,
  ValidationApiError,
} from '@/lib/api-client';
import { describeWriteFailure } from '@/lib/write-failure';

describe('describeWriteFailure', () => {
  test('a read-only series says which read-only state it is in', () => {
    expect(describeWriteFailure(new ArchivedApiError('series-archived'))).toContain(
      'Unarchive it first',
    );
    expect(describeWriteFailure(new ArchivedApiError('series-final'))).toContain(
      'marked final',
    );
    expect(describeWriteFailure(new ArchivedApiError('series-as-published'))).toContain(
      'published archive',
    );
  });

  test('a 403 says it is a permission problem, not a passing fault', () => {
    const message = describeWriteFailure(new ForbiddenApiError('permission-denied:manage-series'));
    expect(message).toContain('permission');
    expect(message).not.toContain('Try again');
  });

  test('a 403 does not repeat the server’s machine-readable reason', () => {
    expect(describeWriteFailure(new ForbiddenApiError('feature-disabled:logo-library'))).not.toContain(
      'feature-disabled',
    );
  });

  test('a 404 says the thing is gone, and to reload', () => {
    expect(describeWriteFailure(new NotFoundApiError('race'))).toContain('Reload');
  });

  test('an upstream failure keeps the sentence the server wrote for the scorer', () => {
    expect(describeWriteFailure(new UpstreamApiError('RaceSense refused the regatta id.'))).toBe(
      'RaceSense refused the regatta id.',
    );
  });

  test('a 400 does not offer a retry — the same request would be rejected again', () => {
    const message = describeWriteFailure(new ValidationApiError([]));
    expect(message).toContain('rejected');
    expect(message).not.toContain('Try again');
  });

  test('a 500 is worth retrying, and says so', () => {
    expect(describeWriteFailure(new ApiError('HTTP 500', 500))).toContain('Try again');
  });

  test('a bare fetch reject reads as a connection problem', () => {
    expect(describeWriteFailure(new TypeError('Failed to fetch'))).toContain('connection');
  });

  test('anything else still says the change was not saved', () => {
    expect(describeWriteFailure(new Error('boom'))).toContain('Couldn’t save');
  });

  test('every failure leads with the fact that nothing was saved', () => {
    const errors: unknown[] = [
      new ForbiddenApiError(),
      new NotFoundApiError(),
      new ValidationApiError(),
      new ApiError('HTTP 503', 503),
      new TypeError('Failed to fetch'),
      new Error('boom'),
      'a string nobody typed',
    ];
    for (const err of errors) {
      expect(describeWriteFailure(err)).toMatch(/Couldn’t save/);
    }
  });
});
