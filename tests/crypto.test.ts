// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  _resetKeyCache,
  decryptCredential,
  encryptCredential,
} from '@/lib/crypto';

const KEY_HEX = 'a'.repeat(64);

describe('lib/crypto', () => {
  beforeEach(() => {
    _resetKeyCache();
    process.env.CREDENTIAL_KEY = KEY_HEX;
  });

  afterEach(() => {
    _resetKeyCache();
    delete process.env.CREDENTIAL_KEY;
  });

  test('round-trips a plaintext credential', () => {
    const blob = encryptCredential('hunter2');
    expect(blob).not.toContain('hunter2');
    expect(decryptCredential(blob)).toBe('hunter2');
  });

  test('produces a fresh ciphertext each call (random IV)', () => {
    const a = encryptCredential('same-secret');
    const b = encryptCredential('same-secret');
    expect(a).not.toBe(b);
    expect(decryptCredential(a)).toBe('same-secret');
    expect(decryptCredential(b)).toBe('same-secret');
  });

  test('rejects a tampered ciphertext via the GCM auth tag', () => {
    const blob = encryptCredential('secret');
    // Flip the last byte of the base64 blob; the auth tag check should fail.
    const tampered = blob.slice(0, -2) + (blob.slice(-2) === 'AA' ? 'AB' : 'AA');
    expect(() => decryptCredential(tampered)).toThrow();
  });

  test('throws clearly when CREDENTIAL_KEY is missing', () => {
    delete process.env.CREDENTIAL_KEY;
    _resetKeyCache();
    expect(() => encryptCredential('x')).toThrow(/CREDENTIAL_KEY/);
  });

  test('throws when CREDENTIAL_KEY is malformed', () => {
    process.env.CREDENTIAL_KEY = 'not-hex';
    _resetKeyCache();
    expect(() => encryptCredential('x')).toThrow(/64 hex/);
  });
});
