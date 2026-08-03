import type { Metadata } from 'next';

import { getEffectiveFeatures } from '@/lib/auth/require-workspace';
import type { FeatureKey } from '@/lib/features';

import { HelpShell, HelpShot, Section } from '../shell';

export const metadata: Metadata = {
  title: 'Scoring correctness — Help — Sail Scoring',
};

// Per-user dynamic (#155): gated sections only render for viewers whose
// workspace has the feature enabled.
export const dynamic = 'force-dynamic';

export default async function Page() {
  const features = await getEffectiveFeatures();
  const has = (key: FeatureKey) => features.includes(key);
  return (
    <HelpShell slug="scoring-correctness" features={features}>
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
          race entry screen to record which boats came to the start. If check-in is not
          done, the app counts all non-DNC finish records as a proxy for starting-area
          attendance.
        </p>
      </Section>
    </HelpShell>
  );
}
