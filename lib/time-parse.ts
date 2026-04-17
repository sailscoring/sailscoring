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
