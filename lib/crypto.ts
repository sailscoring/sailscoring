import 'server-only';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCMTypes,
} from 'node:crypto';

/**
 * Application-layer encryption for credentials stored in Postgres.
 *
 * ADR-008's sustainability posture (April 2026 Vercel breach) requires
 * sensitive values to be encrypted at the application layer rather than
 * left in plaintext where a platform compromise could exfiltrate them.
 *
 * Implementation: AES-256-GCM. The output blob is base64 of
 * `iv (12 bytes) || tag (16 bytes) || ciphertext`. The IV is freshly
 * randomised per encryption.
 *
 * Key source: `CREDENTIAL_KEY` env var, 64 hex chars (32 bytes). Read on
 * first use rather than at module load so module imports stay cheap and
 * unrelated server flows don't fail just because the key is missing.
 */

const ALGO: CipherGCMTypes = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

let cachedKey: Buffer | null = null;

function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const hex = process.env.CREDENTIAL_KEY;
  if (!hex) {
    throw new Error(
      'CREDENTIAL_KEY is not set; cannot encrypt or decrypt stored credentials',
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('CREDENTIAL_KEY must be 64 hex characters (32 bytes)');
  }
  cachedKey = Buffer.from(hex, 'hex');
  return cachedKey;
}

/** Test-only hook to reset the cached key after env mutation. */
export function _resetKeyCache(): void {
  cachedKey = null;
}

export function encryptCredential(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, loadKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptCredential(blob: string): string {
  const buf = Buffer.from(blob, 'base64');
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error('encrypted credential blob is truncated');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, loadKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
