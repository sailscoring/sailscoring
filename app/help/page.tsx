import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Help — Sail Scoring',
};

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="space-y-3">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="space-y-2 text-muted-foreground leading-relaxed">{children}</div>
    </section>
  );
}

export default function HelpPage() {
  return (
    <div className="max-w-2xl space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">Help</h1>
        <p className="mt-2 text-muted-foreground">
          A quick guide to scoring a series with Sail Scoring.
        </p>
      </div>

      <nav className="text-sm space-y-1">
        <p className="font-medium text-foreground">On this page</p>
        {[
          ['#what-is-sail-scoring', 'What is Sail Scoring?'],
          ['#creating-a-series', 'Creating a series'],
          ['#adding-competitors', 'Adding competitors'],
          ['#importing-competitors', 'Importing competitors from CSV'],
          ['#adding-races', 'Adding races'],
          ['#entering-results', 'Entering results'],
          ['#reading-the-standings', 'Reading the standings'],
          ['#discard-rules', 'Discard rules'],
          ['#saving-and-sharing', 'Saving and sharing a series'],
          ['#keyboard-shortcuts', 'Keyboard shortcuts'],
        ].map(([href, label]) => (
          <div key={href}>
            <Link href={href} className="text-muted-foreground hover:text-foreground hover:underline">
              {label}
            </Link>
          </div>
        ))}
      </nav>

      <Section id="what-is-sail-scoring" title="What is Sail Scoring?">
        <p>
          Sail Scoring is a web-based alternative to tools like Sailwave and HalSail — built for
          scorers who know the job but want software that works in a browser, on any device, without
          a Windows laptop and a steep learning curve.
        </p>
        <p>
          This is an early preview, released to gather feedback from scorers before a wider launch.
          A later version will be fully web-hosted with data stored centrally. For now, data is
          stored locally in your browser and nothing is sent to a server.
        </p>
        <p>
          The current version supports position-based (scratch) scoring for a single fleet across
          multiple races. Time-based and handicap scoring are on the roadmap.
        </p>
      </Section>

      <Section id="creating-a-series" title="Creating a series">
        <p>
          A <strong className="text-foreground">series</strong> is the top-level container for a
          set of races and the competitors sailing in them. It corresponds to a trophy, a league, or
          a championship — whatever collection of races you are scoring together.
        </p>
        <p>
          From the home screen, click <strong className="text-foreground">New series</strong> and
          give it a name. Venue and date are optional but useful for keeping things organised if you
          manage several series on the same device.
        </p>
        <p>
          After saving, you land on the Competitors tab, ready for the next step.
        </p>
      </Section>

      <Section id="adding-competitors" title="Adding competitors">
        <p>
          On the <strong className="text-foreground">Competitors</strong> tab, add every boat that
          may start a race in the series — even those you expect to DNS every race. This ensures
          result codes are available for them.
        </p>
        <p>
          Each competitor requires a <strong className="text-foreground">sail number</strong> and a
          name. Sail numbers must be unique within the series. Club, gender, and age group are
          optional.
        </p>
        <p>
          Competitors are sorted by sail number. You can edit or delete a competitor at any time,
          though deleting one after races have been entered will also remove their finishes.
        </p>
      </Section>

      <Section id="importing-competitors" title="Importing competitors from CSV">
        <p>
          If your entry list is already in a spreadsheet, you can import it directly rather than
          typing each competitor by hand. On the{' '}
          <strong className="text-foreground">Competitors</strong> tab, click{' '}
          <strong className="text-foreground">Import CSV</strong> (or press{' '}
          <strong className="text-foreground">i</strong>) and select a CSV file.
        </p>
        <p>
          The importer shows each column in the file alongside a sample of its values. Use the
          dropdown next to each column to map it to a competitor field — sail number, helm name,
          club, gender, or age. Columns you do not need can be left as{' '}
          <strong className="text-foreground">(ignore)</strong>. Sail number is the only required
          mapping; all other fields are optional.
        </p>
        <p>
          Clicking <strong className="text-foreground">Import</strong> adds any new competitors and
          updates existing ones matched by sail number. When an existing competitor's fields are
          unchanged by the import, they are counted as{' '}
          <strong className="text-foreground">unchanged</strong> rather than updated. Any rows
          missing a sail number are skipped and listed in the summary.
        </p>
      </Section>

      <Section id="adding-races" title="Adding races">
        <p>
          On the <strong className="text-foreground">Races</strong> tab, create a race for each
          race sailed. A race number is assigned automatically; a date is optional. You can create
          all races upfront or add them one at a time as the series progresses.
        </p>
        <p>
          Each race card shows how many finishes have been recorded. Click a race card to open the
          result entry screen for that race.
        </p>
      </Section>

      <Section id="entering-results" title="Entering results">
        <p>
          The result entry screen is where you record who finished where. Search for a competitor
          by sail number using the input at the top, then select them to add them to the finishing
          order. Repeat for each finisher in order.
        </p>
        <p>
          You can drag finishers to reorder them, or edit the position number directly if you prefer.
        </p>
        <p>
          For competitors who did not finish normally, use the result code dropdown next to their
          name:
        </p>
        <ul className="list-disc list-inside space-y-1 pl-2">
          <li><strong className="text-foreground">DNS</strong> — Did Not Start</li>
          <li><strong className="text-foreground">DNF</strong> — Did Not Finish</li>
          <li><strong className="text-foreground">OCS</strong> — On Course Side at start (premature starter)</li>
          <li><strong className="text-foreground">DNC</strong> — Did Not Compete (did not come to the start area)</li>
        </ul>
        <p>
          Competitors with result codes other than DNC are scored as{' '}
          <em>entries in the series + 1</em> points for that race. DNC scores
          the same. A competitor with no entry at all for a race is treated as DNC.
        </p>
      </Section>

      <Section id="reading-the-standings" title="Reading the standings">
        <p>
          The <strong className="text-foreground">Standings</strong> tab shows the series results
          at any point. Each row is a competitor; the columns show their points for each race and
          their series totals.
        </p>
        <p>
          Sail Scoring uses{' '}
          <strong className="text-foreground">Low Point scoring</strong>: 1st place scores 1 point,
          2nd scores 2, and so on. Lower totals are better. The standings are ordered by total
          points, with tie-breaking by most first places, then most second places, and so on.
        </p>
        <p>
          Result codes are shown in parentheses in the race columns, e.g. <em>7 (DNF)</em>.
        </p>
        <p>
          When discard rules are configured, a{' '}
          <strong className="text-foreground">Nett</strong> column appears showing each
          competitor&apos;s series total after their worst score(s) are dropped. Discarded scores
          are shown struck through. The standings are ordered by nett total.
        </p>
        <p>
          To share results with your club, click{' '}
          <strong className="text-foreground">Export HTML</strong> (or press{' '}
          <strong className="text-foreground">x</strong>) to download a self-contained results
          page you can email or host on your club website. Discards are shown in the exported file
          too.
        </p>
      </Section>

      <Section id="discard-rules" title="Discard rules">
        <p>
          A <strong className="text-foreground">discard</strong> lets a competitor drop their worst
          race score from the series total — a bad day doesn&apos;t ruin a whole season. Only the
          resulting <em>nett</em> score counts for ranking; the full series total is still displayed
          for reference.
        </p>
        <p>
          Discards are configured per series on the{' '}
          <strong className="text-foreground">Settings</strong> tab, in the{' '}
          <strong className="text-foreground">Scoring</strong> card. Each rule specifies a minimum
          number of races sailed and how many discards apply from that point on. For example:
        </p>
        <ul className="list-disc list-inside space-y-1 pl-2">
          <li>
            <em>From (races): 5, Total discards: 1</em> — one discard applies once 5 or more races
            have been sailed; no discards before that.
          </li>
          <li>
            You can add a second rule, e.g. <em>From: 9, Total discards: 2</em>, to increase the
            total number of discards as the series grows. Each rule sets the <em>total</em>, so a
            second rule of 2 means two discards (not one on top of one).
          </li>
        </ul>
        <p>
          To add a rule, click <strong className="text-foreground">Add rule</strong>, fill in the
          thresholds, then click <strong className="text-foreground">Save</strong>. To remove a
          rule, click the × button on that row. A series with no rules has no discards.
        </p>
        <p>
          The worst race(s) are dropped per competitor — each competitor discards their own worst
          score. When two races have the same score, the earlier race is discarded.
        </p>
      </Section>

      <Section id="saving-and-sharing" title="Saving and sharing a series">
        <p>
          All changes are saved automatically to your browser's local storage — you do not need
          to manually save while scoring. Your data persists across sessions on the same device
          and browser.
        </p>
        <p>
          To back up a series or share it with a co-scorer, open the{' '}
          <strong className="text-foreground">Settings</strong> tab and click{' '}
          <strong className="text-foreground">Save to File</strong>. This downloads a{' '}
          <code className="text-foreground text-sm">.sailscoring</code> file containing the
          complete series — all competitors, races, and results. You can save the file to Google
          Drive, Dropbox, or email it to a co-scorer.
        </p>
        <p>
          To open a series from a file, click{' '}
          <strong className="text-foreground">Open Series</strong> on the home screen and select
          the <code className="text-foreground text-sm">.sailscoring</code> file. If the series
          is already on your device, you will be asked whether to update your local copy or open
          a second copy.
        </p>
        <p>
          If a co-scorer has saved a newer version of the file, open the{' '}
          <strong className="text-foreground">Settings</strong> tab and click{' '}
          <strong className="text-foreground">Update from File</strong> to pull in their changes.
          The app checks whether the incoming file is a clean continuation of your local copy and
          warns you if both copies have diverged.
        </p>
      </Section>

      <Section id="keyboard-shortcuts" title="Keyboard shortcuts">
        <p>
          Press <strong className="text-foreground">?</strong> anywhere in the app (outside a text
          input) to open the keyboard shortcuts reference.
        </p>
      </Section>
    </div>
  );
}
