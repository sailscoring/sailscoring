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
          ['#fleets', 'Fleets'],
          ['#importing-competitors', 'Importing competitors from CSV'],
          ['#adding-races', 'Adding races'],
          ['#entering-results', 'Entering results'],
          ['#start-check-in', 'Start check-in'],
          ['#reading-the-standings', 'Reading the standings'],
          ['#discard-rules', 'Discard rules'],
          ['#a53-scoring', 'A5.3 starting-area scoring'],
          ['#saving-and-sharing', 'Saving and sharing a series'],
          ['#publishing-results', 'Publishing results'],
          ['#json-export', 'JSON data export and Open in Sail Scoring'],
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
          The current version supports position-based (scratch) scoring for one or more fleets
          across multiple races. Time-based and handicap scoring are on the roadmap.
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

      <Section id="fleets" title="Fleets">
        <p>
          A <strong className="text-foreground">fleet</strong> is a group of competitors
          scored independently. Each fleet produces its own standings — the penalty point
          base <em>N</em> is the number of competitors in that fleet, not the series total.
          A DNC in a fleet of 5 scores 6 points; a DNC in a fleet of 3 scores 4 points.
        </p>
        <p>
          Fleets are created automatically from your competitors. On the{' '}
          <strong className="text-foreground">Competitors</strong> tab, type a fleet name
          (e.g. <em>Junior</em> or <em>Senior</em>) in the{' '}
          <strong className="text-foreground">Fleet</strong> field when adding or editing a
          competitor. Leaving the field blank assigns the competitor to the{' '}
          <strong className="text-foreground">Default</strong> fleet. A fleet exists as long
          as at least one competitor belongs to it — removing the last competitor from a
          fleet removes the fleet.
        </p>
        <p>
          When only one fleet exists, the fleet concept is invisible: no fleet column appears
          in the competitors table, no fleet headings appear in the standings, and the HTML
          export produces a single file exactly as before.
        </p>
        <p>
          For multi-fleet events,{' '}
          <strong className="text-foreground">Export HTML</strong> produces one file per
          fleet (e.g. <code className="text-foreground text-sm">my-series-junior.htm</code>,{' '}
          <code className="text-foreground text-sm">my-series-senior.htm</code>). Each file
          contains that fleet&apos;s standings and individual race results.
        </p>
        <p>
          To rename fleets or change their display order, open the{' '}
          <strong className="text-foreground">Settings</strong> tab and click{' '}
          <strong className="text-foreground">Edit ▸</strong> on the{' '}
          <strong className="text-foreground">Fleets</strong> card. You can reorder fleets
          with the ↑/↓ buttons (which determines the order they appear in standings and
          exports), and rename any fleet with the{' '}
          <strong className="text-foreground">Rename</strong> button.
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
          club, gender, age, or fleet. Columns you do not need can be left as{' '}
          <strong className="text-foreground">(ignore)</strong>. Sail number is the only required
          mapping; all other fields are optional. Fleet columns named{' '}
          <em>Fleet</em>, <em>Class</em>, or <em>Division</em> are detected automatically.
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
          By default (RRS A5.2), all penalty codes score{' '}
          <em>series entries + 1</em> points. If you enable{' '}
          <strong className="text-foreground">A5.3 starting-area scoring</strong> in
          Settings, DNF and OCS instead score{' '}
          <em>starting-area entries + 1</em> for that race — a smaller penalty when
          turnout is low. DNC always scores series entries + 1 regardless.
        </p>
      </Section>

      <Section id="start-check-in" title="Start check-in">
        <p>
          The{' '}
          <strong className="text-foreground">Start check-in</strong> tab on the race
          entry screen lets you record which competitors came to the starting area before
          the race. This is the data source for A5.3 scoring — if you skip check-in, the
          app infers starting-area attendance from the finish records instead.
        </p>
        <p>
          Open a race, switch to the{' '}
          <strong className="text-foreground">Start check-in</strong> tab (or press{' '}
          <strong className="text-foreground">c</strong>), then tap each boat that appears
          at the start. A running count shows how many are marked present.
        </p>
        <p>
          Check-in saves immediately — you do not need to click Save. Once boats start
          finishing, switch back to{' '}
          <strong className="text-foreground">Finish entry</strong> (press{' '}
          <strong className="text-foreground">c</strong> again) and enter the finishing
          order as normal. Boats that were checked in but have no finish recorded will
          appear in the non-finisher list as DNF rather than DNC.
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
          To share results, click{' '}
          <strong className="text-foreground">Export HTML</strong> (or press{' '}
          <strong className="text-foreground">x</strong>) to download a self-contained results
          page you can email or host on your club website. To push results directly to a web server,
          see <a href="#publishing-results" className="underline">Publishing results via FTP</a>.
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

      <Section id="a53-scoring" title="A5.3 starting-area scoring">
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

      <Section id="publishing-results" title="Publishing results">
        <p>
          Sail Scoring offers two ways to push results to a public URL from the{' '}
          <strong className="text-foreground">Standings</strong> tab.
        </p>
        <p>
          <strong className="text-foreground">Publish (bilge):</strong> click{' '}
          <strong className="text-foreground">Publish</strong> (or press{' '}
          <strong className="text-foreground">p</strong>). On first use, choose a URL prefix
          (e.g. <code className="text-foreground text-sm">hyc-autumn-2026</code>) and enter your
          email address. A verification link is sent to confirm ownership of that namespace; once
          verified, all subsequent publishes go live immediately. The resulting URL is stable —
          re-publishing updates the page in place. The publish configuration (URL prefix and
          ownership token) is saved in the series file, so any scorer who opens the file can
          publish to the same URL. The email address is stored locally only and is never written
          to the series file.
        </p>
        <p>
          <strong className="text-foreground">Upload via FTP:</strong>{' '}
          if your club has a web hosting account, you can push results directly to it without
          downloading and uploading files manually. Sail Scoring relays FTP uploads through the
          scupper service — the browser cannot connect to an FTP server directly.
        </p>
        <p>
          <strong className="text-foreground">FTP one-time setup:</strong> open{' '}
          <strong className="text-foreground">Settings</strong> (link in the page header) and click{' '}
          <strong className="text-foreground">Add server</strong>. Enter a label (e.g.{' '}
          <em>Club website</em>), the FTP hostname, port (default 21), username, and password.
          Tick <strong className="text-foreground">FTPS (TLS)</strong> if your host requires an
          encrypted connection. You can configure multiple servers and switch between them at upload
          time. Credentials are stored on this device only and are never included in series file
          exports.
        </p>
        <p>
          <strong className="text-foreground">Uploading:</strong> on the{' '}
          <strong className="text-foreground">Standings</strong> tab, click{' '}
          <strong className="text-foreground">Upload via FTP</strong> (or press{' '}
          <strong className="text-foreground">f</strong>). Select the server, enter the remote
          path for the results file (e.g.{' '}
          <code className="text-foreground text-sm">/public_html/results/fleet-a.html</code>),
          and click <strong className="text-foreground">Upload</strong>. The path is entered
          each time, so you can vary it per race day or fleet without changing the server
          configuration.
        </p>
        <p>
          If the upload fails, the raw FTP error from the server is shown — this is usually
          enough to diagnose a wrong path, bad credentials, or a permission problem.
        </p>
      </Section>

      <Section id="json-export" title="JSON data export and Open in Sail Scoring">
        <p>
          Every exported HTML results page — whether downloaded with{' '}
          <strong className="text-foreground">Export HTML</strong> or pushed via FTP or
          Publish — includes an{' '}
          <strong className="text-foreground">Open in Sail Scoring</strong> link in the footer.
          Anyone viewing the results page can click it to open the series directly in the app
          — competitors, races, finishes, and standings are all imported automatically as a new
          series.
        </p>
        <p>
          The footer also embeds a JSON snapshot of the results in the page source, available
          to clubs or third parties who want to consume the data programmatically. The snapshot
          contains only the public results; scorer-private information (file history, FTP
          credentials, and publishing tokens) is never included.
        </p>
        <p>
          To disable the embedded export for a series, open the{' '}
          <strong className="text-foreground">Settings</strong> tab and uncheck{' '}
          <strong className="text-foreground">Include data export in published results</strong>{' '}
          in the <strong className="text-foreground">Publishing</strong> card. The footer will
          revert to a plain link with no Open in Sail Scoring option.
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
