'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Fleet } from '@/lib/types';

export function FleetMappingTable({
  targetFleets,
  sourceFleets,
  fleetMapping,
  onChange,
}: {
  targetFleets: Fleet[];
  sourceFleets: Fleet[];
  fleetMapping: Record<string, string | null>;
  onChange: (next: Record<string, string | null>) => void;
}) {
  const handicapTargets = targetFleets.filter((f) => f.scoringSystem !== 'scratch');
  if (handicapTargets.length === 0) return null;

  return (
    <div className="space-y-1">
      <div className="text-sm font-medium">Fleet mapping</div>
      <div className="rounded-md border">
        {handicapTargets.map((tf, i) => {
          const candidates = sourceFleets.filter((sf) => sf.scoringSystem === tf.scoringSystem);
          const value = fleetMapping[tf.id] ?? '__skip__';
          return (
            <div
              key={tf.id}
              className={`flex items-center gap-3 p-2 ${i > 0 ? 'border-t' : ''}`}
            >
              <div className="flex-1 text-sm">
                <span className="font-medium">{tf.name}</span>{' '}
                <span className="text-muted-foreground">
                  ({tf.scoringSystem.toUpperCase()})
                </span>
              </div>
              <div className="text-muted-foreground text-sm">←</div>
              <Select
                value={value}
                onValueChange={(v) =>
                  onChange({ ...fleetMapping, [tf.id]: v === '__skip__' ? null : v })
                }
              >
                <SelectTrigger className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__skip__">— skip —</SelectItem>
                  {candidates.length === 0 && (
                    <SelectItem value="__none__" disabled>
                      No matching {tf.scoringSystem.toUpperCase()} fleet
                    </SelectItem>
                  )}
                  {candidates.map((sf) => (
                    <SelectItem key={sf.id} value={sf.id}>
                      {sf.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
