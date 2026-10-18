// 使い方: node scripts/dumpframe.mjs --out=frames/start.bin [--seed=20260711] [--pos=x,y] [--press=KeyA] [--wait=3000]
//   ヘッドレスで 1 フレームぶん「量子化前」の内部バッファ(RGBA、427×240)を取り出してファイルに書く。
//   先頭 8 バイトは幅・高さ(Uint32 LE ×2)、続いて w*h*4 バイトの画素。
//   scripts/quantbench.ts が読み、quantizeRgba の実装違いを同じ画素で比べる(機械ノイズ無しの比較)。
import { mkdir, writeFile } from 'node:fs/promises';
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
const pos = args['--pos'];
const out = args['--out'] ?? 'frames/frame.bin';
const wait = Number(args['--wait'] ?? 3000);
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
try {
  await page.goto(url);
  await page.waitForTimeout(wait);
  if (press) {
    await page.keyboard.down(press);
    await page.waitForTimeout(500);
  }
  await page.evaluate(() => window.__captureRaw());
  await page.waitForTimeout(200);
  if (press) await page.keyboard.up(press);
  const frame = await page.evaluate(() => window.__rawFrame());
  if (!frame) throw new Error('生画素が取れなかった');
  const header = Buffer.alloc(8);
  header.writeUInt32LE(frame.w, 0);
  header.writeUInt32LE(frame.h, 4);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, Buffer.concat([header, Buffer.from(frame.data)]));
  console.log(`saved: ${out} (${frame.w}x${frame.h}, url: ${url})`);
} finally {
  await browser.close();
  await server.close();
}
