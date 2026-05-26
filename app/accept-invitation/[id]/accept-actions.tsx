'use client';

import { useState } from 'react';

import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';

/**
 * Accept/decline buttons for a workspace invitation (#153). On accept it
 * switches the active workspace to the one just joined and hard-reloads so
 * every server component re-evaluates against it.
 */
export function AcceptInvitationActions({
  invitationId,
  organizationId,
}: {
  invitationId: string;
  organizationId: string;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setWorking(true);
    setError(null);
    const { error: acceptError } = await authClient.organization.acceptInvitation({
      invitationId,
    });
    if (acceptError) {
      setWorking(false);
      setError(acceptError.message ?? 'Could not accept the invitation.');
      return;
    }
    await authClient.organization.setActive({ organizationId });
    window.location.assign('/');
  }

  async function decline() {
    setWorking(true);
    setError(null);
    await authClient.organization.rejectInvitation({ invitationId });
    window.location.assign('/');
  }

  return (
    <div>
      <div className="flex gap-2">
        <Button onClick={accept} disabled={working} data-testid="accept-invitation-accept">
          {working ? 'Joining…' : 'Accept invitation'}
        </Button>
        <Button onClick={decline} disabled={working} variant="outline">
          Decline
        </Button>
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
