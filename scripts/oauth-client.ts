/**
 * ADR-016 — registering the apps that may ask Sail Scoring's users for
 * access. There is no self-registration: an outside app is registered here,
 * by the operator, with the exact redirect URIs it will use, and so is the
 * CLI.
 *
 * `create` registers an outside app for the authorization code flow. By
 * default it's a public client (a web page or an app with no server of its
 * own: PKCE, no secret); `--confidential` registers one with a server, and
 * prints its client secret once. `create-cli` registers the CLI: a
 * first-party public client for the device grant, which skips consent and
 * acts in every workspace its user belongs to.
 *
 * Usage (production: against the production DATABASE_URL):
 *   pnpm oauth-client create --owner mark@example.com --name "Course Plotter" \
 *     --uri https://courseplotter.example.com --redirect-uris https://courseplotter.example.com/callback
 *   pnpm oauth-client create-cli --owner mark@example.com
 *   pnpm oauth-client list
 *   pnpm oauth-client disable <client-id>
 *   pnpm oauth-client enable <client-id>
 *   pnpm oauth-client scopes <client-id>
 */

import { eq } from 'drizzle-orm';

import { auth } from '@/lib/auth';
import { APP_SCOPES, parseClientMetadata, type ClientMetadata } from '@/lib/auth/oauth';
import { getDb, getDbClient, type SailScoringDb } from '@/lib/db/client';
import { oauthClient } from '@/lib/db/schema/auth';

const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const APP_SCOPE_STRING = [...APP_SCOPES, 'offline_access'].join(' ');

/** Register a client through the provider, as `owner` (the operator). */
async function register(
  owner: string,
  client: Record<string, unknown>,
): Promise<{ client_id: string; client_secret?: string }> {
  return auth.api.registerOAuthApp({ body: { ownerEmail: owner, client } });
}

export interface CreatedClient {
  clientId: string;
  clientSecret?: string;
}

/** Register an outside app for the authorization code flow. */
export async function createAppClient(args: {
  owner: string;
  name: string;
  uri?: string;
  redirectUris: string[];
  confidential: boolean;
}): Promise<CreatedClient> {
  if (args.redirectUris.length === 0) throw new Error('at least one redirect URI is required');
  // The provider allows http only on a loopback address, and only for a
  // native client; an app on the web uses https. It validates each URI.
  const local = args.redirectUris.some((uri) => new URL(uri).protocol === 'http:');
  const created = await register(args.owner, {
      client_name: args.name,
      ...(args.uri ? { client_uri: args.uri } : {}),
      redirect_uris: args.redirectUris,
      scope: APP_SCOPE_STRING,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: args.confidential ? 'client_secret_basic' : 'none',
      application_type: local ? 'native' : 'web',
      metadata: { firstParty: false } satisfies ClientMetadata,
  });
  return {
    clientId: created.client_id,
    ...(created.client_secret ? { clientSecret: created.client_secret } : {}),
  };
}

/** Register the CLI: our own app, signing people in with the device grant. */
export async function createCliClient(owner: string): Promise<CreatedClient> {
  const created = await register(owner, {
      client_name: 'Sail Scoring CLI',
      scope: APP_SCOPE_STRING,
      grant_types: [DEVICE_CODE_GRANT, 'refresh_token'],
      response_types: [],
      token_endpoint_auth_method: 'none',
      application_type: 'native',
      skip_consent: true,
      metadata: { firstParty: true } satisfies ClientMetadata,
  });
  return { clientId: created.client_id };
}

export async function listClients(db: SailScoringDb) {
  return db
    .select({
      clientId: oauthClient.clientId,
      name: oauthClient.name,
      disabled: oauthClient.disabled,
      redirectUris: oauthClient.redirectUris,
      metadata: oauthClient.metadata,
      createdAt: oauthClient.createdAt,
    })
    .from(oauthClient)
    .orderBy(oauthClient.createdAt);
}

/**
 * Give a registered client every scope apps may ask for today. A client is
 * registered with the scopes that existed then, and the provider refuses a
 * request for any other; a scope added since (such as `submissions`) reaches
 * an existing app only through this.
 */
export async function setClientScopes(db: SailScoringDb, clientId: string): Promise<boolean> {
  const rows = await db
    .update(oauthClient)
    .set({ scopes: APP_SCOPE_STRING.split(' '), updatedAt: new Date() })
    .where(eq(oauthClient.clientId, clientId))
    .returning({ clientId: oauthClient.clientId });
  return rows.length > 0;
}

export async function setClientDisabled(
  db: SailScoringDb,
  clientId: string,
  disabled: boolean,
): Promise<boolean> {
  const rows = await db
    .update(oauthClient)
    .set({ disabled, updatedAt: new Date() })
    .where(eq(oauthClient.clientId, clientId))
    .returning({ clientId: oauthClient.clientId });
  return rows.length > 0;
}

// ─── CLI dispatcher ──────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[arg.slice(2)] = 'true';
      } else {
        flags[arg.slice(2)] = next;
        i++;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function usage(): string {
  return `oauth-client — register the apps that may ask users for access (ADR-016)

  create --owner <email> --name <name> --redirect-uris <uri>[,<uri>…] [--uri <homepage>] [--confidential]
  create-cli --owner <email>
  list
  disable <client-id>
  enable <client-id>
  scopes <client-id>

create registers an outside app. Without --confidential it's a public client
(PKCE, no secret), for a web page or an app with no server of its own; with
it, the client secret is printed once and cannot be recovered. Redirect URIs
are matched exactly, and must be https; http is allowed only on a loopback
address (127.0.0.1, [::1], localhost), for an app being developed locally.

create-cli registers the CLI: our own app, signing people in with the device
grant, skipping consent, acting in every workspace its user belongs to. Put
the client id it prints in the CLI's configuration.

disable stops an app's tokens working at once, and its users being asked;
enable restores it.

scopes gives an app registered earlier every scope apps may ask for now
(${APP_SCOPE_STRING}); an app may ask only for the scopes it was registered
with. Its users approve a new scope the next time the app asks for it.

--owner is the operator registering the app: an existing account, recorded
as the client's owner. Reads DATABASE_URL.`;
}

export async function runCli(argv: string[]): Promise<number> {
  const [subcommand, ...rest] = argv;
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    console.log(usage());
    return subcommand ? 0 : 1;
  }
  const { positional, flags } = parseArgs(rest);
  const flag = (name: string) => (flags[name] && flags[name] !== 'true' ? flags[name] : undefined);
  const db = getDb();
  try {
    switch (subcommand) {
      case 'create': {
        const name = flag('name');
        const owner = flag('owner');
        if (!name || !owner) throw new Error('create: --owner and --name are required');
        const redirectUris = (flag('redirect-uris') ?? '').split(',').map((u) => u.trim()).filter(Boolean);
        const created = await createAppClient({
          owner,
          name,
          uri: flag('uri'),
          redirectUris,
          confidential: flags.confidential === 'true',
        });
        console.log(`registered ${name}`);
        console.log(`  client id: ${created.clientId}`);
        if (created.clientSecret) {
          console.log('\n  client secret — copy this now, it will not be shown again:\n');
          console.log(`  ${created.clientSecret}\n`);
        }
        return 0;
      }
      case 'create-cli': {
        const owner = flag('owner');
        if (!owner) throw new Error('create-cli: --owner is required');
        const created = await createCliClient(owner);
        console.log('registered the Sail Scoring CLI');
        console.log(`  client id: ${created.clientId}`);
        return 0;
      }
      case 'list': {
        const clients = await listClients(db);
        if (clients.length === 0) {
          console.log('(no apps registered)');
          return 0;
        }
        for (const c of clients) {
          const meta = parseClientMetadata(c.metadata);
          const tags = [meta.firstParty ? 'first-party' : '', c.disabled ? 'disabled' : ''].filter(Boolean);
          console.log(
            `  ${c.clientId}  ${(c.name ?? '(no name)').padEnd(28)}  ${tags.length ? `[${tags.join(', ')}] ` : ''}${(c.redirectUris ?? []).join(' ')}`,
          );
        }
        return 0;
      }
      case 'scopes': {
        const [clientId] = positional;
        if (!clientId) throw new Error('scopes: <client-id> is required');
        const found = await setClientScopes(db, clientId);
        console.log(found ? `${clientId} may now ask for: ${APP_SCOPE_STRING}` : `no app with client id ${clientId}`);
        return found ? 0 : 1;
      }
      case 'disable':
      case 'enable': {
        const [clientId] = positional;
        if (!clientId) throw new Error(`${subcommand}: <client-id> is required`);
        const found = await setClientDisabled(db, clientId, subcommand === 'disable');
        console.log(found ? `${subcommand}d ${clientId}` : `no app with client id ${clientId}`);
        return 0;
      }
      default:
        console.error(`unknown subcommand: ${subcommand}\n`);
        console.error(usage());
        return 1;
    }
  } catch (err) {
    // Better Auth's APIError carries its reason in `body`, not `message`.
    const body = (err as { body?: { message?: string; error_description?: string } }).body;
    console.error(body?.error_description ?? body?.message ?? (err instanceof Error ? err.message : String(err)));
    if (process.env.DEBUG) console.error(err);
    return 1;
  }
}

// "main module" check. `tsx scripts/oauth-client.ts` runs this file directly;
// importing it from a test does not.
const isMain = require.main === module;
if (isMain) {
  void (async () => {
    const code = await runCli(process.argv.slice(2));
    await getDbClient().end();
    process.exit(code);
  })();
}
