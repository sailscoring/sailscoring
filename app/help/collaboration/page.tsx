import type { Metadata } from 'next';

import { getEffectiveFeatures } from '@/lib/auth/require-workspace';
import type { FeatureKey } from '@/lib/features';

import { HelpShell, Section } from '../shell';

export const metadata: Metadata = {
  title: 'Collaboration and accounts — Help — Sail Scoring',
};

// Per-user dynamic (#155): gated sections only render for viewers whose
// workspace has the feature enabled.
export const dynamic = 'force-dynamic';

export default async function Page() {
  const features = await getEffectiveFeatures();
  const has = (key: FeatureKey) => features.includes(key);
  return (
    <HelpShell slug="collaboration" features={features}>
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
    </HelpShell>
  );
}
