import { headers } from 'next/headers';
import Link from 'next/link';

import { auth } from '@/lib/auth';
import { getOptionalSession } from '@/lib/auth/require-session';
import { Button } from '@/components/ui/button';

import { AcceptInvitationActions } from './accept-actions';

export const dynamic = 'force-dynamic';

/**
 * Workspace invitation landing page (#153). Server-rendered: it reads the
 * session and (when signed in) the invitation server-side via `auth.api`,
 * matching how the rest of the app resolves session state. The accept/decline
 * actions are a thin client island, since they call the Better Auth org
 * client and then switch the active workspace.
 */
export default async function AcceptInvitationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getOptionalSession();

  if (!session) {
    const callbackURL = `/accept-invitation/${id}`;
    return (
      <section className="max-w-sm">
        <h1 className="text-2xl font-semibold mb-1">Workspace invitation</h1>
        <p className="text-sm text-muted-foreground mb-6">
          You’ve been invited to a shared scoring workspace on Sail Scoring.
          Sign in with the email address the invite was sent to, then you can
          accept it.
        </p>
        <Button asChild>
          <Link href={`/sign-in?callbackURL=${encodeURIComponent(callbackURL)}`}>
            Sign in to continue
          </Link>
        </Button>
      </section>
    );
  }

  let invitation: {
    organizationId: string;
    organizationName: string;
    role: string;
    inviterEmail: string;
  } | null = null;
  try {
    const data = await auth.api.getInvitation({
      headers: await headers(),
      query: { id },
    });
    invitation = {
      organizationId: data.organizationId,
      organizationName: data.organizationName,
      role: data.role ?? 'member',
      inviterEmail: data.inviterEmail,
    };
  } catch {
    // Expired, already used, or addressed to a different account — getInvitation
    // throws rather than returning, so any failure lands here.
    invitation = null;
  }

  if (!invitation) {
    return (
      <section className="max-w-sm">
        <h1 className="text-2xl font-semibold mb-1">Invitation</h1>
        <p className="text-sm text-muted-foreground mb-6">
          This invitation isn’t valid anymore — it may have expired, been used
          already, or been sent to a different email address than the one you’re
          signed in with ({session.user.email}).
        </p>
        <Button asChild variant="outline">
          <Link href="/">Go to your workspaces</Link>
        </Button>
      </section>
    );
  }

  return (
    <section className="max-w-sm" data-testid="accept-invitation">
      <h1 className="text-2xl font-semibold mb-1">
        Join {invitation.organizationName}
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        {invitation.inviterEmail} invited you to join{' '}
        <strong className="text-foreground">{invitation.organizationName}</strong>{' '}
        as <strong className="text-foreground">{invitation.role}</strong>. You’ll
        see and edit every series in this workspace alongside the other scorers.
      </p>
      <AcceptInvitationActions
        invitationId={id}
        organizationId={invitation.organizationId}
      />
    </section>
  );
}
