'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';

export function SignOutButton() {
  const qc = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);

  async function onClick() {
    setSigningOut(true);
    await authClient.signOut();
    // Drop all cached queries before navigating: any in-flight fetch
    // under the now-cleared cookie would 401 and surface as a browser
    // console error. `clear()` cancels active queries and removes their
    // data, so the next page mounts fresh against whatever auth state
    // it finds. Hard `window.location.assign` rather than `router.push`
    // so server components re-evaluate the (now empty) session.
    qc.clear();
    // Land on /sign-in directly. Going via `/` would mount the home page
    // briefly under the now-empty session — `useSeriesList()` would 401
    // before the server component re-evaluated and redirected.
    window.location.assign('/sign-in');
  }

  return (
    <Button variant="outline" onClick={onClick} disabled={signingOut}>
      {signingOut ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}
