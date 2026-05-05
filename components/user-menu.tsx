'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

import { authClient } from '@/lib/auth-client';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function UserMenu({ email }: { email: string }) {
  const qc = useQueryClient();
  const [signingOut, setSigningOut] = useState(false);

  async function onSignOut() {
    setSigningOut(true);
    await authClient.signOut();
    // Drop all cached queries before navigating: any in-flight fetch
    // under the now-cleared cookie would 401 and surface as a browser
    // console error. Hard `window.location.assign` so server components
    // re-evaluate the (now empty) session, and land directly on /sign-in
    // — going via `/` would mount the home page briefly under the empty
    // session and `useSeriesList()` would 401 before redirect.
    qc.clear();
    window.location.assign('/sign-in');
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={signingOut}
        className={cn(
          'inline-flex items-center gap-1 text-sm text-muted-foreground',
          'hover:text-foreground focus:outline-none focus-visible:underline',
          signingOut && 'opacity-50',
        )}
        data-testid="user-menu"
      >
        <span className="max-w-[16rem] truncate">{email}</span>
        <ChevronDown className="h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[14rem]">
        <DropdownMenuLabel className="font-normal">
          <div className="text-xs text-muted-foreground">Signed in as</div>
          <div className="truncate text-sm">{email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account">Account</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut} disabled={signingOut}>
          {signingOut ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
