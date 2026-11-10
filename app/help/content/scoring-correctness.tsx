'use client';

import { useFeatures } from '@/components/features-provider';

import { HelpShot, Section } from '../ui';

/** The “Scoring correctness” chapter — rendered by the /help/scoring-correctness route and,
 *  loaded on demand, by the help panel. */
export default function ScoringCorrectness() {
  const { has } = useFeatures();
  return (
    <>
      <Section id="discard-rules" title="Discard rules">
        <HelpShot
          src="/help/shots/discard-rules.webp"
          alt="The Scoring card: each discard rule is a sentence you can check against the sailing instructions."
          caption="The Scoring card: each discard rule is a sentence you can check against the sailing instructions."
        />
        <p>
          A <strong className="text-foreground">discard</strong> lets a competitor drop their worst
          race score from the series total — a bad day doesn’t ruin a whole season. Only the
          resulting <em>nett</em> score counts for ranking; the full series total is still displayed
          for reference.
        </p>
        <p>
          Discards are configured per series on the{' '}
          <strong className="text-foreground">Settings</strong> tab, in the{' '}
          <strong className="text-foreground">Scoring</strong> card. Each rule is a sentence: with a
          number of races sailed, that many of each competitor’s worst scores are excluded. For
          example:
        </p>
        <ul className="list-disc list-inside space-y-1 pl-2">
          <li>
            <em>With 5 races sailed, exclude 1 score</em> — no discards until 5 races have been
            sailed; one from then on.
          </li>
          <li>
            Add a second rule, <em>With 9 races sailed, exclude 2 scores</em>, to increase the
            allowance as the series grows. Each rule states the <em>total</em>, so the second one
            means two discards, not one on top of one.
          </li>
        </ul>
        <p>
          A rule that never takes effect, that reduces the allowance, or that would discard every
          race is flagged where you can see it — but nothing prevents you saving it, since an
          unusual profile is sometimes exactly what the sailing instruction says.
        </p>
        <p>
          To add a rule, click <strong className="text-foreground">Add rule</strong>, fill it in,
          then click <strong className="text-foreground">Save</strong>. To remove a rule, click the ×
          button on that row. A series with no rules has no discards.
        </p>
        <p>
          The worst race(s) are dropped per competitor — each competitor discards their own worst
          score. When two races have the same score, the earlier race is discarded.
        </p>

        {has('proportional-discards') && (
          <>
            <h3 className="text-base font-medium text-foreground pt-2">
              An allowance stated as a proportion
            </h3>
            <p>
              Club long-series sailing instructions often state the allowance as a proportion
              instead of a table — <em>“one third of the results will be discarded (rounded down)”</em>,
              or <em>“no race shall be excluded until 5 have been sailed, after which one further
              race may be excluded for every 3 sailed”</em>. Hand-expanding that into a rule per
              step-up gives a list of numbers that no longer resembles what the SI says, and a long
              series needs a lot of them.
            </p>
            <p>
              Switch the <strong className="text-foreground">Scoring</strong> card to{' '}
              <strong className="text-foreground">One per so many races</strong> and state it as
              two numbers: how many races earn each discard, and the race count at which the first
              one applies. The card reads back where the allowance steps up —{' '}
              <em>steps up at 3, 6, 9, 12, 15 … races sailed</em> — which is what you check against
              the sailing instruction, since there are no rows to read a range off.
            </p>
            <p>
              The count is always rounded <strong className="text-foreground">down</strong>, is
              measured against races <em>sailed</em> (an abandoned race earns no discard), and can
              never exceed the number of races sailed. A proportional rule{' '}
              <strong className="text-foreground">replaces</strong> the step rules rather than
              adding to them; the step rules are kept, so switching back loses nothing.
            </p>

            <h3 className="text-base font-medium text-foreground pt-2">
              Counting the best races
            </h3>
            <HelpShot
              src="/help/shots/count-best-discards.webp"
              alt="The Scoring card counting the best 4 races, with what that gives the series' 6 races."
              caption="Count the best races: one number, and what it gives the series as it stands."
            />
            <p>
              Many sailing instructions say how many races <em>count</em> rather than how many are
              discarded — <em>“the best 5 results out of all sailed races”</em>. Sailwave writes it
              as the expression <code>s-5</code>. Rules per step can only approximate it by listing
              every race count, and stop being right the day the organiser adds a race the schedule
              didn’t have.
            </p>
            <p>
              Switch the <strong className="text-foreground">Scoring</strong> card to{' '}
              <strong className="text-foreground">Count the best races</strong> and enter the
              number. The card says what it gives the series as it stands —{' '}
              <em>With 18 races: 13 discards, 5 count</em> — and warns if more races count than the
              series has. With fewer races sailed than the number, every race counts.
            </p>
            <p>
              The discards are worked out <strong className="text-foreground">per fleet</strong>,
              from the races that fleet sailed: a two-handed fleet that started 13 of 18 races
              discards 8, not 13. Like a proportional rule it replaces the step rules, which are
              kept. A Sailwave file whose discard profile is <code>s-5</code> imports with this rule
              set.
            </p>
          </>
        )}
      </Section>
      {has('race-scoring-options') && (
        <Section id="race-scoring-options" title="Per-race scoring options">
          <HelpShot
            src="/help/shots/race-scoring-options.webp"
            alt="Weighting and discard behaviour for a single race."
            caption="Weighting and discard behaviour for a single race."
          />
          <p>
            A Notice of Race often says how much a <em>particular</em> race counts — the
            centrepiece race that cannot be discarded, the trophy race worth double, the practice
            race that should drop out once real racing starts. Open a race and click{' '}
            <strong className="text-foreground">Scoring</strong> in its header (or{' '}
            <strong className="text-foreground">Scoring options…</strong> from its row on the{' '}
            <strong className="text-foreground">Races</strong> tab, or press{' '}
            <kbd className="px-1 border rounded text-xs">o</kbd>) to set them.
          </p>
          <p>
            <strong className="text-foreground">Discarding</strong> is one of three behaviours:
          </p>
          <ul className="list-disc list-inside space-y-1 pl-2">
            <li>
              <strong className="text-foreground">Normal</strong> — discarded if it is a
              competitor’s worst. This is every race unless you say otherwise.
            </li>
            <li>
              <strong className="text-foreground">Must count</strong> — never discarded, even when
              it is the worst. A competitor’s worst result then cannot be this race.
            </li>
            <li>
              <strong className="text-foreground">Discard first</strong> — taken before any other
              race when discards are selected, whatever it scored. This is how a practice race is
              included in the series and then drops out: mark it discard first and add one to the
              series discard allowance on the Settings tab. It reorders the selection rather than
              guaranteeing removal, so if the allowance doesn’t reach it, it still counts.
            </li>
          </ul>
          <p>
            <strong className="text-foreground">Weighting</strong> multiplies every score in the
            race. At ×2 a win scores 2, a second 4, and so on; values below 1 and non-whole values
            (0.5, 1.7) work too. Two consequences worth knowing: the multiplier applies to the
            whole score, so a DNC in a double race costs double; and a weighted race is still one
            race as far as the discard allowance is concerned — ×2 does not mean two races sailed.
          </p>
          <p>
            The two settings are independent. Weighting a race up does <em>not</em> make it
            non-discardable — a Notice of Race that wants both says both, so set both. What the
            weighting does change is which race is a competitor’s worst: discard selection and the
            RRS A8.1 tie-break compare the score that actually counts, after weighting.
          </p>
          <p>
            In the standings, a race column carrying options is marked in its header — the
            weighting numerically (“R4 ×2”) and an asterisk where discarding differs — with a line
            beneath the table saying what each one does. The cells show the weighted score, so the
            row still adds up to the total; a race’s own results table keeps its face-value points
            and states the multiplier separately. Published pages carry the same marks.
          </p>
        </Section>
      )}
      <Section id="a53-scoring" title="A5.3 starting-area scoring">
        <HelpShot
          src="/help/shots/a53-scoring.webp"
          alt="The A5.3 options on the Scoring card."
          caption="The A5.3 options on the Scoring card."
        />
        <p>
          Under the default RRS A5.2 rule, every penalty code (DNF, OCS, DNC, etc.) scores{' '}
          <em>N + 1</em> where N is the total number of competitors entered in the series.
          This is the same in every race, regardless of how many boats actually showed up.
        </p>
        <p>
          RRS A5.3 is an alternative used by many clubs with variable race-day attendance.
          Under A5.3, DNF and OCS score{' '}
          <em>starting-area entries + 1</em> — that is, the number of boats that came to
          the start in <em>that race</em>, plus one. DNC (did not compete) still scores
          series entries + 1, because those boats were not present at all.
        </p>
        <p>
          To enable A5.3 for a series, open the{' '}
          <strong className="text-foreground">Settings</strong> tab, tick{' '}
          <strong className="text-foreground">
            Score DNF/OCS on starting-area entries (RRS A5.3)
          </strong>
          , and click <strong className="text-foreground">Save</strong>.
        </p>
        <p>
          Use the <strong className="text-foreground">Start check-in</strong> tab on each
          race entry screen to record which boats came to the start. Boats that finished
          or have any code but DNC count as having come to the start too, unless they are
          unticked there — so if check-in is not done, the finish records alone decide it.
        </p>
      </Section>
      {has('high-point-scoring') && (
        <Section id="high-point-scoring" title="High-point scoring">
          <HelpShot
            src="/help/shots/high-point-scoring.webp"
            alt="The Scoring card set to high point, boats beaten with a point for coming to the start, and what a race scores at 2, 5, 10 and 20 boats."
            caption="High point on the Scoring card: the formula, and what a race scores."
          />
          <p>
            RRS Appendix A scores <strong className="text-foreground">low point</strong>: 1st
            scores 1 and the lowest total wins. Some clubs score a long series{' '}
            <strong className="text-foreground">high point</strong> instead: a boat scores for the
            boats she beats, a race she misses scores 0, and the highest total wins. On the{' '}
            <strong className="text-foreground">Settings</strong> tab, open the{' '}
            <strong className="text-foreground">Scoring</strong> card and choose{' '}
            <strong className="text-foreground">High point</strong> under Points, then a formula:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong className="text-foreground">Boats beaten</strong> — 1 point for finishing and
              1 for each boat beaten, so the winner of a 12-boat race scores 12. Tick{' '}
              <strong className="text-foreground">And 1 point for coming to the start</strong> for
              HalSail’s “HP scoring”, under which every boat that came to the start scores a point
              more. Sailwave’s custom formula <code>r-p+1</code> is boats beaten without it.
            </li>
            <li>
              <strong className="text-foreground">CHIPS3</strong> — Chipstead SC’s formula, which
              ISORA scores with: a win scores 86 to 100 whatever the fleet size, and the rest of the
              fleet spreads down towards 5, so one big turnout can’t decide a season.
            </li>
          </ul>
          <p>
            The card shows what a race scores at 2, 5, 10 and 20 boats, to check against your
            sailing instructions. Changing the system or the formula on a series with races asks
            first, since every race is rescored.
          </p>
          <h3 className="text-base font-medium text-foreground pt-2">The fleet size</h3>
          <p>
            Points are worked out per fleet, from <em>n</em>: the boats in that fleet’s race whose
            result counts toward the fleet size. A finisher beats every boat in <em>n</em> placed
            behind her, a DNF included. Finishers count, and so does each code marked to count. A
            boat that didn’t come (DNC) doesn’t, and neither does a boat given redress, whom no boat
            beat. Under CHIPS3 a boat that didn’t start (DNS) doesn’t count either, as Chipstead’s
            definition has it. Tied boats share the average of their places’ points.
          </p>
          <h3 className="text-base font-medium text-foreground pt-2">Codes</h3>
          <p>
            In high point a code scores points instead of a place. Under boats beaten DNC scores 0
            and every other code the place after the last boat: 0, or 1 with the point for coming
            to the start. Under CHIPS3 a retirement scores the place after the last, and DNC, DNS
            and a disqualification (OCS included) score 0. The A5.2/A5.3 choice is a low-point rule
            and is hidden.
          </p>
          <p>
            Change them in <strong className="text-foreground">Change scoring codes…</strong>,
            which in high point offers a fixed number of points, the place after the last boat, or
            the same as another code, and a <strong className="text-foreground">Counts toward the
            fleet size</strong> box for each code. ISORA’s 2026 season, for example, scores DNF a
            fixed 15 and has a code of its own, DTP, a fixed 8 that counts, for a boat that declared
            she would race and didn’t. When a series has such a code, a race’s page offers{' '}
            <strong className="text-foreground">Mark declared boats…</strong> to give it to the boats
            that declared. A split-fleet championship can’t be scored high point.
          </p>
          <h3 className="text-base font-medium text-foreground pt-2">Penalties</h3>
          <p>
            A penalty on a boat that finished — ZFP, SCP, DPI or a code of the series’ own — takes
            points away where low point adds them. Other boats keep their scores, and the boat is
            never left with fewer points than DNF scores (RRS 44.3(c)). Stated points come straight
            off. A percentage, such as the 20% of ZFP and SCP, is taken in places: in low point it
            is a share of the DNF score, which is a place, the one after the last. So with 20 boats
            a 20% penalty is 4.2 places — 4.2 points under boats beaten, and under CHIPS3 what 4.2
            places are worth in a fleet of 20, about 19 points. The race’s weighting is applied
            after the penalty.
          </p>
          <h3 className="text-base font-medium text-foreground pt-2">Weighting, discards and ties</h3>
          <p>
            A race weighted on its scoring options multiplies its points, and each race’s score is
            rounded once to a tenth, after the weighting. Discards drop each boat’s{' '}
            <em>lowest</em> scores, the earliest race first among equals. A tie is broken by listing
            each boat’s counted scores from best — the highest — to worst and taking the first
            difference (RRS A8.1), then by the last race, the one before, and so on (A8.2).
          </p>
          <p>
            A race’s page says what its points were scored from —{' '}
            <em>High point · 11 boats in the race · weight 1.2</em> — and so does each race table
            on a published page, where the points are the weighted scores. A note under the results
            says how points were scored and that the highest total wins. A race nobody finished
            still counts once a boat in it has a result that counts toward the fleet size.
          </p>
        </Section>
      )}
      {has('custom-scoring-codes') && (
        <Section id="custom-scoring-codes" title="Scoring codes your instructions change or add">
          <HelpShot
            src="/help/shots/custom-scoring-codes.webp"
            alt="The Scoring codes dialog: the codes a series can change, each marked RRS, Changed or Series."
            caption="The Scoring codes dialog: the codes a series can change, each marked RRS, Changed or Series."
          />
          <p>
            Every series scores the RRS Appendix A codes as the rules set out, under A5.2 or A5.3.
            Some sailing instructions say otherwise: they define a code the RRS doesn’t have — TLE
            for a boat that finishes outside the finishing window, a penalty for not signing out —
            or score a standard code differently, such as DNF on the number of finishers. Change the
            series’ codes only when your notice of race or sailing instructions do.
          </p>
          <p>
            On the <strong className="text-foreground">Settings</strong> tab, open the{' '}
            <strong className="text-foreground">Scoring</strong> card and choose{' '}
            <strong className="text-foreground">Change scoring codes…</strong> under the A5 choice.
            The dialog lists the codes a series can change — DNF, DNS, OCS, NSC, RET, DSQ, DNE, UFD,
            BFD, DNC and ZFP’s percentage — and the series’ own. Each is marked{' '}
            <strong className="text-foreground">RRS</strong>,{' '}
            <strong className="text-foreground">Changed</strong> (with the rule it replaced) or{' '}
            <strong className="text-foreground">Series</strong>. SCP, DPI and RDG aren’t listed:
            their amounts are decided for each boat, in the penalty and redress dialogs.
          </p>
          <p>
            A code either <strong className="text-foreground">replaces the boat’s result</strong> —
            the place after the series entries, the boats that came to the starting area or the
            finishers, plus a number; the same as another code; or a fixed number of points, never
            more than a DNF if you tick it — or{' '}
            <strong className="text-foreground">adds points to her finishing place</strong>, a
            stated number or a percentage of DNF, never more than a DNF, with every other boat’s
            score left alone. DNS, OCS and the other disqualifications score as DNF, as the RRS
            writes it, so changing DNF changes them too. The editor restates each rule as a
            sentence: check it against your instructions.
          </p>
          <p>
            The series’ own codes then appear on the finish sheet under{' '}
            <strong className="text-foreground">This series</strong>, in the penalty dialog, and in
            imported finish sheets and recorders’ submissions. Each published results page lists
            the codes it uses that differ from the RRS, with their rules, so readers can check them;
            a split-fleet championship lists them on its Scoring notes page. A code that results use
            can’t be deleted until they are given another. DBSC’s A5.3 variant, where a DNC is scored
            from the boats that came to the start, is DNC changed to score the same as DNF.
          </p>
        </Section>
      )}
    </>
  );
}
