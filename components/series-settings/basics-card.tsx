'use client';

import { useEffect, useRef, useState } from 'react';
import type { Series } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type BasicsValues = Pick<Series, 'name' | 'venue' | 'startDate' | 'endDate' | 'venueLogoUrl' | 'eventLogoUrl'>;

export type BasicsCardProps = {
  value: BasicsValues;
  /** Called when user commits (settings: Save button; wizard: on each edit). */
  onChange: (patch: Partial<BasicsValues>) => void | Promise<void>;
  mode?: 'settings' | 'wizard';
  /** Include the name field (wizard needs it; settings edits name elsewhere). */
  includeName?: boolean;
  /** Include logo URL fields. Defaults to true in settings, false in wizard. */
  includeLogos?: boolean;
};

export function BasicsCard({
  value,
  onChange,
  mode = 'settings',
  includeName = false,
  includeLogos,
}: BasicsCardProps) {
  const showLogos = includeLogos ?? (mode === 'settings');
  const isWizard = mode === 'wizard';
  const [expanded, setExpanded] = useState(isWizard);
  const [draft, setDraft] = useState<BasicsValues>(value);
  const [changed, setChanged] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // Re-sync when the underlying series changes (e.g. opening a different series).
  useEffect(() => {
    setDraft(value);
    setChanged(false);
  }, [value.name, value.venue, value.startDate, value.endDate, value.venueLogoUrl, value.eventLogoUrl]);

  useEffect(() => {
    if (isWizard && includeName) nameRef.current?.select();
  }, [isWizard, includeName]);

  function update(patch: Partial<BasicsValues>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    setChanged(true);
    // In wizard mode, propagate every change so the parent can persist on Next.
    if (isWizard) onChange(patch);
  }

  async function handleSettingsSave(e: React.FormEvent) {
    e.preventDefault();
    const patch: Partial<BasicsValues> = {
      venue: draft.venue.trim(),
      startDate: draft.startDate,
      endDate: draft.endDate,
    };
    if (includeName) patch.name = draft.name.trim() || value.name;
    if (showLogos) {
      patch.venueLogoUrl = draft.venueLogoUrl.trim();
      patch.eventLogoUrl = draft.eventLogoUrl.trim();
    }
    await onChange(patch);
    setChanged(false);
    setExpanded(false);
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
            placeholder="e.g. HYC Frostbite 2026"
            autoFocus
          />
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
          <div className="space-y-1.5">
            <Label htmlFor="venueLogoUrl">Venue logo URL</Label>
            <Input
              id="venueLogoUrl"
              type="url"
              value={draft.venueLogoUrl}
              onChange={(e) => update({ venueLogoUrl: e.target.value })}
              placeholder="https://…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eventLogoUrl">Event logo URL</Label>
            <Input
              id="eventLogoUrl"
              type="url"
              value={draft.eventLogoUrl}
              onChange={(e) => update({ eventLogoUrl: e.target.value })}
              placeholder="https://…"
            />
          </div>
        </>
      )}
    </>
  );

  if (isWizard) return <div className="space-y-4">{fields}</div>;

  const parts = [value.venue, value.startDate].filter(Boolean);
  const summary = parts.length ? parts.join(' · ') : 'No venue or dates set';

  return (
    <div className="border rounded-lg p-5 space-y-4">
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
        <form onSubmit={handleSettingsSave} className="space-y-4">
          {fields}
          <div className="flex gap-2">
            <Button type="submit" variant="outline" size="sm" disabled={!changed}>
              {changed ? 'Save' : 'Saved'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded(false)}>
              Done
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
