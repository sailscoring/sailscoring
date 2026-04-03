/**
 * Convert a string to a bilge-compatible slug segment.
 * Strips file extension, lowercases, replaces non-alphanumeric runs with
 * hyphens, strips leading/trailing hyphens.
 */
export function slugify(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')              // strip extension
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Derive the full bilge slug for a file within a bundle's prefix.
 * e.g. prefix "hyc-autumn-2026", filename "Autumn Standings.html"
 *   → "hyc-autumn-2026/autumn-standings"
 */
export function deriveSlug(prefix: string, filename: string): string {
  return `${prefix}/${slugify(filename)}`;
}

/**
 * Validate that a slug string matches bilge's accepted format.
 * Must be exactly two segments: {namespace}/{name}.
 * Each segment: lowercase alphanumeric and hyphens, 1–40 chars.
 */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]\/[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$|^[a-z0-9]\/[a-z0-9]$/.test(slug);
}

/**
 * Validate a namespace prefix (single segment — no slashes).
 */
export function isValidPrefix(prefix: string): boolean {
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(prefix);
}
