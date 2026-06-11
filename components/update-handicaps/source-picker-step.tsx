'use client';

import { Button } from '@/components/ui/button';
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import type { HandicapSource } from './shared';

function SourceOption({
  value,
  current,
  onSelect,
  title,
  description,
}: {
  value: HandicapSource;
  current: HandicapSource;
  onSelect: (source: HandicapSource) => void;
  title: string;
  description: string;
}) {
  return (
    <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer">
      <input
        type="radio"
        name="source"
        className="mt-1"
        checked={current === value}
        onChange={() => onSelect(value)}
      />
      <div>
        <div className="font-medium">{title}</div>
        <div className="text-sm text-muted-foreground">{description}</div>
      </div>
    </label>
  );
}

export function SourcePickerStep({
  source,
  onSelect,
  gates,
  onNext,
  onCancel,
}: {
  source: HandicapSource;
  onSelect: (source: HandicapSource) => void;
  gates: {
    irishSailing: boolean;
    ircRating: boolean;
    ryaPy: boolean;
    vprsRating: boolean;
  };
  onNext: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Update handicaps</DialogTitle>
        <DialogDescription>
          Where should we pull handicaps from?
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3 py-2 min-h-0 overflow-y-auto">
        <SourceOption
          value="series"
          current={source}
          onSelect={onSelect}
          title="Another series in this workspace"
          description="Use the boat's handicap at the end of a prior series as its starting handicap here. Covers NHC, ECHO, IRC, and PY."
        />
        {gates.ircRating && (
          <SourceOption
            value="irc-rating"
            current={source}
            onSelect={onSelect}
            title="IRC TCC (international)"
            description="Pull each boat's current IRC TCC from the worldwide IRC rating list, matched by sail number."
          />
        )}
        {gates.vprsRating && (
          <SourceOption
            value="vprs-rating"
            current={source}
            onSelect={onSelect}
            title="VPRS TCC"
            description="Pull each boat's current VPRS TCC from a club's published rating list, matched by sail number."
          />
        )}
        {gates.irishSailing && (
          <SourceOption
            value="irish-sailing"
            current={source}
            onSelect={onSelect}
            title="Irish Sailing ECHO"
            description="Pull each boat's current ECHO handicap from the national Irish Sailing ratings list, matched by sail number."
          />
        )}
        {gates.ryaPy && (
          <SourceOption
            value="rya-py"
            current={source}
            onSelect={onSelect}
            title="RYA Portsmouth Yardstick"
            description="Set each class's PY number from the RYA's published list, and tidy class names to match. Matched by boat class, not sail number."
          />
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={onNext}>Next</Button>
      </DialogFooter>
    </>
  );
}
