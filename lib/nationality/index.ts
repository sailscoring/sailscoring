/** Public API for the national-letters dataset (metadata only — no SVG
 *  payload). Pulled by both the client UI and the HTML renderer; the SVGs
 *  live in ./flags.ts so the client bundle doesn't carry ~230 flags. */
import { DATASET_VERSION, NATIONAL_ALIASES, NATIONAL_CODES } from './generated/codes';
import type { NationalAlias, NationalCode } from './types';

export type { NationalAlias, NationalCode } from './types';
export { DATASET_VERSION, NATIONAL_ALIASES, NATIONAL_CODES } from './generated/codes';

const BY_CODE: ReadonlyMap<string, NationalCode> = new Map(NATIONAL_CODES.map((c) => [c.code, c]));

/** Uppercase + trim raw user input. Does not validate length or charset —
 *  use isKnownCode / lookupCode for that. */
export function normalizeCodeInput(input: string): string {
  return input.trim().toUpperCase();
}

/** True iff `code` is exactly a canonical entry in the dataset. Aliases
 *  return false — resolve them with lookupAlias first. */
export function isKnownCode(code: string): boolean {
  return BY_CODE.has(code);
}

/** Return the dataset entry for `code`, or null if unknown. Case-insensitive
 *  via normalizeCodeInput. */
export function lookupCode(code: string): NationalCode | null {
  return BY_CODE.get(normalizeCodeInput(code)) ?? null;
}

/** Resolve an alias spelling to its canonical record. Returns null if the
 *  input is neither a known code nor a known alias. Useful when ingesting
 *  Sailwave-flavoured codes (`BVI`, `CKI`, `SLU`, …). */
export function lookupAlias(input: string): { canonical: string; alias: NationalAlias | null } | null {
  const norm = normalizeCodeInput(input);
  if (BY_CODE.has(norm)) return { canonical: norm, alias: null };
  const alias = NATIONAL_ALIASES[norm];
  if (!alias) return null;
  return { canonical: alias.canonical, alias };
}
