/**
 * PII scrub for Sailwave `.blw` files (ADR-010, #283) — run before a capture
 * is committed to an archive repo. Strips date of birth, email addresses,
 * and phone numbers (and their close cousins) while keeping everything the
 * published results already carry — including age, which is part of the
 * public record and an identity-matching signal.
 *
 * A `.blw` is a four-column CSV (`key,value,compHandle,raceHandle`); the
 * scrub drops whole rows by *key*, so it can never mangle a value, and
 * reports what it removed so the operator can eyeball the take.
 */

import Papa from 'papaparse';

/** Key substrings that mark a row as PII. Checked case-insensitively against
 *  the record key (not the value): Sailwave's competitor fields are named
 *  like `comphelmemail` / `comphelmphone` / `comphelmdob`. */
const PII_KEY_PATTERN =
  /(email|e-mail|phone|mobile|fax|dob|dateofbirth|birth|address|postcode|zipcode|medical|emergency|nextofkin)/i;

export interface BlwScrubResult {
  /** The scrubbed CSV text (UTF-8; quoting normalised by the re-serialise). */
  text: string;
  /** Removed row counts by key, for the operator's report. */
  removed: Record<string, number>;
}

/** Whether a `.blw` record key is PII to strip. Exported for the tests and
 *  for capture tooling that wants a dry-run report. */
export function isPiiKey(key: string): boolean {
  return PII_KEY_PATTERN.test(key);
}

export function scrubBlwText(text: string): BlwScrubResult {
  const { data } = Papa.parse<string[]>(text, {
    delimiter: ',',
    skipEmptyLines: true,
  });
  const removed: Record<string, number> = {};
  const kept = data.filter((row) => {
    const key = (row?.[0] ?? '').trim();
    if (key && isPiiKey(key)) {
      removed[key] = (removed[key] ?? 0) + 1;
      return false;
    }
    return true;
  });
  return {
    text: `${Papa.unparse(kept, { newline: '\n' })}\n`,
    removed,
  };
}

/** Convenience for byte input: decodes windows-1252 (Sailwave saves on
 *  Windows) and returns UTF-8 text out. */
export function scrubBlwBytes(bytes: ArrayBuffer): BlwScrubResult {
  return scrubBlwText(new TextDecoder('windows-1252').decode(bytes));
}
