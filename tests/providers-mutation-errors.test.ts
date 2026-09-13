/**
 * A failed mutation used to go nowhere unless it was one of the two kinds the
 * app already routes: an AuthError (session re-check) or a 409 (the conflict
 * notice, or the finish-entry row dialog). Everything else — a 500, a dropped
 * connection, a validation reject — was swallowed by `mutate`, so the scorer
 * saw the interaction succeed with the data not written, and the e2e suite saw
 * nothing at all. These guard the log and the notice banner that close that
 * gap, and the one predicate both of them read.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MutationObserver } from '@tanstack/react-query';

import { createQueryClient, isLostWrite } from '@/app/providers';
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

/**
 * The banner in `WriteFailureSubscriber` and the log below both turn on
 * `isLostWrite`, so what the scorer is shown and what the console (and the
 * e2e suite) sees can't drift apart. These pin the answer it gives.
 */
describe('isLostWrite', () => {
  test('an unexpected failure is a lost write', () => {
    expect(isLostWrite(new Error('boom'), {})).toBe(true);
  });

  test('a 409 is not — the conflict notice has it', () => {
    expect(isLostWrite(new ConflictApiError(), {})).toBe(false);
  });

  test('a 401 is not — the session re-check has it', () => {
    expect(isLostWrite(new AuthError(), {})).toBe(false);
  });

  test('a refusal the caller renders itself is not', () => {
    expect(isLostWrite(new Error('boom'), { meta: { errorShownToUser: true } })).toBe(false);
  });
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
  test('an unexpected failure is logged as well as shown', async () => {
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

  test('a refusal the caller renders itself is not logged', async () => {
    const qc = createQueryClient();
    const observer = new MutationObserver(qc, {
      mutationFn: async () => {
        throw new Error('boom');
      },
      meta: { errorShownToUser: true },
      retry: false,
    });
    await observer.mutate(undefined).catch(() => {});
    qc.clear();
    expect(errors).toEqual([]);
  });
});
