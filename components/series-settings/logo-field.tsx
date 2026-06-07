'use client';

import { useState } from 'react';

import { useFeatures } from '@/components/features-provider';
import { useLogos } from '@/hooks/use-logos';
import { logoRepo } from '@/lib/api-repository';
import { logoPublicUrl, parseLogoId, LOGO_CLASS_LABELS } from '@/lib/flag-locker';
import {
  canonicalLogoUrl,
  parseCanonicalLogoFile,
  CANONICAL_LOGOS,
  CANONICAL_CLASS_LABELS,
} from '@/lib/canonical-logos';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const APP_BASE = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');

/** A single pickable row — shared shape for workspace and canonical logos. */
function LogoRow({
  thumbSrc,
  name,
  sub,
  selected,
  ariaLabel,
  onClick,
}: {
  thumbSrc: string;
  name: string;
  sub: string;
  selected: boolean;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={ariaLabel}
      className={`flex items-center gap-2 rounded-md border px-2 py-2 text-left hover:bg-accent ${
        selected ? 'border-primary ring-1 ring-primary' : ''
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={thumbSrc} alt="" className="h-8 w-8 shrink-0 object-contain" />
      <span className="min-w-0">
        <span className="block text-sm font-medium truncate">{name}</span>
        <span className="block text-xs text-muted-foreground">{sub}</span>
      </span>
    </button>
  );
}

function LogoPickerDialog({
  open,
  value,
  onClose,
  onPick,
}: {
  open: boolean;
  value: string;
  onClose: () => void;
  onPick: (url: string | null) => void;
}) {
  const { data: logos } = useLogos(open);
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const workspaceMatches = (logos ?? []).filter((l) =>
    l.displayName.toLowerCase().includes(q),
  );
  const canonicalMatches = CANONICAL_LOGOS.filter((l) =>
    l.displayName.toLowerCase().includes(q),
  );

  function pick(url: string) {
    onPick(url);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Choose a logo</DialogTitle>
        </DialogHeader>

        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search logos…"
          aria-label="Search logos"
        />

        <div className="space-y-4 max-h-80 overflow-y-auto">
          <section className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground">Your library</h3>
            {logos !== undefined && workspaceMatches.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {logos.length === 0
                  ? 'No logos yet. Add them in Workspace settings → Logo library.'
                  : 'No matches in your library.'}
              </p>
            )}
            {workspaceMatches.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {workspaceMatches.map((logo) => {
                  const url = logoPublicUrl(logo.id, APP_BASE);
                  return (
                    <LogoRow
                      key={logo.id}
                      thumbSrc={logoRepo.rawUrl(logo.id)}
                      name={logo.displayName}
                      sub={LOGO_CLASS_LABELS[logo.logoClass]}
                      selected={url === value}
                      ariaLabel={`Use ${logo.displayName}`}
                      onClick={() => pick(url)}
                    />
                  );
                })}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground">Built-in logos</h3>
            {canonicalMatches.length === 0 ? (
              <p className="text-sm text-muted-foreground">No matching built-in logos.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {canonicalMatches.map((logo) => {
                  const url = canonicalLogoUrl(logo.file, APP_BASE);
                  return (
                    <LogoRow
                      key={logo.id}
                      thumbSrc={canonicalLogoUrl(logo.small ?? logo.file)}
                      name={logo.displayName}
                      sub={CANONICAL_CLASS_LABELS[logo.logoClass]}
                      selected={url === value}
                      ariaLabel={`Use ${logo.displayName}`}
                      onClick={() => pick(url)}
                    />
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onPick(null)}>
            Clear
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A logo slot for a series — the venue or event burgee. Always a free URL
 * field (a scorer can still paste any URL); when the logo library is enabled it
 * also offers a picker over the workspace's flag locker plus the built-in
 * canonical set, writing a stable app-hosted URL so the chosen logo tracks the
 * library entry. A preview is shown only for one of those known-good URLs — a
 * half-typed external URL gets no broken-image preview.
 */
export function LogoField({
  id,
  label,
  value,
  onChange,
  placeholder = 'https://…',
  helpText,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (url: string) => void;
  placeholder?: string;
  helpText?: string;
}) {
  const { has } = useFeatures();
  const libraryEnabled = has('logo-library');
  const [pickerOpen, setPickerOpen] = useState(false);
  const isAppHosted = parseLogoId(value) !== null || parseCanonicalLogoFile(value) !== null;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        {isAppHosted && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt=""
            className="h-9 w-9 shrink-0 rounded border object-contain bg-muted"
          />
        )}
        <Input
          id={id}
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1"
        />
        {libraryEnabled && (
          <Button
            type="button"
            variant="outline"
            aria-label={`Choose ${label} from library`}
            onClick={() => setPickerOpen(true)}
          >
            Library
          </Button>
        )}
      </div>
      {helpText && <p className="text-xs text-muted-foreground">{helpText}</p>}

      {libraryEnabled && (
        <LogoPickerDialog
          open={pickerOpen}
          value={value}
          onClose={() => setPickerOpen(false)}
          onPick={(url) => {
            onChange(url ?? '');
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}
