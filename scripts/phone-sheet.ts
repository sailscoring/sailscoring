/**
 * Builds screenshots/phone/index.html from the shots `pnpm phone-sheet`
 * captured (see e2e/phone-checks.ts): every page and dialog the e2e suite
 * reached at phone size, side by side at phone width, labelled with its route
 * and the test that first reached it.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIR = resolve(__dirname, '..', 'screenshots', 'phone');
const MANIFEST = join(DIR, 'manifest.jsonl');

interface Shot {
  key: string;
  file: string;
  test: string;
}

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function main() {
  if (!existsSync(MANIFEST)) {
    console.error(`No shots in ${DIR}: run \`pnpm phone-sheet\`.`);
    process.exit(1);
  }
  const shots: Shot[] = readFileSync(MANIFEST, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Shot)
    .filter((s) => existsSync(join(DIR, s.file)))
    // One per screen: a manifest from before captures were claimed
    // exclusively can list a screen once per worker that reached it.
    .filter((s, i, all) => all.findIndex((t) => t.key === s.key) === i)
    .sort((a, b) => a.key.localeCompare(b.key));

  const pages = shots.filter((s) => !s.key.includes(' · '));
  const dialogs = shots.filter((s) => s.key.includes(' · '));
  const grid = (list: Shot[]) =>
    list
      .map(
        (s) => `<figure>
  <a href="${escape(s.file)}"><img src="${escape(s.file)}" loading="lazy" alt=""></a>
  <figcaption><strong>${escape(s.key)}</strong><br><span>${escape(s.test)}</span></figcaption>
</figure>`,
      )
      .join('\n');

  writeFileSync(
    join(DIR, 'index.html'),
    `<!doctype html>
<meta charset="utf-8">
<title>Phone sheet</title>
<style>
  body { font: 13px system-ui, sans-serif; margin: 16px; background: #f4f4f5; color: #18181b; }
  h2 { margin: 24px 0 8px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 16px; }
  figure { margin: 0; background: #fff; border: 1px solid #d4d4d8; border-radius: 6px; padding: 8px; }
  img { width: 100%; display: block; border: 1px solid #e4e4e7; }
  figcaption { margin-top: 6px; overflow-wrap: anywhere; }
  figcaption span { color: #71717a; }
</style>
<h1>Phone sheet</h1>
<p>${pages.length} pages and ${dialogs.length} dialogs the e2e suite reached at 390×664, captured on ${new Date().toISOString().slice(0, 10)}.</p>
<h2>Pages</h2>
<div class="grid">${grid(pages)}</div>
<h2>Dialogs</h2>
<div class="grid">${grid(dialogs)}</div>
`,
  );
  console.log(`Phone sheet: ${join(DIR, 'index.html')} (${pages.length} pages, ${dialogs.length} dialogs)`);
}

main();
