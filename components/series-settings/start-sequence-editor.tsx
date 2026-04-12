'use client';

import { useEffect, useState } from 'react';
import type { Fleet, StartGroup } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type StartSequenceEditorProps = {
  value: StartGroup[] | undefined;
  fleets: Fleet[];
  onSave: (next: StartGroup[] | undefined) => void | Promise<void>;
};

export function StartSequenceEditor({ value, fleets, onSave }: StartSequenceEditorProps) {
  const [groups, setGroups] = useState<StartGroup[]>(value ?? []);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setGroups(value ?? []);
    setDirty(false);
  }, [value]);

  const assignedFleetIds = new Set(groups.flatMap((g) => g.fleetIds));
  const unassignedFleets = fleets.filter((f) => !assignedFleetIds.has(f.id));

  function addGroup() {
    const offset = groups.length === 0 ? 0 : (groups[groups.length - 1].offsetMinutes + 3);
    setGroups([...groups, { fleetIds: [], offsetMinutes: offset }]);
    setDirty(true);
  }

  function removeGroup(index: number) {
    setGroups(groups.filter((_, i) => i !== index));
    setDirty(true);
  }

  function addFleetToGroup(groupIndex: number, fleetId: string) {
    setGroups(groups.map((g, i) => i === groupIndex ? { ...g, fleetIds: [...g.fleetIds, fleetId] } : g));
    setDirty(true);
  }

  function removeFleetFromGroup(groupIndex: number, fleetId: string) {
    setGroups(groups.map((g, i) => i === groupIndex ? { ...g, fleetIds: g.fleetIds.filter((id) => id !== fleetId) } : g));
    setDirty(true);
  }

  function setOffset(groupIndex: number, minutes: number) {
    setGroups(groups.map((g, i) => i === groupIndex ? { ...g, offsetMinutes: minutes } : g));
    setDirty(true);
  }

  async function save() {
    const nonEmpty = groups.filter((g) => g.fleetIds.length > 0);
    await onSave(nonEmpty.length > 0 ? nonEmpty : undefined);
    setDirty(false);
  }

  const fleetNameById = new Map(fleets.map((f) => [f.id, f.name]));

  return (
    <div className="border-t pt-3 mt-3 space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Default start sequence</h3>
      <p className="text-xs text-muted-foreground">
        Defines how fleets are grouped at the start line and the time between starts. Used as the default when creating new races.
      </p>
      {groups.map((group, i) => (
        <div key={i} className="flex items-center gap-2 text-sm border rounded-md px-3 py-2">
          <span className="text-xs text-muted-foreground w-14 shrink-0">Start {i + 1}</span>
          <div className="flex flex-wrap gap-1 flex-1">
            {group.fleetIds.map((id) => (
              <span key={id} className="inline-flex items-center gap-1 bg-muted px-2 py-0.5 rounded text-xs">
                {fleetNameById.get(id) ?? id}
                <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => removeFleetFromGroup(i, id)}>×</button>
              </span>
            ))}
            {unassignedFleets.length > 0 && (
              <Select onValueChange={(v) => addFleetToGroup(i, v)}>
                <SelectTrigger className="h-6 w-24 text-xs border-dashed">
                  <SelectValue placeholder="+ fleet" />
                </SelectTrigger>
                <SelectContent>
                  {unassignedFleets.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          {i > 0 && (
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-xs text-muted-foreground">+</span>
              <Input
                type="number"
                min={1}
                max={30}
                value={group.offsetMinutes}
                onChange={(e) => setOffset(i, parseInt(e.target.value, 10) || 0)}
                className="w-14 h-6 text-xs text-center"
              />
              <span className="text-xs text-muted-foreground">min</span>
            </div>
          )}
          <Button type="button" variant="ghost" size="sm" className="h-6 px-1 text-muted-foreground" onClick={() => removeGroup(i)}>×</Button>
        </div>
      ))}
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" className="text-xs" onClick={addGroup}>
          + Add start group
        </Button>
        {dirty && (
          <Button type="button" size="sm" className="text-xs" onClick={save}>
            Save sequence
          </Button>
        )}
      </div>
      {unassignedFleets.length > 0 && groups.length > 0 && (
        <p className="text-xs text-amber-600">
          {unassignedFleets.length} fleet{unassignedFleets.length === 1 ? '' : 's'} not assigned to a start group: {unassignedFleets.map((f) => f.name).join(', ')}
        </p>
      )}
    </div>
  );
}
