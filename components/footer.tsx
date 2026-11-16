import { SponsorCredit } from '@/components/sponsor-credit';

/**
 * Three columns on a wide screen — links left, sponsors centred, copyright
 * right — with equal-width outer tracks so the sponsors sit at the true centre
 * whatever the outer columns hold. The middle wrapper is always rendered so the
 * copyright keeps its column when there are no sponsors. Narrower than that,
 * the three wrap as centred rows rather than squeezing the outer columns.
 */
export function Footer() {
  return (
    <footer className="border-t px-6 py-3 mt-8 text-xs text-muted-foreground flex flex-wrap items-center justify-center gap-x-6 gap-y-2 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:gap-4">
      <div className="flex items-center gap-x-4 lg:justify-self-start">
        <a
          href="https://sailscoring.ie/legal/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline hover:text-foreground"
        >
          Privacy
        </a>
        <a
          href="https://sailscoring.ie/legal/terms"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline hover:text-foreground"
        >
          Terms
        </a>
      </div>
      <div className="flex justify-center">
        <SponsorCredit className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1" />
      </div>
      <span className="whitespace-nowrap lg:justify-self-end">
        Sail Scoring™ © {new Date().getFullYear()} Mark McLoughlin
      </span>
    </footer>
  );
}
