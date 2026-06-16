/**
 * Vanity slugs for cross-series competitors (#217): the stable, shareable handle
 * in the public URL (`/p/{ws}/competitor/charlie-keating-x78q`) and the key the
 * iodai-archive manifest reconciles against (#218).
 *
 * A slug is `slugifyName(label)` + `-` + a short random suffix. The suffix
 * disambiguates the inevitable namesakes *and* lets the displayed name be
 * corrected (mojibake, typos) without the URL moving — so a slug is minted once
 * and never recomputed. Pure: minting against the DB's uniqueness lives in the
 * repository.
 */

/**
 * Fold a competitor's name into a slug base: strip diacritics (so `"Seán"` →
 * `"sean"`, not the `"se-n"` the generic `kebab()` would produce by hyphenating
 * the accented letter), lowercase, hyphenate runs of non-alphanumerics, trim.
 * Falls back to `"competitor"` for a blank/punctuation-only name so the slug is
 * never just a bare suffix.
 */
export function slugifyName(label: string): string {
  const base = label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // drop combining marks left by NFKD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'competitor';
}

// No 0/o/1/l/i — avoids the characters people misread or mistype when copying a
// slug from a results sheet.
const SUFFIX_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const SUFFIX_LENGTH = 4;

/** A short random suffix from an unambiguous alphabet (~31^4 ≈ 920k values). */
export function randomSlugSuffix(): string {
  let out = '';
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    out += SUFFIX_ALPHABET[Math.floor(Math.random() * SUFFIX_ALPHABET.length)];
  }
  return out;
}

/** A fresh slug candidate for a label. Uniqueness (retry on collision) is the
 *  caller's job — the suffix makes collisions rare, not impossible. */
export function competitorSlugCandidate(label: string): string {
  return `${slugifyName(label)}-${randomSlugSuffix()}`;
}

/**
 * Mint a slug for `label` that isn't in `reserved`, adding it to the set. The
 * caller seeds `reserved` with the slugs already taken (e.g. a workspace's
 * existing slugs) so a whole batch can be minted in memory without a
 * round-trip per candidate. Extends the entropy in the (vanishing) event the
 * random suffix keeps colliding, so it always returns eventually.
 */
export function mintSlug(label: string, reserved: Set<string>): string {
  for (let i = 0; i < 20; i++) {
    const candidate = competitorSlugCandidate(label);
    if (!reserved.has(candidate)) {
      reserved.add(candidate);
      return candidate;
    }
  }
  let candidate = `${competitorSlugCandidate(label)}-${randomSlugSuffix()}`;
  while (reserved.has(candidate)) {
    candidate = `${competitorSlugCandidate(label)}-${randomSlugSuffix()}`;
  }
  reserved.add(candidate);
  return candidate;
}
