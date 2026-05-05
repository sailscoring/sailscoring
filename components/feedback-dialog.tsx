'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const MAX_LEN = 5000;

export function FeedbackDialog({
  open,
  onOpenChange,
  userEmail,
  pageUrl,
  userAgent,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  userEmail: string;
  pageUrl: string;
  userAgent: string;
}) {
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function handleOpenChange(o: boolean) {
    if (!o) {
      setMessage('');
      setError(null);
      setSuccess(false);
    }
    onOpenChange(o);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: message.trim(), pageUrl }),
      });
      if (res.ok) {
        setSuccess(true);
        setMessage('');
        return;
      }
      const body = (await res.json().catch(() => null)) as
        | { message?: string; error?: string }
        | null;
      setError(
        body?.message ||
          (res.status === 404
            ? 'Feedback is not enabled in this environment.'
            : 'Could not send feedback. Please try again.'),
      );
    } catch {
      setError('Could not send feedback. Please check your connection.');
    } finally {
      setSubmitting(false);
    }
  }

  const trimmedLen = message.trim().length;
  const canSubmit = trimmedLen > 0 && trimmedLen <= MAX_LEN && !submitting;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg" data-testid="feedback-dialog">
        <DialogHeader>
          <DialogTitle>Send feedback</DialogTitle>
          <DialogDescription>
            We read every message. Replies come from a real person, by email.
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="space-y-4">
            <p className="text-sm" data-testid="feedback-success">
              Thanks — feedback sent.
            </p>
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>Close</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4 min-w-0">
            <div className="space-y-1.5">
              <label htmlFor="feedback-message" className="text-sm font-medium">
                Message
              </label>
              <textarea
                id="feedback-message"
                data-testid="feedback-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={6}
                maxLength={MAX_LEN}
                autoFocus
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="What's on your mind?"
              />
              <div className="text-right text-xs text-muted-foreground">
                {trimmedLen} / {MAX_LEN}
              </div>
            </div>

            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1 min-w-0">
              <div className="font-medium text-foreground">We&apos;ll include:</div>
              <div className="break-all">
                <span className="font-mono">From:</span> {userEmail}
              </div>
              <div className="break-all">
                <span className="font-mono">Page:</span> {pageUrl || '—'}
              </div>
              <div className="break-all">
                <span className="font-mono">Browser:</span> {userAgent || '—'}
              </div>
            </div>

            {error && (
              <p className="text-sm text-destructive" data-testid="feedback-error">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit} data-testid="feedback-submit">
                {submitting ? 'Sending…' : 'Send'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
