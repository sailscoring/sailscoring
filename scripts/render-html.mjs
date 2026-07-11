/**
 * Render a self-contained HTML file using this repo's Playwright Chromium (so
 * no separate system Chrome is needed). Output type follows the extension:
 *   .pdf  → a print PDF honouring the document's @page size (multi-page OK)
 *   .png  → a 2× screenshot of the `.page` element if present, else full page
 *
 * Used to turn branded HTML builds (introduction leaflets, screenshot
 * storyboards) into their committed artifacts:
 *
 *   npx tsx scripts/render-html.mjs storyboard.html storyboard.png
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
