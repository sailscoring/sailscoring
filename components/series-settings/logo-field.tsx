'use client';

import { useState } from 'react';

import { useFeatures } from '@/components/features-provider';
import { useLogos } from '@/hooks/use-logos';
import { logoRepo } from '@/lib/api-repository';
import { logoPublicUrl, parseLogoId, LOGO_CLASS_LABELS } from '@/lib/flag-locker';
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
import type { Logo } from '@/lib/types';

const APP_BASE = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');

function LogoPickerDialog({
  open,
  selectedId,
  onClose,
  onPick,
}: {
  open: boolean;
  selectedId: string | null;
  onClose: () => void;
  onPick: (logo: Logo | null) => void;
}) {
  const { data: logos } = useLogos(open);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Choose a logo</DialogTitle>
        </DialogHeader>

        {logos === undefined && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}

        {logos !== undefined && logos.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No logos yet. Add them in Workspace settings → Logo library.
          </p>
        )}

        {logos !== undefined && logos.length > 0 && (
          <div className="grid grid-cols-2 gap-2 max-h-80 overflow-y-auto">
            {logos.map((logo) => (
              <button
                key={logo.id}
                type="button"
                onClick={() => onPick(logo)}
                aria-pressed={logo.id === selectedId}
                className={`flex items-center gap-2 rounded-md border px-2 py-2 text-left hover:bg-accent ${
                  logo.id === selectedId ? 'border-primary ring-1 ring-primary' : ''
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={logoRepo.rawUrl(logo.id)}
                  alt={logo.displayName}
                  className="h-8 w-8 shrink-0 object-contain"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium truncate">{logo.displayName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {LOGO_CLASS_LABELS[logo.logoClass]}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

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
 * also offers a picker that writes the library indirection URL
 * (`logoPublicUrl`) so the chosen logo tracks the library entry. A preview is
 * shown only for a library selection, whose URL is known-good — a half-typed
 * external URL gets no broken-image preview.
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
  const selectedId = parseLogoId(value);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        {selectedId && (
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
          selectedId={selectedId}
          onClose={() => setPickerOpen(false)}
          onPick={(logo) => {
            onChange(logo ? logoPublicUrl(logo.id, APP_BASE) : '');
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}
