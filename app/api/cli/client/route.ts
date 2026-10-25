import { cliClientId } from '@/lib/auth/oauth';

export const dynamic = 'force-dynamic';

/**
 * The CLI's OAuth client id (ADR-016), for `sailscoring auth login` to start
 * a device sign-in with. Public: a client id is not a secret, and the CLI has
 * no other way to learn the one this server registered for it.
 */
export async function GET(): Promise<Response> {
  const clientId = await cliClientId();
  if (!clientId) {
    return Response.json(
      { error: 'not-found', message: 'The command line can’t sign in to this server yet: it isn’t registered here.' },
      { status: 404 },
    );
  }
  return Response.json({ clientId }, { headers: { 'cache-control': 'public, max-age=300' } });
}
