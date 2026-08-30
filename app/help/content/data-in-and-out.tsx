'use client';

import { useFeatures } from '@/components/features-provider';

import { HelpShot, Section } from '../ui';

/** The “Data in and out” chapter — rendered by the /help/data-in-and-out route and,
 *  loaded on demand, by the help panel. */
export default function DataInAndOut() {
  const { has } = useFeatures();
  return (
    <>
      <Section id="importing-competitors" title="Importing competitors from a spreadsheet">
        <HelpShot
          src="/help/shots/fleet-planning-import.webp"
          alt="The Fleets step: the fleets an entry list implies, before the columns are mapped."
          caption="The Fleets step: the fleets an entry list implies, before the columns are mapped."
        />
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
          The import has two steps. <strong className="text-foreground">Fleets</strong> comes
          first — it decides what the import creates — and then{' '}
          <strong className="text-foreground">map columns</strong> handles the rest of the
          spreadsheet.
        </p>
        <HelpShot
          src="/help/shots/competitor-import.webp"
          alt="Column mapping, with a sample of what each column holds."
          caption="Column mapping, with a sample of what each column holds."
        />
        <p>
          The mapping step shows each column in the file alongside a sample of its values. Use the
          dropdown next to each column to map it to a competitor field — sail number, helm name,
          boat name, class, crew name, club, gender, age, or a subdivision axis. Columns you
          do not need can be left as <strong className="text-foreground">(ignore)</strong>. Sail
          number is the only required mapping; all other fields are optional. A{' '}
          <em>Division</em> or <em>Category</em> column maps to a
          subdivision axis: it lands on the matching axis if you already have one, or you can pick{' '}
          <strong className="text-foreground">New subdivision axis</strong> to create one from the
          column heading (so a sheet with both a Division and an Age-category column brings in both).
          The grouping and rating columns are not in this dropdown — they belong to the Fleets step,
          and are listed there so you can go back and change them.
        </p>
        {has('multi-person-fields') && (
        <p>
          Fields with <em>Allow multiple</em> ticked (owners, helms, crew, or the primary itself)
          import two ways, and both can be combined. Sheets with one column per person (<em>Owner 1</em>,{' '}
          <em>Owner 2</em>, or <em>Crew 1</em>…<em>Crew 3</em>) map every column to the same
          field; the names are kept in column order. Or several names can share one cell
          separated by semicolons (Sailwave’s{' '}
          <code className="text-foreground text-sm">{'<br>'}</code> convention and line breaks
          also work) — the sample column previews how a cell will split before you import.
          Commas and <em>&</em> are never treated as separators, so surname-first names
          (“MOUSE, Micky”), shared-surname pairs (“Alice & Bob Byrne”), and “J & M
          Murphy” co-owners come through intact as one entry each. Rows that arrive with more
          than one primary name carry no gender or age, whatever those cells say.
        </p>
        )}
        <p>
          A competitor can be assigned to more than one fleet by separating fleet names with a
          pipe character in the grouping column — for example,{' '}
          <code className="text-foreground text-sm">PY|M15</code> enters a Melges 15 in both the
          PY handicap fleet and the M15 scratch fleet. This matches the convention used by
          Sailwave exports.
        </p>
        <p>
          The <strong className="text-foreground">Fleets</strong> step asks two things about the
          file — which column splits the boats into fleets, and which columns hold ratings — and
          shows you the fleets that follow. A column named <em>Fleet</em> is used for grouping
          automatically. If there isn’t one, everybody lands in a single fleet and you are offered
          the columns that could split them: pick <em>Class</em>, or leave it, since single-fleet
          series are perfectly normal.
        </p>
        <p>
          Each fleet’s scoring system comes from the rating columns. If every boat in a group
          carries one rating system (say IRC), one fleet is created and configured for IRC. If the
          group has a mix — IRC for some boats, ECHO for others — it splits into{' '}
          <code className="text-foreground text-sm">CR 0 (IRC)</code> and{' '}
          <code className="text-foreground text-sm">CR 0 (ECHO)</code>, and each boat joins the
          fleet matching its ratings.
        </p>
        <p>
          That is a starting point, not the answer. You can rename any proposed fleet, change who
          is in it (<strong className="text-foreground">All boats</strong> or just the ones with a
          rating), remove it, or add a fleet the spreadsheet says nothing about with{' '}
          <strong className="text-foreground">Also score on</strong> — scratch alongside a handicap
          fleet for line-honours awards, or an IRC fleet when the certificates haven’t arrived yet.
          An added rating fleet takes the whole group, because the entry list can’t say who holds a
          certificate; importing the ratings later from{' '}
          <strong className="text-foreground">Update handicaps</strong> offers to trim it to the
          boats the rating list actually rates.
        </p>
        <p>
          When the grouping column is doing double duty as a class label — a <em>Fleet</em> column
          reading “Cruisers 2” with no separate <em>Class</em> column — the first import into a
          series also proposes mapping it to{' '}
          <strong className="text-foreground">Class</strong>, so the grouping isn’t lost when boats
          are split across rating fleets. It shows up in the mapping step like any other column, so
          you can drop it if the fleet names aren’t classes.
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
          would normally come in as a duplicate. The importer watches for this: when a row’s
          sail number is new to the series, the old number is missing from the spreadsheet, and the boat
          or person matches an existing competitor in the same fleet, it pauses to ask{' '}
          <strong className="text-foreground">Sail number changes?</strong> before importing.
          Accepted rows update the existing competitor under the new number — keeping its
          recorded results — instead of creating a second entry.
        </p>
      </Section>
      {has('rrs-import') && (
      <Section id="rrs-org-push" title="Pushing the competitor list to rrs.org">
        <HelpShot
          src="/help/shots/rrs-push.webp"
          alt="Pushing the entry list to an rrs.org event."
          caption="Pushing the entry list to an rrs.org event."
        />
        <p>
          racingrulesofsailing.org (RRS.org) runs the protest and jury side of many
          events — protest filing, hearing schedules, the online notice board — and
          needs the same competitor list you score. The{' '}
          <strong className="text-foreground">Import</strong> button on the
          Competitors tab can push your list to an rrs.org event: tick{' '}
          <strong className="text-foreground">Import to rrs.org</strong> and paste the
          event’s <strong className="text-foreground">UUID</strong>, found in the
          event details at the top of the rrs.org Event Panel. Sail Scoring remembers
          the UUID for the series, so a re-push after the entry list changes is just a
          couple of clicks.
        </p>
        <p>
          You can push on its own, or combine it with a spreadsheet import in one step
          by ticking both options. Combining is how contact details reach rrs.org: Sail
          Scoring deliberately does not store emails, phone numbers, or MNA membership
          numbers, but when your spreadsheet has those columns the importer relays them to
          rrs.org alongside the import and then discards them. Phone numbers are
          converted to international format (e.g.{' '}
          <code className="text-foreground text-sm">+353861234567</code>) using each
          competitor’s nationality; numbers that can’t be converted are sent
          blank and listed in the summary. A push without a spreadsheet sends those fields
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
      <Section id="saving-and-sharing" title="Saving and sharing a series">
        <HelpShot
          src="/help/shots/series-actions.webp"
          alt="Save to File, Update from File, Duplicate, and Copy to workspace all live on the series actions menu."
          caption="Save to File, Update from File, Duplicate, and Copy to workspace all live on the series actions menu."
        />
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
      {has('sailwave-import') && (
        <Section id="sailwave-import" title="Importing from Sailwave">
          <HelpShot
            src="/help/shots/sailwave-import.webp"
            alt="The Sailwave import wizard previewing a .blw file"
            caption="The Sailwave import wizard previews the detected fleets, competitors, and races before anything is created."
          />
          <>
            <p>
              To bring a season across from Sailwave, click{' '}
              <strong className="text-foreground">Import Series</strong> on the home screen,
              choose <strong className="text-foreground">Sailwave file</strong>, and
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
        </Section>
      )}
      <Section id="json-export" title="JSON data export and Open in Sail Scoring">
        <HelpShot
          src="/help/shots/open-in-sailscoring.webp"
          alt="Every published page footer carries an Open in Sail Scoring link."
          caption="Every published page footer carries an Open in Sail Scoring link."
        />
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
          Publishing also puts the underlying data itself beside the pages, as a{' '}
          <code className="text-foreground text-sm">.sailscoring.json</code> file linked from
          every page footer — a machine-readable snapshot of exactly the results shown, for
          clubs or third parties who want to consume the data programmatically. The suffix
          marks it as the public, sanitized view: it contains only the published results —
          hidden competitor columns, unresolved finish entries, and scorer-private information
          (file history, FTP credentials, and publishing tokens) are never included. Pages you
          download or push over FTP without publishing embed the same snapshot in the page
          source instead, so they stay self-contained.
        </p>
        <p>
          To disable the data export for a series, open the{' '}
          <strong className="text-foreground">Settings</strong> tab and uncheck{' '}
          <strong className="text-foreground">Include data export in published results</strong>{' '}
          in the <strong className="text-foreground">Publishing</strong> card. The data file
          comes down with the next publish and the footer reverts to a plain link with no
          Open in Sail Scoring option.
        </p>
      </Section>
    </>
  );
}
