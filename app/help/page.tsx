import type { Metadata } from 'next';
import Link from 'next/link';

import { getEffectiveFeatures } from '@/lib/auth/require-workspace';

import { HashRedirect } from './hash-redirect';
import { HELP_GROUPS } from './sections';
import { HelpShot, Section } from './shell';

export const metadata: Metadata = {
  title: 'Help — Sail Scoring',
};

// Per-user dynamic (#155): the index only lists an experimental feature's
// sections for viewers whose workspace has it enabled. Signed-out /
// no-feature viewers (getEffectiveFeatures returns []) see only the
// ungated entries.
export const dynamic = 'force-dynamic';

export default async function HelpPage() {
  const features = await getEffectiveFeatures();
  return (
    <div className="max-w-2xl mx-auto space-y-10">
      <HashRedirect />
      <div>
        <h1 className="text-2xl font-semibold">Help</h1>
        <p className="mt-2 text-muted-foreground">
          A guide to scoring a series with Sail Scoring, in short chapters —
          start at the top, or jump straight to a section.
        </p>
      </div>

      <nav className="text-sm space-y-6">
        {HELP_GROUPS.map((group) => ({
          ...group,
          sections: group.sections.filter((s) => !s.feature || features.includes(s.feature)),
        }))
          // A chapter whose every section is gated off for this viewer is
          // omitted entirely (its page 404s too — see HelpShell).
          .filter((group) => group.sections.length > 0)
          .map((group) => (
            <div key={group.slug} className="space-y-1">
              <p className="font-medium text-foreground">
                <Link href={`/help/${group.slug}`} className="hover:underline">
                  {group.label}
                </Link>
              </p>
              {group.sections.map((s) => (
                <div key={s.id}>
                  <Link
                    href={`/help/${group.slug}#${s.id}`}
                    className="text-muted-foreground hover:text-foreground hover:underline"
                  >
                    {s.title}
                  </Link>
                </div>
              ))}
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
        <HelpShot
          src="/help/shots/feature-toggles.webp"
          alt="The Features card in Workspace settings: optional features switch on and off for the whole workspace."
          caption="The Features card in Workspace settings: optional features switch on and off for the whole workspace."
        />
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
          <a href="/help/collaboration#collaboration" className="underline">Working with co-scorers</a>).
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
          To copy a series within its own workspace — say, to experiment with scoring settings
          or use last season&rsquo;s series as a template — choose{' '}
          <strong className="text-foreground">Duplicate…</strong> from the same menu. The
          duplicate keeps its category and everything else except publishing state and FTP paths.
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
    </div>
  );
}
