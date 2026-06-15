import { createInterface } from 'node:readline';

import { SailscoringClient } from '../client';
import {
  configPath,
  readConfig,
  writeConfig,
  DEFAULT_BASE_URL,
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

/**
 * `sailscoring auth login` — accept a Bearer token (via `--token` or an stdin
 * prompt), verify it against the deployment with one read, and save it. The
 * token is never echoed back.
 */
export async function loginCommand(flags: Record<string, string>): Promise<number> {
  const baseUrl =
    (flags['base-url'] && flags['base-url'] !== 'true' && flags['base-url']) ||
    readConfig().baseUrl ||
    DEFAULT_BASE_URL;

  let token = flags.token && flags.token !== 'true' ? flags.token : '';
  if (!token) {
    token = await prompt(`Paste an API token for ${baseUrl}: `);
  }
  if (!token) {
    console.error('no token provided');
    return 1;
  }

  const client = new SailscoringClient({ baseUrl, token });
  try {
    await client.verify();
  } catch (err) {
    console.error(`login failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  writeConfig({ baseUrl, token });
  console.log(`logged in to ${baseUrl} (saved to ${configPath()})`);
  return 0;
}
