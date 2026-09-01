import { enableFeatures } from './helpers';
import { signedInTest as test, expect } from './fixtures';

/**
 * The split-fleet help section speaks whichever championship vocabulary the
 * reader is using (app/help/vocabulary.tsx). On the chapter page that comes
 * from the URL first — the form a link from a series carries — then from
 * the reader's own pick, which is remembered, then the default. The
 * screenshot follows the words.
 */
test('the split-fleet help follows the vocabulary the link, then the reader, chose', async ({
  page,
  signedInEmail,
}) => {
  await enableFeatures(page, signedInEmail, ['split-fleets']);

  // A link carrying the 2026 ILCA wording opens in it, picture included.
  await page.goto('/help/running-a-series?vocab=qualification-final#split-fleets');
  const section = page.locator('#split-fleets');
  const control = section.locator('#help-vocabulary');
  await expect(control).toHaveValue('qualification-final');
  await expect(section.getByText('Set by the link you followed.')).toBeVisible();
  await expect(section).toContainText('Preliminary fleets');
  await expect(section.locator('img')).toHaveAttribute(
    'src',
    '/help/shots/split-fleets-qualification-final.webp',
  );
  // The comparison is the one place both vocabularies are named; the rest of
  // the section has no word from the other one.
  const prose = section.locator('p').filter({ hasText: 'Big one-design championships' });
  await expect(prose).not.toContainText('qualifying');

  // The reader flips it; the words and the picture follow.
  await control.selectOption('opening-medal');
  await expect(section).toContainText('qualifying fleets');
  await expect(section.locator('img')).toHaveAttribute('src', '/help/shots/split-fleets.webp');

  // Coming back cold, the pick is remembered.
  await page.goto('/help/running-a-series#split-fleets');
  await expect(control).toHaveValue('opening-medal');
  await expect(section.getByText('Remembered from your last visit.')).toBeVisible();

  // A link still wins over the memory: whoever sent it meant those words.
  await page.goto('/help/running-a-series?vocab=qualification-final#split-fleets');
  await expect(control).toHaveValue('qualification-final');
  await expect(section).toContainText('Preliminary fleets');
});
