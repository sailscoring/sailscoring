'use client';

import { useState } from 'react';

import { useMyOrgRequest, useSubmitOrgRequest } from '@/hooks/use-org-request';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Request a shared workspace (#153, iteration 3). Org creation is
 * admin-approved: this records a request and notifies the project owner, who
 * provisions the workspace and adds you as owner. Shows the pending/fulfilled
 * status once a request exists, so you don't submit twice.
 */
export function OrgRequestCard() {
  const { data: request, isLoading } = useMyOrgRequest();
  const submit = useSubmitOrgRequest();

  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const requestedName = name.trim();
    if (!requestedName) return;
    try {
      await submit.mutateAsync({ requestedName, note: note.trim() || undefined });
      setName('');
      setNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit the request.');
    }
  }

  if (isLoading) return null;

  return (
    <section className="rounded-lg border p-5 space-y-3" data-testid="org-request-card">
      <div>
        <h2 className="text-lg font-semibold">Shared workspace</h2>
        <p className="text-sm text-muted-foreground">
          A shared workspace lets a club scoring panel work on the same series
          together. Request one and we’ll set it up and make you its owner.
        </p>
      </div>

      {request && request.status === 'pending' ? (
        <p className="text-sm" data-testid="org-request-pending">
          Your request for <strong>{request.requestedName}</strong> is pending.
          We’ll email you when it’s ready.
        </p>
      ) : request && request.status === 'fulfilled' ? (
        <p className="text-sm text-muted-foreground">
          Your request for <strong>{request.requestedName}</strong> has been set
          up — switch to it from the workspace menu in the header.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="org-request-name">Workspace name</Label>
            <Input
              id="org-request-name"
              placeholder="e.g. Howth YC Scoring Panel"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submit.isPending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="org-request-note">Anything we should know? (optional)</Label>
            <Input
              id="org-request-note"
              placeholder="Which events, who else will be scoring, …"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={submit.isPending}
            />
          </div>
          <Button type="submit" disabled={submit.isPending || !name.trim()}>
            {submit.isPending ? 'Sending…' : 'Request a workspace'}
          </Button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      )}
    </section>
  );
}
