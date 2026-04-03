'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

function Shortcut({ keys }: { keys: string[] }) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((k, i) => (
        <kbd
          key={i}
          className="inline-flex items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs leading-none text-muted-foreground"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

function Section({ title, rows }: { title: string; rows: { keys: string[]; action: string }[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <dl className="space-y-1.5">
        {rows.map(({ keys, action }) => (
          <div key={action} className="flex items-center justify-between gap-6 text-sm">
            <dt className="text-muted-foreground">{action}</dt>
            <dd>
              <Shortcut keys={keys} />
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function KeyboardHelp({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-1">
          <Section
            title="Global"
            rows={[
              { keys: ['?'], action: 'Show this help' },
              { keys: ['⌃', 'S'], action: 'Save to file' },
              { keys: ['g', 'c'], action: 'Go to Competitors' },
              { keys: ['g', 'r'], action: 'Go to Races' },
              { keys: ['g', 's'], action: 'Go to Standings' },
              { keys: ['g', 't'], action: 'Go to Settings' },
            ]}
          />

          <Section
            title="Competitors"
            rows={[
              { keys: ['n'], action: 'Add competitor' },
              { keys: ['i'], action: 'Import CSV' },
              { keys: ['e'], action: 'Edit focused row' },
              { keys: ['d'], action: 'Delete focused row' },
            ]}
          />

          <Section
            title="Races"
            rows={[
              { keys: ['n'], action: 'Add race' },
              { keys: ['↵'], action: 'Open focused race' },
              { keys: ['d'], action: 'Delete focused race' },
            ]}
          />

          <Section
            title="Standings"
            rows={[
              { keys: ['p'], action: 'Publish results' },
              { keys: ['x'], action: 'Export HTML' },
              { keys: ['f'], action: 'Upload via FTP' },
            ]}
          />

          <Section
            title="Finish entry"
            rows={[
              { keys: ['⌘', 'S'], action: 'Save results' },
              { keys: ['⌃', '↵'], action: 'Save results' },
              { keys: ['↑', '↓'], action: 'Navigate autocomplete' },
              { keys: ['↵'], action: 'Confirm / add finisher' },
              { keys: ['Esc'], action: 'Clear input or go back' },
              { keys: ['Tab'], action: 'Move between fields' },
              { keys: ['c'], action: 'Toggle start check-in tab' },
            ]}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
