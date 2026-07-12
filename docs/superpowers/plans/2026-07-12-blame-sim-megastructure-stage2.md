# 超構造体・段階2「入れる施設(貯水池)」実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 階層で「present かつ水系統」の room セルを、実際に**入れる貯水池チャンバー**(壁・入口・内部キャットウォーク+梯子・水面・崩壊)としてタイル生成に反映する。歩くと「これは貯水施設だ」と読める場所が世界に現れる。到達可能性は壊さない。

**Architecture:** `tileAt` を「施設オーバーレイ + 従来ノイズ躯体」の合成に変える。鍵となる不変条件: **施設はノイズの LADDER を絶対に上書きしない**ので、既存の「上方向ルート常時存在」保証が施設をまたいでも自動的に保たれ、既存テストも回帰しない。施設生成は純粋関数 `facilityTileAt(seed,x,y): Tile | null`(該当しなければ null → ノイズにフォールバック)。段階2は**水系統の present room のみ**を実タイル化(他系統/不在は従来ノイズのまま)。

**Tech Stack:** 既存(Vite/TS/Canvas2D/Vitest/Playwright)。

**参照スペック:** `docs/superpowers/specs/2026-07-12-blame-sim-megastructure-worldgen-design.md`

**全タスク共通:**
- `facility.ts` は純粋・決定論。乱数は `hash2` と `hierarchy.ts` の解決結果(roomAt の variantSeed/decay 等)のみ
- 既存テスト(79件)は回帰なし維持。物理(`physics.ts`)は無改修
- スクショ: `node scripts/screenshot.mjs --out=... [--pos=x,y] [--seed=N] [--debug=hierarchy:N]`。exit 0 + [pageerror] 無し確認
- 座標: ワールドy下向き正、CHUNK=64、ROOM_SIZE=128、TILE={AIR:0,SOLID:1,LADDER:2}

---

### Task 1: tileAt を「施設 + ノイズ」合成へリファクタ(梯子保持)

**Files:**
- Modify: `src/world/worldgen.ts`
- Test: `src/world/worldgen.test.ts`(追記)

現在の `tileAt` の本体を `noiseTileAt` に改名(ロジックはそのまま)。`tileAt` を合成関数にする。段階1で `facility.ts` はまだ無いので、このタスクでは `facilityTileAt` を「常に null を返すスタブ」を worldgen 内に置くのではなく、**次タスクで作る `facility.ts` を import する前提**にせず、まずは合成の骨組みと梯子保持の不変条件だけ入れる。具体的には、このタスクでは `facilityTileAt` を仮に `(): null => null` のローカル定数として置き、Task 3 で本物の import に差し替える(Task 2 で facility.ts を作る間、worldgen は壊れない)。

- [ ] **Step 1: 失敗するテストを追記**

`src/world/worldgen.test.ts` に追記:

```ts
import { noiseTileAt } from './worldgen';

describe('tileAt 合成(段階2)', () => {
  it('施設が無い座標では tileAt は noiseTileAt と一致する', () => {
    // 段階2時点では facility スタブが常にnullなので全一致するはず
    for (const [x, y] of [[0, 0], [63, -8], [200, -520], [-40, 130]] as const) {
      expect(tileAt(42, x, y)).toBe(noiseTileAt(42, x, y));
    }
  });

  it('ノイズが LADDER のタイルは tileAt でも必ず LADDER(上昇路保持の不変条件)', () => {
    let checked = 0;
    for (let y = -200; y < 0 && checked < 50; y++) {
      for (let x = 0; x < 512 && checked < 50; x++) {
        if (noiseTileAt(42, x, y) === TILE.LADDER) {
          expect(tileAt(42, x, y)).toBe(TILE.LADDER);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/world/worldgen.test.ts`
Expected: FAIL(`noiseTileAt` が未エクスポート)

- [ ] **Step 3: 実装(worldgen.ts)**

`worldgen.ts` の既存 `export function tileAt(seed, x, y): Tile { ... }` を **`export function noiseTileAt(seed, x, y): Tile { ...元の本体そのまま... }`** に改名。そのうえで新しい合成 `tileAt` を追加:

```ts
/** 施設オーバーレイ(段階3でfacility.tsへ差し替え)。該当しなければnull */
const facilityTileAt = (_seed: number, _x: number, _y: number): Tile | null => null;

/**
 * 最終タイル = 施設オーバーレイ + 素のノイズ躯体。
 * 不変条件: ノイズが LADDER のタイルは施設で上書きしない(上昇路を保持し到達可能性を守る)。
 */
export function tileAt(seed: number, x: number, y: number): Tile {
  const base = noiseTileAt(seed, x, y);
  if (base === TILE.LADDER) return base;
  const f = facilityTileAt(seed, x, y);
  return f ?? base;
}
```

`generateChunk` / `findSpawn` は `tileAt` を呼んだままでよい(合成後の値を使う)。

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/world/worldgen.test.ts` → PASS。`npm test` → 全PASS(既存の worldgen テストは noiseTileAt と同値の tileAt で回帰なし)。`npx tsc --noEmit` クリーン

- [ ] **Step 5: コミット**

```bash
git add src/world/worldgen.ts src/world/worldgen.test.ts
git commit -m "refactor: tileAtを施設+ノイズ合成へ(梯子保持の不変条件)"
```

---

### Task 2: 貯水池チャンバーの生成(facility.ts)

**Files:**
- Create: `src/world/facility.ts`
- Test: `src/world/facility.test.ts`

`facilityTileAt(seed,x,y)` は、その座標が「present かつ水系統(region.system==='water')」の room セル内なら、貯水池チャンバーのタイル(SOLID壁 / AIR内部 / 内部LADDER)を返す。該当しなければ null。他系統/不在は null(段階2スコープ)。

チャンバー構造(すべて variantSeed / decay から決定論的):
- room セル(128×128)内に、辺から margin(hashで8〜24)内側の矩形が施設の外郭
- 外郭の**壁**(厚み2)は SOLID。ただし入口開口(左右いずれか+底に1〜2箇所、hashで位置)は AIR
- **内部**は AIR。内部に:
  - 水平キャットウォーク(hashで2〜4段、床行に SOLID)
  - 各段をつなぐ**内部 LADDER 列**(hashで1本、外郭天井付近から底まで貫通)→ チャンバー内の縦移動を保証
  - 底付近の「**水面**」帯(段階2ではタイルは AIR のまま。水の見た目は段階5のdecorで足す。ここでは"下部は開けた水槽"として空ける)
- **崩壊(decay)**: decay が高いほど壁の一部が欠落(AIR breach)、内部にSOLIDの瓦礫塊が散る
- 矩形の外側は null(ノイズ躯体が施設間を埋める)

- [ ] **Step 1: 失敗するテストを書く**

`src/world/facility.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TILE } from './tiles';
import { facilityTileAt } from './facility';
import { regionAt, roomAt, ROOM_SIZE, REGION_SIZE } from './hierarchy';

/**
 * 指定 system の present room セルを1つ探す。
 * 注意: system は region 単位(REGION_SIZE=262144)で決まるので、必ず region をまたいで探す。
 * まず該当 system の region を見つけ、その region 内で present room を走査する。
 */
function findRoomOfSystem(seed: number, system: string): { rmx: number; rmy: number } {
  for (let r = 0; r < 24; r++) {
    for (const [rx, ry] of [[r, 0], [0, r], [r, -1], [-1, r], [r, r], [-r, r]] as const) {
      const rwx = rx * REGION_SIZE, rwy = ry * REGION_SIZE;
      if (regionAt(seed, rwx, rwy).system !== system) continue;
      // この region 内で present room を探す(region は下位サイズの整数倍なので内側は同一system)
      for (let rmy = 0; rmy < 80; rmy++) {
        for (let rmx = 0; rmx < 80; rmx++) {
          const x = rwx + rmx * ROOM_SIZE, y = rwy + rmy * ROOM_SIZE;
          if (roomAt(seed, x, y).present) {
            return { rmx: Math.floor(x / ROOM_SIZE), rmy: Math.floor(y / ROOM_SIZE) };
          }
        }
      }
    }
  }
  throw new Error(`system=${system} の present room が見つからない`);
}

const findWaterRoom = (seed: number) => findRoomOfSystem(seed, 'water');

describe('facilityTileAt', () => {
  it('決定論: 同じ座標なら同じ結果', () => {
    const { rmx, rmy } = findWaterRoom(42);
    const x = rmx * ROOM_SIZE + 64, y = rmy * ROOM_SIZE + 64;
    expect(facilityTileAt(42, x, y)).toBe(facilityTileAt(42, x, y));
  });

  it('水系統の present room 内には SOLID壁・AIR内部・LADDER がすべて出現する', () => {
    const { rmx, rmy } = findWaterRoom(42);
    const kinds = new Set<number | null>();
    for (let ly = 0; ly < ROOM_SIZE; ly++) {
      for (let lx = 0; lx < ROOM_SIZE; lx++) {
        kinds.add(facilityTileAt(42, rmx * ROOM_SIZE + lx, rmy * ROOM_SIZE + ly));
      }
    }
    expect(kinds.has(TILE.SOLID)).toBe(true);
    expect(kinds.has(TILE.AIR)).toBe(true);
    expect(kinds.has(TILE.LADDER)).toBe(true);
    expect(kinds.has(null)).toBe(true); // 矩形の外側はnull
  });

  it('チャンバーには縦に貫通する内部LADDER列が存在する(縦移動保証)', () => {
    const { rmx, rmy } = findWaterRoom(42);
    // いずれかの列 lx で LADDER が縦方向に十分連続する
    let maxRun = 0;
    for (let lx = 0; lx < ROOM_SIZE; lx++) {
      let run = 0, best = 0;
      for (let ly = 0; ly < ROOM_SIZE; ly++) {
        if (facilityTileAt(42, rmx * ROOM_SIZE + lx, rmy * ROOM_SIZE + ly) === TILE.LADDER) {
          run++; best = Math.max(best, run);
        } else run = 0;
      }
      maxRun = Math.max(maxRun, best);
    }
    expect(maxRun).toBeGreaterThan(ROOM_SIZE * 0.3); // 外郭高さの一定割合以上を貫通
  });

  it('水系統でない present room セルは null を返す(段階2は水のみ実タイル化)', () => {
    // 非水系統(例: power)の present room を region をまたいで探す
    const { rmx, rmy } = findRoomOfSystem(42, 'power');
    // その room 内の複数点がすべて null
    for (const [ox, oy] of [[64, 64], [20, 100], [100, 20]] as const) {
      expect(facilityTileAt(42, rmx * ROOM_SIZE + ox, rmy * ROOM_SIZE + oy)).toBeNull();
    }
  });

  it('チャンク境界をまたぐチャンバーも一貫(room が2チャンクにまたがっても座標で決まる)', () => {
    // ROOM_SIZE=128 は2チャンク。room 内の同一ワールド座標は必ず同一結果
    const { rmx, rmy } = findWaterRoom(42);
    const x = rmx * ROOM_SIZE + 70, y = rmy * ROOM_SIZE + 70;
    expect(facilityTileAt(42, x, y)).toBe(facilityTileAt(42, x, y));
    // 別チャンク側の同一room内タイルも決定論
    const x2 = rmx * ROOM_SIZE + 10, y2 = rmy * ROOM_SIZE + 10;
    expect(facilityTileAt(42, x2, y2)).toBe(facilityTileAt(42, x2, y2));
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/world/facility.test.ts`
Expected: FAIL(モジュール未作成)

- [ ] **Step 3: 実装**

`src/world/facility.ts`:

```ts
import { hash2 } from './noise';
import { regionAt, roomAt, ROOM_SIZE } from './hierarchy';
import { TILE, type Tile } from './tiles';

/**
 * 施設タイル(段階2: 水系統の貯水池チャンバーのみ実タイル化)。
 * 該当しなければ null(呼び出し側=tileAtがノイズ躯体にフォールバック)。純粋関数。
 */
export function facilityTileAt(seed: number, x: number, y: number): Tile | null {
  if (regionAt(seed, x, y).system !== 'water') return null;
  const room = roomAt(seed, x, y);
  if (!room.present) return null;

  const rmx = Math.floor(x / ROOM_SIZE);
  const rmy = Math.floor(y / ROOM_SIZE);
  const lx = x - rmx * ROOM_SIZE;
  const ly = y - rmy * ROOM_SIZE;
  const vs = room.variantSeed;

  // 外郭矩形(セル辺からの margin。variantSeedで揺らぐ)
  const marginL = 8 + Math.floor(hash2(vs, 1, 0) * 16);
  const marginR = 8 + Math.floor(hash2(vs, 2, 0) * 16);
  const marginT = 8 + Math.floor(hash2(vs, 3, 0) * 16);
  const marginB = 8 + Math.floor(hash2(vs, 4, 0) * 16);
  const x0 = marginL, x1 = ROOM_SIZE - marginR;
  const y0 = marginT, y1 = ROOM_SIZE - marginB;
  if (lx < x0 || lx >= x1 || ly < y0 || ly >= y1) return null; // 矩形外=ノイズ

  const WALL = 2;
  const onWall =
    lx < x0 + WALL || lx >= x1 - WALL || ly < y0 + WALL || ly >= y1 - WALL;

  // 内部LADDER列(天井付近から底まで貫通)
  const ladderX = x0 + WALL + 1 + Math.floor(hash2(vs, 5, 0) * (x1 - x0 - 2 * WALL - 2));
  if (lx === ladderX && ly >= y0 + WALL && ly < y1 - WALL) {
    return TILE.LADDER;
  }

  if (onWall) {
    // 入口開口: 底辺と左右のいずれかに hash で開口
    const doorBottom = ly >= y1 - WALL; // 底の壁
    const doorSide = lx < x0 + WALL || lx >= x1 - WALL; // 左右の壁
    if (doorBottom) {
      const doorC = x0 + Math.floor(hash2(vs, 6, 0) * (x1 - x0));
      if (Math.abs(lx - doorC) <= 3) return TILE.AIR; // 底の入口
    }
    if (doorSide && Math.abs(ly - (y0 + (y1 - y0) * 0.6)) <= 4) return TILE.AIR; // 横の入口
    // 崩壊: 壁の一部が欠落
    if (room.decay > 0.5 && hash2(vs + 100, lx, ly) < (room.decay - 0.5)) return TILE.AIR;
    return TILE.SOLID;
  }

  // 内部
  // キャットウォーク(2〜4段の水平床)
  const bands = 2 + Math.floor(hash2(vs, 7, 0) * 3);
  for (let b = 1; b <= bands; b++) {
    const cy = y0 + WALL + Math.round(((y1 - y0 - 2 * WALL) * b) / (bands + 1));
    if (ly === cy) {
      // キャットウォークにも開口(渡りきり防止のため一部AIR)
      if (hash2(vs + 200, lx, b) < 0.15) return TILE.AIR;
      return TILE.SOLID;
    }
  }
  // 崩壊: 内部に瓦礫塊
  if (room.decay > 0.4 && hash2(vs + 300, lx, ly) < (room.decay - 0.4) * 0.3) return TILE.SOLID;

  return TILE.AIR; // 内部の空間(下部は水槽として空ける)
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/world/facility.test.ts` → PASS。`npm test` → 全PASS。`npx tsc --noEmit` クリーン
統計テストが落ちたら閾値をいじる前に、対象 room の変数値(margin/bands/ladderX)を出力して原因を確認する。

- [ ] **Step 5: コミット**

```bash
git add src/world/facility.ts src/world/facility.test.ts
git commit -m "feat: 貯水池チャンバーの生成(壁・入口・内部梯子・崩壊)"
```

---

### Task 3: 統合と目視(施設が世界に現れる)

**Files:**
- Modify: `src/world/worldgen.ts`(スタブを本物の facilityTileAt に差し替え)
- Test: `src/world/worldgen.test.ts`(到達可能性の追記)

- [ ] **Step 1: worldgen のスタブを差し替え**

`src/world/worldgen.ts`:
- 先頭に `import { facilityTileAt } from './facility';`
- Task 1 で置いたローカルスタブ `const facilityTileAt = ...` を削除(import に置き換え)。合成 `tileAt` はそのまま(梯子保持の不変条件を維持)

**循環import注意**: `facility.ts` は `hierarchy.ts` と `noise.ts`・`tiles.ts` のみに依存し、`worldgen.ts` を import しない。`worldgen.ts` が `facility.ts` を import する一方向。循環しないことを確認。

- [ ] **Step 2: 到達可能性テストを追記**

`src/world/worldgen.test.ts` に追記:

```ts
describe('施設統合後の到達可能性', () => {
  it('ノイズLADDER保持: 施設領域でもノイズの梯子は残る(既存の上昇保証)', () => {
    // noiseTileAt が LADDER の点は合成 tileAt でも LADDER(Task1の不変条件が統合後も成立)
    let checked = 0;
    for (let y = -400; y < 0 && checked < 80; y++) {
      for (let x = 0; x < 1024 && checked < 80; x++) {
        if (noiseTileAt(42, x, y) === TILE.LADDER) {
          expect(tileAt(42, x, y)).toBe(TILE.LADDER);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('findSpawn はSOLIDの中ではない(施設統合後も安全)', () => {
    for (const seed of [1, 42, 20260711]) {
      const { x, y } = findSpawn(seed);
      expect(tileAt(seed, Math.floor(x), Math.floor(y))).not.toBe(TILE.SOLID);
    }
  });
});
```

(`findSpawn`, `noiseTileAt`, `tileAt`, `TILE` は既に import 済みのはず。無ければ追加)

- [ ] **Step 3: 検証(テスト+型+目視)**

Run: `npm test && npx tsc --noEmit`
Expected: 全PASS(既存の worldgen 決定論・梯子分断テストも回帰なし。施設はノイズ梯子を上書きしないため)

Run: 水系統の貯水池を探して撮る。まず階層マップで水系統の present room 座標を特定:
```
node scripts/screenshot.mjs --debug=hierarchy:6000 --pos=100,-600 --out=screenshots/s2-map.png
```
map から水系統(青)の room 位置を読み、その座標へ寄って通常描画で撮る(例。実際は map を見て調整):
```
node scripts/screenshot.mjs --pos=<水room中心x>,<y> --out=screenshots/s2-reservoir.png
```
PNGをReadで確認: 壁で囲まれた**チャンバー**が見え、内部にキャットウォークの段と縦の梯子、底が開けた水槽状、入口の開口がある。周囲はノイズ躯体。「これは貯水施設だ」と読めるか。崩壊した room は壁が欠けて瓦礫があるか(複数座標を撮って多様性も確認)。

**注意**: 水系統の present room は疎(present密度×水系統1/5)。map で確実に座標を特定してから撮ること。見つけにくければ複数の seed / pos を試す。

- [ ] **Step 4: コミット**

```bash
git add src/world/worldgen.ts src/world/worldgen.test.ts
git commit -m "feat: 貯水池チャンバーを世界に統合(段階2)"
```

---

### Task 4: 段階2の最終確認

- [ ] **Step 1: 全テスト・型・ビルド**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: 全PASS、ビルド成功

- [ ] **Step 2: 実プレイ相当の目視**

貯水池 room の座標にスポーンさせ(`--pos`)、チャンバーに入って歩ける・梯子で昇れる形になっているか、周囲のノイズ躯体と自然につながっているかを複数箇所で確認。到達可能性(チャンバー内の縦移動+ノイズ梯子の保持)が視覚的に破綻していないこと。

- [ ] **Step 3: 未コミット変更があればコミット**

---

## この計画のスコープ外(次段階)
- 段階3: 施設間のネットワーク経路(配管/電線)+キャットウォーク併走+両端一致
- 段階4: 全系統の施設タイプ+セクター幹線+因果(発電→電線→ポンプ)、地域バイオーム化
- 段階5: セクター遠景シルエット、稀少ランドマーク、水面など施設decor、総合チューニング
- 段階2は「水系統の貯水池チャンバーを入れる」1系統1施設の縦スライス。他系統は従来ノイズのまま。

## 留意
- 到達可能性の完全保証(全room・全経路)は段階3-4で強化。段階2は「ノイズ梯子を保持」+「チャンバー内に縦梯子」で局所的な行き止まりを避けるに留める。詰み防止の最終手段(重力子砲=地形破壊)は将来段階。
- 施設は水系統present roomのみなので疎。世界の大半は従来通り(段階0の見た目)。「意味のある場所」が点在し始める段階。
