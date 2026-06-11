/**
 * Accept flexible time input: "HH:MM:SS", "H:MM:SS", or bare digits "HHMMSS" / "HMMSS".
 * Returns a normalised "HH:MM:SS" string, or null if the input cannot be parsed.
 */
export function normalizeTimeInput(raw: string): string | null {
  const s = raw.trim();
  let h: number, m: number, sec: number;
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(s)) {
    [h, m, sec] = s.split(':').map(Number);
  } else if (/^\d{5,6}$/.test(s)) {
    const p = s.padStart(6, '0');
    h = parseInt(p.slice(0, 2), 10);
    m = parseInt(p.slice(2, 4), 10);
    sec = parseInt(p.slice(4, 6), 10);
  } else {
    return null;
  }
  if (m > 59 || sec > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/**
 * Parse "H:MM:SS" / "HH:MM:SS" into seconds-since-midnight. Returns null
 * when the value is missing or malformed (wrong shape, non-numeric parts).
 *
 * Deliberately does NOT range-check minutes/seconds: the scoring engine has
 * always accepted out-of-range parts in stored data, and re-scoring existing
 * series must not change. `normalizeTimeInput` above is the strict gate at
 * entry time; this is the tolerant reader the engine, renderer, and
 * start-sequence math share so they provably agree on what a time means.
 */
export function parseHmsToSeconds(t: string | undefined | null): number | null {
  if (!t) return null;
  const parts = t.split(':').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  const [h, m, s] = parts;
  return h * 3600 + m * 60 + s;
}

/** Format seconds-since-midnight as "HH:MM:SS". Hours may exceed 23 (a
 *  start sequence pushed past midnight keeps counting). */
export function formatSecondsAsHms(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
