import type { BetterAuthPlugin } from 'better-auth';
import { createAuthEndpoint } from 'better-auth/api';
import {
  getOAuthProviderApi,
  oauthDeviceAuthorization,
  oauthProvider,
  type OAuthOptions,
  type Scope,
} from '@better-auth/oauth-provider';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { getDb } from '@/lib/db/client';
import { member, oauthClient, organization } from '@/lib/db/schema/auth';
import { computeEffectiveFeatures } from '@/lib/features';

/**
 * OAuth for outside apps and the CLI (ADR-016 §4), through Better Auth's
 * OAuth provider plugin.
 *
 * An outside app sends its user through the authorization code flow: sign
 * in, choose a workspace (`/oauth/workspace`, the plugin's post-login step),
 * approve the scopes (`/oauth/consent`). The consent, and every token issued
 * under it, carries that workspace as its reference id, so an app's grant
 * reaches one workspace and no other. The CLI signs in with the device grant
 * instead; its tokens carry no workspace and act wherever its user is a
 * member, as an API key does.
 *
 * Access tokens are opaque, so a revoked grant stops working at once, and
 * carry a prefix so the route wrappers can tell one from an API key before
 * the api-key plugin, which takes any bearer token as a key, sees it.
 */

export const ACCESS_TOKEN_PREFIX = 'ssat_';
export const REFRESH_TOKEN_PREFIX = 'ssrt_';

/** What an outside app may ask for. `offline_access` is the refresh token. */
export const APP_SCOPES = ['read', 'races', 'publish'] as const;
export type AppScope = (typeof APP_SCOPES)[number];

/** The feature gate a workspace needs before an app can be granted it. */
export const CONNECTED_APPS_FEATURE = 'connected-apps';

/** Client metadata marking one of our own apps (the CLI). Set when Mark
 *  registers the client; never by the app itself. */
export interface ClientMetadata {
  firstParty?: boolean;
}

/** A client's metadata as the provider stores it: a JSON string. */
export function parseClientMetadata(raw: unknown): ClientMetadata {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as ClientMetadata;
    } catch {
      return {};
    }
  }
  return (raw ?? {}) as ClientMetadata;
}

export interface GrantableWorkspace {
  id: string;
  slug: string;
  name: string;
}

/**
 * The workspaces `userId` may grant an app access to: those they're a member
 * of with the `connected-apps` gate on.
 */
export async function grantableWorkspaces(userId: string): Promise<GrantableWorkspace[]> {
  const memberships = await getDb()
    .select({
      organizationId: member.organizationId,
      slug: organization.slug,
      name: organization.name,
      metadata: organization.metadata,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, userId))
    .orderBy(organization.name);
  return memberships
    .filter((m) => computeEffectiveFeatures(m.slug, memberships).includes(CONNECTED_APPS_FEATURE))
    .map((m) => ({ id: m.organizationId, slug: m.slug, name: m.name }));
}

/** Whether `userId` may grant an app access to `workspaceId`. */
export async function workspaceGrantable(userId: string, workspaceId: string): Promise<boolean> {
  return (await grantableWorkspaces(userId)).some((w) => w.id === workspaceId);
}

/** The client id of the CLI this server registered (`oauth-client
 *  create-cli`), the oldest first-party client still enabled. */
export async function cliClientId(): Promise<string | null> {
  const rows = await getDb()
    .select({ clientId: oauthClient.clientId, metadata: oauthClient.metadata, disabled: oauthClient.disabled })
    .from(oauthClient)
    .orderBy(oauthClient.createdAt);
  return rows.find((r) => !r.disabled && parseClientMetadata(r.metadata).firstParty === true)?.clientId ?? null;
}

export interface AppDisplay {
  clientId: string;
  name: string;
  uri?: string;
  firstParty: boolean;
}

/** What the consent pages say about an app: its name and its site. */
export async function appDisplay(clientId: string): Promise<AppDisplay | null> {
  const [row] = await getDb()
    .select({ name: oauthClient.name, uri: oauthClient.uri, metadata: oauthClient.metadata, disabled: oauthClient.disabled })
    .from(oauthClient)
    .where(eq(oauthClient.clientId, clientId))
    .limit(1);
  if (!row || row.disabled) return null;
  return {
    clientId,
    name: row.name ?? clientId,
    ...(row.uri ? { uri: row.uri } : {}),
    firstParty: parseClientMetadata(row.metadata).firstParty === true,
  };
}

const DAY = 60 * 60 * 24;

/**
 * Apps are registered by the operator, never by users (ADR-016). The
 * provider lets any signed-in user create, change or delete their own
 * clients over HTTP unless a privileges hook says otherwise, so the hook
 * below allows client changes only from `registerOAuthApp`, which marks its
 * calls with this per-process value. No HTTP request can carry it.
 */
const OPERATOR_HEADER = 'x-sailscoring-oauth-operator';
const OPERATOR_NONCE = crypto.randomUUID();

export const oauthOptions = {
  loginPage: '/sign-in',
  consentPage: '/oauth/consent',
  scopes: [...APP_SCOPES, 'offline_access'],
  // Opaque access tokens, looked up on each request: revocable, and the API
  // they're for is served by the same app as the database.
  disableJwtPlugin: true,
  allowDynamicClientRegistration: false,
  accessTokenExpiresIn: 60 * 60,
  // Long enough for an app used once a week through a season; the session
  // the grant was approved in lasts 90 days on the same terms.
  refreshTokenExpiresIn: 90 * DAY,
  prefix: { opaqueAccessToken: ACCESS_TOKEN_PREFIX, refreshToken: REFRESH_TOKEN_PREFIX },
  postLogin: {
    page: '/oauth/workspace',
    // Always ask which workspace on the way in; on the way back, accept the
    // choice only if it's one the user may grant.
    shouldRedirect: async ({ session, user, isContinuation }) => {
      if (!isContinuation) return true;
      const workspaceId = session.activeOrganizationId as string | null | undefined;
      return !(workspaceId && (await workspaceGrantable(user.id, workspaceId)));
    },
    consentReferenceId: async ({ session, user }) => {
      const workspaceId = session.activeOrganizationId as string | null | undefined;
      if (!workspaceId || !(await workspaceGrantable(user.id, workspaceId))) {
        throw new Error('no grantable workspace chosen');
      }
      return workspaceId;
    },
  },
  customAccessTokenClaims: ({ referenceId }) => (referenceId ? { workspace: referenceId } : {}),
  clientPrivileges: ({ headers }) => headers?.get(OPERATOR_HEADER) === OPERATOR_NONCE,
} satisfies OAuthOptions<Scope[]>;

/** An access token, resolved: who it acts for, through which app, how far. */
export interface ResolvedAccessToken {
  userId: string;
  clientId: string;
  clientName: string;
  firstParty: boolean;
  scopes: string[];
  /** The one workspace an outside app's grant covers; absent for the CLI. */
  workspaceId?: string;
}

/**
 * Our own companion plugin, two server-only endpoints:
 *
 * - `resolveAccessToken` resolves an access token with the provider's own
 *   validation (expiry, revocation, a disabled client, the session it was
 *   approved in), for the route wrappers to call.
 * - `registerOAuthApp` registers an app on the operator's behalf, for
 *   `scripts/oauth-client.ts`. The provider's admin registration acts as a
 *   signed-in owner; a script has no session, so this one runs it as the
 *   named operator, with the provider's own validation of the client.
 */
function companion() {
  return {
    id: 'sailscoring-oauth',
    endpoints: {
      registerOAuthApp: createAuthEndpoint.serverOnly(
        {
          method: 'POST',
          body: z.object({ ownerEmail: z.string(), client: z.record(z.string(), z.unknown()) }),
        },
        async (ctx) => {
          const owner = await ctx.context.internalAdapter.findUserByEmail(ctx.body.ownerEmail.toLowerCase());
          if (!owner) throw new Error(`no user ${ctx.body.ownerEmail}: sign in once first`);
          const provider = ctx.context.options.plugins?.find((p) => p.id === 'oauth-provider');
          const register = provider?.endpoints?.adminCreateOAuthClient;
          if (!register) throw new Error('the OAuth provider plugin is not configured');
          const now = new Date();
          ctx.context.session = {
            user: owner.user,
            session: {
              id: 'oauth-client-script',
              userId: owner.user.id,
              token: '',
              expiresAt: now,
              createdAt: now,
              updatedAt: now,
            },
          };
          const out = (await register({
            ...ctx,
            body: ctx.body.client,
            headers: new Headers({ [OPERATOR_HEADER]: OPERATOR_NONCE }),
            asResponse: false,
            returnHeaders: false,
          })) as { response?: unknown };
          // Called with the outer context, the endpoint hands back its
          // response wrapped.
          return (out && typeof out === 'object' && 'response' in out ? out.response : out) as {
            client_id: string;
            client_secret?: string;
          };
        },
      ),
      resolveAccessToken: createAuthEndpoint.serverOnly(
        { method: 'POST', body: z.object({ token: z.string() }) },
        async (ctx): Promise<ResolvedAccessToken | null> => {
          const provider = getOAuthProviderApi(ctx, oauthOptions);
          let payload: Record<string, unknown>;
          try {
            payload = (await provider.validateAccessToken(ctx.body.token)) as Record<string, unknown>;
          } catch {
            return null;
          }
          if (payload.active !== true || typeof payload.sub !== 'string') return null;
          const clientId = payload.client_id;
          if (typeof clientId !== 'string') return null;
          const client = await provider.getClient(clientId);
          if (!client || client.disabled) return null;
          const metadata = parseClientMetadata(client.metadata);
          return {
            userId: payload.sub,
            clientId,
            clientName: client.name ?? clientId,
            firstParty: metadata.firstParty === true,
            scopes: typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean) : [],
            ...(typeof payload.workspace === 'string' ? { workspaceId: payload.workspace } : {}),
          };
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}

export function oauthPlugins() {
  return [
    oauthProvider(oauthOptions),
    oauthDeviceAuthorization({
      verificationUri: '/device',
      expiresIn: '10m',
      interval: '5s',
      // The device grant signs in our own command line; no outside app is
      // registered for it, and none may use it.
      validateClient: async (clientId) => (await appDisplay(clientId))?.firstParty === true,
    }),
    companion(),
  ] as const;
}
