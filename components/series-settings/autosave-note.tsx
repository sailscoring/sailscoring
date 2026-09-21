'use client';

import type { SettingsAutosaveStatus } from '@/hooks/use-settings-autosave';

/**
 * What used to be the Save button's slot. The cards save as you go, so there
 * is nothing to press — but a card that silently persists and says nothing is
 * as hard to trust as one that silently discards, so it says which it is.
 */
export function AutosaveNote({ status }: { status: SettingsAutosaveStatus }) {
  return (
    <span className="text-xs text-muted-foreground" data-testid="autosave-note">
      {status === 'pending' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Changes save as you make them'}
    </span>
  );
}
