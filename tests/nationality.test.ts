import { describe, it, expect } from 'vitest';
import {
  DATASET_VERSION,
  NATIONAL_ALIASES,
  NATIONAL_CODES,
  isKnownCode,
  lookupAlias,
  lookupCode,
  normalizeCodeInput,
} from '@/lib/nationality';
import { NATIONAL_FLAGS, getFlag } from '@/lib/nationality/flags';

describe('national-letters dataset', () => {
  // Snapshot the published v1.0.2 cardinality so accidental drift on a
  // version bump (or a sync-script bug) trips a test rather than silently
  // shipping the wrong dataset. Update both when you bump the pin.
  it('pins to the expected dataset release', () => {
    expect(DATASET_VERSION).toBe('v1.0.2');
    expect(NATIONAL_CODES.length).toBe(231);
  });

  it('looks up canonical sailing nations by code', () => {
    expect(lookupCode('IRL')?.name).toBe('Ireland');
    expect(lookupCode('GBR')?.name).toBe('Great Britain');
    expect(lookupCode('FRA')?.name).toBe('France');
    expect(lookupCode('BEL')?.name).toBe('Belgium');
  });

  it('normalizes raw user input before lookup', () => {
    expect(normalizeCodeInput(' irl ')).toBe('IRL');
    expect(lookupCode('  Irl  ')?.code).toBe('IRL');
  });

  it('returns null for an unknown code', () => {
    expect(lookupCode('XYZ')).toBeNull();
    expect(isKnownCode('XYZ')).toBe(false);
    expect(isKnownCode('IRL')).toBe(true);
  });

  it('resolves Sailwave-style aliases to their canonical record', () => {
    // BVI → IVB is the documented Sailwave/RRS divergence covered by the dataset.
    const bvi = lookupAlias('BVI');
    expect(bvi?.canonical).toBe('IVB');
    expect(bvi?.alias?.note).toContain('IVB');

    // Already canonical: alias is null.
    expect(lookupAlias('IRL')).toEqual({ canonical: 'IRL', alias: null });

    // Unknown input.
    expect(lookupAlias('ZZZ')).toBeNull();
  });

  it('every alias points at an existing canonical code', () => {
    for (const [from, { canonical }] of Object.entries(NATIONAL_ALIASES)) {
      expect(isKnownCode(canonical), `${from} → ${canonical}`).toBe(true);
    }
  });

  it('every code has a flag with viewBox + non-empty inner markup', () => {
    for (const c of NATIONAL_CODES) {
      const flag = NATIONAL_FLAGS[c.code];
      expect(flag, c.code).toBeDefined();
      expect(flag.viewBox, c.code).toMatch(/^[\d.\s-]+$/);
      expect(flag.inner.length, c.code).toBeGreaterThan(0);
      expect(flag.inner, c.code).not.toContain('<svg');
    }
  });

  it('getFlag returns the Irish flag inner markup', () => {
    const flag = getFlag('IRL');
    expect(flag?.viewBox).toBe('0 0 1200 600');
    expect(flag?.inner).toContain('#169b62');
    expect(flag?.inner).toContain('#ff883e');
  });
});
