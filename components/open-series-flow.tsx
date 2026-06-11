'use client';

import { Loader2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useFeatures } from '@/components/features-provider';
import type { useOpenSeriesFile } from '@/hooks/use-open-series-file';

/**
 * The open/import flow's hidden file input and step dialogs: format chooser,
 * confirm-new (with category filing), disambiguate, confirm-update, working,
 * and error. The state machine lives in hooks/use-open-series-file.ts;
 * render this once on any page that calls the hook.
 */
export function OpenSeriesFlow({ flow }: { flow: ReturnType<typeof useOpenSeriesFile> }) {
  const { has } = useFeatures();
  const {
    openFlow, setOpenFlow, importFormat, fileInputRef, categories,
    handleFormatChosen, handleFileSelected,
    openNewFromFile, handleDisambiguate, handleConfirmUpdate,
  } = flow;

  const flowFile = openFlow.step === 'disambiguate' || openFlow.step === 'confirm-update'
    ? openFlow.file
    : null;
  const flowExisting = openFlow.step === 'disambiguate' || openFlow.step === 'confirm-update'
    ? openFlow.existing
    : null;

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={importFormat === 'sailwave' ? '.blw' : '.sailscoring,application/json'}
        className="hidden"
        onChange={handleFileSelected}
      />

      {/* Format-choice dialog (first step of Import) */}
      <Dialog
        open={openFlow.step === 'choose-format'}
        onOpenChange={(open) => { if (!open) setOpenFlow({ step: 'idle' }); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Series</DialogTitle>
            <DialogDescription>What kind of file would you like to import?</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <button
              type="button"
              data-testid="import-format-sailscoring"
              className="w-full text-left border rounded-lg px-4 py-3 hover:bg-accent/50 transition-colors"
              onClick={() => handleFormatChosen('sailscoring')}
            >
              <div className="font-medium">Sail Scoring file</div>
              <div className="text-sm text-muted-foreground">A <span className="font-mono">.sailscoring</span> file saved from this app.</div>
            </button>
            {has('sailwave-import') && (
              <button
                type="button"
                data-testid="import-format-sailwave"
                className="w-full text-left border rounded-lg px-4 py-3 hover:bg-accent/50 transition-colors"
                onClick={() => handleFormatChosen('sailwave')}
              >
                <div className="font-medium">Sailwave file</div>
                <div className="text-sm text-muted-foreground">A <span className="font-mono">.blw</span> series file from Sailwave.</div>
              </button>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenFlow({ step: 'idle' })}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm new-series import (.sailscoring) — pick a category */}
      <Dialog
        open={openFlow.step === 'confirm-new'}
        onOpenChange={(open) => { if (!open) setOpenFlow({ step: 'idle' }); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Import &ldquo;{openFlow.step === 'confirm-new' ? openFlow.file.series.name : ''}&rdquo;?
            </DialogTitle>
            <DialogDescription>
              This will open the file as a new series in your scoring app.
            </DialogDescription>
          </DialogHeader>
          {openFlow.step === 'confirm-new' && (
            <div className="space-y-4">
              <div className="space-y-2 text-sm">
                {openFlow.file.series.venue && (
                  <div>
                    <span className="text-muted-foreground">Venue:</span> {openFlow.file.series.venue}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{openFlow.file.competitors.length} competitors</Badge>
                  <Badge variant="secondary">{openFlow.file.races.length} races</Badge>
                  <Badge variant="secondary">{openFlow.file.fleets.length} fleets</Badge>
                  <Badge variant="outline">
                    Saved {new Date(openFlow.file.exportedAt).toLocaleDateString()}
                  </Badge>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="import-category">Category</Label>
                <Select
                  value={openFlow.categoryId ?? 'none'}
                  onValueChange={(v) =>
                    setOpenFlow((prev) =>
                      prev.step === 'confirm-new'
                        ? { ...prev, categoryId: v === 'none' ? null : v }
                        : prev,
                    )
                  }
                >
                  <SelectTrigger id="import-category" className="w-full" data-testid="import-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Uncategorized</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenFlow({ step: 'idle' })}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (openFlow.step !== 'confirm-new') return;
                openNewFromFile(openFlow.file, openFlow.categoryId);
              }}
            >
              Open series
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Disambiguate dialog */}
      <Dialog
        open={openFlow.step === 'disambiguate'}
        onOpenChange={(open) => { if (!open) setOpenFlow({ step: 'idle' }); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>&ldquo;{flowExisting?.name}&rdquo; is already in your workspace</DialogTitle>
            <DialogDescription>
              The file you opened and the copy in your workspace are the same series.
              What would you like to do?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenFlow({ step: 'idle' })}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => handleDisambiguate('new-copy')}>
              Open as a new copy
            </Button>
            <Button onClick={() => handleDisambiguate('update')}>
              Update the workspace copy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm update-from-file dialog */}
      <Dialog
        open={openFlow.step === 'confirm-update'}
        onOpenChange={(open) => { if (!open) setOpenFlow({ step: 'idle' }); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update &ldquo;{flowExisting?.name}&rdquo; from file?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Your workspace copy will be replaced with the contents of this file.
                  This cannot be undone.
                </p>
                {flowFile && flowExisting && (
                  <div className="text-sm">
                    <p>This file: saved {new Date(flowFile.exportedAt).toLocaleString()}</p>
                    <p>Workspace copy: last modified {new Date(flowExisting.lastModifiedAt).toLocaleString()}</p>
                  </div>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenFlow({ step: 'idle' })}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => handleConfirmUpdate(true)}>
              Open as a new copy
            </Button>
            <Button onClick={() => handleConfirmUpdate(false)}>Update</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Working dialog */}
      <Dialog open={openFlow.step === 'working'}>
        <DialogContent
          showCloseButton={false}
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Opening series…</DialogTitle>
            <DialogDescription>
              Loading the series file. This may take a moment for large series.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center py-2">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </DialogContent>
      </Dialog>

      {/* Error dialog */}
      <Dialog
        open={openFlow.step === 'error'}
        onOpenChange={(open) => { if (!open) setOpenFlow({ step: 'idle' }); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Could not open file</DialogTitle>
            <DialogDescription>
              {openFlow.step === 'error' ? openFlow.message : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setOpenFlow({ step: 'idle' })}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
