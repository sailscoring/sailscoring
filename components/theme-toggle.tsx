'use client';

import { useTheme } from 'next-themes';
import { Moon, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { isInputFocused, useGlobalKeyDown } from '@/hooks/use-keyboard-shortcut';

/**
 * Light/dark toggle. A 2-state flip (light↔dark) over the already-branded
 * `.dark` design tokens; `next-themes` persists the choice to localStorage
 * and seeds it from the OS preference on first load (`defaultTheme="system"`).
 *
 * Shown always, including on signed-out pages. A global `Shift+D` shortcut
 * mirrors the button, guarded against firing while typing.
 *
 * The Sun/Moon icons are swapped with Tailwind's `dark:` variant rather than
 * a JS mounted-guard: `next-themes` injects the `dark` class pre-paint, so the
 * server and first client render are identical (hydration-safe) and CSS alone
 * shows the right glyph.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const toggle = () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');

  useGlobalKeyDown((e) => {
    if (
      e.shiftKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      (e.key === 'D' || e.key === 'd') &&
      !isInputFocused()
    ) {
      e.preventDefault();
      toggle();
    }
  });

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={toggle}
      aria-label="Toggle dark mode"
      title="Toggle dark mode (Shift+D)"
      className="text-muted-foreground"
    >
      <Sun className="h-4 w-4 dark:hidden" />
      <Moon className="hidden h-4 w-4 dark:block" />
    </Button>
  );
}
