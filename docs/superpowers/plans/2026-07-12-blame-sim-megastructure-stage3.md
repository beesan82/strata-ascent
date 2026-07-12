# 超構造体・段階3「ネットワーク(施設をつなぐ配管)」実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 水系統の地区どうしを、歩いてたどれる配管コリドー(キャットウォーク+梯子+配管)でつなぐ。「配管をたどると隣の施設に着く」を成立させる。両端一致・チャンク局所・到達可能性を保つ。

**Architecture:** ネットワークは**各セルが自分の半分だけ描く**方式で両端一致を保証する。地区Cは自分のハブから各辺の中点まで、隣Nは自分のハブから同じ中点まで描く。中点は順不同ペアハッシュ `hash(min,max)` から両者が同一に導くので、クロスセル経路を引かずに継ぎ目なく接続し、完全にチャンク局所になる。`networkTileAt(seed,x,y): Tile|null` を `tileAt` の合成に「施設 ?? ネットワーク ?? ノイズ」の順で足す(梯子保持の不変条件は維持)。

**Tech Stack:** 既存(Vite/TS/Canvas2D/Vitest/Playwright)。

**参照スペック:** `docs/superpowers/specs/2026-07-12-blame-sim-megastructure-worldgen-design.md`

**全タスク共通:**
- `network.ts` は純粋・決定論。乱数は `hash2` と `hierarchy` の解決のみ
- 既存テスト(88件)は回帰なし維持。物理は無改修。到達可能性の不変条件(施設/ネットワークはノイズ LADDER を上書きしない)を維持
- スクショ: `node scripts/screenshot.mjs`。exit0+[pageerror]無し
- 座標: y下向き正、CHUNK=64、DISTRICT_SIZE=1024、ROOM_SIZE=128、TILE={AIR:0,SOLID:1,LADDER:2}
- 段階3スコープ: **水系統・地区レベルの枝配管のみ**。セクター幹線と全系統・因果は段階4。

---

### Task 1: ネットワーク経路の判定(純粋・両端一致)

**Files:**
- Create: `src/world/network.ts`
- Test: `src/world/network.test.ts`

このタスクでは「タイルが配管コリドー上か、コリドー内での役割(床/内部/縦)は何か」を返す純粋関数 `conduitAt(seed,x,y)` を作る。タイル種への変換は Task 2。

設計(各セルが自分の半分を描く):
- 地区セル `(dx,dy)` と、そのローカル座標 `lx,ly ∈ [0,DISTRICT_SIZE)`。
- **地区ハブ**(ローカル座標): `districtHub(seed,dx,dy)` = `(hash→[0.2,0.8)*SIZE, hash→[0.2,0.8)*SIZE)`(端に寄りすぎない中央寄り)。
- 4辺 N/E/S/W それぞれについて、隣接地区 `(ndx,ndy)` との接続を**順不同ペアハッシュ**で判定: `pairHash(seed, [dx,dy],[ndx,ndy]) < CONNECT`(CONNECT=0.5)。接続があれば、この地区は「ハブ → その辺の交差点」まで配管を持つ。
- **辺の交差点(両端一致の要)**: 共有辺上の座標を pairHash から導く。東辺(隣=dx+1)なら交差点のローカルは `(SIZE, crossFrac*SIZE)`、`crossFrac = pairHash(...別salt) ∈ [0.15,0.85)`。隣セルから見ると同じ辺は西辺で交差点ローカルは `(0, 同じcrossFrac*SIZE)` → **同じワールド点**。南北も同様(交差点は `(crossFrac*SIZE, SIZE)` 等)。
- **経路(L字)**: ハブ `(hx,hy)` → 交差点 `(ex,ey)`。まず水平に `hx→ex`(y=hy)、次に垂直に `hy→ey`(x=ex)。タイルがこのL字の「水平帯(hyを中心に±HALF)」または「垂直帯(exを中心に±HALF)」の内側かを判定。HALF=2(コリドー幅5タイル)。
- `conduitAt` の返り値: `null`(コリドー外) or `{ role: 'floor' | 'inside' | 'vertical' }`。
  - 水平帯: 帯の底行(hy+HALF)= 'floor'、それ以外の帯内 = 'inside'
  - 垂直帯: 中心列(ex)= 'vertical'、それ以外の帯内 = 'inside'
  - L字の角(水平帯と垂直帯の交わり)は 'vertical' を優先(縦移動を保証)

- [ ] **Step 1: 失敗するテストを書く**

`src/world/network.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { conduitAt, districtHub, hasConduit } from './network';
import { regionAt, DISTRICT_SIZE, REGION_SIZE } from './hierarchy';

/** 水系統の region 原点を探す(段階2のヘルパと同様) */
function waterRegionOrigin(seed: number): { rwx: number; rwy: number } {
  for (let r = 0; r < 24; r++) {
    for (const [rx, ry] of [[r, 0], [0, r], [r, -1], [-1, r], [r, r], [-r, r]] as const) {
      if (regionAt(seed, rx * REGION_SIZE, ry * REGION_SIZE).system === 'water') {
        return { rwx: rx * REGION_SIZE, rwy: ry * REGION_SIZE };
      }
    }
  }
  throw new Error('water region が見つからない');
}

describe('districtHub', () => {
  it('決定論、ローカル座標は中央寄り[0.2,0.8)*SIZE', () => {
    const h = districtHub(42, 3, -2);
    expect(districtHub(42, 3, -2)).toEqual(h);
    expect(h.hx).toBeGreaterThanOrEqual(0.2 * DISTRICT_SIZE);
    expect(h.hx).toBeLessThan(0.8 * DISTRICT_SIZE);
    expect(h.hy).toBeGreaterThanOrEqual(0.2 * DISTRICT_SIZE);
    expect(h.hy).toBeLessThan(0.8 * DISTRICT_SIZE);
  });
});

describe('hasConduit(順不同ペア一致)', () => {
  it('A↔B と B↔A で同じ判定(対称)', () => {
    expect(hasConduit(42, 3, 4, 4, 4)).toBe(hasConduit(42, 4, 4, 3, 4));
    expect(hasConduit(42, 0, 0, 0, 1)).toBe(hasConduit(42, 0, 1, 0, 0));
  });
  it('広域で接続あり/なしが両方出る', () => {
    let yes = 0, no = 0;
    for (let i = 0; i < 60; i++) {
      if (hasConduit(42, i, 0, i + 1, 0)) yes++; else no++;
    }
    expect(yes).toBeGreaterThan(0);
    expect(no).toBeGreaterThan(0);
  });
});

describe('conduitAt 両端一致', () => {
  it('地区境界の交差点付近で、両隣から見たコリドーが同一ワールド点で一致する', () => {
    const { rwx, rwy } = waterRegionOrigin(42);
    // 接続のある隣接地区ペアを探す
    let found = false;
    for (let d = 0; d < 30 && !found; d++) {
      const dx = Math.floor(rwx / DISTRICT_SIZE) + d;
      const dy = Math.floor(rwy / DISTRICT_SIZE);
      if (!hasConduit(42, dx, dy, dx + 1, dy)) continue;
      found = true;
      // 共有辺 x = (dx+1)*DISTRICT_SIZE 上の各yで、境界の左右1タイルの conduit 判定が連続していること
      const edgeX = (dx + 1) * DISTRICT_SIZE;
      let meet = 0;
      for (let y = dy * DISTRICT_SIZE; y < (dy + 1) * DISTRICT_SIZE; y++) {
        const left = conduitAt(42, edgeX - 1, y);
        const right = conduitAt(42, edgeX, y);
        if (left && right) meet++; // 辺をまたいでコリドーが途切れない点が存在
      }
      expect(meet).toBeGreaterThan(0);
    }
    expect(found).toBe(true);
  });

  it('決定論', () => {
    expect(conduitAt(42, 5000, -3000)).toEqual(conduitAt(42, 5000, -3000));
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/world/network.test.ts` → FAIL(モジュール未作成)

- [ ] **Step 3: 実装**

`src/world/network.ts`:

```ts
import { hash2 } from './noise';
import { DISTRICT_SIZE } from './hierarchy';

const CONNECT = 0.5;
const HALF = 2; // コリドー半幅(全幅5タイル)

export interface Conduit {
  role: 'floor' | 'inside' | 'vertical';
}

/** 地区ハブ(ローカル座標 [0.2,0.8)*SIZE) */
export function districtHub(seed: number, dx: number, dy: number): { hx: number; hy: number } {
  const hx = (0.2 + 0.6 * hash2(seed + 51000, dx, dy)) * DISTRICT_SIZE;
  const hy = (0.2 + 0.6 * hash2(seed + 52000, dx, dy)) * DISTRICT_SIZE;
  return { hx, hy };
}

/** 順不同ペアで接続有無を判定(対称) */
export function hasConduit(seed: number, ax: number, ay: number, bx: number, by: number): boolean {
  // 正規化: 辞書順で小さい方を先に
  const [px, py, qx, qy] = (ax < bx || (ax === bx && ay <= by))
    ? [ax, ay, bx, by] : [bx, by, ax, ay];
  return hash2(seed + 53000, px * 73856093 + py, qx * 19349663 + qy) < CONNECT;
}

/** 共有辺の交差点フラクション(両端一致。順不同ペアから導く) */
function crossFrac(seed: number, ax: number, ay: number, bx: number, by: number): number {
  const [px, py, qx, qy] = (ax < bx || (ax === bx && ay <= by))
    ? [ax, ay, bx, by] : [bx, by, ax, ay];
  return 0.15 + 0.7 * hash2(seed + 54000, px * 73856093 + py, qx * 19349663 + qy);
}

/** 点(px,py)が線分帯[(x1,y)〜(x2,y)]の水平帯(±HALF)内か。返り値: 帯内なら底行判定用のdy差 */
function inHBand(px: number, py: number, x1: number, x2: number, y: number): boolean {
  const lo = Math.min(x1, x2), hi = Math.max(x1, x2);
  return px >= lo && px <= hi && Math.abs(py - y) <= HALF;
}
function inVBand(px: number, py: number, y1: number, y2: number, x: number): boolean {
  const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
  return py >= lo && py <= hi && Math.abs(px - x) <= HALF;
}

/**
 * タイルが配管コリドー上か。各地区は自分のハブ→各接続辺の交差点までL字で配管を持つ。
 * 純粋・決定論・チャンク局所(自地区+4隣接の存在ビットのみ参照)。
 */
export function conduitAt(seed: number, x: number, y: number): Conduit | null {
  const dx = Math.floor(x / DISTRICT_SIZE);
  const dy = Math.floor(y / DISTRICT_SIZE);
  const lx = x - dx * DISTRICT_SIZE;
  const ly = y - dy * DISTRICT_SIZE;
  const { hx, hy } = districtHub(seed, dx, dy);

  // 4辺の交差点(ローカル)。接続がある辺だけ
  const edges: { ex: number; ey: number }[] = [];
  if (hasConduit(seed, dx, dy, dx + 1, dy)) edges.push({ ex: DISTRICT_SIZE, ey: crossFrac(seed, dx, dy, dx + 1, dy) * DISTRICT_SIZE });
  if (hasConduit(seed, dx, dy, dx - 1, dy)) edges.push({ ex: 0, ey: crossFrac(seed, dx, dy, dx - 1, dy) * DISTRICT_SIZE });
  if (hasConduit(seed, dx, dy, dx, dy + 1)) edges.push({ ex: crossFrac(seed, dx, dy, dx, dy + 1) * DISTRICT_SIZE, ey: DISTRICT_SIZE });
  if (hasConduit(seed, dx, dy, dx, dy - 1)) edges.push({ ex: crossFrac(seed, dx, dy, dx, dy - 1) * DISTRICT_SIZE, ey: 0 });

  let onVertical = false;
  let onHorizontal = false;
  for (const { ex, ey } of edges) {
    // L字: 水平 hx→ex (y=hy)、垂直 hy→ey (x=ex)
    if (inHBand(lx, ly, hx, ex, hy)) onHorizontal = true;
    if (inVBand(lx, ly, hy, ey, ex)) onVertical = true;
  }
  if (!onVertical && !onHorizontal) return null;

  // 役割判定: 縦帯優先(角も縦=梯子で連結)。水平帯は底行がfloor。
  if (onVertical) {
    // 縦帯の中心列(いずれかの ex に一致)なら vertical、そうでなければ inside
    for (const { ex } of edges) {
      if (Math.abs(lx - ex) < 1) return { role: 'vertical' };
    }
    return { role: 'inside' };
  }
  // 水平帯のみ: 底行(hy+HALF)が floor
  if (Math.abs(ly - (hy + HALF)) < 1) return { role: 'floor' };
  return { role: 'inside' };
}
```

- [ ] **Step 4: 通過を確認**

Run: `npx vitest run src/world/network.test.ts` → PASS。`npm test` → 全PASS。`npx tsc --noEmit` クリーン
両端一致テストが落ちたら、`crossFrac` と辺交差点の座標(東辺=(SIZE,f*SIZE) / 隣の西辺=(0,同f*SIZE))が同一ワールド点になっているか、HALF帯が辺をまたいで重なるかを、対象ペアの数値を出力して確認する(閾値やテストを弱めない)。

- [ ] **Step 5: コミット**

```bash
git add src/world/network.ts src/world/network.test.ts
git commit -m "feat: ネットワーク経路判定(両端一致・チャンク局所)"
```

---

### Task 2: コリドーのタイル化+tileAt統合(水系統のみ)

**Files:**
- Modify: `src/world/network.ts`(`networkTileAt` 追加)
- Modify: `src/world/worldgen.ts`(合成に network を追加)
- Test: `src/world/network.test.ts`(追記)

- [ ] **Step 1: 失敗するテストを追記**

`src/world/network.test.ts` に追記:

```ts
import { networkTileAt } from './network';
import { TILE } from './tiles';

describe('networkTileAt', () => {
  it('水系統でない region では null(段階3スコープ)', () => {
    // 非水 region を探す
    for (let r = 0; r < 24; r++) {
      const wx = r * REGION_SIZE;
      if (regionAt(42, wx, 0).system !== 'water') {
        // conduit があってもなくても、水以外は null
        expect(networkTileAt(42, wx + 500, 500)).toBeNull();
        return;
      }
    }
  });

  it('水系統のコリドー上は floor→SOLID / vertical→LADDER / inside→AIR、外はnull', () => {
    const { rwx, rwy } = waterRegionOrigin(42);
    // conduit を持つ地区を探し、その中でコリドー上タイルの種別が正しい
    const kinds = new Set<number | null>();
    const bx = Math.floor(rwx / DISTRICT_SIZE), by = Math.floor(rwy / DISTRICT_SIZE);
    for (let dyi = 0; dyi < 8; dyi++) {
      for (let dxi = 0; dxi < 8; dxi++) {
        const dx = bx + dxi, dy = by + dyi;
        for (let ly = 0; ly < DISTRICT_SIZE; ly += 3) {
          for (let lx = 0; lx < DISTRICT_SIZE; lx += 3) {
            const c = conduitAt(42, dx * DISTRICT_SIZE + lx, dy * DISTRICT_SIZE + ly);
            const t = networkTileAt(42, dx * DISTRICT_SIZE + lx, dy * DISTRICT_SIZE + ly);
            if (!c) continue;
            if (c.role === 'floor') expect(t).toBe(TILE.SOLID);
            if (c.role === 'vertical') expect(t).toBe(TILE.LADDER);
            if (c.role === 'inside') expect(t).toBe(TILE.AIR);
            if (t !== null) kinds.add(t);
          }
        }
      }
    }
    expect(kinds.has(TILE.SOLID)).toBe(true);
    expect(kinds.has(TILE.LADDER)).toBe(true);
    expect(kinds.has(TILE.AIR)).toBe(true);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/world/network.test.ts` → FAIL(`networkTileAt` 未定義)

- [ ] **Step 3: 実装**

`network.ts` に追記(import に regionAt, TILE, Tile を追加):

```ts
import { regionAt } from './hierarchy';
import { TILE, type Tile } from './tiles';

/** コリドーのタイル化。水系統のみ。該当しなければ null */
export function networkTileAt(seed: number, x: number, y: number): Tile | null {
  if (regionAt(seed, x, y).system !== 'water') return null;
  const c = conduitAt(seed, x, y);
  if (!c) return null;
  if (c.role === 'vertical') return TILE.LADDER;
  if (c.role === 'floor') return TILE.SOLID;
  return TILE.AIR; // inside
}
```

`worldgen.ts` の合成を更新(施設 ?? ネットワーク ?? ノイズ):

```ts
import { networkTileAt } from './network';
// ...
export function tileAt(seed: number, x: number, y: number): Tile {
  const base = noiseTileAt(seed, x, y);
  if (base === TILE.LADDER) return base;
  const overlay = facilityTileAt(seed, x, y) ?? networkTileAt(seed, x, y);
  return overlay ?? base;
}
```

循環import注意: network.ts は hierarchy/noise/tiles のみ import(worldgen を import しない)。worldgen が network を import。

- [ ] **Step 4: 通過を確認**

Run: `npx vitest run src/world/network.test.ts` → PASS。`npm test` → 全PASS(既存の worldgen 梯子分断・決定論テストは回帰なし: network もノイズ LADDER を上書きしない=合成順で base===LADDER が先に return)。`npx tsc --noEmit` クリーン

- [ ] **Step 5: コミット**

```bash
git add src/world/network.ts src/world/worldgen.ts src/world/network.test.ts
git commit -m "feat: コリドーのタイル化とtileAt統合(水系統の枝配管)"
```

---

### Task 3: 配管decorと目視(配管をたどると隣へ)

**Files:**
- Modify: `src/render/decor.ts` または `src/world/network.ts`(配管の見た目)
- Test: 目視(スクショ)

段階3の目的の確認: コリドーが「配管の通路」に見え、歩いて隣の地区(施設)へたどれること。タイル自体(SOLID床/AIR/LADDER)は既に出るので、ここでは**配管らしいdecorアクセント**を足し、目視で「たどれる」ことを確認する。

- [ ] **Step 1: 配管decorを足す(最小)**

コリドーの水平帯の上部に太い配管ライン、垂直帯にケーブル/管——を decor で描く。既存の decor パイプラインが chunkbake 内で `decorateChunk` を使っている構造に合わせ、**過剰に作り込まず**、コリドー沿いに配管の線が乗る程度でよい。実装の置き場所は実装者判断(decor.ts にコリドー検出を足す、or chunkbake で networkTileAt を見てアクセントを重ねる)。ゲームプレイ(tileAt)は変えない=見た目だけ。

方針: chunkbake の焼き込み時、各タイルで `conduitAt` が非nullなら、床の上に配管ライン(既存の PALETTE.pipe 系の色)を1本引く。水系統のみ。

- [ ] **Step 2: 型チェック+テスト**

Run: `npm test && npx tsc --noEmit`
Expected: 全PASS(decorは描画層なのでロジックテストは不要。既存回帰なし)

- [ ] **Step 3: 目視 — 配管をたどる**

水系統の conduit を持つ地区を特定して撮る。使い捨ての vitest テストで seed 20260711 と 42 の「water region 内で conduitAt が非nullになるワールド座標」を1つ print → メモ → 削除。その座標へ寄って通常描画で撮る:
```
node scripts/screenshot.mjs --seed=<S> --pos=<conduitX>,<conduitY> --out=screenshots/s3-conduit.png
```
さらに階層マップでコリドーの伸びる方向を見つつ、隣地区の施設方向へ数百タイルずらして数枚撮り、**配管コリドーが地区境界をまたいで連続し、キャットウォーク床と梯子で歩いてたどれる**ことを確認:
```
node scripts/screenshot.mjs --seed=<S> --pos=<+500,同y> --out=screenshots/s3-follow.png
```
PNGをReadで確認: 水平のキャットウォーク通路(床+配管ライン)と、L字の角で縦の梯子、地区境界で途切れず隣へ続く。周囲はノイズ躯体。「配管をたどって施設から施設へ移動できる」画になっているか。

- [ ] **Step 4: コミット**

```bash
git add -A
git commit -m "feat: 配管コリドーのdecorと目視確認(段階3)"
```

---

### Task 4: 段階3の最終確認

- [ ] **Step 1: 全テスト・型・ビルド**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: 全PASS、ビルド成功

- [ ] **Step 2: 到達可能性・両端一致の総合目視**

コリドーが地区境界で継ぎ目なく連続し、キャットウォーク+梯子で歩き通せること、ノイズ梯子が保持されていること(既存の上昇保証)を複数座標で確認。

- [ ] **Step 3: 未コミット変更があればコミット**

---

## この計画のスコープ外(次段階)
- 段階4: 全系統の施設タイプ+セクター幹線(トランク)+因果(発電→電線→ポンプ)、地域バイオーム化
- 段階5: セクター遠景シルエット、稀少ランドマーク、水面など施設decor、総合チューニング
- 段階3は「水系統・地区レベルの枝配管を歩いてたどれる」縦スライス。電線・セクター幹線・因果は段階4。

## 留意
- 両端一致は「各セルが自分の半分だけ描き、共有辺の交差点を順不同ペアハッシュで一致させる」ことで構造的に保証。クロスセル経路探索はしない(局所性維持)。
- コリドーがノイズ躯体を貫くので、コリドー沿いは歩けるが、コリドーとノイズ地形の交差部で見た目の不整合が出うる。段階3では許容し、段階5のチューニングで均す。
- 到達可能性: コリドー内はキャットウォーク+L字角の梯子で縦横に移動可。ノイズ梯子も保持。完全な全域保証は段階4-5+重力子砲(将来)。
