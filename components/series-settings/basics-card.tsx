'use client';

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { Series } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LogoField } from '@/components/series-settings/logo-field';
import { AutosaveNote } from '@/components/series-settings/autosave-note';
import { useSettingsAutosave } from '@/hooks/use-settings-autosave';

export type BasicsValues = Pick<Series, 'name' | 'venue' | 'startDate' | 'endDate' | 'venueLogoUrl' | 'eventLogoUrl' | 'venueUrl' | 'eventUrl'>;

export type BasicsCardHandle = {
  /** Commit a name still waiting out its pause. Resolves to the name now in
   *  effect, or null when the typed name was refused (the card shows why). */
  commitName: () => Promise<string | null>;
};

export type BasicsCardProps = {
  ref?: Ref<BasicsCardHandle>;
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
  ref,
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
    // Settings mode now persists as you type too, so the draft is
    // authoritative while the card is open for the same reason the wizard's
    // is: an echo of our own write would reset it backward and eat
    // characters.
    if (!isWizard && !expanded) setDraft(value);
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
  // The name last accepted here, which the stored one lags behind until its
  // save lands, and the commit still checking one — leaving the field starts
  // a commit that a click on the wizard's Next must wait for, not overtake.
  const acceptedName = useRef(value.name);
  // The name on screen was refused and not retyped since — still no name to
  // move on with.
  const nameRefused = useRef(false);
  const nameInFlight = useRef<Promise<string | null> | null>(null);

  const commitName = useCallback((): Promise<string | null> => {
    if (nameTimer.current) {
      clearTimeout(nameTimer.current);
      nameTimer.current = null;
    }
    const typed = pendingName.current;
    pendingName.current = null;
    if (typed === null) {
      return nameInFlight.current
        ?? Promise.resolve(nameRefused.current ? null : acceptedName.current);
    }
    const trimmed = typed.trim() || value.name;
    const commit = (async () => {
      if (validateName) {
        const err = await validateName(trimmed);
        if (err) {
          setNameError(err);
          nameRefused.current = true;
          return null;
        }
      }
      setNameError(null);
      nameRefused.current = false;
      acceptedName.current = trimmed;
      autosave.commit({ name: trimmed });
      return trimmed;
    })();
    nameInFlight.current = commit;
    const settle = () => {
      if (nameInFlight.current === commit) nameInFlight.current = null;
    };
    commit.then(settle, settle);
    return commit;
  }, [validateName, value.name, autosave]);

  useImperativeHandle(ref, () => ({ commitName }), [commitName]);

  // A name still waiting out its pause when the card goes away is an edit like
  // any other, so it is written rather than dropped. Only on unmount: the
  // callback changes on every render, and committing each time it did would
  // write the name a keystroke at a time.
  const commitNameOnUnmount = useRef(commitName);
  useEffect(() => {
    commitNameOnUnmount.current = commitName;
  });
  useEffect(() => () => void commitNameOnUnmount.current(), []);

  function update(patch: Partial<BasicsValues>) {
    // Functional update so two synchronous calls (e.g. picking a canonical logo
    // sets both the logo URL and defaults the companion website) compose instead
    // of clobbering each other through a stale `draft` closure.
    setDraft((prev) => ({ ...prev, ...patch }));
    // The name waits for a pause in both modes: a write per keystroke queues
    // behind the one before it, and the series title creeps along behind the
    // typing.
    if ('name' in patch) {
      setNameError(null);
      pendingName.current = patch.name ?? '';
      if (nameTimer.current) clearTimeout(nameTimer.current);
      nameTimer.current = setTimeout(() => void commitName(), 800);
      return;
    }
    // In wizard mode, propagate every change so the parent can persist live.
    // Swallow rejections so a failed save (e.g. ConflictApiError) doesn't
    // escape as an unhandled rejection — the global ConflictNoticeProvider
    // surfaces 409s and triggers the refetch.
    if (isWizard) {
      Promise.resolve(onChange(patch)).catch(() => {});
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
            onBlur={() => void commitName()}
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
