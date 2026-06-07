'use client';

import { useState } from 'react';

import { useLogos } from '@/hooks/use-logos';
import { logoRepo } from '@/lib/api-repository';
import { logoPublicUrl, LOGO_CLASS_LABELS } from '@/lib/flag-locker';
import {
  canonicalLogoUrl,
  CANONICAL_LOGOS,
  CANONICAL_CLASS_LABELS,
} from '@/lib/canonical-logos';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** The canonical origin / app base used to build the *stored* (absolute where
 *  configured) URL a pick writes. Thumbnails use same-origin relative URLs. */
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

/**
 * Searchable logo picker over the workspace's flag locker plus the built-in
 * canonical set. Picking calls `onPick` with the chosen logo's stable URL
 * (workspace indirection or canonical), or `null` to clear. Shared by the
 * series venue/event slots (`LogoField`) and the workspace default-logo
 * controls — both store a URL, so both pick the same way and can reach the
 * canonical tier.
 */
export function LogoPickerDialog({
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
                      onClick={() => onPick(url)}
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
                      onClick={() => onPick(url)}
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
