# 弐瓶らしさ再生 段階1: カメラズームアウト(豆粒化) 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 開放空間(大空洞など)でカメラを滑らかにズームアウトし、人影を豆粒に見せて弐瓶的な圧倒スケールを出す。

**Architecture:** 純粋関数モジュール `core/zoom.ts` が「プレイヤー周囲の開放度」を測り「目標ズーム」へ写像する。`Camera` に `zoom` と指数平滑 `zoomTo` を追加。`main` が毎数フレーム開放度→目標ズームを計算して `camera.zoomTo` に渡し、`Renderer` は `cam.zoom` で 1タイルあたりpx(`ppt`)を伸縮する。物理・worldgen・当たり判定は無改修。

**Tech Stack:** TypeScript + Canvas 2D + Vitest。設計書: `docs/superpowers/specs/2026-07-12-blame-sim-nihei-essence-design.md` の段階1。

**スコープ注記:** 設計書の段階1は「カメラズームアウト＋worldgen尺度拡大」だが、後者は到達可能性テストを伴う別サブシステムのため段階1b(別計画)へ分離した。本計画はカメラズームアウトのみで、それ自体が動く縦スライス(スクショで豆粒化を確認できる)。

---

## ファイル構成

- Create: `src/core/zoom.ts` — 開放度サンプリングと目標ズーム写像(純粋関数)。責務: ズーム判断ロジックのみ
- Create: `src/core/zoom.test.ts` — 上記のユニットテスト
- Modify: `src/core/camera.ts` — `zoom` フィールド + `zoomTo(target, dt)` を追加
- Modify: `src/core/camera.test.ts` — `zoomTo` の平滑・収束テストを追加
- Modify: `src/render/renderer.ts:78` — `ppt` 計算に `cam.zoom` を乗じる
- Modify: `src/main.ts` — 開放度→目標ズームを毎6フレーム計算し `camera.zoomTo` を呼ぶ配線

---

### Task 1: 開放度と目標ズームの純粋関数

**Files:**
- Create: `src/core/zoom.ts`
- Test: `src/core/zoom.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/core/zoom.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TILE } from '../world/tiles';
import {
  sampleOpenness,
  targetZoomForOpenness,
  MIN_ZOOM,
  MAX_ZOOM,
  OPENNESS_LO,
  OPENNESS_HI,
} from './zoom';

describe('sampleOpenness', () => {
  it('全AIRなら開放度1', () => {
    const openness = sampleOpenness(() => TILE.AIR, 0, 0, 5, 1);
    expect(openness).toBe(1);
  });

  it('全SOLIDなら開放度0', () => {
    const openness = sampleOpenness(() => TILE.SOLID, 0, 0, 5, 1);
    expect(openness).toBe(0);
  });

  it('LADDERは開放とみなす', () => {
    const openness = sampleOpenness(() => TILE.LADDER, 0, 0, 5, 1);
    expect(openness).toBe(1);
  });

  it('市松模様なら約0.5', () => {
    const tileAt = (x: number, y: number) => ((x + y) % 2 === 0 ? TILE.SOLID : TILE.AIR);
    const openness = sampleOpenness(tileAt, 0, 0, 10, 1);
    expect(openness).toBeGreaterThan(0.4);
    expect(openness).toBeLessThan(0.6);
  });
});

describe('targetZoomForOpenness', () => {
  it('閉塞(LO以下)は標準ズーム', () => {
    expect(targetZoomForOpenness(OPENNESS_LO)).toBeCloseTo(MAX_ZOOM, 5);
    expect(targetZoomForOpenness(0)).toBeCloseTo(MAX_ZOOM, 5);
  });

  it('十分開放(HI以上)は最大ズームアウト', () => {
    expect(targetZoomForOpenness(OPENNESS_HI)).toBeCloseTo(MIN_ZOOM, 5);
    expect(targetZoomForOpenness(1)).toBeCloseTo(MIN_ZOOM, 5);
  });

  it('開放度が上がるほどズームは単調に小さくなる', () => {
    const a = targetZoomForOpenness(0.6);
    const b = targetZoomForOpenness(0.75);
    const c = targetZoomForOpenness(0.85);
    expect(a).toBeGreaterThanOrEqual(b);
    expect(b).toBeGreaterThanOrEqual(c);
  });

  it('範囲外入力でも[MIN_ZOOM, MAX_ZOOM]にクランプ', () => {
    expect(targetZoomForOpenness(-5)).toBe(MAX_ZOOM);
    expect(targetZoomForOpenness(5)).toBe(MIN_ZOOM);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/core/zoom.test.ts`
Expected: FAIL(`Cannot find module './zoom'` などの解決エラー)

- [ ] **Step 3: 最小実装を書く**

`src/core/zoom.ts`:

```ts
import { TILE } from '../world/tiles';

/** ズーム下限(最大ズームアウト)。0.5 = 標準の2倍のタイルが横に入る(≒横88タイル) */
export const MIN_ZOOM = 0.5;
/** ズーム上限(標準表示。横44タイル) */
export const MAX_ZOOM = 1;

/** 開放度サンプリングの既定半径(タイル) */
export const OPENNESS_RADIUS = 22;
/** サンプリングの既定間引き(2=1タイルおき。tileAt呼び出しを1/4に減らす) */
export const OPENNESS_STEP = 2;

/** この開放度以下は標準ズーム(閉塞・通路) */
export const OPENNESS_LO = 0.55;
/** この開放度以上は最大ズームアウト(大空洞) */
export const OPENNESS_HI = 0.9;

/**
 * (cx,cy)中心の (2r+1)^2 タイル格子を step 間引きで走査し「非SOLIDの割合」(0..1)を返す。
 * AIR/LADDER を開放、SOLID を閉塞とみなす。tileAt は破壊反映済みの経路(store.tileAt)を渡す。
 * 純粋関数: 同じ tileAt・座標なら常に同じ出力。
 */
export function sampleOpenness(
  tileAt: (x: number, y: number) => number,
  cx: number,
  cy: number,
  r: number = OPENNESS_RADIUS,
  step: number = OPENNESS_STEP,
): number {
  let open = 0;
  let total = 0;
  const x0 = Math.floor(cx) - r;
  const y0 = Math.floor(cy) - r;
  for (let y = y0; y <= y0 + 2 * r; y += step) {
    for (let x = x0; x <= x0 + 2 * r; x += step) {
      total++;
      if (tileAt(x, y) !== TILE.SOLID) open++;
    }
  }
  return total === 0 ? 0 : open / total;
}

/**
 * 開放度(0..1) → 目標ズーム。開放なほどズームアウト(小さいzoom)。
 * openness<=OPENNESS_LO は MAX_ZOOM、>=OPENNESS_HI は MIN_ZOOM、間は線形補間。
 * 範囲外は [MIN_ZOOM, MAX_ZOOM] にクランプ。
 */
export function targetZoomForOpenness(openness: number): number {
  const t = (openness - OPENNESS_LO) / (OPENNESS_HI - OPENNESS_LO);
  const clamped = Math.max(0, Math.min(1, t));
  return MAX_ZOOM + (MIN_ZOOM - MAX_ZOOM) * clamped;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/core/zoom.test.ts`
Expected: PASS(9テスト)

- [ ] **Step 5: コミット**

```bash
git add src/core/zoom.ts src/core/zoom.test.ts
git commit -m "feat: 開放度サンプリングと目標ズーム写像の純粋関数"
```

---

### Task 2: Camera にズームと平滑追従を追加

**Files:**
- Modify: `src/core/camera.ts`
- Test: `src/core/camera.test.ts`

- [ ] **Step 1: 失敗するテストを追加**

`src/core/camera.test.ts` の `describe('Camera', () => {` ブロック末尾(20行目 `});` の直前)に追加:

```ts
  it('zoomは初期値1(標準)', () => {
    const cam = new Camera(0, 0);
    expect(cam.zoom).toBe(1);
  });

  it('zoomToは目標へ近づく', () => {
    const cam = new Camera(0, 0);
    cam.zoomTo(0.5, 1 / 60);
    expect(cam.zoom).toBeLessThan(1);
    expect(cam.zoom).toBeGreaterThan(0.5);
  });

  it('時間が経てば目標ズームにほぼ一致する', () => {
    const cam = new Camera(0, 0);
    for (let i = 0; i < 600; i++) cam.zoomTo(0.5, 1 / 60);
    expect(cam.zoom).toBeCloseTo(0.5, 2);
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/core/camera.test.ts`
Expected: FAIL(`cam.zoom` が undefined / `zoomTo` が関数でない)

- [ ] **Step 3: 実装を書く**

`src/core/camera.ts` を次の内容に置き換える:

```ts
/** プレイヤーを滑らかに追うカメラ。(x, y)は画面中心のワールド座標(タイル単位) */
export class Camera {
  /** 表示倍率。1=標準(横44タイル)、小さいほどズームアウト(開放空間で豆粒化) */
  zoom = 1;

  constructor(
    public x: number,
    public y: number,
  ) {}

  follow(targetX: number, targetY: number, dt: number): void {
    const k = 1 - Math.exp(-8 * dt);
    this.x += (targetX - this.x) * k;
    this.y += (targetY - this.y) * k;
  }

  /**
   * 目標ズームへ指数平滑で近づく。位置追従(係数8)よりゆるやか(係数4)にし、
   * 空間の開閉に対してズームが穏やかに追従して酔いを防ぐ。
   */
  zoomTo(target: number, dt: number): void {
    const k = 1 - Math.exp(-4 * dt);
    this.zoom += (target - this.zoom) * k;
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/core/camera.test.ts`
Expected: PASS(既存2 + 追加3 = 5テスト)

- [ ] **Step 5: コミット**

```bash
git add src/core/camera.ts src/core/camera.test.ts
git commit -m "feat: Cameraにzoomと平滑追従zoomToを追加"
```

---

### Task 3: Renderer がズームで ppt を伸縮

**Files:**
- Modify: `src/render/renderer.ts:78`

- [ ] **Step 1: ppt 計算にズームを乗じる**

`src/render/renderer.ts` の 78行目:

```ts
    const ppt = w / VIEW_TILES_X;
```

を次に変更する:

```ts
    // cam.zoom<1 で ppt が縮み、画面に入るタイル数が増える(開放空間の豆粒化)
    const ppt = (w / VIEW_TILES_X) * cam.zoom;
```

他は変更不要(`chunkPx`・可視チャンク範囲・プレイヤー座標・ライト・背景はすべて `ppt` 経由で自動追従する)。

- [ ] **Step 2: 既存テストが回帰していないことを確認**

Run: `npm test`
Expected: PASS(全既存テスト。描画は自動テスト対象外なので変化なし)

- [ ] **Step 3: 型チェックが通ることを確認**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 4: コミット**

```bash
git add src/render/renderer.ts
git commit -m "feat: RendererがCamera.zoomでpptを伸縮"
```

---

### Task 4: main が開放度からズームを駆動

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: import を追加**

`src/main.ts` の import 群(11行目 `import { findSpawn } from './world/worldgen';` の直後)に追加:

```ts
import { sampleOpenness, targetZoomForOpenness } from './core/zoom';
```

- [ ] **Step 2: ズーム目標の状態変数を追加**

`src/main.ts` の `let frames = 0;`(73行目付近)の直後に追加:

```ts
// カメラの目標ズーム。開放度から毎数フレーム更新し、camera.zoomToで平滑追従する
let zoomTarget = 1;
```

- [ ] **Step 3: update内でズームを駆動**

`src/main.ts` の `update` 関数内、`camera.follow(player.centerX, player.centerY, dt);`(79行目)の直後に追加:

```ts
  // 開放度は毎フレームだと重い(tileAt多数)ので6フレームごとに測る。
  // 求めた目標ズームへは毎フレーム平滑追従する。
  if (frames % 6 === 0) {
    const openness = sampleOpenness(tiles, player.centerX, player.centerY);
    zoomTarget = targetZoomForOpenness(openness);
  }
  camera.zoomTo(zoomTarget, dt);
```

注: `frames` は同関数内(86行目)で `frames++` される。`frames % 6 === 0` は初回(frames=0)にも真となり、初期ズームが即座に設定される。

- [ ] **Step 4: 既存テスト・型チェックが通ることを確認**

Run: `npm test && npx tsc --noEmit`
Expected: PASS / エラーなし(main.ts はテスト対象外だが型で配線ミスを検出)

- [ ] **Step 5: コミット**

```bash
git add src/main.ts
git commit -m "feat: 開放度に応じたカメラズームアウトを配線"
```

---

### Task 5: スクリーンショットで豆粒化を目視確認

**Files:** なし(検証のみ)

- [ ] **Step 1: 閉塞(スポーン)と開放(大空洞)のスクショを撮る**

Run:

```bash
npm run shot -- --out=screenshots/zoom-spawn.png --seed=20260711
npm run shot -- --out=screenshots/zoom-cavern.png --seed=20260711 --pos=200,-1600
```

注: `--pos` の大空洞座標は目安。埋まっていたり閉塞ならログのURLをブラウザで開き、大空洞帯(高度500m級以上)の開けた床に乗る座標へ調整して撮り直す。既存の `screenshots/final-kudo.png`(大空洞帯)が参考。

- [ ] **Step 2: 目視で合否を判定**

期待:
- `zoom-spawn.png`: ほぼ標準ズーム(横44タイル前後)。人影は従来どおりの大きさ。
- `zoom-cavern.png`: ズームアウトして横のタイル数が増え、**人影が明確に小さく(豆粒に)**なり、大空洞の広がりが強調される。

不合格の場合の調整箇所(コード側、再コミット):
- ズームが強すぎ/弱すぎ → `src/core/zoom.ts` の `MIN_ZOOM`(下げると更に広く)、`OPENNESS_LO`/`OPENNESS_HI`(発動閾値)。
- 切り替えが急/酔う → `src/core/camera.ts` の `zoomTo` 係数(4を下げると更にゆるやか)。
- 反応が鈍い/範囲が狭い → `src/core/zoom.ts` の `OPENNESS_RADIUS`。

- [ ] **Step 3: 確認できたら完了(このタスクにコミットは不要)**

段階1完了。レビュー(requesting-code-review)へ。

---

## セルフレビュー結果

- **スペック網羅(段階1のうちカメラズーム分)**: 開放度計測(Task1)・目標ズーム写像(Task1)・平滑追従(Task2)・ppt反映(Task3)・配線(Task4)・スクショ目視(Task5)で網羅。純粋関数のユニットテスト方針(設計書テスト方針)を Task1/2 が満たす。worldgen尺度拡大は本計画スコープ外(段階1bへ分離)と明記済み。
- **プレースホルダ**: なし(全コード・全コマンド・期待出力を明記)。
- **型整合**: `sampleOpenness`/`targetZoomForOpenness`(Task1)を Task4 が同一シグネチャで使用。`Camera.zoom`/`zoomTo`(Task2)を Task3(`cam.zoom`)・Task4(`camera.zoomTo`)が一致して使用。`MIN_ZOOM`/`MAX_ZOOM`/`OPENNESS_LO`/`OPENNESS_HI` はテストと実装で同名。
- **回帰**: `physics.ts`・worldgen 無改修。`renderer.ts` は1行(ppt)のみ。既存 `camera.test.ts` の2テストは不変。
