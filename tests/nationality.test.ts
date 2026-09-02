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
  // Snapshot the published v1.0.3 cardinality so accidental drift on a
  // version bump (or a sync-script bug) trips a test rather than silently
  // shipping the wrong dataset. Update both when you bump the pin.
  it('pins to the expected dataset release', () => {
    expect(DATASET_VERSION).toBe('v1.0.3');
    expect(NATIONAL_CODES.length).toBe(232);
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

  it('every code has a flag: vector markup, or a WebP raster with matching dimensions', () => {
    for (const c of NATIONAL_CODES) {
      const flag = NATIONAL_FLAGS[c.code];
      expect(flag, c.code).toBeDefined();
      expect(flag.viewBox, c.code).toMatch(/^[\d.\s-]+$/);
      if (flag.raster) {
        expect(flag.inner, c.code).toBeUndefined();
        expect(flag.raster.src, c.code).toMatch(/^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/);
        expect(flag.raster.width, c.code).toBe(80);
        expect(flag.raster.height, c.code).toBeGreaterThan(0);
        expect(flag.viewBox, c.code).toBe(`0 0 ${flag.raster.width} ${flag.raster.height}`);
      } else {
        expect(flag.inner.length, c.code).toBeGreaterThan(0);
        expect(flag.inner, c.code).not.toContain('<svg');
      }
    }
  });

  // The sync script rasterizes any flag over 2 KB of markup; the worst-case
  // raster is ~2 KB of base64. So no entry should ever weigh more than this
  // again — a dataset bump that quietly ships a 149 KB coat of arms trips
  // here rather than landing in every published standings page.
  it('keeps every flag under the per-flag byte budget', () => {
    const BUDGET_BYTES = 2560;
    for (const c of NATIONAL_CODES) {
      const flag = NATIONAL_FLAGS[c.code];
      const bytes = Buffer.byteLength(flag.raster ? flag.raster.src : flag.inner);
      expect(bytes, `${c.code} is ${bytes} bytes`).toBeLessThanOrEqual(BUDGET_BYTES);
    }
  });

  it('ships the simple tricolours as vectors and the coats of arms as rasters', () => {
    expect(getFlag('IRL')?.raster).toBeUndefined();
    expect(getFlag('FRA')?.raster).toBeUndefined();
    // Spain, Croatia, Bermuda, Cyprus and Portugal were the 100 KB+ crests.
    for (const code of ['ESP', 'CRO', 'BER', 'CYP', 'POR']) {
      expect(getFlag(code)?.raster, code).toBeDefined();
    }
  });

  it('getFlag returns the Irish flag inner markup', () => {
    const flag = getFlag('IRL');
    expect(flag?.viewBox).toBe('0 0 1200 600');
    expect(flag?.inner).toContain('#169b62');
    expect(flag?.inner).toContain('#ff883e');
  });
});
