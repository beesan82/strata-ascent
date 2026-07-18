# 段階E-2: バイオメカニカルな異物(稀) 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 純工業の背景超構造に、ごく稀に「生えたように歪んだ有機-機械融合」の異物 — 椎骨状の柱・肋のように伸びる管・不穏な脈光 — を混ぜ、弐瓶的な不気味さと「人の理を超えた」感を与える。

**Architecture:** 段階B(`render/megastructure/`)の拡張。カタログに `biomech` 型ビルダーを追加し、`StructureType` を `System | 'biomech'` に拡張。`place.ts` の各スロットに稀な `biomech` フラグを立て(系統とは直交)、`megastructure.specFor` がフラグ時 `buildStructure('biomech', ...)` を呼ぶ。描画は既存の汎用 DrawOp 解釈がそのまま処理する(**renderer/spec.ts は無改修**)。**物理・worldgen・当たり無改修**、全て決定論の純粋層。

**Tech Stack:** TypeScript + Canvas 2D + Vitest。設計書: [docs/superpowers/specs/2026-07-17-blame-sim-nihei-visual-realism-design.md](../specs/2026-07-17-blame-sim-nihei-visual-realism-design.md) の「5. 味付け(バイオメカ異物)」。既存 `DrawOp`(mass/cyl/pipe/frame/glow)・`makeRng`・`hash2` を再利用。

**スコープ注記:** バイオメカ異物のみ。超巨大ランドマーク強化は別(background.ts の `rareLandmarkAt` に抽象版が既存)。新しい DrawOp 種別は追加しない(既存オペで椎骨・肋・脈光を表現)。

---

## ファイル構成

- Modify: `src/render/megastructure/catalog.ts` — `StructureType` に `'biomech'` を追加、`buildBiomech` を実装、`BUILDERS` に登録。
- Modify: `src/render/megastructure/catalog.test.ts` — `buildBiomech` のテストを追加。
- Modify: `src/render/megastructure/place.ts` — `Slot` に `biomech: boolean`、稀に true を立てる。
- Modify: `src/render/megastructure/place.test.ts` — biomech フラグのテストを追加。
- Modify: `src/render/megastructure.ts` — `specFor` が `biomech` フラグ時 `'biomech'` 型でビルドする。

---

### Task 1: バイオメカ型ビルダーを catalog に追加

**Files:**
- Modify: `src/render/megastructure/catalog.ts`
- Modify: `src/render/megastructure/catalog.test.ts`

- [ ] **Step 1: 失敗するテストを追加**

`src/render/megastructure/catalog.test.ts` の末尾に追加:

```ts
describe('buildStructure(biomech)', () => {
  it('決定論・非空', () => {
    const a = buildStructure('biomech', 0.5, makeRng(7, 1, 2));
    const b = buildStructure('biomech', 0.5, makeRng(7, 1, 2));
    expect(a).toEqual(b);
    expect(a.ops.length).toBeGreaterThan(0);
  });

  it('損傷が上がるほど損傷オペ(gap+frame)は増える(単調非減少)', () => {
    const low = damageOpCount(buildStructure('biomech', 0.1, makeRng(7, 1, 2)));
    const high = damageOpCount(buildStructure('biomech', 0.9, makeRng(7, 1, 2)));
    expect(high).toBeGreaterThanOrEqual(low);
  });

  it('脈光(glow)は損傷に関わらず残る(まだ生きている不気味さ)', () => {
    // 系統機械と違い、biomechは高損傷でも脈光を持つ(意図的な差)
    expect(buildStructure('biomech', 0.1, makeRng(7, 1, 2)).ops.some((o) => o.t === 'glow')).toBe(true);
    expect(buildStructure('biomech', 0.9, makeRng(7, 1, 2)).ops.some((o) => o.t === 'glow')).toBe(true);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/render/megastructure/catalog.test.ts`
Expected: FAIL(`buildStructure('biomech', ...)` で 'biomech' が StructureType に無い型エラー、または実行時に BUILDERS['biomech'] が undefined)

- [ ] **Step 3: 実装を書く**

`src/render/megastructure/catalog.ts` の `StructureType` 定義を変更:

```ts
/** 構造の型。今は System のエイリアス。段階Eで biomech を加える際に union 化する。 */
export type StructureType = System | 'biomech';
```

`buildHabitation` 関数の直後に `buildBiomech` を追加:

```ts
/** バイオメカ異物: 椎骨状の柱 + 肋のように伸びる管 + 内部の脈光(まだ生きている不気味さ) */
function buildBiomech(damage: number, rng: Rng): StructureSpec {
  const ops: DrawOp[] = [];
  // 中央の椎骨状コラム(縦円筒 + 節のふくらみを mass で重ねる)
  ops.push({ t: 'cyl', x: 0.4, y: 0.05, w: 0.2, h: 0.92, tone: 'mid' });
  for (let i = 0; i < 6; i++) {
    const y = 0.1 + i * 0.14;
    ops.push({ t: 'mass', x: 0.36, y, w: 0.28, h: 0.06, tone: 'near' });
  }
  // 肋のように左右へ湾曲して伸びる管(高さ違いで数本)
  for (let i = 0; i < 4; i++) {
    const y = 0.18 + i * 0.2;
    const dir = i % 2 === 0 ? -1 : 1;
    const xEnd = dir < 0 ? 0.05 : 0.95;
    const xMid = 0.5 + dir * 0.28;
    ops.push({ t: 'pipe', pts: [[0.5, y], [xMid, y - 0.05], [xEnd, y + 0.02]], width: 0.02 });
  }
  // 脈光(中心の不穏な発光。損傷に関わらず残す=まだ生きている)
  ops.push({ t: 'glow', x: 0.5, y: 0.45, r: 0.05, kind: 'work' });
  ops.push({ t: 'glow', x: 0.5, y: 0.7, r: 0.03, kind: 'work' });
  // 損傷: 節が剥がれ骨組み/裂けが露出
  const rips = Math.floor(damage * 4);
  for (let i = 0; i < rips; i++) {
    const y = 0.15 + rng() * 0.7;
    ops.push({ t: 'frame', x: 0.36, y, w: 0.28, h: 0.06 });
  }
  if (damage > 0.7) ops.push({ t: 'gap', x: 0.42, y: 0.5, w: 0.16, h: 0.12 });
  return { ops };
}
```

`BUILDERS` に `biomech` を登録:

```ts
const BUILDERS: Record<StructureType, (damage: number, rng: Rng) => StructureSpec> = {
  power: buildPower,
  water: buildWater,
  foundry: buildFoundry,
  disposal: buildDisposal,
  habitation: buildHabitation,
  biomech: buildBiomech,
};
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/render/megastructure/catalog.test.ts`
Expected: PASS(既存 + biomech 3テスト)

- [ ] **Step 5: コミット**

```bash
git add src/render/megastructure/catalog.ts src/render/megastructure/catalog.test.ts
git commit -m "feat: バイオメカ異物のカタログビルダー(buildBiomech)"
```

---

### Task 2: place に稀な biomech フラグ、megastructure が反映

**Files:**
- Modify: `src/render/megastructure/place.ts`
- Modify: `src/render/megastructure/place.test.ts`
- Modify: `src/render/megastructure.ts`

- [ ] **Step 1: 失敗するテストを追加**

`src/render/megastructure/place.test.ts` の `describe('slotsInView', ...)` 内に追加:

```ts
  it('biomechフラグは稀(全スロットの15%未満)だが皆無ではない', () => {
    let total = 0;
    let bio = 0;
    for (let cx = 0; cx < 3000; cx += 400) {
      for (const s of slotsInView(SEED, cx, 2000, 0)) {
        total++;
        if (s.biomech) bio++;
      }
    }
    expect(total).toBeGreaterThan(0);
    expect(bio).toBeGreaterThan(0);
    expect(bio / total).toBeLessThan(0.15);
  });

  it('biomechフラグも決定論', () => {
    const a = slotsInView(SEED, 1000, 800, -3000).map((s) => s.biomech);
    const b = slotsInView(SEED, 1000, 800, -3000).map((s) => s.biomech);
    expect(a).toEqual(b);
  });
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/render/megastructure/place.test.ts`
Expected: FAIL(`s.biomech` が `Slot` に無い型エラー)

- [ ] **Step 3: 実装を書く**

`src/render/megastructure/place.ts` の `Slot` インターフェースに追加:

```ts
export interface Slot {
  key: string;
  worldX: number;
  depth: number;
  factor: number;
  span: number;
  type: System;     // 系統(プレイヤーの実座標 camXtiles,camYtiles の regionAt。可視分は統一)
  damage: number;   // 0..1
  variantSeed: number;
  /** 稀に立つ異物フラグ。true のとき描画側は系統機械でなくバイオメカ異物を出す。 */
  biomech: boolean;
}
```

`slotsInView` の `out.push({...})` に `biomech` を追加(hashゲート約8%):

```ts
      out.push({
        key: `${bi}:${k}`,
        worldX,
        depth: B.depth,
        factor: B.factor,
        span: B.span,
        type: system,
        damage: damageFor(seed, k, bi, altitudeTiles),
        variantSeed: Math.floor(hash2(seed + 52200 + bi, k, 0) * 0xffffff),
        biomech: hash2(seed + 52300 + bi, k, 0) < 0.08,
      });
```

- [ ] **Step 4: megastructure がフラグを反映**

`src/render/megastructure.ts` の import に `StructureType` を追加(既存の catalog import 行を変更):

```ts
import { buildStructure, type StructureType } from './megastructure/catalog';
```

`specFor` を次に変更する(biomech フラグ時は 'biomech' 型でビルド＋キャッシュキーも分離):

```ts
  private specFor(s: Slot): StructureSpec {
    const q = Math.round(s.damage * 4) / 4; // 損傷を1/4刻みに量子化
    const type: StructureType = s.biomech ? 'biomech' : s.type;
    const key = `${s.key}:${type}:${q}`;
    let spec = this.cache.get(key);
    if (!spec) {
      spec = buildStructure(type, s.damage, makeRng(this.seed, s.variantSeed, Math.round(q * 100)));
      this.cache.set(key, spec);
      if (this.cache.size > MegaStructure.CACHE_CAP) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
    }
    return spec;
  }
```

- [ ] **Step 5: テスト・型チェック確認**

Run: `npx vitest run src/render/megastructure/place.test.ts && npx tsc --noEmit && npm test`
Expected: place.test PASS(既存 + biomech 2)、型エラーなし、全既存テスト PASS。

- [ ] **Step 6: コミット**

```bash
git add src/render/megastructure/place.ts src/render/megastructure/place.test.ts src/render/megastructure.ts
git commit -m "feat: 背景に稀なバイオメカ異物を混ぜる(place biomechフラグ+megastructure反映)"
```

- [ ] **Step 7: スクリーンショットで確認(コーディネータ)**

Run:

```bash
node scripts/screenshot.mjs --out=screenshots/e2-a.png --seed=20260711 --pos=524488,-1700 --wait=3500
node scripts/screenshot.mjs --out=screenshots/e2-b.png --seed=42 --pos=200,-1700 --wait=3500
node scripts/screenshot.mjs --out=screenshots/e2-c.png --seed=20260711 --pos=262344,-1700 --wait=3500
```

異物は稀(約8%×可視スロット)。写らなければ座標/シードを変えて数枚撮る。デバッグで一時的に biomech ゲート(0.08)を上げて描画を確認→戻すのも可(戻し忘れ厳禁)。

- [ ] **Step 8: 目視で合否を判定(コーディネータ)**

期待:
- 背景の系統機械群に、ごく稀に椎骨状の柱＋肋管＋脈光の異物が混じり、周囲と異質で不気味に見える。
- 出現が稀で、景観を支配しない。かすみ・深度・リムライトは既存どおり効く(汎用オペ描画なので自動)。

不合格時の調整(コード側・再コミット): place の biomech ゲート(0.08)、`buildBiomech` の座標/脈光。

- [ ] **Step 9: 確認できたら完了。段階E-2完了、レビューへ。**

---

## セルフレビュー結果

- **スペック網羅(段階E-2)**: バイオメカ異物(椎骨柱＋肋管＋脈光)= `buildBiomech`、稀な混入 = place の `biomech` フラグ(hashゲート8%)、描画反映 = `specFor` の型分岐、決定論・損傷連動・「まだ生きている脈光」= テスト、を Task1/2 が満たす。ランドマーク強化はスコープ外と明記。新DrawOp追加なし(既存オペで表現)。
- **プレースホルダ**: なし。全コード・全コマンド・期待出力・調整箇所を明記。
- **型整合**: `StructureType = System | 'biomech'`(catalog)を place の spec
呼び出し・megastructure が一致使用。`BUILDERS` は全 StructureType(5系統+biomech)を網羅(Record型で保証)。`Slot.biomech`(place)を megastructure.specFor が読む。`buildStructure(type, damage, rng)`/`makeRng`/`damageOpCount` は既存シグネチャ。megastructure の cache キーに type を含め biomech/系統を区別。
- **回帰**: `physics.ts`・worldgen・spec.ts・renderer.ts・chunkbake 無改修。描画は既存の汎用 DrawOp 解釈がそのまま処理。既存 catalog/place テストは不変(biomech テストを追加するのみ)。`Slot.biomech` 追加で `slotsInView` 決定論テストの `toEqual` は両辺同構造なので不変。既存 place の「typeは既知の系統」テストは `type` に biomech を入れない(直交フラグ)ため不変。
