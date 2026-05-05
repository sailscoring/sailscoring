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
    <div className="max-w-2xl mx-auto space-y-10">
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
          ['#signing-in', 'Signing in and workspaces'],
          ['#creating-a-series', 'Creating a series'],
          ['#adding-competitors', 'Adding competitors'],
          ['#fleets', 'Fleets'],
          ['#start-sequences', 'Start sequences'],
          ['#importing-competitors', 'Importing competitors from CSV'],
          ['#adding-races', 'Adding races'],
          ['#entering-results', 'Entering results'],
          ['#importing-finish-sheet', 'Importing a finish sheet from CSV'],
          ['#penalty-codes', 'Additive penalty codes'],
          ['#redress', 'Redress (RDG)'],
          ['#start-check-in', 'Start check-in'],
          ['#reading-the-standings', 'Reading the standings'],
          ['#rating-systems', 'Rating systems'],
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
          You sign in with your email; series, competitors, races, and results are saved to your
          account as you work. Scoring panels at clubs share a single workspace so the whole
          team sees the same series in real time.
        </p>
        <p>
          Sail Scoring supports position-based (scratch) scoring, static handicap
          scoring (IRC, PY), and progressive handicap scoring (NHC1, ECHO) for one or
          more fleets across multiple races.
        </p>
      </Section>

      <Section id="signing-in" title="Signing in and workspaces">
        <p>
          Sail Scoring uses passwordless email sign-in. From the home screen, click{' '}
          <strong className="text-foreground">Sign in</strong>, enter your email, and click the
          link the app sends you. The link expires after five minutes; request a fresh one any
          time.
        </p>
        <p>
          When you first sign in you land in your{' '}
          <strong className="text-foreground">personal workspace</strong> — labelled{' '}
          <em>My Workspace</em> in the workspace switcher to the right of the page logo. Anything
          you create here is private to your account and only visible to you.
        </p>
        <p>
          Club scoring panels share an{' '}
          <strong className="text-foreground">org workspace</strong>: every panel member can see
          and edit the same series, FTP credentials, and workspace settings. Org workspaces are
          set up by the project owner — email{' '}
          <a href="mailto:hello@sailscoring.ie" className="underline">hello@sailscoring.ie</a>{' '}
          with the panel members&apos; emails and a workspace name. Once you&apos;re added, the
          workspace switcher in the header shows both your personal workspace and the shared one;
          pick the shared one and the rest of the app reorients onto the panel&apos;s data.
        </p>
        <p>
          To move a series from your personal workspace into a shared one, open its{' '}
          <strong className="text-foreground">Settings</strong> tab and use the{' '}
          <strong className="text-foreground">Copy to another workspace</strong> card at the top.
          The original stays in your personal workspace; the copy lands in the target workspace
          with a fresh history. FTP credentials and bilge publishing state are not carried over.
        </p>
        <p>
          Concurrent edits between scorers in a shared workspace are detected per row. If two
          scorers edit the same finish at the same moment, the second writer sees a clean
          conflict dialog naming the first scorer rather than silently overwriting their work.
        </p>
        <p>
          Account info (your email, the active workspace, sign-out) is in the user menu on the
          right of the page header — click your email address. Workspace-scoped settings (FTP
          servers, the workspace name) are in the workspace switcher next to the{' '}
          <strong className="text-foreground">Sail Scoring</strong> logo — click the workspace
          name and choose <strong className="text-foreground">Workspace settings</strong>.
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
          manage several series on the same device. Names must be unique; the app prevents you from
          creating two series with the same name. You can rename a series later from the{' '}
          <strong className="text-foreground">Basic</strong> card on its{' '}
          <strong className="text-foreground">Settings</strong> tab.
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
          <strong className="text-foreground"> helm name</strong>. Sail numbers must be unique within
          the series. Other fields — boat name, class, crew name, club, gender, age — are optional,
          and which of them appear in the form and tables is controlled by the{' '}
          <strong className="text-foreground">Competitor fields</strong> card on the{' '}
          <strong className="text-foreground">Settings</strong> tab. Enable{' '}
          <em>Class</em> for PY fleets with mixed classes (Laser, Firefly, Mirror) to show the boat
          class alongside each entry. Enable{' '}
          <em>Crew name</em> for two-person dinghy classes (420, Fireball, GP14); the helm and crew
          are then shown as <em>Helm / Crew</em> in exported results.
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
          fleet (e.g. <code className="text-foreground text-sm">my-series-junior.html</code>,{' '}
          <code className="text-foreground text-sm">my-series-senior.html</code>). Each file
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

      <Section id="start-sequences" title="Start sequences">
        <p>
          For handicap series with multiple fleets starting at staggered times, the{' '}
          <strong className="text-foreground">Default start sequence</strong> editor (in{' '}
          <strong className="text-foreground">Settings ▸ Fleets</strong>, visible only in
          handicap mode) lets you describe how fleets are grouped at the start line and how
          long the gap is between consecutive starts. Once configured, creating a new race
          asks only for the first start time and generates the rest automatically.
        </p>
        <p>
          Each row is one starting signal. Add a row with{' '}
          <strong className="text-foreground">+ Add start group</strong>, drop one or more
          fleets into it from the dropdown, and — for every row after the first — set the
          interval, in minutes, between this start and the previous one. So a row labelled{' '}
          <em>+5 min after Start 2</em> means this fleet starts five minutes after Start 2,
          regardless of where Start 2 itself sits.
        </p>
        <p>
          A typical Saturday-afternoon club setup with three classes at 5-minute intervals
          looks like this:
        </p>
        <ul className="ml-6 list-disc space-y-1">
          <li>Start 1: <em>Class A</em></li>
          <li>Start 2: <em>Class B</em>, +5 min after Start 1</li>
          <li>Start 3: <em>Class C</em>, +5 min after Start 2</li>
        </ul>
        <p>
          With a first start of 14:05, that resolves to 14:05 / 14:10 / 14:15. The new-race
          dialog shows the resolved times as a preview before you confirm.
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
          boat name, class, crew name, club, gender, age, or fleet. Columns you do not need can be
          left as <strong className="text-foreground">(ignore)</strong>. Sail number is the only
          required mapping; all other fields are optional. Fleet columns named{' '}
          <em>Fleet</em> or <em>Division</em> are detected automatically, as are columns named{' '}
          <em>Class</em> (mapped to boat class) and <em>Crew</em>.
        </p>
        <p>
          A competitor can be assigned to more than one fleet by separating fleet names with a
          pipe character in the fleet column — for example,{' '}
          <code className="text-foreground text-sm">PY|M15</code> enters a Melges 15 in both the
          PY handicap fleet and the M15 scratch fleet. This matches the convention used by
          Sailwave exports.
        </p>
        <p>
          In <strong className="text-foreground">handicap</strong> mode, the importer infers each
          fleet&apos;s scoring system from the rating columns it finds. If every boat in a CSV fleet
          carries one rating system (say IRC), one fleet is created and configured for IRC. If the
          fleet has a mix — IRC for some boats, ECHO for others — the importer splits it into{' '}
          <code className="text-foreground text-sm">CR 0 (IRC)</code> and{' '}
          <code className="text-foreground text-sm">CR 0 (ECHO)</code>; each boat joins the
          fleet(s) matching their populated ratings. The mapping dialog lists the planned fleets
          before you confirm, with a per-fleet checkbox to also score the group on{' '}
          <strong className="text-foreground">scratch</strong> alongside (for line-honours awards).
        </p>
        <p>
          When the CSV has no <em>Class</em> column and no existing competitor in the series has
          a class set, the importer falls back to writing the original fleet name into{' '}
          <strong className="text-foreground">Class</strong>. This preserves the practical
          &ldquo;Cruisers 2&rdquo; grouping when the fleet column is being used as a class label
          and boats end up split across rating fleets.
        </p>
        <p>
          Clicking <strong className="text-foreground">Import</strong> adds any new competitors and
          updates existing ones matched by sail number. When an existing competitor&apos;s fields are
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
          The result entry screen is a digital transcription of the handwritten finish sheet.
          Each row is a crossing of the finish line; row order is crossing order. Search for
          a competitor by sail number using the input at the top and they are added to the
          next slot in the list. For boats in a fleet with a recorded start, the app prompts
          for a finish time before adding the row.
        </p>
        <p>
          If a sail number is not yet registered in the series, the app will offer to{' '}
          <strong className="text-foreground">Record as unknown</strong>. The row is kept in
          crossing order; click <strong className="text-foreground">Resolve</strong> next to
          the entry to link it to a registered competitor once you know who it was. Unresolved
          unknown finishes are excluded from standings until resolved.
        </p>
        <p>
          Rows for fleets without a start time (scratch scoring) show{' '}
          <strong className="text-foreground">↑/↓</strong> controls that let you nudge a boat
          up or down in the list. Rows for timed fleets have no move controls — their position
          is determined automatically by the finish time. If you edit a time and it no longer
          matches the crossing order, the row slides to its correct slot.
        </p>
        <p>
          When two scratch-fleet boats cross together, tick{' '}
          <strong className="text-foreground">tie</strong> on the second row to mark them as
          tied with the previous row. Tied boats share averaged ranks per RRS A8.1.
        </p>
        <p>
          For competitors who did not finish normally, use the result code dropdown next to their
          name. Codes are grouped by how they arise:
        </p>
        <p className="font-medium text-sm mt-2">Operational codes (assigned during or after the race)</p>
        <ul className="list-disc list-inside space-y-1 pl-2">
          <li><strong className="text-foreground">DNS</strong> — Did Not Start (came to start area but did not start)</li>
          <li><strong className="text-foreground">DNF</strong> — Did Not Finish</li>
          <li><strong className="text-foreground">OCS</strong> — On Course Side at start (premature starter)</li>
          <li><strong className="text-foreground">NSC</strong> — Did Not Sail the Course (finished but missed a mark)</li>
          <li><strong className="text-foreground">RET</strong> — Retired after starting</li>
          <li><strong className="text-foreground">DNC</strong> — Did Not Compete (did not come to the start area)</li>
        </ul>
        <p className="font-medium text-sm mt-2">Protest committee codes (entered after a hearing or RC decision)</p>
        <ul className="list-disc list-inside space-y-1 pl-2">
          <li><strong className="text-foreground">DSQ</strong> — Disqualified</li>
          <li><strong className="text-foreground">DNE</strong> — Disqualification Not Excludable (cannot be discarded)</li>
          <li><strong className="text-foreground">UFD</strong> — U Flag Disqualification, rule 30.3 (discardable)</li>
          <li><strong className="text-foreground">BFD</strong> — Black Flag Disqualification, rule 30.4 (cannot be discarded)</li>
        </ul>
        <p>
          By default (RRS A5.2), all penalty codes score{' '}
          <em>series entries + 1</em> points. If you enable{' '}
          <strong className="text-foreground">A5.3 starting-area scoring</strong> in
          Settings, most codes instead score{' '}
          <em>starting-area entries + 1</em> for that race — a smaller penalty when
          turnout is low. DNC and BFD always score series entries + 1 regardless.
        </p>
        <p>
          <strong className="text-foreground">DNE and BFD cannot be discarded.</strong>{' '}
          In the standings table they are shown in red. Even if a DNE or BFD is a
          competitor&apos;s worst score, the discard falls on their next-worst result
          instead.
        </p>
        <p className="font-medium text-sm mt-2">Additive penalty codes (applied to finishers)</p>
        <p>
          A boat that finishes but is penalised by the protest committee may be assigned an
          additive penalty code using the <strong className="text-foreground">flag icon</strong>{' '}
          next to their name in the finisher list. Click the flag to open the penalty editor.
        </p>
        <ul className="list-disc list-inside space-y-1 pl-2">
          <li>
            <strong className="text-foreground">ZFP</strong> — Z Flag Penalty (rule 30.2):
            automatically applied (no hearing) to a boat in the triangle zone during the
            last minute before the start. Adds 20% of the DNF score, rounded to the
            nearest whole number (formula per rule 44.3(c)).
          </li>
          <li>
            <strong className="text-foreground">SCP</strong> — Scoring Penalty (PC-imposed):
            adds a specified percentage of the DNF score (default 20%; enter a different value
            to override).
          </li>
          <li>
            <strong className="text-foreground">DPI</strong> — Discretionary Points Increase:
            adds a stated number of points (enter the amount in the penalty editor).
          </li>
        </ul>
        <p>
          Per RRS A6.2, additive penalties do not change other competitors&apos; scores —
          two boats may legitimately share the same score. The penalised score is capped at
          the DNF score for that race. Penalty codes are shown in amber in the standings table,
          e.g. <em>4 (ZFP)</em>.
        </p>
      </Section>

      <Section id="importing-finish-sheet" title="Importing a finish sheet from CSV">
        <p>
          On a race&apos;s result entry screen, click{' '}
          <strong className="text-foreground">Import CSV</strong> (or press{' '}
          <strong className="text-foreground">i</strong>) to import a whole finish
          sheet in one go — useful when results are captured on a tablet or in a
          spreadsheet on the RC boat and you want to transcribe the lot at once.
        </p>
        <p>The importer reads three columns:</p>
        <ul className="list-disc list-inside space-y-1 pl-2">
          <li>
            <strong className="text-foreground">Sail number</strong> — required; matched
            against registered competitors. Unregistered sail numbers import as unresolved
            crossings that you can resolve later.
          </li>
          <li>
            <strong className="text-foreground">Finish time</strong> — optional; accepts{' '}
            <code className="text-foreground text-sm">HH:MM:SS</code>,{' '}
            <code className="text-foreground text-sm">H:MM:SS</code>, or bare digits like{' '}
            <code className="text-foreground text-sm">143210</code>.
          </li>
          <li>
            <strong className="text-foreground">Result code</strong> — optional; any standard
            RRS code (DNF, DSQ, OCS, RET, DNE, UFD, BFD, DNS, NSC, DNC). Rows with a code are
            recorded as non-finishers and the finish time is ignored.
          </li>
        </ul>
        <p>
          Row order in the CSV is the crossing order — the importer assigns finish positions
          in the order rows appear. A preview dialog shows how many finishers and coded
          entries will be imported and how many existing finishes will be replaced.
        </p>
        <p>
          The import is <strong className="text-foreground">replace-all</strong>: confirming
          replaces the race&apos;s finishing order entirely and clears any penalties, redress,
          and tied-finish markers — the importer only covers the basic sheet, so re-apply
          those in the editor after import if needed. Existing start check-ins are preserved.
          Click <strong className="text-foreground">Save results</strong> after importing to
          persist the change.
        </p>
      </Section>

      <Section id="redress" title="Redress (RDG)">
        <p>
          When the protest committee grants a competitor redress under RRS Rule 62,
          their score for a race is replaced by an average calculated from their
          other scores. Use the{' '}
          <strong className="text-foreground">scales icon</strong> next to a
          competitor in the race entry screen to assign redress.
        </p>
        <p>
          There are two entry paths depending on whether the competitor finished:
        </p>
        <ul className="list-disc list-inside space-y-1 pl-2">
          <li>
            <strong className="text-foreground">Finisher granted redress</strong> — the
            boat completed the course and recorded a position, but later received redress to
            improve their score. Click the scales icon in the finishing order list. The
            finish position is preserved in the record but replaced by the redress score
            for standings.
          </li>
          <li>
            <strong className="text-foreground">Non-finisher granted redress</strong> — the
            boat did not finish (e.g. retired, RET). Select{' '}
            <strong className="text-foreground">RDG (redress)</strong> from the code
            dropdown in the non-finisher list. A dialog will open to configure the
            redress details.
          </li>
        </ul>
        <p className="font-medium text-sm mt-2">Redress methods (RRS A9)</p>
        <ul className="list-disc list-inside space-y-1 pl-2">
          <li>
            <strong className="text-foreground">A9(a) — all races</strong>: average of
            the competitor&apos;s scores in all other races in the series.
          </li>
          <li>
            <strong className="text-foreground">A9(b) — races before</strong>: average
            of scores in races sailed before the race in which redress is granted.
          </li>
          <li>
            <strong className="text-foreground">A9(c) — stated points</strong>: the PC
            assigns a specific points value directly.
          </li>
        </ul>
        <p className="font-medium text-sm mt-2">Pool restriction</p>
        <p>
          For A9(a) and A9(b) you can optionally restrict which races contribute
          to the average:
        </p>
        <ul className="list-disc list-inside space-y-1 pl-2">
          <li>
            <strong className="text-foreground">Exclude specific races</strong> — remove
            named races from the default pool (e.g. exclude a race the competitor did not
            start).
          </li>
          <li>
            <strong className="text-foreground">Include specific races</strong> — use
            only the listed races. Check{' '}
            <strong className="text-foreground">Include all later races</strong> to also
            include every race after the highest-numbered race in the list.
          </li>
        </ul>
        <p>
          The average is rounded to the nearest tenth (0.05 rounds up, per RRS A9).
          Redress scores are shown in amber with a superscript{' '}
          <em>r</em> in the standings table.
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
          For fast keyboard entry, type a sail number into the search box and press{' '}
          <strong className="text-foreground">Enter</strong> or{' '}
          <strong className="text-foreground">Tab</strong> to toggle the first matching
          boat — the input clears so you can keep typing the next sail number.
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

      <Section id="rating-systems" title="Rating systems">
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
          <li>
            <strong className="text-foreground">PY (Portsmouth Yardstick)</strong> —
            static handicap for mixed dinghy fleets. Each class carries a published PY
            number; corrected time is elapsed time × 1000 / PY.
          </li>
          <li>
            <strong className="text-foreground">NHC</strong> — the RYA National Handicap
            for Cruisers. A <em>progressive</em> handicap: each boat starts from a
            published TCF and the rating is adjusted after every race based on how the
            boat performed against the fleet average.
          </li>
          <li>
            <strong className="text-foreground">ECHO</strong> — the Irish Sailing
            progressive handicap. Each boat starts from a published handicap H and
            the rating is adjusted after every race based on a Performance Index
            measuring the boat&rsquo;s performance relative to the fleet.
          </li>
        </ul>
        <p>
          For NHC and ECHO, every per-race table includes a{' '}
          <strong className="text-foreground">New TCF</strong> (or{' '}
          <strong className="text-foreground">New H</strong>) column showing the rating
          to apply in the next race — that&rsquo;s usually the most-asked-about output
          of progressive scoring, so it&rsquo;s always visible. Above the table, a{' '}
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
          All changes are saved automatically to your account as you score — there is no Save
          button. The series is reachable from any device you sign in on, and panel members in
          a shared org workspace see edits in close to real time.
        </p>
        <p>
          To back up a series or share it with someone outside your workspace, open the{' '}
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
          is already in your workspace, you will be asked whether to update the existing copy or
          open it as a separate one.
        </p>
        <p>
          To bring a series someone else is scoring into your workspace, open the{' '}
          <strong className="text-foreground">Settings</strong> tab on the existing series and
          click <strong className="text-foreground">Update from File</strong>. The app checks
          whether the incoming file is a clean continuation of the workspace copy and warns you
          if both copies have diverged.
        </p>
        <p>
          If you used Sail Scoring before sign-in was required and have series saved in this
          browser, the home page shows a banner offering to{' '}
          <strong className="text-foreground">Move to my account</strong>. The migration runs
          one series at a time and is safe to re-run — the banner only counts series that
          haven&apos;t already been moved.
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
          <strong className="text-foreground">FTP one-time setup:</strong> open the workspace
          switcher in the page header and choose{' '}
          <strong className="text-foreground">Workspace settings</strong>, then click{' '}
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
          series. If you already have a series with that name on this device, the import gets a{' '}
          <code className="text-foreground text-sm">(2)</code> suffix so the two are easy to
          tell apart.
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
