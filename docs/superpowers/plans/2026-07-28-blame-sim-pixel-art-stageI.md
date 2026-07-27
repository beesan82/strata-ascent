# ドット絵大改修 段I: レンダリング基盤のドット絵化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 既存の描画を作り変えずに、パイプライン最終段で全体を一段ドット絵化する土台を作る(内部低解像度バッファ+18色鋼パレット量子化+Bayerディザ+整数拡大表示、ズームの離散段化)。

**Architecture:** 新規の純関数モジュール(`palette.ts`/`dither.ts`)と量子化コア(`pixel.ts`)を作り、`renderer.ts` の描画先を内部オフスクリーンcanvasへ差し替えて最後に量子化+整数拡大転写を挟む。カメラ・物理・ワールド生成・当たり判定・各レイヤーの描画ロジックは不変。

**Tech Stack:** 既存(Vite/TS/Canvas2D/Vitest/Playwright)。新規依存なし。Vitestは**node環境**(canvasは使えない)なので、量子化は生の `Uint8ClampedArray` を受け取る純関数として切り出してテストする。

**参照スペック:** `docs/superpowers/specs/2026-07-28-blame-sim-pixel-art-stageI-design.md`

**全タスク共通:**
- 純ロジックは決定論。既存テスト(全PASS)は回帰なし維持。`npm test` / `npx tsc --noEmit` / `npm run build` クリーン。
- スクショ: `node scripts/screenshot.mjs --seed=<s> [--pos=x,y] --out=screenshots/<name>.png`。exit0+`[pageerror]`無しが必須。
- 量子化は**表示のみ**。tileAt/物理/破壊差分には一切触れない。
- 色は `src/render/steel.ts` の `STEEL`(段階Fの鋼ランプ)と `relLum`/`mixHex` を再利用する。

---

### Task 1: 18色ドット絵パレットと最近傍量子化(palette.ts)

**Files:**
- Create: `src/render/palette.ts`
- Test: `src/render/palette.test.ts`

16色の寒色鋼ランプ+暖色2色(錆・灯)= 18色の固定パレットと、RGBを最近傍パレット添字へ量子化する純関数を提供する。暖色2色を含めるのは段階Fの原則「暖色は錆・灯のみ」を量子化後も保つため(寒色16色だけだと錆・灯が寒色へ潰れて消える)。

- [ ] **Step 1: 失敗するテストを書く**

`src/render/palette.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { PIXEL_PALETTE, paletteRgb, nearestIndex } from './palette';
import { relLum } from './steel';

describe('PIXEL_PALETTE', () => {
  it('18色(寒色16+暖色2)・重複なし', () => {
    expect(PIXEL_PALETTE.length).toBe(18);
    expect(new Set(PIXEL_PALETTE).size).toBe(18);
  });
  it('寒色ランプ(先頭16)は輝度が概ね単調増加', () => {
    for (let i = 1; i < 16; i++) {
      expect(relLum(PIXEL_PALETTE[i])).toBeGreaterThan(relLum(PIXEL_PALETTE[i - 1]));
    }
  });
  it('全色 #rrggbb 形式', () => {
    for (const c of PIXEL_PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('paletteRgb', () => {
  it('18×3のUint8Arrayを返し、先頭色と一致', () => {
    const rgb = paletteRgb();
    expect(rgb.length).toBe(18 * 3);
    // PIXEL_PALETTE[0]='#020408' → 2,4,8
    expect([rgb[0], rgb[1], rgb[2]]).toEqual([2, 4, 8]);
  });
});

describe('nearestIndex', () => {
  it('パレット色そのものはその添字を返す', () => {
    const rgb = paletteRgb();
    for (let i = 0; i < PIXEL_PALETTE.length; i++) {
      const r = parseInt(PIXEL_PALETTE[i].slice(1, 3), 16);
      const g = parseInt(PIXEL_PALETTE[i].slice(3, 5), 16);
      const b = parseInt(PIXEL_PALETTE[i].slice(5, 7), 16);
      expect(nearestIndex(r, g, b, rgb)).toBe(i);
    }
  });
  it('純黒は最暗色(添字0)へ', () => {
    expect(nearestIndex(0, 0, 0, paletteRgb())).toBe(0);
  });
  it('純白は最明色(添字15=rim系の最明)へ', () => {
    // 先頭16の最明は PIXEL_PALETTE[15]。暖色より白に近い。
    expect(nearestIndex(255, 255, 255, paletteRgb())).toBe(15);
  });
  it('決定論: 同じ入力は同じ添字', () => {
    const rgb = paletteRgb();
    expect(nearestIndex(90, 58, 36, rgb)).toBe(nearestIndex(90, 58, 36, rgb));
  });
});
```

- [ ] **Step 2: 失敗確認**

Run: `npx vitest run src/render/palette.test.ts`
Expected: FAIL(palette.ts 未定義)

- [ ] **Step 3: 実装**

`src/render/palette.ts`:
```ts
/**
 * ドット絵の固定パレット(段階Fの鋼ランプ由来)。
 * 先頭16=寒色鋼ランプ(暗→明)。末尾2=暖色アクセント(錆・灯)。
 * 段階Fの原則「暖色は錆・灯のみ」を量子化後も保つため暖色を明示的に含める。
 */
export const PIXEL_PALETTE: readonly string[] = [
  '#020408', '#04070c', '#070c12', '#0a121a', '#0d141c', '#10171f', // 0-5 最暗〜壁基調
  '#16202b', '#1c3040', '#22384a', '#2a4258', '#33506a', '#3d566e', // 6-11 中階調
  '#4a6a84', '#5f7d94', '#7d97ad', '#c7d0ce',                       // 12-15 明部〜ハイライト
  '#5a3a24', '#caa64a',                                             // 16-17 錆・灯(暖色)
];

/** パレットを [r,g,b, r,g,b, ...] の数値配列に展開(量子化ループ用に一度だけ) */
export function paletteRgb(): Uint8Array {
  const out = new Uint8Array(PIXEL_PALETTE.length * 3);
  for (let i = 0; i < PIXEL_PALETTE.length; i++) {
    const p = parseInt(PIXEL_PALETTE[i].slice(1), 16);
    out[i * 3] = (p >> 16) & 255;
    out[i * 3 + 1] = (p >> 8) & 255;
    out[i * 3 + 2] = p & 255;
  }
  return out;
}

/**
 * (r,g,b) に最も近いパレット色の添字。知覚寄りの重み付きユークリッド距離
 * (0.30/0.59/0.11)で、緑の差を強く見る。純関数・決定論。
 * palRgb は paletteRgb() の出力(呼び出し側で使い回す)。
 */
export function nearestIndex(r: number, g: number, b: number, palRgb: Uint8Array): number {
  let best = 0;
  let bestD = Infinity;
  const n = palRgb.length / 3;
  for (let i = 0; i < n; i++) {
    const dr = r - palRgb[i * 3];
    const dg = g - palRgb[i * 3 + 1];
    const db = b - palRgb[i * 3 + 2];
    const d = 0.30 * dr * dr + 0.59 * dg * dg + 0.11 * db * db;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
```

- [ ] **Step 4: 通過確認**

Run: `npx vitest run src/render/palette.test.ts` → PASS
Run: `npm test` → 全PASS。`npx tsc --noEmit` → クリーン

- [ ] **Step 5: コミット**
```bash
git add src/render/palette.ts src/render/palette.test.ts
git commit -m "feat: 段I 18色ドット絵パレットと最近傍量子化(palette.ts)"
```
末尾に `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

---

### Task 2: Bayerディザ(dither.ts)

**Files:**
- Create: `src/render/dither.ts`
- Test: `src/render/dither.test.ts`

量子化前に各画素へ足す4×4 Bayer 閾値オフセットを提供。色帯(グラデ由来)の階段を空間的に散らしてドット絵らしい陰影にする。純関数。

- [ ] **Step 1: 失敗するテストを書く**

`src/render/dither.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { BAYER4, bayerOffset } from './dither';

describe('BAYER4', () => {
  it('16要素・0..15の置換(重複なし)', () => {
    expect(BAYER4.length).toBe(16);
    expect([...BAYER4].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 16 }, (_, i) => i),
    );
  });
});

describe('bayerOffset', () => {
  it('範囲は [-0.5, 0.5)', () => {
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const o = bayerOffset(x, y);
        expect(o).toBeGreaterThanOrEqual(-0.5);
        expect(o).toBeLessThan(0.5);
      }
    }
  });
  it('4×4周期(負座標でも一致)', () => {
    expect(bayerOffset(0, 0)).toBe(bayerOffset(4, 4));
    expect(bayerOffset(1, 2)).toBe(bayerOffset(-3, -2));
  });
  it('16マスすべて異なる値(単調な閾値分布)', () => {
    const vals = new Set<number>();
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) vals.add(bayerOffset(x, y));
    expect(vals.size).toBe(16);
  });
});
```

- [ ] **Step 2: 失敗確認**

Run: `npx vitest run src/render/dither.test.ts`
Expected: FAIL(dither.ts 未定義)

- [ ] **Step 3: 実装**

`src/render/dither.ts`:
```ts
/** 4×4 Bayer 行列(0..15)。順序付きディザの閾値パターン。 */
export const BAYER4: readonly number[] = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];

/**
 * (x,y) の Bayer 閾値オフセット [-0.5, 0.5)。4×4周期(負座標も対応)。
 * 量子化前に各チャンネルへ offset*strength を足すと、色帯の階段が空間的に散る。
 */
export function bayerOffset(x: number, y: number): number {
  const ix = ((x % 4) + 4) % 4;
  const iy = ((y % 4) + 4) % 4;
  return BAYER4[iy * 4 + ix] / 16 - 0.5;
}
```

- [ ] **Step 4: 通過確認**

Run: `npx vitest run src/render/dither.test.ts` → PASS
Run: `npm test` → 全PASS。`npx tsc --noEmit` → クリーン

- [ ] **Step 5: コミット**
```bash
git add src/render/dither.ts src/render/dither.test.ts
git commit -m "feat: 段I Bayerディザ(dither.ts)"
```
末尾 Co-Authored-By 付き。

---

### Task 3: 量子化コアとPixelPipeline(pixel.ts)

**Files:**
- Create: `src/render/pixel.ts`
- Test: `src/render/pixel.test.ts`

RGBA画素配列をディザ付きでパレット量子化する純関数 `quantizeRgba` と、内部オフスクリーンcanvasの管理・量子化・整数拡大転写を担う `PixelPipeline` を実装する。純関数部分だけをテスト(canvasはnode環境で不可のためスクショで確認)。

- [ ] **Step 1: 失敗するテストを書く**

`src/render/pixel.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { quantizeRgba } from './pixel';
import { paletteRgb, PIXEL_PALETTE, nearestIndex } from './palette';

describe('quantizeRgba', () => {
  const rgb = paletteRgb();
  it('各画素をパレット色に置換する(全画素がパレット内)', () => {
    // 4画素: 適当な色。量子化後は必ずパレットのどれか。
    const data = new Uint8ClampedArray([
      100, 100, 100, 255,
      10, 20, 30, 255,
      200, 160, 70, 255,   // 灯に近い暖色
      90, 58, 36, 255,     // 錆そのもの
    ]);
    quantizeRgba(data, 4, 1, rgb, 0); // strength0=ディザ無し(決定的)
    const palSet = new Set(PIXEL_PALETTE.map((c) => c.slice(1)));
    for (let i = 0; i < 4; i++) {
      const hex = ((data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2])
        .toString(16).padStart(6, '0');
      expect(palSet.has(hex)).toBe(true);
    }
    // 錆(90,58,36)はパレット添字16(錆)へ量子化される
    expect(nearestIndex(90, 58, 36, rgb)).toBe(16);
  });

  it('アルファは保持する', () => {
    const data = new Uint8ClampedArray([100, 100, 100, 200]);
    quantizeRgba(data, 1, 1, rgb, 0);
    expect(data[3]).toBe(200);
  });

  it('決定論: 同じ入力は同じ出力', () => {
    const a = new Uint8ClampedArray([123, 45, 67, 255]);
    const b = new Uint8ClampedArray([123, 45, 67, 255]);
    quantizeRgba(a, 1, 1, rgb, 1);
    quantizeRgba(b, 1, 1, rgb, 1);
    expect([...a]).toEqual([...b]);
  });

  it('ディザ強度>0で、同色の帯が隣接画素で異なる色に割れうる(バンド散らし)', () => {
    // 量子化境界に近いグレーを横一列に。ディザ有りだと隣接画素で添字が割れる箇所が出る。
    const w = 16;
    const data = new Uint8ClampedArray(w * 4);
    for (let x = 0; x < w; x++) {
      data[x * 4] = 45; data[x * 4 + 1] = 55; data[x * 4 + 2] = 70; data[x * 4 + 3] = 255;
    }
    quantizeRgba(data, w, 1, rgb, 32); // 強めのディザ
    const colors = new Set<string>();
    for (let x = 0; x < w; x++) {
      colors.add(`${data[x * 4]},${data[x * 4 + 1]},${data[x * 4 + 2]}`);
    }
    expect(colors.size).toBeGreaterThan(1); // 一様でなく散っている
  });
});
```

- [ ] **Step 2: 失敗確認**

Run: `npx vitest run src/render/pixel.test.ts`
Expected: FAIL(pixel.ts 未定義)

- [ ] **Step 3: 実装**

`src/render/pixel.ts`:
```ts
import { nearestIndex } from './palette';
import { bayerOffset } from './dither';
import { STEEL } from './steel';

/**
 * RGBA画素配列(w×h)をディザ付きでパレット量子化する(in-place)。純関数・決定論。
 * strength は各チャンネルに足すディザ量(px値スケール。0で無効)。palRgb は paletteRgb()。
 * アルファは保持。パレットは [r,g,b]×N の Uint8Array。
 */
export function quantizeRgba(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  palRgb: Uint8Array,
  strength: number,
): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const d = bayerOffset(x, y) * strength;
      const r = data[o] + d;
      const g = data[o + 1] + d;
      const b = data[o + 2] + d;
      const idx = nearestIndex(r, g, b, palRgb);
      data[o] = palRgb[idx * 3];
      data[o + 1] = palRgb[idx * 3 + 1];
      data[o + 2] = palRgb[idx * 3 + 2];
      // data[o+3](alpha)は保持
    }
  }
}

/** ディザ強度(px値スケール)。色帯を散らす量。実装時にスクショで 24〜40 を調整。 */
export const DITHER_STRENGTH = 32;

/**
 * ドット絵化パイプライン。内部低解像度canvasへ全レイヤーを描かせ、
 * 量子化+ディザして画面canvasへ整数倍で拡大転写する(nearest-neighbor)。
 * canvasに依存するためVitestでは扱わず、量子化コア(quantizeRgba)のみテストする。
 */
export class PixelPipeline {
  private buffer: HTMLCanvasElement;
  private bctx: CanvasRenderingContext2D;
  private palRgb = new Uint8Array(0);
  bufW = 1;
  bufH = 1;
  scale = 1;

  constructor(private palette: Uint8Array, private targetTilesX: number, private tilePx: number) {
    this.buffer = document.createElement('canvas');
    this.bctx = this.buffer.getContext('2d')!;
    this.palRgb = palette;
  }

  /** 画面寸法から内部解像度と整数スケールを決める。renderer.resizeから呼ぶ。 */
  resize(screenW: number, screenH: number): void {
    const targetBufW = this.targetTilesX * this.tilePx; // 例 34*6=204
    this.scale = Math.max(1, Math.round(screenW / targetBufW));
    this.bufW = Math.max(160, Math.round(screenW / this.scale));
    this.bufH = Math.max(90, Math.round(screenH / this.scale));
    this.buffer.width = this.bufW;
    this.buffer.height = this.bufH;
    this.bctx.imageSmoothingEnabled = false;
  }

  /** renderer が全レイヤーを描く内部context。 */
  get ctx(): CanvasRenderingContext2D {
    return this.bctx;
  }

  /** 内部バッファを量子化し、画面へ整数拡大転写。余白(レターボックス)は最暗色で塗る。 */
  present(screenCtx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
    const img = this.bctx.getImageData(0, 0, this.bufW, this.bufH);
    quantizeRgba(img.data, this.bufW, this.bufH, this.palRgb, DITHER_STRENGTH);
    this.bctx.putImageData(img, 0, 0);
    screenCtx.imageSmoothingEnabled = false;
    screenCtx.fillStyle = STEEL.black;
    screenCtx.fillRect(0, 0, screenW, screenH);
    const dw = this.bufW * this.scale;
    const dh = this.bufH * this.scale;
    const dx = Math.floor((screenW - dw) / 2);
    const dy = Math.floor((screenH - dh) / 2);
    screenCtx.drawImage(this.buffer, dx, dy, dw, dh);
  }
}
```

- [ ] **Step 4: 通過確認**

Run: `npx vitest run src/render/pixel.test.ts` → PASS
Run: `npm test` → 全PASS。`npx tsc --noEmit` → クリーン(PixelPipeline は型のみ検査。canvasはブラウザ実行で動く)

- [ ] **Step 5: コミット**
```bash
git add src/render/pixel.ts src/render/pixel.test.ts
git commit -m "feat: 段I 量子化コアとPixelPipeline(pixel.ts)"
```
末尾 Co-Authored-By 付き。

---

### Task 4: ズームの離散段化(zoom.ts + main.ts)

**Files:**
- Modify: `src/core/zoom.ts`
- Modify: `src/main.ts:96`
- Test: `src/core/zoom.test.ts`(追記)

ドット絵はサブピクセルのにじみを避けるためズームを離散段に制限する。開放度から得た連続ズームを許可段(1, 3/4, 1/2)へ最近傍スナップする純関数を追加し、main で適用する。

- [ ] **Step 1: 失敗するテストを追記**

`src/core/zoom.test.ts` に追記(既存 import に MIN_ZOOM/MAX_ZOOM あり):
```ts
import { quantizeZoom, ZOOM_STEPS } from './zoom';

describe('quantizeZoom', () => {
  it('許可段(ZOOM_STEPS)のいずれかを返す', () => {
    for (let z = 0.4; z <= 1.05; z += 0.03) {
      expect(ZOOM_STEPS).toContain(quantizeZoom(z));
    }
  });
  it('段そのものはその段を返す', () => {
    for (const s of ZOOM_STEPS) expect(quantizeZoom(s)).toBe(s);
  });
  it('最近傍段へスナップ(1と3/4の中間0.875は近い方へ)', () => {
    // 0.875 は 1(距離0.125)と 0.75(距離0.125)の等距離。境界は0.75以上→1側でも0.75側でもよいが決定論。
    expect(quantizeZoom(0.9)).toBe(1);
    expect(quantizeZoom(0.8)).toBe(0.75);
    expect(quantizeZoom(0.55)).toBe(0.5);
  });
  it('範囲外はクランプ(MIN_ZOOM未満→最小段, MAX_ZOOM超→最大段)', () => {
    expect(quantizeZoom(0.1)).toBe(Math.min(...ZOOM_STEPS));
    expect(quantizeZoom(2)).toBe(Math.max(...ZOOM_STEPS));
  });
  it('単調非減少', () => {
    let prev = quantizeZoom(0.4);
    for (let z = 0.4; z <= 1.05; z += 0.02) {
      const q = quantizeZoom(z);
      expect(q).toBeGreaterThanOrEqual(prev);
      prev = q;
    }
  });
});
```

- [ ] **Step 2: 失敗確認**

Run: `npx vitest run src/core/zoom.test.ts`
Expected: FAIL(quantizeZoom/ZOOM_STEPS 未定義)

- [ ] **Step 3: zoom.ts に追加**

`src/core/zoom.ts` の末尾に追加:
```ts
/**
 * 許可ズーム段(離散)。ドット絵はサブピクセルのにじみを避けるため連続ズームを禁じ、
 * この段のみ許す。MIN_ZOOM(0.5)〜MAX_ZOOM(1)の範囲を3段に分ける。昇順。
 */
export const ZOOM_STEPS: readonly number[] = [0.5, 0.75, 1];

/** 連続ズーム値を最近傍の許可段へスナップ(範囲外はクランプ)。純関数・決定論。 */
export function quantizeZoom(z: number): number {
  let best = ZOOM_STEPS[0];
  let bestD = Infinity;
  for (const s of ZOOM_STEPS) {
    const d = Math.abs(z - s);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}
```

- [ ] **Step 4: main.ts で適用**

`src/main.ts` の zoomTarget 更新箇所(96行:`zoomTarget = targetZoomForOpenness(opennessEma);`)を:
```ts
    zoomTarget = quantizeZoom(targetZoomForOpenness(opennessEma));
```
に変更。import 行(11行)に `quantizeZoom` を追加:
```ts
import { sampleOpenness, targetZoomForOpenness, quantizeZoom } from './core/zoom';
```
(camera.zoomTo による平滑追従はそのまま。目標が段に量子化されるので、静止時は必ず段に収束する)

- [ ] **Step 5: 通過確認**

Run: `npx vitest run src/core/zoom.test.ts` → PASS
Run: `npm test` → 全PASS。`npx tsc --noEmit` → クリーン

- [ ] **Step 6: コミット**
```bash
git add src/core/zoom.ts src/core/zoom.test.ts src/main.ts
git commit -m "feat: 段I ズームの離散段化(quantizeZoom)"
```
末尾 Co-Authored-By 付き。

---

### Task 5: renderer への PixelPipeline 統合(描画先の差し替え)

**Files:**
- Modify: `src/render/renderer.ts`

renderer の描画先を内部オフスクリーンcanvas(PixelPipeline.ctx)に差し替え、末尾で量子化+整数拡大転写する。画角を段階Fの44タイルからドット絵向けの34タイルへ寄せる。既存の各レイヤー描画呼び出しは順序・引数ともそのまま(w/h/pptが内部解像度基準になるだけ)。演出はスクショ目視。

- [ ] **Step 1: renderer.ts の統合**

`src/render/renderer.ts` を以下の方針で改修する:

1. import 追加:
```ts
import { PixelPipeline } from './pixel';
import { paletteRgb } from './palette';
```

2. 画角定数を変更(ドット絵向けに寄せる):
```ts
/** 画面の横幅に収めるタイル数(ドット絵化で44→34に寄せ、1タイルの密度を確保) */
const VIEW_TILES_X = 34;
```

3. フィールドに pipeline 追加、screen context を別に保持:
```ts
  private screenCtx: CanvasRenderingContext2D;
  private pipeline: PixelPipeline;
```
コンストラクタ(既存 `this.ctx = canvas.getContext('2d')!;` の箇所)を:
```ts
    this.screenCtx = canvas.getContext('2d')!;
    // 1タイル≈6内部ドット、画角34タイル。resizeで内部解像度と整数スケールを確定。
    this.pipeline = new PixelPipeline(paletteRgb(), VIEW_TILES_X, 6);
    this.ctx = this.pipeline.ctx; // 各レイヤーは内部バッファへ描く
```
(既存の `private ctx: CanvasRenderingContext2D;` 宣言はそのまま。`this.ctx` が内部bufのcontextを指すようにする)

4. `resize(w, h)` を、画面canvasのサイズ設定後に pipeline をリサイズし、lighting/post は**内部解像度**でリサイズするよう変更:
```ts
  resize(w: number, h: number): void {
    this.canvas.width = w;
    this.canvas.height = h;
    this.pipeline.resize(w, h);
    this.ctx = this.pipeline.ctx; // resizeでbufferサイズが変わってもctx参照は不変だが明示
    this.lighting.resize(this.pipeline.bufW, this.pipeline.bufH);
    this.post.resize(this.pipeline.bufW, this.pipeline.bufH);
  }
```

5. `render(...)` の冒頭、`const w = this.canvas.width; const h = this.canvas.height;` を**内部解像度**へ変更:
```ts
    const w = this.pipeline.bufW;
    const h = this.pipeline.bufH;
```
(チャンク可視範囲・px/py・lighting・post はこの w/h をそのまま使うので変更不要)

5b. **描画に使う zoom を離散段へスナップ(ドット絵のクリスプ保証)**:import に `quantizeZoom` を追加し、
```ts
import { quantizeZoom } from '../core/zoom';
```
既存の ppt 計算(`const ppt = (w / VIEW_TILES_X) * cam.zoom;`)を:
```ts
    // 描画スケールは離散段へスナップ。cam.zoom は連続平滑追従だが、ここで段に丸めることで
    // ズーム遷移中もタイルが整数倍で拡大され、ドット絵がにじまない(段Iの狙い)。
    const ppt = (w / VIEW_TILES_X) * quantizeZoom(cam.zoom);
```
に変更する。これにより「目標の量子化(Task4・main)」と「描画の段スナップ(ここ)」の両方でズームが段に乗り、遷移中も常にクリスプになる。

6. カメラのにじみ防止:`render` 内でチャンク/プレイヤーの画面座標を求める箇所は既に `* ppt + w/2` 形式。ドットにじみを避けるため、mouseX/mouseY は screen 座標(dpr適用済み)で来るので、内部座標へ換算する必要がある。**エイム角の算出だけは内部px基準に合わせる**:
   `render` の引数 `mouseX, mouseY` は画面(dpr)px。内部bufは画面を `scale` で割った座標系なので、プレイヤー画面座標 `px,py`(内部系)とマウスの内部系座標を揃える。マウスを内部系へ換算:
```ts
    // マウスは画面px。内部バッファ座標へ換算(レターボックス中央寄せ+scale)。
    const mbx = (mouseX - (this.canvas.width - this.pipeline.bufW * this.pipeline.scale) / 2) / this.pipeline.scale;
    const mby = (mouseY - (this.canvas.height - this.pipeline.bufH * this.pipeline.scale) / 2) / this.pipeline.scale;
```
   そして既存の `const angle = Math.atan2(mouseY - py, mouseX - px);` を:
```ts
    const angle = Math.atan2(mby - py, mbx - px);
```
   に変更(px/py は内部系のプレイヤー座標)。renderer 内で mouse を使うのはこの angle 算出のみ(drawPlayer/lighting へは angle と px/py を渡すだけで mouse 座標は渡さない)なので、換算は angle の1箇所で完結する。

7. 末尾:`this.post.render(...)` の後、`ctx.restore()`(シェイクの戻し)の後に、内部バッファを画面へ present する:
```ts
    ctx.restore(); // シェイクの平行移動を戻す
    this.aimAngle = angle;
    // 内部バッファを量子化して画面へ整数拡大転写(ドット絵化の最終段)
    this.pipeline.present(this.screenCtx, this.canvas.width, this.canvas.height);
```
   `debugMode` の hierarchy デバッグ描画も内部ctxに対して行われるので現状の位置(restore前)のままでよい。

- [ ] **Step 2: 型チェックとビルド**

Run: `npx tsc --noEmit` → クリーン
Run: `npm test` → 全PASS(renderer はロジック純度に触れないが、念のため全体回帰確認)
Run: `npm run build` → 成功

- [ ] **Step 3: スクショゲート(ドット絵化の目視)**

```bash
node scripts/screenshot.mjs --seed=20260711 --out=screenshots/g1-spawn.png
node scripts/screenshot.mjs --seed=20260711 --pos=200,-1700 --out=screenshots/g1-cavern.png
node scripts/screenshot.mjs --seed=42 --out=screenshots/g1-s42.png
node scripts/screenshot.mjs --seed=42 --pos=262344,-1700 --out=screenshots/g1-water.png
```
すべて exit0+`[pageerror]`無し。目視で確認:
- 画面全体が18色パレットに量子化され、ドット絵になっているか
- ドットがクリスプ(ぼやけ・アンチエイリアスのにじみが無い、整数拡大が効いている)か
- 錆・稼働灯の暖色が残っているか(寒色へ潰れていないか)
- 画角が34タイルに寄って各タイルの密度が上がったか
- HUD文字が読めるか(HUDはDOMなので量子化外。念のため崩れ確認)

不合格なら pixel.ts の `DITHER_STRENGTH`(24〜40)や PixelPipeline の tilePx(5〜7)を調整して再撮影。

- [ ] **Step 4: コミット**
```bash
git add src/render/renderer.ts screenshots/g1-*.png
git commit -m "feat: 段I rendererをPixelPipelineへ統合(全描画のドット絵化・画角34タイル)"
```
(スクショは gitignore 対象なら自動で除外される。その場合は renderer.ts のみ)末尾 Co-Authored-By 付き。

---

### Task 6: 最終確認

**Files:** なし(検証のみ。調整が出たら該当ファイル)

- [ ] **Step 1: 全景スクショと目視判定**

```bash
node scripts/screenshot.mjs --seed=20260711 --out=screenshots/g1-final-spawn.png
node scripts/screenshot.mjs --seed=20260711 --pos=100,-600 --out=screenshots/g1-final-mid.png
node scripts/screenshot.mjs --seed=42 --pos=262344,-1700 --out=screenshots/g1-final-water.png
```
判定基準(spec の成功基準):
1. 全シーンが18色に量子化されドット絵になっている
2. ドットがクリスプ・移動やズーム段でグリッドが破綻しない
3. 暖色(錆・灯)が残る
4. カメラ・物理・当たりは従来通り(プレイヤーが歩ける・ズームが段で変わる)

- [ ] **Step 2: 全体検証**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: 全PASS・クリーン・ビルド成功

- [ ] **Step 3: 未コミット変更をコミット**
```bash
git add -A
git commit -m "feat: 段I ドット絵化基盤 統合確認"
```
末尾 Co-Authored-By 付き。

---

## スコープ外(後続段)
- タイル・装飾のネイティブ・ドット絵化(段II)
- ライティングの段階明度化・複数光源(段III)
- 施設の意味づけ・新構造物・渡り廊下・遺失物・乗り物(段IV)
- 空気遠近・被写界深度(段V)、ブルーム・動的演出(段VI)

## 留意
- 量子化は**表示のみ**。worldgen/物理/破壊差分・当たり判定は不変。
- ネイティブなドット絵タイルは段IIの仕事。段Iは既存描画を量子化で一段ドット絵化する土台。グラデ由来の色帯はディザで散らす。
- パレットは18色固定(寒色16+暖色2)。系統識別は既存の accent/超構造/微量ティントで残す(段IIIで光の色温度でも補強)。
- 画角を44→34タイルに寄せるのはドット絵の密度確保のため。開放時ズームアウトは離散段(0.5/0.75/1)。
