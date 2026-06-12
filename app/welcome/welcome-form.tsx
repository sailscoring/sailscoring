'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * First-sign-in name prompt. Reached only by brand-new users via the
 * magic-link `newUserCallbackURL` (wired in the sign-in form). Entirely
 * skippable — names are cosmetic (every consumer falls back to email),
 * so we nudge rather than gate. `next` is the post-sign-in destination,
 * already sanitised to an internal path by the server page.
 */
export function WelcomeForm({ next }: { next: string }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      router.push(next);
      return;
    }
    setSaving(true);
    setError(null);
    const { error: updateError } = await authClient.updateUser({ name: trimmed });
    if (updateError) {
      setSaving(false);
      setError(updateError.message ?? 'Could not save your name.');
      return;
    }
    // Revalidate server data before leaving so the destination renders with
    // the freshly-saved name rather than the empty creation-time value.
    router.refresh();
    router.push(next);
  }

  return (
    <section className="max-w-sm">
      <h1 className="text-2xl font-semibold mb-1">Welcome aboard</h1>
      <p className="text-sm text-muted-foreground mb-6">
        What should we call you? Your name appears on the activity log and on
        member lists in shared workspaces. You can change it later on your
        account page.
      </p>

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            type="text"
            autoFocus
            autoComplete="name"
            placeholder="e.g. Mary Murphy"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
            data-testid="welcome-name"
          />
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={saving} data-testid="welcome-save">
            {saving ? 'Saving…' : 'Save and continue'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={() => router.push(next)}
            data-testid="welcome-skip"
          >
            Skip for now
          </Button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </section>
  );
}
