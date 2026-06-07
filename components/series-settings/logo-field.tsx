'use client';

import { useState } from 'react';

import { useFeatures } from '@/components/features-provider';
import { LogoPickerDialog } from '@/components/logo-picker-dialog';
import { parseLogoId } from '@/lib/flag-locker';
import { parseCanonicalLogoFile } from '@/lib/canonical-logos';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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
