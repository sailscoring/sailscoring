import type { Metadata } from 'next';
import Link from 'next/link';

import { getEffectiveFeatures } from '@/lib/auth/require-workspace';
import type { FeatureKey } from '@/lib/features';

export const metadata: Metadata = {
  title: 'Help — Sail Scoring',
};

// Per-user dynamic (#155): the help docs only expose an experimental feature
// to viewers whose workspace has it enabled. Signed-out / no-feature viewers
// (getEffectiveFeatures returns []) see only the ungated content.
export const dynamic = 'force-dynamic';

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="space-y-3 bg-card border rounded-lg p-6">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="space-y-2 text-muted-foreground leading-relaxed">{children}</div>
    </section>
  );
}

export default async function HelpPage() {
  const features = await getEffectiveFeatures();
  const has = (key: FeatureKey) => features.includes(key);
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
        {(
          [
            ['#what-is-sail-scoring', 'What is Sail Scoring?'],
            ['#signing-in', 'Signing in and workspaces'],
            ['#creating-a-series', 'Creating a series'],
            ['#organising-series', 'Organising the series list: categories and archive'],
            ['#adding-competitors', 'Adding competitors'],
            ['#fleets', 'Fleets'],
            ['#start-sequences', 'Start sequences'],
            ['#race-fleets', 'Which fleets are in a race'],
            ['#importing-competitors', 'Importing competitors from a spreadsheet'],
            // Gated: only listed when rrs-import is enabled (#260).
            ['#rrs-org-push', 'Pushing the competitor list to rrs.org', 'rrs-import'],
            ['#updating-handicaps', 'Updating handicaps from another series'],
            // Gated: only listed when irc-rating is enabled (on by default, #168 follow-up).
            ['#update-handicaps-irc-rating', 'Updating IRC TCCs from the rating list', 'irc-rating'],
            // Gated: only listed when vprs is enabled (#175).
            ['#update-handicaps-vprs', 'Updating VPRS TCCs from a club list', 'vprs'],
            // Gated: only listed when echo is enabled (#168).
            ['#update-handicaps-irish-sailing', 'Updating ECHO from Irish Sailing', 'echo'],
            // Gated: only listed when rya-py is enabled (on by default).
            ['#update-handicaps-rya-py', 'Updating PY numbers from the RYA list', 'rya-py'],
            // Gated: only listed when follow-on-series is enabled.
            ['#creating-a-follow-on-series', 'Creating a follow-on series', 'follow-on-series'],
            ['#adding-races', 'Adding races'],
            // Gated: only listed when sub-series is enabled (#203).
            ['#sub-series', 'Sub-series', 'sub-series'],
            ['#entering-results', 'Entering results'],
            // Gated: only listed when csv-finish-import is enabled (#155).
            ['#importing-finish-sheet', 'Importing a finish sheet from a spreadsheet', 'csv-finish-import'],
            ['#penalty-codes', 'Additive penalty codes'],
            ['#redress', 'Redress (RDG)'],
            ['#start-check-in', 'Start check-in'],
            ['#reading-the-standings', 'Reading the standings'],
            // Gated: only listed when prizes is enabled (#240).
            ['#prizes', 'Prizes', 'prizes'],
            ['#rating-systems', 'Rating systems'],
            ['#discard-rules', 'Discard rules'],
            ['#a53-scoring', 'A5.3 starting-area scoring'],
            ['#saving-and-sharing', 'Saving and sharing a series'],
            ['#collaboration', 'Working with co-scorers'],
            ['#history', 'Version history'],
            // Gated: only listed when logo-library is enabled.
            ['#logo-library', 'The logo library', 'logo-library'],
            // Gated: only listed when competitor-identity is enabled.
            ['#competitor-identity', 'Competitors and timelines', 'competitor-identity'],
            // Gated: only listed when rankings is enabled (#209).
            ['#rankings', 'Cross-series rankings', 'rankings'],
            ['#publishing-results', 'Publishing results'],
            // Gated: only listed when combined-pages is enabled (#255).
            ['#combined-pages', 'Combined pages', 'combined-pages'],
            ['#json-export', 'JSON data export and Open in Sail Scoring'],
            ['#sending-feedback', 'Sending feedback'],
            ['#keyboard-shortcuts', 'Keyboard shortcuts'],
          ] as Array<[string, string] | [string, string, FeatureKey]>
        )
          .filter((entry) => entry.length < 3 || has(entry[2] as FeatureKey))
          .map(([href, label]) => (
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
          link the app sends you. The link expires after 30 minutes; request a fresh one any
          time.
        </p>
        <p>
          The first time you sign in we ask for your name. It’s optional — you can skip it —
          but it’s what co-scorers see on the activity log and member lists in a shared
          workspace, so it’s worth filling in. You can set or change it any time on your{' '}
          <strong className="text-foreground">Account</strong> page.
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
          and edit the same series, FTP credentials, and workspace settings. To get one, request a
          shared workspace from your <strong className="text-foreground">Account</strong> page —
          give it a name and we’ll set it up and make you its owner, ready to invite the rest
          of your panel (see{' '}
          <a href="#collaboration" className="underline">Working with co-scorers</a>).
          Once you belong to a shared workspace, the switcher in the header shows both your personal
          workspace and the shared one; pick the shared one and the rest of the app reorients onto
          the panel’s data.
        </p>
        <p>
          To move a series from your personal workspace into a shared one, open the{' '}
          <strong className="text-foreground">⋯</strong> menu in the series header and choose{' '}
          <strong className="text-foreground">Copy to workspace…</strong>.
          The original stays in your personal workspace; the copy lands in the target workspace
          with a fresh history. FTP credentials and publishing state are not carried over.
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
        <p>
          Workspace settings also has a <strong className="text-foreground">Features</strong>{' '}
          card (owners and admins only). Optional features are switched on and off there for
          everyone in the workspace — turn off anything your club doesn&apos;t use to keep the
          interface uncluttered. Switching a feature off only hides its controls; any data you
          already entered is kept, and you can switch it back on at any time.
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

      <Section id="organising-series" title="Organising the series list: categories and archive">
        <p>
          As a club builds up seasons of results, the home list grows. Two tools keep it
          tidy: <strong className="text-foreground">categories</strong> for grouping, and{' '}
          <strong className="text-foreground">archive</strong> for putting finished events away.
        </p>
        <p>
          <strong className="text-foreground">Categories</strong> are your own labels — e.g.{' '}
          <em>Club racing</em>, <em>Open events</em>. Create and reorder them from{' '}
          <strong className="text-foreground">Series categories</strong> in Workspace settings,
          then assign a series with{' '}
          <strong className="text-foreground">Move to category</strong> on its{' '}
          <strong className="text-foreground">⋯</strong> menu. Once you have categories, you can
          also pick one up front — in the new-series wizard, or when importing a{' '}
          <span className="font-mono">.sailscoring</span> or Sailwave file. A series with no
          category sits under <strong className="text-foreground">Uncategorized</strong>. Deleting
          a category simply moves its series back to Uncategorized — nothing is lost.
        </p>
        <p>
          Within a category (or the flat list, if you don’t use categories) you can put
          series in whatever order you like: drag the{' '}
          <strong className="text-foreground">grip handle</strong> on the left of each row, or
          reorder by keyboard (focus the handle, press Space, use the arrow keys, press Space to
          drop). New series are added to the bottom. Archived series are grouped by year and
          aren’t reordered manually.
        </p>
        <p>
          <strong className="text-foreground">Archiving</strong> a series (from its{' '}
          <strong className="text-foreground">⋯</strong> menu, on the home list or in the series
          header) moves it into a
          collapsed <strong className="text-foreground">Archived</strong> section at the foot of
          the list, grouped by year, and makes it{' '}
          <strong className="text-foreground">read-only</strong>: a safeguard against a stray edit
          to a finished record months later. To change an archived series, either{' '}
          <strong className="text-foreground">Unarchive</strong> it or copy it to another
          workspace. You can still publish or re-publish an archived series’ results.
        </p>
        <p>
          Deleting a series requires archiving it first — a deliberate two-step so a finished
          season can’t be thrown away by accident. Deleting is a{' '}
          <strong className="text-foreground">soft delete</strong>: the series moves to a collapsed{' '}
          <strong className="text-foreground">Trash</strong> section at the foot of the list, where
          it stays recoverable for <strong className="text-foreground">30 days</strong> before it
          is removed for good. <strong className="text-foreground">Recover</strong> brings it back
          (archived, exactly as it was, with its history); a trashed series can’t be opened
          until you recover it. To remove one immediately you can{' '}
          <strong className="text-foreground">delete it forever</strong> from the Trash — guarded by
          typing the series name to confirm. If the series had a published results page, that page
          stays online but disconnected; recovering won’t reconnect it, so unpublish first if
          you don’t want it to remain public.
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
          primary <strong className="text-foreground">name</strong> (labelled Helm, Owner,
          Competitor, or Entrant per the series&rsquo; primary-identifier setting). Sail numbers
          must be unique within the series. Other fields — boat name, class, owner, helm, crew,
          club, gender, age — are optional, and which of them appear in the form and tables is
          controlled by the <strong className="text-foreground">Competitor fields</strong> card on
          the <strong className="text-foreground">Settings</strong> tab. Enable{' '}
          <em>Class</em> for PY fleets with mixed classes (Laser, Firefly, Mirror) to show the boat
          class alongside each entry. Enable{' '}
          <em>Crew</em> for classes that sail with crew.
        </p>
        <p>
          Every person field takes any number of names: <em>Add name</em> (on the primary),{' '}
          <em>Add owner</em>, <em>Add helm</em>, or <em>Add crew</em> in the competitor dialog
          adds a row per person, so co-owned boats
          (&ldquo;J. &amp; M. Murphy&rdquo; syndicates), offshore co-helms, and full keelboat
          crews are all first-class. A single owner-and-crew pairing keeps the classic one-line{' '}
          <em>Helm / Crew</em> in exported results; any more people stack one name per line.
          One-line contexts such as finish entry join co-owners with an ampersand.
        </p>
        <p>
          <strong className="text-foreground">Gender</strong> and{' '}
          <strong className="text-foreground">age</strong> describe the primary person, and only
          when the primary is a single individual — add a second name and the dialog clears both
          (a syndicate entry has no single age). Nationality is different: national letters
          attach to the boat, so it stays whatever the entry declares.
        </p>
        <p>
          Enable <em>Bow number</em> when boats carry a bow number that can
          differ from the sail number they’re registered under — a competitor
          sailing a borrowed hull, say, whose bow number the finish recorders
          write down instead of the registered sail number. It’s an optional
          free-text field; when set, finish entry will also match on it (see{' '}
          <em>Entering results</em> below).
        </p>
        <p>
          Enable <em>Nationality</em> to record each entry’s 3-letter
          country code (RRS Appendix G / IOC, e.g. <em>IRL</em>, <em>GBR</em>,
          <em> FRA</em>). The input suggests codes as you type; common
          Sailwave spellings (<em>BVI</em>, <em>CKI</em>) resolve to their
          canonical form on blur. Exported HTML results show the code
          alongside a small country flag.
        </p>
        <p>
          Enable <em>Division</em> to record prize-giving subdivisions within a
          fleet — skill tiers like <em>Gold</em>/<em>Silver</em>/<em>Bronze</em>,
          or age categories such as <em>Apprentice Master</em>/<em>Grand Master</em>.
          A subdivision does not affect scoring: everyone in a fleet is still
          ranked together, and it only decides which sub-trophy an entry is
          eligible for. You can add more than one independent <em>axis</em> — a{' '}
          <em>Division</em> (Gold/Silver) and an <em>Age category</em>{' '}
          (Youth/Master), say — and rename each in the{' '}
          <strong className="text-foreground">Competitor fields</strong> card.
          Each axis shows as its own column in the competitors table, the
          standings, and exported results.
        </p>
        <p>
          Competitors are sorted by sail number. You can edit or delete a competitor at any time,
          though deleting one after races have been entered will also remove their finishes.
        </p>
        <p>
          To clean up several entries at once — say after a mis-import — use the{' '}
          <strong className="text-foreground">filter box</strong> above the table to narrow the
          list, then tick the competitors to remove (the header checkbox selects everything
          currently shown). The selection survives filter changes, so you can build it up across
          several filters before clicking{' '}
          <strong className="text-foreground">Delete selected</strong>. The confirmation warns you
          if any selected competitor has recorded race results, since those results are deleted
          with the entry.
        </p>
        <p>
          The same selection also drives{' '}
          <strong className="text-foreground">Set field…</strong>, which writes one value to
          every selected competitor — say, setting the Club of thirty entries to{' '}
          <em>HYC</em> in one go. The value box suggests the values already in use, so
          near-misses like <em>HYC</em> vs <em>Howth YC</em> are easy to spot and unify.
          Leaving the value empty clears the field instead. Only descriptive fields are
          offered (club, class, nationality, gender, and any division axes); handicap
          ratings have their own <strong className="text-foreground">Update handicaps</strong>{' '}
          dialog with rules for already-scored races. In a multi-fleet series the field
          list also offers <strong className="text-foreground">Fleet</strong>, which adds
          the selection to a fleet or removes it from one rather than writing a value.
          Boats a removal would leave with no fleet are kept, and removing a boat from a
          fleet drops it from that fleet&apos;s standings and entry counts — its recorded
          finishes stay on the races.
        </p>
        <p>
          <strong className="text-foreground">Find duplicates</strong> automates the common case:
          it groups entries with the same sail number and fleet, keeps the copy with recorded
          results (or the most complete, oldest one) and selects the extras for you to review and
          delete. It never deletes anything itself — the same sail number in two different fleets
          is left alone, since class-scoped numbering can make those genuinely different boats.
        </p>
        <p>
          It also looks for <strong className="text-foreground">possible duplicates</strong>: the
          same boat or person in the same fleet under two different sail numbers, which is what a
          sail-number change between CSV imports leaves behind. Those open in a review dialog
          with a <strong className="text-foreground">Merge</strong> button per group. Merging
          keeps a single entry holding all the recorded results and the newest details — including
          the newest sail number. When two of the entries both hold a finish in the same race the
          group is flagged instead of merged, since both results can&apos;t stand; fix the finish
          sheet, then merge.
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
          in the competitors table, no fleet headings appear in the standings, and the results
          page is a single file exactly as before.
        </p>
        <p>
          For multi-fleet events,{' '}
          <strong className="text-foreground">Preview</strong> shows one fleet at a time, with a
          selector to switch between them. Each fleet downloads as its own file (e.g.{' '}
          <code className="text-foreground text-sm">my-series-junior.html</code>,{' '}
          <code className="text-foreground text-sm">my-series-senior.html</code>), containing that
          fleet’s standings and individual race results.
        </p>
        <p>
          To rename fleets or change their display order, open the{' '}
          <strong className="text-foreground">Settings</strong> tab and click{' '}
          <strong className="text-foreground">Edit ▸</strong> on the{' '}
          <strong className="text-foreground">Fleets</strong> card. You can reorder fleets
          by dragging the <strong className="text-foreground">grip handle</strong> at the start
          of each row (which determines the order they appear in standings and
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

      <Section id="race-fleets" title="Which fleets are in a race">
        <p>
          Not every fleet sails every race — a big series can carry several
          sub-series, each made up of a different handful of boats. When you
          open a race for result entry, Sail Scoring scopes the boat list (the
          finish autocomplete, the start check-in, and the automatic{' '}
          <em>DNC</em> entries) to the boats actually in that race, so you are
          not wading through the whole entry list or clearing phantom DNCs for
          fleets that never started.
        </p>
        <p>
          The signal is the race&rsquo;s starts. A boat is in the race when one
          of its fleets has a start there. <strong className="text-foreground">If
          a race has no starts recorded, every fleet is implied</strong> — the
          full series sails, exactly as before — so nothing changes for a simple
          single-fleet series.
        </p>
        <p>
          For scratch racing you usually have no gun time to record. In the{' '}
          <strong className="text-foreground">Race starts</strong> card (press{' '}
          <strong className="text-foreground">s</strong> or click{' '}
          <strong className="text-foreground">Add start</strong>), pick the
          fleets and <em>leave the gun time blank</em>. That fleets-only start
          declares which fleets are racing without affecting scoring — a race
          with no gun time is still scored on finishing order. Add a gun time
          later if the race turns out to need one.
        </p>
      </Section>

      <Section id="importing-competitors" title="Importing competitors from a spreadsheet">
        <p>
          If your entry list is already in a spreadsheet, you can import it directly rather than
          typing each competitor by hand. On the{' '}
          <strong className="text-foreground">Competitors</strong> tab, click{' '}
          <strong className="text-foreground">Import spreadsheet</strong> (or press{' '}
          <strong className="text-foreground">i</strong>) and select a CSV or Excel (.xlsx)
          file. If an Excel workbook has several sheets with data, you pick which sheet to
          import first. Old-format .xls files are not supported — save them as .xlsx or CSV.
        </p>
        <p>
          Excel cells import as they are displayed. One caveat comes from Excel itself: a
          sail number with leading zeros (like <code className="text-foreground text-sm">007</code>)
          is silently turned into the number 7 <em>as you type it into the spreadsheet</em>{' '}
          unless the column is formatted as Text — no importer can restore what the
          spreadsheet already dropped.
        </p>
        <p>
          The importer shows each column in the file alongside a sample of its values. Use the
          dropdown next to each column to map it to a competitor field — sail number, helm name,
          boat name, class, crew name, club, gender, age, a subdivision axis, or fleet. Columns you
          do not need can be left as <strong className="text-foreground">(ignore)</strong>. Sail
          number is the only required mapping; all other fields are optional. A column named{' '}
          <em>Fleet</em> is detected as the fleet; <em>Class</em> maps to boat class, and{' '}
          <em>Crew</em> to the crew. A <em>Division</em> or <em>Category</em> column maps to a
          subdivision axis: it lands on the matching axis if you already have one, or you can pick{' '}
          <strong className="text-foreground">New subdivision axis</strong> to create one from the
          column heading (so a sheet with both a Division and an Age-category column brings in both).
        </p>
        <p>
          Multi-person fields (owners, helms, crew, and the primary itself) import two ways, and
          both can be combined. Sheets with one column per person (<em>Owner 1</em>,{' '}
          <em>Owner 2</em>, or <em>Crew 1</em>…<em>Crew 3</em>) map every column to the same
          field; the names are kept in column order. Or several names can share one cell
          separated by semicolons (Sailwave’s{' '}
          <code className="text-foreground text-sm">&lt;br&gt;</code> convention and line breaks
          also work) — the sample column previews how a cell will split before you import.
          Commas and <em>&amp;</em> are never treated as separators, so surname-first names
          (“MOUSE, Micky”), shared-surname pairs (“Alice &amp; Bob Byrne”), and “J &amp; M
          Murphy” co-owners come through intact as one entry each. Rows that arrive with more
          than one primary name carry no gender or age, whatever those cells say.
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
          fleet’s scoring system from the rating columns it finds. If every boat in a CSV fleet
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
          “Cruisers 2” grouping when the fleet column is being used as a class label
          and boats end up split across rating fleets.
        </p>
        <p>
          Clicking <strong className="text-foreground">Import</strong> adds any new competitors and
          updates existing ones matched by sail number. When an existing competitor’s fields are
          unchanged by the import, they are counted as{' '}
          <strong className="text-foreground">unchanged</strong> rather than updated. Any rows
          missing a sail number are skipped and listed in the summary.
        </p>
        <p>
          Because matching is by sail number, a boat that changed its number between imports
          would normally come in as a duplicate. The importer watches for this: when a row&apos;s
          sail number is new to the series, the old number is missing from the CSV, and the boat
          or person matches an existing competitor in the same fleet, it pauses to ask{' '}
          <strong className="text-foreground">Sail number changes?</strong> before importing.
          Accepted rows update the existing competitor under the new number — keeping its
          recorded results — instead of creating a second entry.
        </p>
      </Section>

      {has('rrs-import') && (
      <Section id="rrs-org-push" title="Pushing the competitor list to rrs.org">
        <p>
          racingrulesofsailing.org (RRS.org) runs the protest and jury side of many
          events — protest filing, hearing schedules, the online notice board — and
          needs the same competitor list you score. The{' '}
          <strong className="text-foreground">Import</strong> button on the
          Competitors tab can push your list to an rrs.org event: tick{' '}
          <strong className="text-foreground">Import to rrs.org</strong> and paste the
          event&rsquo;s <strong className="text-foreground">UUID</strong>, found in the
          event details at the top of the rrs.org Event Panel. Sail Scoring remembers
          the UUID for the series, so a re-push after the entry list changes is just a
          couple of clicks.
        </p>
        <p>
          You can push on its own, or combine it with a CSV import in one step by
          ticking both options. Combining is how contact details reach rrs.org: Sail
          Scoring deliberately does not store emails, phone numbers, or MNA membership
          numbers, but when your CSV has those columns the importer relays them to
          rrs.org alongside the import and then discards them. Phone numbers are
          converted to international format (e.g.{' '}
          <code className="text-foreground text-sm">+353861234567</code>) using each
          competitor&rsquo;s nationality; numbers that can&rsquo;t be converted are sent
          blank and listed in the summary. A push without a CSV sends those fields
          blank.
        </p>
        <p>
          Most fields map automatically — sail number, nationality (also used as the
          World Sailing MNA code), names, boat name, class, and club. rrs.org has a
          single <em>division</em> slot; choose whether it gets the fleet name, one of
          your subdivision axes, or nothing. Owner and crew names are not sent —
          rrs.org has no fields for them.
        </p>
        <p>
          Each push <strong className="text-foreground">replaces</strong> all
          competitors previously imported into the rrs.org event via its API,
          including any edits made to them on rrs.org since — so push the full,
          corrected list rather than editing on both sides. Competitors entered
          manually on rrs.org are never affected. After a push, rrs.org records any
          per-record problems on its Event Panel; review the imported entries there.
        </p>
      </Section>
      )}

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
          target fleet, and it joins that fleet with the rating seeded in one step. Adding a boat
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
          target fleet, and it joins that fleet with the ECHO handicap seeded in one step. Adding a
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

      {has('follow-on-series') && (
      <Section id="creating-a-follow-on-series" title="Creating a follow-on series">
        <p>
          When one series of a season ends and the next begins —{' '}
          <em>Spring Series 1</em> into <em>Spring Series 2</em> — pick{' '}
          <strong className="text-foreground">Create follow-on series</strong> from the series’
          row menu on the home page. The new series starts with the same settings, fleets, and
          competitors; none of the old series’ races or results come along.
        </p>
        <p>
          For progressive-handicap fleets (NHC, ECHO), each boat’s starting handicap in the new
          series is its handicap after the old series’ last scored race, so the ratings pick up
          exactly where they left off. Boats that never raced keep the starting handicap they had.
          Static ratings (IRC, PY, VPRS) carry over unchanged. The Competitors tab of the new series
          notes which series it was carried forward from; if handicaps in the old series change
          later (a reinstated boat, a corrected finish), use{' '}
          <strong className="text-foreground">Update handicaps</strong> to re-pull them.
        </p>
        <p>
          The new series keeps its predecessor’s category but starts unpublished, with its own
          name and start date — both asked for when you create it.
        </p>
      </Section>
      )}

      <Section id="adding-races" title="Adding races">
        <p>
          On the <strong className="text-foreground">Races</strong> tab, create a race for each
          race sailed. A race number is assigned automatically; a date is optional. You can create
          all races upfront or add them one at a time as the series progresses.
        </p>
        <p>
          For a season of races on a fixed weekday — a weekly Tuesday series, a fortnightly
          league — use the chevron beside{' '}
          <strong className="text-foreground">Add race ▸ Add multiple races…</strong> (or press{' '}
          <kbd>g</kbd>). Pick the first race’s date, choose weekly or fortnightly, and set either a
          number of races or an end date; the dialog previews the dates before you commit. An
          optional name is applied to every race, and for handicap series with a start sequence the
          first start time runs that sequence in each one. The races are appended after any existing
          ones — postpone, rename, or drop any single date afterwards exactly like a hand-added race.
        </p>
        <p>
          Each race card shows how many finishes have been recorded. Click a race card to open the
          result entry screen for that race. The race date is shown beneath the heading there —
          click it to change it (handy after an import that guessed the date, or if a race is
          re-sailed on another day).
        </p>
        <p>
          A race can also carry a <strong className="text-foreground">name</strong> alongside its
          number — “New Year’s Day Race”, “Round the Island”, “Race 3 (re-sail)”. Open the race and
          click <strong className="text-foreground">Add name</strong> beneath the heading; the name
          appears on the Races tab and in the published results (the column stays{' '}
          <em>R1</em>, <em>R2</em>… so tables stay compact). Clear the field to drop the name.
        </p>
        <p>
          Races can be <strong className="text-foreground">reordered</strong> by dragging the{' '}
          <strong className="text-foreground">grip handle</strong> at the start of each row, or by
          focusing a row and pressing <kbd>Alt</kbd>+<kbd>↑</kbd> / <kbd>Alt</kbd>+<kbd>↓</kbd> to
          move it one place earlier or later. To slot a race in mid-series — a postponed race
          re-sailed between two others, or a make-up race — use a row’s{' '}
          <strong className="text-foreground">⇅ menu ▸ Insert race above / below</strong>. Races
          renumber automatically to stay in order; existing redress (RDG) pools follow their races,
          so reordering or inserting never disturbs a previously scored redress.
        </p>
      </Section>

      {has('sub-series') && (
        <Section id="sub-series" title="Sub-series">
          <p>
            A season often scores as several series that share one entry list and fleet structure —
            a Winter block and a Spring block sailed back-to-back, or a Tuesday series and a
            Saturday series running in parallel — each with its own standings, discards, and prizes.
            Sub-series let you keep that whole season in a single series. On the{' '}
            <strong className="text-foreground">Races</strong> tab, click{' '}
            <strong className="text-foreground">New sub-series</strong>, give it a name, and tick the
            races it includes. A race can belong to several sub-series (a season “Tuesday Overall”
            alongside per-series Tuesday tables), and a one-off feature race can be its own
            one-race sub-series.
          </p>
          <p>
            Turning this feature on drops a worked example —{' '}
            <strong className="text-foreground">Sample Club League 2026</strong> — into your series
            list, with an overall table, Spring and Summer blocks, a fleet-scoped championship, and a
            continued handicap chain already set up to explore. Delete it whenever you like.
          </p>
          <p>
            Each sub-series is scored on its own. The series discard rule applies to its race count
            separately. By default a boat that entered the series but never started this sub-series
            is still scored DNC in it, just like a plain series. To rank only the boats that actually
            took part — leaving the no-shows off this sub-series’ table and out of its DNC entry
            count — tick{' '}
            <strong className="text-foreground">Rank only boats that took part</strong> in the
            editor. Removing a sub-series leaves the races themselves untouched.
          </p>
          <p>
            For progressive handicaps (NHC, ECHO), each sub-series computes its own ratings over its
            own races — the correct behaviour when different boats sail different days, since a
            handicap rates a boat against whoever actually raced. To continue one sub-series’ ratings
            into the next (a Series 1 → Series 2 carry, or a single chain across a season), set{' '}
            <strong className="text-foreground">Continue handicaps from</strong> in the sub-series
            editor.
          </p>
          <p>
            By default a sub-series scores every fleet. In a multi-fleet series you can narrow it
            under <strong className="text-foreground">Fleets</strong> in the editor — a
            Cruisers-only championship that leaves the Whitesails fleet out of its tables, for
            instance. Only the chosen fleets are scored and published for that view.
          </p>
          <p>
            To strike a single race for one fleet only — a single-competitor heat that doesn’t
            count, or a race abandoned for one class but not another — open{' '}
            <strong className="text-foreground">Per-fleet race exclusions</strong> in the editor and
            tick the fleet to exclude for that race. The race still counts for the other fleets; for
            the excluded one it scores nothing, earns no discard, and (for NHC/ECHO) doesn’t move
            the handicap.
          </p>
        </Section>
      )}

      <Section id="entering-results" title="Entering results">
        <p>
          The result entry screen is a digital transcription of the handwritten finish sheet.
          Each row is a crossing of the finish line; row order is crossing order. Search for
          a competitor by sail number using the input at the top and they are added to the
          next slot in the list. Pressing <strong className="text-foreground">Enter</strong>{' '}
          adds the boat as soon as what you have typed can only mean one boat — you need not
          finish the whole number. For boats in a fleet with a recorded start, the app prompts
          for a finish time before adding the row.
        </p>
        <p>
          When a series has more than one race, a switcher at the top of the entry screen moves
          you straight to another race without going back to the Races tab — the arrows step to
          the previous or next race (or press <strong className="text-foreground">[</strong> and{' '}
          <strong className="text-foreground">]</strong>), and the dropdown jumps to any race in
          the series.
        </p>
        <p>
          If a sail number is not yet registered in the series, the app will offer to{' '}
          <strong className="text-foreground">Record as unknown</strong>. When the number you
          have typed is also the start of a registered boat&rsquo;s sail number — an unknown{' '}
          <span className="font-mono">12</span> while <span className="font-mono">12345</span>{' '}
          is registered — press <strong className="text-foreground">Shift+Enter</strong> (or
          pick <strong className="text-foreground">Record as unknown</strong> from the
          suggestions) to file it as unknown rather than completing to the registered boat. The
          row is kept in crossing order; click <strong className="text-foreground">Resolve</strong>{' '}
          next to the entry to link it to a registered competitor once you know who it was.
          Unresolved unknown finishes are excluded from standings until resolved.
        </p>
        <p>
          If you’ve enabled the <em>Bow number</em> competitor field, finish
          entry matches on the bow number as well as the sail number. This helps
          when a boat’s bow number differs from its registered sail number and
          the recorders wrote the bow number on the sheet. Sail numbers take
          precedence: a typed value that is one boat’s sail number always
          resolves to that boat, and only falls through to bow-number matching
          when no sail number matches. Because the row then shows the boat’s
          registered <em>sail</em> number — not the bow number you typed — a{' '}
          <strong className="text-foreground">matched on bow</strong> marker
          appears in the suggestion list, and the committed row is tagged{' '}
          <strong className="text-foreground">entered by bow</strong> so it’s
          clear why the displayed sail number differs from what was keyed.
        </p>
        <p>
          Rows for fleets without a start time (scratch scoring) show a{' '}
          <strong className="text-foreground">grip handle</strong> you can drag to reorder a
          boat in the list (or, with the keyboard, focus the handle, press Space, use the arrow
          keys, and press Space to drop). Rows for timed fleets have no handle — their position
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
          name. Boats that simply did not compete (an automatic{' '}
          <strong className="text-foreground">DNC</strong>) sink to a{' '}
          <strong className="text-foreground">Did not compete</strong> group at the foot of the
          panel, so the boats you have actually recorded a result for stay together at the top and
          it is easy to see who is still to account for. In a big fleet, the filter box at the top
          of the panel (shortcut <strong className="text-foreground">/</strong>) narrows the list
          by sail number, boat, helm or class;{' '}
          <strong className="text-foreground">Esc</strong> clears it. Codes are grouped by how
          they arise:
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
          <li><strong className="text-foreground">BFD</strong> — Black Flag Disqualification, rule 30.4 (discardable)</li>
        </ul>
        <p>
          By default (RRS A5.2), all penalty codes score{' '}
          <em>series entries + 1</em> points. If you enable{' '}
          <strong className="text-foreground">A5.3 starting-area scoring</strong> in
          Settings, most codes instead score{' '}
          <em>starting-area entries + 1</em> for that race — a smaller penalty when
          turnout is low. DNC still scores series entries + 1 regardless. A third
          option, <strong className="text-foreground">starting area including DNC</strong>{' '}
          (RRS A5.3 as changed by DBSC Sailing Instruction A13.2), scores DNC from the
          boats that came to the start + 1 as well.
        </p>
        <p>
          <strong className="text-foreground">DNE cannot be discarded.</strong>{' '}
          In the standings table it is shown in red. Even if a DNE is a
          competitor’s worst score, the discard falls on their next-worst result
          instead. A plain BFD, by contrast, is an ordinary disqualification and{' '}
          <em>can</em> be discarded like any other score.
        </p>
        <p className="font-medium text-sm mt-2">Additive penalty codes (applied to finishers)</p>
        <p>
          A boat that finishes but is penalised by the protest committee may be assigned an
          additive penalty code from the{' '}
          <strong className="text-foreground">row actions menu</strong> (the{' '}
          <strong className="text-foreground">⋯</strong> button on its row in the finisher
          list). Open the menu and choose <em>Set scoring penalty</em>.
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
          Per RRS A6.2, additive penalties do not change other competitors’ scores —
          two boats may legitimately share the same score. The penalised score is capped at
          the DNF score for that race. Penalty codes are shown in amber in the standings table,
          e.g. <em>4 (ZFP)</em>.
        </p>
      </Section>

      {has('csv-finish-import') && (
      <Section id="importing-finish-sheet" title="Importing a finish sheet from a spreadsheet">
        <p>
          On a race’s result entry screen, click{' '}
          <strong className="text-foreground">Import sheet</strong> (or press{' '}
          <strong className="text-foreground">i</strong>) to import a whole finish
          sheet in one go — useful when results are captured on a tablet or in a
          spreadsheet on the RC boat and you want to transcribe the lot at once.
          Both CSV and Excel (.xlsx) files work; Excel time cells import as the
          time shown in the spreadsheet.
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
          Row order in the sheet is the crossing order — the importer assigns finish positions
          in the order rows appear. A preview dialog shows how many finishers and coded
          entries will be imported and how many existing finishes will be replaced.
        </p>
        <p>
          The import is <strong className="text-foreground">replace-all</strong>: confirming
          replaces the race’s finishing order entirely and clears any penalties, redress,
          and tied-finish markers — the importer only covers the basic sheet, so re-apply
          those in the editor after import if needed. Existing start check-ins are preserved.
          Click <strong className="text-foreground">Save results</strong> after importing to
          persist the change.
        </p>
      </Section>
      )}

      <Section id="redress" title="Redress (RDG)">
        <p>
          When the protest committee grants a competitor redress under RRS Rule 62,
          their score for a race is replaced by an average calculated from their
          other scores. Assign redress from a competitor&rsquo;s controls in the
          race entry screen — the exact control depends on whether they finished
          (see below).
        </p>
        <p>
          There are two entry paths depending on whether the competitor finished:
        </p>
        <ul className="list-disc list-inside space-y-1 pl-2">
          <li>
            <strong className="text-foreground">Finisher granted redress</strong> — the
            boat completed the course and recorded a position, but later received redress to
            improve their score. Open the row actions menu (the <strong className="text-foreground">⋯</strong>{' '}
            button) on its row in the finishing order list and choose <em>Set redress (RDG)</em>. The
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
            the competitor’s scores in all other races in the series.
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
        <p className="font-medium text-sm mt-2">Per-fleet stated points (multi-fleet boats)</p>
        <p>
          When a boat is scored in more than one fleet (e.g. the same start scored
          under IRC and ECHO), the redress dialog defaults to one stated value applied
          to every fleet. If the committee wants a different value per fleet — because
          the boat’s standing at the time of the incident differs by handicap system —
          click <strong className="text-foreground">Set points per fleet</strong> and
          enter each fleet’s value. The averaged methods (A9(a)/(b)) already average
          each fleet’s own scores, so they need no per-fleet entry.
        </p>
        <p>
          If you later add the boat to a new fleet, that fleet has no stated value yet:
          it is scored as the A9(a) average for that fleet, and an amber notice on the
          standings names the boat so you can enter a value. (A per-fleet{' '}
          <strong className="text-foreground">DPI</strong> penalty works the same way,
          except a fleet with no value simply has no penalty applied until you set one.)
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
          2nd scores 2, and so on. Lower totals are better. The standings are ordered by net
          points; ties are broken per RRS A8 — first by each boat’s race scores listed
          best-to-worst excluding discards (A8.1), then, if still tied, by the score in the last
          race, the next-to-last, and so on (A8.2).
        </p>
        <p>
          Result codes are shown in parentheses in the race columns, e.g. <em>7 (DNF)</em>.
        </p>
        <p>
          The <strong className="text-foreground">Rank</strong> column gives the top three overall a
          gold, silver, or bronze badge. The same badges appear in the race columns on each race’s
          top three finishers, so you can spot the podium of every race at a glance. Coded,
          penalised, redress, and discarded scores keep their usual styling and are never badged.
        </p>
        <p>
          When discard rules are configured, a{' '}
          <strong className="text-foreground">Nett</strong> column appears showing each
          competitor’s series total after their worst score(s) are dropped. Discarded scores
          are shown struck through. The standings are ordered by nett total.
        </p>
        <p>
          In a multi-fleet series you can strike a single race from one fleet’s scoring right
          from the standings — the usual case is a heat only one boat sailed. Click a race
          column header and choose{' '}
          <strong className="text-foreground">Exclude from this fleet</strong>. The menu names the
          underlying race (its series-wide number and date), so inside a sub-series you can tell
          that the block’s <em>R6</em> is really <em>Race 13</em> before you act. The race still
          counts for every other fleet; for the excluded one it scores nothing, earns no discard,
          and (for NHC/ECHO) doesn’t move the handicap. The struck column is shown for everyone;
          open the menu again to <strong className="text-foreground">Include</strong> it. A race
          that <em>no boat in the fleet sailed</em> is already excluded automatically — its column
          is struck and the menu says so, with nothing to toggle. When you’re viewing a sub-series
          the action strikes the race just for that block; the same exclusions can also be set as a
          grid in the sub-series editor on the Races tab.
        </p>
        <p>
          To share results, click{' '}
          <strong className="text-foreground">Preview</strong> (or press{' '}
          <strong className="text-foreground">x</strong>) to see the rendered results page in-app —
          exactly what publishing produces. From there you can{' '}
          <strong className="text-foreground">Download</strong> a self-contained file to email or
          host on your club website, or <strong className="text-foreground">Publish</strong> it. The{' '}
          <strong className="text-foreground">Download</strong> menu offers{' '}
          <strong className="text-foreground">HTML</strong> or{' '}
          <strong className="text-foreground">PDF</strong>; the published page has a{' '}
          <strong className="text-foreground">Save as PDF</strong> link in its footer. Either opens
          your browser’s print dialog with a print-tuned layout — handy for a PDF to attach to
          an email or pin to the noticeboard.
          {has('ftp-upload') && (
            <>
              {' '}To push results directly to a web server, see{' '}
              <a href="#publishing-results" className="underline">Publishing results via FTP</a>.
            </>
          )}
        </p>
        <p>
          You can brand the exported page from the{' '}
          <strong className="text-foreground">Settings</strong> tab. The{' '}
          <strong className="text-foreground">venue</strong> and{' '}
          <strong className="text-foreground">event logo URLs</strong> place logos in the page
          header; the matching{' '}
          <strong className="text-foreground">website URLs</strong> make those logos clickable and
          add venue and event links to the page footer. All four are optional.
        </p>
      </Section>

      {has('prizes') && (
        <Section id="prizes" title="Prizes">
          <p>
            The <strong className="text-foreground">Prizes</strong> tab turns the Notice of Race’s
            prize list into named awards allocated live from the series standings. A prize is a
            name (“Gold Fleet 1st, 2nd, 3rd”), the number of places it covers, and{' '}
            <strong className="text-foreground">conditions</strong> on who is eligible — a
            subdivision value (a Division or age category recorded on the competitors), a fleet, a
            maximum series rank for “Overall” podiums, helm gender (“Lady 1st, 2nd, 3rd”),
            nationality (“first IRL boat”), or club. The condition picker offers the fields your
            competitors actually carry values for. The top-ranked eligible competitors are the
            recipients, updating as results come in. Press{' '}
            <strong className="text-foreground">a</strong> to add a prize; drag to reorder the
            prize-giving sheet.
          </p>
          <p>
            Importing a Sailwave file that defines prizes brings them in automatically — fleet,
            rank, Division/category, and helm-gender conditions map onto the fields above. A prize
            the model can’t express is skipped, and the import wizard lists it with the reason so
            you can recreate it here.
          </p>
          <p>
            The tab warns when something needs attention — a condition on a field no competitor
            carries a value for, fewer eligible boats than places, or an unbroken scoring tie
            straddling the last awarded place (the tie-break between those boats is yours to make,
            per the sailing instructions).
          </p>
          <p>
            When you publish, the prize sheet appears as its own{' '}
            <strong className="text-foreground">Prizes</strong> page alongside the fleet pages —
            tick or untick it in the Publish dialog, and edit its URL before first publish. It’s
            linked from the series’ published index, ready for the prize-giving.
          </p>
        </Section>
      )}

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

      <Section id="discard-rules" title="Discard rules">
        <p>
          A <strong className="text-foreground">discard</strong> lets a competitor drop their worst
          race score from the series total — a bad day doesn’t ruin a whole season. Only the
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
          <strong className="text-foreground">⋯</strong> menu in the series header and click{' '}
          <strong className="text-foreground">Save to File</strong>. This downloads a{' '}
          <code className="text-foreground text-sm">.sailscoring</code> file containing the
          complete series — all competitors, races, and results. You can save the file to Google
          Drive, Dropbox, or email it to a co-scorer.
        </p>
        <p>
          To open a series from a file, click{' '}
          <strong className="text-foreground">Import Series</strong> on the home screen and choose{' '}
          <strong className="text-foreground">Sail Scoring file</strong>. Select the{' '}
          <code className="text-foreground text-sm">.sailscoring</code> file. If the series is
          already in your workspace, you will be asked whether to update the existing copy or open
          it as a separate one.
        </p>
        {has('sailwave-import') && (
          <>
            <p>
              To bring a season’s seedings across from Sailwave, choose{' '}
              <strong className="text-foreground">Sailwave file</strong> from the same dialog and
              pick the <code className="text-foreground text-sm">.blw</code> series file from
              Sailwave. The wizard previews the fleets, competitors, and races, then creates the series
              with ratings and any results Sailwave already had — fill in the per-fleet scoring system
              if it auto-detects wrongly, and adjust any race dates Sailwave didn’t carry across.
            </p>
            <p>
              If the file has prize-giving subdivisions — Sailwave’s Division field, and/or the helm
              age group (often retitled to something like <em>Category</em>) — the wizard detects each
              as its own column and shows the headings it found. The values are imported exactly as
              Sailwave stored them (e.g. age-band codes like <em>GGM</em>); you can rename the first
              column heading before importing, and rename, add, or remove columns afterwards from{' '}
              <strong className="text-foreground">Settings</strong> and the{' '}
              <strong className="text-foreground">Competitors</strong> tab.
            </p>
            <p>
              If you keep scoring a series in Sailwave and treat Sail Scoring as the publishing
              front end, open the series’ <strong className="text-foreground">⋯</strong> menu
              and click <strong className="text-foreground">Update from Sailwave file…</strong>{' '}
              (shown only for series that were imported from Sailwave). Pick a fresh{' '}
              <code className="text-foreground text-sm">.blw</code> export and the wizard replaces the
              competitors, fleets, races and results from the file while keeping the series name,
              venue, competitor-field setup and publishing destination. Your published results
              don’t change until you publish again.
            </p>
          </>
        )}
        <p>
          To bring a series someone else is scoring into your workspace, open the{' '}
          <strong className="text-foreground">⋯</strong> menu on the existing series and
          click <strong className="text-foreground">Update from File…</strong>. The app checks
          whether the incoming file is a clean continuation of the workspace copy and warns you
          if both copies have diverged.
        </p>
        <p>
          If you used Sail Scoring before sign-in was required and have series saved in this
          browser, the home page shows a banner offering to{' '}
          <strong className="text-foreground">Move to my account</strong>. The migration runs
          one series at a time and is safe to re-run — the banner only counts series that
          haven’t already been moved.
        </p>
      </Section>

      <Section id="collaboration" title="Working with co-scorers">
        <p>
          When a club scoring panel shares a workspace, several scorers work on
          the same series at once — typically split by fleet. Sail Scoring
          doesn’t lock anything; instead it keeps a clear record of what
          changed, when, and by whom — see the{' '}
          <strong className="text-foreground">History</strong> tab (below).
        </p>
        <p>
          The series list mirrors the most recent change under each series, so
          you can see at a glance which events your co-scorers have touched. And
          the competitor edit dialog shows who last edited that competitor. If
          two scorers happen to change the same result at the same moment, the
          second one sees a conflict prompt naming the other scorer rather than
          silently overwriting their work.
        </p>
        <p>
          To add a co-scorer, open{' '}
          <strong className="text-foreground">Workspace settings</strong> (from
          the workspace menu in the header) and use the{' '}
          <strong className="text-foreground">Members</strong> card to invite
          them by email. They get a link to accept; once they do, they appear in
          the members list and share the workspace. Owners and admins can change
          a member’s role or remove them there too.
        </p>
        <p>
          This applies to a shared club or class workspace only.{' '}
          <em>My Workspace</em> is your own — it holds the series you score by
          yourself, has no members but you, and shows no Members card at all.
          If you want a panel, request a shared workspace as below and score
          there instead.
        </p>
        <p>
          What someone can do is set by their{' '}
          <strong className="text-foreground">role</strong>.{' '}
          <strong className="text-foreground">Owners</strong> and{' '}
          <strong className="text-foreground">admins</strong> have full access:
          every series, its settings, and the workspace configuration. A plain{' '}
          <strong className="text-foreground">member</strong> is a viewer — they
          see every series, its standings, and its history, but can change
          nothing. That makes member the right role for committee members and
          class captains who want visibility without the risk of an accidental
          edit, and it’s the default for new invitations: promote people
          once they’re scoring.
          {has('fine-grained-roles') && (
            <>
              {' '}A <strong className="text-foreground">scorer</strong> sits in
              between, scoped to running a race day: they can add races, enter
              start times and finishes, and publish results, but can’t
              change competitors, handicaps, series settings, or workspace
              configuration — the role for a rostered duty scorer.
            </>
          )}
        </p>
        <p>
          Don’t have a shared workspace yet? Request one from your{' '}
          <strong className="text-foreground">Account</strong> page — give it a
          name and we’ll set it up and make you the owner, ready to invite
          the rest of your panel.
        </p>
      </Section>

      <Section id="history" title="Version history">
        <p>
          Every series keeps a versioned <strong className="text-foreground">History</strong>{' '}
          tab (or press <strong className="text-foreground">g</strong> then{' '}
          <strong className="text-foreground">h</strong>). As you edit, Sail
          Scoring saves point-in-time versions automatically: a continuous
          editing session by one scorer is captured as a single version, so the
          list stays readable rather than one entry per keystroke.
        </p>
        <p>
          The list is newest-first, each version naming the scorer and how long
          ago it was. Expand a version to see the individual changes it covers —
          results entered, races added, competitors imported, settings changed —
          each grouped under the session that made them. It’s the record
          behind a scoring inquiry and the audit trail for a protest committee.
        </p>
        <p>
          To roll back a mistake, press{' '}
          <strong className="text-foreground">Restore</strong> on any earlier
          version: the series is replaced with its state at that point. Nothing
          is lost — your current version stays in the history, and the restore
          itself is recorded as a new version, so you can always undo it by
          restoring again. (Restore is unavailable on an archived, read-only
          series.)
        </p>
        <p>
          To mark a moment deliberately — before a protest hearing, say, or
          after publishing — press{' '}
          <strong className="text-foreground">Name this version</strong> and give
          it a name. A named checkpoint is pinned in the history and never folded
          into an automatic session, so it stays an obvious point to return to.
        </p>
        <p>
          Key moments are marked for you, too: <strong className="text-foreground">publishing</strong>{' '}
          results pins a <em>Published</em> version (the exact state that went
          public — a clean point to restore to), and{' '}
          <strong className="text-foreground">Save to File</strong> pins a{' '}
          <em>Saved</em> version. Both also close off the current editing session,
          so later edits start a fresh version rather than blurring into the one
          before the milestone.
        </p>
        <p>
          Saving the series to a file (<strong className="text-foreground">Save
          to File</strong>) includes this version history, so a saved{' '}
          <code>.sailscoring</code> file is a complete backup — reopen it as a
          new series elsewhere and its history comes with it.
        </p>
        <p>
          To keep things tidy, older <em>automatic</em> versions are gradually
          thinned out — recent ones are all kept, then roughly one per day, then
          only the timeline entry remains (so the record of who changed what
          stays, even though that exact state is no longer restorable). Versions
          you marked deliberately — named checkpoints, published, and saved
          versions — are always kept restorable.
        </p>
      </Section>

      {has('logo-library') && (
      <Section id="logo-library" title="The logo library">
        <p>
          Your workspace has a shared <strong className="text-foreground">logo library</strong> —
          a place to keep the venue, club, class, sponsor, and governing-body logos you reach for
          when branding results. Manage it from{' '}
          <strong className="text-foreground">Workspace settings → Logo library</strong>: upload a
          PNG, JPEG, GIF, WebP, or SVG (a transparent background looks best in results headers),
          give it a name and a type, and optionally note where it came from.
        </p>
        <p>
          The workspace can also have a <strong className="text-foreground">logo of its own</strong>
          {' '}— set it at the top of the card (from your logos or a built-in one). It shows beside
          the workspace name in the switcher and becomes the default venue logo for new series
          unless you set a specific default below.
        </p>
        <p>
          Logos are shared with everyone in the workspace, so a logo one scorer cleans up is there
          for the whole team. When you set a series’ <strong className="text-foreground">venue</strong>{' '}
          or <strong className="text-foreground">event logo</strong> in{' '}
          <strong className="text-foreground">Basic</strong> settings, click{' '}
          <strong className="text-foreground">Library</strong> to pick one — from your workspace’s
          own logos or the <strong className="text-foreground">built-in</strong> set of official
          club, class, governing-body, and sponsor marks — or paste a URL as before.
          Picking from the library links the published results to the logo rather than a copy, so
          updating the logo in the library updates results that use it without re-publishing.
        </p>
        <p>
          You can also set <strong className="text-foreground">defaults for new series</strong> — a
          default venue and event logo the workspace reaches for automatically, chosen from the same
          picker (your own logos or a built-in one). Every new series starts with those logos
          already in place (you can still change them per series). Existing series keep their own
          logos, but any that leave the venue or event slot empty fall back to these defaults when
          published.
        </p>
        <p>
          If you belong to more than one workspace, <strong className="text-foreground">Copy from
          workspace…</strong> pulls a logo another of your workspaces has already cleaned up into
          this one. It’s a copy, not a link — the logo keeps working here even if the original
          is later changed or removed.
        </p>
      </Section>
      )}

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
              record when they&rsquo;re the same sailor.
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
          championship plus a sailor&rsquo;s best N regional results, summed so
          the lowest total ranks first. Create and view them on the{' '}
          <strong className="text-foreground">Rankings</strong> tab of the
          workspace home.
        </p>
        <p>
          A ranking is a set of <strong className="text-foreground">buckets</strong>.
          Each bucket picks the series that belong to it, how many of a
          sailor&rsquo;s best places count (<em>count best</em>), and how many of
          its series a sailor must have sailed to rank at all (<em>need at
          least</em>). For example: a <em>National</em> bucket holding just the
          Nationals (best 1, need 1) and a <em>Regional</em> bucket holding the
          regionals (best 2, need 2). Sailors short of a floor are listed as not
          yet ranked rather than dropped silently; an optional nationality filter
          restricts the ladder to home sailors, and an optional fleet filter to
          one fleet by name. The nationality filter can also{' '}
          <strong className="text-foreground">count places among matching
          sailors only</strong> — a home sailor finishing 2nd behind a visiting
          boat counts a 1st, the convention national rankings like IODAI&rsquo;s
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
          each sailor&rsquo;s place, discarded places in parentheses, podium
          places medal-coloured, and Total alongside the Net that ranks.
          Where a committee sets a place by hand — an averaged place for a
          sailor away on representational duty, medical redress — add an{' '}
          <strong className="text-foreground">adjustment</strong> in the
          ranking&rsquo;s configuration: the place (fractions allowed) appears
          with an asterisk and your note explains it, as a tooltip in-app and
          a footnote on the public page.
        </p>
        <p>
          Switch <strong className="text-foreground">Public page</strong> on to
          host the ladder at a public URL that updates as results land. As with
          publishing standings, you choose the URL&rsquo;s last segment while
          the ranking is private; once published it&rsquo;s fixed. The
          public ladder counts <strong className="text-foreground">published
          series only</strong> and names exactly which series it&rsquo;s based
          on — publish the contributing series to bring them in.
        </p>
      </Section>
      )}

      <Section id="publishing-results" title="Publishing results">
        <p>
          Publish results to a public URL from the{' '}
          <strong className="text-foreground">Standings</strong> tab
          {has('ftp-upload')
            ? '. The Publish dialog can host them on Sail Scoring’s pages or, if your club runs its own website, upload them there via FTP — pick a destination and the series remembers it.'
            : '.'}
        </p>
        <p>
          <strong className="text-foreground">Publish:</strong> click{' '}
          <strong className="text-foreground">Publish</strong> (or press{' '}
          <strong className="text-foreground">p</strong>). Sail Scoring renders the current
          standings and hosts them under your workspace at a public URL like{' '}
          <code className="text-foreground text-sm">app.sailscoring.ie/p/hyc/autumn-league-2026/standings</code>.
          The dialog suggests a slug from the series name which you can edit before the first
          publish; once published it’s fixed, so the URL is stable forever and re-publishing
          updates the page in place. Publishing is an explicit, point-in-time action: editing the
          series afterwards does not change the published page, and the dialog tells you how many
          edits have landed since the last publish so you know when to re-publish. A series scored
          as multiple fleets produces one page per fleet (e.g.{' '}
          <code className="text-foreground text-sm">…/autumn-league-2026/irc-1</code>). Published
          pages are read-only and need no sign-in to view.
        </p>
        <p>
          <strong className="text-foreground">Choosing fleets and URLs:</strong> the dialog lists
          every fleet with a checkbox — only the ticked fleets are published or updated when you
          click Publish. Untick a fleet you’re still working on to leave it out this round; if
          it was already published, its current page stays live and simply isn’t updated until
          you tick it again (to take a page down entirely, use Unpublish). Each fleet also shows the last segment of its URL,
          which you can edit before it’s published — handy when you want a clean fleet name
          like <em>Puppeteers HPH</em> to live at a disambiguated URL such as{' '}
          <code className="text-foreground text-sm">tuesday-puppeteers-hph</code>. Once a fleet is
          published its URL is fixed, like the slug; to change it, unpublish and publish again.
        </p>
        <p>
          Each series also gets a listing page at its base URL (e.g.{' '}
          <code className="text-foreground text-sm">…/autumn-league-2026</code>) linking to every
          fleet, and your workspace has a public index at{' '}
          <code className="text-foreground text-sm">app.sailscoring.ie/p/hyc</code> listing all the
          series you’ve published. Both update automatically as you publish. Each fleet page
          links back up to its series listing, and that listing links up to the workspace index,
          so a visitor can climb from one fleet’s results to everything you’ve published.
        </p>
        <p>
          <strong className="text-foreground">Co-publishing several series to one URL:</strong>{' '}
          a slug is a shared namespace, so more than one series can publish under the same one —
          handy when an event is scored as separate series, e.g. publishing both{' '}
          <em>Lambay Races Cruisers</em> and <em>Lambay Races One Designs</em> to{' '}
          <code className="text-foreground text-sm">…/2026-lambay-races</code>. Type the existing
          slug when you publish the second series; Sail Scoring asks you to confirm joining the
          existing event, then the listing page lists every series under it, each with its own
          fleets. Each series keeps publishing and unpublishing independently — unpublishing one
          removes only its fleets and leaves the others live. Every fleet URL must be distinct
          across the series sharing a slug; if two clash, edit one fleet’s URL segment in the
          publish dialog.
        </p>
        <p>
          <strong className="text-foreground">Managing published pages:</strong>{' '}
          the <strong className="text-foreground">Published</strong> tab on the workspace pages
          lists every page your workspace has published, with its public URL, when it was last
          published, how many edits have landed since, and whether it shares its URL with
          another series. Pages are grouped the same way as the public listing — active series
          by category, archived ones under Past results by year — and you can search by name
          or URL and filter to pages with edits since publish.{' '}
          <strong className="text-foreground">Unpublish</strong> takes a page down: the public URL
          stops working and the slug frees up for reuse (or, if the URL is shared, only that
          series’ fleets are removed and the page stays live for the rest).
          You can also unpublish from the <strong className="text-foreground">Publish</strong>{' '}
          dialog on the Standings tab. If you delete a series whose results were published,
          the page stays live as an orphaned snapshot, listed on the Published tab under{' '}
          <strong className="text-foreground">Series deleted</strong> — that’s where you remove
          it.
        </p>
        {has('ftp-upload') && (
          <>
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
              time. Credentials are stored encrypted, scoped to your workspace, and are never included
              in series file exports.
            </p>
            <p>
              <strong className="text-foreground">Uploading:</strong> on the{' '}
              <strong className="text-foreground">Standings</strong> tab, click{' '}
              <strong className="text-foreground">Publish</strong> (or press{' '}
              <strong className="text-foreground">p</strong>) and choose{' '}
              <strong className="text-foreground">Your website (FTP)</strong> at the top of the
              dialog. Select the server, enter the remote path for the results file (e.g.{' '}
              <code className="text-foreground text-sm">/public_html/results/fleet-a.html</code>),
              and click <strong className="text-foreground">Upload</strong>. The series remembers
              this choice and reopens in FTP mode next time — switch back to{' '}
              <strong className="text-foreground">Sail Scoring pages</strong> whenever you like. A
              multi-fleet series shows one path per fleet, each with a checkbox, so you can upload
              just the fleets you tick.
            </p>
            <p>
              If the upload fails, the raw FTP error from the server is shown — this is usually
              enough to diagnose a wrong path, bad credentials, or a permission problem.
            </p>
          </>
        )}
      </Section>

      {has('combined-pages') && (
        <Section id="combined-pages" title="Combined pages">
          <p>
            A combined page publishes several fleets&rsquo; results together as sections of one
            page. Two common uses: an <strong className="text-foreground">Overall</strong> page
            carrying every fleet&rsquo;s standings, so a multi-class event has a single link to
            hand out; and a single class page covering all the ways that class is scored — say
            one <em>Puppeteer</em> page with its Scratch and HPH fleets — instead of separate
            per-fleet pages.
          </p>
          <p>
            Define combined pages on the series&rsquo;{' '}
            <strong className="text-foreground">Settings</strong> tab under{' '}
            <strong className="text-foreground">Combined pages</strong>. Each has a name (which
            becomes the page title and its URL segment), a fleet selection —{' '}
            <strong className="text-foreground">All fleets</strong> keeps up with fleets you add
            later, or <strong className="text-foreground">Choose fleets</strong> picks a subset —
            and a detail level: <strong className="text-foreground">Standings only</strong> shows
            each fleet&rsquo;s summary table without the per-race tables (the usual choice for an
            Overall page), while <strong className="text-foreground">Full per-race detail</strong>{' '}
            keeps everything a standalone fleet page shows.
          </p>
          <p>
            By default every fleet still publishes its own page and the combined pages are
            extras. Untick{' '}
            <strong className="text-foreground">Publish individual per-fleet pages</strong>{' '}
            to publish <em>only</em> the combined pages — the standalone fleet pages are taken
            down on the next publish, and the Publish dialog shows each fleet with a note
            pointing at the combined page(s) it appears on. A fleet on no combined page
            isn&rsquo;t published at all while the toggle is off. Combined pages
            appear in the Publish dialog, the series listing page, and Preview alongside the
            fleet pages. On a series with sub-series, each sub-series gets its own combined
            page (e.g. <code className="text-foreground text-sm">…/winter/overall</code>)
            covering the fleets it scores — a combined page always shows one set of races.
          </p>
        </Section>
      )}

      {has('results-status') && (
        <Section id="results-status" title="Provisional and final results">
          <p>
            Results are <strong className="text-foreground">provisional</strong> while they can
            still change — a protest decision, a redress request, or a scoring correction can all
            move a score. Once the event is settled, mark the series{' '}
            <strong className="text-foreground">final</strong>: on the{' '}
            <strong className="text-foreground">Standings</strong> tab, click{' '}
            <strong className="text-foreground">Mark as final</strong>. The dialog asks you to
            confirm the three things that make “final” mean something: the protest and
            request-for-redress time limit for the last race has passed (under RRS 60.3(b) the
            default is two hours after the last boat finishes, unless your sailing instructions
            say otherwise), nothing is pending with the protest committee, and the results team
            and organiser know of no other outstanding issues. A final series is read-only and
            shows a green <strong className="text-foreground">Final</strong> badge; published
            pages carry a <strong className="text-foreground">Final results</strong> stamp in
            place of the provisional-as-of line once you publish again. If something does come
            up, <strong className="text-foreground">Reopen as provisional</strong> from the
            banner — reopening is recorded in the series activity, so the trail stays honest.
          </p>
          <p>
            The protest window is anchored on the{' '}
            <strong className="text-foreground">last finisher</strong>. Where finish times are
            recorded, each race knows its last finisher automatically; for untimed racing, record
            it by hand on the race page (<strong className="text-foreground">Record last
            finisher</strong> under the race title). Set your SIs&rsquo; limit under{' '}
            <strong className="text-foreground">Settings ▸ Protest time limit</strong> — a number
            of minutes measured from each race&rsquo;s last finisher, or from the last finisher
            of the whole race day — and the <strong className="text-foreground">Races</strong>{' '}
            tab shows a live line on race day: when the last boat finished, and when the protest
            time limit ends.
          </p>
        </Section>
      )}

      <Section id="json-export" title="JSON data export and Open in Sail Scoring">
        <p>
          Every HTML results page — whether downloaded from{' '}
          <strong className="text-foreground">Preview</strong> or pushed via FTP or
          Publish — includes an{' '}
          <strong className="text-foreground">Open in Sail Scoring</strong> link in the footer.
          Anyone viewing the results page can click it to open the series directly in the app
          — competitors, races, finishes, and standings are all imported automatically as a new
          series. If you already have a series with that name in your workspace, the import gets a{' '}
          <code className="text-foreground text-sm">(2)</code> suffix so the two are easy to
          tell apart.
        </p>
        <p>
          If you’re signed in and belong to more than one workspace — for example a personal
          workspace and a shared panel — the confirmation dialog includes a{' '}
          <strong className="text-foreground">Workspace</strong> picker so you can choose where
          the series lands. It defaults to the workspace you’re currently in.
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

      <Section id="sending-feedback" title="Sending feedback">
        <p>
          Found a bug, have a question, or want to suggest an improvement? Open the
          user menu in the top-right of the header (your email address) and click{' '}
          <strong className="text-foreground">Send feedback</strong>. Type your
          message and hit <strong className="text-foreground">Send</strong>.
        </p>
        <p>
          The form automatically attaches the page you were on, your signed-in
          email address, and the browser you’re using — they’re shown
          in the dialog before you submit. To keep abuse in check, each account
          can send up to five messages per hour.
        </p>
      </Section>

      <Section id="keyboard-shortcuts" title="Keyboard shortcuts">
        <p>
          Press <strong className="text-foreground">?</strong> anywhere in the app (outside a text
          input) to open the keyboard shortcuts reference. Press{' '}
          <strong className="text-foreground">Shift+D</strong> to toggle dark mode.
        </p>
      </Section>
    </div>
  );
}
