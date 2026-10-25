/**
 * Signing in on the way to granting an app access (ADR-016).
 *
 * The OAuth provider sends a signed-out user to `/sign-in` with the
 * authorization request signed into the query (`sig`, `exp`, `ba_*`). It
 * picks the request up again by itself only when the session is created in
 * the same request as the sign-in, which a magic link never does: the
 * session starts when the emailed link is opened. So the sign-in page sends
 * the user back to the authorization endpoint with the request as it was,
 * which checks the client, redirect URI and PKCE again on its own terms,
 * and now finds a session.
 */

/** Parameters the provider adds to sign the request; none is part of it. */
const SIGNING_PARAMS = ['sig', 'exp', 'ba_iat', 'ba_pl', 'ba_param'];

export const AUTHORIZE_PATH = '/api/auth/oauth2/authorize';

/**
 * The authorization endpoint to return to, when `params` is a signed
 * authorization request the provider sent to the sign-in page; otherwise
 * null.
 */
export function authorizeCallbackFromQuery(params: URLSearchParams): string | null {
  if (!params.has('sig') || !params.has('client_id')) return null;
  const request = new URLSearchParams(params);
  for (const name of SIGNING_PARAMS) request.delete(name);
  // The sign-in page's own parameters are not the app's.
  request.delete('callbackURL');
  request.delete('error');
  return `${AUTHORIZE_PATH}?${request.toString()}`;
}
