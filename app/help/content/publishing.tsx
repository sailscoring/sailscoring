'use client';

import { useFeatures } from '@/components/features-provider';

import { HelpShot, Section } from '../ui';

/** The “Publishing” chapter — rendered by the /help/publishing route and,
 *  loaded on demand, by the help panel. */
export default function Publishing() {
  const { has } = useFeatures();
  return (
    <>
      <Section id="publishing-results" title="Publishing results">
        <HelpShot
          src="/help/shots/publish-dialog.webp"
          alt="The Publish dialog: choose fleets, set each URL, and publish."
          caption="The Publish dialog: choose fleets, set each URL, and publish."
        />
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
          Published pages form a tree: every series publishes as{' '}
          <strong className="text-foreground">Season + Folder</strong> (e.g.{' '}
          <code className="text-foreground text-sm">…/2026/spring-regatta/standings</code>,
          the season derived from the series date), each season and folder gets its own index
          page, and your workspace has a public index at{' '}
          <code className="text-foreground text-sm">app.sailscoring.ie/p/hyc</code> listing
          every event by season — each season collapsible, the current one open, with each
          event’s results tables linked right on its row. All of it updates automatically as
          you publish. Every public page carries the same navigation menus showing where the
          visitor is — season, event, results page — so getting from <em>Class 1</em> to{' '}
          <em>Class 2</em>, or from this season’s series to last season’s, is one link away.
          The workspace index adds filter dropdowns — season, category, event — that narrow
          the listing to the table a visitor is after instead of scrolling. Manage seasons
          (and pick the current one) from the{' '}
          <strong className="text-foreground">Seasons</strong> card on Workspace settings.
        </p>
        <p>
          <strong className="text-foreground">Sorting a published table:</strong> visitors can
          click any column heading on a published results table to sort by it — by nationality,
          by sail number, by a single race’s score. Clicking again reverses the sort, and a
          third click restores the ranking order. This is view-only, in the visitor’s
          browser: the page itself, and anything printed or saved as PDF from it, stays in rank
          order.
        </p>
        <p>
          <strong className="text-foreground">Races that have not been sailed:</strong> a race
          with no finishers and no start time is a slot in the schedule, not a result, and never
          becomes a column on a published page — it would otherwise show a DNC against every
          boat, adding up to nothing, which reads as a scoring error for a race that has not
          happened. The race stays on the Races tab, and its column appears the moment it has a
          start time or a single finisher.
        </p>
        <p>
          <strong className="text-foreground">Single-race events:</strong> some events are one
          race — a trophy race, a one-off open. Published as a series, such an event comes out
          as a standings table with a single race column, a total equal to that race’s
          score, and discard columns that mean nothing. On{' '}
          <strong className="text-foreground">Settings → Publishing</strong>, set{' '}
          <strong className="text-foreground">Publish detail</strong> to{' '}
          <strong className="text-foreground">Race results only</strong> and the page becomes
          just the race table: finish times, corrected times and places, with no series summary
          above it. The page is called <em>Results</em> rather than <em>Standings</em>, and a
          new one is published at{' '}
          <code className="text-foreground text-sm">…/2026/lambay-race/results</code>.
        </p>
        <p>
          This is a deliberate choice, never guessed from the number of races — a league in its
          first week has one race and is still a league, so leave the setting alone there. It
          applies to every page the series publishes, including combined pages. If you set it
          on a series that is already published, the pages keep the URLs they announced; only
          what is on them changes.
        </p>
        <p>
          <strong className="text-foreground">Co-publishing several series to one URL:</strong>{' '}
          a folder is shared, so more than one series can publish into the same one —
          handy when an event is scored as separate series, e.g. publishing both{' '}
          <em>Lambay Races Cruisers</em> and <em>Lambay Races One Designs</em> to{' '}
          <code className="text-foreground text-sm">…/2026-lambay-races</code>. Type the existing
          folder when you publish the second series; Sail Scoring asks you to confirm joining the
          existing folder, then the listing page lists every series under it, each with its own
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
          another series. Pages are grouped for the scorer — active series
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
        <Section id="combined-pages" title="Extra pages">
          <HelpShot
            src="/help/shots/combined-pages.webp"
            alt="A combined Overall page carrying every fleet."
            caption="A combined Overall page carrying every fleet."
          />
          <p>
            An extra page publishes alongside the per-fleet ones, made of sections you choose.
            Three common uses: an <strong className="text-foreground">Overall</strong> page
            carrying every fleet’s standings, so a multi-class event has a single link to
            hand out; a single class page covering all the ways that class is scored — say
            one <em>Puppeteer</em> page with its Scratch and HPH fleets — instead of separate
            per-fleet pages; and a{' '}
            <strong className="text-foreground">per-division page</strong>, one table per
            Gold / Silver / Bronze, beside the overall standings.
          </p>
          <p>
            Define extra pages on the series’{' '}
            <strong className="text-foreground">Settings</strong> tab under{' '}
            <strong className="text-foreground">Extra pages</strong>. Each has a name (which
            becomes the page title and its URL segment), a fleet selection —{' '}
            <strong className="text-foreground">All fleets</strong> keeps up with fleets you add
            later, or <strong className="text-foreground">Choose fleets</strong> picks a subset —
            and a detail level: <strong className="text-foreground">Standings only</strong> shows
            each fleet’s summary table without the per-race tables (the usual choice for an
            Overall page), while <strong className="text-foreground">Full per-race detail</strong>{' '}
            keeps everything a standalone fleet page shows.
          </p>
          <p>
            Fleets appear in the order they sit in the{' '}
            <strong className="text-foreground">Fleets</strong> card on the same tab — drag them
            there to change the order on every combined page at once. A full-detail page reads
            standings first: each fleet’s summary table one after another, then each fleet’s race
            results in its own section, headed{' '}
            <em>fleet name — race results</em> and separated by a rule so it’s clear where one
            fleet’s races end and the next begin. Clicking a race column in a summary table jumps
            to that race below.
          </p>
          <p>
            A full-detail page can also{' '}
            <strong className="text-foreground">show only the last N races’ results</strong>. This
            is for pages embedded in a fixed-height frame on a club website, where a long series
            runs past the space and gets cut off — the race tables are what make the page tall.
            The standings always cover the whole series, so only the per-race tables are trimmed;
            the page says which races it is showing, and race columns without a table below stop
            being links.
          </p>
          <HelpShot
            src="/help/shots/per-division-pages.webp"
            alt="A published page with a standings table per division."
            caption="A published page with a standings table per division."
          />
          <p>
            <strong className="text-foreground">One table per division.</strong> Where a class
            races as one fleet but is split into divisions — Gold, Silver and Bronze, or an age
            category — set the page’s{' '}
            <strong className="text-foreground">Sections</strong> to{' '}
            <strong className="text-foreground">One per Division</strong> instead of{' '}
            <strong className="text-foreground">One per fleet</strong>. The page then carries a
            table per division: the same racing and the same scores as the overall standings,
            with each division ranked 1, 2, 3 among its own boats, so a sailor can see where
            they came against their peers as well as against the whole entry. It is the way a
            division prize-giving reads, and it is what a class will ask you for.
          </p>
          <p>
            Divisions come from the <strong className="text-foreground">Division</strong>{' '}
            competitor field (rename it under{' '}
            <strong className="text-foreground">Competitor fields</strong> if your event calls
            it something else — a Category page works the same way). The division with the
            leading boat comes first, and boats tied in the series stay tied in their division.
            Anyone with no division set appears on no table, so the card tells you how many
            that is before you publish. These pages carry standings only: the race results stay
            on the fleet’s own page, since every division sailed the same races.
          </p>
          <p>
            By default every fleet still publishes its own page and the extra pages are
            additions. Untick{' '}
            <strong className="text-foreground">Publish individual per-fleet pages</strong>{' '}
            to publish <em>only</em> the extra pages — the standalone fleet pages are taken
            down on the next publish, and the Publish dialog shows each fleet with a note
            pointing at the page(s) it appears on. A fleet on none of them
            isn’t published at all while the toggle is off. Extra pages
            appear in the Publish dialog, the series listing page, and Preview alongside the
            fleet pages. On a series with sub-series, each sub-series gets its own copy
            (e.g. <code className="text-foreground text-sm">…/winter/overall</code>)
            covering the fleets it scores — an extra page always shows one set of races.
          </p>
        </Section>
      )}
      {has('results-status') && (
        <Section id="results-status" title="Provisional and final results">
          <HelpShot
            src="/help/shots/results-status-final.webp"
            alt="The Mark as final checklist."
            caption="The Mark as final checklist."
          />
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
            finisher</strong> under the race title). Set your SIs’ limit under{' '}
            <strong className="text-foreground">Settings ▸ Protest time limit</strong> — a number
            of minutes measured from each race’s last finisher, or from the last finisher
            of the whole race day — and the <strong className="text-foreground">Races</strong>{' '}
            tab shows a live line on race day: when the last boat finished, and when the protest
            time limit ends.
          </p>
        </Section>
      )}
      {has('page-notes') && (
        <Section id="page-notes" title="A note on a published page">
          <HelpShot
            src="/help/shots/page-notes.webp"
            alt="The preview dialog with a note strip above the page: the note text, an Edit button and a Remove button."
            caption="The note strip in Preview: what this page will say, above the page it will say it on."
          />
          <p>
            Sometimes a results page has to say something the figures cannot say for themselves.
            Tuesday’s fleet assignment was worked out from Q1 as posted, before a retirement was
            applied to it, so re-deriving the split from today’s standings gives a different
            answer — and that is correct, because the sailors raced to the posted assignment.
            Q4 was abandoned and resailed. The finish order was corrected at 16:40. A reconstructed
            archive differs from the club’s originals in a stated way, and here is the link to them.
          </p>
          <p>
            A <strong className="text-foreground">note</strong> is free text that prints above the
            results, styled as an editorial aside rather than as data. There are two kinds, and
            both can be on a page at once:
          </p>
          <ul className="ml-5 list-disc space-y-1">
            <li>
              A <strong className="text-foreground">note on this page</strong> — it appears on that
              page and nowhere else. A note about the fleet split has no business on the entry list.
            </li>
            <li>
              A <strong className="text-foreground">note on every page</strong> — the standing
              sentence for the whole publication, printed above the page’s own note.
            </li>
          </ul>
          <p>
            Write one in <strong className="text-foreground">Preview</strong>, where the page is in
            front of you: pick the page in the dropdown, use{' '}
            <strong className="text-foreground">Add a note</strong> in the strip above it, and the
            preview rebuilds so you can read the note in place before anyone else does. You can
            also write one from the <strong className="text-foreground">Publish</strong> dialog —
            each page’s row has a note button, and a page that already carries one shows it filled,
            with the note itself as the button’s tooltip. That is how a note written three days ago
            gets noticed before it goes out again.
          </p>
          <p>
            Notes are plain text. Blank lines and line breaks start new paragraphs, a bare web
            address becomes a link, and <code>[the originals](https://…)</code> becomes a link with
            your own wording — which is most of the point of a delta note. Nothing else is
            interpreted, so nothing you type can break the page.
          </p>
          <p>
            A note is part of the series, not of the publication: it survives a re-publish without
            being retyped, travels in the saved <code>.sailscoring</code> file and in the published
            data file, and — because saving one is an edit like any other — the publish dialog
            immediately tells you there are edits to publish. Clear a note by emptying it and
            saving. Renaming a fleet leaves its note behind, because the page it was written for no
            longer exists; the publish dialog lists any such note once, so you can remove it.
          </p>
        </Section>
      )}
      {has('entry-list') && (
        <Section id="competitor-list" title="Publishing the competitor list">
          <p>
            The <strong className="text-foreground">Entries</strong> page publishes your entry
            list — who is coming, and nothing derived from racing. It appears as one more row in
            the Publish dialog, alongside the fleet pages, and lands at{' '}
            <code>/entries</code> under the event folder.
          </p>
          <p>
            It is the one page you can publish before a single race has been sailed, which is the
            window an event most wants one: competitors and their families are checking whether an
            entry has been accepted long before there is a result to read. Publish it as soon as
            the roster settles, and republish it as entries come and go.
          </p>
          <p>
            Because of that, <strong className="text-foreground">Publish</strong> is on the{' '}
            <strong className="text-foreground">Competitors</strong> tab as well as on Standings —
            it is the page the entry list is made of, and the one you are on when the entries
            settle. Press <strong className="text-foreground">p</strong> there to open the publish
            dialog.
          </p>
          <p>
            The columns are whichever competitor fields your series has enabled — nationality,
            club, tally number, division, and the rest — and any field no entry fills is left out
            rather than published as an empty column.
          </p>
          <HelpShot
            src="/help/shots/published-competitor-list.webp"
            alt="A published entry list with a table per class, each carrying an IRC and an ECHO rating column."
            caption="A league whose classes are scored under IRC and ECHO at once: a table per class, a rating column per fleet."
          />
          <p>
            Where a class is scored under more than one system at once — an IRC fleet and a club
            handicap fleet holding much the same boats — the page is{' '}
            <strong className="text-foreground">tabled by class</strong>, and each table carries a
            rating column per fleet the class is scored under, headed by whatever tells the fleets
            apart: <em>IRC</em> and <em>ECHO</em>, say. A boat stays on one row, and which fleets
            it is in is said by which ratings it carries. A boat not entered in a column&rsquo;s
            fleet is dashed; one that is entered but whose certificate has not arrived is left
            blank, so you can see at a glance who you are still chasing. Each table leads with the
            boats entered under every one of its fleets.
          </p>
          <p>
            Sail Scoring works the classes out from the fleets themselves, so nothing needs setting
            up — it groups fleets that hold much the same boats and whose names share a word, and
            it trusts the grouping your spreadsheet import recorded where there is one. On a series
            where that finds nothing — a championship dealing Yellow and Blue fleets, a one-design
            regatta — the page stays a single table with a Fleet column, grouped by fleet in
            display order.
          </p>
        </Section>
      )}
      {has('entry-list') && (
        <Section id="starters-checklist" title="The starters checklist">
          <HelpShot
            src="/help/shots/starters-checklist.webp"
            alt="A printed starters checklist: class tables of large sail numbers, each row with a box to tick and blank space to write in."
            caption="The starters checklist as it prints: one table per start, sail numbers set large, a box beside each and room to write."
          />
          <p>
            The published competitor list also prints as a{' '}
            <strong className="text-foreground">starters checklist</strong> — the sheet the
            recorder takes onto the committee boat to tick off each boat as it arrives in the
            starting area. Open the Entries page and choose{' '}
            <strong className="text-foreground">Print starters checklist</strong> in the footer,
            beside Save as PDF. Anyone with the link can print it; the race team needs no account.
          </p>
          <p>
            Each row is the sail number, a box to tick beside it, the boat name if your series
            records one, and blank ruled space to write in. There is one table per <em>start</em>,
            not per fleet: a class scored under IRC and ECHO at once is one table, with every boat
            on it once. The starts come from your default start sequence (Settings → Fleets) when
            you have set one up; otherwise fleets that share a boat are taken to share a start.
            Sail numbers are set large for a moving boat, and the tables run in columns.
          </p>
          <p>
            It is a working sheet, so most of it is space to write on. A boat that turns up under
            a number other than the one it entered under gets that number written on its row —
            which is what makes the results add up afterwards. Each start’s table ends in{' '}
            <strong className="text-foreground">three spare rows</strong>, ruled and boxed like the
            rest, for a boat that entered too late to be printed on the sheet or that you are told
            about on the water. The sheet then ends in a ruled{' '}
            <strong className="text-foreground">Notes</strong> block for anything that belongs to
            the day rather than to one boat.
          </p>
          <p>
            That space is paid for by what the sheet leaves out. Printed as a checklist it drops
            the club logos, the page title and the series heading — about a sixth of the page —
            and heads itself with a single line: the series name, then{' '}
            <strong className="text-foreground">Date</strong>,{' '}
            <strong className="text-foreground">Race(s)</strong> and{' '}
            <strong className="text-foreground">Recorder</strong> left blank to fill in. The entry
            list cannot know which race day you are printing it for, and a sheet that gets filed
            and read back when the results are scored needs to say.
          </p>
          <p>
            To print one without publishing, open{' '}
            <strong className="text-foreground">Preview</strong> on the Standings or Competitors
            tab, pick Entries, and use the same button there. On a split-fleet championship the
            sheet lists the latest round’s fleets, so republish after the morning’s assignment
            before printing.
          </p>
        </Section>
      )}
      {has('prizes') && (
        <Section id="prizes" title="Prizes">
          <p>
            The <strong className="text-foreground">Prizes</strong> tab turns the Notice of Race’s
            prize list into named awards allocated live from the series standings. A prize is a
            name (“Gold Fleet 1st, 2nd, 3rd”), the number of places it covers, and{' '}
            <strong className="text-foreground">conditions</strong> on who is eligible — a
            subdivision value (a Division or age category recorded on the competitors), a fleet, a
            maximum series rank for “Overall” podiums, helm gender (“Lady 1st, 2nd, 3rd”),
            nationality (“first IRL boat”), or club. A club condition reads membership, so a
            home-club trophy still finds a boat that lists a visiting club as well. The condition
            picker offers the fields your competitors actually carry values for. The top-ranked eligible competitors are the
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
      {has('logo-library') && (
      <Section id="logo-library" title="The logo library">
        <HelpShot
          src="/help/shots/logo-library.webp"
          alt="Picking a logo from the built-in collection."
          caption="Picking a logo from the built-in collection."
        />
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
    </>
  );
}
