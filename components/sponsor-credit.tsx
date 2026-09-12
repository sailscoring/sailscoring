import { foundingSponsors } from '@/lib/sponsors';

/**
 * The in-app Founding Sponsor acknowledgement — the third recognition surface
 * (governance D5), and a Founding-tier benefit only. It is the one place the
 * people actually doing the scoring see who makes the tool sustainable, so it
 * belongs in stable chrome (the footer, the sign-in page) and nowhere near the
 * scoring workflow itself.
 *
 * Renders nothing when there are no Founding Sponsors, so call sites don't
 * need their own guard.
 */
export function SponsorCredit({ className = '' }: { className?: string }) {
  if (foundingSponsors.length === 0) return null;

  return (
    <span className={className}>
      <span>Supported by</span>
      {foundingSponsors.map((sponsor) => (
        <a
          key={sponsor.id}
          href={sponsor.href}
          target="_blank"
          rel="noopener noreferrer"
          title={`${sponsor.name} — Founding Sponsor ${sponsor.since}`}
          className="flex items-center gap-1.5 hover:underline hover:text-foreground"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={sponsor.logoUrl}
            alt=""
            className="h-5 w-auto max-w-8 object-contain"
          />
          <span>{sponsor.name}</span>
        </a>
      ))}
    </span>
  );
}
