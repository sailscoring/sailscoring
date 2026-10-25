import { createInterface } from 'node:readline';

import { SailscoringClient, type FetchLike } from '../client';
import {
  configPath,
  readConfig,
  writeConfig,
  DEFAULT_BASE_URL,
  type OAuthSession,
} from '../config';

/** Read a single line from stdin (used to accept a pasted token). */
function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const SCOPE = 'read races publish offline_access';

export interface DeviceLoginDeps {
  fetch: FetchLike;
  /** Where the code and the page to approve it on are shown. */
  print: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
}

/** A code as people read it: `ABCD-EFGH`. */
function readableCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

async function postForm(deps: DeviceLoginDeps, url: string, form: Record<string, string>) {
  const res = await deps.fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // An HTML error page, a proxy: reported below by status.
  }
  return { status: res.status, body };
}

/**
 * The device sign-in (ADR-016, RFC 8628): ask the server for a code, have
 * the person approve it in a browser where they're signed in, and wait for
 * the tokens. Returns the access token and what renews it.
 */
export async function deviceLogin(
  baseUrl: string,
  deps: DeviceLoginDeps,
): Promise<{ token: string; oauth: OAuthSession }> {
  const clientRes = await deps.fetch(`${baseUrl}/api/cli/client`, { method: 'GET', headers: {} });
  const clientBody = JSON.parse((await clientRes.text()) || '{}') as { clientId?: string; message?: string };
  if (clientRes.status !== 200 || !clientBody.clientId) {
    throw new Error(clientBody.message ?? `this server doesn't support signing in the command line (${clientRes.status})`);
  }
  const clientId = clientBody.clientId;

  const code = await postForm(deps, `${baseUrl}/api/auth/device/code`, { client_id: clientId, scope: SCOPE });
  const deviceCode = code.body.device_code;
  const userCode = code.body.user_code;
  if (code.status !== 200 || typeof deviceCode !== 'string' || typeof userCode !== 'string') {
    throw new Error(`couldn't start signing in (${code.status} ${String(code.body.error_description ?? '')})`.trim());
  }
  const page = typeof code.body.verification_uri_complete === 'string'
    ? code.body.verification_uri_complete
    : `${baseUrl}/device?user_code=${userCode}`;
  deps.print(`To sign in, open this page in a browser where you're signed in to Sail Scoring:\n\n  ${page}\n`);
  deps.print(`and check it shows the code ${readableCode(userCode)}. Waiting…`);

  let interval = (typeof code.body.interval === 'number' ? code.body.interval : 5) * 1000;
  const deadline = Date.now() + (typeof code.body.expires_in === 'number' ? code.body.expires_in : 600) * 1000;
  while (Date.now() < deadline) {
    await deps.sleep(interval);
    const poll = await postForm(deps, `${baseUrl}/api/auth/oauth2/token`, {
      grant_type: DEVICE_GRANT,
      device_code: deviceCode,
      client_id: clientId,
    });
    if (poll.status === 200 && typeof poll.body.access_token === 'string' && typeof poll.body.refresh_token === 'string') {
      return { token: poll.body.access_token, oauth: { clientId, refreshToken: poll.body.refresh_token } };
    }
    switch (poll.body.error) {
      case 'authorization_pending':
        continue;
      case 'slow_down':
        interval += 5000;
        continue;
      case 'access_denied':
        throw new Error('the code was denied');
      case 'expired_token':
        throw new Error('the code expired: run `sailscoring auth login` again');
      default:
        throw new Error(`signing in failed (${poll.status} ${String(poll.body.error_description ?? poll.body.error ?? '')})`.trim());
    }
  }
  throw new Error('the code expired: run `sailscoring auth login` again');
}

/**
 * `sailscoring auth login` — sign the CLI in.
 *
 * By default, with the device grant (ADR-016): the CLI prints a page and a
 * code, the person approves it in their browser, and the CLI acts as them
 * from then on, renewing its access as it goes. `--token <key>` (or
 * `--paste`, to paste one at a prompt) saves an API key instead, which is
 * for automation; the key is verified with one read and never echoed.
 */
export async function loginCommand(flags: Record<string, string>): Promise<number> {
  const baseUrl = (
    (flags['base-url'] && flags['base-url'] !== 'true' && flags['base-url']) ||
    readConfig().baseUrl ||
    DEFAULT_BASE_URL
  ).replace(/\/+$/, '');

  let token = flags.token && flags.token !== 'true' ? flags.token : '';
  if (!token && flags.paste === 'true') {
    token = await prompt(`Paste an API token for ${baseUrl}: `);
    if (!token) {
      console.error('no token provided');
      return 1;
    }
  }

  let oauth: OAuthSession | undefined;
  if (!token) {
    try {
      ({ token, oauth } = await deviceLogin(baseUrl, {
        fetch: globalThis.fetch as unknown as FetchLike,
        print: (line) => console.error(line),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      }));
    } catch (err) {
      console.error(`login failed: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
  }

  const client = new SailscoringClient({ baseUrl, token, oauth, onRenew: () => {} });
  try {
    await client.verify();
  } catch (err) {
    console.error(`login failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  writeConfig({ baseUrl, token, ...(oauth ? { oauth } : {}) });
  console.log(`logged in to ${baseUrl} (saved to ${configPath()})`);
  return 0;
}
