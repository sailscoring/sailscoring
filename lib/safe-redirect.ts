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

/**
 * Encode an internal path for nesting inside another URL's query string
 * (the sign-in form's `/welcome?next=…`).
 *
 * Percent-encoding is not enough here: Better Auth's magic-link verify
 * endpoint applies one more `decodeURIComponent` to its callback params
 * than was applied when the link was built, so a percent-encoded nested
 * path containing `?` collapses into a second literal `?` and fails its
 * callback validation. Base64url output (`A-Za-z0-9-_`) contains no `%`,
 * `?`, `&`, or `#`, so it survives any number of URL decodes unchanged.
 */
export function encodeNextPath(path: string): string {
  const bytes = new TextEncoder().encode(path);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode a `next` query param produced by {@link encodeNextPath}. Plain
 * `/`-prefixed values pass through untouched (links minted before the
 * encoding was introduced, or hand-written ones). Returns undefined for
 * anything undecodable; callers should follow with `safeInternalPath`.
 */
export function decodeNextPath(raw: string | undefined | null): string | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined;
  if (raw.startsWith('/')) return raw;
  try {
    const binary = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}
