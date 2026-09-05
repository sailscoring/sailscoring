'use client';

import { useFeatures } from '@/components/features-provider';

import { Section } from '../ui';

/** The “Across series and seasons” chapter — rendered by the /help/across-series route and,
 *  loaded on demand, by the help panel. */
export default function AcrossSeries() {
  const { has } = useFeatures();
  return (
    <>
      {has('competitor-identity') && (
      <Section id="competitor-identity" title="Competitors and timelines">
        <p>
          When the same sailor races series after series, each entry is a
          separate row with nothing linking them. The{' '}
          <strong className="text-foreground">competitor-identity</strong> spine
          collapses those rows into one <strong className="text-foreground">recurring
          competitor</strong>, so the app can show a sailor’s whole history
          across seasons — the basis of the public{' '}
          <strong className="text-foreground">competitor timeline</strong>.
        </p>
        <p>
          Competitors are built by an automatic reconcile pass that matches on
          name, club, sail number, and — where age is recorded — implied birth
          year. It is deliberately cautious: when a match isn’t
          corroborated it leaves the rows apart rather than risk merging two
          different sailors.
        </p>
        <p>
          Clubs are read as your entries write them, so one club spelled
          several ways still counts as one club. If most of your entries leave
          the club blank because everyone is assumed to be a member, name your
          club under{' '}
          <strong className="text-foreground">Home club</strong> in workspace
          settings: a blank club then means “one of ours” rather than
          “unknown”, and a regular’s record stays in one piece. Visitors who name their own club are unaffected, and nothing
          is written onto the entries themselves.
        </p>
        {has('competitor-identity-crew') && (
          <p>
            Crew count as sailors too. On a crewed boat both people get a
            record, so someone who only ever crews still has a history, and
            someone who helms one season and crews the next has one record
            rather than two halves. A crewing entry is marked{' '}
            <strong className="text-foreground">Crew</strong> and names whose
            boat it was, since the two sailors share the same finishing
            position. Crew names are often recorded loosely — a first name
            alone, initials, a question mark — and anything that doesn’t
            identify a person is left as published rather than turned into a
            record. Cross-series rankings still count the helm only.
          </p>
        )}
        {has('competitor-reconcile') && (
          <>
            <p>
              Competitors fill in automatically: whenever entries are added or
              imported, each one either joins its recurring competitor or starts
              a new record — you never re-run anything. Review the result on the{' '}
              <strong className="text-foreground">Competitors</strong> tab of the
              workspace home: each card is one recurring competitor with the
              series they entered.
            </p>
            <p>
              Anything the matcher is unsure about queues under{' '}
              <strong className="text-foreground">To review</strong>. A{' '}
              <em>possible same sailor</em> pair — two records sharing only a
              name — offers <strong className="text-foreground">Combine</strong>{' '}
              (with an immediate undo) or{' '}
              <strong className="text-foreground">Different sailors</strong>,
              which dismisses the pair for good. An arc spanning more years than
              a sailor could plausibly stay in the class is flagged{' '}
              <strong className="text-foreground">long arc</strong> — usually two
              namesakes: split the misgrouped entries, or confirm it with{' '}
              <strong className="text-foreground">Looks right</strong>.
            </p>
            <p>
              On any card: click the name to{' '}
              <strong className="text-foreground">rename</strong>, use the
              scissors (or tick several entries and{' '}
              <strong className="text-foreground">Split selected</strong>) to peel
              misgrouped entries onto a competitor of their own, or{' '}
              <strong className="text-foreground">Merge…</strong> the card into
              another record the matcher never connected. Splits stick: the
              automatic matching never re-joins what you separated.
            </p>
            <p>
              Records badged{' '}
              <strong className="text-foreground">archive</strong> come from a
              results archive and are corrected there rather than here — you
              can still merge one of your records <em>into</em> an archive
              record when they’re the same sailor.
            </p>
          </>
        )}
        <p>
          Each competitor has a public timeline listing every series they
          entered, in order, with their{' '}
          <strong className="text-foreground">finishing position</strong> in each
          (“3rd of 48”), scored by the same engine as the results
          pages. It shows only what’s already public in the results — event,
          year, position, sail number, club — never a sailor’s age.
        </p>
        <p>
          The workspace’s public results page links to a{' '}
          <strong className="text-foreground">competitor index</strong> — a
          searchable roster of everyone who has raced. Search by name or sail
          number (“who sailed 1605?”) or filter by year, and follow
          a competitor through to their timeline. These public pages are
          shareable by link but kept out of search engines.
        </p>
      </Section>
      )}
      {has('rankings') && (
      <Section id="rankings" title="Cross-series rankings">
        <p>
          A <strong className="text-foreground">ranking</strong> is a season
          ladder computed across several series — the classic shape is a
          championship plus a sailor’s best N regional results, summed so
          the lowest total ranks first. Create and view them on the{' '}
          <strong className="text-foreground">Rankings</strong> tab of the
          workspace home.
        </p>
        <p>
          A ranking is a set of <strong className="text-foreground">buckets</strong>.
          Each bucket picks the series that belong to it, how many of a
          sailor’s best places count (<em>count best</em>), and how many of
          its series a sailor must have sailed to rank at all (<em>need at
          least</em>). For example: a <em>National</em> bucket holding just the
          Nationals (best 1, need 1) and a <em>Regional</em> bucket holding the
          regionals (best 2, need 2). Sailors short of a floor are listed as not
          yet ranked rather than dropped silently; an optional nationality filter
          restricts the ladder to home sailors, and an optional fleet filter to
          one fleet by name. The nationality filter can also{' '}
          <strong className="text-foreground">count places among matching
          sailors only</strong> — a home sailor finishing 2nd behind a visiting
          boat counts a 1st, the convention national rankings like IODAI’s
          use. Sailors with no nationality set are left out of that numbering,
          so the ladder warns about them.
        </p>
        <p>
          The ladder groups results by recurring competitor, so it stays right
          across sail-number and boat changes — if some finishers show as{' '}
          <em>not yet matched</em>, resolve them on the{' '}
          <strong className="text-foreground">Competitors</strong> tab and the
          ladder picks them up. Places compare in one combined pool: a 2nd is a
          2nd, whichever fleet it was scored in. Where fleets are ranked apart —
          say a Junior and a Senior ladder — give each its own ranking with a
          fleet filter naming that fleet.
        </p>
        <p>
          The ladder reads like a standings table: a column per series showing
          each sailor’s place, discarded places in parentheses, podium
          places medal-coloured, and Total alongside the Net that ranks.
          Where a committee sets a place by hand — an averaged place for a
          sailor away on representational duty, medical redress — add an{' '}
          <strong className="text-foreground">adjustment</strong> in the
          ranking’s configuration: the place (fractions allowed) appears
          with an asterisk and your note explains it, as a tooltip in-app and
          a footnote on the public page.
        </p>
        <p>
          Switch <strong className="text-foreground">Public page</strong> on to
          host the ladder at a public URL that updates as results land. As with
          publishing standings, you choose the URL’s last segment while
          the ranking is private; once published it’s fixed. The
          public ladder counts <strong className="text-foreground">published
          series only</strong> and names exactly which series it’s based
          on — publish the contributing series to bring them in.
        </p>
      </Section>
      )}
    </>
  );
}
