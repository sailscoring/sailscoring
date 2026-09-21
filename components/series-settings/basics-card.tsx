'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Series } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LogoField } from '@/components/series-settings/logo-field';
import { AutosaveNote } from '@/components/series-settings/autosave-note';
import { useSettingsAutosave } from '@/hooks/use-settings-autosave';

export type BasicsValues = Pick<Series, 'name' | 'venue' | 'startDate' | 'endDate' | 'venueLogoUrl' | 'eventLogoUrl' | 'venueUrl' | 'eventUrl'>;

export type BasicsCardProps = {
  value: BasicsValues;
  /** Called when user commits (settings: Save button; wizard: on each edit). */
  onChange: (patch: Partial<BasicsValues>) => void | Promise<void>;
  mode?: 'settings' | 'wizard';
  /** Include the name field (wizard needs it; settings edits name elsewhere). */
  includeName?: boolean;
  /** Include logo URL fields. Defaults to true in settings, false in wizard. */
  includeLogos?: boolean;
  /** Validate the name before committing. Return an error message to block save,
   *  or null/undefined to accept. Only consulted when `includeName` is true. */
  validateName?: (name: string) => Promise<string | null> | string | null;
};

export function BasicsCard({
  value,
  onChange,
  mode = 'settings',
  includeName = false,
  includeLogos,
  validateName,
}: BasicsCardProps) {
  const showLogos = includeLogos ?? (mode === 'settings');
  const isWizard = mode === 'wizard';
  const [expanded, setExpanded] = useState(isWizard);
  const [draft, setDraft] = useState<BasicsValues>(value);
  const [nameError, setNameError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const autosave = useSettingsAutosave<BasicsValues>({ save: onChange });

  // Re-sync when the persisted basic fields change (e.g. opening a different
  // series, or an external update). Tracked via a derived key rather than
  // `value` identity, so unrelated series writes (e.g. FleetsCard saving) do
  // not reset an in-progress draft. See https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  //
  // Skip the draft reset in wizard mode: there the draft is authoritative and
  // every keystroke is persisted, so `value` echoes each edit back — but the
  // echoes arrive late and serialized (see useUpdateSeries' `scope`), so a
  // stale echo would reset the draft backward mid-typing and eat characters.
  // The card remounts (initializing draft from the loaded series) on each step,
  // so it needs no in-place reconciliation here.
  const persistedKey = `${value.name}|${value.venue}|${value.startDate}|${value.endDate}|${value.venueLogoUrl}|${value.eventLogoUrl}|${value.venueUrl}|${value.eventUrl}`;
  const [prevPersistedKey, setPrevPersistedKey] = useState(persistedKey);
  if (prevPersistedKey !== persistedKey) {
    setPrevPersistedKey(persistedKey);
    if (!isWizard) setDraft(value);
  }

  useEffect(() => {
    if (isWizard && includeName) nameRef.current?.select();
  }, [isWizard, includeName]);

  // The name is the one field that can be refused: it must be unique in the
  // workspace, and the check is a round trip. So it is committed on a pause or
  // on leaving the field rather than per keystroke, and only once it passes —
  // a rejected name leaves the stored one alone while the typed text stays on
  // screen, which is what lets the scorer fix it rather than retype it.
  const pendingName = useRef<string | null>(null);
  const nameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commitName = useCallback(async () => {
    if (nameTimer.current) {
      clearTimeout(nameTimer.current);
      nameTimer.current = null;
    }
    const typed = pendingName.current;
    pendingName.current = null;
    if (typed === null) return;
    const trimmed = typed.trim() || value.name;
    if (validateName) {
      const err = await validateName(trimmed);
      if (err) {
        setNameError(err);
        return;
      }
    }
    setNameError(null);
    autosave.commit({ name: trimmed });
  }, [validateName, value.name, autosave]);

  // A name still waiting out its pause when the card goes away is an edit like
  // any other, so it is written rather than dropped.
  useEffect(() => () => void commitName(), [commitName]);

  async function update(patch: Partial<BasicsValues>) {
    // Functional update so two synchronous calls (e.g. picking a canonical logo
    // sets both the logo URL and defaults the companion website) compose instead
    // of clobbering each other through a stale `draft` closure.
    setDraft((prev) => ({ ...prev, ...patch }));
    if ('name' in patch) setNameError(null);
    // In wizard mode, propagate every change so the parent can persist live.
    // Swallow rejections so a failed save (e.g. ConflictApiError) doesn't
    // escape as an unhandled rejection — the global ConflictNoticeProvider
    // surfaces 409s and triggers the refetch.
    if (isWizard) {
      Promise.resolve(onChange(patch)).catch(() => {});
      if ('name' in patch && validateName) {
        const err = await validateName((patch.name ?? '').trim() || value.name);
        if (err) setNameError(err);
      }
      return;
    }
    if ('name' in patch) {
      pendingName.current = patch.name ?? '';
      if (nameTimer.current) clearTimeout(nameTimer.current);
      nameTimer.current = setTimeout(() => void commitName(), 800);
      return;
    }
    // Trimmed on the way out, never in the box — trimming as you type eats the
    // space between two words.
    const trimmed: Partial<BasicsValues> = {};
    for (const [k, v] of Object.entries(patch)) {
      trimmed[k as keyof BasicsValues] = typeof v === 'string' ? v.trim() : v;
    }
    autosave.commit(trimmed, { defer: true });
  }

  // When a canonical logo with an official homepage is picked, default the
  // companion website slot to it — but only when empty, so a hand-typed URL is
  // never clobbered. The scorer can still override or clear it afterwards.
  function defaultCompanionUrl(field: 'venueUrl' | 'eventUrl', homepage: string) {
    if (draft[field].trim()) return;
    update({ [field]: homepage });
  }

  const fields = (
    <>
      {includeName && (
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input
            ref={nameRef}
            id="name"
            value={draft.name}
            onChange={(e) => update({ name: e.target.value })}
            onBlur={() => { if (!isWizard) void commitName(); }}
            placeholder="e.g. HYC Frostbite 2026"
            autoFocus
          />
          {nameError && <p className="text-sm text-destructive">{nameError}</p>}
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="venue">Venue</Label>
        <Input
          id="venue"
          value={draft.venue}
          onChange={(e) => update({ venue: e.target.value })}
          placeholder="e.g. Howth Yacht Club"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="startDate">Start date</Label>
          <Input
            id="startDate"
            type="date"
            value={draft.startDate}
            onChange={(e) => update({ startDate: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="endDate">End date</Label>
          <Input
            id="endDate"
            type="date"
            value={draft.endDate}
            onChange={(e) => update({ endDate: e.target.value })}
          />
        </div>
      </div>
      {showLogos && (
        <>
          <LogoField
            id="venueLogoUrl"
            label="Venue logo"
            value={draft.venueLogoUrl}
            onChange={(url) => update({ venueLogoUrl: url })}
            onPickHomepage={(homepage) => defaultCompanionUrl('venueUrl', homepage)}
          />
          <div className="space-y-1.5">
            <Label htmlFor="venueUrl">Venue website URL</Label>
            <Input
              id="venueUrl"
              type="url"
              value={draft.venueUrl}
              onChange={(e) => update({ venueUrl: e.target.value })}
              placeholder="https://…"
            />
            <p className="text-xs text-muted-foreground">The venue logo and name link here in exported results.</p>
          </div>
          <LogoField
            id="eventLogoUrl"
            label="Event logo"
            value={draft.eventLogoUrl}
            onChange={(url) => update({ eventLogoUrl: url })}
            onPickHomepage={(homepage) => defaultCompanionUrl('eventUrl', homepage)}
          />
          <div className="space-y-1.5">
            <Label htmlFor="eventUrl">Event website URL</Label>
            <Input
              id="eventUrl"
              type="url"
              value={draft.eventUrl}
              onChange={(e) => update({ eventUrl: e.target.value })}
              placeholder="https://…"
            />
            <p className="text-xs text-muted-foreground">The event logo and name link here in exported results.</p>
          </div>
        </>
      )}
    </>
  );

  if (isWizard) return <div className="space-y-4">{fields}</div>;

  const parts = [value.venue, value.startDate].filter(Boolean);
  const summary = parts.length ? parts.join(' · ') : 'No venue or dates set';

  return (
    <div className="bg-card border rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Basic</h2>
        {!expanded && (
          <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
            Edit ▸
          </Button>
        )}
      </div>
      {!expanded ? (
        <p className="text-sm text-muted-foreground">{summary}</p>
      ) : (
        <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
          {fields}
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                void commitName();
                autosave.flush();
                setExpanded(false);
              }}
            >
              Done
            </Button>
            <AutosaveNote status={autosave.status} />
          </div>
        </form>
      )}
    </div>
  );
}
