'use client';

import { useState, type FormEvent } from 'react';

import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** A code as the CLI prints it ("ABCD-EFGH"), as the server stores it. */
function normaliseCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

export function DeviceApproval({ initialCode, email }: { initialCode: string; email: string }) {
  const [code, setCode] = useState(initialCode);
  const [status, setStatus] = useState<'idle' | 'working' | 'approved' | 'denied' | 'error'>('idle');

  async function answer(approve: boolean, event?: FormEvent) {
    event?.preventDefault();
    setStatus('working');
    const userCode = normaliseCode(code);
    // Checking the code claims it for this session, which approving or
    // denying it requires.
    const claimed = await authClient.$fetch('/device', { query: { user_code: userCode } });
    if (claimed.error) {
      setStatus('error');
      return;
    }
    const { error } = await authClient.$fetch(approve ? '/device/approve' : '/device/deny', {
      method: 'POST',
      body: { userCode },
    });
    setStatus(error ? 'error' : approve ? 'approved' : 'denied');
  }

  return (
    <section className="max-w-sm mx-auto mt-8 bg-card border rounded-lg p-6" data-testid="device-approval">
      <h1 className="text-2xl font-semibold mb-1">Sign in the command line</h1>
      {status === 'approved' ? (
        <p className="text-sm" data-testid="device-approved">
          Done: the Sail Scoring command line is signed in as <strong>{email}</strong>. You can close
          this page and go back to it.
        </p>
      ) : status === 'denied' ? (
        <p className="text-sm">Refused: the command line has not been signed in.</p>
      ) : (
        <form onSubmit={(e) => answer(true, e)} className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Enter the code <code>sailscoring auth login</code> printed, to sign it in as{' '}
            <strong>{email}</strong>. It will be able to do whatever you can, in every workspace you
            belong to. Only approve a code you started yourself.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="user-code">Code</Label>
            <Input
              id="user-code"
              required
              autoFocus={!initialCode}
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={status === 'working'}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={!code.trim() || status === 'working'}>
              Approve
            </Button>
            <Button type="button" variant="outline" onClick={() => answer(false)} disabled={!code.trim() || status === 'working'}>
              Deny
            </Button>
          </div>
          {status === 'error' && (
            <p role="alert" className="text-sm text-red-600">
              That code isn&apos;t one waiting for approval: it may have expired. Run{' '}
              <code>sailscoring auth login</code> again for a new one.
            </p>
          )}
        </form>
      )}
    </section>
  );
}
