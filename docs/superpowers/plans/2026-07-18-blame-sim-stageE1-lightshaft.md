# 段階E-1: 硬い光条(場所依存の体積光) 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 開けた暗い空間でだけ、高所の開口から差し込む硬い光条(体積光)が闇を斜めに切り、埃を照らし床に光溜まりを落とす。弐瓶的な「稀・硬質・局所」の光でシーンに緊張と崇高を与える。

**Architecture:** 「どこに光条が立つか(ワールドX・幅・傾き・強度)」を返す**純粋関数** `render/lightshaft.ts` の `shaftsInView(seed, camXtiles, spanTiles, ambientLevel, zoom)` を新設。明るいバイオーム(ambientLevel高)や閉塞空間(zoom高)では**空配列**を返し、暗く開けた場所だけ疎らに光条を出す。`Renderer` は `LightShafts` クラスでライティングの直後に加算合成の光錐＋埃＋床光溜まりを描く。**物理・worldgen・当たり無改修**(描画のみ)。既存 `cam.zoom`(開放度の代理: 開放ほど小)と `bb.ambientLevel` を使い、新規プラミングを持たない。

**Tech Stack:** TypeScript + Canvas 2D + Vitest。設計書: [docs/superpowers/specs/2026-07-17-blame-sim-nihei-visual-realism-design.md](../specs/2026-07-17-blame-sim-nihei-visual-realism-design.md) の「5. 味付け(光条)」。決定論ハッシュ `hash2`(`world/noise.ts`)を再利用。

**スコープ注記:** 段階Eのうち**光条のみ**。バイオメカ異物・超巨大ランドマークは別スコープ(ランドマークは `background.ts` の `rareLandmarkAt` に抽象版が既存)。

---

## ファイル構成

- Create: `src/render/lightshaft.ts` — `shaftsInView(...)` と `Shaft` 型・`LightShafts` 描画クラス。純粋な配置関数＋Canvas描画クラスを同ファイルに置く(描画は小規模)。責務: 光条の配置判断(純粋)と描画。
- Create: `src/render/lightshaft.test.ts` — 配置関数のユニットテスト。
- Modify: `src/render/renderer.ts` — `LightShafts` を生成し、ライティング描画の直後に描く。

---

### Task 1: 光条配置の純粋関数＋描画クラス

**Files:**
- Create: `src/render/lightshaft.ts`
- Test: `src/render/lightshaft.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/render/lightshaft.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { shaftsInView, AMBIENT_MAX, ZOOM_OPEN } from './lightshaft';

const SEED = 20260711;

describe('shaftsInView', () => {
  it('決定論: 同じ引数は同じ結果', () => {
    const a = shaftsInView(SEED, 500, 90, 0.36, 0.6);
    const b = shaftsInView(SEED, 500, 90, 0.36, 0.6);
    expect(a).toEqual(b);
  });

  it('明るいバイオーム(ambient>=AMBIENT_MAX)では光条なし', () => {
    expect(shaftsInView(SEED, 500, 90, AMBIENT_MAX, 0.6)).toEqual([]);
    expect(shaftsInView(SEED, 500, 90, 0.72, 0.6)).toEqual([]);
  });

  it('閉塞(zoom>=ZOOM_OPEN)では光条なし', () => {
    expect(shaftsInView(SEED, 500, 90, 0.36, ZOOM_OPEN)).toEqual([]);
    expect(shaftsInView(SEED, 500, 90, 0.36, 1.0)).toEqual([]);
  });

  it('暗く開けた場所では光条が出る(ただし疎ら)', () => {
    const shafts = shaftsInView(SEED, 0, 400, 0.36, 0.55);
    expect(shafts.length).toBeGreaterThan(0);
    // 視野400タイルに対しスロット60なので候補は約7、ゲートで間引かれ全数未満
    expect(shafts.length).toBeLessThan(7);
    for (const s of shafts) {
      expect(s.width).toBeGreaterThan(0);
      expect(s.intensity).toBeGreaterThan(0);
      expect(s.intensity).toBeLessThanOrEqual(1);
    }
  });

  it('視野が広いほど光条数は増える(または同数)', () => {
    const narrow = shaftsInView(SEED, 0, 120, 0.36, 0.55).length;
    const wide = shaftsInView(SEED, 0, 1200, 0.36, 0.55).length;
    expect(wide).toBeGreaterThanOrEqual(narrow);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/render/lightshaft.test.ts`
Expected: FAIL(`Cannot find module './lightshaft'`)

- [ ] **Step 3: 実装を書く**

`src/render/lightshaft.ts`:

```ts
import type { Camera } from '../core/camera';
import { hash2 } from '../world/noise';

/** これ以上明るいバイオームでは光条を出さない(暗所限定) */
export const AMBIENT_MAX = 0.5;
/** これ以上ズームインした(閉塞)状態では光条を出さない(開放限定)。zoomは小さいほど開放。 */
export const ZOOM_OPEN = 0.85;
/** 光条候補スロット間隔(タイル) */
export const SHAFT_SLOT = 60;
/** スロットが実際に光条を持つ確率 */
const SHAFT_RATE = 0.4;

export interface Shaft {
  /** 光条中心のワールドX(タイル) */
  worldX: number;
  /** 幅(タイル) */
  width: number;
  /** 傾き(下端の水平ずれ、画面幅比 -0.2..0.2) */
  lean: number;
  /** 強度(0..1) */
  intensity: number;
}

/**
 * 可視範囲に立つ光条を決定論で返す。暗く(ambientLevel<AMBIENT_MAX)開けた(zoom<ZOOM_OPEN)場所のみ。
 * それ以外は空配列。純粋関数。
 */
export function shaftsInView(
  seed: number,
  camXtiles: number,
  spanTiles: number,
  ambientLevel: number,
  zoom: number,
): Shaft[] {
  if (ambientLevel >= AMBIENT_MAX) return [];
  if (zoom >= ZOOM_OPEN) return [];
  const out: Shaft[] = [];
  const k0 = Math.floor((camXtiles - spanTiles / 2) / SHAFT_SLOT) - 1;
  const k1 = Math.floor((camXtiles + spanTiles / 2) / SHAFT_SLOT) + 1;
  for (let k = k0; k <= k1; k++) {
    if (hash2(seed + 8700, k, 0) >= SHAFT_RATE) continue;
    const worldX = k * SHAFT_SLOT + (hash2(seed + 8701, k, 0) - 0.5) * SHAFT_SLOT * 0.5;
    const width = 3 + hash2(seed + 8702, k, 0) * 6;              // 3..9 タイル
    const lean = (hash2(seed + 8703, k, 0) - 0.5) * 0.36;         // -0.18..0.18
    // 暗い/開けたほど強く。ambientが低いほど・zoomが小さいほどintensity大。
    const darkF = 1 - ambientLevel / AMBIENT_MAX;                 // 0..1
    const openF = 1 - zoom / ZOOM_OPEN;                           // 0..1
    const intensity = Math.max(0, Math.min(1, (0.4 + 0.6 * hash2(seed + 8704, k, 0)) * (0.5 + 0.5 * darkF) * (0.5 + 0.5 * openF)));
    out.push({ worldX, width, lean, intensity });
  }
  return out;
}

/** 光条の描画(加算合成の光錐＋埃＋床光溜まり)。テスト対象外(Canvas)。 */
export class LightShafts {
  constructor(private seed: number) {}

  render(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    w: number,
    h: number,
    ppt: number,
    ambientLevel: number,
  ): void {
    const spanTiles = w / ppt;
    const shafts = shaftsInView(this.seed, cam.x, spanTiles, ambientLevel, cam.zoom);
    if (shafts.length === 0) return;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter'; // 加算=光として重なる
    const floorY = h * 0.9;
    for (const s of shafts) {
      const sx = (s.worldX - cam.x) * ppt + w / 2;
      const topW = s.width * ppt * 0.35;
      const botW = s.width * ppt * 1.25;
      const leanPx = s.lean * w;
      const a = 0.10 * s.intensity; // 淡く(加算なので効く)

      // 光錐(上端の開口→床へ広がる台形)。縦グラデで下ほど淡く。
      const g = ctx.createLinearGradient(sx, 0, sx + leanPx, floorY);
      g.addColorStop(0, `rgba(223,233,242,${a})`);
      g.addColorStop(1, 'rgba(223,233,242,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(sx - topW / 2, 0);
      ctx.lineTo(sx + topW / 2, 0);
      ctx.lineTo(sx + leanPx + botW / 2, floorY);
      ctx.lineTo(sx + leanPx - botW / 2, floorY);
      ctx.closePath();
      ctx.fill();

      // 明るいコア(細い中心の光条)
      const gc = ctx.createLinearGradient(sx, 0, sx + leanPx, floorY);
      gc.addColorStop(0, `rgba(238,244,251,${a * 0.9})`);
      gc.addColorStop(1, 'rgba(238,244,251,0)');
      ctx.fillStyle = gc;
      ctx.beginPath();
      ctx.moveTo(sx - topW * 0.18, 0);
      ctx.lineTo(sx + topW * 0.18, 0);
      ctx.lineTo(sx + leanPx + botW * 0.15, floorY);
      ctx.lineTo(sx + leanPx - botW * 0.15, floorY);
      ctx.closePath();
      ctx.fill();

      // 埃(光条内に決定論配置した粒)
      ctx.fillStyle = `rgba(238,244,251,${Math.min(0.5, a * 4)})`;
      for (let i = 0; i < 7; i++) {
        const u = hash2(this.seed + 8710, Math.round(s.worldX), i); // 0..1(縦位置)
        const dy = u * floorY;
        const dx = sx + leanPx * u + (hash2(this.seed + 8711, Math.round(s.worldX), i) - 0.5) * (topW + (botW - topW) * u);
        const r = Math.max(0.6, ppt * 0.03);
        ctx.beginPath();
        ctx.arc(dx, dy, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // 床の光溜まり(楕円の淡い輝き)
      const poolX = sx + leanPx;
      const gp = ctx.createRadialGradient(poolX, floorY, 0, poolX, floorY, botW);
      gp.addColorStop(0, `rgba(223,233,242,${a * 1.6})`);
      gp.addColorStop(1, 'rgba(223,233,242,0)');
      ctx.fillStyle = gp;
      ctx.beginPath();
      ctx.ellipse(poolX, floorY, botW, botW * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/render/lightshaft.test.ts`
Expected: PASS(5テスト)

- [ ] **Step 5: コミット**

```bash
git add src/render/lightshaft.ts src/render/lightshaft.test.ts
git commit -m "feat: 光条(場所依存の体積光)の配置純粋関数と描画クラス"
```

---

### Task 2: renderer へ光条を配線、スクショ確認

**Files:**
- Modify: `src/render/renderer.ts`

- [ ] **Step 1: import と生成を追加**

`src/render/renderer.ts` の import 群に追加:

```ts
import { LightShafts } from './lightshaft';
```

`private megastructure: MegaStructure;` の宣言付近にフィールド追加:

```ts
  private lightShafts: LightShafts;
```

コンストラクタの `this.megastructure = new MegaStructure(seed);` の直後に追加:

```ts
    this.lightShafts = new LightShafts(seed);
```

- [ ] **Step 2: ライティングの直後に光条を描く**

`render()` 内で、`this.lighting.render(...)` を呼んでいる行の**直後**に追加する(内容で位置特定):

```ts
    // 光条(場所依存の体積光)。ライトの後・FX/postの前。暗く開けた空間だけに硬い光条が差す。
    this.lightShafts.render(ctx, cam, w, h, ppt, bb.ambientLevel);
```

`cam`・`w`・`h`・`ppt`・`bb` はその時点で全てスコープ内(要確認)。`bb.ambientLevel` を渡す。

- [ ] **Step 3: 型チェックと既存テスト回帰なしを確認**

Run: `npx tsc --noEmit && npm test`
Expected: 型エラーなし。全既存テスト PASS(179 + 光条テスト分)。

- [ ] **Step 4: コミット**

```bash
git add src/render/renderer.ts
git commit -m "feat: 光条レンダラをrendererへ配線(ライト直後)"
```

- [ ] **Step 5: スクリーンショットで光条を確認(コーディネータ)**

Run:

```bash
# 暗く開けた場所(廃棄区/精錬区の大空洞帯)を狙う。zoomが開いて(小さく)なる開放空間が条件。
node scripts/screenshot.mjs --out=screenshots/e1-disposal.png --seed=20260711 --pos=200,-1700 --wait=3500
node scripts/screenshot.mjs --out=screenshots/e1-foundry.png --seed=20260711 --pos=262344,-1700 --wait=3500
# 明るいバイオーム(居住区/大空洞帯=water)では出ないことの確認
node scripts/screenshot.mjs --out=screenshots/e1-bright.png --seed=20260711 --pos=524488,-1700 --wait=3500
```

注: 光条は暗いバイオーム(ambient<0.5=disposal/foundry)かつ開放(zoom<0.85)でのみ出る。`--pos` は目安、出なければ暗系統の開けた空洞座標へ調整。

- [ ] **Step 6: 目視で合否を判定(コーディネータ)**

期待:
- 暗く開けた空洞で、上から斜めに差す淡い光条が数本、闇を切って床に光溜まりを落とす。埃が舞う。
- 明るいバイオーム(居住区/water大空洞)・閉塞通路では光条が**出ない**(場所依存)。
- 光条は淡く、足場やHUDの可読性を損なわない。

不合格時の調整(コード側・再コミット): `lightshaft.ts` の `a`(alpha=0.10係数)・`SHAFT_RATE`(密度)・`AMBIENT_MAX`/`ZOOM_OPEN`(発動条件)・`floorY`。

- [ ] **Step 7: 確認できたら完了。段階E-1完了、レビューへ。**

---

## セルフレビュー結果

- **スペック網羅(段階E-1)**: 場所依存(暗×開放)の発動条件 = `AMBIENT_MAX`/`ZOOM_OPEN` ゲート、硬い光錐＋明コア＋埃＋床光溜まり = `LightShafts.render`、決定論配置 = `shaftsInView`(純粋・ユニットテスト)、ライト後・post前の合成順 = renderer配線を Task1/2 が満たす。バイオメカ・ランドマークはスコープ外と明記。
- **プレースホルダ**: なし。全コード・全コマンド・期待出力・調整箇所を明記。
- **型整合**: `Shaft`/`shaftsInView`/`LightShafts`/`AMBIENT_MAX`/`ZOOM_OPEN`(lightshaft.ts)を renderer・テストが一致使用。`Camera`(`core/camera`、`.x`/`.zoom`)・`hash2`(`world/noise`)・`bb.ambientLevel`(`BiomeBlend`)は既存。`LightShafts.render(ctx,cam,w,h,ppt,ambientLevel)` は呼び出しと一致。
- **回帰**: `physics.ts`・worldgen・アトラス・chunkbake 無改修。光条は加算合成の描画のみで tileAt に影響しない。`shaftsInView` は store非参照の純粋関数。合成は `ctx.save()/restore()` と `globalCompositeOperation` を隔離。既存テストは不変(lightshaft.test を追加するのみ)。
