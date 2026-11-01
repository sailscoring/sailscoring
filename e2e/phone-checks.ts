import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { Page } from '@playwright/test';

/**
 * The checks every test makes when it runs at phone size (the `mobile`
 * project). They enforce *On a phone* in docs/design/ux/conventions.md
 * across the whole suite, the way the fixture already fails any test that
 * logs a console error: no spec asks for them, so every dialog and page the
 * suite reaches is checked without anyone writing a phone test for it.
 *
 * - **A dialog fits the screen.** One that overflows strands its buttons
 *   off-screen with nothing to scroll.
 * - **The page never scrolls sideways.** The report names the element that
 *   breaks out, so the fix doesn't start with a hunt.
 * - **Tapping a field doesn't zoom the page.** iOS zooms in on a focused
 *   field whose text is under 16px.
 * - **No text is squeezed out of sight.** A `truncate` label in a row too
 *   narrow for it shrinks to nothing rather than overflowing, so the page
 *   fits and the words are simply gone.
 *
 * The script runs in the page and reports through a binding, so a finding
 * survives the navigation that follows it.
 */
export async function installPhoneChecks(page: Page, report: (finding: string) => void, testTitle: string) {
  await page.exposeBinding('__phoneCheck', (_source, finding: string) => report(finding));
  if (process.env.E2E_PHONE_SHEET === '1') {
    await page.exposeBinding('__phoneSheet', (_source, path: string, dialog: string | null) =>
      captureForSheet(page, path, dialog, testTitle),
    );
  }
  await page.addInitScript(phoneChecksInPage);
}

declare global {
  interface Window {
    __phoneCheck?: (finding: string) => Promise<void>;
    __phoneSheet?: (path: string, dialog: string | null) => Promise<void>;
  }
}

/**
 * The phone sheet (`pnpm phone-sheet`): one screenshot of each page and each
 * dialog the suite reaches at phone size, for looking over by eye. The checks
 * catch a screen that's unusable; the sheet is for one that's merely cramped
 * or ugly. Written to screenshots/phone/ with a manifest that
 * scripts/phone-sheet.ts turns into a single page.
 */
export const PHONE_SHEET_DIR = resolve(__dirname, '..', 'screenshots', 'phone');

/** A route with its per-test parts (ids, the throwaway workspace) folded,
 *  so each screen is captured once however many tests visit it. */
export function routeKey(path: string): string {
  return path
    .split('/')
    .map((seg) =>
      /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(seg) || /^[A-Za-z0-9_-]{20,}$/.test(seg) || /\d{6,}/.test(seg)
        ? ':id'
        : seg,
    )
    .join('/') || '/';
}

const captured = new Set<string>();

async function captureForSheet(page: Page, path: string, dialog: string | null, testTitle: string) {
  const key = dialog ? `${routeKey(path)} · ${dialog}` : routeKey(path);
  if (captured.has(key)) return;
  captured.add(key);
  const file = `${key.replace(/[^A-Za-z0-9·]+/g, '_').replace(/·/g, '~').replace(/^_+|_+$/g, '') || 'root'}.png`;
  const out = join(PHONE_SHEET_DIR, file);
  // Another worker may have it already; first capture wins.
  if (existsSync(out)) return;
  mkdirSync(PHONE_SHEET_DIR, { recursive: true });
  try {
    await page.screenshot({ path: out, animations: 'disabled' });
  } catch {
    return; // the page moved on mid-capture; another visit will catch it
  }
  appendFileSync(join(PHONE_SHEET_DIR, 'manifest.jsonl'), JSON.stringify({ key, file, test: testTitle }) + '\n');
}

/** Serialised into the page by `addInitScript`, so it must be self-contained. */
function phoneChecksInPage() {
  const seen = new Set<string>();
  const report = (key: string, finding: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    void window.__phoneCheck?.(`${finding} — on ${location.pathname}`);
  };

  const describe = (el: Element): string => {
    const testId = el.getAttribute('data-testid');
    const label =
      el.getAttribute('aria-label') ??
      (el as HTMLElement).innerText?.trim().replace(/\s+/g, ' ').slice(0, 40);
    const cls = (el.getAttribute('class') ?? '').trim().split(/\s+/).slice(0, 6).join(' ');
    return [
      `<${el.tagName.toLowerCase()}>`,
      testId && `[data-testid=${testId}]`,
      cls && `class="${cls}…"`,
      label && `"${label}"`,
    ].filter(Boolean).join(' ');
  };

  // What the phone actually shows. Not innerWidth/innerHeight: once a page is
  // wider than the screen, a mobile browser widens the layout viewport to fit
  // it (innerWidth reports the 504px page, not the 390px phone), so measuring
  // against it would excuse the very overflow being checked for.
  const screenWidth = () => visualViewport?.width ?? document.documentElement.clientWidth;
  const screenHeight = () => visualViewport?.height ?? document.documentElement.clientHeight;
  const screenSize = () => `${Math.round(screenWidth())}×${Math.round(screenHeight())}`;

  // ── A dialog fits the screen ────────────────────────────────────────────
  const checkDialog = (dialog: Element) => {
    if (!dialog.isConnected) return;
    const r = dialog.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const left = visualViewport?.offsetLeft ?? 0;
    const top = visualViewport?.offsetTop ?? 0;
    if (
      r.top >= top - 1 && r.left >= left - 1 &&
      r.bottom <= top + screenHeight() + 1 && r.right <= left + screenWidth() + 1
    ) return;
    const title =
      dialog.querySelector('h2')?.textContent?.trim() ?? dialog.getAttribute('aria-label') ?? describe(dialog);
    report(
      `dialog:${title}`,
      `Dialog "${title}" doesn't fit the screen: it spans ` +
        `${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)} ` +
        `on a ${screenSize()} screen`,
    );
  };
  const watched = new WeakSet<Element>();
  const watchDialog = (dialog: Element) => {
    if (watched.has(dialog)) return;
    watched.add(dialog);
    // Measure once the opening zoom has finished (mid-animation the dialog is
    // scaled down, so it would measure smaller than it is), then again
    // whenever its size changes: content that loads after opening is what
    // usually pushes a dialog past the screen.
    void Promise.all(dialog.getAnimations().map((a) => a.finished.catch(() => undefined))).then(() => {
      checkDialog(dialog);
      new ResizeObserver(() => checkDialog(dialog)).observe(dialog);
    });
  };

  // ── The page never scrolls sideways ─────────────────────────────────────
  const clippedSideways = (el: Element): boolean => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      if (getComputedStyle(a).overflowX !== 'visible') return true;
    }
    return false;
  };
  const checkSideways = () => {
    const limit = screenWidth() + 1;
    if (document.documentElement.scrollWidth <= limit) return;
    // Name the elements that break out: past the right edge, not inside
    // something that scrolls or clips them, and whose parent stays inside
    // (so a wide table is reported once, not with every cell in it).
    const culprits: string[] = [];
    // Page coordinates, so a page the test has scrolled sideways measures the same.
    const right = (el: Element) => el.getBoundingClientRect().right + scrollX;
    for (const el of document.body.querySelectorAll('*')) {
      if (el.getBoundingClientRect().width === 0 || right(el) <= limit) continue;
      const parent = el.parentElement;
      if (parent && parent !== document.body && right(parent) > limit) continue;
      if (clippedSideways(el)) continue;
      culprits.push(`${describe(el)} reaches ${Math.round(right(el))}px`);
      if (culprits.length === 3) break;
    }
    const detail = culprits.length > 0 ? culprits.join('; ') : 'no single element found';
    report(
      `sideways:${location.pathname}:${culprits[0] ?? ''}`,
      `The page scrolls sideways (${document.documentElement.scrollWidth}px wide on a ${Math.round(screenWidth())}px screen): ${detail}`,
    );
  };

  // ── Tapping a field doesn't zoom the page ───────────────────────────────
  const TEXT_FIELD =
    'select, textarea, input:not([type=checkbox]):not([type=radio]):not([type=range])' +
    ':not([type=file]):not([type=button]):not([type=submit]):not([type=reset])' +
    ':not([type=color]):not([type=hidden]), [contenteditable=""], [contenteditable=true]';
  document.addEventListener(
    'focusin',
    (event) => {
      const el = event.target;
      if (!(el instanceof HTMLElement) || !el.matches(TEXT_FIELD)) return;
      // Desktop forms are compact on purpose; the floor is for phones, below
      // the md breakpoint where app/globals.css applies it.
      if (screenWidth() >= 768) return;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size >= 16) return;
      const what = describe(el);
      report(`zoom:${what}`, `Tapping ${what} zooms the page: its text is ${size}px, and iOS zooms in on fields under 16px`);
    },
    true,
  );

  // ── No text is squeezed out of sight ────────────────────────────────────
  const checkSqueezed = () => {
    for (const el of document.querySelectorAll('.truncate, [class*="line-clamp"], [data-slot=select-value]')) {
      const text = el.textContent?.trim();
      if (!text) continue;
      const r = el.getBoundingClientRect();
      // Not rendered at all is a different matter (display: none, a closed
      // panel); squeezed is laid out but with no room for even a letter.
      if (r.height === 0 || r.width >= 12) continue;
      if (getComputedStyle(el).position === 'absolute') continue;
      report(`squeezed:${text}`, `"${text.slice(0, 40)}" is squeezed out of sight (${Math.round(r.width)}px wide): ${describe(el)}`);
    }
  };

  // ── Run the checks as the page changes ──────────────────────────────────
  let pending: number | undefined;
  const scan = () => {
    pending = undefined;
    const dialogs = [...document.querySelectorAll('[role=dialog], [role=alertdialog]')];
    for (const dialog of dialogs) watchDialog(dialog);
    checkSideways();
    checkSqueezed();
    if (window.__phoneSheet) {
      const top = dialogs.at(-1);
      const title = top ? (top.querySelector('h2')?.textContent?.trim() ?? top.getAttribute('aria-label') ?? 'dialog') : null;
      void window.__phoneSheet(location.pathname, title);
    }
  };
  const schedule = () => {
    if (pending !== undefined) clearTimeout(pending);
    pending = window.setTimeout(scan, 250);
  };
  const start = () => {
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    addEventListener('resize', schedule);
    schedule();
  };
  if (document.body) start();
  else addEventListener('DOMContentLoaded', start, { once: true });
}
