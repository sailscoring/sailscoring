/**
 * Render a self-contained HTML file using this repo's Playwright Chromium (so
 * no separate system Chrome is needed). Output type follows the extension:
 *   .pdf  → a print PDF honouring the document's @page size (multi-page OK)
 *   .png  → a 2× screenshot of the `.page` element if present, else full page
 *
 * Used to turn the governance repo's branded HTML builds into their committed
 * artifacts — the multi-page introduction leaflet (PDF) and the screenshot
 * storyboard (PNG):
 *
 *   node ../governance/sponsorship/screenshots/build.js   # → storyboard.html
 *   npx tsx scripts/render-html.mjs \
 *     ../governance/sponsorship/screenshots/storyboard.html \
 *     ../governance/sponsorship/screenshots/storyboard.png
 */

import { chromium } from '@playwright/test';

const [, , htmlPath, outPath] = process.argv;
if (!htmlPath || !outPath) {
  console.error('usage: render-html.mjs <input.html> <output.{pdf,png}>');
  process.exit(1);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  await page.goto(new URL(htmlPath, `file://${process.cwd()}/`).href, {
    waitUntil: 'networkidle',
  });
  await page.waitForTimeout(300); // settle fonts/shadows
  if (outPath.endsWith('.pdf')) {
    // preferCSSPageSize honours the HTML's `@page { size: … }`.
    await page.pdf({ path: outPath, printBackground: true, preferCSSPageSize: true });
  } else {
    const target = (await page.$('.page')) ?? page;
    await target.screenshot({ path: outPath });
  }
  console.log('rendered', outPath);
} finally {
  await browser.close();
}
