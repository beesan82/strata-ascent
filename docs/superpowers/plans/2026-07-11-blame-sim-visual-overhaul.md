# ビジュアル刷新「弐瓶勉ディテール」実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「闇+ライト」のルックを維持したまま、照らされた範囲に原作級のディテール(ハッチング・配管・ケーブル・パネル・リベット)が浮かぶ画面に刷新する。

**Architecture:** チャンク焼き込み方式。`decor.ts`(純粋関数)がチャンクの装飾を描画命令リストとして計算し、`chunkbake.ts` がチャンク単位のオフスクリーンCanvas(16px/タイル)に一度だけ焼き込む。毎フレームは焼き込み画像のdrawImage+パララックス遠景+人影スプライト+ライト+グレインの合成のみ。Playwrightのスクリーンショットハーネスで実装者自身が見た目を確認する。

**Tech Stack:** 既存(Vite/TS/Canvas 2D)+ Playwright(devDependencyのみ)

**参照スペック:** `docs/superpowers/specs/2026-07-11-blame-sim-visual-overhaul-design.md`
**ビジュアル基準:** `.superpowers/brainstorm/2943-1783775075/content/look-c-quality.html` の右側モックアップ(ユーザー承認済み、さらに密度増量の指示あり)

**重要な約束(全タスク共通):**
- 装飾はすべて `hash2(seed+salt, ...)` でワールド座標から決定論的に生成。チャンク境界をまたぐ装飾は「ワールド座標に整列したセグメント単位」で判定するため、隣接チャンクが独立に同じ結論を出し、継ぎ目なく繋がる
- 見た目の定数(色・太さ・確率)は初期値。**スクリーンショットで目視確認し、モックアップの印象に近づける範囲での調整は実装者の裁量**(調整したらコミットに含める)
- ゲームプレイ(衝突・生成)には一切影響しない。既存テスト40件は全タスクで回帰なし維持

---

### Task 1: スクリーンショットハーネス

**Files:**
- Modify: `package.json`(devDependency + script追加)
- Create: `scripts/screenshot.mjs`
- Modify: `src/main.ts`(デバッグ用スポーン上書き)
- Modify: `.gitignore`

- [ ] **Step 1: Playwrightを導入**

Run: `npm install -D playwright && npx playwright install chromium`
Expected: インストール成功(chromiumのダウンロードに1〜2分かかる)

- [ ] **Step 2: main.tsにスポーン上書きを追加**

`src/main.ts` の `const spawn = findSpawn(seed);` を以下に置換:

```ts
// デバッグ/スクリーンショット用: ?x=&y= でスポーン位置を上書き(埋まり座標は自己責任)
const qx = params.get('x');
const qy = params.get('y');
const spawn = qx !== null && qy !== null ? { x: Number(qx), y: Number(qy) } : findSpawn(seed);
```

- [ ] **Step 3: スクリーンショットスクリプトを作成**

`scripts/screenshot.mjs`:

```js
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
```

`package.json` の scripts に追加: `"shot": "node scripts/screenshot.mjs"`

`.gitignore` に追加:

```
screenshots/
```

- [ ] **Step 4: 動作確認(現状のベースライン)**

Run: `node scripts/screenshot.mjs --out=screenshots/baseline.png`
Expected: PNGが生成される。Readツールで開いて「闇+ライト円錐+平板な矩形」の現状ルックが写っていることを確認

Run: `npm test && npx tsc --noEmit`
Expected: 40/40、型エラーなし

- [ ] **Step 5: コミット**

```bash
git add package.json package-lock.json scripts/screenshot.mjs src/main.ts .gitignore
git commit -m "chore: Playwrightスクリーンショットハーネスとデバッグスポーン"
```

---

### Task 2: decor.ts 基本装飾(エッジ・継ぎ目・リベット・ハッチ・梯子)

**Files:**
- Create: `src/render/decor.ts`
- Test: `src/render/decor.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/render/decor.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TILE } from '../world/tiles';
import { tileAt } from '../world/worldgen';
import { decorateChunk, PALETTE } from './decor';

describe('decorateChunk', () => {
  it('同一シード・同一チャンクなら同一の装飾リスト(決定論)', () => {
    expect(decorateChunk(42, 1, 1)).toEqual(decorateChunk(42, 1, 1));
  });

  it('装飾の種類が一通り出現する(広域統計)', () => {
    const kinds = new Set<string>();
    const colors = new Set<string>();
    for (let cx = 0; cx < 4; cx++) {
      for (let cy = -2; cy < 2; cy++) {
        for (const op of decorateChunk(42, cx, cy)) {
          kinds.add(op.kind);
          if ('color' in op) colors.add(op.color);
        }
      }
    }
    expect(kinds).toContain('line');
    expect(kinds).toContain('dot');
    expect(kinds).toContain('hatch');
    // エッジハイライトと梯子レールは必ずどこかにある
    expect(colors).toContain(PALETTE.edgeTop);
    expect(colors).toContain(PALETTE.rail);
  });

  it('ハッチングは内部タイル(全方向SOLID)にのみ付く', () => {
    for (const op of decorateChunk(42, 1, 1)) {
      if (op.kind !== 'hatch') continue;
      const wx = 1 * 64 + Math.floor(op.x);
      const wy = 1 * 64 + Math.floor(op.y);
      expect(tileAt(42, wx, wy)).toBe(TILE.SOLID);
      expect(tileAt(42, wx, wy - 1)).toBe(TILE.SOLID);
      expect(tileAt(42, wx, wy + 1)).toBe(TILE.SOLID);
      expect(tileAt(42, wx - 1, wy)).toBe(TILE.SOLID);
      expect(tileAt(42, wx + 1, wy)).toBe(TILE.SOLID);
    }
  });

  it('梯子タイルにはレール2本と踏み桟が付く', () => {
    // チャンク(1,1)内の梯子タイルを1つ探す
    let found = false;
    for (let ly = 0; ly < 64 && !found; ly++) {
      for (let lx = 0; lx < 64 && !found; lx++) {
        if (tileAt(42, 64 + lx, 64 + ly) !== TILE.LADDER) continue;
        found = true;
        const ops = decorateChunk(42, 1, 1).filter(
          (op) =>
            op.kind === 'line' &&
            op.color === PALETTE.rail &&
            Math.floor(op.x1) === lx &&
            Math.floor(op.y1) === ly,
        );
        expect(ops.length).toBe(2); // 縦レール2本
      }
    }
    expect(found).toBe(true);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/render/decor.test.ts`
Expected: FAIL(`./decor` モジュールが存在しない)

- [ ] **Step 3: 実装**

`src/render/decor.ts`:

```ts
import { hash2 } from '../world/noise';
import { stratumIndexAt } from '../world/strata';
import { CHUNK_SIZE, TILE } from '../world/tiles';
import { tileAt } from '../world/worldgen';

/**
 * 装飾の描画命令。座標はチャンクローカルのタイル単位(浮動小数)。
 * チャンク境界をまたぐ装飾は範囲外の座標を取ることがある(焼き込み時にクリップされる)。
 */
export type DecorOp =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; w: number; color: string }
  | { kind: 'dot'; x: number; y: number; r: number; color: string }
  | { kind: 'poly'; pts: number[]; w: number; color: string; fill?: boolean }
  | { kind: 'hatch'; x: number; y: number; w: number; h: number; spacing: number; color: string };

/** 装飾の色パレット(すべて暗色。ライトに照らされて初めて質感として読める) */
export const PALETTE = {
  edgeTop: '#4a545e',
  edgeSide: '#39424b',
  seam: '#0a0d10',
  rivet: '#3b434b',
  hatch: '#2b3238',
  pipe: '#252c33',
  pipeThin: '#1f262c',
  bracket: '#30383f',
  cable: '#20262c',
  wire: '#191f24',
  grill: '#39424b',
  debris: '#1a2026',
  debrisLine: '#39424b',
  rail: '#39424b',
  rung: '#2c343b',
  hoop: '#242b31',
} as const;

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** チャンク(cx, cy)の装飾を計算する純粋関数。同じ入力なら常に同じ出力 */
export function decorateChunk(seed: number, cx: number, cy: number): DecorOp[] {
  const ops: DecorOp[] = [];
  const bx = cx * CHUNK_SIZE;
  const by = cy * CHUNK_SIZE;
  const t = (lx: number, ly: number) => tileAt(seed, bx + lx, by + ly);
  const solid = (lx: number, ly: number) => t(lx, ly) === TILE.SOLID;

  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    const wy = by + ly;
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const wx = bx + lx;
      const tile = t(lx, ly);
      if (tile === TILE.LADDER) {
        ladderOps(ops, wx, wy, lx, ly);
        continue;
      }
      if (tile !== TILE.SOLID) continue;

      const upAir = !solid(lx, ly - 1);
      const downAir = !solid(lx, ly + 1);
      const leftAir = !solid(lx - 1, ly);
      const rightAir = !solid(lx + 1, ly);

      // エッジハイライト(空気に面した輪郭。上面は明るく太く)
      if (upAir) ops.push({ kind: 'line', x1: lx, y1: ly + 0.06, x2: lx + 1, y2: ly + 0.06, w: 0.12, color: PALETTE.edgeTop });
      if (downAir) ops.push({ kind: 'line', x1: lx, y1: ly + 0.97, x2: lx + 1, y2: ly + 0.97, w: 0.06, color: PALETTE.edgeSide });
      if (leftAir) ops.push({ kind: 'line', x1: lx + 0.03, y1: ly, x2: lx + 0.03, y2: ly + 1, w: 0.06, color: PALETTE.edgeSide });
      if (rightAir) ops.push({ kind: 'line', x1: lx + 0.97, y1: ly, x2: lx + 0.97, y2: ly + 1, w: 0.06, color: PALETTE.edgeSide });

      // パネル継ぎ目(ワールド座標基準なのでチャンクをまたいで連続する)
      const seamV = hash2(seed + 601, wx, 0) < 0.22;
      if (seamV && !rightAir) {
        ops.push({ kind: 'line', x1: lx + 1, y1: ly, x2: lx + 1, y2: ly + 1, w: 0.08, color: PALETTE.seam });
        if (upAir) ops.push({ kind: 'dot', x: lx + 1, y: ly + 0.35, r: 0.07, color: PALETTE.rivet });
      }
      const seamH = hash2(seed + 602, 0, wy) < 0.16;
      if (seamH && !downAir) {
        ops.push({ kind: 'line', x1: lx, y1: ly + 1, x2: lx + 1, y2: ly + 1, w: 0.08, color: PALETTE.seam });
        if (hash2(seed + 603, wx, wy) < 0.35) {
          ops.push({ kind: 'dot', x: lx + 0.5, y: ly + 1, r: 0.07, color: PALETTE.rivet });
        }
      }

      // 内部ハッチング(露出面のないタイルのみ。階層で密度が変わる)
      if (!upAir && !downAir && !leftAir && !rightAir) {
        const spacing = 0.3 + 0.1 * (stratumIndexAt(wy) % 3);
        ops.push({ kind: 'hatch', x: lx, y: ly, w: 1, h: 1, spacing, color: PALETTE.hatch });
      }
    }
  }
  return ops;
}

/** 梯子1タイル分: レール2本+踏み桟+4タイルごとの背かご */
function ladderOps(ops: DecorOp[], wx: number, wy: number, lx: number, ly: number): void {
  ops.push({ kind: 'line', x1: lx + 0.25, y1: ly, x2: lx + 0.25, y2: ly + 1, w: 0.1, color: PALETTE.rail });
  ops.push({ kind: 'line', x1: lx + 0.75, y1: ly, x2: lx + 0.75, y2: ly + 1, w: 0.1, color: PALETTE.rail });
  ops.push({ kind: 'line', x1: lx + 0.25, y1: ly + 0.5, x2: lx + 0.75, y2: ly + 0.5, w: 0.08, color: PALETTE.rung });
  if (mod(wy, 4) === 0) {
    ops.push({
      kind: 'poly',
      pts: [lx - 0.05, ly + 0.2, lx + 0.15, ly - 0.05, lx + 0.5, ly - 0.15, lx + 0.85, ly - 0.05, lx + 1.05, ly + 0.2],
      w: 0.07,
      color: PALETTE.hoop,
    });
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/render/decor.test.ts`
Expected: PASS(4件)

- [ ] **Step 5: コミット**

```bash
git add src/render/decor.ts src/render/decor.test.ts
git commit -m "feat: 装飾計算(エッジ・継ぎ目・リベット・ハッチ・梯子)"
```

---

### Task 3: decor.ts セグメント装飾(配管・瓦礫・ケーブル・壁面)

**Files:**
- Modify: `src/render/decor.ts`
- Test: `src/render/decor.test.ts`(追記)

装飾はワールド座標に整列したセグメント単位で判定する(床配管=16タイル、天井ケーブル=8タイル、壁面=縦4タイル)。セグメントがチャンク境界をまたいでも、両側のチャンクが同じハッシュから同じ結論を出すので絵が繋がる。

- [ ] **Step 1: 失敗するテストを追記**

`src/render/decor.test.ts` に追記:

```ts
describe('decorateChunk セグメント装飾', () => {
  it('広域には配管・ケーブル・瓦礫・壁面装飾のいずれもが出現する', () => {
    const colors = new Set<string>();
    for (let cx = 0; cx < 6; cx++) {
      for (let cy = -3; cy < 3; cy++) {
        for (const op of decorateChunk(42, cx, cy)) {
          if ('color' in op) colors.add(op.color);
        }
      }
    }
    expect(colors).toContain(PALETTE.pipe);
    expect(colors).toContain(PALETTE.cable);
    expect(colors).toContain(PALETTE.debris);
    expect(colors).toContain(PALETTE.grill);
  });

  it('床配管は床上面のあるセグメントにのみ載る(配管線の下は必ずSOLID)', () => {
    for (let cx = 0; cx < 3; cx++) {
      for (const op of decorateChunk(42, cx, 1)) {
        if (op.kind !== 'line' || op.color !== PALETTE.pipe) continue;
        // 配管は水平線。中点の直下タイルがSOLID、配管自身の位置はSOLIDでない
        const midX = cx * 64 + Math.floor((op.x1 + op.x2) / 2);
        const y = 1 * 64 + Math.floor(op.y1);
        expect(tileAt(42, midX, y + 1)).toBe(TILE.SOLID);
        expect(tileAt(42, midX, y)).not.toBe(TILE.SOLID);
      }
    }
  });

  it('天井ケーブルのアンカーは天井面にある(始点直上がSOLID)', () => {
    for (let cx = 0; cx < 3; cx++) {
      for (const op of decorateChunk(42, cx, 1)) {
        if (op.kind !== 'poly' || op.color !== PALETTE.cable) continue;
        const x0 = cx * 64 + Math.floor(op.pts[0]);
        const y0 = 1 * 64 + Math.floor(op.pts[1]);
        expect(tileAt(42, x0, y0 - 1)).toBe(TILE.SOLID);
      }
    }
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/render/decor.test.ts`
Expected: FAIL(新テスト3件。既存4件はPASSのまま)

- [ ] **Step 3: 実装(decorateChunkの末尾でsegmentOpsを呼ぶ)**

`src/render/decor.ts` の `decorateChunk` のreturn直前に `segmentOps(ops, seed, bx, by);` を追加し、ファイル末尾に以下を追加:

```ts
/** ワールド座標整列セグメント単位の装飾(チャンク境界で継ぎ目が出ない) */
function segmentOps(ops: DecorOp[], seed: number, bx: number, by: number): void {
  const t = (wx: number, wy: number) => tileAt(seed, wx, wy);

  // ── 床: 16タイルセグメント。全タイルが「上面が空気のSOLID」なら配管か瓦礫 ──
  const fs0 = Math.floor((bx - 16) / 16);
  const fs1 = Math.floor((bx + CHUNK_SIZE + 16) / 16);
  for (let ly = -1; ly <= CHUNK_SIZE; ly++) {
    const wy = by + ly;
    for (let s = fs0; s <= fs1; s++) {
      const x0 = s * 16;
      let ok = true;
      for (let i = 0; i < 16 && ok; i++) {
        ok = t(x0 + i, wy) === TILE.SOLID && t(x0 + i, wy - 1) !== TILE.SOLID;
      }
      if (!ok) continue;
      const lx0 = x0 - bx;
      const r = hash2(seed + 701, s, wy);
      if (r < 0.45) {
        // 這う配管(太)+ときどき細い並走管、3〜5タイルごとにブラケット
        const yy = ly - 0.22;
        ops.push({ kind: 'line', x1: lx0, y1: yy, x2: lx0 + 16, y2: yy, w: 0.22, color: PALETTE.pipe });
        if (r < 0.22) {
          ops.push({ kind: 'line', x1: lx0, y1: yy - 0.3, x2: lx0 + 16, y2: yy - 0.3, w: 0.13, color: PALETTE.pipeThin });
        }
        for (let i = 2; i < 16; i += 5) {
          ops.push({ kind: 'line', x1: lx0 + i, y1: yy, x2: lx0 + i, y2: ly, w: 0.1, color: PALETTE.bracket });
        }
      } else if (r < 0.58) {
        // 瓦礫の山
        const dx = lx0 + 3 + hash2(seed + 702, s, wy) * 8;
        ops.push({
          kind: 'poly',
          pts: [dx, ly, dx + 0.8, ly - 0.55, dx + 1.5, ly - 0.3, dx + 2.2, ly - 0.7, dx + 3, ly],
          w: 0,
          color: PALETTE.debris,
          fill: true,
        });
        ops.push({
          kind: 'poly',
          pts: [dx + 0.3, ly - 0.1, dx + 0.9, ly - 0.45, dx + 1.4, ly - 0.25],
          w: 0.06,
          color: PALETTE.debrisLine,
        });
      }
    }
  }

  // ── 天井: 8タイルセグメント。全タイルが「下面が空気のSOLID」ならケーブル ──
  const cs0 = Math.floor((bx - 8) / 8);
  const cs1 = Math.floor((bx + CHUNK_SIZE + 8) / 8);
  for (let ly = -1; ly <= CHUNK_SIZE; ly++) {
    const wy = by + ly;
    for (let s = cs0; s <= cs1; s++) {
      const x0 = s * 8;
      let ok = true;
      for (let i = 0; i < 8 && ok; i++) {
        ok = t(x0 + i, wy) === TILE.SOLID && t(x0 + i, wy + 1) !== TILE.SOLID;
      }
      if (!ok) continue;
      const lx0 = x0 - bx;
      const r = hash2(seed + 703, s, wy);
      if (r < 0.35) {
        // カテナリーケーブル(2次ベジェを9点でサンプリング)
        const sag = 1 + hash2(seed + 704, s, wy) * 2.2;
        const pts: number[] = [];
        for (let i = 0; i <= 8; i++) {
          const u = i / 8;
          const x = lx0 + u * 8;
          const y = ly + 1 + 2 * sag * u * (1 - u); // 2次ベジェの中点押し下げ
          pts.push(x, y);
        }
        ops.push({ kind: 'poly', pts, w: 0.09, color: PALETTE.cable });
      } else if (r < 0.5) {
        // 切れて垂れる短いワイヤー
        const wx0 = lx0 + 1 + Math.floor(hash2(seed + 705, s, wy) * 6);
        const len = 0.8 + hash2(seed + 706, s, wy) * 1.2;
        const bend = 0.25 * (hash2(seed + 707, s, wy) - 0.5);
        ops.push({
          kind: 'poly',
          pts: [wx0, ly + 1, wx0 + bend, ly + 1 + len * 0.6, wx0 + bend * 2.5, ly + 1 + len],
          w: 0.06,
          color: PALETTE.wire,
        });
      }
    }
  }

  // ── 壁面: 縦4タイルセグメント。左右どちらかに面が露出していたらグリル/縦配管 ──
  const ws0 = Math.floor((by - 4) / 4);
  const ws1 = Math.floor((by + CHUNK_SIZE + 4) / 4);
  for (let lx = -1; lx <= CHUNK_SIZE; lx++) {
    const wx = bx + lx;
    for (let s = ws0; s <= ws1; s++) {
      const y0 = s * 4;
      for (const dir of [-1, 1] as const) {
        let ok = true;
        for (let i = 0; i < 4 && ok; i++) {
          ok = t(wx, y0 + i) === TILE.SOLID && t(wx + dir, y0 + i) !== TILE.SOLID;
        }
        if (!ok) continue;
        const face = dir === -1 ? lx + 0.08 : lx + 0.92; // 露出面の内側
        const ly0 = y0 - by;
        const r = hash2(seed + 708, wx * dir, s);
        if (r < 0.14) {
          // 排気グリル(短い横線4本)
          for (let i = 0; i < 4; i++) {
            const gy = ly0 + 0.8 + i * 0.45;
            const gx = dir === -1 ? lx + 0.12 : lx + 0.55;
            ops.push({ kind: 'line', x1: gx, y1: gy, x2: gx + 0.33, y2: gy, w: 0.07, color: PALETTE.grill });
          }
        } else if (r < 0.26) {
          // 壁面を走る縦配管
          ops.push({ kind: 'line', x1: face, y1: ly0, x2: face, y2: ly0 + 4, w: 0.14, color: PALETTE.pipe });
          ops.push({ kind: 'dot', x: face, y: ly0 + 2, r: 0.12, color: PALETTE.bracket });
        }
      }
    }
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/render/decor.test.ts`
Expected: PASS(7件)。統計テストが失敗したら確率閾値を上げる前に、まず対象シードでの実際の出現数をカウント出力して原因を確認する

- [ ] **Step 5: コミット**

```bash
git add src/render/decor.ts src/render/decor.test.ts
git commit -m "feat: セグメント装飾(床配管・瓦礫・天井ケーブル・壁面)"
```

---

### Task 4: チャンク焼き込みとレンダラー統合

**Files:**
- Create: `src/render/chunkbake.ts`
- Modify: `src/render/renderer.ts`(全置換)
- Modify: `src/main.ts`(Renderer構築とevict連動)
- Delete: `src/render/silhouette.ts`

chunkbakeはDOM(Canvas)依存のためユニットテストなし。検証はスクリーンショット目視。

- [ ] **Step 1: chunkbake.tsを作成**

`src/render/chunkbake.ts`:

```ts
import type { ChunkStore } from '../world/chunks';
import { stratumIndexAt } from '../world/strata';
import { CHUNK_SIZE, TILE } from '../world/tiles';
import { decorateChunk, type DecorOp } from './decor';

/** 焼き込み解像度(px/タイル)。表示は拡縮されるが16pxあれば線は読める */
export const BAKE_PPT = 16;

/** 階層ごとのSOLIDベース色(わずかな色味の違い) */
const SOLID_FILLS = ['#161b20', '#171c18', '#1d1a16', '#151721', '#1a151c'];

/** チャンク1枚を一度だけオフスクリーンCanvasへ焼き込み、以後はdrawImageで貼る */
export class ChunkBaker {
  private cache = new Map<string, HTMLCanvasElement>();
  private patterns = new Map<string, CanvasPattern>();

  constructor(private seed: number) {}

  get size(): number {
    return this.cache.size;
  }

  get(cx: number, cy: number, store: ChunkStore): HTMLCanvasElement {
    const key = `${cx},${cy}`;
    let canvas = this.cache.get(key);
    if (!canvas) {
      canvas = this.bake(cx, cy, store);
      this.cache.set(key, canvas);
    }
    return canvas;
  }

  /** ChunkStoreのevictFarFromと同じ規則でキャッシュを破棄する(main側で対で呼ぶ) */
  evictFarFrom(cx: number, cy: number, radius: number): void {
    for (const key of this.cache.keys()) {
      const [kx, ky] = key.split(',').map(Number);
      if (Math.max(Math.abs(kx - cx), Math.abs(ky - cy)) > radius) {
        this.cache.delete(key);
      }
    }
  }

  private bake(cx: number, cy: number, store: ChunkStore): HTMLCanvasElement {
    const px = CHUNK_SIZE * BAKE_PPT;
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d')!;
    const chunk = store.getChunk(cx, cy);

    // ベース: SOLIDタイルを階層色で塗る(+1pxで継ぎ目の光漏れ防止)
    for (let ty = 0; ty < CHUNK_SIZE; ty++) {
      const fill = SOLID_FILLS[stratumIndexAt(cy * CHUNK_SIZE + ty) % SOLID_FILLS.length];
      for (let tx = 0; tx < CHUNK_SIZE; tx++) {
        if (chunk[ty * CHUNK_SIZE + tx] !== TILE.SOLID) continue;
        ctx.fillStyle = fill;
        ctx.fillRect(tx * BAKE_PPT, ty * BAKE_PPT, BAKE_PPT + 1, BAKE_PPT + 1);
      }
    }

    // 装飾
    ctx.lineCap = 'round';
    for (const op of decorateChunk(this.seed, cx, cy)) this.draw(ctx, op);
    return canvas;
  }

  private draw(ctx: CanvasRenderingContext2D, op: DecorOp): void {
    const P = BAKE_PPT;
    switch (op.kind) {
      case 'line':
        ctx.strokeStyle = op.color;
        ctx.lineWidth = Math.max(1, op.w * P);
        ctx.beginPath();
        ctx.moveTo(op.x1 * P, op.y1 * P);
        ctx.lineTo(op.x2 * P, op.y2 * P);
        ctx.stroke();
        break;
      case 'dot':
        ctx.fillStyle = op.color;
        ctx.beginPath();
        ctx.arc(op.x * P, op.y * P, Math.max(1, op.r * P), 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'poly': {
        ctx.beginPath();
        ctx.moveTo(op.pts[0] * P, op.pts[1] * P);
        for (let i = 2; i < op.pts.length; i += 2) ctx.lineTo(op.pts[i] * P, op.pts[i + 1] * P);
        if (op.fill) {
          ctx.closePath();
          ctx.fillStyle = op.color;
          ctx.fill();
        } else {
          ctx.strokeStyle = op.color;
          ctx.lineWidth = Math.max(1, op.w * P);
          ctx.stroke();
        }
        break;
      }
      case 'hatch': {
        ctx.save();
        ctx.beginPath();
        ctx.rect(op.x * P, op.y * P, op.w * P, op.h * P);
        ctx.clip();
        ctx.fillStyle = this.hatchPattern(op.spacing, op.color);
        ctx.fillRect(op.x * P, op.y * P, op.w * P, op.h * P);
        ctx.restore();
        break;
      }
    }
  }

  private hatchPattern(spacing: number, color: string): CanvasPattern {
    const key = `${spacing}|${color}`;
    let pat = this.patterns.get(key);
    if (!pat) {
      const s = Math.max(3, Math.round(spacing * BAKE_PPT));
      const c = document.createElement('canvas');
      c.width = s;
      c.height = s;
      const pctx = c.getContext('2d')!;
      pctx.strokeStyle = color;
      pctx.lineWidth = 1;
      pctx.beginPath();
      // 45°線(タイル境界で連続するようセル内で完結する2本)
      pctx.moveTo(0, s);
      pctx.lineTo(s, 0);
      pctx.moveTo(-s / 2, s / 2);
      pctx.lineTo(s / 2, -s / 2);
      pctx.moveTo(s / 2, s * 1.5);
      pctx.lineTo(s * 1.5, s / 2);
      pctx.stroke();
      pat = pctx.createPattern(c, 'repeat')! as CanvasPattern;
      this.patterns.set(key, pat);
    }
    return pat;
  }
}
```

- [ ] **Step 2: renderer.tsを全置換**

`src/render/renderer.ts`:

```ts
import type { Camera } from '../core/camera';
import type { Player } from '../entities/player';
import type { ChunkStore } from '../world/chunks';
import { CHUNK_SIZE } from '../world/tiles';
import { ChunkBaker, BAKE_PPT } from './chunkbake';
import { Lighting } from './lighting';

/** 画面の横幅に収めるタイル数(スケール感の基準) */
const VIEW_TILES_X = 44;

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private lighting = new Lighting();
  private baker: ChunkBaker;

  constructor(
    private canvas: HTMLCanvasElement,
    seed: number,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.baker = new ChunkBaker(seed);
  }

  resize(w: number, h: number): void {
    this.canvas.width = w;
    this.canvas.height = h;
    this.lighting.resize(w, h);
  }

  /** ChunkStore.evictFarFromと対で呼ぶ(焼き込みキャッシュの解放) */
  evictFarFrom(cx: number, cy: number, radius: number): void {
    this.baker.evictFarFrom(cx, cy, radius);
  }

  render(store: ChunkStore, cam: Camera, player: Player, mouseX: number, mouseY: number): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const ppt = w / VIEW_TILES_X;
    const ctx = this.ctx;

    ctx.fillStyle = '#050607';
    ctx.fillRect(0, 0, w, h);

    // 可視チャンクの焼き込み画像を貼る
    const chunkPx = CHUNK_SIZE * ppt;
    const cx0 = Math.floor((cam.x - w / ppt / 2) / CHUNK_SIZE);
    const cx1 = Math.floor((cam.x + w / ppt / 2) / CHUNK_SIZE);
    const cy0 = Math.floor((cam.y - h / ppt / 2) / CHUNK_SIZE);
    const cy1 = Math.floor((cam.y + h / ppt / 2) / CHUNK_SIZE);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const baked = this.baker.get(cx, cy, store);
        const sx = (cx * CHUNK_SIZE - cam.x) * ppt + w / 2;
        const sy = (cy * CHUNK_SIZE - cam.y) * ppt + h / 2;
        ctx.drawImage(baked, sx, sy, chunkPx, chunkPx);
      }
    }

    // プレイヤー(Task 6でスプライト化するまでは矩形)
    const px = (player.centerX - cam.x) * ppt + w / 2;
    const py = (player.centerY - cam.y) * ppt + h / 2;
    ctx.fillStyle = '#c8ccd2';
    ctx.fillRect(px - (player.body.w * ppt) / 2, py - (player.body.h * ppt) / 2, player.body.w * ppt, player.body.h * ppt);

    // 闇+ライト
    const angle = Math.atan2(mouseY - py, mouseX - px);
    this.lighting.render(ctx, px, py, angle, ppt);
  }
}
```

`BAKE_PPT` のimportが未使用になる場合は削除してよい(noUnusedLocals対策)。

- [ ] **Step 3: main.tsを更新し、silhouette.tsを削除**

`src/main.ts`:
- `const renderer = new Renderer(canvas);` → `const renderer = new Renderer(canvas, seed);`
- `store.evictFarFrom(pcx, pcy, EVICT_RADIUS);` の直後に `renderer.evictFarFrom(pcx, pcy, EVICT_RADIUS);` を追加

Run: `git rm src/render/silhouette.ts`

- [ ] **Step 4: 検証(テスト+型+スクリーンショット目視)**

Run: `npm test && npx tsc --noEmit`
Expected: 47/47(40+decor7)、型エラーなし

Run: `node scripts/screenshot.mjs --out=screenshots/task4.png`
PNGをReadツールで開き確認: ライト内にエッジライン・継ぎ目・ハッチング・配管・ケーブルが見える。タイルの継ぎ目で装飾が切れていない。ベースライン(baseline.png)より明確に情報量が多い。**チープに見える場合は原因を特定して調整してから次へ**(線が細すぎ→w増、暗すぎ→PALETTE明度up等)

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "feat: チャンク焼き込み描画に移行(silhouette廃止)"
```

---

### Task 5: パララックス遠景

**Files:**
- Create: `src/render/background.ts`
- Modify: `src/render/renderer.ts`(組み込み)

- [ ] **Step 1: background.tsを作成**

`src/render/background.ts`:

```ts
import { hash2 } from '../world/noise';

interface Layer {
  factor: number; // カメラ移動への追従率(小さいほど遠い)
  alpha: number;
  slotW: number; // 塔の配置スロット幅(タイル)
  deckH: number; // デッキの配置スロット高(タイル)
  color: string;
}

const LAYERS: Layer[] = [
  { factor: 0.35, alpha: 0.1, slotW: 22, deckH: 16, color: '#8fa0b0' },
  { factor: 0.18, alpha: 0.05, slotW: 34, deckH: 26, color: '#8fa0b0' },
];

/** 闇の奥にかすかに見える巨大構造のパララックス遠景(決定論的) */
export class Background {
  constructor(private seed: number) {}

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, w: number, h: number, ppt: number): void {
    LAYERS.forEach((L, li) => {
      const offX = camX * L.factor * ppt;
      const offY = camY * L.factor * 0.6 * ppt;
      ctx.globalAlpha = L.alpha;
      ctx.fillStyle = L.color;

      // 縦の巨大塔
      const slotPx = L.slotW * ppt;
      const k0 = Math.floor((offX - w / 2) / slotPx) - 1;
      const k1 = Math.floor((offX + w / 2) / slotPx) + 1;
      for (let k = k0; k <= k1; k++) {
        if (hash2(this.seed + 900 + li, k, 0) > 0.55) continue;
        const tw = (0.12 + hash2(this.seed + 901 + li, k, 1) * 0.5) * slotPx;
        const tx = k * slotPx - offX + w / 2 + hash2(this.seed + 902 + li, k, 2) * slotPx * 0.4;
        ctx.fillRect(tx, 0, tw, h);
      }

      // 水平デッキ
      const rowPx = L.deckH * ppt;
      const j0 = Math.floor((offY - h / 2) / rowPx) - 1;
      const j1 = Math.floor((offY + h / 2) / rowPx) + 1;
      for (let j = j0; j <= j1; j++) {
        if (hash2(this.seed + 903 + li, 0, j) > 0.3) continue;
        const jy = j * rowPx - offY + h / 2;
        const dw = (0.3 + hash2(this.seed + 904 + li, 1, j) * 0.7) * w;
        const dx = hash2(this.seed + 905 + li, 2, j) * (w - dw);
        ctx.fillRect(dx, jy, dw, Math.max(2, 0.6 * ppt));
      }
    });
    ctx.globalAlpha = 1;
  }
}
```

- [ ] **Step 2: rendererに組み込む**

`src/render/renderer.ts`:
- import追加: `import { Background } from './background';`
- フィールド追加: `private background: Background;`、コンストラクタで `this.background = new Background(seed);`
- `render` 内、背景fillの直後・チャンク描画の前に: `this.background.render(ctx, cam.x, cam.y, w, h, ppt);`

- [ ] **Step 3: 検証**

Run: `npm test && npx tsc --noEmit`
Expected: 全PASS

Run: `node scripts/screenshot.mjs --out=screenshots/task5.png` と `node scripts/screenshot.mjs --out=screenshots/task5b.png --pos=200,-300`
PNGを開き確認: 闇の奥にかすかな塔・デッキのシルエットが見える。うるさすぎない(不透明度5〜12%の「気配」)。ライト内の前景ディテールを邪魔していない

- [ ] **Step 4: コミット**

```bash
git add src/render/background.ts src/render/renderer.ts
git commit -m "feat: パララックス遠景"
```

---

### Task 6: プレイヤースプライト(コートの人影)

**Files:**
- Create: `src/render/playerSprite.ts`
- Modify: `src/entities/player.ts`(facing / walkPhase)
- Modify: `src/entities/player.test.ts`(追記)
- Modify: `src/render/renderer.ts`(矩形をスプライトに置換)

- [ ] **Step 1: playerの失敗するテストを追記**

`src/entities/player.test.ts` に追記:

```ts
describe('Player 向きと歩行位相', () => {
  it('左右入力で向きが変わり、入力がなければ維持される', () => {
    const p = new Player(0, 8);
    for (let i = 0; i < 120; i++) p.update(noInput, 1 / 60, floorTiles);
    p.update({ ...noInput, left: true }, 1 / 60, floorTiles);
    expect(p.facing).toBe(-1);
    p.update(noInput, 1 / 60, floorTiles);
    expect(p.facing).toBe(-1);
    p.update({ ...noInput, right: true }, 1 / 60, floorTiles);
    expect(p.facing).toBe(1);
  });

  it('接地して歩いている間だけwalkPhaseが進む', () => {
    const p = new Player(0, 8);
    for (let i = 0; i < 120; i++) p.update(noInput, 1 / 60, floorTiles);
    const before = p.walkPhase;
    p.update(noInput, 1 / 60, floorTiles);
    expect(p.walkPhase).toBe(before); // 静止中は進まない
    p.update({ ...noInput, right: true }, 1 / 60, floorTiles);
    expect(p.walkPhase).toBeGreaterThan(before);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/entities/player.test.ts`
Expected: FAIL(facing / walkPhase が存在しない)

- [ ] **Step 3: player.tsに向きと歩行位相を追加**

`src/entities/player.ts` の `Player` クラスにフィールドを追加:

```ts
  /** 向き(1=右, -1=左)。描画用でゲームプレイには影響しない */
  facing: 1 | -1 = 1;
  /** 歩行アニメーションの位相(接地歩行中のみ進む) */
  walkPhase = 0;
```

`update` 内、`b.vx = ...` の直後に:

```ts
    if (b.vx > 0) this.facing = 1;
    else if (b.vx < 0) this.facing = -1;
    if (b.vx !== 0 && b.onGround) this.walkPhase += dt * 9;
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/entities/player.test.ts`
Expected: PASS(8件)

- [ ] **Step 5: playerSprite.tsを作成し、rendererの矩形を置換**

`src/render/playerSprite.ts`:

```ts
/**
 * コートの人影(霧亥風シルエット)を描く。
 * px/py: 体の中心の画面座標(px)、ppt: 1タイルのpx数、
 * facing: 1=右向き, -1=左向き、walkPhase: 歩行位相、aimAngle: ライト方向(ラジアン)
 */
export function drawPlayer(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  ppt: number,
  facing: 1 | -1,
  walkPhase: number,
  aimAngle: number,
): void {
  const s = ppt;
  const h = 1.75 * s;
  const bob = Math.sin(walkPhase) * 0.05 * s;

  ctx.save();
  ctx.translate(px, py + bob);
  ctx.scale(facing, 1);

  // 頭(小さめ・やや前傾)
  ctx.fillStyle = '#b9bec5';
  ctx.beginPath();
  ctx.arc(0.03 * s, -h / 2 + 0.16 * s, 0.14 * s, 0, Math.PI * 2);
  ctx.fill();

  // コート(肩から裾へ広がり、裾に切れ込み)
  ctx.fillStyle = '#aab0b8';
  ctx.beginPath();
  ctx.moveTo(-0.2 * s, -h / 2 + 0.32 * s);
  ctx.lineTo(0.22 * s, -h / 2 + 0.32 * s);
  ctx.lineTo(0.3 * s, h / 2);
  ctx.lineTo(0.08 * s, h / 2);
  ctx.lineTo(0.03 * s, h / 2 - 0.45 * s);
  ctx.lineTo(-0.03 * s, h / 2 - 0.45 * s);
  ctx.lineTo(-0.09 * s, h / 2);
  ctx.lineTo(-0.28 * s, h / 2);
  ctx.closePath();
  ctx.fill();

  // 襟の影
  ctx.strokeStyle = '#8f969e';
  ctx.lineWidth = Math.max(1, 0.04 * s);
  ctx.beginPath();
  ctx.moveTo(-0.16 * s, -h / 2 + 0.36 * s);
  ctx.lineTo(0.18 * s, -h / 2 + 0.36 * s);
  ctx.stroke();

  ctx.restore();

  // 腕(ライト方向。反転の影響を受けないようtranslateの外で描く)
  const ax = px;
  const ay = py - 0.35 * s + bob;
  ctx.strokeStyle = '#8f969e';
  ctx.lineWidth = Math.max(1.5, 0.1 * s);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ax + Math.cos(aimAngle) * 0.45 * s, ay + Math.sin(aimAngle) * 0.45 * s);
  ctx.stroke();
}
```

`src/render/renderer.ts` のプレイヤー矩形描画部を置換:

```ts
    // プレイヤー(コートの人影)
    const px = (player.centerX - cam.x) * ppt + w / 2;
    const py = (player.centerY - cam.y) * ppt + h / 2;
    const angle = Math.atan2(mouseY - py, mouseX - px);
    drawPlayer(ctx, px, py, ppt, player.facing, player.walkPhase, angle);

    // 闇+ライト
    this.lighting.render(ctx, px, py, angle, ppt);
```

(import追加: `import { drawPlayer } from './playerSprite';`。angleの計算が1回にまとまることに注意)

- [ ] **Step 6: 検証**

Run: `npm test && npx tsc --noEmit`
Expected: 全PASS

Run: `node scripts/screenshot.mjs --out=screenshots/task6.png`
PNGを開き確認: プレイヤーが矩形ではなくコートの人影に見える。頭・裾の切れ込み・腕が判別できる

- [ ] **Step 7: コミット**

```bash
git add src/render/playerSprite.ts src/entities/player.ts src/entities/player.test.ts src/render/renderer.ts
git commit -m "feat: コートの人影スプライトと向き・歩行位相"
```

---

### Task 7: ライトの質感とポストプロセス(グレイン・ビネット)

**Files:**
- Modify: `src/render/lighting.ts`(揺らぎ+半解像度)
- Create: `src/render/post.ts`
- Modify: `src/render/renderer.ts` / `src/main.ts`(時刻の受け渡し)

- [ ] **Step 1: lighting.tsに揺らぎと半解像度を入れる**

`src/render/lighting.ts` の変更点:

1. `resize(w, h)` で内部canvasを半解像度にする:

```ts
  private outW = 0;
  private outH = 0;

  resize(w: number, h: number): void {
    this.outW = w;
    this.outH = h;
    this.canvas.width = Math.ceil(w / 2);
    this.canvas.height = Math.ceil(h / 2);
  }
```

2. `render` にtimeSecを追加し、内部座標を半分で扱い、最後に全体へ拡大して貼る:

```ts
  render(mainCtx: CanvasRenderingContext2D, px: number, py: number, angle: number, ppt: number, timeSec: number): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const ctx = this.ctx;
    // 半解像度の内部座標系
    const hx = px / 2;
    const hy = py / 2;
    const hp = ppt / 2;
    // 微かな揺らぎ(携行ライトの息遣い)
    const flicker = 1 + 0.025 * Math.sin(timeSec * 6.3) + 0.015 * Math.sin(timeSec * 17.1);
    ...(既存の闇+destination-outの処理。ambientR = 6 * hp * flicker、coneR = 22 * hp * flicker、
        px/py の代わりに hx/hy を使う)...
    mainCtx.drawImage(this.canvas, 0, 0, this.outW, this.outH);
  }
```

(半解像度化はディザ相当のソフトエッジとライト処理の負荷削減を兼ねる)

- [ ] **Step 2: post.tsを作成**

`src/render/post.ts`:

```ts
/** フィルムグレイン+ビネット。グレインは世界と無関係な演出なので決定論不要 */
export class Post {
  private grains: HTMLCanvasElement[] = [];
  private vignette: HTMLCanvasElement | null = null;
  private frame = 0;

  constructor() {
    for (let i = 0; i < 3; i++) this.grains.push(makeGrain(256));
  }

  resize(w: number, h: number): void {
    const v = document.createElement('canvas');
    v.width = w;
    v.height = h;
    const ctx = v.getContext('2d')!;
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    this.vignette = v;
  }

  render(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    this.frame++;
    const grain = this.grains[this.frame % this.grains.length];
    ctx.globalAlpha = 0.05;
    for (let y = 0; y < h; y += grain.height) {
      for (let x = 0; x < w; x += grain.width) {
        ctx.drawImage(grain, x, y);
      }
    }
    ctx.globalAlpha = 1;
    if (this.vignette) ctx.drawImage(this.vignette, 0, 0);
  }
}

function makeGrain(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() > 0.5 ? 255 : 0;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 26;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
```

- [ ] **Step 3: renderer/mainに時刻を通す**

- `Renderer.render(store, cam, player, mouseX, mouseY, timeSec)` にパラメータ追加、`lighting.render(..., timeSec)` に渡し、最後(HUD以外の最終層)に `this.post.render(ctx, w, h);`
- `Renderer` にフィールド `private post = new Post();` を追加し、`resize` で `this.post.resize(w, h);`
- `src/main.ts`: `let simTime = 0;` を追加、`update` 内で `simTime += dt;`、render呼び出しを `renderer.render(store, camera, player, input.mouseX * dpr, input.mouseY * dpr, simTime);` に変更

- [ ] **Step 4: 検証**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: 全PASS、ビルド成功

Run: `node scripts/screenshot.mjs --out=screenshots/task7.png`
PNGを開き確認: 画面全体に微かなざらつき(紙の質感)、四隅がわずかに落ちる。ライトの縁が硬いバンディングになっていない

- [ ] **Step 5: コミット**

```bash
git add src/render/lighting.ts src/render/post.ts src/render/renderer.ts src/main.ts
git commit -m "feat: ライトの揺らぎ・半解像度化とグレイン・ビネット"
```

---

### Task 8: 総合ビジュアルチューニングと最終確認

**Files:**
- Modify: 調整対象(PALETTE定数・確率・線幅など)

- [ ] **Step 1: スクリーンショット一式を撮る**

```bash
node scripts/screenshot.mjs --out=screenshots/final-spawn.png
node scripts/screenshot.mjs --out=screenshots/final-alt600.png --pos=100,-600
node scripts/screenshot.mjs --out=screenshots/final-alt1600.png --pos=100,-1600
node scripts/screenshot.mjs --seed=42 --out=screenshots/final-seed42.png
```

- [ ] **Step 2: 目視評価と調整**

全PNGをReadで開き、承認済みモックアップ(look-c-quality.htmlの右側)と比較して評価:
1. ライト内の情報密度がモックアップ以上か(「原作の書き込み再現」が発注)
2. 装飾がチャンク境界(64タイルごと)で切れていないか
3. 階層ごとに画の印象が変わるか
4. 遠景・グレインが下品でないか

足りなければ PALETTE / 確率 / 線幅 / セグメント長を調整して撮り直す(調整→撮影→確認のループ。最大3周)。

- [ ] **Step 3: 全テスト+ビルド+コミット**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: 全PASS

```bash
git add -A
git commit -m "feat: ビジュアル刷新の最終チューニング"
```

---

## この計画のスコープ外

- A案(白い虚空)への切り替え、空洞演出の大変更
- 段階3-4(セーフガード・重力子砲・物語・セーブ)
- タイル種の追加(装飾は描画層のみで完結)
