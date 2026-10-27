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
 * Key source: an env var of 64 hex chars (32 bytes) — `CREDENTIAL_KEY` for
 * FTP server passwords, `OAUTH_CLIENT_SECRET_KEY` for OAuth client secrets.
 * Each is read on first use rather than at module load so module imports
 * stay cheap and unrelated server flows don't fail just because a key is
 * missing.
 */

const ALGO: CipherGCMTypes = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

type KeyName = 'CREDENTIAL_KEY' | 'OAUTH_CLIENT_SECRET_KEY';

const cachedKeys = new Map<KeyName, Buffer>();

function loadKey(name: KeyName): Buffer {
  const cached = cachedKeys.get(name);
  if (cached) return cached;
  const hex = process.env[name];
  if (!hex) {
    throw new Error(
      `${name} is not set; cannot encrypt or decrypt stored credentials`,
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`${name} must be 64 hex characters (32 bytes)`);
  }
  const key = Buffer.from(hex, 'hex');
  cachedKeys.set(name, key);
  return key;
}

/** Test-only hook to reset the cached keys after env mutation. */
export function _resetKeyCache(): void {
  cachedKeys.clear();
}

function encrypt(name: KeyName, plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, loadKey(name), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

function decrypt(name: KeyName, blob: string): string {
  const buf = Buffer.from(blob, 'base64');
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error('encrypted credential blob is truncated');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, loadKey(name), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export function encryptCredential(plaintext: string): string {
  return encrypt('CREDENTIAL_KEY', plaintext);
}

export function decryptCredential(blob: string): string {
  return decrypt('CREDENTIAL_KEY', blob);
}

/**
 * OAuth client secrets have a key of their own, not BETTER_AUTH_SECRET: the
 * operator registers clients from their own machine, so needs a copy of the
 * key, and one that encrypts nothing else can be held there, and replaced,
 * without touching sessions.
 */
export function encryptOAuthClientSecret(plaintext: string): string {
  return encrypt('OAUTH_CLIENT_SECRET_KEY', plaintext);
}

export function decryptOAuthClientSecret(blob: string): string {
  return decrypt('OAUTH_CLIENT_SECRET_KEY', blob);
}
