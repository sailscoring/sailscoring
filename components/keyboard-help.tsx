'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useActiveShortcuts } from '@/hooks/use-keyboard-shortcut';
import { useFeatures } from '@/components/features-provider';

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

function Section({
  title,
  rows,
}: {
  title: string;
  rows: { keys: string[]; altKeys?: string[]; action: string }[];
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <dl className="space-y-1.5">
        {rows.map(({ keys, altKeys, action }) => (
          <div key={action} className="flex items-center justify-between gap-6 text-sm">
            <dt className="text-muted-foreground">{action}</dt>
            <dd className="flex items-center gap-1.5">
              <Shortcut keys={keys} />
              {altKeys && (
                <>
                  <span className="text-xs text-muted-foreground">or</span>
                  <Shortcut keys={altKeys} />
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * The `?` dialog. The shortcut registry (`useShortcuts` / `useShortcutHelp`
 * in hooks/use-keyboard-shortcut.ts) is the source of truth: pages register
 * their shortcuts and the dialog shows whatever is active right now. Only
 * the app-wide items — the `?` key itself, the raw-handler globals, and the
 * `g` chords from `useChordShortcut` — stay static here.
 */
export function KeyboardHelp({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const active = useActiveShortcuts();
  const { has } = useFeatures();

  // Group registered entries by section, preserving first-seen section order
  // and per-section registration order.
  const sections = new Map<string, { keys: string[]; action: string }[]>();
  for (const entry of active) {
    const section = entry.section ?? 'This page';
    const rows = sections.get(section) ?? [];
    rows.push({
      keys: entry.displayKeys ?? [entry.key],
      action: entry.description ?? '',
    });
    sections.set(section, rows);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Shortcuts available on this page.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-1">
          <Section
            title="Global"
            rows={[
              { keys: ['?'], action: 'Show this help' },
              { keys: ['⇧', 'D'], action: 'Toggle dark mode' },
              { keys: ['⌃', 'S'], action: 'Save to file' },
              { keys: ['g', 'c'], action: 'Go to Competitors' },
              { keys: ['g', 'r'], action: 'Go to Races' },
              { keys: ['g', 's'], action: 'Go to Standings' },
              ...(has('prizes') ? [{ keys: ['g', 'p'], action: 'Go to Prizes' }] : []),
              { keys: ['g', 't'], action: 'Go to Settings' },
              { keys: ['g', 'h'], action: 'Go to History' },
            ]}
          />

          {[...sections.entries()].map(([title, rows]) => (
            <Section key={title} title={title} rows={rows} />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
