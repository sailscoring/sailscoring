'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
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
import { setActiveWorkspace } from '@/lib/auth-client';
import * as repos from '@/lib/api-repository';
import { useWorkspaceMemberships } from '@/components/workspace-memberships-provider';
import { type PublicSeriesExport } from '@/lib/public-export';
import { describeOpenSeriesError } from '@/lib/open-series-error';

type State =
  | { step: 'loading' }
  | { step: 'confirm'; data: PublicSeriesExport }
  /** Carries the export so the busy dialog can keep naming what it opens. */
  | { step: 'working'; data: PublicSeriesExport }
  | { step: 'error'; message: string };

export default function ImportPage() {
  const router = useRouter();
  const { memberships, activeOrganizationId } = useWorkspaceMemberships();
  const showWorkspacePicker = memberships.length > 1;
  const [state, setState] = useState<State>({ step: 'loading' });
  const [targetWorkspaceId, setTargetWorkspaceId] = useState<string>('');

  // One-shot read of the import source on mount. Two link shapes (ADR-012):
  //
  //   /import?from=/p/{ws}/{slug}/{name}.sailscoring.json — a reference to a
  //     published data file, fetched here. Path + query survive the sign-in
  //     redirect and the magic-link round trip through an inbox, which the
  //     fragment below cannot.
  //   /import#data=<base64url> — the whole payload inline. Written into
  //     standalone artifacts (downloaded pages, FTP uploads to club sites)
  //     and every page published before the data file existed. Kept
  //     indefinitely: those copies are in the wild and cannot be rewritten.
  //
  // `window.location` is not available during SSR, so we can't derive this
  // from render directly.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const from = new URLSearchParams(window.location.search).get('from');
    if (from) {
      // Only a same-origin published data file is fetched — a plain path
      // under /p/, no traversal. Anything else (absolute URLs especially)
      // is refused rather than turning this page into a fetch relay.
      if (!/^\/p\/.+/.test(from) || from.includes('..')) {
        setState({ step: 'error', message: 'Unrecognised import link.' });
        return;
      }
      let cancelled = false;
      (async () => {
        try {
          const res = await fetch(from);
          if (res.status === 404) {
            if (!cancelled) {
              setState({
                step: 'error',
                message:
                  'These results are no longer published. A downloaded copy of the results page carries its own working "Open in Sail Scoring" link.',
              });
            }
            return;
          }
          if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
          const parsed = (await res.json()) as PublicSeriesExport;
          if (!(parsed.version >= 1) || !parsed.series?.name) throw new Error('Unrecognised format');
          if (!cancelled) setState({ step: 'confirm', data: parsed });
        } catch {
          if (!cancelled) {
            setState({ step: 'error', message: 'Could not read the series data from the link.' });
          }
        }
      })();
      return () => { cancelled = true; };
    }

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
    setState({ step: 'working', data });
    try {
      // Flip the active workspace before the import so the server resolves
      // it via `requireWorkspace()` on the request that does the writing.
      // Hard-navigate after success for the same reason `WorkspaceSwitcher`
      // does: soft routing would leave server-rendered shells pointing at
      // the previous workspace.
      if (
        chosenWorkspaceId &&
        chosenWorkspaceId !== activeOrganizationId
      ) {
        await setActiveWorkspace(chosenWorkspaceId);
      }
      const { id } = await repos.importSeriesDocument(
        JSON.stringify(data),
        'public-export',
      );
      window.location.assign(`/series/${id}/standings`);
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
      {/* Both waits this page has: fetching the published data file, and the
          import itself, which for a full championship runs several seconds.
          Without this the page is two closed dialogs — nothing at all under
          the header — for the whole of either. Same non-dismissible shape as
          the `.sailscoring` open flow: there is no cancelling a write that is
          already with the server. */}
      <Dialog open={state.step === 'loading' || state.step === 'working'}>
        <DialogContent
          showCloseButton={false}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          data-testid="import-working"
        >
          <DialogHeader>
            <DialogTitle>
              {state.step === 'working'
                ? `Opening “${state.data.series.name}”…`
                : 'Reading the published results…'}
            </DialogTitle>
            <DialogDescription>
              {state.step === 'working'
                ? 'Creating the series in your workspace. This takes a few seconds for a large event.'
                : 'Fetching the results data behind the page you came from.'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center py-2">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </DialogContent>
      </Dialog>

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
