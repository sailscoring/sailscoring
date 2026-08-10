/**
 * A failed mutation used to go nowhere unless it was one of the two kinds the
 * app already routes: an AuthError (session re-check) or a 409 (the conflict
 * notice, or the finish-entry row dialog). Everything else — a 500, a dropped
 * connection, a validation reject — was swallowed by `mutate`, so the scorer
 * saw the interaction succeed with the data not written, and the e2e suite saw
 * nothing at all. These guard the logging that closes that gap.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MutationObserver } from '@tanstack/react-query';

import { createQueryClient } from '@/app/providers';
import { AuthError, ConflictApiError } from '@/lib/api-client';

let errors: unknown[][];

beforeEach(() => {
  errors = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Run one mutation that rejects with `error`, and return what was logged. */
async function failWith(error: Error, mutationKey?: unknown[]): Promise<unknown[][]> {
  const qc = createQueryClient();
  const observer = new MutationObserver(qc, {
    ...(mutationKey ? { mutationKey } : {}),
    mutationFn: async () => {
      throw error;
    },
    retry: false,
  });
  await observer.mutate(undefined).catch(() => {});
  qc.clear();
  return errors;
}

describe('mutation failures', () => {
  test('an unexpected failure is logged', async () => {
    const logged = await failWith(new Error('boom'));
    expect(logged).toHaveLength(1);
    expect(String(logged[0][0])).toContain('Mutation failed');
  });

  test('the log names the mutation, so the console says which write was lost', async () => {
    const logged = await failWith(new Error('boom'), ['series-row']);
    expect(String(logged[0][0])).toContain('series-row');
  });

  test('a 409 is left to the conflict notice and the row dialog', async () => {
    const logged = await failWith(
      new ConflictApiError({ currentVersion: 2, expectedVersion: 1 }),
    );
    expect(logged).toEqual([]);
  });

  test('a 401 is left to the session re-check', async () => {
    const logged = await failWith(new AuthError());
    expect(logged).toEqual([]);
  });
});
