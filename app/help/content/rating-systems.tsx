'use client';

import { useFeatures } from '@/components/features-provider';

import { HelpShot, Section } from '../ui';

/** The “Rating and handicap systems” chapter — rendered by the /help/rating-systems route and,
 *  loaded on demand, by the help panel. */
export default function RatingSystems() {
  const { has } = useFeatures();
  return (
    <>
      <Section id="rating-systems" title="Rating systems">
        <HelpShot
          src="/help/shots/rating-transparency.webp"
          alt="A published ECHO page with the rating calculations revealed."
          caption="A published ECHO page with the rating calculations revealed."
        />
        <p>
          Sail Scoring supports several scoring systems. Pick the right one per fleet
          on the <strong className="text-foreground">Settings</strong> tab.
        </p>
        <ul className="list-disc list-inside space-y-1 pl-2">
          <li>
            <strong className="text-foreground">Scratch</strong> — position-based scoring
            with no time correction. The first boat across the line wins. Used for
            one-design fleets and any fleet where boats race on equal terms.
          </li>
          <li>
            <strong className="text-foreground">IRC</strong> — static handicap. Each boat
            carries a published TCC; corrected time is elapsed time × TCC. Ratings do not
            change race to race within a series.
          </li>
          {has('vprs') && (
            <li>
              <strong className="text-foreground">VPRS</strong> — the Velocity
              Prediction Rating System, a UK measurement handicap. Like IRC it is a
              static handicap scored time-on-time: each boat carries a published TCC
              and corrected time is elapsed time × TCC. Boats rated with a downwind
              sail also publish a <em>no-spinnaker</em> TCC; choose which applies per
              fleet when entering handicaps. Ratings are published per club at{' '}
              <code className="text-foreground text-sm">vprs.org</code>.
            </li>
          )}
          <li>
            <strong className="text-foreground">Fixed TCF</strong> — a handicap the
            club sets itself and holds for the whole series. The number is a TCF, so
            corrected time is elapsed time × TCF, exactly as for IRC; what differs is
            where it comes from. Howth’s autumn league works this way: each boat is
            given an HPH number from its recent form and races the league on it. See{' '}
            <em>A club handicap fixed for the series</em> below.
          </li>
          <li>
            <strong className="text-foreground">PY (Portsmouth Yardstick)</strong> —
            static handicap for mixed dinghy fleets. Each class carries a published PY
            number; corrected time is elapsed time × 1000 / PY.
          </li>
          <li>
            <strong className="text-foreground">NHC</strong> — the RYA National Handicap
            for Cruisers. A <em>progressive</em> handicap: each boat starts from a
            published TCF and the rating is adjusted after every race based on how the
            boat performed against the fleet average. Sail Scoring runs the SWNHC2015
            parameters (which match Sailwave NHC1) by default.{' '}
            {has('nhc-parameters') && (
              <>
                The per-fleet{' '}
                <strong className="text-foreground">Configure…</strong> button in
                Settings → Fleets opens a dialog where the seven blend rates and
                extreme thresholds can be overridden per fleet for parameter-tuning
                experiments.
              </>
            )}
          </li>
          {has('echo') && (
            <li>
              <strong className="text-foreground">ECHO</strong> — the Irish Sailing
              progressive handicap. Each boat starts from a published handicap H and
              the rating is adjusted after every race based on a Performance Index
              measuring the boat’s performance relative to the fleet.
            </li>
          )}
          {has('orc') && (
            <li>
              <strong className="text-foreground">ORC</strong> — a measurement rating
              whose certificate publishes the boat’s predicted performance across a
              whole matrix of wind speeds and angles, rather than one blended number.
              A fleet picks which published rating scores it — the all-purpose
              time-on-time number behaves exactly like an IRC TCC — or scores on{' '}
              <em>performance curves</em>, where each race gets its own allowance
              from the conditions actually sailed. See the ORC section below.
            </li>
          )}
        </ul>
        <p>
          For NHC and ECHO, every per-race table includes a{' '}
          <strong className="text-foreground">New TCF</strong> (or{' '}
          <strong className="text-foreground">New H</strong>) column showing the rating
          to apply in the next race — that’s usually the most-asked-about output
          of progressive scoring, so it’s always visible. Above the table, a{' '}
          <strong className="text-foreground">
            Show NHC/ECHO rating calculations
          </strong>{' '}
          checkbox reveals the per-race intermediate values (CT ratio, Fair TCF,
          Adjustment for NHC; 1/T_E, PI, Adjustment for ECHO) along with a brief
          explainer of the formula. Sailors and rating officers can use those columns
          to verify the rating updates with a calculator. The toggle is off by default
          — readers who only want the standings and next ratings see a clean page;
          those who want the math tick the box.
        </p>
        <p>
          Whether to publish the rating calculations is a per-series setting on the{' '}
          <strong className="text-foreground">Settings</strong> tab — under{' '}
          <strong className="text-foreground">Publishing</strong>, uncheck{' '}
          <strong className="text-foreground">
            Publish progressive rating calculations alongside results
          </strong>{' '}
          to omit the toggle and its columns from the published page. The setting is on
          by default and shows up whenever the series has at least one NHC or ECHO fleet.
        </p>
        <p>
          The summary table on NHC and ECHO fleets includes a seed-rating column (the
          competitor’s starting TCF or H) and prints the applied rating in small
          text beneath each score from race 2 onwards — race 1’s rating is the
          seed, so it’s shown in the dedicated column rather than repeated under
          each R1 cell. This is independent of the rating-calculations toggle and can
          be switched off via{' '}
          <strong className="text-foreground">
            Show per-race ratings in summary table
          </strong>{' '}
          in the same Publishing card.
        </p>
      </Section>
      {has('orc') && (
      <Section id="scoring-orc" title="ORC scoring and performance curves">
        <HelpShot
          src="/help/shots/orc.webp"
          alt="A published ORC performance-curve race: the scoring-wind audit header, each boat's implied wind, and the constructed course's leg record."
          caption="A published performance-curve race: the audit header, each boat's implied wind, and the course record."
        />
        <p>
          An ORC certificate is imported whole — see{' '}
          <em>Importing ORC certificates</em> below — and each ORC fleet picks its{' '}
          default <strong className="text-foreground">scoring option</strong> on the{' '}
          <strong className="text-foreground">Settings</strong> tab. The option is a
          per-race choice in the end: each race start can name the option the race
          committee announced for that race — a coastal race scored on a single
          number in a series otherwise on curves, say — with the{' '}
          <strong className="text-foreground">Scoring option</strong> select on the
          race start; the fleet setting simply fills in when a start doesn’t
          say. The simple options read one published number off the certificate:{' '}
          <strong className="text-foreground">all-purpose time-on-time</strong> (APHT)
          works exactly like an IRC TCC, and the{' '}
          <strong className="text-foreground">time-on-distance</strong> options instead
          give each boat an allowance in seconds per nautical mile — those need the
          course length recorded on each race start, and the corrected time is the
          elapsed time less the boat’s allowance over the course, measured against the
          fleet’s fastest-rated (<em>scratch</em>) boat.
        </p>
        <p>
          Between the single number and full performance curves sit the{' '}
          <strong className="text-foreground">wind bands</strong>: certificates
          also publish their ratings per wind strength — the triple numbers, and
          national sets like the Irish five-band windward/leeward options. Every
          band field the imported certificates carry is offered in the same
          scoring-option selects, so picking the band the race committee announced
          is just picking that race’s option. Changing a start’s option
          later re-scores the race without re-entering finishes, and the published
          race table names the option applied.
        </p>
        <p>
          <strong className="text-foreground">Performance curve scoring (PCS)</strong>{' '}
          goes further: instead of one number, it uses the certificate’s whole
          prediction matrix, so each race’s handicap reflects the wind that actually
          blew. Each boat’s finish time is placed on its own <em>performance curve</em>{' '}
          — the certificate’s prediction of how fast that boat covers this course at
          each wind speed — to find the boat’s{' '}
          <strong className="text-foreground">implied wind</strong>: the wind in which
          the boat would have sailed exactly to its predictions (“she sailed as if it
          blew 12 knots”). Sailing <em>better</em> than your predictions means a{' '}
          <em>higher</em> implied wind, and{' '}
          <strong className="text-foreground">the boat with the highest implied wind
          wins the race</strong>. That winner’s implied wind becomes the race’s{' '}
          <strong className="text-foreground">scoring wind</strong>, every boat’s
          allowance is read off its own curve at that wind, and corrected times follow
          as in time-on-distance. If the implied wind clearly misrepresents the day —
          say the marks were laid short — the race committee can set the scoring wind
          itself, and the published page says so.
        </p>
        <p>
          PCS runs over a standard course shape — windward/leeward, all-purpose, or
          coastal — or, most accurately, over the{' '}
          <strong className="text-foreground">constructed course</strong>: the actual
          legs sailed, entered on the race start as distance, bearing, and wind
          direction per leg (split a leg in two when the wind shifts along it).
        </p>
        <p>
          Everything needed to check a PCS result is published with it: the race table
          opens with the course, the scoring wind and where it came from, and the
          scratch allowance; each boat’s row carries its applied allowance and implied
          wind; and a constructed course lists its legs. With your own certificate’s
          allowance table you can reproduce your corrected time to the second — that
          transparency is deliberate, because implied wind is the part of ORC scoring
          competitors ask about most.
        </p>
      </Section>
      )}
      {has('orc') && (
      <Section id="course-builder" title="Building a constructed course">
        <HelpShot
          src="/help/shots/course-builder.webp"
          alt="The Courses tab: the marks adopted from the club's course card and the ones the race committee laid, the courses built from them, and the drawing of them all."
          caption="The Courses tab: the mark library, the course library, and the drawing that catches a mistyped coordinate."
        />
        <p>
          Typing a constructed course leg by leg means a calculator and the course
          card. The <strong className="text-foreground">Courses</strong> tab, which
          appears when a fleet scores ORC, does the arithmetic instead. It holds two
          libraries. <strong className="text-foreground">Marks</strong> are positions
          on the water: the club’s charted marks, adopted from its course card with{' '}
          <em>Add marks from a card…</em>, and the ones the race committee laid — the
          line, the finish, the windward mark — which you make with{' '}
          <em>New mark</em>, either as coordinates typed the way the log is written
          (degrees and decimal minutes or decimal degrees; the canonical form is
          echoed underneath as you type) or as a bearing and distance from a mark
          already there, which is how a laid mark is actually recorded.{' '}
          <strong className="text-foreground">Courses</strong> are named sequences
          of those marks: pick a number on the club’s card and the dialog lists
          exactly the marks the card cannot place itself, or build one by hand.
          Every dialog draws the marks and legs as you edit, so a dropped digit
          shows before you save.
        </p>
        <p>
          A race start then <strong className="text-foreground">picks a course</strong>{' '}
          from the list — most recently used first — and its legs fill in at the one
          wind direction you give the start, pre-filled where the card lays the
          course out for a wind. The leg table stays editable: split a leg on a wind
          shift or nudge a distance and the start is marked <em>legs edited</em>{' '}
          rather than silently recomputed; <em>Recompute from course</em> says what
          it will discard first. Each start keeps its own record of the course as it
          was when picked, drawn on the published page, so correcting a mark later
          never moves a scored race. Names are how you find things again a
          fortnight later: the date and race are proposed, and the qualifier that
          matters — <em>inner</em>, <em>outer</em> — is yours to add. The second
          course of a day is <em>Swap a mark…</em> on the first.
        </p>
      </Section>
      )}
      <Section id="fixed-tcf" title="A club handicap fixed for the series">
        <HelpShot
          src="/help/shots/fixed-tcf.webp"
          alt="A fleet scored on a fixed club handicap, called HPH."
          caption="A fleet scored on a fixed club handicap, called HPH."
        />
        <p>
          Some clubs handicap their own racing. A committee sets a number per boat
          before the series — from last season’s results, from the handicapper’s
          judgement, or both — and that number stands for every race. Set the fleet’s
          scoring system to <strong className="text-foreground">Fixed TCF</strong> on
          the <strong className="text-foreground">Settings</strong> tab and enter each
          boat’s number on the Competitors tab.
        </p>
        <p>
          Beside the system picker is a <em>called</em> box: type what your club calls
          the number — Howth’s is <strong className="text-foreground">HPH</strong> —
          and that word heads the rating column everywhere the fleet is shown and
          published, instead of the generic TCF. Leave it empty and the column reads
          TCF.
        </p>
        <p>
          A fixed handicap is not a frozen one. If the committee re-rates a boat
          part-way through, change its number on the Competitors tab and leave{' '}
          <strong className="text-foreground">Keep already-scored races on the old
          rating</strong> ticked: the races already sailed keep the number they were
          sailed under and only later races use the new one.
        </p>
        <p>
          This is the difference from <strong className="text-foreground">NHC</strong>{' '}
          and <strong className="text-foreground">ECHO</strong>, which recalculate
          every boat’s rating after every race. If the club’s intent is that a good
          result costs you rating next week, those are the systems you want. If the
          intent is that the number was set in advance and the racing is scored
          against it, this is.
        </p>
      </Section>
      <Section id="updating-handicaps" title="Updating handicaps from another series">
        <p>
          The <strong className="text-foreground">Update handicaps</strong> button on the
          Competitors tab carries each boat’s handicap forward from a prior series in this
          workspace. For progressive systems (NHC, ECHO) the new starting handicap is the
          boat’s TCF after the source series’ last scored race; for static systems (IRC,
          VPRS, PY) it is whatever value the source series currently has on that competitor.
        </p>
        <p>
          A <strong className="text-foreground">Fixed TCF</strong> fleet can be fed by a
          progressive one, which is how a club league is usually set up: map your{' '}
          <em>Class 1 HPH</em> fixed-TCF fleet onto the <em>Class 1 HPH</em> NHC fleet of
          the season just gone, and each boat’s handicap at the end of that series becomes
          the number it races the league on — fixed from there. Mapping it onto another
          fixed-TCF fleet carries the numbers over unchanged. Measurement ratings are not
          offered as a source: an IRC TCC is a certificate, not a club handicap.
        </p>
        <p>
          The dialog previews every change as{' '}
          <code className="font-mono text-xs">current → new</code> before anything is written.
          Untick individual rows to keep specific boats unchanged. A boat that doesn’t appear
          in the source series, or that has no value to copy, is left at its current handicap.
        </p>
        <p>
          When a change affects a rating the boat carries as a single number —{' '}
          <strong className="text-foreground">IRC, VPRS, PY or a fixed TCF</strong> — and
          the boat has already-scored races, the dialog offers{' '}
          <strong className="text-foreground">Keep already-scored races on the old rating</strong>{' '}
          (on by default). Leave it on for a <em>mid-series rating change</em> — a new certificate —
          so races already sailed keep their old rating and only later races use the new value;
          the boat’s record still carries the new rating forward. Turn it off to{' '}
          <em>correct</em> a wrong rating, which re-scores every race on the new value.
        </p>
      </Section>
      {has('irc-rating') && (
      <Section id="update-handicaps-irc-rating" title="Updating IRC TCCs from the rating list">
        <HelpShot
          src="/help/shots/update-handicaps-irc.webp"
          alt="IRC TCCs proposed from the rating list — every change previewed boat by boat."
          caption="IRC TCCs proposed from the rating list — every change previewed boat by boat."
        />
        <p>
          The <strong className="text-foreground">Update handicaps</strong> dialog can pull IRC
          TCCs directly from the worldwide IRC rating list, matched by sail number. Choose{' '}
          <em>IRC TCC (international)</em> as the source. This saves typing in published values and
          avoids transcription errors, and — being the worldwide list — it covers boats from any
          country, not just Irish entries.
        </p>
        <p>
          Each IRC fleet has its own <strong className="text-foreground">spinnaker</strong> /{' '}
          <strong className="text-foreground">non-spinnaker</strong> choice, so a series with a mix
          of spinnaker and non-spinnaker classes is handled in one pass — set the non-spinnaker
          classes to their non-spin TCC. As with the prior-series source, every change is previewed
          as <code className="font-mono text-xs">current → new</code> before anything is written,
          and you can untick individual boats.
        </p>
        <p>
          Sail numbers are matched ignoring case and spacing, and tolerating a missing country
          code (so on an Irish setup <code className="font-mono text-xs">1431</code> matches{' '}
          <code className="font-mono text-xs">IRL1431</code>) — though two different boats sharing
          a number are flagged rather than guessed. Turn on{' '}
          <strong className="text-foreground">Also match by boat name</strong> to catch boats whose
          sail number doesn’t line up. Boats not on the list are left unchanged.
        </p>
        <p>
          A boat that holds two IRC certificates — a primary and a secondary for a different sail
          configuration — defaults to the higher TCC, with a dropdown on its row to switch to the
          other.
        </p>
        <p>
          If a boat is in the series but not yet in an IRC fleet — say it gained an IRC certificate
          after entry — it appears under{' '}
          <strong className="text-foreground">Add to handicap fleet</strong>. Tick it, choose the
          target fleet, and it joins that fleet with the rating seeded in one step. Each row lists
          the fleets the boat is already in, so a boat in{' '}
          <em>Cruisers 1 (NHC)</em> can be sent to <em>Cruisers 1 (IRC)</em> without leaving the
          dialog. Adding a boat
          to a fleet mid-series means it is scored <strong className="text-foreground">DNC</strong>{' '}
          for races already sailed in that fleet, so this is opt-in per boat.
        </p>
        <p>
          The other direction appears under{' '}
          <strong className="text-foreground">Not on the rating list</strong>: boats sitting in an
          IRC fleet that the list doesn’t rate. This is the counterpart of creating an IRC fleet at
          import time, when the entry list can’t say who holds a certificate and every boat in the
          group joins — the rating list is the first thing that knows better, which is why the
          import itself ends by offering to run this source. Read the names before
          ticking: a boat the list has simply missed belongs where it is — the header checkbox
          takes the lot once you have. Boats that have already raced are never offered, since
          taking one out would drop its scored races.
        </p>
      </Section>
      )}
      {has('orc') && (
      <Section id="update-handicaps-orc" title="Importing ORC certificates">
        <p>
          The <strong className="text-foreground">Update handicaps</strong> dialog can
          import ORC certificates straight from the ORC database’s active-certificates
          listing, matched by sail number. Choose <em>ORC certificates</em> as the
          source, pick the issuing country (a certificate from any country’s rating
          office is valid — run the source once per country for visiting boats), and
          set each ORC fleet’s <strong className="text-foreground">certificate
          family</strong>: standard fully-crewed, non-spinnaker, or double-handed. A
          boat may hold a non-spinnaker or double-handed certificate alongside its
          standard one; it is scored on the family its fleet races under.
        </p>
        <p>
          A boat in a non-spinnaker or double-handed fleet that holds no certificate
          in that family gets its <strong className="text-foreground">standard
          certificate</strong> instead, rather than being left unrated — the preview
          says how many boats that is, and each such row is marked{' '}
          <em>ORC (standard cert)</em> so you can see what the boat would be scored
          on. ORC scores a boat on the certificate it entered on, so this is your
          call: untick the row to leave the boat as it is. Only a boat holding no
          certificate at all is offered for removal from the fleet.
        </p>
        <p>
          What’s imported is the <em>whole certificate</em> — the published ratings,
          the class-division numbers (CDL and GPH, shown as sortable columns on the
          Competitors tab), the expiry date, and the full time-allowance matrix that
          performance-curve scoring runs on. The preview shows each boat’s
          time-on-time number as the <code className="font-mono text-xs">current →
          new</code> delta, flags certificates that have expired or mix VPP years
          (ORC requires all boats in an event on the same VPP year), and a boat’s row
          in the edit dialog links to the printable certificate on the ORC site.
          Re-running the source after a boat is re-rated picks up the new certificate
          issue; unmatched boats are left unchanged, and the add-to-fleet /
          not-on-the-list sections work as they do for IRC.
        </p>
      </Section>
      )}
      {has('vprs') && (
      <Section id="update-handicaps-vprs" title="Updating VPRS TCCs from a club list">
        <p>
          The <strong className="text-foreground">Update handicaps</strong> dialog can pull VPRS
          TCCs from a club’s published rating list, matched by sail number. Choose{' '}
          <em>VPRS TCC</em> as the source, then pick the club. VPRS publishes a separate list per
          club — and a boat’s TCC can differ between them — so the club you choose is the one
          whose ratings are applied. On an Irish setup the Irish clubs are listed first.
        </p>
        <p>
          As with IRC, each VPRS fleet has its own{' '}
          <strong className="text-foreground">spinnaker</strong> /{' '}
          <strong className="text-foreground">no-spinnaker</strong> choice — set the
          no-spinnaker classes to their no-spin TCC. Every change is previewed as{' '}
          <code className="font-mono text-xs">current → new</code> before anything is written, and
          you can untick individual boats. Sail numbers match ignoring case, spacing, and a missing
          country code; turn on <strong className="text-foreground">Also match by boat name</strong>{' '}
          to catch boats whose sail number doesn’t line up. Boats not on the club’s list
          are left unchanged.
        </p>
      </Section>
      )}
      {has('echo') && (
      <Section id="update-handicaps-irish-sailing" title="Updating ECHO from Irish Sailing">
        <HelpShot
          src="/help/shots/update-handicaps-echo.webp"
          alt="ECHO handicaps proposed from the Irish Sailing list."
          caption="ECHO handicaps proposed from the Irish Sailing list."
        />
        <p>
          The <strong className="text-foreground">Update handicaps</strong> dialog can pull ECHO
          handicaps directly from the national{' '}
          <strong className="text-foreground">Irish Sailing</strong> ratings list, matched by sail
          number. Choose <em>Irish Sailing ECHO</em> as the source. Irish Sailing is the authority
          for ECHO — an Irish handicap system — so this is the source for it (IRC TCCs come from the
          international IRC rating list instead).
        </p>
        <p>
          ECHO has no spinnaker / non-spinnaker split, so the published ECHO value is used as-is.
          As with the prior-series source, every change is previewed as{' '}
          <code className="font-mono text-xs">current → new</code> before anything is written, and
          you can untick individual boats.
        </p>
        <p>
          Sail numbers are matched ignoring case and spacing, and tolerating a missing country
          code (so <code className="font-mono text-xs">1431</code> matches{' '}
          <code className="font-mono text-xs">IRL1431</code>) — though two different boats sharing
          a number are flagged rather than guessed. Turn on{' '}
          <strong className="text-foreground">Also match by boat name</strong> to catch boats whose
          sail number doesn’t line up. Boats not on the list are left unchanged.
        </p>
        <p>
          If a boat is in the series but not yet in an ECHO fleet, it appears under{' '}
          <strong className="text-foreground">Add to handicap fleet</strong>. Tick it, choose the
          target fleet, and it joins that fleet with the ECHO handicap seeded in one step. Each row
          lists the fleets the boat is already in, so the matching handicap fleet is obvious. Adding
          a
          boat to a fleet mid-series means it is scored{' '}
          <strong className="text-foreground">DNC</strong> for races already sailed in that fleet,
          so this is opt-in per boat.
        </p>
      </Section>
      )}
      {has('rya-py') && (
      <Section id="update-handicaps-rya-py" title="Updating PY numbers from the RYA list">
        <p>
          For <strong className="text-foreground">Portsmouth Yardstick</strong> fleets, the{' '}
          <strong className="text-foreground">Update handicaps</strong> dialog can set each boat’s
          PY number from the RYA’s published list. Choose{' '}
          <em>RYA Portsmouth Yardstick</em> as the source. Unlike the IRC and ECHO sources — which
          match each boat by sail number — PY is a per-class list, so boats are matched by their{' '}
          <strong className="text-foreground">class</strong>. A whole one-design fleet is therefore
          a single row.
        </p>
        <p>
          Each distinct class is matched against the RYA register (ignoring case, spacing and
          punctuation, and resolving aliases such as <em>Laser</em> → <em>ILCA 7 / Laser</em>). For
          each matched class you can apply two things independently:{' '}
          <strong className="text-foreground">Name</strong> normalises the stored class to the
          register spelling, and <strong className="text-foreground">Number</strong> writes the PY
          number. A class that matches several configurations (for example the two Comet Trio rigs),
          or that isn’t found, shows a picker so you can choose the right one or skip it.
        </p>
        <p>
          Numbers from the RYA’s experimental and limited-data lists are flagged{' '}
          <span className="text-amber-600 dark:text-amber-500">guide only</span> — the RYA publishes
          them as starting points to review locally. The list is bundled with the app and refreshed
          at most once a year, so its version is shown at the foot of the dialog.
        </p>
      </Section>
      )}
    </>
  );
}
