'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { displayCompetitorLabel } from '@/lib/competitor-fields';
import type { Competitor, CompetitorFieldKey, Fleet } from '@/lib/types';

export interface ResolveUnknownDialogProps {
  /** When non-null, the dialog is open. The unknown entry being resolved. */
  unknownSailNumber: string | null;
  /** Candidate competitors to link to (typically non-finishers). */
  candidates: Pick<Competitor, 'id' | 'sailNumber' | 'names' | 'crewNames' | 'boatName'>[];
  fleets: Fleet[];
  primaryFieldLabel: string;
  showCrew: boolean;
  enabledCompetitorFields: CompetitorFieldKey[];
  onResolveExisting: (competitorId: string) => void;
  /** Create a new competitor and resolve to it. Throw to surface an error. */
  onResolveNew: (input: { sailNumber: string; name: string; fleetId: string }) => Promise<void>;
  onCancel: () => void;
}

export function ResolveUnknownDialog(props: ResolveUnknownDialogProps) {
  if (props.unknownSailNumber === null) return null;
  return (
    <ResolveUnknownDialogInner
      key={props.unknownSailNumber}
      {...props}
      unknownSailNumber={props.unknownSailNumber}
    />
  );
}

function ResolveUnknownDialogInner({
  unknownSailNumber,
  candidates,
  fleets,
  primaryFieldLabel,
  showCrew,
  enabledCompetitorFields,
  onResolveExisting,
  onResolveNew,
  onCancel,
}: ResolveUnknownDialogProps & { unknownSailNumber: string }) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [sail, setSail] = useState(unknownSailNumber);
  const [name, setName] = useState('');
  const [fleetId, setFleetId] = useState(fleets[0]?.id ?? '');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function openAddForm() {
    setSail(unknownSailNumber);
    setName('');
    setFleetId(fleets[0]?.id ?? '');
    setError('');
    setShowAddForm(true);
  }

  async function submitNew() {
    const trimmedName = name.trim();
    const trimmedSail = sail.trim().toUpperCase();
    if (!trimmedName) { setError(`${primaryFieldLabel} name is required.`); return; }
    if (!trimmedSail) { setError('Sail number is required.'); return; }
    setSubmitting(true);
    setError('');
    try {
      await onResolveNew({ sailNumber: trimmedSail, name: trimmedName, fleetId });
    } catch (err) {
      console.error(err);
      setError('Failed to add competitor. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent
        className="max-w-sm"
        onKeyDown={(e) => {
          // Stop the page-level Escape handler (which leaves the page) from
          // firing when the user presses Escape in the dialog.
          if (e.key === 'Escape') {
            e.stopPropagation();
            onCancel();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Resolve sail {unknownSailNumber}</DialogTitle>
          <DialogDescription>
            {!showAddForm
              ? 'Select a registered competitor, or add a new one.'
              : 'Add a new competitor and link them to this finish.'}
          </DialogDescription>
        </DialogHeader>

        {!showAddForm ? (
          <>
            <div className="space-y-1 max-h-52 overflow-y-auto">
              {candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground px-3 py-2">
                  No unfinished competitors available.
                </p>
              ) : (
                candidates.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-accent text-sm text-left"
                    onClick={() => onResolveExisting(c.id)}
                  >
                    <span className="font-mono font-medium w-16 shrink-0">{c.sailNumber}</span>
                    <span className="flex-1 truncate">{displayCompetitorLabel(c, { enabledCompetitorFields, showCrew })}</span>
                  </button>
                ))
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <div className="flex-1 border-t" />
              <span>or</span>
              <div className="flex-1 border-t" />
            </div>
            <Button variant="outline" size="sm" onClick={openAddForm}>
              Add new competitor
            </Button>
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Keep as unknown
            </Button>
          </>
        ) : (
          <>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="resolve-sail">Sail number</label>
                <Input
                  id="resolve-sail"
                  value={sail}
                  onChange={(e) => setSail(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="resolve-name">{primaryFieldLabel} name *</label>
                <Input
                  id="resolve-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="off"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submitNew(); } }}
                />
              </div>
              {fleets.length > 1 && (
                <div className="space-y-1">
                  <label className="text-sm font-medium" htmlFor="resolve-fleet">Fleet</label>
                  <Select value={fleetId} onValueChange={setFleetId}>
                    <SelectTrigger id="resolve-fleet">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {fleets.map((f) => (
                        <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
            </div>
            <div className="flex gap-2">
              <Button onClick={() => void submitNew()} disabled={submitting} size="sm">
                {submitting ? 'Adding…' : 'Add and resolve'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAddForm(false)}
                disabled={submitting}
              >
                Back
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
