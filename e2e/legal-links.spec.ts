import { test, expect } from './fixtures';

test.describe('legal links', () => {
  test('sign-in form shows consent line with Terms and Privacy links', async ({
    page,
  }) => {
    await page.goto('/sign-in');

    const consent = page.getByText(
      /By signing in or creating an account, you agree to the/i,
    );
    await expect(consent).toBeVisible();

    const terms = consent.getByRole('link', { name: 'Terms' });
    await expect(terms).toHaveAttribute(
      'href',
      'https://sailscoring.ie/legal/terms',
    );
    await expect(terms).toHaveAttribute('target', '_blank');

    const privacy = consent.getByRole('link', { name: 'Privacy Policy' });
    await expect(privacy).toHaveAttribute(
      'href',
      'https://sailscoring.ie/legal/privacy',
    );
    await expect(privacy).toHaveAttribute('target', '_blank');
  });

  test('footer renders Privacy and Terms links', async ({ page }) => {
    await page.goto('/sign-in');

    const footer = page.getByRole('contentinfo');
    await expect(footer).toBeVisible();

    const privacy = footer.getByRole('link', { name: 'Privacy' });
    await expect(privacy).toHaveAttribute(
      'href',
      'https://sailscoring.ie/legal/privacy',
    );
    await expect(privacy).toHaveAttribute('target', '_blank');

    const terms = footer.getByRole('link', { name: 'Terms' });
    await expect(terms).toHaveAttribute(
      'href',
      'https://sailscoring.ie/legal/terms',
    );
    await expect(terms).toHaveAttribute('target', '_blank');
  });
});
