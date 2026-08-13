'use client';

import { useFeatures } from '@/components/features-provider';

import { HelpShot, Section } from '../ui';

/** The “Collaboration and accounts” chapter — rendered by the /help/collaboration route and,
 *  loaded on demand, by the help panel. */
export default function Collaboration() {
  const { has } = useFeatures();
  return (
    <>
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
      <Section id="reading-help" title="Reading help beside your work">
        <HelpShot
          src="/help/shots/help-panel.webp"
          alt="Help open in a panel beside the standings it describes."
          caption="Help open in a panel beside the standings it describes."
        />
        <p>
          You don’t have to leave what you’re doing to look something up.
          Clicking <strong className="text-foreground">Help</strong> in the page
          header — or pressing <strong className="text-foreground">h</strong> —
          opens help in a panel beside the screen you’re working on, so the
          advice and the thing it describes are in front of you at the same
          time.
        </p>
        <p>
          The panel opens on its index, with the section covering the screen
          you’re on pinned to the top under{' '}
          <strong className="text-foreground">For this page</strong>. Links
          between help sections move the panel rather than the page underneath
          it, so following a cross-reference never costs you your place.
        </p>
        <p>
          <strong className="text-foreground">Minimise</strong> (the arrows at
          the top of the panel, or <strong className="text-foreground">Esc</strong>)
          slides it out of the way and leaves a{' '}
          <strong className="text-foreground">Help</strong> button in the corner
          of the screen. Bringing it back returns you to the same chapter,
          section and scroll position, so you can flick between the problem and
          the answer as often as you need. Drag the panel’s left edge to give it
          more or less room; the width is remembered.
        </p>
        <p>
          Every chapter is also a page of its own, at{' '}
          <span className="font-mono">/help</span> —{' '}
          <strong className="text-foreground">Open as a page</strong> in the
          panel opens the section you’re reading in a new tab, which is what you
          want for printing a chapter or sending a co-scorer a link to it.
        </p>
      </Section>
      <Section id="sending-feedback" title="Sending feedback">
        <HelpShot
          src="/help/shots/send-feedback.webp"
          alt="Send feedback attaches the page and browser you were using, shown before you send."
          caption="Send feedback attaches the page and browser you were using, shown before you send."
        />
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
        <HelpShot
          src="/help/shots/keyboard-shortcuts.webp"
          alt="The shortcut reference — press ? anywhere."
          caption="The shortcut reference — press ? anywhere."
        />
        <p>
          Press <strong className="text-foreground">?</strong> anywhere in the app (outside a text
          input) to open the keyboard shortcuts reference. Press{' '}
          <strong className="text-foreground">Shift+D</strong> to toggle dark mode.
        </p>
      </Section>
    </>
  );
}
