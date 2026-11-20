import next from 'eslint-config-next/core-web-vitals';

/**
 * SWC drops the leading space of a multi-line JSX text node when that node also
 * contains an HTML character entity. When the node follows an inline element the
 * lost space is the one separating two words, so `<strong>ranking</strong> is a
 * season\n ladder` renders as "rankingis a season ladder". Fixed upstream in
 * swc-project/swc#11474 but not yet in the SWC that Next bundles; write the
 * character itself (’ “ ” — →) instead of an entity and the trigger is gone.
 */
const INLINE_TAGS = new Set([
  'a',
  'abbr',
  'b',
  'code',
  'em',
  'i',
  'kbd',
  'label',
  'mark',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'time',
  'u',
]);

const noEntityAfterInlineElement = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow HTML entities in a multi-line JSX text node that follows an inline element, where SWC eats the separating space',
    },
    schema: [],
    messages: {
      glued:
        'HTML entities in this text node make SWC drop the space after </{{tag}}>, gluing the words together. Write the character itself (’ “ ” — →) instead of {{entity}}.',
    },
  },
  create(context) {
    return {
      JSXText(node) {
        const raw = context.sourceCode.getText(node);
        if (!/^[ \t]+\S/.test(raw)) return;
        if (!raw.includes('\n')) return;
        const entity = raw.match(/&[a-zA-Z][a-zA-Z0-9]*;|&#\d+;/);
        if (!entity) return;
        const siblings = node.parent.children ?? [];
        const previous = siblings[siblings.indexOf(node) - 1];
        if (previous?.type !== 'JSXElement') return;
        const tag = previous.openingElement.name;
        if (tag.type !== 'JSXIdentifier' || !INLINE_TAGS.has(tag.name)) return;
        context.report({
          node,
          messageId: 'glued',
          data: { tag: tag.name, entity: entity[0] },
        });
      },
    };
  },
};

/**
 * On a phone, `vh` (and Tailwind's `h-screen`, which is `100vh`) measures the
 * screen as if the browser's address bar were hidden, so a `max-h-[50vh]`
 * region is more than half of what's actually visible and a `90vh` dialog
 * runs off the bottom. `dvh` tracks the visible area. See *On a phone* in
 * docs/design/ux/conventions.md.
 */
const VH_CLASS = /-\[[^\]\s]*\d(?:\.\d+)?vh\b[^\]\s]*\]|(?<![\w-])(?:min-|max-)?h-screen\b/;

const noViewportVh = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow vh-based Tailwind heights, which overshoot the visible area on a phone' },
    schema: [],
    messages: {
      vh: '`{{found}}` measures the screen as if the address bar were hidden, so on a phone it overshoots what is visible. Use dvh instead (e.g. max-h-[50dvh], min-h-dvh).',
    },
  },
  create(context) {
    const check = (node, text) => {
      const found = typeof text === 'string' ? text.match(VH_CLASS) : null;
      if (found) context.report({ node, messageId: 'vh', data: { found: found[0].replace(/^-/, '') } });
    };
    return {
      Literal(node) { check(node, node.value); },
      TemplateElement(node) { check(node, node.value.cooked); },
    };
  },
};

const config = [
  ...next,
  {
    plugins: {
      sailscoring: {
        rules: {
          'no-entity-after-inline-element': noEntityAfterInlineElement,
          'no-viewport-vh': noViewportVh,
        },
      },
    },
    rules: { 'sailscoring/no-entity-after-inline-element': 'error' },
  },
  {
    files: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'hooks/**/*.{ts,tsx}'],
    rules: { 'sailscoring/no-viewport-vh': 'error' },
  },
  /**
   * Chrome suppresses native dialogs whenever the page isn't the active tab
   * of the frontmost window, and a suppressed confirm() returns false — the
   * guarded action silently never runs. Use `useConfirm()` instead; alert()
   * and prompt() have no in-app equivalent because neither belongs in a
   * scoring flow.
   */
  {
    files: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'hooks/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'confirm',
          message: 'Chrome silently suppresses native dialogs — use useConfirm() from @/components/confirm-dialog.',
        },
        { name: 'alert', message: 'Chrome silently suppresses native dialogs — render the message in the page.' },
        { name: 'prompt', message: 'Chrome silently suppresses native dialogs — use a dialog with an input.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'confirm',
          message: 'Chrome silently suppresses native dialogs — use useConfirm() from @/components/confirm-dialog.',
        },
        { object: 'window', property: 'alert', message: 'Chrome silently suppresses native dialogs — render the message in the page.' },
        { object: 'window', property: 'prompt', message: 'Chrome silently suppresses native dialogs — use a dialog with an input.' },
      ],
    },
  },
  {
    ignores: [
      // Agent worktrees: a second checkout of this repo living inside it.
      // Everything below is path-anchored, so a worktree's copy of `e2e/` or
      // `tests/` escapes the entries beneath and gets linted under rules those
      // directories are exempt from — every warning doubled, plus errors from
      // files that lint clean where they actually live.
      '.claude/**',
      'e2e/**',
      'tests/**',
      'public/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
];

export default config;
