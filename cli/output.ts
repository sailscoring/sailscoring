/**
 * ADR-009 M4 — shared output for read commands. Default is a human-aligned
 * table; `--json` (or `--output json`) emits the raw API shape for jq, which is
 * what makes the CLI scriptable. Every read command renders through here so the
 * convention is uniform across the growing surface.
 */

export type OutputFormat = 'table' | 'json';

export function resolveFormat(flags: Record<string, string>): OutputFormat {
  if (flags.json === 'true') return 'json';
  if (flags.output === 'json' || flags.o === 'json') return 'json';
  return 'table';
}

export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

/** Coerce an API payload to row objects: an array, or a `{ items: [...] }`
 *  envelope, or a single object → one row. */
export function toRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === 'object') {
    const items = (data as { items?: unknown }).items;
    if (Array.isArray(items)) return items as Record<string, unknown>[];
    return [data as Record<string, unknown>];
  }
  return [];
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(',');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function printTable(rows: Record<string, unknown>[], columns: string[]): void {
  if (rows.length === 0) {
    console.log('(none)');
    return;
  }
  const widths = columns.map((c) =>
    Math.max(c.length, ...rows.map((r) => cell(r[c]).length)),
  );
  const line = (vals: string[]) =>
    vals.map((v, i) => v.padEnd(widths[i])).join('  ').trimEnd();
  console.log(line(columns));
  for (const r of rows) console.log(line(columns.map((c) => cell(r[c]))));
}

/** Render `data` per the requested format: raw JSON, or a table over the given
 *  columns (falling back to JSON when no columns are supplied). */
export function render(
  flags: Record<string, string>,
  data: unknown,
  columns?: string[],
): void {
  if (resolveFormat(flags) === 'json' || !columns) {
    printJson(data);
  } else {
    printTable(toRows(data), columns);
  }
}
