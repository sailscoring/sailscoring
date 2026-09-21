'use client';

import type { Competitor, IrcCertRecord } from '@/lib/types';

/** Metres to one decimal, as the listing states them. */
function metres(v: number | undefined): string {
  return v == null ? '—' : `${v.toFixed(2)} m`;
}

/**
 * The entry beside the certificate it was matched to, for a match the sail
 * number did not make on its own.
 *
 * A boat once took the rating of a different boat with the same name on the
 * other side of the Irish Sea. Nothing in the app said so; what gave it away
 * was a competitor reading the published figure, noticing it was slower than
 * a J/24, and looking up the certificate — 8.56 m by 2.82 m, which is not an
 * Elan 31. This puts that same comparison where the decision is made, because
 * the shape of a boat is something a scorer recognises without knowing
 * anything about the rating.
 */
export function CertComparison({
  competitor,
  cert,
}: {
  competitor: Competitor | undefined;
  cert: IrcCertRecord;
}) {
  const rows: Array<[string, string, string]> = [
    ['Sail no.', competitor?.sailNumber ?? '—', cert.sailNumber ?? '—'],
    ['Boat', competitor?.boatName ?? '—', cert.boatName ?? '—'],
    ['Class', competitor?.boatClass ?? '—', '—'],
    ['Hull length', '—', metres(cert.hullLength)],
    ['Beam', '—', metres(cert.beam)],
    ['Crew', '—', cert.crew == null ? '—' : String(cert.crew)],
  ];
  return (
    <div className="mt-1 rounded border border-amber-300/60 bg-amber-50/60 p-2 dark:border-amber-900/50 dark:bg-amber-950/30">
      <table className="text-xs" data-testid={`cert-comparison-${competitor?.sailNumber ?? ''}`}>
        <thead>
          <tr className="text-muted-foreground">
            <th className="pr-3 text-left font-normal" />
            <th className="pr-3 text-left font-normal">This entry</th>
            <th className="text-left font-normal">
              Certificate{cert.certNumber ? ` #${cert.certNumber}` : ''}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, mine, theirs]) => (
            <tr key={label}>
              <td className="pr-3 text-muted-foreground">{label}</td>
              <td className="pr-3 font-mono">{mine}</td>
              <td className="font-mono">{theirs}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
