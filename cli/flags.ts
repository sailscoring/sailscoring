/** Shared flag-value parsers for the CLI. The arg parser collapses repeated
 *  flags to a single value, so list/map flags are comma-separated (mirroring
 *  `provision-org`'s `--enable-feature a,b`). */

/** `"a,b,c"` → `['a','b','c']`; absent/`true` → `undefined`. */
export function parseList(raw: string | undefined): string[] | undefined {
  if (!raw || raw === 'true') return undefined;
  const items = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

/** `"fleet=path,other=p2"` → `{ fleet: 'path', other: 'p2' }`; absent/`true` →
 *  `undefined`. Throws on an entry missing `=`. */
export function parsePairs(
  raw: string | undefined,
): Record<string, string> | undefined {
  if (!raw || raw === 'true') return undefined;
  const map: Record<string, string> = {};
  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) throw new Error(`expected key=value, got "${trimmed}"`);
    map[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return Object.keys(map).length > 0 ? map : undefined;
}
