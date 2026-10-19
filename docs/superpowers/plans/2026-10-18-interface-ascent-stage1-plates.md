# 階層界面登攀 段階1「界面と孔」実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 景観セル境界ごとに破壊不能の界面(板)を置き、孔・前室・見晴らし台・大穴を通る唯一の登攀経路を決定論で生成し、開始地点を前室の中に移す。

**Architecture:** 新タイル `TILE.HARD` と `isSolid()` 述語を導入し、物理・開放度・焼き込み・装飾は「SOLID か HARD」で固体判定する。界面の幾何は純粋関数モジュール `src/world/interface.ts` に閉じ込め、`tileAt` はそれを最優先のオーバーレイとして合成する。前室・圧縮帯は `noiseTileAt` のパラメータ(空洞閾値・質量閾値・梯子抑止・底の床)を座標で変調する形で実現し、物理は述語 1 箇所以外変更しない。絵はこの段階では仮(既存アトラス + 暗幕)でよい。

**Tech Stack:** TypeScript 5.7, Canvas 2D, Vitest 3, Vite 6, Playwright screenshot script

**Spec:** `docs/superpowers/specs/2026-10-18-blame-sim-interface-ascent-design.md`(§5 ワールド生成、§8 テスト方針、§9 段階1)

## Global Constraints

- 界面の上面 Y は `biomeBoundary(seed, cell)`。板は `[top, top + thickness)` を占める(Y は下向き正)。
- 厚みは通常 32、大界面(`mod(cell, 4) === 2`、正規化剰余)は 96。cell 0 は通常界面。
- 孔はスロット幅 384、揺らぎ ±64。隣接孔の間隔は 256〜512、任意の X から最寄りの孔まで ≤ 256。
- 孔の縦坑は幅 3(大界面 5)。中央列 `LADDER`、両脇 `AIR`。梯子は `top − 4` から前室の底の 1 段上まで連続。
- 前室: 孔 X ±120、板の下面から 48 タイル、強制空洞(床帯は 4 帯に 1 本)。外縁 40 タイルで通常地形へ線形に戻す。底の行(下面 + 48)は X ±120 の連続した `SOLID` 床。
- 圧縮帯: 前室の底の下 60 タイル、X ±120 で `massThreshold − 0.15`。
- 既存の 32 タイルごとの梯子列は、板の中と前室の内側(底より上)では消し、それ以外では残す。板の上の見晴らし台空間は通す。
- 見晴らし台: X が孔 −12 〜 +72、Y が `[top − 8, top)` を空気にする。大穴: X が孔 +24 〜 +72、Y が `[top − 4, bottom + 4)` を空気にする。
- `HARD` は `Destruction.bore` で破壊されない。物理・開放度では `SOLID` と同じ扱い。
- 同じシード・座標から同じ結果(決定論)。`physics.ts` の変更は固体述語 1 箇所のみ。新規依存なし。
- 既定シード `20260711` を変えない。

## Review Focus

1. **板の上面に立った状態から上へ行けない** — 板の上は cell−1 の通常地形。32 タイルごとの梯子列が板の上面(`top − 1`)から上へ続くことを Task 5 の到達性テストで確認する(見晴らし台空間の梯子列保持)。
2. **大穴へ落ちて前室の床に着地できない** — 大穴の真下は前室(±120 の内側)なので底の連続床がある。Task 4 のテストで大穴 X 範囲の底の行が `SOLID` であることを確認する。
3. **メガ施設・施設の壁が孔の梯子や見晴らし台を塞ぐ** — 界面オーバーレイは最優先なので塞がれない。Task 4 の `tileAt` 優先順位テストで、施設領域と重なる座標でも界面タイルが勝つことを確認する。
4. **前室の床帯の欠落で底まで落ちる経路しかない** — 設計どおり(落下の罰なし)。ただし底の行自体に欠落があってはならない。Task 4 で床欠落ハッシュに関係なく底の行が `SOLID`/`LADDER` であることを確認する。
5. **焼き込みで `HARD` が描かれず透明になる** — ブロブ描画と後退内面の判定を `isSolid` に変える。Task 1 のユニットテストに加え、Task 6 のスクリーンショットで板が暗い面として見えることを目視する。

## File Structure

- Modify `src/world/tiles.ts`: `TILE.HARD = 3` と `isSolid(t)`。
- Create `src/world/tiles.test.ts`: 述語のテスト。
- Modify `src/entities/physics.ts`: `solidInRange` を `isSolid` に。
- Modify `src/core/zoom.ts`: 開放度の閉塞判定を `isSolid` に。
- Modify `src/world/destruction.ts`: `bore` が `HARD` を記録しない。
- Modify `src/render/chunkbake.ts`, `src/render/decor.ts`: 固体判定を `isSolid` に。`HARD` の仮の暗幕。
- Create `src/world/interface.ts`: 界面の定数、幾何、`interfaceTileAt`、`terrainModsAt`、`groupLadderX`。
- Create `src/world/interface.test.ts`: 幾何・タイル・変調のテスト。
- Modify `src/world/worldgen.ts`: `noiseTileAt` の変調、`tileAt` の優先順位、`findSpawn`。
- Modify `src/world/worldgen.test.ts`: 界面前提に合わせた不変条件の更新と到達性テスト。

---

### Task 1: `TILE.HARD` と固体述語

**Files:**
- Modify: `src/world/tiles.ts`
- Create: `src/world/tiles.test.ts`
- Modify: `src/entities/physics.ts:20-30`(`solidInRange`)
- Modify: `src/core/zoom.ts:43`
- Modify: `src/world/destruction.ts:60-80`(`bore`)
- Modify: `src/render/chunkbake.ts:272-281, 301-306, 418-424`
- Modify: `src/render/decor.ts:148, 159`
- Test: `src/entities/physics.test.ts`, `src/core/zoom.test.ts`, `src/world/destruction.test.ts`

**Interfaces:**
- Produces: `TILE.HARD: 3`、`isSolid(t: number): boolean`(`SOLID` または `HARD` で true)。

- [ ] **Step 1: 失敗するテストを書く**

`src/world/tiles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TILE, isSolid } from './tiles';

describe('isSolid', () => {
  it('SOLID と HARD だけが固体', () => {
    expect(TILE.HARD).toBe(3);
    expect(isSolid(TILE.SOLID)).toBe(true);
    expect(isSolid(TILE.HARD)).toBe(true);
    expect(isSolid(TILE.AIR)).toBe(false);
    expect(isSolid(TILE.LADDER)).toBe(false);
  });
});
```

`src/entities/physics.test.ts` に追加(既存の `moveBody` テストと同じ流儀で):

```ts
it('HARD は SOLID と同じく衝突する(床として立てる)', () => {
  const tiles = (x: number, y: number) => (y === 5 ? TILE.HARD : TILE.AIR);
  const body = { x: 0.1, y: 3, w: 0.75, h: 1.75, vx: 0, vy: 10, onGround: false };
  moveBody(body, 1 / 60, tiles);
  for (let i = 0; i < 60; i++) { body.vy += 30 / 60; moveBody(body, 1 / 60, tiles); }
  expect(body.onGround).toBe(true);
  expect(body.y + body.h).toBeCloseTo(5, 5);
});
```

`src/core/zoom.test.ts` に追加:

```ts
it('HARD は閉塞として数える', () => {
  const all = (t: number) => sampleOpenness(() => t as Tile, 0, 0, 2, 1);
  expect(all(TILE.HARD)).toBe(0);
  expect(all(TILE.AIR)).toBe(1);
});
```

`src/world/destruction.test.ts` に追加:

```ts
it('bore は HARD を破壊しない(SOLID は破壊する)', () => {
  const d = new Destruction();
  const tiles = (x: number, y: number): Tile => (y === 5 ? (x < 10 ? TILE.SOLID : TILE.HARD) : TILE.AIR);
  d.bore(0, 5, 0, 20, 0, tiles);
  expect(d.isDestroyed(3, 5)).toBe(true);
  expect(d.isDestroyed(15, 5)).toBe(false);
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/world/tiles.test.ts src/entities/physics.test.ts src/core/zoom.test.ts src/world/destruction.test.ts`
Expected: FAIL(`isSolid` 未定義、`TILE.HARD` 未定義)

- [ ] **Step 3: 実装**

- `tiles.ts`: `HARD: 3` を追加し、`export function isSolid(t: number): boolean`。
- `physics.ts` の `solidInRange`: `tiles(tx, ty) === TILE.SOLID` → `isSolid(tiles(tx, ty))`。
- `zoom.ts`: `tileAt(x, y) !== TILE.SOLID` → `!isSolid(tileAt(x, y))`。
- `destruction.ts` の `bore`: `if (tiles(wx, wy) === TILE.AIR) continue;` の直後に `HARD` も `continue`(未生成 `undefined` は従来どおり記録)。
- `chunkbake.ts`: ブロブ描画パス(272〜281 行)と後退内面パス(301〜306 行)の自タイル判定・8 近傍判定を `isSolid(...)` / `!isSolid(...)` に置き換える(板が描かれ、板に接する鋼の縁も正しく閉じる)。水面判定の `around(tx, ty+1) !== TILE.SOLID` も `!isSolid` に。痕跡パス(418〜424 行)は `here === TILE.SOLID` のまま(板には痕跡を置かない)が、左右の面判定は `!isSolid` にする。後退内面パスの直後に、`HARD` タイルへ `rgba(0,0,0,0.5)` の矩形を重ねる仮の暗幕を 1 パス追加する(段階2で超構造体材パレットに置き換える前提のコメントを付ける)。
- `decor.ts`: 近傍用の `solid` ヘルパーは `isSolid` に変える(板に接する鋼の面を正しく判定する)。メインループの `if (tile !== TILE.SOLID) continue;` は据え置き(板そのものには装飾を置かない)。

- [ ] **Step 4: テスト・型チェック**

Run: `npx vitest run && npx tsc --noEmit`
Expected: すべて PASS

- [ ] **Step 5: コミット**

```bash
git add src/world/tiles.ts src/world/tiles.test.ts src/entities/physics.ts src/entities/physics.test.ts src/core/zoom.ts src/core/zoom.test.ts src/world/destruction.ts src/world/destruction.test.ts src/render/chunkbake.ts src/render/decor.ts
git commit -m "feat: add indestructible HARD tile and isSolid predicate"
```

---

### Task 2: 界面の幾何(位置・厚み・孔)

**Files:**
- Create: `src/world/interface.ts`
- Create: `src/world/interface.test.ts`

**Interfaces:**
- Consumes: `biomeBoundary(seed, cell)` from `src/world/biomeCells.ts`、`hash2` from `src/world/noise.ts`。
- Produces:
  - 定数 `INTERFACE_THICKNESS = 32`, `GREAT_INTERFACE_THICKNESS = 96`, `PASSAGE_SLOT = 384`, `PASSAGE_JITTER = 64`, `PASSAGE_HALF = 1`, `GREAT_PASSAGE_HALF = 2`, `SHAFT_OVERHANG = 4`, `OVERLOOK_LEFT = 12`, `OVERLOOK_RIGHT = 72`, `OVERLOOK_HEIGHT = 8`, `HOLE_OFFSET = 24`, `HOLE_WIDTH = 48`, `ANTECHAMBER_HALF_WIDTH = 120`, `ANTECHAMBER_DEPTH = 48`, `ANTECHAMBER_FADE = 40`, `COMPRESSION_DEPTH = 60`, `COMPRESSION_MASS_DROP = 0.15`
  - `mod(n: number, m: number): number`(正規化剰余)
  - `isGreatInterface(cell: number): boolean`
  - `interfaceThickness(cell: number): number`
  - `interfaceTop(seed: number, cell: number): number`(= `biomeBoundary`)
  - `interfaceBottom(seed: number, cell: number): number`(= top + thickness、排他的)
  - `passageX(seed: number, cell: number, k: number): number`(= `k * 384 + 192 + jitter`、jitter は `hash2(seed + 7001, cell, k)` から `[-64, 64]` の整数)
  - `nearestPassage(seed: number, cell: number, x: number): { k: number; x: number }`
  - `groupLadderX(seed: number, x: number): number`(worldgen の 32 タイル梯子列の式をここへ移す: `group * 32 + floor(hash2(seed + 404, group, 0) * 32)`)

- [ ] **Step 1: 失敗するテストを書く**

`src/world/interface.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { biomeBoundary } from './biomeCells';
import {
  interfaceBottom, interfaceThickness, interfaceTop, isGreatInterface, mod,
  nearestPassage, passageX, PASSAGE_SLOT,
} from './interface';

const seeds = [1, 42, 20260711];

describe('interface geometry', () => {
  it('mod は負数でも非負', () => {
    expect(mod(-1, 4)).toBe(3);
    expect(mod(-6, 4)).toBe(2);
  });
  it('大界面は mod(cell,4)===2 だけ。cell 0 は通常', () => {
    expect(isGreatInterface(0)).toBe(false);
    expect(isGreatInterface(2)).toBe(true);
    expect(isGreatInterface(-2)).toBe(true);
    expect(interfaceThickness(0)).toBe(32);
    expect(interfaceThickness(2)).toBe(96);
  });
  it('上面は景観セル境界、下面は上面+厚み', () => {
    for (const seed of seeds) for (let cell = -5; cell <= 5; cell++) {
      expect(interfaceTop(seed, cell)).toBe(biomeBoundary(seed, cell));
      expect(interfaceBottom(seed, cell) - interfaceTop(seed, cell)).toBe(interfaceThickness(cell));
    }
  });
  it('孔の間隔は 256〜512、最寄りまで 256 以内', () => {
    for (const seed of seeds) for (let cell = -5; cell <= 5; cell++) {
      for (let k = -20; k < 20; k++) {
        const d = passageX(seed, cell, k + 1) - passageX(seed, cell, k);
        expect(d).toBeGreaterThanOrEqual(256);
        expect(d).toBeLessThanOrEqual(512);
        const px = passageX(seed, cell, k);
        expect(Math.abs(px - (k * PASSAGE_SLOT + PASSAGE_SLOT / 2))).toBeLessThanOrEqual(64);
      }
      for (let x = -3000; x <= 3000; x += 37) {
        const n = nearestPassage(seed, cell, x);
        expect(Math.abs(n.x - x)).toBeLessThanOrEqual(256);
        expect(passageX(seed, cell, n.k)).toBe(n.x);
      }
    }
  });
  it('決定論: 同入力同出力、シード差で変わる', () => {
    expect(passageX(42, 1, 3)).toBe(passageX(42, 1, 3));
    expect([passageX(1, 1, 3), passageX(2, 1, 3), passageX(3, 1, 3)].some((v) => v !== passageX(1, 1, 3))).toBe(true);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/world/interface.test.ts`
Expected: FAIL(モジュールなし)

- [ ] **Step 3: `src/world/interface.ts` に上記の定数と関数を実装**

`nearestPassage` は `k0 = floor(x / 384)` を中心に `k0 − 1 .. k0 + 1` の 3 候補から最小距離を選ぶ。

- [ ] **Step 4: 成功を確認**

Run: `npx vitest run src/world/interface.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/world/interface.ts src/world/interface.test.ts
git commit -m "feat: interface plate geometry and passage slots"
```

---

### Task 3: 界面タイル(板・縦坑・見晴らし台・大穴)

**Files:**
- Modify: `src/world/interface.ts`
- Modify: `src/world/interface.test.ts`

**Interfaces:**
- Consumes: Task 2 の幾何、`biomeCellAt(seed, y)`、`TILE`。
- Produces: `interfaceTileAt(seed: number, x: number, y: number): Tile | null`。
  - 判定対象の cell は `c = biomeCellAt(seed, y)` と `c + 1`(`c + 1` の板の上の見晴らし台・はみ出しは cell `c` の領域にある)。
  - 優先順位: 孔の梯子列 > 大穴 > 見晴らし台 > 縦坑の脇 > 板 > `null`。
  - 孔の梯子列: `x === px` かつ `top − 4 ≤ y < bottom + 48` → `LADDER`。
  - 大穴: `px + 24 ≤ x < px + 72` かつ `top − 4 ≤ y < bottom + 4` → `AIR`。ただし `y < top` で `x === groupLadderX(seed, x)` なら `LADDER`(板の上の梯子列は切らない)。
  - 見晴らし台: `px − 12 ≤ x < px + 72` かつ `top − 8 ≤ y < top` → `x === groupLadderX(seed, x)` なら `LADDER`、それ以外 `AIR`。
  - 縦坑の脇: `|x − px| ≤ half` かつ `top ≤ y < bottom` → `AIR`。大界面では踊り場の行(`top + round(T/3)`, `top + round(2T/3)`)だけ `HARD`。
  - 板: `top ≤ y < bottom` → `HARD`。
  - いずれでもなければ `null`。

- [ ] **Step 1: 失敗するテストを書く**

`src/world/interface.test.ts` に追加:

```ts
import { TILE } from './tiles';
import { groupLadderX, interfaceTileAt, ANTECHAMBER_DEPTH } from './interface';

describe('interfaceTileAt', () => {
  const cases = seeds.flatMap((seed) => [-3, -2, 0, 1, 2].flatMap((cell) => [-2, 0, 3].map((k) => ({ seed, cell, k }))));
  it('板は HARD、孔の梯子は上端-4から前室の底の1段上まで LADDER', () => {
    for (const { seed, cell, k } of cases) {
      const top = interfaceTop(seed, cell), bottom = interfaceBottom(seed, cell);
      const px = passageX(seed, cell, k);
      for (let y = top - 4; y < bottom + ANTECHAMBER_DEPTH; y++) expect(interfaceTileAt(seed, px, y)).toBe(TILE.LADDER);
      expect(interfaceTileAt(seed, px, top - 5)).toBe(null);
      expect(interfaceTileAt(seed, px, bottom + ANTECHAMBER_DEPTH)).toBe(null);
      for (let y = top; y < bottom; y++) expect(interfaceTileAt(seed, px - 100, y)).toBe(TILE.HARD);
      expect(interfaceTileAt(seed, px - 100, top - 1)).toBe(null);
      expect(interfaceTileAt(seed, px - 100, bottom)).toBe(null);
    }
  });
  it('縦坑の脇は AIR(通常幅3・大界面幅5)、大界面は踊り場の行が HARD', () => {
    const seed = 42;
    const px0 = passageX(seed, 0, 0), top0 = interfaceTop(seed, 0);
    expect(interfaceTileAt(seed, px0 + 1, top0 + 5)).toBe(TILE.AIR);
    expect(interfaceTileAt(seed, px0 + 2, top0 + 5)).toBe(TILE.HARD);
    const px2 = passageX(seed, 2, 0), top2 = interfaceTop(seed, 2);
    expect(interfaceTileAt(seed, px2 + 2, top2 + 5)).toBe(TILE.AIR);
    expect(interfaceTileAt(seed, px2 + 3, top2 + 5)).toBe(TILE.HARD);
    expect(interfaceTileAt(seed, px2 + 2, top2 + 32)).toBe(TILE.HARD);
    expect(interfaceTileAt(seed, px2, top2 + 32)).toBe(TILE.LADDER);
  });
  it('見晴らし台は板の上 8 行が空気、大穴は板を貫通、梯子列は板の上で残る', () => {
    for (const { seed, cell, k } of cases) {
      const top = interfaceTop(seed, cell), bottom = interfaceBottom(seed, cell);
      const px = passageX(seed, cell, k);
      for (let x = px - 12; x < px + 72; x++) for (let y = top - 8; y < top; y++) {
        const t = interfaceTileAt(seed, x, y);
        expect(t === TILE.AIR || t === TILE.LADDER).toBe(true);
        if (x === groupLadderX(seed, x) && x !== px) expect(t).toBe(TILE.LADDER);
      }
      for (let x = px + 24; x < px + 72; x++) for (let y = top; y < bottom + 4; y++) expect(interfaceTileAt(seed, x, y)).toBe(TILE.AIR);
      for (let x = px - 12; x < px + 24; x++) if (x !== px) expect(interfaceTileAt(seed, x, top)).toBe(TILE.HARD);
      expect(interfaceTileAt(seed, px - 13, top - 1)).toBe(null);
    }
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/world/interface.test.ts`
Expected: FAIL(`interfaceTileAt` 未定義)

- [ ] **Step 3: `interfaceTileAt` を実装**

cell 候補ごとに `top/bottom/px(nearestPassage で x に最も近い k)` を求め、上の優先順位で判定する。最寄り孔は 1 つだが、大穴・見晴らし台は右側へ 72 伸びるので、`nearestPassage(seed, cell, x − 30)` も候補に含め、両方で判定する(孔間隔 ≥ 256 なので 2 候補で足りる)。

- [ ] **Step 4: 成功を確認**

Run: `npx vitest run src/world/interface.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/world/interface.ts src/world/interface.test.ts
git commit -m "feat: interface plate tiles with passage shaft, overlook and drop hole"
```

---

### Task 4: 前室・圧縮帯の地形変調と `tileAt` の合成

**Files:**
- Modify: `src/world/interface.ts`
- Modify: `src/world/interface.test.ts`
- Modify: `src/world/worldgen.ts:16-50, 55-66`
- Modify: `src/world/worldgen.test.ts:119-137, 174-197, 241-275, 284-299`

**Interfaces:**
- Consumes: Task 2・3 の全エクスポート、`terrainProfileFor`。
- Produces:
  - `interface TerrainMods { cavityScale: number; massDrop: number; suppressLadder: boolean; forceFloor: boolean }`
  - `terrainModsAt(seed: number, x: number, y: number, cell?: number): TerrainMods | null`
    - `bottom = interfaceBottom(seed, cell)`、`px = nearestPassage(seed, cell, x).x`、`dx = |x − px|`、`dy = y − bottom`。
    - `0 ≤ dy < 48`: `fade = clamp01((120 + 40 − dx) / 40)`。`fade === 0` なら `null`。`{ cavityScale: 1 − fade, massDrop: 0, suppressLadder: fade >= 1, forceFloor: false }`。
    - `dy === 48` かつ `dx ≤ 120`: `{ cavityScale: 1, massDrop: 0, suppressLadder: false, forceFloor: true }`。
    - `48 < dy ≤ 108` かつ `dx ≤ 120`: `{ cavityScale: 1, massDrop: 0.15, suppressLadder: false, forceFloor: false }`。
    - それ以外 `null`。
  - `noiseTileAt` の変更: 梯子列は `groupLadderX` を使い、`mods?.suppressLadder` なら梯子にしない。梯子判定の直後に `mods?.forceFloor` なら `SOLID`。空洞閾値は `profile.cavityThreshold * (mods?.cavityScale ?? 1)`、質量閾値は `profile.massThreshold − (mods?.massDrop ?? 0)`。
  - `noiseTileAt(seed, x, y)` は公開シグネチャを保ち、内部で `mods = terrainModsAt(seed, x, y, cell)` を求めて `noiseTileWith(seed, x, y, cell, mods)`(非公開)に委譲する。
  - `tileAt` の変更: 先頭で `interfaceTileAt` を評価し、非 `null` ならそれを返す。次に `mods = terrainModsAt(seed, x, y)` を求め、`mods?.suppressLadder`(前室の内側)なら施設・メガ施設・幹線・導管のオーバーレイを**適用せず**にノイズ躯体をそのまま返す(前室の空洞を施設の壁で埋めない。§5.6 の優先順位)。それ以外は従来どおり(ノイズ `LADDER` 保持 → オーバーレイ)。

- [ ] **Step 1: 失敗するテストを書く**

`src/world/interface.test.ts` に追加:

```ts
import { terrainModsAt } from './interface';

describe('terrainModsAt', () => {
  it('前室の内側は強制空洞+梯子抑止、縁で線形に戻り、底は床、下は圧縮', () => {
    const seed = 42, cell = 0;
    const bottom = interfaceBottom(seed, cell), px = passageX(seed, cell, 0);
    expect(terrainModsAt(seed, px + 50, bottom + 10, cell)).toEqual({ cavityScale: 0, massDrop: 0, suppressLadder: true, forceFloor: false });
    expect(terrainModsAt(seed, px + 140, bottom + 10, cell)!.cavityScale).toBeCloseTo(0.5, 5);
    expect(terrainModsAt(seed, px + 140, bottom + 10, cell)!.suppressLadder).toBe(false);
    expect(terrainModsAt(seed, px + 160, bottom + 10, cell)).toBe(null);
    expect(terrainModsAt(seed, px - 120, bottom + 48, cell)!.forceFloor).toBe(true);
    expect(terrainModsAt(seed, px, bottom + 80, cell)!.massDrop).toBeCloseTo(0.15, 5);
    expect(terrainModsAt(seed, px, bottom + 109, cell)).toBe(null);
    expect(terrainModsAt(seed, px, bottom - 1, cell)).toBe(null);
  });
});
```

`src/world/worldgen.test.ts` に新しい describe を追加:

```ts
import { ANTECHAMBER_DEPTH, interfaceBottom, interfaceTileAt, interfaceTop, passageX, terrainModsAt } from './interface';
import { megaFacilityAt } from './megafacility';

describe('界面と前室の合成', () => {
  const seeds = [1, 42, 20260711];
  it('tileAt は界面タイルを最優先にする(施設・メガ施設の上でも)', () => {
    for (const seed of seeds) for (let cell = -4; cell <= 4; cell++) {
      const top = interfaceTop(seed, cell);
      for (let x = -2000; x <= 2000; x += 97) {
        const iface = interfaceTileAt(seed, x, top + 3);
        expect(iface).not.toBe(null);
        expect(tileAt(seed, x, top + 3)).toBe(iface);
      }
    }
  });
  it('前室の底は連続した床(梯子列は通す)、前室の内側に梯子列も施設の壁もない', () => {
    for (const seed of seeds) for (let cell = -2; cell <= 2; cell++) for (const k of [-1, 0, 2]) {
      const bottom = interfaceBottom(seed, cell), px = passageX(seed, cell, k);
      for (let x = px - 120; x <= px + 120; x++) {
        const t = tileAt(seed, x, bottom + ANTECHAMBER_DEPTH);
        expect(t === TILE.SOLID || t === TILE.LADDER).toBe(true);
      }
      for (let x = px - 119; x < px + 120; x++) {
        if (x === px) continue;
        for (let y = bottom; y < bottom + ANTECHAMBER_DEPTH; y += 5) {
          expect(tileAt(seed, x, y)).not.toBe(TILE.LADDER);
          expect(tileAt(seed, x, y)).toBe(noiseTileAt(seed, x, y)); // 施設オーバーレイが効いていない
        }
      }
    }
  });
  it('前室の内側は空洞(床帯を除いて空気率 0.9 以上)、圧縮帯は通常より固体が多い', () => {
    const seed = 20260711, cell = 0;
    const bottom = interfaceBottom(seed, cell), px = passageX(seed, cell, 0);
    let air = 0, n = 0;
    for (let y = bottom + 1; y < bottom + ANTECHAMBER_DEPTH; y++) for (let x = px - 110; x <= px + 110; x++) {
      n++; if (tileAt(seed, x, y) !== TILE.SOLID) air++;
    }
    expect(air / n).toBeGreaterThan(0.9);
    const solidRatio = (y0: number, y1: number, x0: number) => {
      let s = 0, m = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x0 + 200; x++) { m++; if (noiseTileAt(seed, x, y) === TILE.SOLID) s++; }
      return s / m;
    };
    // 参照は同じ X 範囲で圧縮帯の下の行(同じ景観セル・同じプロファイル)。X をずらすと隣の孔の圧縮帯に入りうる
    const compressed = solidRatio(bottom + 50, bottom + 108, px - 100);
    const reference = solidRatio(bottom + 120, bottom + 178, px - 100);
    expect(compressed).toBeGreaterThan(reference);
  });
});
```

既存テストの更新(いずれも「界面・前室の外でのみ成立」に限定する):

- `'梯子列は質量ノイズ(柱・壁塊)にも巨大空洞にも分断されない(全行LADDER)'`(119 行付近)と `'keeps a deterministic ladder column continuous through every sampled biome boundary'`(174 行付近)、`'uses the same continuous ladder rule in signed X groups'`(188 行付近): 各座標の検査前に `if (interfaceTileAt(seed, x, y) !== null || terrainModsAt(seed, x, y)?.suppressLadder) continue;` を入れる。境界テストは「境界の両側(板の上面 −1 と板の下面 + 48 + 1)で同じ列が LADDER」に言い換える。
- `'ノイズが LADDER のタイルは tileAt でも必ず LADDER(上昇路保持の不変条件)'`(248 行付近)と段階4b の `'ノイズLADDER保持は維持'`(285 行付近)、`'ノイズLADDER保持: 施設領域でも...'`(263 行付近): `interfaceTileAt(seed, x, y) === null` の座標に限定する。

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/world/interface.test.ts src/world/worldgen.test.ts`
Expected: FAIL(`terrainModsAt` 未定義、`tileAt` が板で `HARD` を返さない)

- [ ] **Step 3: 実装**

`interface.ts` に `TerrainMods` と `terrainModsAt` を追加。`worldgen.ts` の `noiseTileAt` を上記のとおり変調し、梯子列の式は `groupLadderX` に差し替える。`tileAt` の先頭で `interfaceTileAt` を評価する。

- [ ] **Step 4: 成功を確認**

Run: `npx vitest run && npx tsc --noEmit`
Expected: すべて PASS(`findSpawn` の既存テストが失敗する場合は Task 5 で置き換えるので、このタスク内では `it.skip` にせず Task 5 と同じコミットに含めてよい)

- [ ] **Step 5: コミット**

```bash
git add src/world/interface.ts src/world/interface.test.ts src/world/worldgen.ts src/world/worldgen.test.ts
git commit -m "feat: compose interface plates, antechambers and compression bands into tileAt"
```

---

### Task 5: 開始地点と到達可能性

**Files:**
- Modify: `src/world/worldgen.ts:84-98`(`findSpawn`)
- Modify: `src/world/worldgen.test.ts:198-240`

**Interfaces:**
- Consumes: Task 2〜4。`Player` from `src/entities/player.ts`。
- Produces: `findSpawn(seed): { x: number; y: number }`(シグネチャ不変)。cell 0・k 0 の孔 `px` から `x = px − 24` の列を `y = interfaceBottom(seed, 0) + 1` から `+ ANTECHAMBER_DEPTH` まで走査し、`!isSolid(head) && !isSolid(body) && isSolid(below)` の最初の位置で `{ x: px − 24 + 0.1, y: y + 1 − 1.9 }` を返す。見つからなければ従来の警告つきフォールバック(底の行があるので実際には必ず見つかる)。

- [ ] **Step 1: 失敗するテストを書く**

`src/world/worldgen.test.ts` の `describe('findSpawn')` を次に置き換える(旧「上方向ルートの存在」テストは削除):

```ts
describe('findSpawn', () => {
  const seeds = [1, 42, 20260711];
  it('スポーンは固体の中ではなく、cell 0 の前室の中(孔の左 24 タイル)', () => {
    for (const seed of seeds) {
      const { x, y } = findSpawn(seed);
      expect(isSolid(tileAt(seed, Math.floor(x), Math.floor(y)))).toBe(false);
      expect(isSolid(tileAt(seed, Math.floor(x), Math.floor(y) + 1))).toBe(false);
      const px = passageX(seed, 0, 0);
      expect(Math.floor(x)).toBe(px - 24);
      expect(y).toBeGreaterThan(interfaceBottom(seed, 0));
      expect(y).toBeLessThan(interfaceBottom(seed, 0) + ANTECHAMBER_DEPTH);
    }
  });
});

describe('孔の到達可能性', () => {
  it('前室の底から孔の梯子を登り切ると板の上面に立てる(Player 結合)', () => {
    for (const seed of [1, 42, 20260711]) for (const cell of [0, -1, 2]) {
      const top = interfaceTop(seed, cell), bottom = interfaceBottom(seed, cell);
      const px = passageX(seed, cell, 0);
      const tiles = (tx: number, ty: number) => tileAt(seed, tx, ty);
      const player = new Player(px + 0.125, bottom + ANTECHAMBER_DEPTH - 1.75 - 0.05);
      const up = { left: false, right: false, jump: false, up: true, down: false };
      const idle = { ...up, up: false };
      const right = { ...idle, right: true };
      for (let i = 0; i < 3600; i++) player.update(up, 1 / 60, tiles);
      // 梯子の上端(top-4)にぶら下がった状態から右へ歩いて板の上面に降りる
      expect(player.body.y + player.body.h).toBeLessThanOrEqual(top - 2);
      for (let i = 0; i < 60; i++) player.update(right, 1 / 60, tiles);
      for (let i = 0; i < 60; i++) player.update(idle, 1 / 60, tiles);
      expect(player.body.y + player.body.h).toBeCloseTo(top, 5);
      expect(player.body.onGround).toBe(true);
    }
  });
  it('板の上面から上へ続く 32 タイル梯子列が見晴らし台の中にある、または板の上面に接している', () => {
    for (const seed of [1, 42, 20260711]) for (const cell of [0, -1, 2]) {
      const top = interfaceTop(seed, cell), px = passageX(seed, cell, 0);
      let found = false;
      for (let x = px - 12; x < px + 72 && !found; x++) {
        found = tileAt(seed, x, top - 1) === TILE.LADDER && tileAt(seed, x, top - 9) === TILE.LADDER;
      }
      expect(found).toBe(true);
    }
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/world/worldgen.test.ts`
Expected: FAIL(スポーンが前室にない)

- [ ] **Step 3: `findSpawn` を実装**

- [ ] **Step 4: 成功を確認**

Run: `npx vitest run && npx tsc --noEmit`
Expected: すべて PASS。見晴らし台の梯子列テストが特定シードで落ちる場合、見晴らし台の幅(84 タイル)は 32 タイル周期を 2 本以上含むため原因はオーバーレイ側(梯子列が `AIR` にされている)なので Task 3 の判定を直す。

- [ ] **Step 5: コミット**

```bash
git add src/world/worldgen.ts src/world/worldgen.test.ts
git commit -m "feat: spawn inside the first antechamber and prove the passage is climbable"
```

---

### Task 6: 目視確認と仕上げ

**Files:**
- Modify: `README.md`(URL パラメータ表の下に「界面の座標の調べ方」を 2 行)
- Screenshots: `screenshots/s1-spawn.png`, `screenshots/s1-antechamber.png`, `screenshots/s1-overlook.png`, `screenshots/s1-great.png`

- [ ] **Step 1: ビルドと全テスト**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: すべて成功

- [ ] **Step 2: 座標を求める**

Run(`vite-node` は vitest の依存として入っている):
```bash
npx vite-node -e "import {passageX, interfaceTop, interfaceBottom} from './src/world/interface'; const s=20260711; for (const c of [0,-1,2]) console.log(c, passageX(s,c,0), interfaceTop(s,c), interfaceBottom(s,c))"
```
Expected: cell ごとに `px, top, bottom` が出力される

- [ ] **Step 3: スクリーンショット**

```bash
node scripts/screenshot.mjs --seed=20260711 --out=screenshots/s1-spawn.png
node scripts/screenshot.mjs --seed=20260711 --pos=<px>,<bottom+20> --out=screenshots/s1-antechamber.png
node scripts/screenshot.mjs --seed=20260711 --pos=<px+6>,<top-3> --out=screenshots/s1-overlook.png
node scripts/screenshot.mjs --seed=20260711 --pos=<px(cell 2)>,<bottom(cell 2)+20> --out=screenshots/s1-great.png
```
Expected: ページエラーなし。目視の合格基準: (a) 開始画面の右に孔の梯子、上に暗い板の下面が入る。(b) 前室で天井一面が暗い面として読め、梯子が床から天井へ 1 本立つ。(c) 見晴らし台で右に大穴、足元が板。(d) 大界面で幅 5 の坑と踊り場。

- [ ] **Step 4: フレーム時間の確認**

`npm run dev` を起動し、`?seed=20260711` で前室(開始地点)に立ったまま DevTools の Performance で 3 秒計測し、フレームが 16 ms を超えないことを確認する(GPU なし・ソフトウェア描画基準)。超える場合は暗幕パスの矩形描画を行単位にまとめる。

- [ ] **Step 5: README 追記とコミット**

README の「URLパラメータ」表の下に次を追加:

```markdown
界面(階層の板)の座標は `src/world/interface.ts` の `passageX` / `interfaceTop` / `interfaceBottom` で求められる。
開始地点は常に cell 0 の前室(孔の左 24 タイル)。
```

```bash
git add README.md
git commit -m "docs: note interface coordinates for screenshots"
```

## 実装時の裁定

- 開始地点: 孔からの距離を 24→12 タイルに縮め、前室の床の行から上へ走査して最初に立てる位置を選ぶ(床に立つと開放度が低くズームが 1 のままで、横 ±17 タイルしか見えないため、24 では孔の梯子が画面外になる)。列が 32 タイル梯子列に当たる場合は左へ最大 4 ずらす(床の行では梯子列が抑止されず足元が LADDER になるため)。
- 破壊: Task 1 の「未生成 `undefined` は従来どおり記録」は誤り。HARD は生成状態に関わらず不壊なので、`bore` は未生成チャンクでも界面判定(`interfaceTileAt === HARD`)が真の位置を記録しない。`applyTo`・`tileAtLive` も HARD を消さない(多層防御)。
- Task 3 のテスト幾何の訂正: `interfaceTileAt(px, top−5)` は見晴らし台(top−8..top)の中なので null ではなく AIR(null は top−9)。板の上面行の HARD 検査は縦坑の脇 `|x−px| ≤ half` を除外する(脇は AIR)。
- `interfaceTileAt` の候補の孔は cell ごとに最寄りの 1 つで足りる(孔の持つタイルは x ∈ [p−12, p+72)、孔間隔は 256 以上)。計画の x−30 側の第 2 候補は削除した。
