/**
 * Write the public API's OpenAPI description to `docs/openapi/public-v1.json`
 * (ADR-016 §5): the committed copy a change to the API shows up in, and that
 * CI compares against the last one for breaking changes. A test fails while
 * the committed copy is out of date.
 *
 * Usage: pnpm openapi:generate
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { publicApiOpenApi } from '@/lib/public-api/openapi';

const out = join(__dirname, '..', 'docs', 'openapi', 'public-v1.json');
writeFileSync(out, `${JSON.stringify(publicApiOpenApi('https://app.sailscoring.ie'), null, 2)}\n`);
console.log(`wrote ${out}`);
