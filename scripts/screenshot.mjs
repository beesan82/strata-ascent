// 使い方: node scripts/screenshot.mjs [--seed=20260711] [--out=screenshots/shot.png] [--pos=x,y] [--wait=2500]
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.split('=');
    return [k, v ?? ''];
  }),
);
const seed = args['--seed'] ?? '20260711';
const out = args['--out'] ?? 'screenshots/shot.png';
const wait = Number(args['--wait'] ?? 2500);
const pos = args['--pos'];

const server = await createServer({ logLevel: 'silent', server: { port: 0 } });
await server.listen();
const port = server.httpServer.address().port;
let url = `http://localhost:${port}/?seed=${seed}`;
if (pos) {
  const [x, y] = pos.split(',');
  url += `&x=${x}&y=${y}`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(url);
await page.waitForTimeout(wait);
await mkdir(dirname(out), { recursive: true });
await page.screenshot({ path: out });
await browser.close();
await server.close();
console.log(`saved: ${out} (url: ${url})`);
