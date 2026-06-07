'use client';

import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';

import {
  useCreateLogo,
  useDeleteLogo,
  useLogos,
  useUpdateLogo,
} from '@/hooks/use-logos';
import { logoRepo } from '@/lib/api-repository';
import {
  isAllowedLogoContentType,
  LOGO_CLASS_LABELS,
  LOGO_CLASSES,
  LOGO_CONTENT_TYPES,
  MAX_LOGO_BYTES,
} from '@/lib/flag-locker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Logo, LogoClass } from '@/lib/types';

const ACCEPT = Object.keys(LOGO_CONTENT_TYPES).join(',');

/** Strip the `data:...;base64,` prefix off a FileReader data URL. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function LogoDialog({
  open,
  initial,
  onClose,
}: {
  open: boolean;
  initial: Logo | null;
  onClose: () => void;
}) {
  const createLogo = useCreateLogo();
  const updateLogo = useUpdateLogo();
  const editing = initial !== null;

  const [displayName, setDisplayName] = useState(initial?.displayName ?? '');
  const [logoClass, setLogoClass] = useState<LogoClass>(
    initial?.logoClass ?? 'sponsor',
  );
  const [sourceUrl, setSourceUrl] = useState(initial?.sourceUrl ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  function pickFile(f: File | null) {
    setError(null);
    if (!f) {
      setFile(null);
      return;
    }
    if (!isAllowedLogoContentType(f.type)) {
      setError(`Unsupported format. Use PNG, JPEG, GIF, WebP, or SVG.`);
      setFile(null);
      return;
    }
    if (f.size > MAX_LOGO_BYTES) {
      setError(`Too large — keep logos under ${MAX_LOGO_BYTES / 1024 / 1024} MB.`);
      setFile(null);
      return;
    }
    setFile(f);
    // Seed the name from the filename on first pick, if still blank.
    if (!displayName.trim()) {
      setDisplayName(f.name.replace(/\.[^.]+$/, ''));
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (editing) {
        await updateLogo.mutateAsync({
          id: initial.id,
          patch: { displayName: displayName.trim(), logoClass, sourceUrl: sourceUrl.trim() },
        });
      } else {
        if (!file) {
          setError('Choose an image file.');
          return;
        }
        const data = await fileToBase64(file);
        await createLogo.mutateAsync({
          id: crypto.randomUUID(),
          displayName: displayName.trim(),
          logoClass,
          contentType: file.type,
          data,
          sourceUrl: sourceUrl.trim(),
        });
      }
      onClose();
    } catch {
      setError('Could not save the logo. Please try again.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit logo' : 'Add logo'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-3">
          {!editing && (
            <div className="space-y-1.5">
              <Label htmlFor="logo-file">Image</Label>
              <Input
                id="logo-file"
                type="file"
                accept={ACCEPT}
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                PNG, JPEG, GIF, WebP, or SVG. A transparent background looks best in results headers.
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="logo-name">Name</Label>
            <Input
              id="logo-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Howth Yacht Club"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="logo-class">Type</Label>
            <Select value={logoClass} onValueChange={(v) => setLogoClass(v as LogoClass)}>
              <SelectTrigger id="logo-class" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOGO_CLASSES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {LOGO_CLASS_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="logo-source">Source URL (optional)</Label>
            <Input
              id="logo-source"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://www.hyc.ie"
            />
            <p className="text-xs text-muted-foreground">Where this logo came from — recorded for your reference.</p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function LogosCard() {
  const { data: logos } = useLogos();
  const deleteLogo = useDeleteLogo();
  const [dialog, setDialog] = useState<{ open: boolean; logo: Logo | null }>({
    open: false,
    logo: null,
  });

  function openAdd() {
    setDialog({ open: true, logo: null });
  }

  function openEdit(logo: Logo) {
    setDialog({ open: true, logo });
  }

  function closeDialog() {
    setDialog({ open: false, logo: null });
  }

  async function handleDelete(id: string) {
    await deleteLogo.mutateAsync(id);
  }

  return (
    <div className="bg-card border rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Logo library</h2>
        <Button size="sm" variant="outline" onClick={openAdd}>
          Add logo
        </Button>
      </div>

      {logos === undefined && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      {logos !== undefined && logos.length === 0 && (
        <p className="text-sm text-muted-foreground">No logos yet.</p>
      )}

      {logos !== undefined && logos.length > 0 && (
        <div className="space-y-2">
          {logos.map((logo) => (
            <div
              key={logo.id}
              className="flex items-center gap-3 border rounded-md px-3 py-2"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoRepo.rawUrl(logo.id)}
                alt={logo.displayName}
                className="h-8 w-8 shrink-0 object-contain"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{logo.displayName}</p>
                <p className="text-xs text-muted-foreground">
                  {LOGO_CLASS_LABELS[logo.logoClass]}
                </p>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => openEdit(logo)}
                  aria-label={`Edit ${logo.displayName}`}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDelete(logo.id)}
                  aria-label={`Delete ${logo.displayName}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Logos are shared with everyone in this workspace. Soon you&apos;ll be able to pick them when setting a series&apos; venue and event burgees.
      </p>

      <LogoDialog
        key={dialog.logo?.id ?? 'new'}
        open={dialog.open}
        initial={dialog.logo}
        onClose={closeDialog}
      />
    </div>
  );
}
