'use client';

/**
 * The header's Help control. Opens the panel beside the working screen;
 * on the /help pages themselves, where the panel doesn't run, it stays the
 * plain link to the index it always was.
 */
import Link from 'next/link';

import { useHelpPanel } from './provider';

export function HelpToggle() {
  const { available, open, toggle } = useHelpPanel();

  if (!available) {
    return (
      <Link href="/help" className="text-sm text-muted-foreground hover:underline">
        Help
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={open}
      aria-controls="help-panel"
      title="Help (h)"
      className="text-sm text-muted-foreground hover:underline"
    >
      Help
    </button>
  );
}
