# 段階5「動く世界と音」 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 休憩点の灯の明滅・遠景の建設者・水系の落下粒(§6.6)と WebAudio 合成の足音/ドローン/通過音/光柱のハム/ミュート(§6.7)を入れ、段階3・4 の保留 Minor 8 件を裁定して片づける。

**Architecture:** 動く世界は純粋関数(`src/render/ambient.ts`)が「ワールド座標の平坦な矩形」を返し、既存の `Lighting` の overlay(半解像度)と `Background.bands` に相乗りして描く(新しい描画パスは足さない)。音は `src/audio/params.ts`(純粋関数: 周波数・ゲイン・残響長などのパラメータ計算)と `src/audio/engine.ts`(WebAudio の薄い層。初回入力で AudioContext を開始)に分け、純粋関数だけ Vitest で固定する。`main.ts` が毎フレーム 1 回 `engine.update(...)` に状態を渡す。

**Tech Stack:** Vite + TypeScript + Canvas 2D + WebAudio(OscillatorNode / AudioBufferSourceNode / ConvolverNode)、Vitest。コメントは日本語。

**Spec:** `docs/superpowers/specs/2026-10-18-blame-sim-interface-ascent-design.md` §6.6、§6.7、§9 段階5、§11。

## Global Constraints

- 座標: Y は下向き正。層 cell は [interfaceTop(cell), interfaceTop(cell+1))、天井の板が cell、床の板が cell+1。
- 性能(GPU なし=ヘッドレスのソフトウェア描画が基準): 新しい描画は「平坦な色・少ない色数・lighter の画素数最小」。毎フレームの小矩形は `Lighting` の overlay に相乗り。グラデ・楕円パスは使わない。
- 完了条件: rAF p95 ≤ 16.7〜16.8 ms(`node scripts/frametime.mjs --seed=20260711 --pos=x,y`、基準 origin/master を一時 worktree に切って同じ機械状態で比べる)。render p50 の差は ±1 ms 以内。
- §6.6: 灯は周期 2〜5 秒、個別位相、確率的に一瞬消える。建設者は孔スロットごとに 0〜2 体、0.3 タイル/秒、位置 = スロット内の初期位置 + 速度 × simTime をスロット幅で折り返す。落下粒は水系の層の光柱の中、1 画面 12 個まで。
- §6.7: アセットなし。初回入力で AudioContext を開始。足音は `walkPhase` の整数跨ぎ、残響長は開放度に比例。層ごとに 1 本のドローン(バイオームで音程・倍音)。界面に近づくとうなり。通過音 1 音(低い正弦波の減衰音)。光柱の近くで高周波のハム(距離で減衰)。マスター −12 dB、ミュート `M`。
- 既存テスト 441 が全て通り、`tsc` と `vite build` が成功する。

## Review Focus

1. **音の開始前の入力**: AudioContext が無い間(初回入力前)に足音・通過音のイベントが来ても例外にならず、無視される(Task 6 の engine は `ctx === null` で早期 return。純粋関数側は Task 5 のテストで入力の範囲を固定)。
2. **眺望(ズーム 0.35)で休憩点が複数入る**: 灯の矩形が 15 枚程度になる。lighter の画素数は 1×1 タイル(0.35 では 1 px 未満)で性能規則内。Task 2 のテストで「視野の外の休憩点の灯は返さない」を固定。
3. **ミュートの連打とフォーカス喪失**: `M` はトグル。keydown の自動リピートでチャタらない(`e.repeat` を無視)。blur で keys は消えるがミュート状態は保つ(Task 7 の Input)。
4. **界面の板の中(縦坑)でのドローン切り替え**: 層が変わる瞬間に音が跳ばない。Task 6 でゲインの `setTargetAtTime`(時定数 0.4 秒)でクロスフェードし、Task 5 の `droneParams` は cell が同じなら同じ値を返す(決定論)。
5. **落下粒の上限**: 視野に光柱が 3 本入っても合計 12 個を超えない(Task 3 のテスト)。

---

## ファイル構成

- Create `src/render/ambient.ts` — §6.6 の純粋関数(灯の明滅・建設者・落下粒)と、overlay へ描く `AmbientLights` クラス。
- Create `src/render/ambient.test.ts`
- Modify `src/render/landmarkLight.ts` — 矩形描画を `drawLightRects` として export(`LandmarkLights.render` と `AmbientLights.render` で共有)。矩形数のコメントを更新(段階4 Minor 4)。
- Modify `src/render/background.ts` — `bands` の直後に建設者のシルエットを描く。
- Modify `src/render/renderer.ts` — overlay に `AmbientLights` を相乗りさせる。
- Create `src/audio/params.ts` — §6.7 の純粋関数(足音・残響長・ドローン・うなり・通過音・ハム・マスター)。
- Create `src/audio/params.test.ts`
- Create `src/audio/engine.ts` — WebAudio の薄い層 `AudioEngine`(テスト対象外)。
- Modify `src/core/input.ts` — keydown のエッジ(`takePressed()`)、`M` のトグル、右 Shift を外す(段階3 Minor 3)。
- Modify `src/core/view.ts`, `src/core/view.test.ts` — `ViewInput.newlyMoving`(キー別の立ち上がり。段階3 Minor 1)。
- Modify `src/main.ts` — 音の配線、HUD の階層判定を接地時だけに(段階3 Minor 2)。
- Modify `src/world/restpoint.ts`, `src/world/restpoint.test.ts` — `restPointTileAt` の Y 早期棄却(段階4 Minor 2)、荷袋が梯子列に乗らない(段階4 Minor 3)。
- Modify `src/world/interface.test.ts` — 大界面の `overlookCellAt` テスト(段階3 Minor 4)。
- Modify `README.md` — ミュートの説明、左 Shift。

---

### Task 1: 休憩点の灯の明滅(純粋関数)

**Files:**
- Create: `src/render/ambient.ts`
- Test: `src/render/ambient.test.ts`

**Interfaces:**
- Consumes: `restPointAt(seed, cell, k).lamps / floorY / left / right`(`src/world/restpoint.ts`)、`hash2(seed, a, b)`(`src/world/noise.ts`、0..1)、`LightRect`(`src/render/landmarkLight.ts`)、`biomeCellAt`、`PASSAGE_SLOT`。
- Produces:
  - `export const LAMP_PERIOD_MIN = 2; export const LAMP_PERIOD_MAX = 5;`
  - `export const LAMP_BLACKOUT_RATE = 0.12;`(周期ごとに 12% の確率で、周期の先頭 8% の間だけ消える)
  - `export const LAMP_COLOR = '#ffb866'; export const LAMP_ALPHA = 0.45; export const LAMP_HALO_ALPHA = 0.08;`
  - `export interface Lamp { period: number; phase: number }`
  - `export function lampParams(seed: number, cell: number, k: number, i: number): Lamp` — `period = LAMP_PERIOD_MIN + hash2(seed + 9301, cell * 8 + i, k) * (MAX − MIN)`、`phase = hash2(seed + 9302, cell * 8 + i, k)`(0..1、周期の割合)。
  - `export function lampGlow(timeSec: number, lamp: Lamp, seed: number, id: number): number` — 0..1。`u = frac(timeSec / period + phase)`、`n = floor(timeSec / period + phase)`(何周期目か)。`hash2(seed + 9303, id, n) < LAMP_BLACKOUT_RATE && u < 0.08` なら 0。それ以外は `0.6 + 0.4 * (0.5 + 0.5 * sin(2π u))`。
  - `export function lampLightsInView(seed, camX, camY, spanX, spanY, timeSec): LightRect[]` — `landmarkLightsInView` と同じ走査(cell c0..c1、k k0..k1)。視野に掛かる休憩点の各灯 i(X = `rp.lamps[i]`、Y = `rp.floorY − 1`)について、glow > 0 なら灯 1 枚 `[lx, lx+1)×[floorY−1, floorY)` alpha `LAMP_ALPHA * glow` と暈 1 枚 `[lx−1, lx+2)×[floorY−2, floorY)` alpha `LAMP_HALO_ALPHA * glow`、色 `LAMP_COLOR`。id は `cell * 1000 + k * 8 + i`(`hash2` の引数)。

- [ ] **Step 1: 失敗するテストを書く**(`src/render/ambient.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { restPointAt } from '../world/restpoint';
import { LAMP_COLOR, LAMP_PERIOD_MAX, LAMP_PERIOD_MIN, lampGlow, lampLightsInView, lampParams } from './ambient';

describe('lampParams / lampGlow', () => {
  it('周期は 2〜5 秒、位相は 0..1、灯ごとに異なる', () => {
    const a = lampParams(20260711, 0, 0, 0);
    const b = lampParams(20260711, 0, 0, 1);
    expect(a.period).toBeGreaterThanOrEqual(LAMP_PERIOD_MIN);
    expect(a.period).toBeLessThanOrEqual(LAMP_PERIOD_MAX);
    expect(a.phase).toBeGreaterThanOrEqual(0);
    expect(a.phase).toBeLessThan(1);
    expect(a.period !== b.period || a.phase !== b.phase).toBe(true);
  });
  it('明るさは 0..1、周期で繰り返し、消える瞬間がある(1000 周期で 5〜20%)', () => {
    const lamp = { period: 3, phase: 0.25 };
    let blackouts = 0;
    for (let n = 0; n < 1000; n++) {
      const t0 = (n - lamp.phase) * lamp.period; // 周期 n の先頭
      const g = lampGlow(t0 + 0.01, lamp, 1, 7);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
      if (g === 0) blackouts++;
      expect(lampGlow(t0 + 1, lamp, 1, 7)).toBeCloseTo(lampGlow(t0 + 1 + lamp.period * 0, lamp, 1, 7), 10);
    }
    expect(blackouts).toBeGreaterThan(50);
    expect(blackouts).toBeLessThan(200);
    // 消灯は周期の先頭 8% だけ: 周期の半ばは常に点いている
    for (let n = 0; n < 100; n++) expect(lampGlow((n - lamp.phase + 0.5) * lamp.period, lamp, 1, 7)).toBeGreaterThan(0.5);
  });
});

describe('lampLightsInView', () => {
  it('視野に入る休憩点の灯ごとに灯+暈の 2 枚(消灯中は 0 枚)、視野外は返さない', () => {
    const seed = 20260711;
    const rp = restPointAt(seed, 0, 0);
    const rects = lampLightsInView(seed, rp.x, rp.floorY - 6, 60, 40, 0.37);
    expect(rects.length % 2).toBe(0);
    expect(rects.length).toBeLessThanOrEqual(rp.lamps.length * 2);
    for (const r of rects) {
      expect(r.color).toBe(LAMP_COLOR);
      expect(r.y1).toBe(rp.floorY);
      expect(rp.lamps.some((lx) => r.x0 <= lx && r.x1 > lx)).toBe(true);
    }
    // 点灯している灯が 1 つはある(全消灯は確率的にほぼ無い)
    expect(rects.length).toBeGreaterThan(0);
    expect(lampLightsInView(seed, rp.x + 2000, rp.floorY - 6, 60, 40, 0.37).some((r) => r.x0 < rp.right)).toBe(false);
  });
});
```

- [ ] **Step 2: 失敗を確認** — `npx vitest run src/render/ambient.test.ts` → FAIL(モジュール無し)
- [ ] **Step 3: `src/render/ambient.ts` に上の Interfaces を実装**(ファイル先頭に §6.6 の説明と性能規則のコメント)
- [ ] **Step 4: 通過を確認** — `npx vitest run src/render/ambient.test.ts` → PASS
- [ ] **Step 5: コミット** — `git add src/render/ambient.ts src/render/ambient.test.ts && git commit -m "feat: rest-point lamp flicker as pure light rects"`

### Task 2: 遠景の建設者(純粋関数)

**Files:**
- Modify: `src/render/ambient.ts`
- Test: `src/render/ambient.test.ts`

**Interfaces:**
- Consumes: `hash2`、`PASSAGE_SLOT`(384)、`interfaceBottom(seed, cell)`、`biomeCellAt`。
- Produces:
  - `export const BUILDER_SPEED = 0.3;`(タイル/秒)`export const BUILDER_MAX = 2;`
  - `export interface Builder { cell: number; k: number; x: number; y: number; dir: 1 | -1 }` — x はワールド X(タイル)、y は板の下面 `interfaceBottom(seed, cell)`(裏面に沿う)。
  - `export function buildersInSlot(seed: number, cell: number, k: number, simTime: number): Builder[]` — 個数 `n = floor(hash2(seed + 9401, cell, k) * (BUILDER_MAX + 1))`(0..2)。i 番目: `x0 = hash2(seed + 9402, cell * 4 + i, k) * PASSAGE_SLOT`、`dir = hash2(seed + 9403, cell * 4 + i, k) < 0.5 ? -1 : 1`、`x = k * PASSAGE_SLOT + mod(x0 + dir * BUILDER_SPEED * simTime, PASSAGE_SLOT)`(折り返し = 端に達したら反対側から出る)。
  - `export function buildersInView(seed, camX, camY, spanX, spanY, simTime): Builder[]` — 描画は追従率 `BAND_FACTOR`(0.6)なので、視野は `(camX ± spanX/2/0.6, camY ± spanY/2/0.6)` で切る。cell は `biomeCellAt(seed, y0) − 1 .. biomeCellAt(seed, y1) + 1` で、板の下面が縦の範囲に入るものだけ。

- [ ] **Step 1: 失敗するテストを追加**

```ts
import { BUILDER_MAX, BUILDER_SPEED, buildersInSlot, buildersInView } from './ambient';
import { interfaceBottom, PASSAGE_SLOT } from '../world/interface';

describe('buildersInSlot', () => {
  it('スロットごとに 0〜2 体、X はスロット内、Y は板の下面', () => {
    const seed = 20260711;
    let total = 0;
    for (let k = -5; k <= 5; k++) {
      const bs = buildersInSlot(seed, 0, k, 123.4);
      expect(bs.length).toBeLessThanOrEqual(BUILDER_MAX);
      total += bs.length;
      for (const b of bs) {
        expect(b.x).toBeGreaterThanOrEqual(k * PASSAGE_SLOT);
        expect(b.x).toBeLessThan((k + 1) * PASSAGE_SLOT);
        expect(b.y).toBe(interfaceBottom(seed, 0));
      }
    }
    expect(total).toBeGreaterThan(0);
  });
  it('位置 = 初期位置 + 速度 × simTime(0.3 タイル/秒)をスロット幅で折り返す', () => {
    const seed = 42;
    for (let k = -3; k <= 3; k++) {
      const at0 = buildersInSlot(seed, 1, k, 0);
      for (let i = 0; i < at0.length; i++) {
        const b0 = at0[i];
        const b1 = buildersInSlot(seed, 1, k, 10)[i];
        const d = b1.x - b0.x;
        const wrapped = d - b0.dir * BUILDER_SPEED * 10;
        expect(Math.abs(wrapped) < 1e-9 || Math.abs(Math.abs(wrapped) - PASSAGE_SLOT) < 1e-9).toBe(true);
        expect(buildersInSlot(seed, 1, k, PASSAGE_SLOT / BUILDER_SPEED)[i].x).toBeCloseTo(b0.x, 6);
      }
    }
  });
  it('buildersInView は板の下面が視野(追従率 0.6 で広げた範囲)に入る層だけ返す', () => {
    const seed = 20260711;
    const y = interfaceBottom(seed, 0);
    const near = buildersInView(seed, 200, y, 44, 24, 5);
    expect(near.every((b) => b.y === y || Math.abs(b.y - y) <= 24 / 2 / 0.6)).toBe(true);
    const far = buildersInView(seed, 200, y + 200, 44, 24, 5);
    expect(far.some((b) => b.y === y)).toBe(false);
  });
});
```

- [ ] **Step 2: 失敗を確認** — `npx vitest run src/render/ambient.test.ts` → FAIL(`buildersInSlot` 未定義)
- [ ] **Step 3: 実装**(`mod` は `src/world/interface.ts` の `mod` を使う)
- [ ] **Step 4: 通過を確認**
- [ ] **Step 5: コミット** — `git commit -m "feat: far builders walking along the plate underside (pure)"`

### Task 3: 水系の落下粒(純粋関数)

**Files:**
- Modify: `src/render/ambient.ts`
- Test: `src/render/ambient.test.ts`

**Interfaces:**
- Consumes: `beaconsInView(seed, camX, camY, spanX, spanY): Beacon[]`(`src/render/beacon.ts`。`x, top, floor, color, cell, k`)、`biomeIdForCell(seed, cell)`(`src/world/biomeCells.ts`、`'waterVoid'` が水系)、`BEACON_HALF_WIDTH`(12)。
- Produces:
  - `export const DROPS_MAX = 12; export const DROPS_PER_BEACON = 6; export const DROP_SPEED = 14;`(タイル/秒)`export const DROP_ALPHA = 0.5;`
  - `export function isWaterLayer(seed: number, cell: number): boolean` — `biomeIdForCell(seed, cell) === 'waterVoid'`(光柱 cell の前室は層 cell の中)。
  - `export function fallingDropsInView(seed, camX, camY, spanX, spanY, timeSec): LightRect[]` — 水系の光柱ごとに `DROPS_PER_BEACON` 個、i 番目: `dx = (hash2(seed + 9501, b.cell * 8 + i, b.k) * 2 − 1) * (BEACON_HALF_WIDTH − 1)`、`phase = hash2(seed + 9502, b.cell * 8 + i, b.k)`、`y = b.top + mod(phase * H + DROP_SPEED * timeSec, H)`(`H = b.floor − b.top`)。矩形 `[x, x+1)×[y, y+2)`(縦 2 タイルの粒)、色 `b.color`、alpha `DROP_ALPHA`。視野の縦範囲 `[y0, y1]` に掛かる粒だけ。合計 `DROPS_MAX` で打ち切る。

- [ ] **Step 1: 失敗するテストを追加**

```ts
import { beaconsInView } from './beacon';
import { biomeIdForCell } from '../world/biomeCells';
import { DROP_SPEED, DROPS_MAX, fallingDropsInView, isWaterLayer } from './ambient';

describe('fallingDropsInView', () => {
  // seed 1〜200 から水系の板を探す(biomeIdForCell が waterVoid の cell)
  const water = (() => {
    for (let seed = 1; seed < 200; seed++) for (let cell = -4; cell <= 4; cell++) if (biomeIdForCell(seed, cell) === 'waterVoid') return { seed, cell };
    throw new Error('no water layer');
  })();
  it('水系の層の光柱の中にだけ粒があり、X は柱の幅、Y は板の下面〜床', () => {
    const { seed, cell } = water;
    const bs = beaconsInView(seed, 192, 0, 1e9, 1e9).filter((x) => x.cell === cell);
    expect(bs.length).toBeGreaterThan(0);
    const bc = bs[0];
    const rects = fallingDropsInView(seed, bc.x, (bc.top + bc.floor) / 2, 30, bc.floor - bc.top + 4, 3.3);
    expect(rects.length).toBeGreaterThan(0);
    for (const r of rects) {
      expect(r.x0).toBeGreaterThanOrEqual(bc.x - 12);
      expect(r.x1).toBeLessThanOrEqual(bc.x + 12);
      expect(r.y0).toBeGreaterThanOrEqual(bc.top);
      expect(r.y0).toBeLessThan(bc.floor);
      expect(r.color).toBe(bc.color);
    }
    expect(isWaterLayer(seed, cell)).toBe(true);
  });
  it('水系でない層には粒が無い', () => {
    const seed = 20260711;
    for (let cell = -3; cell <= 3; cell++) {
      if (isWaterLayer(seed, cell)) continue;
      const bs = beaconsInView(seed, 192, 0, 1e9, 1e9).filter((x) => x.cell === cell);
      for (const bc of bs) expect(fallingDropsInView(seed, bc.x, (bc.top + bc.floor) / 2, 30, 60, 1).length).toBe(0);
    }
  });
  it('1 画面 12 個まで(視野に光柱が何本入っても)', () => {
    const { seed, cell } = water;
    const bc = beaconsInView(seed, 192, 0, 1e9, 1e9).find((x) => x.cell === cell)!;
    expect(fallingDropsInView(seed, bc.x, bc.top + 24, 3000, 100, 2).length).toBeLessThanOrEqual(DROPS_MAX);
  });
  it('粒は時間で下へ動き、床で折り返す', () => {
    const { seed, cell } = water;
    const bc = beaconsInView(seed, 192, 0, 1e9, 1e9).find((x) => x.cell === cell)!;
    const H = bc.floor - bc.top;
    const a = fallingDropsInView(seed, bc.x, bc.top + H / 2, 30, H * 2, 0)[0];
    const b = fallingDropsInView(seed, bc.x, bc.top + H / 2, 30, H * 2, 0.1).find((r) => r.x0 === a.x0)!;
    const d = b.y0 - a.y0;
    expect(Math.abs(d - DROP_SPEED * 0.1) < 1e-6 || Math.abs(d - DROP_SPEED * 0.1 + H) < 1e-6).toBe(true);
  });
});
```

- [ ] **Step 2: 失敗を確認**
- [ ] **Step 3: 実装**
- [ ] **Step 4: 通過を確認**
- [ ] **Step 5: コミット** — `git commit -m "feat: falling drops inside water-layer beacons (pure, capped at 12)"`

### Task 4: 動く世界の描画の配線

**Files:**
- Modify: `src/render/landmarkLight.ts`(`LandmarkLights.render` の矩形ループを `export function drawLightRects(ctx, rects: LightRect[], cam, w, h, ppt): void` に切り出す。ファイル先頭の「最大でも 6 枚程度」のコメントを「塔 2・崩落 3・休憩点 1 に加え、眺望(0.35)で休憩点が複数入ると灯(ambient.ts)で 10〜20 枚。1 枚は 1〜2 タイルで画素数は小さい」に改める)
- Modify: `src/render/ambient.ts`(`export class AmbientLights { constructor(seed); render(ctx, cam, w, h, ppt, timeSec) }` — `lampLightsInView` と `fallingDropsInView` を連結して `drawLightRects`)
- Modify: `src/render/renderer.ts:336-341`(overlay のコールバックに `this.ambientLights.render(lctx, renderCam, w * s, h * s, ppt * s, timeSec)` を足す。フィールドとコンストラクタも)
- Modify: `src/render/background.ts`(`bands` の後に `builders(ctx, camX, camY, w, h, ppt, simTime)`: `buildersInView(seed, camX, camY, w/ppt, h/ppt, simTime)` の各体を、追従率 `BAND_FACTOR` で `sx = (b.x − camX) * 0.6 * ppt + w/2`、`sy = (b.y − camY) * 0.6 * ppt + h/2` に、幅 `max(2, 1.2*0.6*ppt)`・高さ `max(2, 1.8*0.6*ppt)` の矩形を板の下面から下へ、色 `STEEL.far`、alpha 0.55 で描く。`Background.render` に `simTime: number` 引数を足し、`renderer.ts` の呼び出しで `timeSec` を渡す)

**Interfaces:**
- Consumes: Task 1〜3 の関数、`Lighting.render` の overlay 引数 `(ctx, scale)`。
- Produces: 無し(描画のみ)。

- [ ] **Step 1: `drawLightRects` を切り出し、`LandmarkLights.render` がそれを呼ぶようにする** — `npx vitest run src/render/landmarkLight.test.ts` → PASS(純粋関数は不変)
- [ ] **Step 2: `AmbientLights` と `Background.builders` を実装し、`renderer.ts` に配線**
- [ ] **Step 3: `npx tsc --noEmit -p .` → エラー無し**
- [ ] **Step 4: スクリーンショットで目視** — `node scripts/screenshot.mjs --seed=20260711 --pos=259,224.2 --out=screenshots/s5-rest-a.png --wait=2500` と `--wait=3700`(2 枚で灯の明るさが変わる)。建設者: 板の下面が画面に入る前室 `--pos=196,31`(板の下 0.6 追従なので画面上寄りに小さい影が見える)。水系の粒: Task 3 のテストが見つけた seed/cell の光柱の真下(`beaconsInView` の x, floor−2 を `--pos` に)。
- [ ] **Step 5: コミット** — `git commit -m "feat: wire lamp flicker, drops and builders into overlay and bands"`

### Task 5: 音のパラメータ(純粋関数)

**Files:**
- Create: `src/audio/params.ts`
- Test: `src/audio/params.test.ts`

**Interfaces:**
- Consumes: `BiomeId`(`src/world/biomeCells.ts`)。
- Produces:
  - `export const MASTER_DB = -12; export function dbToGain(db: number): number` — `10 ** (db / 20)`。
  - `export function footstepCrossed(prevPhase: number, phase: number): boolean` — `floor(prevPhase) !== floor(phase)`。
  - `export const REVERB_MIN = 0.15; export const REVERB_MAX = 1.6;` `export function reverbSeconds(openness: number): number` — `REVERB_MIN + clamp01(openness) * (REVERB_MAX − REVERB_MIN)`。
  - `export const REVERB_BUCKETS = 6;` `export function reverbBucket(openness: number): number` — `round(clamp01(openness) * (REVERB_BUCKETS − 1))`(0..5。インパルスはバケットごとに 1 回だけ作る)。`export function reverbSecondsForBucket(bucket: number): number` — `reverbSeconds(bucket / (REVERB_BUCKETS − 1))`。
  - `export interface DroneParams { freq: number; harmonics: readonly number[]; type: OscillatorType; gainDb: number }`
  - `export const DRONE_TABLE: Record<BiomeId, DroneParams>` — coldSteel `{55, [1, 2, 3], 'sine', −6}`、habitation `{65.41, [1, 1.5, 2], 'triangle', −9}`、disposal `{49, [1, 2.01, 2.5], 'sawtooth', −12}`、waterVoid `{41.2, [1, 2, 4], 'sine', −6}`、power `{73.42, [1, 3, 5], 'square', −15}`。`export function droneParams(id: BiomeId): DroneParams`。
  - `export const BEAT_RANGE = 24;` `export function interfaceBeat(distToPlate: number): number` — 板(上面または下面)までの距離 d(タイル)で `clamp01(1 − d / BEAT_RANGE)`(0..1 のうなりのゲイン)。`export const BEAT_DETUNE_HZ = 0.7;`
  - `export const PASSAGE_FREQ = 110; export const PASSAGE_DECAY = 1.8;`(正弦波、指数減衰 1.8 秒)
  - `export const HUM_FREQ = 2200; export const HUM_RANGE = 64;` `export function beaconHum(dx: number, dy: number): number` — 光柱の軸からの水平距離 |dx| と、前室の縦範囲からのはみ出し dy(前室の中なら 0)で `clamp01(1 − max(|dx|, |dy|) / HUM_RANGE)`。
  - `export function nearestPlateDistance(seed: number, y: number): number` — `biomeCellAt(seed, y)` の cell と cell+1 の板について `min(|y − interfaceTop(c)|, |y − interfaceBottom(c)|)`。

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, expect, it } from 'vitest';
import { BIOME_IDS } from '../world/biomeCells';
import { interfaceBottom, interfaceTop } from '../world/interface';
import {
  BEAT_RANGE, dbToGain, DRONE_TABLE, droneParams, footstepCrossed, HUM_RANGE, beaconHum, interfaceBeat,
  MASTER_DB, nearestPlateDistance, REVERB_BUCKETS, REVERB_MAX, REVERB_MIN, reverbBucket, reverbSeconds, reverbSecondsForBucket,
} from './params';

describe('audio params', () => {
  it('マスターは −12 dB ≈ 0.251', () => {
    expect(dbToGain(MASTER_DB)).toBeCloseTo(0.251, 3);
    expect(dbToGain(0)).toBe(1);
  });
  it('足音は walkPhase の整数跨ぎ', () => {
    expect(footstepCrossed(0.9, 1.1)).toBe(true);
    expect(footstepCrossed(1.1, 1.9)).toBe(false);
    expect(footstepCrossed(2, 2)).toBe(false);
  });
  it('残響は開放度に比例(0.15〜1.6 秒)、バケットは 0..5 で単調', () => {
    expect(reverbSeconds(0)).toBe(REVERB_MIN);
    expect(reverbSeconds(1)).toBe(REVERB_MAX);
    expect(reverbSeconds(0.5)).toBeCloseTo((REVERB_MIN + REVERB_MAX) / 2, 10);
    expect(reverbSeconds(2)).toBe(REVERB_MAX);
    expect(reverbBucket(0)).toBe(0);
    expect(reverbBucket(1)).toBe(REVERB_BUCKETS - 1);
    let prev = -1;
    for (let o = 0; o <= 1; o += 0.05) { const b = reverbBucket(o); expect(b).toBeGreaterThanOrEqual(prev); prev = b; }
    expect(reverbSecondsForBucket(REVERB_BUCKETS - 1)).toBe(REVERB_MAX);
  });
  it('ドローンは 5 バイオームで音程が全て異なり、倍音は 1 から始まる', () => {
    const freqs = new Set(BIOME_IDS.map((id) => droneParams(id).freq));
    expect(freqs.size).toBe(BIOME_IDS.length);
    for (const id of BIOME_IDS) {
      expect(DRONE_TABLE[id].harmonics[0]).toBe(1);
      expect(DRONE_TABLE[id].gainDb).toBeLessThanOrEqual(0);
    }
  });
  it('うなりは板で 1、24 タイルで 0', () => {
    expect(interfaceBeat(0)).toBe(1);
    expect(interfaceBeat(BEAT_RANGE / 2)).toBeCloseTo(0.5, 10);
    expect(interfaceBeat(BEAT_RANGE)).toBe(0);
    expect(interfaceBeat(100)).toBe(0);
  });
  it('最寄りの板までの距離: 板の上面・下面で 0、層の中腹で正', () => {
    const seed = 20260711;
    expect(nearestPlateDistance(seed, interfaceTop(seed, 0))).toBe(0);
    expect(nearestPlateDistance(seed, interfaceBottom(seed, 0))).toBe(0);
    expect(nearestPlateDistance(seed, interfaceBottom(seed, 0) + 100)).toBeGreaterThan(50);
  });
  it('ハムは軸で 1、64 タイルで 0', () => {
    expect(beaconHum(0, 0)).toBe(1);
    expect(beaconHum(HUM_RANGE, 0)).toBe(0);
    expect(beaconHum(0, HUM_RANGE / 2)).toBeCloseTo(0.5, 10);
    expect(beaconHum(-16, 8)).toBeCloseTo(1 - 16 / HUM_RANGE, 10);
  });
});
```

- [ ] **Step 2: 失敗を確認** — `npx vitest run src/audio/params.test.ts` → FAIL
- [ ] **Step 3: `src/audio/params.ts` を実装**
- [ ] **Step 4: 通過を確認**
- [ ] **Step 5: コミット** — `git commit -m "feat: audio parameter functions (pure)"`

### Task 6: WebAudio の薄い層

**Files:**
- Create: `src/audio/engine.ts`(テスト対象外)

**Interfaces:**
- Consumes: Task 5。
- Produces:
  ```ts
  export interface AudioFrame {
    biome: BiomeId;        // 今いる層のバイオーム(ドローン)
    plateDistance: number; // nearestPlateDistance
    openness: number;      // 足音の残響(opennessEma)
    hum: number;           // beaconHum の値(0..1)
    walking: boolean;      // 接地歩行中
    walkPhase: number;
  }
  export class AudioEngine {
    /** 初回入力(keydown / mousedown / pointerdown)で呼ぶ。2 回目以降は no-op。AudioContext を作り resume する */
    start(): void;
    get started(): boolean;
    /** ミュート: マスターゲインを 0 / dbToGain(MASTER_DB) に setTargetAtTime(0.05) */
    setMuted(muted: boolean): void;
    get muted(): boolean;
    /** 毎フレーム。ドローンの切り替え(層が変わればクロスフェード 0.4 秒)、うなり・ハムのゲイン、足音の発火(footstepCrossed) */
    update(frame: AudioFrame): void;
    /** 通過音(autoViewStarted のフレーム) */
    passage(): void;
  }
  ```
  - グラフ: `master(GainNode) → destination`。`dry → master`、`convolver(ConvolverNode) → wet(Gain 0.35) → master`。ドローン: 倍音ごとの `OscillatorNode → droneGain`(1 層分)。層が変わったら新しい組を作って旧組のゲインを 0 へ `setTargetAtTime(…, 0.4)` し 2 秒後に stop。うなり: `freq + BEAT_DETUNE_HZ` の正弦波を `beatGain`(`interfaceBeat` × 0.5)で足す。ハム: 2200 Hz 正弦波 + 7 Hz の LFO で振幅 ±30%、`humGain = hum * 0.06`。足音: 長さ 0.06 秒のホワイトノイズバッファを `BiquadFilterNode(bandpass 900 Hz, Q 1.2)` 経由で dry と convolver の両方へ、ゲイン 0.5、指数減衰。インパルス応答は `reverbBucket(openness)` ごとに `reverbSecondsForBucket` 秒の指数減衰ノイズ(ステレオ 2ch)を初回に作ってキャッシュし、バケットが変わったら `convolver.buffer` を差し替える。通過音: `PASSAGE_FREQ` の正弦波を 1.0 → 0.001 へ `PASSAGE_DECAY` 秒で `exponentialRampToValueAtTime`、ゲイン 0.6。
  - 全ての公開メソッドは `this.ctx === null`(開始前)なら何もしない。

- [ ] **Step 1: `src/audio/engine.ts` を実装**
- [ ] **Step 2: `npx tsc --noEmit -p .` → エラー無し**
- [ ] **Step 3: コミット** — `git commit -m "feat: WebAudio engine (drone, footsteps with openness reverb, passage tone, beacon hum)"`

### Task 7: 入力の整理(エッジ検出・ミュートのトグル・右 Shift)と眺望の打ち切り

**Files:**
- Modify: `src/core/input.ts`
- Modify: `src/core/view.ts`, `src/core/view.test.ts`
- Modify: `README.md:22-23`

**Interfaces:**
- Produces(`Input`):
  - `private pressed = new Set<string>()` — keydown(`e.repeat` は無視)で追加。`takePressed(): Set<string>` — 現在の集合を返して空にする(update の先頭で 1 回呼ぶ)。
  - `muted = false` — `KeyM` の keydown(repeat 以外)でトグル。
  - `onFirstInput(cb: () => void): void` — keydown / mousedown / pointerdown の最初の 1 回で cb を呼ぶ(`{ once: true }` を 3 つ登録し、どれかが呼ばれたら残りを外す)。
  - `shiftHeld` は `ShiftLeft` だけ。`GAME_KEYS` から `ShiftRight` を外す(8 秒長押しの固定キー機能のダイアログ対策。README に「左 Shift」と書く)。
- Produces(`view.ts`): `ViewInput.newlyMoving: boolean`(このフレームに新たに押された移動キーがあるか。`moving` は残す)。`viewState` は `newlyMoving` で打ち切り、`ViewState.prevMoving` を削除。

- [ ] **Step 1: `src/core/view.test.ts` を `newlyMoving` に書き換える** — 既定の入力に `newlyMoving: false` を足し、「押しっぱなしでは打ち切らない」のテストは `moving: true, newlyMoving: false`、「新たに押すと打ち切る」は `newlyMoving: true` にする。新しいケース: 「D を押したまま Space を新たに押すと打ち切る(`moving: true, newlyMoving: true`)」。`npx vitest run src/core/view.test.ts` → FAIL
- [ ] **Step 2: `view.ts` を実装**(`prevMoving` と `INITIAL_VIEW.prevMoving` を削除)→ PASS
- [ ] **Step 3: `Input` を実装**。`main.ts` の `update` 先頭で `const pressed = input.takePressed()` を取り、`newlyMoving = ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyA','KeyD','KeyW','KeyS','Space'].some((c) => pressed.has(c))` を `viewState` に渡す。
- [ ] **Step 4: README の眺望の行を「左 `Shift`」に、ミュートの行を「`M` でトグル(合成音。初回のキー/クリックで音が始まる)」に**
- [ ] **Step 5: `npx vitest run && npx tsc --noEmit -p .` → PASS**
- [ ] **Step 6: コミット** — `git commit -m "feat: key edges in Input, M toggles mute, left Shift only; per-key view cutoff"`

### Task 8: main.ts の音の配線と HUD の階層判定

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `AudioEngine`、`AudioFrame`、`nearestPlateDistance`、`beaconHum`、`beaconsInView`、`biomeIdForCell`、`opennessEma`(既存)、`autoViewStarted`(既存)。

- [ ] **Step 1: 配線**
  - `const audio = new AudioEngine(); input.onFirstInput(() => audio.start());`
  - `update` の中: `if (input.muted !== audio.muted) audio.setMuted(input.muted)`。`autoViewStarted` の分岐で `audio.passage()`。
  - `update` の末尾で `audio.update({ biome: biomeIdForCell(seed, cell), plateDistance: nearestPlateDistance(seed, player.centerY), openness: opennessEma ?? 0.5, hum, walking: player.body.onGround && player.body.vx !== 0, walkPhase: player.walkPhase })`。`hum` は `beaconsInView(seed, player.centerX, player.centerY, 2 * HUM_RANGE, 2 * HUM_RANGE)` の各光柱について `beaconHum(player.centerX − b.x, player.centerY < b.top ? b.top − player.centerY : player.centerY > b.floor ? player.centerY − b.floor : 0)` の最大(無ければ 0)。これは 1 フレームに数回の `passageX` 呼び出しで軽い。
  - HUD(段階3 Minor 2): `maxLayer` の更新を `player.body.onGround` のときだけにする(孔の梯子の上端 top−4 まで登って降りても上がらない)。コメントに理由を書く。
- [ ] **Step 2: `npx tsc --noEmit -p . && npx vite build` → 成功**
- [ ] **Step 3: ブラウザで手動確認**(`npm run dev`、キーを押すと音が始まる、M でミュート、歩くと足音、見晴らし台で通過音)。ヘッドレスでは音は出ないので目視と console のエラー無しだけ確認。
- [ ] **Step 4: コミット** — `git commit -m "feat: wire audio engine into the main loop; HUD layer only updates on ground"`

### Task 9: 段階4 の保留 Minor(休憩点)と大界面の overlookCellAt テスト

**Files:**
- Modify: `src/world/restpoint.ts`, `src/world/restpoint.test.ts`
- Modify: `src/world/interface.test.ts`

**Interfaces:**
- Produces: `export function restPointBand(seed: number, cell: number): { y0: number; y1: number }` — その層の休憩点の箱が取り得る Y の範囲 `[bottom + round(0.4H) − REST_HEIGHT − 1, bottom + round(0.6H)]`。`restPointTileAt` と `restWarmthAt` の先頭で `y` がこの帯の外(warmth は帯 ± REST_WARM_FADE の外)なら `nearestRestPoint` を呼ばずに `null` / 0 を返す。`restPointAt` の `packX`: `right − 3` が `groupLadderX` の列なら `right − 4`。

- [ ] **Step 1: 失敗するテストを追加**(`restpoint.test.ts`)

```ts
it('restPointBand: 全ての休憩点の箱は帯の中にあり、帯の外では restPointTileAt が null(早期棄却が結果を変えない)', () => {
  for (const seed of [1, 42, 20260711]) for (const cell of [-2, 0, 1]) {
    const band = restPointBand(seed, cell);
    for (let k = -3; k <= 3; k++) {
      const rp = restPointAt(seed, cell, k);
      expect(rp.floorY - REST_HEIGHT - 1).toBeGreaterThanOrEqual(band.y0);
      expect(rp.floorY).toBeLessThanOrEqual(band.y1);
      expect(restPointTileAt(seed, rp.x, band.y0 - 1)).toBe(null);
      expect(restPointTileAt(seed, rp.x, band.y1 + 1)).toBe(null);
      expect(restPointTileAt(seed, rp.x, rp.floorY)).toBe(TILE.SOLID);
    }
  }
});
it('荷袋は梯子列に乗らない', () => {
  for (let seed = 1; seed <= 60; seed++) for (const cell of [-2, 0, 1]) for (let k = -3; k <= 3; k++) {
    const rp = restPointAt(seed, cell, k);
    expect(rp.packX).not.toBe(groupLadderX(seed, rp.packX));
    expect(rp.packX).toBeGreaterThanOrEqual(rp.right - 4);
    expect(rp.packX).toBeLessThan(rp.right);
  }
});
```

既存の `expect(rp.packX).toBe(rp.right - 3)` は `toBeGreaterThanOrEqual(rp.right - 4)` に緩める。

(`interface.test.ts`)

```ts
it('大界面(cell −2、縦坑 ±2)でも見晴らし台の X 範囲で cell を返し、縦坑の列は null', () => {
  const seed = 20260711;
  const cell = -2;
  const top = interfaceTop(seed, cell);
  const px = passageX(seed, cell, 0);
  expect(isGreatInterface(cell)).toBe(true);
  expect(overlookCellAt(seed, px + 4, top)).toBe(cell);
  expect(overlookCellAt(seed, px - OVERLOOK_LEFT, top)).toBe(cell);
  expect(overlookCellAt(seed, px, top)).toBe(null);
  expect(overlookCellAt(seed, px + HOLE_OFFSET, top)).toBe(null);
  expect(overlookCellAt(seed, px + 4, top + 1)).toBe(null);
});
```

- [ ] **Step 2: 失敗を確認** → FAIL(`restPointBand` 未定義)。interface のテストは PASS でよい(既存挙動の固定)。
- [ ] **Step 3: 実装** → `npx vitest run src/world` PASS
- [ ] **Step 4: コミット** — `git commit -m "perf: Y band early-reject for rest-point tiles; pack avoids ladder column; great-interface overlook test"`

### Task 10: 計測・スクリーンショット・計画末尾の裁定・PR

**Files:**
- Modify: `docs/superpowers/plans/2026-10-20-interface-ascent-stage5-ambient-audio.md`(末尾に「実装時の裁定」と計測表)

- [ ] **Step 1: 基準の worktree** — `git worktree add ../s5-base origin/master` し、`cmd /c mklink /J ..\s5-base\node_modules <repo>\node_modules`。
- [ ] **Step 2: 計測**(各 2 回、基準と段階5): 休憩点 `--pos=259,224.2`、開始地点(`--pos` 無し)、光溜まりの真下 `--pos=244,66`、休憩点で歩く `--pos=259,224.2 --press=KeyD`(足音と AudioContext が動く)、水系の光柱の真下(Task 4 で決めた位置)。`--stages` で lighting / background を確認。
- [ ] **Step 3: スクリーンショット** — Task 4 の 4 枚を再撮影して目視。
- [ ] **Step 4: 計画末尾に「実装時の裁定(計画段階)」「実装時の裁定(実装中)」と計測表、段階3・4 の保留 Minor の扱い**
- [ ] **Step 5: `git worktree remove ../s5-base`、全テスト・tsc・build、コミット、PR** — `gh pr create --base master --title "feat: ambient motion and synthesized audio (stage 5)"`
- [ ] **Step 6: 引き継ぎノート** — 共有フォルダに `stage5-ambient-audio-handover.md`。

## 実装時の裁定(計画段階)

- **建設者の層**: 設計書の「最遠パララックス層」は `Background.farLayer`(追従率 0.006、8000 タイル級の遠景)だが、「界面の裏面に沿って」動くには板の位置に追従する層でなければ板から外れる。板の帯(`bands`、追従率 0.6)が板に紐づく最も遠い層なので、建設者はその帯の下面(裏面)に掛けて描く。
- **灯は焼き込み + 明滅の加算**: 段階4 の `lamp` 痕跡(暈つき)は残し、明滅は overlay の小矩形(灯 1×1・暈 3×2 タイル)の加算で表す。消灯時は矩形を描かない(焼き込みの灯はそのままなので「消える」のは明かりの部分だけ。全消灯すると痕跡が消えたように見えるため、焼き込みを消す案は採らない)。
- **水系の判定**: `biomeIdForCell(seed, cell) === 'waterVoid'`(光柱 cell の前室は層 cell の中)。`regionAt(...).system === 'water'` は施設の系統で、層の見た目とは無関係なので使わない。
- **ミュートはトグル**: 設計書の「ミュートキー M」を押すたびに切り替わるトグルにする(押している間だけ消音では実用にならない)。`Input` に keydown のエッジ(`takePressed`)を足し、眺望の打ち切り(段階3 Minor 1)も同じエッジで直す。
- **右 Shift**: 眺望は左 Shift だけにする(Windows の固定キー機能のダイアログ対策。段階3 Minor 3)。
- **HUD の階層**: 接地しているときだけ `maxLayer` を更新する(段階3 Minor 2)。
- **残響のバケット**: ConvolverNode のインパルス応答は生成が重い(数十 ms)ので、開放度を 6 段に量子化して段ごとに 1 回だけ作る。
- **段階4 Minor 1(休憩点と塔の重なり)**: 6 万本の走査で 0 件なので触らない。段階4 Minor 4(矩形数コメント)はコメントを更新する。
- **音の計測**: ヘッドレス Chromium では音は出ないが AudioContext は作れる。`--press=KeyD` で keydown が入り `start()` が走るので、歩行の場面で rAF への影響を見る。

## 実装時の裁定(実装中)

- **建設者の色と大きさ**: 計画の `STEEL.far` 0.55・1.2×1.8 タイルでは遠景の塔と同化して見えなかった(スクリーンショット)。帯と同じ `STEEL.black` 0.85・1.5×2.4 タイルにし、帯の裏面から突き出た黒い影として読ませる。暗い層では背景も黒に近く見えにくいが、遠景の点景なので許容。確認は赤で塗って位置を特定した(32 色パレットでは赤が黒に量子化されるので、通常の絵との差分画素で位置を取った)。
- **`Background.render` の `simTime`**: 既定値 0 の引数にして既存の 7 引数の呼び出し(テスト)を変えない。建設者の描画は `RecordingContext` のテストで矩形の寸法と時間変化を固定した。
- **落下粒のテストの視野**: `beaconsInView` に 1e9 の視野を渡すと cell・k の走査が数十億回になり Vitest が落ちた(テストの誤り)。視野は 400×60 で切る。
- **灯の明滅の見え方**: 1×1 タイル(0.45 × 明るさ)+暈 3×2(0.08)。スクリーンショット 2 枚(2.5 秒と 3.7 秒)で灯ごとに明るさが変わる。段階4 の焼き込みの `lamp` 痕跡はそのまま残し、消灯時は加算を描かないだけ(痕跡が消えると位置が分からなくなる)。
- **水系の確認場面**: seed 20260711 の cell −3(waterVoid)の光柱 x 302、床 −1065 → `--pos=302,-1066.8`。視野に入るのは柱の下 12 タイルなので粒は 1〜2 個(柱 1 本 6 個を 48 タイルに散らす)。
- **音の動作確認**: ヘッドレス Chromium では音は出ないが、`--press=KeyD` の keydown で `AudioEngine.start()` が走り、ページエラー・console エラー無しで足音・ドローン・残響のバッファ生成が動くことを frametime で確認した。音色の実機確認はレビュー時に。
- **HUD の階層**: `maxLayer` の更新を接地時だけにした(段階3 Minor 2)。
- **`Input`**: `takePressed()`(keydown のエッジ、`e.repeat` 除外)、`muted`(M でトグル)、`onFirstInput`(keydown / pointerdown の最初の 1 回)。`muteHeld` と右 Shift は削除。`ViewState.prevMoving` は削除し `ViewInput.newlyMoving` に置き換え(段階3 Minor 1 と 3)。
- **休憩点の早期棄却**: `restPointBand(seed, cell)` = 層の 40〜60% の床から箱の高さ分上まで。`restPointTileAt` は帯の外で null、`restWarmthAt` は帯 ±12 の外で 0。テストで全休憩点が帯に入ることを固定(段階4 Minor 2)。荷袋は `right−3` が梯子列なら `right−4`(段階4 Minor 3)。段階4 Minor 1(塔との重なり)は触らず、Minor 4 はコメントを更新。段階3 Minor 4 は大界面 cell −2 の `overlookCellAt` テストを追加。
- **新しいテスト数**: 22(441 → 463)。

## 計測(ヘッドレス=ソフトウェア描画、同じ機械状態。基準は origin/master 9fc3b7f を一時 worktree に切った。各 2 回)

| 場面(seed 20260711) | 基準 rAF p95 / render p50 (p95) | 段階5 rAF p95 / render p50 (p95) |
|---|---|---|
| 休憩点 (259,224.2) 静止(灯 4 つ明滅) | 16.8 / 8.5〜8.7 (20.2〜20.5) | 16.8 / 9.6〜9.7 (11.7〜24.6) |
| 開始地点 静止 | 16.8〜33.3 / 7.9〜9.8 (16.0〜29.1) | 16.8 / 6.4〜7.6 (9.6〜15.4) |
| 光溜まりの真下 (244,66) 静止 | 16.7〜16.8 / 9.1〜9.7 (12.5〜18.3) | 16.8 / 8.4〜10.9 (15.1〜17.4) |
| 水系の光柱の真下 (302,−1066.8) 静止(落下粒) | 16.7 / 7.5〜7.7 (10.1〜10.2) | 16.7 / 8.6 (10.8〜11.0) |
| 休憩点で右へ歩く(`--press=KeyD`、音あり) | 16.8 / 9.2〜10.3 (13.2〜16.9) | 16.8 / 10.7〜10.8 (16.7〜16.8) |

- 定常の全場面で rAF p95 は基準と同じ 16.7〜16.8 ms(vsync 刻みの丸め)。render p50 の差は +1 ms 以内(休憩点 +1.0、水系 +1.0、歩行 +0.5〜1.5)。
- 最初の 1 回だけ出る 33 ms / render max 200〜800 ms は、基準でも開始地点 1 回目に出る読み込み直後の過渡(Vite の初回変換とチャンクの焼き込み)で、段階5 の描画や音とは無関係。同じ場面の 2 回目は両者とも 16.8。
- 音: `--press=KeyD` で AudioContext が開始され(ページエラー無し)、足音のバッファ・残響のインパルス(6 段のうち 1 段)の生成を含めて歩行の rAF p95 は基準と同じ 16.8。
- `--stages`: lighting は休憩点 1.0 → 1.2 ms(灯 8 枚の加算)、水系 1.8 → 1.9 ms(粒 1〜2 枚)。background は 0.5〜0.6 → 0.5 ms(建設者 0〜2 枚)。sky は不変 0.4〜0.5。
- ヘッドレスの `page.goto` が 30 秒でタイムアウトする失敗が計測の最初の 1 回に 3 度出た(基準・段階5 の両方。再実行すれば通る)。計測の呼び出し側の問題で、ページの問題ではない。

## 保留(段階5 で触らなかったもの)

- 休憩点の箱と塔の重なり(段階4 Minor 1): 確率的に回避されているだけ(6 万本の走査で 0 件)。
- 建設者は暗い層(ambientLevel の低い coldSteel など)では背景も黒に近く、ほとんど見えない。遠景の点景として許容。
- 音の音色(§11「実装者に委ねる」)は実機で聴いて調整する前提。ドローンの `square`(power)と `sawtooth`(disposal)はゲインを −12〜−15 dB に落としてあるが、耳障りなら `triangle` へ。
- 崩落の出口では自動眺望も通過音も出ない(段階4 から未裁定)。

## レビュー後の修正と保留(別エージェントのレビュー)

修正済み:
- 足音が 9 回/秒の連打になっていた: `walkPhase` はラジアン(`playerPose` が `sin(walkPhase)` で歩容を作る)なので、設計書の「整数跨ぎ」を文字通りに取ると 1/9 秒ごとに鳴る。π の倍数の跨ぎ(sin の零交差 = 足が着く瞬間、約 2.9 回/秒)に変更し、「歩行 1 秒で 2〜3 回」をテストで固定。
- 初回入力だけで AudioContext を開始していたため、最初のキーが Esc などユーザー操作に数えられないものだと suspended のまま永久に無音だった: `Input.onInput`(キー/クリックのたび)にし、`AudioEngine.start()` は 2 回目以降 running でなければ resume を試みる。最初のキーが M のとき一瞬鳴らないよう、start の前に `setMuted(input.muted)` を渡す。

保留(Minor):
- 落下粒の 12 個の上限は画面外(裾だけ視野に掛かる)光柱にも配られ、眺望で左端に光柱が入ると右の柱の粒が消える。X で `|b.x − camX| ≤ spanX/2 + 12` に絞るか、柱ごとに `12 / n` で分けると直る。
- `restPointBand` のコメントは `traceAt` も軽くなると書いたが、`traceAt` は帯を見ていない(`nearestRestPoint` を毎タイル呼ぶ)。`traceAt` に帯 ±REST_HALO の早期棄却を足せば同値。
- 残響のバケットが境界で揺れると convolver の IR が 1 秒に最大 10 回差し替わり、残響の尾が切れる。ヒステリシス(0.6 段)を置くと直る。
- タブを隠してもドローンとハムが最後の音量で鳴り続ける(rAF が止まり update が来ない)。`visibilitychange` で suspend / resume。
- `main.updateAudio` は開始前に `audio.update` を呼ばないので、engine 側の開始前の `prevWalkPhase` 追従は使われていない(開始が遅れる構成になったら 1 回だけ余計な足音が出る)。
- 灯の消灯抽選の id `cell*1000 + k*8 + i` は |k| ≥ 125 で衝突する(2 つの灯が同じ抽選になるだけ)。
