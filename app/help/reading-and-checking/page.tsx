import type { Metadata } from 'next';

import { getEffectiveFeatures } from '@/lib/auth/require-workspace';
import type { FeatureKey } from '@/lib/features';

import { HelpShell, Section } from '../shell';

export const metadata: Metadata = {
  title: 'Reading and checking — Help — Sail Scoring',
};

// Per-user dynamic (#155): gated sections only render for viewers whose
// workspace has the feature enabled.
export const dynamic = 'force-dynamic';

export default async function Page() {
  const features = await getEffectiveFeatures();
  const has = (key: FeatureKey) => features.includes(key);
  return (
    <HelpShell slug="reading-and-checking" features={features}>
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
              <a href="/help/publishing#publishing-results" className="underline">Publishing results via FTP</a>.
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
    </HelpShell>
  );
}
