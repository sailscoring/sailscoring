import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

/**
 * `vercel-firewall.json` as `pnpm firewall:apply` will accept it: Vercel
 * refuses the whole replace over one long description, and the script
 * refuses duplicate names. Checked here so a bad edit fails in CI, not at
 * apply time.
 */
const config = JSON.parse(readFileSync(join(__dirname, '..', 'vercel-firewall.json'), 'utf8')) as {
  rules: { name: string; description?: string }[];
};

describe('vercel-firewall.json', () => {
  test('every rule description fits Vercel’s 256 characters', () => {
    const long = config.rules.filter((r) => (r.description ?? '').length > 256).map((r) => r.name);
    expect(long).toEqual([]);
  });

  test('rule names are unique', () => {
    const names = config.rules.map((r) => r.name);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });
});
