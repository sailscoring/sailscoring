'use client';

import { useState } from 'react';

import { ConflictApiError } from '@/lib/api-client';

/**
 * The commit half of an inline editor: a draft buffer that is only discarded
 * once the save has landed.
 *
 * The editors that came before this cleared the draft first and awaited the
 * save afterwards, so a save that failed left the field showing the
 * pre-edit value with nothing said — the typed value gone, the rejection an
 * unhandled promise. Here the draft survives a failure and the failure is
 * reported, so the scorer can see what happened and try again with the edit
 * still in the field.
 */
export function useInlineEdit<T>({
  value,
  onSave,
}: {
  /** The saved value the draft is compared against. */
  value: T;
  onSave: (next: T) => Promise<void>;
}): {
  /** `null` while not editing; otherwise the in-progress value. */
  draft: T | null;
  setDraft: (next: T) => void;
  /** Open the editor on the current value. */
  begin: (initial: T) => void;
  /** Abandon the edit (Escape). */
  cancel: () => void;
  /** Save the draft, keeping it if the save fails. */
  commit: () => Promise<void>;
  saving: boolean;
  error: string | null;
} {
  const [draft, setDraftState] = useState<T | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setDraft(next: T) {
    setDraftState(next);
    setError(null);
  }

  function begin(initial: T) {
    setDraftState(initial);
    setError(null);
  }

  function cancel() {
    setDraftState(null);
    setError(null);
  }

  async function commit() {
    if (draft === null || saving) return;
    if (draft === value) {
      setDraftState(null);
      setError(null);
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
      setDraftState(null);
      setError(null);
    } catch (e) {
      // The draft stays: the edit is the thing worth keeping when a save
      // fails, and re-typing it is the scorer's time.
      setError(
        e instanceof ConflictApiError
          ? 'Someone else changed this since you opened it. Reload, then try again.'
          : 'Could not save. Try again.',
      );
    } finally {
      setSaving(false);
    }
  }

  return { draft, setDraft, begin, cancel, commit, saving, error };
}
