'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';

export function SignOutButton() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function onClick() {
    setSigningOut(true);
    await authClient.signOut();
    router.push('/');
    router.refresh();
  }

  return (
    <Button variant="outline" onClick={onClick} disabled={signingOut}>
      {signingOut ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}
