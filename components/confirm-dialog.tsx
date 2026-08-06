'use client';

/**
 * In-app replacement for `window.confirm()`.
 *
 * Chrome suppresses a native confirm whenever the page isn't the active
 * tab of the frontmost window — DevTools undocked into its own window is
 * enough to trigger it. A suppressed call returns `false`, so the guarded
 * action silently never runs and the button reads as dead. Native dialogs
 * are also unstyleable, plain-text only, and invisible to Playwright
 * unless a test registers a `dialog` handler.
 *
 * The hook is async so call sites keep the early-return shape the native
 * calls had:
 *
 *     const confirm = useConfirm();
 *     if (!(await confirm({ title: 'Delete race 3?' }))) return;
 *
 * Mounted once at the root (`app/providers.tsx`) rather than per page, so
 * a confirmation raised from inside another dialog lands on top of it,
 * and rows in a `.map()` don't each need their own open/closed state.
 */
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface ConfirmOptions {
  /** Question the button is answering, e.g. "Delete race 3?". */
  title: string;
  /** What actually happens if they say yes. */
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button in the destructive variant. */
  destructive?: boolean;
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

export function useConfirm(): Confirm {
  const fn = useContext(ConfirmContext);
  if (!fn) {
    throw new Error('useConfirm must be used inside <ConfirmDialogProvider>');
  }
  return fn;
}

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((answer: boolean) => void) | null>(null);

  const confirm = useCallback<Confirm>((options) => {
    // A second request while one is open would strand the first promise;
    // answering it `false` matches what dismissing the dialog would do.
    resolveRef.current?.(false);
    setPending(options);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const settle = useCallback((answer: boolean) => {
    resolveRef.current?.(answer);
    resolveRef.current = null;
    setPending(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          // Escape, the overlay, and the close button all read as "no",
          // the same as dismissing a native confirm.
          if (!open) settle(false);
        }}
      >
        {/* No close X: Cancel says the same thing, and dropping it makes
            Cancel the first focusable element, so the safe answer is the
            one that's focused when the dialog opens. */}
        <DialogContent
          className="max-w-sm"
          showCloseButton={false}
          data-testid="confirm-dialog"
        >
          <DialogHeader>
            <DialogTitle>{pending?.title}</DialogTitle>
            {pending?.description && (
              <DialogDescription>{pending.description}</DialogDescription>
            )}
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              data-testid="confirm-dialog-cancel"
              onClick={() => settle(false)}
            >
              {pending?.cancelLabel ?? 'Cancel'}
            </Button>
            <Button
              variant={pending?.destructive ? 'destructive' : 'default'}
              data-testid="confirm-dialog-confirm"
              onClick={() => settle(true)}
            >
              {pending?.confirmLabel ?? 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}
