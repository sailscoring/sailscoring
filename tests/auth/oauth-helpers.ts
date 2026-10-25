/**
 * Issuing real OAuth tokens in tests (ADR-016), by running the flows an app
 * and the CLI run, in process through `auth.handler`: a magic-link sign-in,
 * the authorization code flow with PKCE (workspace choice, consent, token),
 * and the device grant. Nothing is minted behind the provider's back, so a
 * token from here is resolved exactly as a real one is.
 *
 * Needs DATABASE_URL; the callers skip without it.
 */
import { createHash, randomBytes } from 'node:crypto';
import { eq, like } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { setOrgFeature } from '@/scripts/provision-org';

const BASE = 'http://localhost:3000';

/** A browser's cookies, carried from one in-process request to the next. */
export class CookieJar {
  private cookies = new Map<string, string>();

  absorb(res: Response): Response {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return res;
  }

  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

/** A distinct private address per caller, so rate-limit rows don't collide. */
function testIp(): string {
  const octet = () => Math.floor(Math.random() * 256);
  return `10.${octet()}.${octet()}.${octet()}`;
}

export interface SignedInUser {
  email: string;
  userId: string;
  personalWorkspaceId: string;
  jar: CookieJar;
  ip: string;
}

export async function request(
  user: Pick<SignedInUser, 'jar' | 'ip'> | null,
  path: string,
  init: { method?: string; json?: unknown; form?: Record<string, string>; headers?: Record<string, string> } = {},
): Promise<Response> {
  const headers: Record<string, string> = { origin: BASE, ...init.headers };
  if (user) {
    headers.cookie = user.jar.header();
    headers['x-forwarded-for'] = user.ip;
  }
  let body: string | undefined;
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json';
    headers.accept ??= 'application/json';
    body = JSON.stringify(init.json);
  } else if (init.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(init.form).toString();
  }
  const res = await auth.handler(
    new Request(`${BASE}${path}`, { method: init.method ?? (body ? 'POST' : 'GET'), headers, body }),
  );
  return user ? user.jar.absorb(res) : res;
}

/** Sign a fresh user in by magic link, as a browser would. */
export async function signInFreshUser(prefix: string): Promise<SignedInUser> {
  process.env.E2E_DISABLE_SAMPLE_SEED = '1';
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e9)}@sailscoring.test`;
  const user = { jar: new CookieJar(), ip: testIp() };
  const sent = await request(user, '/api/auth/sign-in/magic-link', { json: { email, callbackURL: '/' } });
  if (sent.status !== 200) throw new Error(`magic link send: ${sent.status}`);
  const [row] = await getDb()
    .select({ identifier: schema.verification.identifier })
    .from(schema.verification)
    .where(like(schema.verification.value, `%${email}%`))
    .limit(1);
  const token = row.identifier.replace(/^magic-link:/, '');
  const verified = await request(user, `/api/auth/magic-link/verify?token=${token}&callbackURL=/`);
  if (verified.status !== 302) throw new Error(`magic link verify: ${verified.status}`);
  const [account] = await getDb()
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .limit(1);
  const [membership] = await getDb()
    .select({ organizationId: schema.member.organizationId })
    .from(schema.member)
    .where(eq(schema.member.userId, account.id))
    .limit(1);
  return { email, userId: account.id, personalWorkspaceId: membership.organizationId, ...user };
}

/** Delete a test user, their personal workspace, and what cascades. */
export async function removeUser(user: SignedInUser): Promise<void> {
  const db = getDb();
  await db.delete(schema.user).where(eq(schema.user.id, user.userId));
  await db.delete(schema.organization).where(eq(schema.organization.id, user.personalWorkspaceId));
}

export async function setConnectedApps(workspaceId: string, enabled: boolean): Promise<void> {
  await setOrgFeature(getDb(), { orgSlugOrId: workspaceId, feature: 'connected-apps', enabled });
}

export const TEST_REDIRECT_URI = 'http://127.0.0.1:9999/callback';

/** Register an app (or the CLI) as the operator does, through the provider. */
export async function registerApp(
  owner: SignedInUser,
  kind: 'app' | 'cli',
  name = kind === 'cli' ? 'Sail Scoring CLI' : `Test app ${Date.now()}`,
): Promise<string> {
  const client =
    kind === 'cli'
      ? {
          client_name: name,
          scope: 'read races publish offline_access',
          grant_types: ['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token'],
          response_types: [],
          token_endpoint_auth_method: 'none',
          application_type: 'native',
          skip_consent: true,
          metadata: { firstParty: true },
        }
      : {
          client_name: name,
          redirect_uris: [TEST_REDIRECT_URI],
          scope: 'read races publish offline_access',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
          application_type: 'native',
          metadata: { firstParty: false },
        };
  const created = await auth.api.registerOAuthApp({ body: { ownerEmail: owner.email, client } });
  return created.client_id;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  scope: string;
}

/**
 * The authorization code flow, as an app runs it with its user's browser:
 * authorize, choose `workspaceId`, consent, exchange the code. Throws with
 * the step that failed.
 */
export async function grantApp(
  user: SignedInUser,
  clientId: string,
  workspaceId: string,
  scope = 'read races publish offline_access',
): Promise<IssuedTokens> {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: TEST_REDIRECT_URI,
    scope,
    state: 'test-state',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  const step = async (name: string, res: Response): Promise<string> => {
    const body = (await res.json()) as { url?: string; error_description?: string };
    if (!body.url) throw new Error(`${name}: ${res.status} ${body.error_description ?? JSON.stringify(body)}`);
    return body.url;
  };
  const toWorkspace = await step(
    'authorize',
    await request(user, `/api/auth/oauth2/authorize?${query}`, { headers: { accept: 'application/json' } }),
  );
  await request(user, '/api/auth/organization/set-active', { json: { organizationId: workspaceId } });
  const toConsent = await step(
    'continue',
    await request(user, '/api/auth/oauth2/continue', {
      json: { postLogin: true, oauth_query: new URL(toWorkspace, BASE).search.slice(1) },
    }),
  );
  // With the same scopes consented before, the provider goes straight back
  // to the app.
  const consentedBefore = toConsent.startsWith(TEST_REDIRECT_URI);
  if (!consentedBefore && !new URL(toConsent, BASE).pathname.startsWith('/oauth/consent')) {
    throw new Error(`continue: sent to ${toConsent}, not the consent page`);
  }
  const toApp = consentedBefore
    ? toConsent
    : await step(
        'consent',
        await request(user, '/api/auth/oauth2/consent', {
          json: { accept: true, oauth_query: new URL(toConsent, BASE).search.slice(1) },
        }),
      );
  const code = new URL(toApp).searchParams.get('code');
  if (!code) throw new Error(`consent: no code in ${toApp}`);
  return exchange({
    grant_type: 'authorization_code',
    code,
    redirect_uri: TEST_REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier,
  });
}

/** The device grant, as `sailscoring auth login` runs it. */
export async function deviceSignIn(user: SignedInUser, cliClientId: string): Promise<IssuedTokens> {
  const codeRes = await request(null, '/api/auth/device/code', {
    form: { client_id: cliClientId, scope: 'read races publish offline_access' },
  });
  const code = (await codeRes.json()) as { device_code: string; user_code: string };
  // Opening the verification page claims the code for this session.
  await request(user, `/api/auth/device?user_code=${code.user_code}`);
  const approved = await request(user, '/api/auth/device/approve', { json: { userCode: code.user_code } });
  if (approved.status !== 200) throw new Error(`device approve: ${approved.status} ${await approved.text()}`);
  return exchange({
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    device_code: code.device_code,
    client_id: cliClientId,
  });
}

export async function exchange(form: Record<string, string>): Promise<IssuedTokens> {
  const res = await request(null, '/api/auth/oauth2/token', { form });
  const body = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    error_description?: string;
  };
  if (!body.access_token) throw new Error(`token: ${res.status} ${body.error_description}`);
  return { accessToken: body.access_token, refreshToken: body.refresh_token ?? '', scope: body.scope ?? '' };
}
