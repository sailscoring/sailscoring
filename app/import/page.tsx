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
import { importPublicExport, type PublicSeriesExport } from '@/lib/public-export';

type State =
  | { step: 'loading' }
  | { step: 'confirm'; data: PublicSeriesExport }
  | { step: 'working' }
  | { step: 'error'; message: string };

export default function ImportPage() {
  const router = useRouter();
  const [state, setState] = useState<State>({ step: 'loading' });

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

  async function handleConfirm() {
    if (state.step !== 'confirm') return;
    const { data } = state;
    setState({ step: 'working' });
    try {
      const newId = await importPublicExport(data);
      router.replace(`/series/${newId}/standings`);
    } catch (err) {
      console.error(err);
      setState({ step: 'error', message: 'Failed to open series. Please try again.' });
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
          <DialogFooter>
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button onClick={handleConfirm}>Open series</Button>
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
