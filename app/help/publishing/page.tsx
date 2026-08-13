import type { Metadata } from 'next';

import { getEffectiveFeatures } from '@/lib/auth/require-workspace';
import type { FeatureKey } from '@/lib/features';

import { HelpShell } from '../shell';
import { HelpShot, Section } from '../ui';

export const metadata: Metadata = {
  title: 'Publishing — Help — Sail Scoring',
};

// Per-user dynamic (#155): gated sections only render for viewers whose
// workspace has the feature enabled.
export const dynamic = 'force-dynamic';

export default async function Page() {
  const features = await getEffectiveFeatures();
  const has = (key: FeatureKey) => features.includes(key);
  return (
    <HelpShell slug="publishing" features={features}>
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
    </HelpShell>
  );
}
