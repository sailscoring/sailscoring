// @vitest-environment node

/**
 * Mapping a throttled magic-link verify onto the sign-in page.
 *
 * The limiter answers before the endpoint and returns JSON, but verify is
 * reached by clicking a link — so without this the user reads a raw error
 * body in the address bar with nothing to act on.
 */

import { describe, expect, test } from 'vitest';

import {
  RATE_LIMITED_ERROR,
  rateLimitedVerifyRedirect,
} from '@/lib/auth/verify-rate-limit';

const VERIFY = 'http://localhost:3000/api/auth/magic-link/verify?token=abc';

function throttled(retryAfter = '240'): Response {
  return new Response(JSON.stringify({ message: 'Too many requests.' }), {
    status: 429,
    headers: { 'X-Retry-After': retryAfter },
  });
}

describe('rateLimitedVerifyRedirect', () => {
  test('redirects a throttled verify to sign-in with the wait attached', () => {
    const mapped = rateLimitedVerifyRedirect(new Request(VERIFY), throttled());
    expect(mapped).not.toBeNull();
    expect(mapped!.status).toBe(303);
    const location = new URL(mapped!.headers.get('location')!);
    expect(location.pathname).toBe('/sign-in');
    expect(location.searchParams.get('error')).toBe(RATE_LIMITED_ERROR);
    expect(location.searchParams.get('retryAfter')).toBe('240');
  });

  test('carries the link destination through, so the retry lands there', () => {
    const mapped = rateLimitedVerifyRedirect(
      new Request(`${VERIFY}&callbackURL=%2Fseries%2F42`),
      throttled(),
    );
    expect(
      new URL(mapped!.headers.get('location')!).searchParams.get('callbackURL'),
    ).toBe('/series/42');
  });

  test('an off-site destination is not carried through', () => {
    const mapped = rateLimitedVerifyRedirect(
      new Request(`${VERIFY}&callbackURL=https%3A%2F%2Fevil.example%2Fx`),
      throttled(),
    );
    expect(
      new URL(mapped!.headers.get('location')!).searchParams.get('callbackURL'),
    ).toBe('/');
  });

  test('leaves a successful verify alone', () => {
    expect(
      rateLimitedVerifyRedirect(
        new Request(VERIFY),
        new Response(null, { status: 302, headers: { location: '/' } }),
      ),
    ).toBeNull();
  });

  test('leaves a 429 from any other auth endpoint alone', () => {
    expect(
      rateLimitedVerifyRedirect(
        new Request('http://localhost:3000/api/auth/sign-in/magic-link', {
          method: 'POST',
        }),
        throttled(),
      ),
    ).toBeNull();
  });
});
