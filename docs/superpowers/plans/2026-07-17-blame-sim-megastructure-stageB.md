# 段階B: 背景の意味を持つ超構造＋かすみ 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 今いる系統(水/電力/居住/廃棄/精錬)に応じた「意味を持つ巨大機械」のシルエットを、連続ランダム損傷・3層深度・大気遠近(かすみ)付きで闇の奥に描き、空洞を"充満"させる。

**Architecture:** カタログを「正規化座標(0..1)の**描画オペ列 `DrawOp[]` を返す純粋関数**」に、描画モジュールを「オペを解釈してCanvasに描くだけ」に分離する。配置(`place`)・損傷(`damageFor`)・かすみ(`atmosphere`)・カタログ決定論はすべて純粋関数としてユニットテストする。描画自体はスクリーンショット目視をゲートとする。`physics.ts`・worldgen・当たり判定は無改修。既存 [background.ts](../../../src/render/background.ts) の抽象遠景はそのまま残し、その手前に本システムを重ねる。

**Tech Stack:** TypeScript + Canvas 2D + Vitest。設計書: [docs/superpowers/specs/2026-07-17-blame-sim-nihei-visual-realism-design.md](../specs/2026-07-17-blame-sim-nihei-visual-realism-design.md) の「1. 背景の意味を持つ超構造」「2. 大気遠近」。既存の決定論ハッシュ `hash2`/`cellHash`/`weighted`(`world/noise.ts`・`world/hierarchy.ts`)、`regionAt`(系統)、`BiomeBlend`/`mixHex`(`render/biome.ts`)を再利用する。

**スコープ注記:** 本計画は5系統の基本カタログのみ。バイオメカ異物・超巨大ランドマーク(設計書 段階E)、移動環境の弐瓶化(段階C)、痕跡(段階D)、光条(段階E)は含まない。カメラ開閉ズーム(段階A)は独立で、本システムはズーム有無に関わらず動く(背景は自前の深度スケールで描く)。

---

## ファイル構成

- Create: `src/render/megastructure/spec.ts` — 型定義(`System`拡張なし)。`DrawOp`(描画オペのユニオン)・`StructureSpec`・`Tone`。責務: 型のみ。
- Create: `src/render/megastructure/rng.ts` — 決定論的な逐次乱数 `makeRng`。責務: カタログ用の再現可能な乱数列。
- Create: `src/render/megastructure/rng.test.ts`
- Create: `src/render/megastructure/place.ts` — 可視範囲→構造スロット列挙 `slotsInView`、損傷 `damageFor`。責務: 「どこに・何を・どれだけ壊れて」置くかの判断(純粋)。
- Create: `src/render/megastructure/place.test.ts`
- Create: `src/render/megastructure/atmosphere.ts` — かすみ係数 `hazeFactor`・かすみ色 `hazeColor`。責務: 深度→大気遠近(純粋)。
- Create: `src/render/megastructure/atmosphere.test.ts`
- Create: `src/render/megastructure/catalog.ts` — `buildStructure(type, damage, rng) → StructureSpec`と共有プリミティブ。責務: 機械形状のオペ列生成(純粋)。
- Create: `src/render/megastructure/catalog.test.ts`
- Create: `src/render/megastructure.ts` — `MegaStructure` クラス。オペ解釈＋深度バンド＋かすみベール＋リムライトの描画統括。責務: 描画のみ(テスト対象外)。
- Modify: `src/render/renderer.ts` — `MegaStructure` を生成し、背景パララックスと焼き込みチャンクの間で描画。

---

### Task 1: 描画オペの型と決定論的乱数

**Files:**
- Create: `src/render/megastructure/spec.ts`
- Create: `src/render/megastructure/rng.ts`
- Create: `src/render/megastructure/rng.test.ts`

- [ ] **Step 1: 型を定義する(テスト不要・型のみ)**

`src/render/megastructure/spec.ts`:

```ts
/** 描画の明度段(遠=暗→近=明)。renderer が実際の色へ写像する */
export type Tone = 'far' | 'mid' | 'near';

/** 正規化座標(構造のバウンディングボックス内 0..1。x=右, y=下, y=1が接地) の描画オペ */
export type DrawOp =
  | { t: 'mass'; x: number; y: number; w: number; h: number; tone: Tone }        // 矩形の躯体
  | { t: 'cyl'; x: number; y: number; w: number; h: number; tone: Tone }          // 縦円筒(ハイライト付き)
  | { t: 'truss'; x: number; y: number; w: number; h: number }                    // 骨組み(脚2本+横梁)
  | { t: 'pipe'; pts: [number, number][]; width: number }                         // 配管(折れ線)
  | { t: 'panels'; x: number; y: number; w: number; h: number }                   // グリーブル(パネル格子)
  | { t: 'gap'; x: number; y: number; w: number; h: number }                      // 損傷: 抜けた区画(闇で塗る)
  | { t: 'frame'; x: number; y: number; w: number; h: number }                    // 損傷: 露出フレーム/鉄筋
  | { t: 'rim'; pts: [number, number][] }                                         // 上端リムライト(明線)
  | { t: 'glow'; x: number; y: number; r: number; kind: 'work' | 'heat' };        // 稼働灯/熱光

export interface StructureSpec {
  ops: DrawOp[];
}
```

- [ ] **Step 2: 失敗するテストを書く**

`src/render/megastructure/rng.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeRng } from './rng';

describe('makeRng', () => {
  it('同じ(seed,a,b)は同じ乱数列を返す', () => {
    const r1 = makeRng(7, 3, 5);
    const r2 = makeRng(7, 3, 5);
    const a = [r1(), r1(), r1(), r1()];
    const b = [r2(), r2(), r2(), r2()];
    expect(a).toEqual(b);
  });

  it('異なる(a,b)は異なる列になる', () => {
    const r1 = makeRng(7, 3, 5);
    const r2 = makeRng(7, 3, 6);
    expect(r1()).not.toEqual(r2());
  });

  it('値は常に[0,1)に収まる', () => {
    const r = makeRng(1, 2, 3);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npx vitest run src/render/megastructure/rng.test.ts`
Expected: FAIL(`Cannot find module './rng'`)

- [ ] **Step 4: 最小実装を書く**

`src/render/megastructure/rng.ts`:

```ts
import { hash2 } from '../../world/noise';

/** カタログが使う再現可能な乱数列。呼ぶたびに内部カウンタを進めて hash2 を引く。 */
export type Rng = () => number;

/**
 * (seed, a, b) から決定論的な乱数列を生成する。
 * a,b はスロットのワールド座標や変種seedなどを渡し、系列を分ける。
 */
export function makeRng(seed: number, a: number, b: number): Rng {
  const base = (seed + Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  let n = 0;
  return () => hash2(base, n++, 0);
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npx vitest run src/render/megastructure/rng.test.ts`
Expected: PASS(3テスト)

- [ ] **Step 6: コミット**

```bash
git add src/render/megastructure/spec.ts src/render/megastructure/rng.ts src/render/megastructure/rng.test.ts
git commit -m "feat: 超構造の描画オペ型と決定論的乱数makeRng"
```

---

### Task 2: 構造スロットの配置と連続損傷

**Files:**
- Create: `src/render/megastructure/place.ts`
- Create: `src/render/megastructure/place.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/render/megastructure/place.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SYSTEMS } from '../../world/hierarchy';
import { slotsInView, damageFor, BANDS } from './place';

const SEED = 20260711;

describe('damageFor', () => {
  it('常に[0,1]に収まる', () => {
    for (let x = -50; x < 50; x++) {
      const d = damageFor(SEED, x, 0, 0);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
    }
  });

  it('高度が上がるほど平均損傷は増える(崩壊寄りバイアス・単調)', () => {
    const avg = (alt: number) => {
      let s = 0;
      for (let x = 0; x < 200; x++) s += damageFor(SEED, x, 0, alt);
      return s / 200;
    };
    expect(avg(4000)).toBeGreaterThanOrEqual(avg(0));
    expect(avg(20000)).toBeGreaterThanOrEqual(avg(4000));
  });

  it('高度が極端でも[0,1]にクランプ', () => {
    expect(damageFor(SEED, 3, 0, 1e9)).toBeLessThanOrEqual(1);
    expect(damageFor(SEED, 3, 0, -1e9)).toBeGreaterThanOrEqual(0);
  });

  it('決定論: 同じ引数は同じ値', () => {
    expect(damageFor(SEED, 12, 1, 5000)).toBe(damageFor(SEED, 12, 1, 5000));
  });
});

describe('slotsInView', () => {
  it('決定論: 同じ引数は同じスロット列', () => {
    const a = slotsInView(SEED, 1000, 800, -3000);
    const b = slotsInView(SEED, 1000, 800, -3000);
    expect(a).toEqual(b);
  });

  it('各バンドのスロットを返し、typeは既知の系統', () => {
    const slots = slotsInView(SEED, 0, 2000, 0);
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      expect(SYSTEMS).toContain(s.type);
      expect(s.damage).toBeGreaterThanOrEqual(0);
      expect(s.damage).toBeLessThanOrEqual(1);
      expect(BANDS.map((b) => b.depth)).toContain(s.depth);
    }
  });

  it('画面幅が広いほどスロットは増える(または同数)', () => {
    const narrow = slotsInView(SEED, 0, 500, 0).length;
    const wide = slotsInView(SEED, 0, 5000, 0).length;
    expect(wide).toBeGreaterThanOrEqual(narrow);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/render/megastructure/place.test.ts`
Expected: FAIL(`Cannot find module './place'`)

- [ ] **Step 3: 実装を書く**

`src/render/megastructure/place.ts`:

```ts
import { hash2 } from '../../world/noise';
import { regionAt, type System } from '../../world/hierarchy';

/** 深度バンド。factor=カメラ追従率(小=遠)。slot=スロット間隔(タイル)。span=1構造の見かけ幅(タイル)。 */
export interface Band {
  depth: number;   // 0(最遠)..1(最近)。かすみ・明度・追従率のキー
  factor: number;
  slot: number;
  span: number;
  density: number; // スロットに構造が立つ確率
}

/** 遠→近の3バンド。近バンドでも焼き込みチャンクより背後(すべて背景) */
export const BANDS: readonly Band[] = [
  { depth: 0.0, factor: 0.12, slot: 220, span: 170, density: 0.55 },
  { depth: 0.5, factor: 0.30, slot: 140, span: 110, density: 0.5 },
  { depth: 1.0, factor: 0.55, slot: 90,  span: 70,  density: 0.42 },
];

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * 構造の損傷度(0..1)。座標ハッシュ基準 + 高度が上がるほど崩壊寄りのバイアス。
 * altitudeTiles は max(0,-worldY) 相当を呼び出し側が渡す。常に[0,1]にクランプ。
 */
export function damageFor(seed: number, slotX: number, band: number, altitudeTiles: number): number {
  const base = hash2(seed + 51000 + band, slotX, 0) * 0.7;
  const altBias = clamp01(Math.max(0, altitudeTiles) / 30000) * 0.3;
  return clamp01(base + altBias);
}

export interface Slot {
  key: string;      // キャッシュ用の一意キー
  worldX: number;   // 構造中心のワールドX(タイル)
  depth: number;    // 所属バンドの depth
  factor: number;   // バンドの追従率
  span: number;     // 見かけ幅(タイル)
  type: System;     // 系統(その座標の regionAt)
  damage: number;   // 0..1
  variantSeed: number;
}

/**
 * camXtiles 中心・spanTiles 幅の可視範囲に落ちる各バンドの構造スロットを決定論で列挙。
 * type はスロット中心・camYtiles の regionAt().system(プレイヤーがいる系統と一致させる)。
 * camYtiles は符号付きワールドY(上=負)。高度バイアス altitude は max(0,-camYtiles)。
 */
export function slotsInView(
  seed: number,
  camXtiles: number,
  spanTiles: number,
  camYtiles: number = 0,
): Slot[] {
  const out: Slot[] = [];
  const altitudeTiles = Math.max(0, -camYtiles);
  const rowY = Math.floor(camYtiles);
  for (let bi = 0; bi < BANDS.length; bi++) {
    const B = BANDS[bi];
    // 追従率ぶんだけスロット原点をずらす(パンで継ぎ目が出ない整数スロット配置)
    const centerParallax = camXtiles * B.factor;
    const k0 = Math.floor((centerParallax - spanTiles / 2) / B.slot) - 1;
    const k1 = Math.floor((centerParallax + spanTiles / 2) / B.slot) + 1;
    for (let k = k0; k <= k1; k++) {
      if (hash2(seed + 52000 + bi, k, 0) > B.density) continue; // 空スロット
      const jitter = (hash2(seed + 52100 + bi, k, 0) - 0.5) * B.slot * 0.4;
      const worldX = k * B.slot + jitter;
      const type = regionAt(seed, Math.floor(worldX), rowY).system;
      out.push({
        key: `${bi}:${k}`,
        worldX,
        depth: B.depth,
        factor: B.factor,
        span: B.span,
        type,
        damage: damageFor(seed, k, bi, altitudeTiles),
        variantSeed: Math.floor(hash2(seed + 52200 + bi, k, 0) * 0xffffff),
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/render/megastructure/place.test.ts`
Expected: PASS(7テスト)

- [ ] **Step 5: コミット**

```bash
git add src/render/megastructure/place.ts src/render/megastructure/place.test.ts
git commit -m "feat: 超構造スロットの決定論配置と連続損傷damageFor"
```

---

### Task 3: 大気遠近(かすみ)の純粋関数

**Files:**
- Create: `src/render/megastructure/atmosphere.ts`
- Create: `src/render/megastructure/atmosphere.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/render/megastructure/atmosphere.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hazeFactor, hazeColor } from './atmosphere';

describe('hazeFactor', () => {
  it('遠い(depth=0)ほどかすみが強く、近い(depth=1)ほど弱い(単調減少)', () => {
    expect(hazeFactor(0)).toBeGreaterThan(hazeFactor(0.5));
    expect(hazeFactor(0.5)).toBeGreaterThan(hazeFactor(1));
  });

  it('常に[0,1]に収まり、範囲外入力はクランプ', () => {
    for (const d of [-2, 0, 0.3, 1, 3]) {
      const f = hazeFactor(d);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });
});

describe('hazeColor', () => {
  it('#rrggbb を返す', () => {
    expect(hazeColor('#3a588a')).toMatch(/^#[0-9a-f]{6}$/);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/render/megastructure/atmosphere.test.ts`
Expected: FAIL(`Cannot find module './atmosphere'`)

- [ ] **Step 3: 実装を書く**

`src/render/megastructure/atmosphere.ts`:

```ts
import { mixHex } from '../biome';

/** 最遠のかすみ強度(0..1)。近づくほど0へ。 */
const HAZE_MAX = 0.6;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * 深度(0=最遠..1=最近) → かすみ係数(0..1)。
 * 遠いほど大きい(構造を灰へ持ち上げ低コントラスト化)。線形・クランプ。
 */
export function hazeFactor(depth: number): number {
  return clamp01(1 - clamp01(depth)) * HAZE_MAX;
}

/**
 * かすみの色。バイオームの環境色を脱彩度気味の青灰へ寄せた霞色を返す。
 * 遠景構造はこの色に向かって混ぜられ、黒へ沈むのでなく灰へ溶ける。
 */
export function hazeColor(ambientColor: string): string {
  // 環境色を中間の青灰へ寄せる(彩度を落として空気遠近を表現)
  return mixHex(ambientColor, '#3a4653', 0.5);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/render/megastructure/atmosphere.test.ts`
Expected: PASS(3テスト)

- [ ] **Step 5: コミット**

```bash
git add src/render/megastructure/atmosphere.ts src/render/megastructure/atmosphere.test.ts
git commit -m "feat: 大気遠近(かすみ)係数と霞色の純粋関数"
```

---

### Task 4: カタログの共有プリミティブ＋電力系ビルダー

**Files:**
- Create: `src/render/megastructure/catalog.ts`
- Create: `src/render/megastructure/catalog.test.ts`

共有プリミティブで各系統ビルダーを短く保つ(DRY)。損傷は「パネルを`gap`/`frame`へ置換」「稼働灯`glow`は低損傷のみ」で表現する。

- [ ] **Step 1: 失敗するテストを書く**

`src/render/megastructure/catalog.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeRng } from './rng';
import { buildStructure, damageOpCount } from './catalog';

const rng = () => makeRng(20260711, 3, 7);

describe('buildStructure(power)', () => {
  it('決定論: 同じ type/damage/seed は同じオペ列', () => {
    const a = buildStructure('power', 0.5, rng());
    const b = buildStructure('power', 0.5, rng());
    expect(a).toEqual(b);
  });

  it('非空のオペ列を返す', () => {
    expect(buildStructure('power', 0.3, rng()).ops.length).toBeGreaterThan(0);
  });

  it('損傷が上がるほど損傷オペ(gap+frame)は増える(単調非減少)', () => {
    const low = damageOpCount(buildStructure('power', 0.1, rng()));
    const mid = damageOpCount(buildStructure('power', 0.5, rng()));
    const high = damageOpCount(buildStructure('power', 0.9, rng()));
    expect(mid).toBeGreaterThanOrEqual(low);
    expect(high).toBeGreaterThanOrEqual(mid);
  });

  it('稼働灯(glow)は低損傷のみ出る', () => {
    const low = buildStructure('power', 0.1, rng()).ops.some((o) => o.t === 'glow');
    const high = buildStructure('power', 0.9, rng()).ops.some((o) => o.t === 'glow');
    expect(low).toBe(true);
    expect(high).toBe(false);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/render/megastructure/catalog.test.ts`
Expected: FAIL(`Cannot find module './catalog'`)

- [ ] **Step 3: 共有プリミティブと電力系ビルダーを書く**

`src/render/megastructure/catalog.ts`:

```ts
import type { System } from '../../world/hierarchy';
import type { DrawOp, StructureSpec, Tone } from './spec';
import type { Rng } from './rng';

/** 構造の型。5系統 + 将来の拡張(段階E: biomech)を見越したユニオン */
export type StructureType = System;

/** テスト用: 損傷オペ(gap/frame)の数 */
export function damageOpCount(spec: StructureSpec): number {
  return spec.ops.filter((o) => o.t === 'gap' || o.t === 'frame').length;
}

// ---- 共有プリミティブ(各ビルダーが ops に push する) ----

/** パネル格子を敷き、損傷度に応じて一部を gap/frame へ置換する */
function panelBay(ops: DrawOp[], x: number, y: number, w: number, h: number, damage: number, rng: Rng): void {
  ops.push({ t: 'panels', x, y, w, h });
  const cells = 3 + Math.floor(w * 8);
  for (let i = 0; i < cells; i++) {
    if (rng() < damage * 0.5) {
      const gx = x + rng() * w * 0.8;
      const gy = y + rng() * h * 0.8;
      const gw = w * 0.12;
      const gh = h * 0.12;
      // 高損傷では抜け穴、中損傷では露出フレーム
      ops.push(rng() < damage ? { t: 'frame', x: gx, y: gy, w: gw, h: gh } : { t: 'gap', x: gx, y: gy, w: gw, h: gh });
    }
  }
}

/** 上端リムライト(左上→右上の折れ線) */
function rimTop(ops: DrawOp[], x: number, y: number, w: number): void {
  ops.push({ t: 'rim', pts: [[x, y], [x + w, y]] });
}

// ---- 系統別ビルダー ----

/** 電力系: 球形格納容器(mass) + タービンホール(縦配管束) + 変圧器バンク */
function buildPower(damage: number, rng: Rng): StructureSpec {
  const ops: DrawOp[] = [];
  // 格納容器(丸みは renderer 側で cyl 扱いにせず mass+rim で表現)
  ops.push({ t: 'mass', x: 0.02, y: 0.35, w: 0.34, h: 0.6, tone: 'mid' });
  panelBay(ops, 0.05, 0.4, 0.28, 0.5, damage, rng);
  rimTop(ops, 0.02, 0.35, 0.34);
  // タービンホール
  ops.push({ t: 'mass', x: 0.4, y: 0.2, w: 0.34, h: 0.8, tone: 'mid' });
  for (let i = 0; i < 5; i++) ops.push({ t: 'pipe', pts: [[0.44 + i * 0.06, 0.22], [0.44 + i * 0.06, 1]], width: 0.02 });
  ops.push({ t: 'truss', x: 0.42, y: 0.2, w: 0.3, h: 0.35 });
  panelBay(ops, 0.42, 0.55, 0.3, 0.4, damage, rng);
  rimTop(ops, 0.4, 0.2, 0.34);
  // 変圧器バンク + 母線
  for (let i = 0; i < 3; i++) ops.push({ t: 'mass', x: 0.78 + i * 0.07, y: 0.5, w: 0.05, h: 0.5, tone: 'near' });
  ops.push({ t: 'pipe', pts: [[0.78, 0.46], [0.99, 0.46]], width: 0.008 });
  // 稼働灯(低損傷のみ)
  if (damage < 0.35) {
    ops.push({ t: 'glow', x: 0.5, y: 0.5, r: 0.02, kind: 'work' });
    ops.push({ t: 'glow', x: 0.19, y: 0.6, r: 0.02, kind: 'work' });
  }
  // 高損傷: 露出フレームを追加
  if (damage > 0.6) ops.push({ t: 'frame', x: 0.05, y: 0.35, w: 0.3, h: 0.2 });
  return { ops };
}

const BUILDERS: Record<StructureType, (damage: number, rng: Rng) => StructureSpec> = {
  power: buildPower,
  // 以降 Task 5 で追加(暫定で power に委譲し型を満たす)
  water: buildPower,
  foundry: buildPower,
  disposal: buildPower,
  habitation: buildPower,
};

/** 型・損傷度・乱数列 → 描画オペ列(純粋: rng が決定論なら出力も決定論) */
export function buildStructure(type: StructureType, damage: number, rng: Rng): StructureSpec {
  return BUILDERS[type](Math.max(0, Math.min(1, damage)), rng);
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/render/megastructure/catalog.test.ts`
Expected: PASS(4テスト)

- [ ] **Step 5: コミット**

```bash
git add src/render/megastructure/catalog.ts src/render/megastructure/catalog.test.ts
git commit -m "feat: 超構造カタログの共有プリミティブと電力系ビルダー"
```

---

### Task 5: 残り4系統のビルダー(水/精錬/廃棄/居住)

**Files:**
- Modify: `src/render/megastructure/catalog.ts`
- Modify: `src/render/megastructure/catalog.test.ts`

- [ ] **Step 1: 失敗するテストを追加**

`src/render/megastructure/catalog.test.ts` の末尾に追加:

```ts
import { SYSTEMS } from '../../world/hierarchy';

describe('buildStructure(全系統)', () => {
  for (const sys of SYSTEMS) {
    it(`${sys}: 非空・決定論・損傷単調・低損傷のみglow`, () => {
      const mk = () => makeRng(42, 9, 1);
      const a = buildStructure(sys, 0.5, mk());
      const b = buildStructure(sys, 0.5, mk());
      expect(a).toEqual(b);
      expect(a.ops.length).toBeGreaterThan(0);
      const low = damageOpCount(buildStructure(sys, 0.1, mk()));
      const high = damageOpCount(buildStructure(sys, 0.9, mk()));
      expect(high).toBeGreaterThanOrEqual(low);
      expect(buildStructure(sys, 0.9, mk()).ops.some((o) => o.t === 'glow')).toBe(false);
    });
  }
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/render/megastructure/catalog.test.ts`
Expected: FAIL(water/foundry/disposal/habitation は現状 power と同一形状のため、`glow` を持つ電力系ロジックに依存し「低損傷のみglow」は通るが、各系統固有形状が無い＝仕様未達。ここではまず**固有ビルダー未実装を検出するための一時的な失敗**として、次Stepで各系統に固有の`glow`条件・形状を入れる。テストが緑でも Step3 を必ず実施すること。)

> 注: 上記テストは「契約(決定論・単調・glow条件)」を全系統に課すもの。形状の"意味"(冷却塔/溶鉱炉…)はスクショゲート(Task 7)で担保する。

- [ ] **Step 3: 4系統の固有ビルダーを実装し、ディスパッチ表を差し替える**

`src/render/megastructure/catalog.ts` の `buildPower` 関数の直後に4関数を追加:

```ts
/** 水系: 冷却塔(双曲線近似) + 巨大貯水槽(cyl) + 水管橋(pipe) */
function buildWater(damage: number, rng: Rng): StructureSpec {
  const ops: DrawOp[] = [];
  // 冷却塔(上細り: 台形mass2段で近似)
  ops.push({ t: 'mass', x: 0.02, y: 0.5, w: 0.22, h: 0.5, tone: 'mid' });
  ops.push({ t: 'mass', x: 0.05, y: 0.15, w: 0.16, h: 0.4, tone: 'far' });
  rimTop(ops, 0.05, 0.15, 0.16);
  // 貯水槽(円筒)
  ops.push({ t: 'cyl', x: 0.32, y: 0.25, w: 0.3, h: 0.75, tone: 'mid' });
  panelBay(ops, 0.34, 0.45, 0.26, 0.5, damage, rng);
  rimTop(ops, 0.32, 0.25, 0.3);
  // 水管橋(奥へ伸びる太パイプ2本)
  ops.push({ t: 'pipe', pts: [[0.66, 0.5], [0.85, 0.46], [1, 0.5]], width: 0.03 });
  ops.push({ t: 'pipe', pts: [[0.66, 0.62], [0.85, 0.6], [1, 0.64]], width: 0.03 });
  if (damage < 0.35) ops.push({ t: 'glow', x: 0.47, y: 0.5, r: 0.018, kind: 'work' });
  if (damage > 0.6) ops.push({ t: 'frame', x: 0.05, y: 0.15, w: 0.16, h: 0.2 });
  return { ops };
}

/** 精錬区: 溶鉱炉(釣鐘mass + 内部熱光) + 取鍋クレーン + 煙突 */
function buildFoundry(damage: number, rng: Rng): StructureSpec {
  const ops: DrawOp[] = [];
  ops.push({ t: 'mass', x: 0.04, y: 0.35, w: 0.3, h: 0.65, tone: 'mid' });
  panelBay(ops, 0.07, 0.42, 0.24, 0.5, damage, rng);
  rimTop(ops, 0.04, 0.35, 0.3);
  // 取鍋クレーン(横梁 + 吊り鍋)
  ops.push({ t: 'pipe', pts: [[0.36, 0.12], [0.72, 0.12]], width: 0.015 });
  ops.push({ t: 'mass', x: 0.5, y: 0.12, w: 0.1, h: 0.28, tone: 'near' });
  // 煙突2本
  ops.push({ t: 'mass', x: 0.78, y: 0.05, w: 0.07, h: 0.95, tone: 'mid' });
  ops.push({ t: 'mass', x: 0.88, y: 0.2, w: 0.06, h: 0.8, tone: 'far' });
  rimTop(ops, 0.78, 0.05, 0.07);
  // 溶鉱の熱光は損傷に関わらず稀に残るが、glow('heat')は低〜中損傷のみ(稼働の名残)
  if (damage < 0.5) {
    ops.push({ t: 'glow', x: 0.19, y: 0.85, r: 0.05, kind: 'heat' });
    ops.push({ t: 'glow', x: 0.55, y: 0.38, r: 0.03, kind: 'heat' });
  }
  if (damage > 0.6) ops.push({ t: 'frame', x: 0.07, y: 0.35, w: 0.24, h: 0.2 });
  return { ops };
}

/** 廃棄区: 焼却炉(mass) + 巨大排気ダクト(蛇行pipe) + 廃棄ピット(gap) */
function buildDisposal(damage: number, rng: Rng): StructureSpec {
  const ops: DrawOp[] = [];
  ops.push({ t: 'mass', x: 0.03, y: 0.3, w: 0.34, h: 0.7, tone: 'mid' });
  panelBay(ops, 0.06, 0.36, 0.28, 0.55, damage, rng);
  rimTop(ops, 0.03, 0.3, 0.34);
  // 蛇行する巨大ダクト
  ops.push({ t: 'pipe', pts: [[0.37, 0.4], [0.55, 0.35], [0.62, 0.6], [0.82, 0.5], [1, 0.55]], width: 0.05 });
  // 廃棄ピット(手前の暗い落ち込み)
  ops.push({ t: 'gap', x: 0.4, y: 0.85, w: 0.4, h: 0.15 });
  if (damage < 0.35) ops.push({ t: 'glow', x: 0.2, y: 0.75, r: 0.035, kind: 'heat' });
  if (damage > 0.6) ops.push({ t: 'frame', x: 0.06, y: 0.3, w: 0.28, h: 0.2 });
  return { ops };
}

/** 居住区: 蜂の巣状の居室セル(規則→損傷で崩壊) */
function buildHabitation(damage: number, rng: Rng): StructureSpec {
  const ops: DrawOp[] = [];
  ops.push({ t: 'mass', x: 0.05, y: 0.2, w: 0.9, h: 0.8, tone: 'mid' });
  // 居室セルをパネルとして敷き、損傷で崩す
  panelBay(ops, 0.08, 0.24, 0.84, 0.72, damage, rng);
  panelBay(ops, 0.08, 0.24, 0.84, 0.72, damage * 0.7, rng); // 二世代の継ぎ目で単一格子感を壊す
  rimTop(ops, 0.05, 0.2, 0.9);
  // 露出鉄筋(損傷側=右へ行くほど)
  if (damage > 0.4) ops.push({ t: 'frame', x: 0.6, y: 0.5, w: 0.3, h: 0.3 });
  if (damage < 0.35) ops.push({ t: 'glow', x: 0.3, y: 0.4, r: 0.012, kind: 'work' });
  return { ops };
}
```

そして `BUILDERS` を差し替える:

```ts
const BUILDERS: Record<StructureType, (damage: number, rng: Rng) => StructureSpec> = {
  power: buildPower,
  water: buildWater,
  foundry: buildFoundry,
  disposal: buildDisposal,
  habitation: buildHabitation,
};
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/render/megastructure/catalog.test.ts`
Expected: PASS(4 + 5系統 = 9テスト)

- [ ] **Step 5: コミット**

```bash
git add src/render/megastructure/catalog.ts src/render/megastructure/catalog.test.ts
git commit -m "feat: 水/精錬/廃棄/居住の超構造ビルダー"
```

---

### Task 6: 描画モジュール(オペ解釈＋深度＋かすみ＋リムライト)

**Files:**
- Create: `src/render/megastructure.ts`

テスト対象外(Canvas描画)。型チェックと既存テスト回帰なしで確認し、見た目は Task 7 のスクショで判定する。

- [ ] **Step 1: 実装を書く**

`src/render/megastructure.ts`:

```ts
import type { BiomeBlend } from './biome';
import { mixHex } from './biome';
import type { Camera } from '../core/camera';
import { slotsInView, type Slot } from './megastructure/place';
import { buildStructure } from './megastructure/catalog';
import { makeRng } from './megastructure/rng';
import { hazeFactor, hazeColor } from './megastructure/atmosphere';
import type { DrawOp, StructureSpec, Tone } from './megastructure/spec';

/** 明度段 → 基準色への混合率(遠=暗, 近=明) */
const TONE_MIX: Record<Tone, number> = { far: 0.12, mid: 0.3, near: 0.5 };

export class MegaStructure {
  /** スロットキー → 生成済みスペック(損傷を量子化してキャッシュ) */
  private cache = new Map<string, StructureSpec>();

  constructor(private seed: number) {}

  render(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    w: number,
    h: number,
    ppt: number,
    bb: BiomeBlend,
  ): void {
    const spanTiles = w / ppt;
    const slots = slotsInView(this.seed, cam.x, spanTiles, cam.y);
    // 遠(depth小)から描くと近が上に来る
    slots.sort((a, b) => a.depth - b.depth);

    const haze = hazeColor(bb.ambientColor);
    // 構造の基準色(黒に近い青灰。tone/かすみで持ち上げる)
    const baseDark = mixHex('#05090e', bb.ambientColor, 0.25);

    for (const s of slots) {
      const spec = this.specFor(s);
      // スロットの画面矩形。深度 factor で水平パララックス、基部は画面下 85% に接地。
      const scale = s.factor;
      const sw = s.span * ppt;
      const sh = sw * 1.1; // 構造の見かけ縦横比
      const sx = (s.worldX - cam.x * scale) * ppt + w / 2 - sw / 2;
      const baseY = h * 0.85 + cam.y * scale * 0.15 * ppt;
      const sy = baseY - sh;
      if (sx + sw < 0 || sx > w) continue;

      const hf = hazeFactor(s.depth);
      this.drawSpec(ctx, spec, sx, sy, sw, sh, baseDark, haze, hf);
    }
    ctx.globalAlpha = 1;
  }

  private specFor(s: Slot): StructureSpec {
    const q = Math.round(s.damage * 4) / 4; // 損傷を1/4刻みに量子化
    const key = `${s.key}:${s.type}:${q}`;
    let spec = this.cache.get(key);
    if (!spec) {
      spec = buildStructure(s.type, s.damage, makeRng(this.seed, s.variantSeed, Math.round(q * 100)));
      this.cache.set(key, spec);
    }
    return spec;
  }

  /** かすみを織り込んだ塗り色。tone で持ち上げ、かすみ係数で霞色へ寄せる。 */
  private fill(base: string, haze: string, tone: Tone, hf: number): string {
    const lit = mixHex(base, '#9fb4c8', TONE_MIX[tone]);
    return mixHex(lit, haze, hf);
  }

  private drawSpec(
    ctx: CanvasRenderingContext2D,
    spec: StructureSpec,
    ox: number, oy: number, sw: number, sh: number,
    base: string, haze: string, hf: number,
  ): void {
    const X = (x: number) => ox + x * sw;
    const Y = (y: number) => oy + y * sh;
    // 遠いほど全体を淡く(かすみで沈む)
    const alpha = 0.5 + (1 - hf) * 0.45;
    for (const op of spec.ops) {
      this.drawOp(ctx, op, X, Y, sw, sh, base, haze, hf, alpha);
    }
  }

  private drawOp(
    ctx: CanvasRenderingContext2D, op: DrawOp,
    X: (x: number) => number, Y: (y: number) => number, sw: number, sh: number,
    base: string, haze: string, hf: number, alpha: number,
  ): void {
    ctx.globalAlpha = alpha;
    switch (op.t) {
      case 'mass':
        ctx.fillStyle = this.fill(base, haze, op.tone, hf);
        ctx.fillRect(X(op.x), Y(op.y), op.w * sw, op.h * sh);
        break;
      case 'cyl': {
        const g = ctx.createLinearGradient(X(op.x), 0, X(op.x) + op.w * sw, 0);
        g.addColorStop(0, this.fill(base, haze, 'far', hf));
        g.addColorStop(0.35, this.fill(base, haze, op.tone, hf));
        g.addColorStop(1, this.fill(base, haze, 'far', hf));
        ctx.fillStyle = g;
        ctx.fillRect(X(op.x), Y(op.y), op.w * sw, op.h * sh);
        break;
      }
      case 'truss': {
        ctx.strokeStyle = this.fill(base, haze, 'mid', hf);
        ctx.lineWidth = Math.max(1, sw * 0.01);
        const x0 = X(op.x), y0 = Y(op.y), ww = op.w * sw, hh = op.h * sh;
        ctx.strokeRect(x0, y0, ww, hh);
        for (let b = 1; b < 5; b++) { const by = y0 + hh * (b / 5); ctx.beginPath(); ctx.moveTo(x0, by); ctx.lineTo(x0 + ww, by); ctx.stroke(); }
        break;
      }
      case 'pipe':
        ctx.strokeStyle = this.fill(base, haze, 'mid', hf);
        ctx.lineWidth = Math.max(1, op.width * sw);
        ctx.beginPath();
        op.pts.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))));
        ctx.stroke();
        break;
      case 'panels': {
        ctx.strokeStyle = this.fill(base, haze, 'near', hf);
        ctx.globalAlpha = alpha * 0.5;
        ctx.lineWidth = 1;
        const cols = Math.max(2, Math.floor(op.w * sw / 14));
        const rows = Math.max(2, Math.floor(op.h * sh / 12));
        for (let c = 0; c <= cols; c++) { const px = X(op.x) + (op.w * sw) * (c / cols); ctx.beginPath(); ctx.moveTo(px, Y(op.y)); ctx.lineTo(px, Y(op.y) + op.h * sh); ctx.stroke(); }
        for (let r = 0; r <= rows; r++) { const py = Y(op.y) + (op.h * sh) * (r / rows); ctx.beginPath(); ctx.moveTo(X(op.x), py); ctx.lineTo(X(op.x) + op.w * sw, py); ctx.stroke(); }
        ctx.globalAlpha = alpha;
        break;
      }
      case 'gap':
        ctx.fillStyle = '#03060a';
        ctx.fillRect(X(op.x), Y(op.y), op.w * sw, op.h * sh);
        break;
      case 'frame':
        ctx.strokeStyle = this.fill(base, haze, 'near', hf);
        ctx.globalAlpha = alpha * 0.7;
        ctx.lineWidth = 1;
        for (let i = 0; i < 4; i++) { const fx = X(op.x) + op.w * sw * (i / 4); ctx.beginPath(); ctx.moveTo(fx, Y(op.y)); ctx.lineTo(fx, Y(op.y) + op.h * sh); ctx.stroke(); }
        ctx.globalAlpha = alpha;
        break;
      case 'rim':
        // リムライトはかすみで弱める(遠いほど淡い)
        ctx.strokeStyle = mixHex('#7d97ad', haze, hf);
        ctx.globalAlpha = (0.4 + (1 - hf) * 0.5);
        ctx.lineWidth = Math.max(1, sw * 0.006);
        ctx.beginPath();
        op.pts.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))));
        ctx.stroke();
        ctx.globalAlpha = alpha;
        break;
      case 'glow': {
        const col = op.kind === 'heat' ? '#c8641e' : '#8fd0ff';
        const r = op.r * sw;
        const g = ctx.createRadialGradient(X(op.x), Y(op.y), 0, X(op.x), Y(op.y), r * 3);
        g.addColorStop(0, col);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = (op.kind === 'heat' ? 0.5 : 0.35) * (1 - hf);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(X(op.x), Y(op.y), r * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = alpha;
        break;
      }
    }
  }
}
```

- [ ] **Step 2: 型チェックと既存テスト回帰なしを確認**

Run: `npx tsc --noEmit && npm test`
Expected: 型エラーなし。全既存テスト PASS(描画は自動テスト対象外)。

- [ ] **Step 3: コミット**

```bash
git add src/render/megastructure.ts
git commit -m "feat: 超構造の描画モジュール(オペ解釈・深度・かすみ・リムライト)"
```

---

### Task 7: renderer への配線とスクリーンショット確認

**Files:**
- Modify: `src/render/renderer.ts`

- [ ] **Step 1: import と生成を追加**

`src/render/renderer.ts` の import 群(12行目 `import { drawBeam, drawCharge } from './beam';` の直後)に追加:

```ts
import { MegaStructure } from './megastructure';
```

同ファイルの `private background: Background;`(33行目)の直後に追加:

```ts
  private megastructure: MegaStructure;
```

コンストラクタの `this.background = new Background(seed);`(47行目)の直後に追加:

```ts
    this.megastructure = new MegaStructure(seed);
```

- [ ] **Step 2: 背景パララックスと焼き込みチャンクの間で描画する**

`src/render/renderer.ts` の `this.background.render(ctx, cam.x, cam.y, w, h, ppt, bb);`(105行目)の**直後**に追加:

```ts
    // 意味を持つ超構造(遠→中→近の深度＋かすみ)。焼き込みチャンクより背後、遠景パララックスより手前。
    this.megastructure.render(ctx, cam, w, h, ppt, bb);
```

- [ ] **Step 3: 型チェックと既存テスト回帰なしを確認**

Run: `npx tsc --noEmit && npm test`
Expected: 型エラーなし。全既存テスト PASS。

- [ ] **Step 4: 各系統×損傷×開放/閉塞でスクリーンショットを撮る**

Run:

```bash
npm run shot -- --out=screenshots/msB-cavern.png --seed=20260711 --pos=200,-1600
npm run shot -- --out=screenshots/msB-residential.png --seed=20260711 --pos=200,-560
npm run shot -- --out=screenshots/msB-seed42.png --seed=42 --pos=200,-1600
```

注: `--pos` は目安。埋まり/閉塞ならログのURLをブラウザで開き、大空洞帯(高度500m級以上)の開けた床へ調整して撮り直す。既存 `screenshots/final-kudo.png`(大空洞帯)・`sm6-kyoju.png`(居住区跡)が参考。

- [ ] **Step 5: 目視で合否を判定**

期待:
- 闇の奥に、今いる系統に応じた**意味を持つ機械**(電力=球+タービン+変圧器、水=冷却塔+貯水槽+水管橋 等)がシルエットで立つ。
- 遠い層ほど**かすみで灰に溶け**、近い層ほどクリスプで上端リムライトが浮く(奥行き)。
- 損傷度が場所ごとに異なり、抜け区画・露出フレーム・稀な稼働灯が混在(非反復)。
- **足場(焼き込みチャンク)は超構造の手前に不透明で描かれ、可読性を損なわない**。

不合格時の調整箇所(コード側・再コミット):
- 濃すぎ/薄すぎ → `megastructure.ts` の `drawSpec` の `alpha`、`TONE_MIX`。
- かすみが強すぎ/弱すぎ → `atmosphere.ts` の `HAZE_MAX`。
- 構造が多すぎ/少なすぎ → `place.ts` の `BANDS[].density`/`slot`。
- 位置(高すぎ/低すぎ) → `megastructure.ts` の `baseY`(既定 `h*0.85`)。

- [ ] **Step 6: 確認できたら完了(このタスクにコミットは不要。調整した場合のみコミット)**

段階B完了。レビュー(requesting-code-review)へ。

---

## セルフレビュー結果

- **スペック網羅(段階B分)**: 5系統カタログ(Task4,5)・連続損傷(`damageFor` Task2 + カタログの損傷駆動 Task4,5)・3層深度(`BANDS` Task2 + 深度描画 Task6)・大気遠近かすみ(`atmosphere` Task3 + 描画 Task6)・系統連動(`regionAt` を `slotsInView` が使用 Task2)・合成順(renderer 配線 Task7)を網羅。純粋関数のユニットテスト方針(設計書テスト方針)を Task1〜5 が満たす。移動環境/痕跡/光条/バイオメカ/ランドマークは本計画スコープ外と明記済み。
- **プレースホルダ**: なし。全コード・全コマンド・期待出力を明記。Task4 で `BUILDERS` が暫定 `power` 委譲になるが、Task5 で必ず差し替える旨と差し替えコードを明記。
- **型整合**: `DrawOp`/`StructureSpec`/`Tone`(spec.ts)を catalog/megastructure が一致使用。`Rng`/`makeRng`(rng.ts)を catalog/megastructure が使用。`Slot`/`BANDS`/`slotsInView`/`damageFor`(place.ts)を megastructure/テストが一致使用。`hazeFactor`/`hazeColor`(atmosphere.ts)を megastructure が使用。`buildStructure`/`damageOpCount`(catalog.ts)をテスト/megastructure が使用。`StructureType = System` により `BUILDERS` は全系統を網羅(型で保証)。
- **回帰**: `physics.ts`・worldgen 無改修。`renderer.ts` は import 1行＋フィールド1行＋生成1行＋描画1行のみ。既存テストは不変。
