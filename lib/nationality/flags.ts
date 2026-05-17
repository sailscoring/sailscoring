/** Flag SVG accessor — separate entry point so importing the metadata
 *  helpers (./index) doesn't pull the full set of inline SVGs into the
 *  bundle. Server-side renderer and any opt-in client surface import
 *  from here. */
import { NATIONAL_FLAGS } from './generated/flags';
import type { NationalFlag } from './types';

export type { NationalFlag } from './types';
export { NATIONAL_FLAGS } from './generated/flags';

/** Return the flag for a canonical code, or null if absent. Does not
 *  normalize — pass a canonical code (use normalizeCodeInput / lookupAlias
 *  first if the input might be a raw user string). */
export function getFlag(code: string): NationalFlag | null {
  return NATIONAL_FLAGS[code] ?? null;
}
