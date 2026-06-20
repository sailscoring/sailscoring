'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { authClient } from '@/lib/auth-client';
import * as repos from '@/lib/api-repository';
import { useWorkspaceMemberships } from '@/components/workspace-memberships-provider';
import { importPublicExport, type PublicSeriesExport } from '@/lib/public-export';
import { describeOpenSeriesError } from '@/lib/open-series-error';

type State =
  | { step: 'loading' }
  | { step: 'confirm'; data: PublicSeriesExport }
  | { step: 'working' }
  | { step: 'error'; message: string };

export default function ImportPage() {
  const router = useRouter();
  const { memberships, activeOrganizationId } = useWorkspaceMemberships();
  const showWorkspacePicker = memberships.length > 1;
  const [state, setState] = useState<State>({ step: 'loading' });
  const [targetWorkspaceId, setTargetWorkspaceId] = useState<string>('');

  // One-shot parse of the URL fragment on mount. `window.location` is not
  // available during SSR, so we can't derive this from render directly.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const hash = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash;
    const param = new URLSearchParams(hash).get('data');
    if (!param) {
      setState({ step: 'error', message: 'No import data in URL.' });
      return;
    }
    try {
      const b64 = param.replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '=='.slice(0, (4 - b64.length % 4) % 4);
      const binary = atob(padded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const json = new TextDecoder().decode(bytes);
      const parsed = JSON.parse(json) as PublicSeriesExport;
      if (!(parsed.version >= 1) || !parsed.series?.name) throw new Error('Unrecognised format');
      setState({ step: 'confirm', data: parsed });
    } catch {
      setState({ step: 'error', message: 'Could not read the series data from the link.' });
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Default the workspace selection to the active workspace once we know
  // it. Tracked separately from `state` so the dropdown is controllable
  // before the user touches it.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!showWorkspacePicker) return;
    if (targetWorkspaceId) return;
    if (activeOrganizationId) setTargetWorkspaceId(activeOrganizationId);
  }, [showWorkspacePicker, activeOrganizationId, targetWorkspaceId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleConfirm() {
    if (state.step !== 'confirm') return;
    const { data } = state;
    const chosenWorkspaceId = showWorkspacePicker ? targetWorkspaceId : null;
    setState({ step: 'working' });
    try {
      // Flip the active workspace before any API write so every
      // repository call in `importPublicExport` resolves to the chosen
      // workspace via `requireWorkspace()`. Hard-navigate after success
      // for the same reason `WorkspaceSwitcher` does: soft routing would
      // leave server-rendered shells pointing at the previous workspace.
      if (
        chosenWorkspaceId &&
        chosenWorkspaceId !== activeOrganizationId
      ) {
        await authClient.organization.setActive({
          organizationId: chosenWorkspaceId,
        });
      }
      const newId = await importPublicExport(data, repos);
      window.location.assign(`/series/${newId}/standings`);
    } catch (err) {
      console.error(err);
      setState({ step: 'error', message: describeOpenSeriesError(err) });
    }
  }

  function handleCancel() {
    router.replace('/');
  }

  return (
    <>
      <Dialog
        open={state.step === 'confirm'}
        onOpenChange={(open) => { if (!open) handleCancel(); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Open &ldquo;{state.step === 'confirm' ? state.data.series.name : ''}&rdquo;?
            </DialogTitle>
            <DialogDescription>
              This will create a new series in your scoring app with the results from this
              published results page. You can score and edit it from there.
            </DialogDescription>
          </DialogHeader>
          {showWorkspacePicker && (
            <div className="space-y-1.5">
              <Label htmlFor="import-target-workspace">Workspace</Label>
              <Select
                value={targetWorkspaceId}
                onValueChange={setTargetWorkspaceId}
              >
                <SelectTrigger
                  id="import-target-workspace"
                  className="w-full"
                  data-testid="import-target-workspace"
                >
                  <SelectValue placeholder="Select a workspace…" />
                </SelectTrigger>
                <SelectContent>
                  {memberships.map((m) => (
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
          )}
          <DialogFooter>
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={showWorkspacePicker && !targetWorkspaceId}
            >
              Open series
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={state.step === 'error'}
        onOpenChange={(open) => { if (!open) handleCancel(); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Could not open link</DialogTitle>
            <DialogDescription>
              {state.step === 'error' ? state.message : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={handleCancel}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
