'use client';

/**
 * Wraps the whole app chrome so that, at lg and up, the docked help panel
 * takes width from the page rather than covering it — the scorer needs to
 * see the screen the help is describing. Below lg there is no room to sit
 * side by side, so the panel overlays instead and this adds nothing.
 */
import { cn } from '@/lib/utils';

import { HelpPanel } from './panel';
import { useHelpPanel } from './provider';

export function HelpPanelFrame({ children }: { children: React.ReactNode }) {
  const { open } = useHelpPanel();
  return (
    <>
      <div className={cn('transition-[padding] duration-200', open && 'help-docked')}>
        {children}
      </div>
      <HelpPanel />
    </>
  );
}
