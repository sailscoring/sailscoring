'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Trash2 } from 'lucide-react';

import {
  useCopyLogo,
  useCreateLogo,
  useDeleteLogo,
  useLogoDefaults,
  useLogos,
  useLogosFrom,
  useSetLogoDefaults,
  useSetWorkspaceLogo,
  useUpdateLogo,
} from '@/hooks/use-logos';
import { useWorkspaceMemberships } from '@/components/workspace-memberships-provider';
import { LogoPickerDialog } from '@/components/logo-picker-dialog';
import { logoRepo } from '@/lib/api-repository';
import {
  isAllowedLogoContentType,
  LOGO_CLASS_LABELS,
  LOGO_CLASSES,
  LOGO_CONTENT_TYPES,
  logoPublicUrl,
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

/** The workspace's own logo (`organization.logo`) — shown in the workspace
 *  switcher and used as the default-default venue logo for new series. Chosen
 *  with the shared picker (own logos or a built-in one). */
function WorkspaceLogoSection() {
  const router = useRouter();
  const { memberships, activeOrganizationId } = useWorkspaceMemberships();
  const active = memberships.find((m) => m.organizationId === activeOrganizationId);
  const setWorkspaceLogo = useSetWorkspaceLogo();
  const [picking, setPicking] = useState(false);
  // Local override so the preview updates instantly, before the server-rendered
  // memberships refresh catches up.
  const [localLogo, setLocalLogo] = useState<string | null>(null);
  const logo = localLogo ?? active?.logo ?? '';

  async function choose(url: string | null) {
    setLocalLogo(url ?? '');
    setPicking(false);
    await setWorkspaceLogo.mutateAsync(url ?? '');
    router.refresh();
  }

  return (
    <div className="space-y-3 pb-1">
      <p className="text-sm font-medium">Workspace logo</p>
      <div className="flex items-center gap-3">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo}
            alt=""
            className="h-8 w-8 shrink-0 rounded border object-contain bg-muted"
          />
        ) : (
          <span className="text-sm text-muted-foreground">None</span>
        )}
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          aria-label="Choose workspace logo"
          onClick={() => setPicking(true)}
        >
          {logo ? 'Change…' : 'Choose…'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Shown in the workspace switcher, and the default venue logo for new series unless you set one below.
      </p>

      <LogoPickerDialog
        open={picking}
        value={logo}
        onClose={() => setPicking(false)}
        onPick={choose}
      />
    </div>
  );
}

/** Workspace default venue/event logos — a new series inherits these into its
 *  empty burgee slots (copy-at-creation). Stored as URLs, so a default can be a
 *  workspace logo or a built-in canonical one; chosen with the shared picker. */
function DefaultsSection() {
  const { data: defaults } = useLogoDefaults();
  const setDefaults = useSetLogoDefaults();
  const [picking, setPicking] = useState<null | 'venue' | 'event'>(null);

  const venueLogoUrl = defaults?.venueLogoUrl ?? '';
  const eventLogoUrl = defaults?.eventLogoUrl ?? '';

  function choose(slot: 'venue' | 'event', url: string | null) {
    setDefaults.mutate({
      venueLogoUrl: slot === 'venue' ? (url ?? '') : venueLogoUrl,
      eventLogoUrl: slot === 'event' ? (url ?? '') : eventLogoUrl,
    });
    setPicking(null);
  }

  const rows: Array<{ key: 'venue' | 'event'; label: string; url: string }> = [
    { key: 'venue', label: 'Default venue logo', url: venueLogoUrl },
    { key: 'event', label: 'Default event logo', url: eventLogoUrl },
  ];

  return (
    <div className="space-y-3 border-t pt-4">
      <p className="text-sm font-medium">Defaults for new series</p>
      {rows.map((row) => (
        <div key={row.key} className="flex items-center gap-3">
          <Label className="w-32 shrink-0 text-sm font-normal">{row.label}</Label>
          {row.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={row.url}
              alt=""
              className="h-8 w-8 shrink-0 rounded border object-contain bg-muted"
            />
          ) : (
            <span className="text-sm text-muted-foreground">None</span>
          )}
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            aria-label={`Choose ${row.label}`}
            onClick={() => setPicking(row.key)}
          >
            {row.url ? 'Change…' : 'Choose…'}
          </Button>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        A new series starts with these logos; you can change them per series.
        Existing series keep their own logos, but ones that leave a slot empty
        fall back to these when published.
      </p>

      <LogoPickerDialog
        open={picking !== null}
        value={picking === 'venue' ? venueLogoUrl : picking === 'event' ? eventLogoUrl : ''}
        onClose={() => setPicking(null)}
        onPick={(url) => {
          if (picking) choose(picking, url);
        }}
      />
    </div>
  );
}

/** Copy a logo from another workspace the scorer belongs to into this one. A
 *  copy, not a link: the logo keeps working here if the source changes it. */
function CopyFromWorkspaceDialog({
  open,
  targets,
  onClose,
}: {
  open: boolean;
  targets: { organizationId: string; name: string }[];
  onClose: () => void;
}) {
  const [sourceId, setSourceId] = useState('');
  const { data: sourceLogos } = useLogosFrom(sourceId || null, open);
  const copyLogo = useCopyLogo();
  const [copiedIds, setCopiedIds] = useState<Set<string>>(new Set());

  async function handleCopy(id: string) {
    await copyLogo.mutateAsync({ sourceWorkspaceId: sourceId, sourceLogoId: id });
    setCopiedIds((prev) => new Set(prev).add(id));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Copy from another workspace</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Select
            value={sourceId}
            onValueChange={(v) => {
              setSourceId(v);
              setCopiedIds(new Set());
            }}
          >
            <SelectTrigger className="w-full" data-testid="copy-source-workspace">
              <SelectValue placeholder="Choose a workspace…" />
            </SelectTrigger>
            <SelectContent>
              {targets.map((m) => (
                <SelectItem key={m.organizationId} value={m.organizationId}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {sourceId && sourceLogos === undefined && (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
          {sourceId && sourceLogos?.length === 0 && (
            <p className="text-sm text-muted-foreground">That workspace has no logos.</p>
          )}
          {sourceLogos && sourceLogos.length > 0 && (
            <div className="grid grid-cols-1 gap-2 max-h-80 overflow-y-auto">
              {sourceLogos.map((logo) => (
                <div
                  key={logo.id}
                  className="flex items-center gap-2 border rounded-md px-2 py-2"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={logoPublicUrl(logo.id)}
                    alt={logo.displayName}
                    className="h-8 w-8 shrink-0 object-contain"
                  />
                  <span className="min-w-0 flex-1 text-sm truncate">{logo.displayName}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={copiedIds.has(logo.id) || copyLogo.isPending}
                    aria-label={`Copy ${logo.displayName}`}
                    onClick={() => handleCopy(logo.id)}
                  >
                    {copiedIds.has(logo.id) ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
  const { memberships, activeOrganizationId } = useWorkspaceMemberships();
  const copyTargets = memberships.filter(
    (m) => m.organizationId !== activeOrganizationId,
  );
  const [dialog, setDialog] = useState<{ open: boolean; logo: Logo | null }>({
    open: false,
    logo: null,
  });
  const [copyOpen, setCopyOpen] = useState(false);

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
        <div className="flex gap-2">
          {copyTargets.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setCopyOpen(true)}>
              Copy from workspace…
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={openAdd}>
            Add logo
          </Button>
        </div>
      </div>

      <WorkspaceLogoSection />

      <div className="border-t pt-4 space-y-4">
      <p className="text-sm font-medium">Logos</p>

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
        Logos are shared with everyone in this workspace. Pick one for a series&apos; venue and event burgees in its Basic settings.
      </p>
      </div>

      {logos !== undefined && <DefaultsSection />}

      <LogoDialog
        key={dialog.logo?.id ?? 'new'}
        open={dialog.open}
        initial={dialog.logo}
        onClose={closeDialog}
      />

      {copyTargets.length > 0 && (
        <CopyFromWorkspaceDialog
          open={copyOpen}
          targets={copyTargets}
          onClose={() => setCopyOpen(false)}
        />
      )}
    </div>
  );
}
