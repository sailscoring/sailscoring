import { test, expect } from './fixtures';

// The toggle lives in the root-layout header, so it's present on every page
// including signed-out ones. Drive it from /sign-in to keep the test fast and
// independent of any series fixture. Pin the OS preference to light so the
// `system` default is deterministic.
test.use({ colorScheme: 'light' });

test.describe('dark-mode toggle', () => {
  test('flips the theme, persists across reload, and responds to Shift+D', async ({
    page,
  }) => {
    await page.goto('/sign-in');

    const html = page.locator('html');
    const toggle = page.getByRole('button', { name: /dark mode/i });

    // Starts light (system preference is light).
    await expect(html).toHaveClass(/light/);
    await expect(html).not.toHaveClass(/dark/);

    // Clicking flips to dark (and proves the page has hydrated).
    await toggle.click();
    await expect(html).toHaveClass(/dark/);

    // The global Shift+D shortcut flips it back to light.
    await page.keyboard.press('Shift+D');
    await expect(html).toHaveClass(/light/);
    await expect(html).not.toHaveClass(/dark/);

    // ...and back to dark, so we can confirm the choice persists.
    await page.keyboard.press('Shift+D');
    await expect(html).toHaveClass(/dark/);

    // The choice survives a full reload (localStorage, no flash-of-light).
    await page.reload();
    await expect(html).toHaveClass(/dark/);
    await expect(html).not.toHaveClass(/light/);
  });
});
