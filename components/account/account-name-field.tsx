'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Inline view/edit of the signed-in user's display name. When unset it
 * reads as a gentle prompt rather than an empty cell, since a magic-link
 * sign-up never collects a name. Saving calls Better Auth's `updateUser`
 * and refreshes the server component so the new value renders everywhere
 * (account page, header derivations) on the next paint.
 */
export function AccountNameField({ initialName }: { initialName: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialName ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = initialName?.trim() || null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const { error: updateError } = await authClient.updateUser({
      name: value.trim(),
    });
    if (updateError) {
      setSaving(false);
      setError(updateError.message ?? 'Could not save your name.');
      return;
    }
    setSaving(false);
    setEditing(false);
    router.refresh();
  }

  if (editing) {
    return (
      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            autoComplete="name"
            placeholder="Your name"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={saving}
            className="h-8 max-w-[16rem]"
            data-testid="account-name-input"
          />
          <Button
            type="submit"
            size="sm"
            disabled={saving}
            data-testid="account-name-save"
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={saving}
            onClick={() => {
              setValue(initialName ?? '');
              setError(null);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {name ? (
        <span>{name}</span>
      ) : (
        <span className="text-muted-foreground">Not set</span>
      )}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setEditing(true)}
        data-testid="account-name-edit"
      >
        {name ? 'Edit' : 'Add your name'}
      </Button>
    </div>
  );
}
