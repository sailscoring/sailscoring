'use client';

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Eye, EyeOff, Pencil, Trash2 } from 'lucide-react';
import { ftpServerRepo } from '@/lib/dexie-repository';
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
import type { FtpServer } from '@/lib/types';

function FtpServerDialog({
  open,
  initial,
  onClose,
}: {
  open: boolean;
  initial: FtpServer | null;
  onClose: () => void;
}) {
  const [host, setHost] = useState(initial?.host ?? '');
  const [port, setPort] = useState(initial?.port ?? 21);
  const [username, setUsername] = useState(initial?.username ?? '');
  const [password, setPassword] = useState(initial?.password ?? '');
  const [showPassword, setShowPassword] = useState(false);
  const [ftps, setFtps] = useState(initial?.ftps ?? false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    await ftpServerRepo.save({
      id: initial?.id ?? crypto.randomUUID(),
      host: host.trim(),
      port,
      username: username.trim(),
      password,
      ftps,
    });
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit FTP server' : 'Add FTP server'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ftp-host">Host</Label>
            <Input
              id="ftp-host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="ftp.example.com"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ftp-port">Port</Label>
              <Input
                id="ftp-port"
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(e) => setPort(parseInt(e.target.value) || 21)}
              />
            </div>
            <div className="flex items-end gap-2 pb-2.5">
              <input
                id="ftp-ftps"
                type="checkbox"
                checked={ftps}
                onChange={(e) => setFtps(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <label htmlFor="ftp-ftps" className="text-sm cursor-pointer">
                FTPS (TLS)
              </label>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ftp-username">Username</Label>
            <Input
              id="ftp-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ftp-password">Password</Label>
            <div className="relative">
              <Input
                id="ftp-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="pr-9"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 flex items-center px-2.5 text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
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

export default function SettingsPage() {
  const ftpServers = useLiveQuery(() => ftpServerRepo.list(), []);
  const [dialog, setDialog] = useState<{ open: boolean; server: FtpServer | null }>({
    open: false,
    server: null,
  });

  function openAdd() {
    setDialog({ open: true, server: null });
  }

  function openEdit(server: FtpServer) {
    setDialog({ open: true, server });
  }

  function closeDialog() {
    setDialog({ open: false, server: null });
  }

  async function handleDelete(id: string) {
    await ftpServerRepo.delete(id);
  }

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <div className="border rounded-lg p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">FTP servers</h2>
          <Button size="sm" variant="outline" onClick={openAdd}>
            Add server
          </Button>
        </div>

        {ftpServers === undefined && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}

        {ftpServers !== undefined && ftpServers.length === 0 && (
          <p className="text-sm text-muted-foreground">No FTP servers configured.</p>
        )}

        {ftpServers !== undefined && ftpServers.length > 0 && (
          <div className="space-y-2">
            {ftpServers.map((server) => (
              <div
                key={server.id}
                className="flex items-center justify-between border rounded-md px-3 py-2"
              >
                <p className="text-sm font-medium">
                  {server.ftps ? 'ftps' : 'ftp'}://{server.host}:{server.port}
                </p>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openEdit(server)}
                    aria-label={`Edit ${server.host}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(server.id)}
                    aria-label={`Delete ${server.host}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          FTP server credentials are stored on this device only and are never included in series
          file exports.
        </p>
      </div>

      <FtpServerDialog
        key={dialog.server?.id ?? 'new'}
        open={dialog.open}
        initial={dialog.server}
        onClose={closeDialog}
      />
    </div>
  );
}
