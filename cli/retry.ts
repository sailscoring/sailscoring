import { ApiError } from './client';

/** Statuses meaning the gateway gave up on the request rather than the app
 *  refusing it: a function that runs out of time comes back as a 504. */
const GATEWAY_STATUSES = new Set([502, 503, 504]);

/** Waits before each retry after a gateway failure, in seconds. */
const GATEWAY_BACKOFF_SECONDS = [5, 15];

/** How many times a 429 is waited out before the push gives up. */
const RATE_LIMIT_RETRIES = 5;

export interface RetryOptions {
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run one request of a bulk push, riding out the failures a later attempt
 * can get past. A 429 sleeps the server's retry-after (or 10s), up to five
 * times: a push over a plain-rate-limit key must degrade to slower, never
 * to half-ingested. A 502/503/504 is tried twice more after a short wait.
 * That is safe only because every request a push makes is idempotent: an
 * archive document re-PUT after a failure is applied again, whatever the
 * failed attempt got done.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { sleep = realSleep, log = console.error }: RetryOptions = {},
): Promise<T> {
  let rateLimited = 0;
  let gatewayFailed = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      if (err.status === 429 && rateLimited < RATE_LIMIT_RETRIES) {
        rateLimited++;
        const retryAfter =
          (err.body as { retryAfter?: number } | undefined)?.retryAfter ?? 10;
        log(`  … rate-limited, retrying in ${retryAfter}s`);
        await sleep(retryAfter * 1000);
        continue;
      }
      if (
        GATEWAY_STATUSES.has(err.status) &&
        gatewayFailed < GATEWAY_BACKOFF_SECONDS.length
      ) {
        const wait = GATEWAY_BACKOFF_SECONDS[gatewayFailed++];
        log(`  … request failed (${err.status}), retrying in ${wait}s`);
        await sleep(wait * 1000);
        continue;
      }
      throw err;
    }
  }
}
