'use client';

/**
 * ADR-008 Phase 7 — "Copy to workspace…" action on a series.
 *
 * Surfaces only in server mode and only when the user has at least one
 * workspace beyond the current one. Copy rather than move so a botched
 * copy is recoverable: the source series stays intact in the source
 * workspace.
 *
 * On success the dialog flips the active workspace to the target via
 * Better Auth's `setActiveOrganization` and hard-reloads to the new
 * series in its competitors tab. Soft-routing would land the next page
 * still scoped to the source workspace.
 */
import { useMemo, useState } from 'react';

import { authClient } from '@/lib/auth-client';
import { copySeriesToWorkspace } from '@/lib/api-repository';
import { useServerMode } from '@/lib/repos';
import { useWorkspaceMemberships } from '@/components/workspace-memberships-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export function CopySeriesToWorkspaceCard({
  seriesId,
  seriesName,
}: {
  seriesId: string;
  seriesName: string;
}) {
  const serverMode = useServerMode();
  const { memberships, activeOrganizationId } = useWorkspaceMemberships();
  const targets = useMemo(
    () => memberships.filter((m) => m.organizationId !== activeOrganizationId),
    [memberships, activeOrganizationId],
  );

  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState<string>('');
  const [name, setName] = useState<string>(`Copy of ${seriesName}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!serverMode || targets.length === 0) return null;

  function reset() {
    setTargetId('');
    setName(`Copy of ${seriesName}`);
    setError(null);
    setBusy(false);
  }

  async function handleCopy() {
    if (!targetId) {
      setError('Pick a workspace to copy into.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await copySeriesToWorkspace(seriesId, {
        targetWorkspaceId: targetId,
        name: name.trim() || undefined,
      });
      // Switch active workspace, then hard-navigate. Soft routing would
      // re-render the source-workspace shell against target data and
      // every cached query would 404 / 403.
      await authClient.organization.setActive({ organizationId: targetId });
      window.location.assign(`/series/${result.id}/competitors`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not copy this series.',
      );
      setBusy(false);
    }
  }

  return (
    <div className="border rounded-lg p-5 space-y-3">
      <div>
        <h2 className="text-sm font-medium">Copy to another workspace</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Make a fresh copy of this series in a workspace you belong to.
          The original stays here.
        </p>
      </div>
      <Button
        variant="outline"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        Copy to workspace…
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) {
            setOpen(false);
            reset();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy &ldquo;{seriesName}&rdquo;</DialogTitle>
            <DialogDescription>
              Choose a target workspace and a name for the copy. FTP
              servers and publishing state are not carried over.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="copy-target-workspace">Target workspace</Label>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger
                  id="copy-target-workspace"
                  className="w-full"
                  data-testid="copy-target-workspace"
                >
                  <SelectValue placeholder="Select a workspace…" />
                </SelectTrigger>
                <SelectContent>
                  {targets.map((m) => (
                    <SelectItem
                      key={m.organizationId}
                      value={m.organizationId}
                    >
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="copy-name">Name</Label>
              <Input
                id="copy-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
              />
            </div>
            {error && (
              <p className="text-sm text-red-600" role="alert">{error}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false);
                reset();
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCopy}
              disabled={busy || !targetId}
              data-testid="copy-series-submit"
            >
              {busy ? 'Copying…' : 'Copy'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
