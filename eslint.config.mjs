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

const config = [
  ...next,
  {
    plugins: {
      sailscoring: { rules: { 'no-entity-after-inline-element': noEntityAfterInlineElement } },
    },
    rules: { 'sailscoring/no-entity-after-inline-element': 'error' },
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
