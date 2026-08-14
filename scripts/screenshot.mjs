// 使い方: node scripts/screenshot.mjs [--seed=20260711] [--out=screenshots/shot.png] [--pos=x,y] [--wait=2500] [--freeze=true] [--debug=hierarchy]
//   キー入力: [--press=KeyF] [--hold=800] [--capture=during|after] [--settle=400] [--mouse=x,y]
//   --press したキーを --hold ミリ秒押下する。--capture=during は押下中に撮影(溜め演出向け)、
//   after(既定)は離してから --settle ミリ秒待って撮影(発射・破壊痕向け)。
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
const debug = args['--debug'];
const press = args['--press'];
const hold = Number(args['--hold'] ?? 800);
const capture = args['--capture'] ?? 'after';
const settle = Number(args['--settle'] ?? 400);
const mouse = args['--mouse'];
const freeze = args['--freeze'] === 'true';

const server = await createServer({ logLevel: 'silent', server: { port: 0 } });
await server.listen();
const port = server.httpServer.address().port;
let url = `http://localhost:${port}/?seed=${seed}`;
if (pos) {
  const [x, y] = pos.split(',');
  url += `&x=${x}&y=${y}`;
}
if (debug) {
  url += `&debug=${debug}`;
}
if (freeze) {
  url += '&freeze=1';
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
let pageFailed = false;
page.on('pageerror', (e) => { pageFailed = true; console.error('[pageerror]', e); });
page.on('console', (m) => { if (m.type() === 'error') { pageFailed = true; console.error('[console]', m.text()); } });

try {
  await page.goto(url);
  await page.waitForTimeout(wait);

  // マウス位置(エイム方向=ビーム/破壊方向)。押下前に動かして角度を確定させる。
  if (mouse) {
    const [mx, my] = mouse.split(',').map(Number);
    await page.mouse.move(mx, my);
    await page.waitForTimeout(100);
  }

  // キー入力(溜め→発射など)。--capture=during は押下中、after は離してから撮る。
  if (press) {
    await page.keyboard.down(press);
    await page.waitForTimeout(hold);
    if (capture === 'during') {
      // 押下したまま撮影(離すと状態が消えるチャージ演出用)
    } else {
      await page.keyboard.up(press);
      await page.waitForTimeout(settle);
    }
  }

  await mkdir(dirname(out), { recursive: true });
  await page.screenshot({ path: out });
  console.log(`saved: ${out} (url: ${url})`);
} finally {
  await browser.close();
  await server.close();
}

if (pageFailed) {
  console.error('ページ内エラーあり — スクリーンショットは信頼できない');
  process.exitCode = 1;
}
