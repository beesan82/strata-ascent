# 段階C-1: 移動環境の後退内面(厚み)＋上端リムライト 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 焼き込みタイルの平面感を消し、空気に面したSOLIDエッジへ「奥へ純黒へ後退する暗い内面帯(厚み)」と「歩ける上端の明るいリムライト(可読性)」を重ね、移動環境を弐瓶的な立体構造に見せる。

**Architecture:** 露出辺(4近傍のAIR)→後退内面帯の矩形/グラデ端点、リム線分を返す**純粋関数モジュール** `render/tileset/relief.ts` を新設(設計書が「押し出しジオメトリは純粋関数でテスト」と明記)。`chunkbake.ts` はアトラス描画の直後にこの幾何を解釈して暗帯グラデ＋リム線を焼き込むだけ。**アトラス・物理・worldgen・当たり判定は無改修**(見た目のみ)。濃さ・深さはバイオームの `ambientLevel` 連動で、明バイオーム/狭通路でも足場が読めるよう抑える。

**Tech Stack:** TypeScript + Canvas 2D + Vitest。設計書: [docs/superpowers/specs/2026-07-17-blame-sim-nihei-visual-realism-design.md](../specs/2026-07-17-blame-sim-nihei-visual-realism-design.md) の「3. 移動環境の弐瓶化」の後退内面＋可読性ゲート。

**スコープ注記:** 本計画は段階Cのうち **後退内面(厚み)＋上端リムライト** のみ。設計書段階Cの残り(鋼グレーチング床の素材化・コンクリ壁のリブ柱・壁の連続損傷・ケージ梯子・壁↔床の配管横断)は別計画 段階C-2 に分離する。本計画だけで動く縦スライス(平面→立体の視覚変化をスクショで確認できる)。

---

## ファイル構成

- Create: `src/render/tileset/relief.ts` — 露出辺→後退内面帯・リム線分の純粋幾何。責務: 幾何のみ(色/Canvasは持たない)。
- Create: `src/render/tileset/relief.test.ts` — 上記のユニットテスト。
- Modify: `src/render/chunkbake.ts` — アトラス描画直後に relief を焼き込む(暗帯グラデ＋リム線)。`mixHex` を biome から import。

---

### Task 1: 後退内面・リムの純粋幾何モジュール

**Files:**
- Create: `src/render/tileset/relief.ts`
- Test: `src/render/tileset/relief.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/render/tileset/relief.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { reliefEdges, reliefBands, rimSegments } from './relief';

describe('reliefEdges', () => {
  it('全近傍SOLIDなら露出辺なし', () => {
    expect(reliefEdges(true, true, true, true)).toEqual({ top: false, right: false, bottom: false, left: false });
  });

  it('全近傍AIRなら全辺露出', () => {
    expect(reliefEdges(false, false, false, false)).toEqual({ top: true, right: true, bottom: true, left: true });
  });

  it('上だけAIR(床の上面)なら top のみ露出', () => {
    expect(reliefEdges(false, true, true, true)).toEqual({ top: true, right: false, bottom: false, left: false });
  });
});

describe('reliefBands', () => {
  it('露出辺の数だけ帯を返す', () => {
    expect(reliefBands({ top: true, right: false, bottom: false, left: false }, 0.3)).toHaveLength(1);
    expect(reliefBands({ top: true, right: true, bottom: true, left: true }, 0.3)).toHaveLength(4);
    expect(reliefBands({ top: false, right: false, bottom: false, left: false }, 0.3)).toHaveLength(0);
  });

  it('top帯は上端全幅・厚さdepth、グラデは露出面(y=0)から内側(y=depth)へ', () => {
    const [b] = reliefBands({ top: true, right: false, bottom: false, left: false }, 0.3);
    expect(b).toEqual({ x: 0, y: 0, w: 1, h: 0.3, from: [0, 0], to: [0, 0.3] });
  });

  it('right帯は右端(x=1-depth)から内側へ', () => {
    const [b] = reliefBands({ top: false, right: true, bottom: false, left: false }, 0.25);
    expect(b).toEqual({ x: 0.75, y: 0, w: 0.25, h: 1, from: [1, 0], to: [0.75, 0] });
  });

  it('bottom帯は下端から内側へ', () => {
    const [b] = reliefBands({ top: false, right: false, bottom: true, left: false }, 0.2);
    expect(b).toEqual({ x: 0, y: 0.8, w: 1, h: 0.2, from: [0, 1], to: [0, 0.8] });
  });
});

describe('rimSegments', () => {
  it('露出辺ごとに線分を返し、topのみ top=true', () => {
    const segs = rimSegments({ top: true, right: true, bottom: false, left: false });
    expect(segs).toHaveLength(2);
    const top = segs.find((s) => s.top);
    expect(top).toEqual({ x1: 0, y1: 0, x2: 1, y2: 0, top: true });
    const right = segs.find((s) => !s.top);
    expect(right).toEqual({ x1: 1, y1: 0, x2: 1, y2: 1, top: false });
  });

  it('露出辺なしなら空', () => {
    expect(rimSegments({ top: false, right: false, bottom: false, left: false })).toHaveLength(0);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/render/tileset/relief.test.ts`
Expected: FAIL(`Cannot find module './relief'`)

- [ ] **Step 3: 実装を書く**

`src/render/tileset/relief.ts`:

```ts
/** タイルの4辺が空気に面しているか(露出しているか) */
export interface ReliefEdges {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

/** 後退内面の帯。座標はタイル正規化(0..1, x=右, y=下)。from→to はグラデーション端点(露出面→内側)。 */
export interface ReliefBand {
  x: number;
  y: number;
  w: number;
  h: number;
  from: [number, number];
  to: [number, number];
}

/** 露出辺のリム線分。タイル正規化座標。top=歩ける上端(明るく描く印) */
export interface RimSeg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  top: boolean;
}

/**
 * 4近傍のSOLID有無(引数はいずれも「その方向がSOLIDか」)から露出辺を返す。
 * 露出 = 近傍が非SOLID(空気に面する)。純粋関数。
 */
export function reliefEdges(nSolid: boolean, eSolid: boolean, sSolid: boolean, wSolid: boolean): ReliefEdges {
  return { top: !nSolid, right: !eSolid, bottom: !sSolid, left: !wSolid };
}

/**
 * 露出辺ごとに、露出面から内側へ depth ぶん後退する暗帯の矩形とグラデ端点を返す。
 * グラデは露出面(from)側を濃く、内側(to)側を透明にする想定(色はchunkbake側)。
 * 各辺の帯は方向がタイル間で揃うため、同じ辺が連続すると継ぎ目なく1本の帯に見える。純粋関数。
 */
export function reliefBands(e: ReliefEdges, depth: number): ReliefBand[] {
  const out: ReliefBand[] = [];
  if (e.top) out.push({ x: 0, y: 0, w: 1, h: depth, from: [0, 0], to: [0, depth] });
  if (e.bottom) out.push({ x: 0, y: 1 - depth, w: 1, h: depth, from: [0, 1], to: [0, 1 - depth] });
  if (e.left) out.push({ x: 0, y: 0, w: depth, h: 1, from: [0, 0], to: [depth, 0] });
  if (e.right) out.push({ x: 1 - depth, y: 0, w: depth, h: 1, from: [1, 0], to: [1 - depth, 0] });
  return out;
}

/**
 * 露出辺のリム線分。上端(歩ける面)は top=true にして呼び出し側が明るく描く。純粋関数。
 */
export function rimSegments(e: ReliefEdges): RimSeg[] {
  const out: RimSeg[] = [];
  if (e.top) out.push({ x1: 0, y1: 0, x2: 1, y2: 0, top: true });
  if (e.bottom) out.push({ x1: 0, y1: 1, x2: 1, y2: 1, top: false });
  if (e.left) out.push({ x1: 0, y1: 0, x2: 0, y2: 1, top: false });
  if (e.right) out.push({ x1: 1, y1: 0, x2: 1, y2: 1, top: false });
  return out;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/render/tileset/relief.test.ts`
Expected: PASS(10テスト)

- [ ] **Step 5: コミット**

```bash
git add src/render/tileset/relief.ts src/render/tileset/relief.test.ts
git commit -m "feat: 後退内面帯・リム線分の純粋幾何(relief)"
```

---

### Task 2: chunkbake へ後退内面＋リムを焼き込み、スクショ確認

**Files:**
- Modify: `src/render/chunkbake.ts`

- [ ] **Step 1: import を追加**

`src/render/chunkbake.ts` の biome import 行を次に変更する。現状:

```ts
import { biomeForSystem, type Biome } from './biome';
```

変更後:

```ts
import { biomeForSystem, mixHex, type Biome } from './biome';
import { reliefEdges, reliefBands, rimSegments } from './tileset/relief';
```

- [ ] **Step 2: アトラス描画ループの直後に relief を焼き込む**

`src/render/chunkbake.ts` の `bake()` 内、SOLIDをアトラスで描く二重ループ(`const r = atlas.rect(blobId(nb)); ... }` で閉じるループ)の**直後**、装飾(`ctx.lineCap = 'round';` から始まる箇所)の**直前**に次を挿入する:

```ts
    // 後退内面(厚み)＋上端リムライト。空気に面したSOLIDエッジに、露出面から内側へ純黒へ
    // 後退する暗帯を敷き、歩ける上端に明るいリム線を引く(可読性)。焼き込みのみ・当たり無改修。
    // 濃さ/深さは ambientLevel 連動で、明バイオームでは控えめにして足場を読める範囲に保つ。
    const reliefDepth = 0.24 + (1 - biome.ambientLevel) * 0.12; // 0.24〜0.36 タイル
    const bandAlpha = 0.32 + (1 - biome.ambientLevel) * 0.34;   // 0.32〜0.66
    const rimTopColor = mixHex(biome.palette.edge, '#ffffff', 0.4);
    for (let ty = 0; ty < CHUNK_SIZE; ty++) {
      const wy = by + ty;
      for (let tx = 0; tx < CHUNK_SIZE; tx++) {
        if (chunk[ty * CHUNK_SIZE + tx] !== TILE.SOLID) continue;
        const wx = bx + tx;
        const edges = reliefEdges(
          store.tileAt(wx, wy - 1) === TILE.SOLID,
          store.tileAt(wx + 1, wy) === TILE.SOLID,
          store.tileAt(wx, wy + 1) === TILE.SOLID,
          store.tileAt(wx - 1, wy) === TILE.SOLID,
        );
        // 後退内面帯: 露出面(from)で濃く、内側(to)で透明のグラデ
        for (const b of reliefBands(edges, reliefDepth)) {
          const grad = ctx.createLinearGradient(
            (tx + b.from[0]) * P, (ty + b.from[1]) * P,
            (tx + b.to[0]) * P, (ty + b.to[1]) * P,
          );
          grad.addColorStop(0, `rgba(2,4,10,${bandAlpha})`);
          grad.addColorStop(1, 'rgba(2,4,10,0)');
          ctx.fillStyle = grad;
          ctx.fillRect((tx + b.x) * P, (ty + b.y) * P, b.w * P, b.h * P);
        }
        // リムライト: 上端は明るく太く(可読性)、側面/下端は淡く細く
        for (const s of rimSegments(edges)) {
          ctx.strokeStyle = s.top ? rimTopColor : biome.palette.edge;
          ctx.globalAlpha = s.top ? 0.9 : 0.4;
          ctx.lineWidth = Math.max(1, (s.top ? 0.12 : 0.07) * P);
          ctx.beginPath();
          ctx.moveTo((tx + s.x1) * P, (ty + s.y1) * P);
          ctx.lineTo((tx + s.x2) * P, (ty + s.y2) * P);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
```

注: `P` は既存の `const P = BAKE_PPT;` を使う。ただし現状 `P` は配管ループ直前(159行目付近)で宣言されている。**relief ループは `P` 宣言より前に入る**ため、この挿入ブロックの冒頭で `P` を使う前に、`const P = BAKE_PPT;` を relief ブロックの先頭へ移動する(既存の配管側の `const P = BAKE_PPT;` は重複するので削除する)。具体的には: relief ブロックの1行目に `const P = BAKE_PPT;` を置き、既存の配管コリドー節の `const P = BAKE_PPT;` 行を削除する。`bake()` 内で `P` が一度だけ宣言される状態にすること。

- [ ] **Step 3: 型チェックと既存テスト回帰なしを確認**

Run: `npx tsc --noEmit && npm test`
Expected: 型エラーなし。全既存テスト PASS(描画は自動テスト対象外)。

- [ ] **Step 4: コミット**

```bash
git add src/render/chunkbake.ts
git commit -m "feat: chunkbakeに後退内面＋上端リムライトを焼き込み"
```

- [ ] **Step 5: スクリーンショットで立体化と可読性を確認**

Run:

```bash
node scripts/screenshot.mjs --out=screenshots/c1-residential.png --seed=20260711 --pos=524488,-560 --wait=3000
node scripts/screenshot.mjs --out=screenshots/c1-corridor.png --seed=20260711 --wait=3000
node scripts/screenshot.mjs --out=screenshots/c1-cavern.png --seed=20260711 --pos=524488,-1700 --wait=3000
```

注: `--pos` は目安。閉塞/明バイオーム(可読性チェック)と開放/暗バイオーム(立体感チェック)の両方を撮る。埋まり座標ならログURLをブラウザで開き調整。

- [ ] **Step 6: 目視で合否を判定(コーディネータ)**

期待:
- 床の**上端に明るいリム線**が出て「乗れる面」が一目で分かる(可読性キープ)。
- 床の上面直下・壁の側面に**暗い内面帯**が入り、タイルが平面でなく厚みのある立体に見える。
- 明バイオーム(居住区など)でも足場が読める(内面帯が濃すぎない)。暗バイオームでは厚みが強く出る。

不合格時の調整(chunkbake側の定数のみ・再コミット):
- 内面が濃すぎ/足場が読めない → `bandAlpha` 係数を下げる、`reliefDepth` を下げる。
- リムが弱い/強い → リムの `globalAlpha`・`lineWidth`・`rimTopColor` の白混合率。

- [ ] **Step 7: 確認できたら完了。段階C-1完了、レビューへ。**

---

## セルフレビュー結果

- **スペック網羅(段階C-1分)**: 後退内面(厚み)= `reliefBands` + chunkbake暗帯グラデ、上端リムライト(可読性)= `rimSegments` + chunkbakeリム、ambientLevel連動の抑制、押し出し幾何の純粋関数ユニットテスト(設計書テスト方針)を Task1/2 が満たす。グレーチング素材・リブ柱・壁損傷・ケージ梯子・配管横断は段階C-2へ分離と明記。
- **プレースホルダ**: なし。全コード・全コマンド・期待出力を明記。`P` の宣言移動という既存コードとの整合手順も具体的に指示。
- **型整合**: `ReliefEdges`/`ReliefBand`/`RimSeg`(relief.ts)を chunkbake が一致使用。`reliefEdges(n,e,s,w)` の bool 引数順(N,E,S,W)を chunkbake の `store.tileAt` 呼び出し順と一致。`mixHex`(biome.ts 既存 export)を chunkbake が import。`biome.palette.edge`/`biome.ambientLevel` は既存 `Biome`/`TilePalette` のフィールド。
- **回帰**: `physics.ts`・worldgen・アトラス生成(generate.ts)無改修。当たり判定は矩形のまま。relief は焼き込みキャンバスへの描画のみで tileAt に影響しない。既存テストは不変(relief.test を追加するのみ)。
