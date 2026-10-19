// 使い方: node scripts/frametime.mjs [--seed=20260711] [--pos=x,y] [--wait=3000] [--seconds=4] [--budget=16.7] [--press=KeyD]
//   ヘッドレス Chromium(既定=ソフトウェア描画、GPU なし)でページを開き、--wait ミリ秒待ってから
//   --seconds 秒間 requestAnimationFrame の間隔(ms)を集め、p50 / p95 / max を表示する。
//   p95 が --budget(既定 16.7 ms = 60 fps の 1 フレーム)を超えたら終了コード 1。
import { createServer } from 'vite';
import { chromium } from 'playwright';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.split('=');
    return [k, v ?? ''];
  }),
);
const seed = args['--seed'] ?? '20260711';
const pos = args['--pos'];
const wait = Number(args['--wait'] ?? 3000);
const seconds = Number(args['--seconds'] ?? 4);
const budget = Number(args['--budget'] ?? 16.7);
// 計測中に押し続けるキー(例: --press=KeyD で右へ歩く)。立ち止まった場面だけでなく移動中の予算を見る
const press = args['--press'];

const server = await createServer({ logLevel: 'silent', server: { port: 0 } });
await server.listen();
const port = server.httpServer.address().port;
let url = `http://localhost:${port}/?seed=${seed}&stats=1`;
if (pos) {
  const [x, y] = pos.split(',');
  url += `&x=${x}&y=${y}`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
let pageFailed = false;
page.on('pageerror', (e) => { pageFailed = true; console.error('[pageerror]', e); });
page.on('console', (m) => { if (m.type() === 'error') { pageFailed = true; console.error('[console]', m.text()); } });

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

try {
  await page.goto(url);
  await page.waitForTimeout(wait);
  if (press) await page.keyboard.down(press);
  // ページ内で rAF 間隔を集める(main.ts の rAF ループと同じ vsync 刻みで呼ばれる)
  const intervals = await page.evaluate((ms) => new Promise((resolve) => {
    const out = [];
    let last = performance.now();
    const end = last + ms;
    const tick = (now) => {
      out.push(now - last);
      last = now;
      if (now < end) requestAnimationFrame(tick);
      else resolve(out);
    };
    requestAnimationFrame(tick);
  }), seconds * 1000);
  if (press) await page.keyboard.up(press);
  const sorted = [...intervals].sort((a, b) => a - b);
  const p50 = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  const max = sorted[sorted.length - 1];
  console.log(`frames=${sorted.length} p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms max=${max.toFixed(2)}ms (url: ${url})`);
  // renderer.render の所要時間(main.ts の ?stats=1)。rAF 間隔は vsync 刻みに量子化されるので、こちらで余裕を見る
  const stats = await page.evaluate(() => ({
    render: (window.__renderMs ?? []).slice(-240),
    present: (window.__presentMs ?? []).slice(-240),
  }));
  for (const [name, arr] of Object.entries(stats)) {
    if (arr.length === 0) continue;
    const rs = [...arr].sort((a, b) => a - b);
    console.log(`${name}: p50=${percentile(rs, 0.5).toFixed(2)}ms p95=${percentile(rs, 0.95).toFixed(2)}ms max=${rs[rs.length - 1].toFixed(2)}ms (n=${rs.length})`);
  }
  if (p95 > budget) {
    console.error(`p95 ${p95.toFixed(2)} ms が予算 ${budget} ms を超過`);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
  await server.close();
}

if (pageFailed) {
  console.error('ページ内エラーあり — 計測は信頼できない');
  process.exitCode = 1;
}
