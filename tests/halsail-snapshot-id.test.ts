import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { RFC_UUID, contentHashUuid } from '@/lib/halsail/snapshot-id';

const uuid = z.uuid();

describe('contentHashUuid', () => {
  it('produces ids the app boundary (z.uuid) accepts', () => {
    // Many raw sha256 slices land on an invalid version/variant nibble; the
    // helper must fix them. Exercise a spread of inputs so we catch any that
    // would otherwise slip an invalid variant through.
    for (let i = 0; i < 200; i++) {
      const id = contentHashUuid(`payload-${i}`);
      expect(RFC_UUID.test(id), id).toBe(true);
      expect(uuid.safeParse(id).success, id).toBe(true);
    }
  });

  it('is deterministic for identical input', () => {
    expect(contentHashUuid('same')).toBe(contentHashUuid('same'));
  });

  it('changes when the content changes', () => {
    expect(contentHashUuid('a')).not.toBe(contentHashUuid('b'));
  });
});
