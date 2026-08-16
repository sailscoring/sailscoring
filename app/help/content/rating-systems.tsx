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
      <Section id="updating-handicaps" title="Updating handicaps from another series">
        <p>
          For NHC, ECHO, IRC, and PY fleets, the{' '}
          <strong className="text-foreground">Update handicaps</strong> button on the Competitors
          tab carries each boat’s handicap forward from a prior series in this workspace. For
          progressive systems (NHC, ECHO) the new starting handicap is the boat’s TCF after
          the source series’ last scored race; for static systems (IRC, PY) it is whatever
          value the source series currently has on that competitor.
        </p>
        <p>
          The dialog previews every change as{' '}
          <code className="font-mono text-xs">current → new</code> before anything is written.
          Untick individual rows to keep specific boats unchanged. A boat that doesn’t appear
          in the source series, or that has no value to copy, is left at its current handicap.
        </p>
        <p>
          When a change affects an <strong className="text-foreground">IRC or PY</strong> rating and
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
