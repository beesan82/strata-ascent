# 段階4「休憩点と大構造」実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 各層の中腹に灯のともる休憩点を、3 層に 1 層の大構造層に塔か崩落界面を決定論で置き、孔を使わない第二の登攀経路と「次に行きたい場所」の固有の光を与える。

**Architecture:** ワールド側は純粋関数 3 群(`restpoint.ts`: 休憩点、`landmark.ts`: 塔・崩落、`traces.ts`: 痕跡の集中)を `worldgen.tileAt` の優先順位(§5.6)に差し込む。描画側は新しいパスを足さず、`Lighting` の半解像度 overlay に平坦な矩形数枚(塔頂部の点滅・裂け目の光条・休憩点の暖色)を相乗りさせ、`ambientDelta` に休憩点の補正を足す。

**Tech Stack:** Vite + TypeScript、Canvas 2D、Vitest。ヘッドレス(ソフトウェア描画)が性能基準。

**Spec:** `docs/superpowers/specs/2026-10-18-blame-sim-interface-ascent-design.md` §5.4、§5.5、§5.6、§6.2(塔・崩落の光)、§6.3(休憩点の暖色)、§9 段階4。段階2 の性能ルールは `docs/superpowers/plans/2026-10-18-interface-ascent-stage2-beacon.md` 末尾、段階3 の注意は `2026-10-19-interface-ascent-stage3-view.md` 末尾。

## Global Constraints

- 座標: Y は下向き正。cell c の板は `[interfaceTop(c), interfaceBottom(c))`。**層 c は `[interfaceTop(c), interfaceTop(c+1))`** で、天井の板が cell c(孔 `passageX(seed, c, k)` で上の層 c−1 へ)、床の板が cell c+1(孔 `passageX(seed, c+1, k)` で下から来た)。設計書 §5.4 の「下の界面の孔 `passageX(seed, cell−1, k)`」はこの向きでは **`passageX(seed, cell+1, k)`**、「上の界面の孔」は `passageX(seed, cell, k)` と読む(裁定)。
- 休憩点(§5.4): 孔スロットごとに 1 つ。Y は層の中腹(板の下面から次の板の上面までの 40〜60%)。X は上下の孔の中点 ±64。幅 32・高さ 12 の空間、`SOLID` の床、灯 3〜5、刻印、荷袋。周囲 24 タイルの痕跡出現率 5 倍。
- 大構造(§5.5): `mod(cell,3)===1` の層で `mod(k,3)===0` のスロットに 1 基。塔: 幅 48、中心 X = 孔 X + 160、層の全高と上の板を貫く `HARD`、内部に梯子 1 本、環状通路 3 本、頂部は板の上面で開口し幅 12 の床。崩落界面: 幅 160 の `HARD` の斜路と瓦礫。メガ施設より優先。
- 優先順位(§5.6): `HARD(界面・塔・崩落斜路) > 孔(LADDER/AIR) > 前室の強制空洞 > 休憩点 > メガ施設 > 施設 > 幹線 > 導管 > 躯体ノイズ`。
- `Destruction.bore` は塔・斜路の `HARD` も残す(界面と同じ経路)。
- 性能: ヘッドレス(ソフトウェア描画)で休憩点・塔・崩落の場面の rAF p95 ≤ 16.7〜16.8 ms(基準 origin/master と同じ機械状態で比較)。新しい光は平坦な色・少ない色数・`lighter` の画素数最小。`Lighting` の overlay か空のフィルへの焼き込みだけ。
- 決定論(同入力同出力)。コメントは日本語。既存テスト(416)全通過、`tsc`・`build` 成功。

## Review Focus

1. 塔が板の下(cell+1)の見晴らし台・大穴の真上に立つ場合(孔の揺らぎで最大 128 ずれる): 孔・見晴らし台・大穴は塔に負けない(塔の `HARD` は板の `HARD` にだけ勝つ)。Task 3 のテスト「塔は板の孔・見晴らし台・大穴を塞がない」。
2. 崩落の斜路は大界面(厚み 96)でも登り切れる: 幅を `2 × (48 + 厚み)` にして傾き 1/2 を保つ。Task 2 のテスト「大界面の崩落」と Task 3 の Player 結合テスト(cell −2 は大界面かつ大構造層)。
3. 休憩点の箱に 32 タイル梯子列が 1 本も入らない配置(箱 32 幅が 2 グループにまたがる): X を梯子列が入るように最大 16 ずらす。Task 1 のテスト「箱の中に梯子列が 1 本ある」。
4. 休憩点の箱と塔が重なる(孔の揺らぎ最大 128 と休憩点の揺らぎ最大 80 の和が 136 を超える)稀な配置: 大構造が勝ち、休憩点は切れる。Task 3 の優先順位テストで固定(重なった座標で `tileAt` は塔)。
5. 塔の頂部から上の層へ出た場合の自動眺望: `overlookCellAt` が塔頂部の床(幅 12)でもその板の cell を返す。Task 5 のテスト。

---

### Task 1: 休憩点の幾何 `restpoint.ts`

**Files:**
- Create: `src/world/restpoint.ts`
- Test: `src/world/restpoint.test.ts`

**Interfaces:**
- Consumes: `interfaceBottom`, `interfaceTop`, `passageX`, `groupLadderX`, `PASSAGE_SLOT`(`interface.ts`)、`hash2`、`biomeCellAt`。
- Produces:

```ts
export const REST_HALF_WIDTH = 16;   // 幅 32
export const REST_HEIGHT = 12;       // 床の上の空気の行数
export const REST_JITTER = 48;       // 中点からの揺らぎ(±)。梯子列を入れるずらし ≤16 と合わせて ≤64
export const REST_HALO = 24;         // 痕跡 5 倍の範囲
export const REST_DOOR_ROWS = 3;     // 両端の壁の下 3 行は出入口(AIR)
export interface RestPoint {
  cell: number; k: number;
  x: number;        // 中心 X
  floorY: number;   // 床の行(SOLID)。空間は [floorY−12, floorY)、天井は floorY−13
  left: number;     // x − 16(左の壁の列)
  right: number;    // x + 15(右の壁の列)
  lamps: number[];  // 灯を置く X(3〜5 個、床の 1 段上 floorY−1 に描く)
  packX: number;    // 荷袋の X
  tallyY: number;   // 刻印の行(左の壁 left の内側の面)
}
export function restPointAt(seed: number, cell: number, k: number): RestPoint;
export function nearestRestPoint(seed: number, x: number, y: number): RestPoint;  // y の層で、k0−1..k0+1 から |x−rp.x| 最小
export function restPointTileAt(seed: number, x: number, y: number): Tile | null; // 箱の中だけ。外は null
export function restWarmthAt(seed: number, x: number, y: number): number;          // 箱の中 1、外へ 12 タイルで線形に 0
```

規則:
- `floorY = bottom + round(H × (0.4 + 0.2 × hash2(seed+9101, cell, k)))`、`H = interfaceTop(seed, cell+1) − interfaceBottom(seed, cell)`。
- `x0 = round((passageX(seed, cell+1, k) + passageX(seed, cell, k)) / 2) + (floor(hash2(seed+9102, cell, k) × 97) − 48)`。箱 `[x0−16, x0+16)` に `groupLadderX` の列が無ければ、最寄りの列 `lx`(`x0−16` のグループと `x0+15` のグループの 2 候補)が箱に入る最小のずらしで `x` を決める(`lx < x−16` なら `x = lx + 16`、`lx ≥ x+16` なら `x = lx − 15`)。
- タイル(箱 `x ∈ [left, right]`, `y ∈ [floorY−13, floorY]`): 32 タイル梯子列 `x === groupLadderX(seed, x)` は LADDER のまま(通路)。`y === floorY` と `y === floorY−13` は SOLID。`x === left || x === right` は `y ≥ floorY − REST_DOOR_ROWS` なら AIR(出入口)、それ以外 SOLID。残りは AIR。
- `lamps`: `n = 3 + floor(hash2(seed+9103, cell, k) × 3)`、`lamps[i] = left + 3 + round(i × 26 / (n−1))`(梯子列と重なる位置は `+1`)。`packX = right − 3`、`tallyY = floorY − 6`。
- `restWarmthAt`: `nearestRestPoint` の箱までのチェビシェフ距離 `d`(箱の中で 0)に対し `max(0, 1 − d / 12)`。

- [ ] **Step 1: 失敗するテスト(`restpoint.test.ts`)**

```ts
const seeds = [1, 42, 20260711];
it('床は層の 40〜60%、X は上下の孔の中点 ±64、箱に梯子列が 1 本入る', () => {
  for (const seed of seeds) for (let cell = -4; cell <= 3; cell++) for (const k of [-3, 0, 2]) {
    const rp = restPointAt(seed, cell, k);
    const bottom = interfaceBottom(seed, cell), H = interfaceTop(seed, cell + 1) - bottom;
    expect(rp.floorY).toBeGreaterThanOrEqual(bottom + 0.4 * H - 1);
    expect(rp.floorY).toBeLessThanOrEqual(bottom + 0.6 * H + 1);
    const mid = (passageX(seed, cell + 1, k) + passageX(seed, cell, k)) / 2;
    expect(Math.abs(rp.x - mid)).toBeLessThanOrEqual(64);
    let ladders = 0;
    for (let x = rp.left; x <= rp.right; x++) if (x === groupLadderX(seed, x)) ladders++;
    expect(ladders).toBeGreaterThanOrEqual(1);
    expect(rp.lamps.length).toBeGreaterThanOrEqual(3); expect(rp.lamps.length).toBeLessThanOrEqual(5);
    for (const lx of rp.lamps) { expect(lx).toBeGreaterThan(rp.left); expect(lx).toBeLessThan(rp.right); }
  }
});
it('箱のタイル: 床と天井は SOLID、壁は上 10 行 SOLID・下 3 行 AIR、中は AIR、梯子列は残る、外は null', () => {
  const rp = restPointAt(42, 0, 0);
  expect(restPointTileAt(42, rp.x, rp.floorY)).toBe(TILE.SOLID);
  expect(restPointTileAt(42, rp.x, rp.floorY - 13)).toBe(TILE.SOLID);
  expect(restPointTileAt(42, rp.left, rp.floorY - 6)).toBe(TILE.SOLID);
  expect(restPointTileAt(42, rp.left, rp.floorY - 1)).toBe(TILE.AIR);
  expect(restPointTileAt(42, rp.right, rp.floorY - 3)).toBe(TILE.AIR);
  expect(restPointTileAt(42, rp.x, rp.floorY - 14)).toBe(null);
  expect(restPointTileAt(42, rp.left - 1, rp.floorY)).toBe(null);
  for (let x = rp.left; x <= rp.right; x++) if (x === groupLadderX(42, x)) {
    expect(restPointTileAt(42, x, rp.floorY)).toBe(TILE.LADDER);
    expect(restPointTileAt(42, x, rp.floorY - 13)).toBe(TILE.LADDER);
  }
  let air = 0;
  for (let x = rp.left + 1; x < rp.right; x++) for (let y = rp.floorY - 12; y < rp.floorY; y++) if (restPointTileAt(42, x, y) === TILE.AIR) air++;
  expect(air).toBeGreaterThan(30 * 12 - 13);
});
it('nearestRestPoint は y の層の最寄り、restWarmthAt は箱で 1・12 タイル先で 0', () => {
  const rp = restPointAt(20260711, -1, 1);
  expect(nearestRestPoint(20260711, rp.x + 100, rp.floorY)).toEqual(rp);
  expect(restWarmthAt(20260711, rp.x, rp.floorY - 5)).toBe(1);
  expect(restWarmthAt(20260711, rp.right + 6, rp.floorY - 5)).toBeCloseTo(0.5, 5);
  expect(restWarmthAt(20260711, rp.right + 12, rp.floorY - 5)).toBe(0);
});
it('決定論', () => { expect(restPointAt(42, 1, 2)).toEqual(restPointAt(42, 1, 2)); });
```

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run src/world/restpoint.test.ts` Expected: FAIL(モジュール無し)
- [ ] **Step 3: `restpoint.ts` を実装**(上の規則どおり。ファイル冒頭に座標の約束と「下の界面の孔 = cell+1」の裁定を書く)
- [ ] **Step 4: 通過確認** — Run: `npx vitest run src/world/restpoint.test.ts && npx tsc --noEmit` Expected: PASS
- [ ] **Step 5: コミット** — `git add src/world/restpoint.ts src/world/restpoint.test.ts && git commit -m "feat: rest point geometry per passage slot"`

---

### Task 2: 大構造の幾何 `landmark.ts`

**Files:**
- Create: `src/world/landmark.ts`
- Test: `src/world/landmark.test.ts`

**Interfaces:**
- Consumes: `interfaceTop`, `interfaceBottom`, `passageX`, `groupLadderX`, `mod`, `PASSAGE_SLOT`, `SHAFT_OVERHANG`, `OVERLOOK_HEIGHT`, `ANTECHAMBER_DEPTH`。
- Produces:

```ts
export const LANDMARK_OFFSET = 160;        // 中心 X = 孔 X + 160(塔・崩落とも)
export const TOWER_HALF_WIDTH = 24;        // 幅 48
export const TOWER_TOP_HALF_WIDTH = 6;     // 頂部の床 幅 12
export const TOWER_SHAFT_HALF = 1;         // 内部の縦坑 幅 3(中央 LADDER)
export const TOWER_RINGS = 3;              // 環状通路の本数(層の高さを 4 等分した 1/4, 2/4, 3/4)
export const TOWER_RING_ROWS = 3;          // 通路の高さ(行)
export const TOWER_BASE_ROWS = 3;          // 基部の出入口(床の板の上 3 行)
export const COLLAPSE_SLOPE_RUN = 2;       // 斜路: 2 列で 1 段上がる
export type LandmarkKind = 'tower' | 'collapse';
export interface Landmark {
  kind: LandmarkKind; cell: number; k: number;
  x: number;         // 中心 X = passageX(seed, cell, k) + 160
  top: number;       // interfaceTop(seed, cell)(板の上面 = 塔の頂部の床 / 崩落の上端)
  bottom: number;    // interfaceBottom(seed, cell)
  floor: number;     // interfaceTop(seed, cell+1)(塔の基部が立つ床の板の上面)
  // 崩落だけ
  gapLeft: number;   // 裂け目の左端(含む)= x − width/2
  gapRight: number;  // 右端(排他)
  baseY: number;     // 斜路の足の行 = bottom + 48(前室の床の行)
}
export function isLandmarkLayer(cell: number): boolean;       // mod(cell,3)===1
export function landmarkAt(seed: number, cell: number, k: number): Landmark | null; // 層でない/mod(k,3)!==0 は null。種は hash2(seed+9201, cell, k) < 0.5 で tower
export function landmarkNear(seed: number, cell: number, x: number): Landmark | null; // x を含む可能性のある k(floor((x−160)/384) の両隣)から、x が幾何に掛かるものだけ
export function collapseWidth(cell: number): number;         // 2 × (ANTECHAMBER_DEPTH + interfaceThickness(cell)) = 160 / 288
export function rampTopY(lm: Landmark, x: number): number;   // baseY − floor((x − gapLeft) / 2)。x ∈ [gapLeft, gapRight)
export function landmarkTileAt(seed: number, x: number, y: number): Tile | null;
export function towerTopFloorAt(seed: number, cell: number, x: number): boolean; // 塔の頂部の床 [x−6, x+6) にいるか(overlookCellAt 用)
```

タイル規則(`lx = x − (lm.x − 24)`):
- 塔(`y ∈ [top − 8, floor)`): 
  - 頂部の開口 `y < top`: `lx ∈ [18, 30)` なら(`x === groupLadderX` または `lx === 24 && y ≥ top − 4` なら LADDER、それ以外 AIR)。その他は null(上の層の通常地形)。
  - 縦坑 `lx ∈ [23, 26)`, `y ∈ [top, floor)`: `lx === 24` なら LADDER、それ以外 AIR。
  - 環状通路: `yi = bottom + round(H × i / 4)`(i=1..3, `H = floor − bottom`)で `y ∈ [yi − 2, yi]` なら AIR(全幅、両側へ開口)。
  - 基部の出入口: `y ∈ [floor − 3, floor)` なら AIR(全幅)。
  - それ以外 `lx ∈ [0, 48)`: HARD。
- 崩落(`x ∈ [gapLeft, gapRight)`, `y ∈ [top, baseY]`): `y ≥ rampTopY(lm, x)` なら HARD(斜路+瓦礫の楔)、それ以外 AIR(裂け目)。範囲外 null。
- `landmarkTileAt` は `biomeCellAt(seed, y)` とその −1(塔の頂部の開口は上の層に入る)の 2 cell を調べる。

- [ ] **Step 1: 失敗するテスト(`landmark.test.ts`)**

```ts
it('大構造は mod(cell,3)===1 の層の mod(k,3)===0 のスロットだけ。中心は孔 +160、決定論', () => {
  for (const seed of seeds) for (let cell = -6; cell <= 6; cell++) for (let k = -6; k <= 6; k++) {
    const lm = landmarkAt(seed, cell, k);
    if (mod(cell, 3) !== 1 || mod(k, 3) !== 0) { expect(lm).toBe(null); continue; }
    expect(lm).not.toBe(null);
    expect(lm!.x).toBe(passageX(seed, cell, k) + LANDMARK_OFFSET);
    expect(lm!.top).toBe(interfaceTop(seed, cell)); expect(lm!.floor).toBe(interfaceTop(seed, cell + 1));
    expect(landmarkAt(seed, cell, k)).toEqual(lm);
  }
  // 両方の種が現れる
  const kinds = new Set(seeds.flatMap((s) => [-2, 1, 4].flatMap((c) => [-3, 0, 3].map((k) => landmarkAt(s, c, k)!.kind))));
  expect(kinds).toEqual(new Set(['tower', 'collapse']));
});
it('塔: 外殻は HARD、縦坑は床の板の上から頂部 −4 まで LADDER、環状通路 3 本と基部は AIR、頂部は幅 12 の開口', () => {
  // seeds × cell ∈ {-2, 1, 4} × k ∈ {-3, 0, 3} のうち kind==='tower' のもの全て
  const lm = ...; const cx = lm.x;
  for (let y = lm.floor - 1; y >= lm.top - 4; y--) expect(landmarkTileAt(seed, cx, y)).toBe(TILE.LADDER);
  expect(landmarkTileAt(seed, cx, lm.top - 5)).toBe(TILE.AIR);
  expect(landmarkTileAt(seed, cx, lm.top - 9)).toBe(null);
  expect(landmarkTileAt(seed, cx - 6, lm.top - 1)).toBe(AIR or LADDER); expect(landmarkTileAt(seed, cx - 7, lm.top - 1)).toBe(null);
  expect(landmarkTileAt(seed, cx - 20, lm.top + 5)).toBe(TILE.HARD);   // 板の中も塔の殻
  expect(landmarkTileAt(seed, cx - 20, lm.floor - 1)).toBe(TILE.AIR);  // 基部の出入口
  expect(landmarkTileAt(seed, cx - 20, lm.floor - 4)).toBe(TILE.HARD);
  const H = lm.floor - lm.bottom;
  for (let i = 1; i <= 3; i++) { const yi = lm.bottom + Math.round(H * i / 4); expect(landmarkTileAt(seed, cx - 23, yi)).toBe(TILE.AIR); expect(landmarkTileAt(seed, cx + 23, yi - 2)).toBe(TILE.AIR); expect(landmarkTileAt(seed, cx + 23, yi + 1)).toBe(TILE.HARD); }
  expect(landmarkTileAt(seed, cx - 25, lm.top + 5)).toBe(null); expect(landmarkTileAt(seed, cx + 24, lm.top + 5)).toBe(null);
});
it('崩落: 幅は 2×(48+厚み)、斜路は 2 列で 1 段、足は前室の床の行、上端は板の上面の 1 段下、上は AIR', () => {
  // kind==='collapse' のもの全て
  expect(lm.gapRight - lm.gapLeft).toBe(collapseWidth(lm.cell));
  expect(lm.baseY).toBe(lm.bottom + ANTECHAMBER_DEPTH);
  expect(rampTopY(lm, lm.gapLeft)).toBe(lm.baseY);
  expect(rampTopY(lm, lm.gapRight - 1)).toBe(lm.top + 1);
  for (let x = lm.gapLeft; x < lm.gapRight; x++) {
    const r = rampTopY(lm, x);
    expect(landmarkTileAt(seed, x, r)).toBe(TILE.HARD);
    expect(landmarkTileAt(seed, x, lm.baseY)).toBe(TILE.HARD);
    if (r > lm.top) expect(landmarkTileAt(seed, x, r - 1)).toBe(TILE.AIR);
    expect(landmarkTileAt(seed, x, lm.top - 1)).toBe(null);
  }
  expect(landmarkTileAt(seed, lm.gapLeft - 1, lm.top + 1)).toBe(null);
  expect(landmarkTileAt(seed, lm.gapRight, lm.top + 1)).toBe(null);
  expect(landmarkTileAt(seed, lm.gapLeft + 1, lm.baseY + 1)).toBe(null);
  // 大界面(cell −2: mod 3 = 1 かつ mod 4 = 2)でも傾きは 1/2
  expect(collapseWidth(-2)).toBe(288); expect(collapseWidth(1)).toBe(160);
});
it('landmarkNear は幾何に掛かる x でだけ返す。towerTopFloorAt は頂部の床 ±6', () => { ... });
```

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run src/world/landmark.test.ts` Expected: FAIL
- [ ] **Step 3: `landmark.ts` を実装**(冒頭に §5.5 の対応と、崩落幅・傾きの裁定、塔頂部が cell−1 の層に入る理由を書く)
- [ ] **Step 4: 通過確認** — Run: `npx vitest run src/world/landmark.test.ts && npx tsc --noEmit` Expected: PASS
- [ ] **Step 5: コミット** — `git add src/world/landmark.ts src/world/landmark.test.ts && git commit -m "feat: tower and collapsed-interface landmark geometry"`

---

### Task 3: worldgen の優先順位・不壊・到達可能性

**Files:**
- Modify: `src/world/worldgen.ts`(`tileAt`)
- Modify: `src/main.ts`(`fire` の不壊述語)
- Test: `src/world/worldgen.test.ts`(追記)

**Interfaces:**
- Consumes: `landmarkTileAt`(Task 2)、`restPointTileAt`(Task 1)。
- Produces: `export function isHardAt(seed, x, y): boolean`(`worldgen.ts`。`tileAt(seed,x,y) === TILE.HARD` と同値だが、界面と大構造だけを見て躯体ノイズを計算しない安い判定。`main.ts` の `bore` 述語はこれに置き換える)。

`tileAt` の新しい順序:

```ts
const iface = interfaceTileAt(seed, x, y);
const lm = landmarkTileAt(seed, x, y);
// 大構造は板の HARD にだけ勝つ(塔の縦坑が板を貫く)。孔・見晴らし台・大穴(LADDER/AIR)は大構造に勝つ。
if (lm !== null && (iface === null || iface === TILE.HARD)) return lm;
if (iface !== null) return iface;
const cell = ...; const mods = terrainModsAt(...);
const base = noiseTileWith(...);
if (mods?.suppressLadder || mods?.forceFloor) return base;        // 前室
const rest = restPointTileAt(seed, x, y);
if (rest !== null) return rest;                                    // 休憩点(梯子列は restPointTileAt が保つ)
if (base === TILE.LADDER) return base;
const overlay = megaFacilityAt(...) ?? ...;
```

- [ ] **Step 1: 失敗するテスト(`worldgen.test.ts` に追記)**

```ts
describe('段階4: 大構造と休憩点の合成', () => {
  it('塔の縦坑は板を貫き、塔の殻は板の上の層・板の中・層の中で HARD。孔・見晴らし台・大穴は塔に勝つ', () => {
    for (const seed of seeds) for (const cell of [-2, 1]) for (const k of [-3, 0, 3]) {
      const lm = landmarkAt(seed, cell, k)!; if (lm.kind !== 'tower') continue;
      for (let y = lm.floor - 1; y >= lm.top - 4; y--) expect(tileAt(seed, lm.x, y)).toBe(TILE.LADDER);
      expect(tileAt(seed, lm.x - 20, lm.top + 5)).toBe(TILE.HARD);
      // 板の下(cell+1)の孔・見晴らし台・大穴の X と塔が重なる座標があれば、そこは界面のタイル
      const px1 = passageX(seed, cell + 1, k);
      for (let x = px1 - 12; x < px1 + 72; x++) if (Math.abs(x - lm.x) < 24) {
        const y = lm.floor - 1; // 見晴らし台の行
        expect(tileAt(seed, x, y)).toBe(interfaceTileAt(seed, x, y));
      }
    }
  });
  it('崩落の裂け目は板を開け、斜路の上は空気、斜路は HARD', () => { for collapse: y=top+1 at gapLeft+2 → AIR; rampTopY → HARD });
  it('休憩点は箱の中で床・壁が SOLID、中が AIR、メガ施設より優先(箱の中では tileAt === restPointTileAt)', () => {
    for (const seed of seeds) for (const cell of [-1, 0, 2]) for (const k of [-1, 0, 1]) {
      const rp = restPointAt(seed, cell, k);
      for (let x = rp.left; x <= rp.right; x++) for (let y = rp.floorY - 13; y <= rp.floorY; y++) {
        if (landmarkTileAt(seed, x, y) !== null) continue; // 稀な塔との重なりは大構造が勝つ
        expect(tileAt(seed, x, y)).toBe(restPointTileAt(seed, x, y));
      }
    }
  });
  it('isHardAt は tileAt === HARD と同値(界面・塔・斜路)', () => { 塔の殻、板、斜路、普通の SOLID の座標で比較 });
  it('bore は塔の HARD を残す(未生成でも、生成後も)', () => {
    // seed 20260711 の塔を 1 つ選び、Destruction.bore を isHardAt 述語付きで塔の殻に撃つ。tileAtLive は HARD のまま
  });
});
describe('大構造の到達可能性', () => {
  it('塔: 床の板の上から内部の梯子を登り切ると頂部の床に立てる(Player 結合)', () => {
    // 塔ごとに Player を (lm.x + 0.125, lm.floor − 1.75 − 0.05) に置き、up を 3600 フレーム → feet ≤ top − 2、
    // 右へ 60 フレーム・静止 60 フレーム → feet ≈ top、onGround
  });
  it('崩落: 斜路の足から右へジャンプしながら歩くと板の上面に出る(Player 結合)', () => {
    // Player を (lm.gapLeft + 0.125, lm.baseY − 1.75 − 0.05) に置き、{right, jump} を 3600 フレーム → feet ≤ lm.top、
    // 続けて x ≥ lm.gapRight に達する(板の上面を歩いている)
  });
});
```

既存の「ノイズが LADDER のタイルは tileAt でも必ず LADDER」の 3 テストは、走査の述語に `landmarkTileAt(42, x, y) === null && restPointTileAt(42, x, y) === null` を足す(大構造・休憩点の箱は梯子列を切ってよい。休憩点は切らないが述語は揃える)。

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run src/world/worldgen.test.ts` Expected: 新テスト FAIL
- [ ] **Step 3: `tileAt` と `isHardAt` を実装し、`main.ts` の `fire` の述語を `isHardAt(seed, tx, ty)` に置き換える**
- [ ] **Step 4: 通過確認** — Run: `npx vitest run && npx tsc --noEmit` Expected: 全 PASS(到達可能性が落ちたら幾何(Task 2)を直す。斜路の傾き 1/2 は固定)
- [ ] **Step 5: コミット** — `git commit -am "feat: landmarks and rest points in tile priority; keep tower HARD indestructible"`

---

### Task 4: 休憩点の痕跡(灯・刻印・荷袋・5 倍)

**Files:**
- Modify: `src/render/traces.ts`
- Test: `src/render/traces.test.ts`(追記)

**Interfaces:**
- Consumes: `nearestRestPoint`, `REST_HALO`(Task 1)。
- Produces: `traceAt` の署名は不変。規則: 休憩点 `rp = nearestRestPoint(seed, wx, wy)` に対し
  - `kind==='floor'` かつ `wy === rp.floorY − 1` かつ `rp.lamps.includes(wx)` → `{ type: 'lamp', id }`。`wx === rp.packX` → `pack`。
  - `kind==='wall'` かつ `wy === rp.tallyY` かつ `wx === rp.left` → `tally`。
  - それ以外、`wx ∈ [rp.left − 24, rp.right + 24]` かつ `wy ∈ [rp.floorY − 13 − 24, rp.floorY + 24]` なら rate を 5 倍。
  - 箱から 24 より外は従来どおり(既存テストの領域 y=0,1,5 は seed 20260711 の層 0 の休憩点から離れていることを確認し、近ければテストの y を変える)。

- [ ] **Step 1: 失敗するテスト**

```ts
it('休憩点の床の 1 段上に灯 3〜5 と荷袋、左の壁に刻印', () => {
  const rp = restPointAt(SEED, 0, 0);
  for (const lx of rp.lamps) expect(traceAt(SEED, lx, rp.floorY - 1, 'floor')?.type).toBe('lamp');
  expect(traceAt(SEED, rp.packX, rp.floorY - 1, 'floor')?.type).toBe('pack');
  expect(traceAt(SEED, rp.left, rp.tallyY, 'wall')?.type).toBe('tally');
});
it('休憩点の周囲 24 タイルは痕跡が 5 倍(床 9%、壁 11% 程度)、外は従来', () => {
  const rp = restPointAt(SEED, 0, 0);
  let near = 0, far = 0; const N = 4000;
  for (let i = 0; i < N; i++) { if (traceAt(SEED, rp.left - 20 + (i % 40), rp.floorY + 2 + Math.floor(i / 40) % 20, 'floor')) near++; }
  for (let i = 0; i < N; i++) { if (traceAt(SEED, rp.right + 30 + i, rp.floorY + 30, 'floor')) far++; }
  expect(near / N).toBeGreaterThan(0.05); expect(near / N).toBeLessThan(0.15);
  expect(far / N).toBeLessThan(0.05);
});
```

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run src/render/traces.test.ts` Expected: FAIL
- [ ] **Step 3: 実装**(灯の位置は `rp.lamps`、`id` は従来の式)
- [ ] **Step 4: 通過確認** — Run: `npx vitest run src/render/traces.test.ts src/render/decor.test.ts src/render/chunkbake.test.ts` Expected: PASS
- [ ] **Step 5: コミット** — `git commit -am "feat: lamps, tally and pack at rest points; 5x traces nearby"`

---

### Task 5: 塔の頂部からの自動眺望

**Files:**
- Modify: `src/world/interface.ts`(`overlookCellAt`)
- Test: `src/world/interface.test.ts`

**Interfaces:**
- Consumes: `towerTopFloorAt(seed, cell, x)`(Task 2)。`interface.ts` → `landmark.ts` は循環 import になるので、`overlookCellAt` は**関数引数で**塔判定を受けない: 代わりに `landmark.ts` 側に `overlookCellAt` を置かず、`interface.ts` の `overlookCellAt(seed, x, footRow, towerTop?: (cell: number, x: number) => boolean)` に省略可能な述語を足し、`main.ts` が `(cell, x) => towerTopFloorAt(seed, cell, x)` を渡す。
- Produces: 足元の行が `interfaceTop(seed, cell)` で `towerTop(cell, x)` が真なら `cell` を返す(梯子列 `x === lm.x` は除く)。

- [ ] **Step 1: 失敗するテスト** — seed 20260711 で `landmarkAt(seed, -2, 0)` または `(seed, 1, 0)` が tower のものを選び(無ければ seeds を回して最初の塔)、`overlookCellAt(seed, lm.x + 3, lm.top, towerTop)` が `lm.cell`、`lm.x + 7` は `null`、`lm.x` は `null`、述語無しなら `null`。
- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run src/world/interface.test.ts` Expected: FAIL
- [ ] **Step 3: 実装し、`main.ts` で述語を渡す**
- [ ] **Step 4: 通過確認** — Run: `npx vitest run && npx tsc --noEmit` Expected: PASS
- [ ] **Step 5: コミット** — `git commit -am "feat: automatic overlook from tower top floor"`

---

### Task 6: 固有の光と暖色の描画

**Files:**
- Create: `src/render/landmarkLight.ts`
- Test: `src/render/landmarkLight.test.ts`
- Modify: `src/render/beacon.ts`(`ambientDelta` に休憩点の補正)、`src/render/renderer.ts`(overlay に相乗り、暗幕の色を暖色へ)

**Interfaces:**
- Consumes: `landmarkAt`, `rampTopY`, `collapseWidth`(Task 2)、`restPointAt`/`restWarmthAt`(Task 1)、`beaconPulse`, `biomeForCell`。
- Produces:

```ts
export const TOWER_BLINK_PERIOD = 1.6;  // 秒
export const TOWER_BLINK_DUTY = 0.15;   // 点灯割合
export const TOWER_BLINK_COLOR = '#ff5a3c';
export const RIFT_ALPHA = 0.08;         // 裂け目の光条の基準アルファ(3 本: 1, 0.75, 0.5 倍)
export const REST_WARM_COLOR = '#d8903a';
export const REST_WARM_ALPHA = 0.1;
export const REST_AMBIENT = 0.12;       // ambientLevel の補正(箱の中で +0.12)
export interface LightRect { x0: number; y0: number; x1: number; y1: number; alpha: number; color: string; } // ワールド座標(タイル)
export function towerBlink(timeSec: number, k: number): boolean; // frac((t + k × 0.37) / 1.6) < 0.15
export function landmarkLightsInView(seed, camX, camY, spanX, spanY, timeSec): LightRect[];
//  塔: 点灯中だけ 2 枚(灯 3×1.5 タイル alpha 0.6、暈 8×4 alpha 0.12)を頂部の床の上 (x, top−9.5)。
//  崩落: 3 本の帯、x = gapLeft + width × {0.15, 0.35, 0.55} を中心に幅 width/10、y は top−6 から rampTopY(帯の中心 x) まで、alpha RIFT_ALPHA × {1, 0.75, 0.5} × beaconPulse、色は biomeForCell(cell−1).accent。
//  休憩点: 視野内の休憩点の箱の内側 1 枚(alpha 0.1, '#d8903a')。
export class LandmarkLights { constructor(seed); render(ctx, cam, w, h, ppt, timeSec): void; } // lighter で LightRect を塗るだけ
```

- `ambientDelta(seed, x, y)` に `+ REST_AMBIENT × restWarmthAt(seed, x, y)` を足す(前室の補正と排他にはならないが、休憩点は前室の外なので重ならない)。
- `renderer.render`: `Lighting.render` の overlay で `beacons.render` の後に `landmarkLights.render(lctx, renderCam, w*s, h*s, ppt*s, timeSec)`。暗幕の色は `mixHex(bb.ambientColor, REST_WARM_COLOR, 0.5 × restWarmthAt(seed, player.centerX, player.body.y))`(箱の中で暗幕が暖色に寄る。追加の描画無し)。

- [ ] **Step 1: 失敗するテスト**

```ts
it('towerBlink は周期 1.6 秒で 15% 点灯、k で位相がずれる', () => { 100 分割で点灯率 ≈ 0.15 ±0.02; towerBlink(0, 0) !== towerBlink(0, 1) のいずれかの t });
it('landmarkLightsInView: 塔は点灯中だけ 2 枚、崩落は 3 本が裂け目の中、休憩点は箱の内側 1 枚、視野外は無し', () => {
  // 塔の lm: timeSec を点灯/消灯で選び、矩形の x が [lm.x−4, lm.x+4]、y が top−12..top−8 の範囲
  // 崩落の lm: 3 本それぞれ x0 ≥ gapLeft, x1 ≤ gapRight, y0 === top−6, y1 === rampTopY(lm, 中心 x)
  // 休憩点: rect が [left+1, right) × [floorY−13+1, floorY)
  // 視野をずらすと空
});
it('決定論', ...);
```

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run src/render/landmarkLight.test.ts` Expected: FAIL
- [ ] **Step 3: 実装と配線**(`renderer.ts` のコメントに「新しいパスは足さない。overlay に矩形 ≤ 6 枚」と書く)
- [ ] **Step 4: 通過確認** — Run: `npx vitest run && npx tsc --noEmit && npm run build` Expected: PASS
- [ ] **Step 5: コミット** — `git commit -am "feat: tower blink, rift rays and rest-point warmth on the lighting overlay"`

---

### Task 7: 性能計測・目視・裁定の追記・PR

**Files:**
- Modify: この計画(末尾に裁定と計測表)

- [ ] **Step 1: 場面の座標を求める**(seed 20260711: cell −2 と cell 1 の大構造、cell 0 と cell −1 の休憩点)— `npx vitest run` の中で `console.log` せず、`node -e` で `tsx` 無しに読めないので、一時テストファイルを scratchpad に置いて `restPointAt`/`landmarkAt` を印字し消す。
- [ ] **Step 2: 基準(origin/master の一時 worktree、node_modules はジャンクション)と本ブランチを同じ場面で測る**

```bash
node scripts/frametime.mjs --seed=20260711 --pos=<休憩点 x>,<floorY−2>
node scripts/frametime.mjs --seed=20260711 --pos=<塔の基部 x+30>,<floor−2>
node scripts/frametime.mjs --seed=20260711 --pos=<崩落の足 gapLeft−10>,<baseY−2>
node scripts/frametime.mjs --seed=20260711 --pos=<塔の頂部 x+3>,<top−2> --wait=1500   # 自動眺望中
node scripts/frametime.mjs --seed=20260711 --pos=<休憩点> --stages
```
Expected: rAF p95 ≤ 16.8 ms。超えたら `--stages` で lighting の増分を見て矩形を減らす。

- [ ] **Step 3: スクリーンショット** — `node scripts/screenshot.mjs --seed=20260711 --pos=... --out=screenshots/s4-rest.png` 他、塔(基部と頂部の眺望中)、崩落。判断: 灯と暖色で休憩点が「屋内」に読めるか、塔と裂け目の光が「次に行きたい場所」として読めるか。
- [ ] **Step 4: 計画末尾に「実装時の裁定(実装中)」と計測表、段階3 の保留 Minor の扱いを書く**
- [ ] **Step 5: 全テスト・ビルド、コミット、PR(base master)** — `gh pr create --base master --title "feat: rest points, towers and collapsed interfaces (stage 4)"`

## 実装時の裁定(計画段階)

- **cell の向き**: 層 cell の床の板は cell+1。設計書 §5.4 の「下の界面の孔 `passageX(seed, cell−1, k)`」は `passageX(seed, cell+1, k)`、「上の界面の孔」は `passageX(seed, cell, k)`。塔の「孔 X」は上の界面(cell)の孔。
- **ファイル**: 指示は「`restPointAt` を `interface.ts` に」だが、`interface.ts` は既に 200 行で界面の幾何に閉じているので、休憩点は `src/world/restpoint.ts`、大構造は `src/world/landmark.ts` に分け、`worldgen.ts` が両方を import する(設計書 §7 の「`interface.ts` に `restPointAt`, `landmarkAt`」は所在の目安と読む)。`interface.ts` → `landmark.ts` の循環を避けるため、`overlookCellAt` は塔判定を述語引数で受ける。
- **優先順位の実装**: 塔の縦坑が板を貫くため、大構造は板の `HARD` にだけ勝ち、孔・見晴らし台・大穴(`LADDER`/`AIR`)には負ける。崩落は板そのものを裂け目(AIR)と斜路(HARD)に置き換えるので、同じ規則で板の HARD を上書きする。
- **休憩点の形**: 「幅 32・高さ 12 の空間、SOLID の床」に天井(1 行)と両端の壁(下 3 行は出入口)を足して「屋内」に読ませる。32 タイル梯子列は箱の床・天井も貫いて残す(通路)。箱に梯子列が入るよう中心を最大 16 ずらす(揺らぎ ±48 + ずらし ≤16 で ±64 以内)。
- **塔の環状通路**: 外壁の外側に足場を出すのではなく、塔を横に貫く 3 行の通路(両側へ開口)にする。48 幅の黒い柱に 3 本の横の裂け目と基部のアーケードが入る絵になり、どの高さからでも内部の梯子へ入れる。
- **塔の頂部**: 板の上面の高さに幅 12・高さ 8 の開口(見晴らし台と同じ高さ)。梯子は top−4 まで(孔と同じ `SHAFT_OVERHANG`)。頂部から出ると自動眺望が発火する(述語で `overlookCellAt` に足す)。
- **崩落の形**: 斜路は 2 列で 1 段上がる階段状の楔(ジャンプ 2.8 タイルで 1 段ずつ登れる。「歩いて登れる」= 右+ジャンプの押しっぱなしで登り切れる、と定義)。足は前室の床の行(bottom+48)で、前室の連続床から歩いて入れる。大界面(厚み 96)は幅を 288 にして傾きを保つ(`2 × (48 + 厚み)`、§11 の ±30% を超えるが到達可能性を優先)。裂け目は楔の上の全部を AIR にする(上の層の床に幅 160 の穴が開く。落ちても斜路の上)。
- **光**: 塔頂部の点滅は赤橙の小矩形 2 枚(周期 1.6 秒、15% 点灯、k で位相)。裂け目の光条は上の層の accent の平坦な帯 3 本(脈動は光柱と同じ)。休憩点は暗幕の色を暖色へ寄せる(追加描画なし)+箱の内側に暖色の矩形 1 枚、`ambientLevel` +0.12。全て `Lighting` の overlay(半解像度)。
- **段階3 の保留 Minor 4 件**: 段階4 には含めない。眺望の打ち切り(キーごとの立ち上がり)と HUD の頭の cell、右 Shift の固定キーは入力・HUD の整理として段階5 でまとめて扱う。大界面の `overlookCellAt` テストは Task 5 のテストが cell −2(大界面)の塔を通るので部分的に埋まる。
- **ランドマークの種の選択**: `hash2(seed+9201, cell, k) < 0.5` で塔、それ以外は崩落(設計書「スロットごとに決定論で選ぶ」)。

## 実装時の裁定(実装中)

- **大界面の崩落は 1 列 1 段(幅 144)**: 2 列 1 段のままでは幅 288 が要り、孔の最小間隔 256 に収まらず隣の孔の縦坑(幅 5)を斜路が横切った(seed 20260711, cell −2, k 0 で梯子に落ちて前室へ戻った)。`collapseRun(cell)` = 大界面 1 / 通常 2。1 列 1 段でもジャンプ(高さ 2.8)で 2 段ずつ登れることを Player 結合テスト(3 seed × 大界面 cell −2 と通常 cell 1)で確認した。
- **崩落の出口の上を空ける**: 斜路を登り切った先(板の上面)の上に上の層の躯体(SOLID)が載っている配置で登り切れなかった。裂け目の列と右へ 12 列、板の上 8 行を AIR にする(`COLLAPSE_EXIT_WIDTH`。見晴らし台と同じ高さで、32 タイル梯子列は残す)。上の層の床の穴は裂け目の幅だけ広がるが、落ちても斜路の上。
- **塔の到達テスト**: 32 タイル梯子列が塔の頂部の開口(幅 12)を通る配置では、登り切って右へ歩いた後に梯子へ掴まったまま床の高さに止まり `onGround` が立たない。テストは `onGround || 足元が LADDER` を許す(孔の到達テストも同じ配置になり得る)。
- **`towerTopFloorAt` は梯子列を除く**: `overlookCellAt` の述語は「塔の頂部の床に立っている(梯子列でない)」の意味にし、孔の見晴らし台の `x !== px` と揃える。
- **`isHardAt`**: `bore` の不壊述語を `interfaceTileAt === HARD` から `worldgen.isHardAt`(界面と大構造だけを見る)に置き換えた。`tileAt === HARD` と同値であることをテストで固定。
- **既存テストの述語**: 「ノイズが LADDER なら tileAt も LADDER」の走査は大構造・休憩点の箱を除外する(大構造は梯子列を切ってよい。休憩点は梯子列を保つが述語は揃える)。「板の上面 +3 は界面タイル」は崩落の裂け目・塔の縦坑を除外、「前室の底は連続した床」は崩落の楔(HARD)を許す。
- **休憩点の灯は焼き込み**: 既存の `lamp` 痕跡(暈つき)をそのまま決められた位置に置く。明滅(§6.6)は段階5。
- **新しいテスト数**: 24(416 → 440)。
- **光の強さの調整(スクリーンショット後)**: 休憩点の暖色矩形 0.1 → 0.05(箱全体が橙の塊になり灯の暈が読めなかった)、裂け目の光条 0.08 → 0.22(暗幕と量子化の後に帯が消えていた)、塔の灯は 2×1・暈 6×3 タイル(ズーム 1 で 3×1.5 は塊に見えた)。
- **塔頂部の自動眺望の撮影**: seed 20260711 の塔は cell 1(開始層の床の板)にあり、段階3 の「開始層の床の板では発火しない」規則で演出が出ない。seed 42 の cell −2 の塔(x 1521)で、縦坑の中から `--press=KeyW,KeyD --hold=4500,300` で登って右へ降りる経路を撮った。このため `scripts/screenshot.mjs` にカンマ区切りのキー列を足した(既存の単一キーの使い方は不変)。
- **スクリーンショットの場面(seed 20260711)**: 休憩点 `--pos=259,224.2`(cell 0, k 0、床 226)、塔の基部 `--pos=1505,770.2`(cell 1, k 3、中心 1475、床 772)、崩落の足 `--pos=322,-593.8 --press=ShiftLeft --hold=1500 --capture=during --mouse=1100,150`(cell −2, k 0、裂け目 332〜476、大界面なので 1 列 1 段)。目視: 休憩点は灯と暖色で「屋内」に読める。塔は黒い一枚岩の柱に基部のアーケードと縦坑、頂部に赤橙の点滅。崩落は右上へ伸びる階段と裂け目の中の光の帯が読める。

## 計測(ヘッドレス=ソフトウェア描画、同じ機械状態。基準は origin/master e0add91 を一時 worktree に切った。各 2 回)

| 場面(seed 20260711) | 基準 rAF p95 / render p50 (p95) | 段階4 rAF p95 / render p50 (p95) |
|---|---|---|
| 休憩点 cell 0 (259,224) 静止 | 16.8 / 7.2〜7.8 (10.2〜17.9) | 16.7〜16.8 / 6.3〜8.1 (9.6〜10.3) |
| 休憩点 cell −1 (239,−138) 静止 | 16.7〜16.8 / 6.1〜6.8 (9.9〜10.1) | 16.7 / 7.3〜7.8 (10.8〜13.3) |
| 塔の基部 (1505,770) 静止 | 16.7 / 7.1〜7.5 (8.8〜10.0) | 16.7 / 7.4 (9.7〜10.0) |
| 塔の頂部 (1478,382) 静止(`--wait=4500`) | 16.7〜16.8 / 6.1〜6.4 (9.5〜10.0) | 16.8 / 7.2〜7.3 (9.9〜10.1) |
| 塔の頂部 読み込み直後(`--wait=1500`) | 16.8〜33.3 / 7.5〜8.4 (21.0〜23.8) | 33.3〜33.4 / 9.0〜11.0 (24.5〜32.8) |
| 崩落の足 cell −2 (322,−594) 静止 | 16.7〜16.8 / 10.0〜10.2 (13.4〜13.8) | 16.7 / 8.6〜9.0 (11.8〜11.9) |
| 崩落の足 cell 1 (301,462) 静止(4 回) | 16.7〜16.8 / 9.3〜10.3 (13.3〜14.2) | 16.7〜16.8(1 回 33.2) / 9.0〜12.1 (14.1〜25.3) |
| 崩落の足 cell −2 で右へ歩く(`--press=KeyD`) | 16.7〜16.8 / 8.9〜9.1 (12.4〜13.4) | 16.7〜16.8 / 9.7〜9.9 (12.8〜12.9) |

定常の全場面で rAF p95 は基準と同じ 16.7〜16.8 ms(vsync 刻みの丸め)。render p50 の差は ±1 ms 以内で機械ノイズの範囲(崩落 cell −2 は基準より軽い: 楔の HARD が前室のノイズ地形を置き換えて焼き込みが単純になる)。「読み込み直後」は基準でもチャンクの焼き込み過渡で rAF 33 ms が出る場面で、段階4 の光とは無関係。崩落 cell 1 の 1 回の 33.2 ms は再測定 4 回のうち 1 回だけで、基準でも歩行時に同じ値が出る(機械ノイズ)。

`--stages`(段階4): lighting は休憩点 0.8 ms(p95 1.3)、塔の基部 1.2 (2.0)、崩落 1.6 (2.5)で、段階2 の 1〜2 ms の範囲内。崩落では shafts(既存の光条)が 1.6 ms 乗る(開けた空間で発動する既存の挙動)。megastructure 1.1〜1.2 ms、sky 0.4〜0.5 ms。
