'use client';

import { useFeatures } from '@/components/features-provider';

import { HelpShot, Section } from '../ui';

/** The “Running a series” chapter — rendered by the /help/running-a-series route and,
 *  loaded on demand, by the help panel. */
export default function RunningASeries() {
  const { has } = useFeatures();
  return (
    <>
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
        <HelpShot
          src="/help/shots/archive-trash.webp"
          alt="Archived series group by year at the foot of the list; deleted series wait in the Trash for 30 days."
          caption="Archived series group by year at the foot of the list; deleted series wait in the Trash for 30 days."
        />
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
        <HelpShot
          src="/help/shots/competitor-list.webp"
          alt="The Competitors tab of a keelboat series, with the class, club, and nationality fields enabled."
          caption="The Competitors tab of a keelboat series, with the class, club, and nationality fields enabled."
        />
        <p>
          On the <strong className="text-foreground">Competitors</strong> tab, add every boat that
          may start a race in the series — even those you expect to DNS every race. This ensures
          result codes are available for them.
        </p>
        <p>
          Each competitor requires a <strong className="text-foreground">sail number</strong> and a
          primary <strong className="text-foreground">name</strong> (labelled Helm, Owner,
          Competitor, or Entrant per the series’ primary-identifier setting). Sail numbers
          must be unique within the series. Other fields — boat name, class, owner, helm, crew,
          club, gender, age — are optional, and which of them appear in the form and tables is
          controlled by the <strong className="text-foreground">Competitor fields</strong> card on
          the <strong className="text-foreground">Settings</strong> tab. Enable{' '}
          <em>Class</em> for PY fleets with mixed classes (Laser, Firefly, Mirror) to show the boat
          class alongside each entry. Enable{' '}
          <em>Crew</em> for classes that sail with crew.
        </p>
        {has('multi-person-fields') && (
          <>
            <p>
              Tick <em>Allow multiple</em> beside a person field in the{' '}
              <strong className="text-foreground">Competitor fields</strong> card and it takes any
              number of names: <em>Add name</em> (on the primary), <em>Add owner</em>,{' '}
              <em>Add helm</em>, or <em>Add crew</em> in the competitor dialog adds a row per
              person, so co-owned boats (“J. & M. Murphy” syndicates), offshore
              co-helms, and full keelboat crews are all first-class. A single owner-and-crew
              pairing keeps the classic one-line <em>Helm / Crew</em> in exported results; any
              more people stack one name per line. One-line contexts such as finish entry join
              co-owners with an ampersand. The column header follows the setting, so a series
              that allows several owners is headed <em>Owners</em> rather than <em>Owner</em>,
              in the competitor list, the standings, and published results. Untick it and the
              field goes back to a single value —
              entries that already carry several names keep them and still show every row.
            </p>
            <p>
              <strong className="text-foreground">Gender</strong> and{' '}
              <strong className="text-foreground">age</strong> describe the primary person, and
              only when the primary is a single individual — add a second name and the dialog
              clears both (a syndicate entry has no single age). Nationality is different:
              national letters attach to the boat, so it stays whatever the entry declares.
            </p>
          </>
        )}
        <p>
          Enable <em>Bow number</em> when boats carry a bow number that can
          differ from the sail number they’re registered under — a competitor
          sailing a borrowed hull, say, whose bow number the finish recorders
          write down instead of the registered sail number. It’s an optional
          free-text field; when set, finish entry will also match on it (see{' '}
          <em>Entering results</em> below).
        </p>
        <HelpShot
          src="/help/shots/alternative-sail-numbers.webp"
          alt="The competitor dialog with two alternative sail numbers listed against an entry."
          caption="Alternative sail numbers listed against an entry — the numbers this boat may show, beyond the one it entered under."
        />
        <p>
          Enable <em>Alternative sail numbers</em> when boats may race under a
          number other than the one they entered with — a replacement sail after
          damage, a borrowed one, or a charter taken on mid-event. List them
          against the entry separated by commas (<em>IRL 99, 7</em>). Finish
          entry matches any of them, and a result entered under one is tagged
          with the number used, so the series records which sail the boat
          actually raced under. Standings and published results always show the
          registered sail number — the alternatives are there to be recognised,
          not displayed.
        </p>
        <p>
          Enable <em>Entry number</em> to record the number the organising
          authority gave an entry on its own entry list — the one on the entry
          form and the registration desk’s paperwork, which large championships
          use to refer to a boat before anyone has seen its sail. It’s free text,
          it sits in its own column, and the competitor filter matches it, so an
          entry list is enough to find the boat. Leave it unset where it would
          simply repeat the bow or sail number.
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
          Competitors are listed by sail number (see{' '}
          <em>Sorting the competitor list</em> below to order them another way).
          You can edit or delete a competitor at any time, though deleting one
          after races have been entered will also remove their finishes.
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
          fleet drops it from that fleet’s standings and entry counts — its recorded
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
          sail-number change between spreadsheet imports leaves behind. Those open in a review dialog
          with a <strong className="text-foreground">Merge</strong> button per group. Merging
          keeps a single entry holding all the recorded results and the newest details — including
          the newest sail number. When two of the entries both hold a finish in the same race the
          group is flagged instead of merged, since both results can’t stand; fix the finish
          sheet, then merge.
        </p>
      </Section>
      <Section id="sorting-the-competitor-list" title="Sorting the competitor list">
        <HelpShot
          src="/help/shots/competitor-sorting.webp"
          alt="The competitors table sorted by club, then by sail number, each heading showing its arrow and its place in the sort."
          caption="Sorted by club first, then sail number — the small numbers beside each arrow show which column applies first."
        />
        <p>
          The list arrives ordered by sail number, counted as a number rather
          than as text — so <em>7</em> comes before <em>69</em> and{' '}
          <em>217236</em>, however many digits each carries. Entries with
          national letters group by country first.
        </p>
        <p>
          Click any column heading to sort by it instead. Click the same
          heading again to reverse the order, and a third time to return to the
          default. An arrow on the heading shows which way it is sorted.
        </p>
        <p>
          Hold <strong className="text-foreground">Shift</strong> while clicking
          to add a column to the sort rather than replacing it — so you can list
          the entries by nationality, then by gender within each nationality,
          then by sail number within that. A small number beside each arrow
          shows the order the columns apply in. Up to three columns can be
          stacked; adding a fourth drops the one you chose first. A plain click
          on any heading starts again with that column alone.
        </p>
        <p>
          Sorting only changes how the list is shown — it changes nothing about
          the entries, affects no results, and is not saved. Leaving the tab and
          coming back gives you the default sail-number order again. It also
          works alongside the filter box: filter to a club, then sort what’s
          left.
        </p>
      </Section>
      <Section id="fleets" title="Fleets">
        <HelpShot
          src="/help/shots/fleets.webp"
          alt="The Fleets card open for editing: each fleet with its own scoring system."
          caption="The Fleets card open for editing: each fleet with its own scoring system."
        />
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
        <HelpShot
          src="/help/shots/start-sequences.webp"
          alt="Three class starts at five-minute intervals in the default start sequence editor."
          caption="Three class starts at five-minute intervals in the default start sequence editor."
        />
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
        <HelpShot
          src="/help/shots/race-starts.webp"
          alt="The Race starts editor names the fleets in a race — with gun times, or without for scratch racing."
          caption="The Race starts editor names the fleets in a race — with gun times, or without for scratch racing."
        />
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
          The signal is the race’s starts. A boat is in the race when one
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
      <Section id="adding-races" title="Adding races">
        <HelpShot
          src="/help/shots/add-races-bulk.webp"
          alt="Add multiple races previews every generated date before anything is created."
          caption="Add multiple races previews every generated date before anything is created."
        />
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
      {has('race-management-metadata') && (
        <Section id="race-management-metadata" title="Race conditions and the management team">
          <HelpShot
            src="/help/shots/race-management.webp"
            alt="The race record: wind range and direction, course notes, and the management team."
            caption="The race record: wind range and direction, course notes, and the management team."
          />
          <p>
            A race is more than its finishing order. What it was sailed in, and who ran it, belong
            on the record too — and in the case of wind, they are a scoring input in waiting. Open
            a race and click the record line in its header (or{' '}
            <strong className="text-foreground">Race record…</strong> from its row on the{' '}
            <strong className="text-foreground">Races</strong> tab, or press{' '}
            <kbd className="px-1 border rounded text-xs">r</kbd>).
          </p>
          <p>
            <strong className="text-foreground">Wind</strong> is recorded as a range — a minimum
            and a maximum in knots — plus a direction from the sixteen points of the compass. A
            range rather than one figure because that is what a race officer stipulates, and
            because handicap systems that select a rating from the conditions use the average of
            the two. Record just one of the two if that is all you have. The{' '}
            <strong className="text-foreground">Course and notes</strong> field is free text: the
            course sailed, the tide, or anything else worth keeping.
          </p>
          <p>
            The <strong className="text-foreground">race management team</strong> is a list of
            names, each with a role. The roles are World Sailing’s, from its Race Management
            Manual, rather than club usage — so what a club calls the{' '}
            <strong className="text-foreground">OOD</strong> or Officer of the Day is a{' '}
            <strong className="text-foreground">Race Officer</strong> here, and the person
            recording finishes is a <strong className="text-foreground">Recorder</strong>. One
            fixed list keeps two names for the same job from both appearing in your results.
          </p>
          <p>
            There are two places to record a team, and they are kept separate on purpose.{' '}
            <strong className="text-foreground">Series Settings</strong> holds the{' '}
            <em>standing</em> team for the event — what a regatta with the same people all week
            wants. Each race holds its <em>own</em> team — what a club series with a rotating duty
            wants. Neither one inherits from or overrides the other: fill in both and both appear.
          </p>
          <p>
            <strong className="text-foreground">Officials are not published unless you say so.</strong>{' '}
            These are the names of people who are not competitors, so the{' '}
            <strong className="text-foreground">Publish the race management team</strong> switch on
            Series Settings is off by default. While it is off, no team — the standing one or any
            race’s — appears on a published page or in the data export attached to it. Conditions
            are always published; they describe the racing rather than a person.
          </p>
        </Section>
      )}
      {has('sub-series') && (
        <Section id="sub-series" title="Sub-series">
          <HelpShot
            src="/help/shots/sub-series.webp"
            alt="A season kept in one series: Overall, Spring, and Summer blocks over the same races."
            caption="A season kept in one series: Overall, Spring, and Summer blocks over the same races."
          />
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
      {has('follow-on-series') && (
      <Section id="creating-a-follow-on-series" title="Creating a follow-on series">
        <HelpShot
          src="/help/shots/follow-on-series.webp"
          alt="Creating a follow-on series: pick the name and start date; competitors and handicaps carry over."
          caption="Creating a follow-on series: pick the name and start date; competitors and handicaps carry over."
        />
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
      {has('split-fleets') && (
        <Section id="split-fleets" title="Split-fleet championships">
          <HelpShot
            src="/help/shots/split-fleets.webp"
            alt="The Split Fleets tab of a championship: format, qualifying and final rounds, and the tiered standings."
            caption="The Split Fleets tab of a championship: format, qualifying and final rounds, and the tiered standings."
          />
          <p>
            Big one-design championships split the entry into{' '}
            <strong className="text-foreground">qualifying fleets</strong> (Yellow, Blue, …) that
            are reassigned by series rank after each day of racing, then into{' '}
            <strong className="text-foreground">final fleets</strong> (Gold, Silver, …) for the
            closing races — the format behind ILCA and Optimist worlds and nationals. Choose the
            format in the series setup wizard, or later from the{' '}
            <strong className="text-foreground">Split-fleet championship</strong> card in Settings;
            the <strong className="text-foreground">Split Fleets</strong> tab then appears and
            everything about the event runs from it.
          </p>
          <p>
            <strong className="text-foreground">Round 1</strong> makes the initial assignment —
            normally from the seeding committee’s ranking, or by sail number — with an
            editable preview, so a hand-move is a click, not a spreadsheet edit. Each following
            morning, <strong className="text-foreground">Assign Round N</strong> reassigns from
            the ranking over the races every fleet has completed, in the standard rank pattern
            (down the fleet list and back). The assignment is frozen when you commit it: a protest
            decided that evening re-scores the standings but never re-deals fleets already racing.
          </p>
          <p>
            A qualifying race <strong className="text-foreground">counts only once every fleet
            has completed it</strong> — until then its column is greyed in the standings, matching
            the abandon-and-cancel rule in championship sailing instructions. The fleets start in
            sequence and finish onto <strong className="text-foreground">one combined sheet</strong>:
            enter it exactly as it comes off the water, interleaved, and each boat scores her
            place within her own fleet. If one fleet’s race is abandoned, abandon just that
            fleet’s start from the race row — the rest of the sheet stands — and add its{' '}
            <strong className="text-foreground">catch-up race</strong> (its own sheet, usually
            sailed first the next day) from the same row.
          </p>
          <p>
            <strong className="text-foreground">End qualifying → split fleets</strong> deals the
            final fleets from the qualifying ranking — adjust the top-fleet size if the SIs fix
            one, and the dialog flags rank ties sitting on a boundary. Final fleets race
            independently (they need not sail the same number of races). If the event carries a{' '}
            <strong className="text-foreground">medal race</strong>, select the medal fleet when
            racing closes: the top boats sail it (points doubled, never discardable) while the rest
            of the top fleet sail the companion last race, scored from just below the medal group.
            A redress decision that promotes a boat across the split is the{' '}
            <strong className="text-foreground">Promote (redress)</strong> action on the split
            round.
          </p>
          <p>
            Set the format up in the series setup wizard (or later, from the{' '}
            <strong className="text-foreground">Split-fleet championship</strong> card in
            Settings). Enabling it ends setup — the fleets are created by the assignment
            ceremonies and the scoring rules move to the tab’s{' '}
            <strong className="text-foreground">Format</strong> section, which holds the whole
            configuration from then on. Start from a class format — ILCA, IODA, and the
            two-series and carried-position models — which fills every setting; then read{' '}
            <strong className="text-foreground">How this configuration translates to sailing
            instructions</strong>, which restates your settings as SI prose, against the scoring
            section of the sailing instructions you were given. Where a sentence disagrees,
            change the setting.
          </p>
          <p>
            Three ways of carrying qualifying results into the final series are supported:{' '}
            <strong className="text-foreground">one continuous series</strong> (ILCA, Optimist —
            every race totals together), <strong className="text-foreground">two series added
            together</strong> (each with its own discards), and{' '}
            <strong className="text-foreground">the qualifying position carried forward</strong>{' '}
            as one score that can never be discarded, replacing the qualifying race scores (470,
            Topper). The standings show a carried position in a <strong className="text-foreground">QS</strong> column.
          </p>
          <p>
            The published output is a single{' '}
            <strong className="text-foreground">championship standings</strong> page — combined
            with a provisional cut line during qualifying, tiered Gold/Silver tables after the
            split — plus a rolling <strong className="text-foreground">fleet assignments</strong>{' '}
            page, newest round first, so competitors always know which start they’re in.
            Preview, publish, and <strong className="text-foreground">Mark as final</strong> all
            live on the Split Fleets tab (the regular Standings tab is hidden for these series).
          </p>
        </Section>
      )}
      {has('world-sailing-id') && (
      <Section id="world-sailing-id" title="World Sailing Sailor IDs and seeding">
        <HelpShot
          src="/help/shots/world-sailing-id.webp"
          alt="A competitor's World Sailing ID, recorded for the primary sailor."
          caption="A competitor's World Sailing ID, recorded for the primary sailor."
        />
        <p>
          A <strong className="text-foreground">World Sailing Sailor ID</strong> is the
          free, unique identifier tied to a sailor’s World Sailing profile —{' '}
          <code className="font-mono text-xs">IRLMM1</code>, a nation code, initials, and
          a number. Most international notices of race require one to enter. Switch on the{' '}
          <strong className="text-foreground">World Sailing ID</strong> field in{' '}
          <strong className="text-foreground">Competitor fields</strong> on the series
          Settings tab, and a spreadsheet import picks the column up automatically —
          “World Sailing ID”, “Sailor ID”, or Sailwave’s
          “HelmID”. Published results show the ID as a link to the
          sailor’s World Sailing biography.
        </p>
        <p>
          The ID belongs to a person, and Sail Scoring records it for the{' '}
          <em>primary sailor</em> on each entry. There is nowhere to put a crew’s ID.
        </p>
        <h3 className="text-foreground font-medium mt-4">Seeding ranks</h3>
        <p>
          Championships that split into qualifying fleets assign the first day’s
          fleets from a ranking the organising authority supplies — a World Sailing
          ranking table for an Olympic class, or a class association’s own list. That
          ranking lands in Sail Scoring as a{' '}
          <strong className="text-foreground">Seeding rank</strong> column on the entry
          list you import: add the column to your entry spreadsheet, import it again,
          and the ranks attach to the competitors already there. Headers reading
          “Seed”, “Seeding” or “Rank” are picked up automatically, and any column can
          be mapped by hand.
        </p>
        <p>
          Write the rank the ranking states — a global rank of 3, 17 or 240, not
          renumbered from one. Only the order matters to the{' '}
          <strong className="text-foreground">Split Fleets</strong> initial assignment,
          and keeping the published numbers lets you check the entry list against the
          document it came from. Sailors the ranking doesn’t cover are left with no
          rank and sort below those it does; the assignment dialog lets you choose
          whether that tail goes in sail-number order or spread by nation.
        </p>
        <h3 className="text-foreground font-medium mt-4">Checking the IDs</h3>
        <p>
          <strong className="text-foreground">Check Sailor IDs</strong> looks every ID up
          in World Sailing’s own datafeed and reports each one as valid, unknown to
          World Sailing, not in the ID format at all, or a mismatch — the ID resolves, but
          to a different name or nation than you have. A mismatch is what catches two
          digits transposed on an entry form.
        </p>
        <p>
          Nothing is corrected for you: World Sailing’s record can be years out of
          date and your entry list is what the event runs on. The one exception is a
          nationality you don’t hold at all, which the dialog offers to fill in.
        </p>
      </Section>
      )}
    </>
  );
}
