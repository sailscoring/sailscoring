/**
 * Render a self-contained HTML file to a PNG, using this repo's Playwright
 * Chromium (so no separate system Chrome is needed). Screenshots the `.page`
 * element if present, else the full page, at 2× for crisp output.
 *
 * Used to turn the governance repo's branded HTML builds (the sponsorship
 * strawman and the screenshot storyboard) into committed PNGs:
 *
 *   node ../governance/sponsorship/screenshots/build.js   # → storyboard.html
 *   npx tsx scripts/render-html.mjs \
 *     ../governance/sponsorship/screenshots/storyboard.html \
 *     ../governance/sponsorship/screenshots/storyboard.png
 */

import { chromium } from '@playwright/test';

const [, , htmlPath, outPath] = process.argv;
if (!htmlPath || !outPath) {
  console.error('usage: render-html.mjs <input.html> <output.png>');
  process.exit(1);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  await page.goto(new URL(htmlPath, `file://${process.cwd()}/`).href, {
    waitUntil: 'networkidle',
  });
  await page.waitForTimeout(300); // settle fonts/shadows
  const target = (await page.$('.page')) ?? page;
  await target.screenshot({ path: outPath });
  console.log('rendered', outPath);
} finally {
  await browser.close();
}
