/**
 * Coerce a caller-supplied redirect target to a safe internal path.
 *
 * Only same-site, absolute, non-protocol-relative paths are honoured; anything
 * else (absolute URLs, `//host` protocol-relative paths, missing values) falls
 * back to `fallback`. This keeps `?next=`-style parameters from being turned
 * into an open redirect to an attacker-controlled origin.
 */
export function safeInternalPath(raw: string | undefined | null, fallback = '/'): string {
  if (typeof raw !== 'string') return fallback;
  if (!raw.startsWith('/')) return fallback;
  // `//evil.com` and `/\evil.com` are protocol-relative / scheme-confusing.
  if (raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  return raw;
}
