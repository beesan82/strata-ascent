# 階層界面登攀 段階2「光柱と導光」実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 界面の板を黒い量塊として描き、大穴から前室の床へ落ちる光柱と光溜まり、背景の滲みと界面の帯で「次に向かう場所」を UI なしで画面に入れる。

**Architecture:** 光柱・滲み・帯・環境光補正の幾何と強度は `src/render/beacon.ts` の純粋関数に閉じ込め、Canvas 描画(`BeaconLights` クラス、`Background` のグロー/帯、`ChunkBaker` の HARD パス)はその出力を貼るだけにする。板の見た目は `src/render/hardPlate.ts` の純粋関数(継ぎ目・リブ・エッジ強度)で決め、焼き込みは HARD タイルをアトラス/陰影パスから外して専用パスで平坦に塗る。光柱は `Lighting` の暗幕の後に `lighter` で描く。

**Tech Stack:** TypeScript 5.7, Canvas 2D, Vitest 3, Vite 6, Playwright(スクリーンショット・フレーム時間)

**Spec:** `docs/superpowers/specs/2026-10-18-blame-sim-interface-ascent-design.md`(§6 描画、§6.1〜6.3、§8 テスト方針、§9 段階2)

## Global Constraints

- 界面の座標は `src/world/interface.ts` のみから求める: 板は `[interfaceTop, interfaceBottom)`、大穴は X `[px + HOLE_OFFSET, px + OVERLOOK_RIGHT)`(= 孔 +24〜+72、中心 `px + 48`)、前室の床の行は `interfaceBottom + ANTECHAMBER_DEPTH`(= 下面 +48)。
- 光は上から来る: 板 cell の光柱色は **cell − 1**(板の上の層)のバイオームの `accent`(Y は下向き正。cell c の板は cell c の上端にあり、その上は cell c − 1)。
- 光柱: 幅 24 タイル(半幅 12)、`lighter` 合成、周期 7 秒・±15% の脈動。光溜まりは床の行の上端に置く楕円で、芯の半径 20 タイル、裾は孔の梯子(大穴中心 −48)まで。
- 滲み: 最寄りの大穴 X を中心、幅 300 タイル、追従率 0.9、強度は水平距離 0→1、256→0.15(線形、以遠 0.15)。
- 帯: カメラ Y から上下 1 画面(`h / ppt` タイル)以内の界面を、追従率 0.6 の暗い帯として遠景層に描く。
- §6.3: 前室で `ambientLevel` +0.15、光溜まりの外は −0.1(距離補間)。`Lighting` の暗幕上限 0.62 は変えない。
- 板: ほぼ黒・平坦(アトラス・陰影帯・リム・ディザ無し)、16 タイルごとに 1 px の継ぎ目線、下面に 8 タイル間隔の短い垂下リブ、上下面に 2 px の硬いエッジ(大穴に近いほど強い)。装飾・痕跡を板の面に置かない現状を維持する。
- UI マーカー(矢印・ミニマップ)は置かない。GPU 前提にしない: ヘッドレス既定(ソフトウェア描画)で開始地点・前室・見晴らし台のフレーム時間 p95 ≤ 16.7 ms。
- 決定論(同じシード・座標・時刻で同じ出力)。新規依存なし。既定シード `20260711` を変えない。コメントは日本語。
- 既存 359 テスト全通過、`tsc`・`vite build` 成功。

## Review Focus

1. **大界面(厚み 96)の光柱が長すぎて/短すぎて床に届かない** — 光柱は板の下面から床まで(厚みに依存しない 48 タイル)。Task 2 のテストで cell 2(大界面)の `top`/`floor` の差が 48 であることを確認する。
2. **孔が 2 つ画面に入る(ズームアウト時)のに 1 本しか描かれない** — `beaconsInView` は X 範囲内の全 k を返す。Task 2 で幅 600 タイルの視野に 2 本以上返ることを確認する。
3. **カメラが板の中(縦坑)にあるとき滲みの中心が飛ぶ** — 縦坑の中は `biomeCellAt` 上その板の cell なので、同じ板の大穴が選ばれ続ける。Task 2 で `beaconGlowAt(seed, px, top + 10)` が `beaconGlowAt(seed, px, bottom + 10)` と同じ X を返すことを確認する。
4. **前室の外で ambientDelta が段差を作る(壁を抜けた瞬間に暗幕が跳ぶ)** — 前室の外縁 40 タイル(`ANTECHAMBER_FADE`)で 0 へ線形に戻す。Task 2 で `x = px ± (120 + 40)` において 0、`px ± 120` では非 0 であることを確認する。
5. **部分再焼き込み(クレーター)で板のエッジ線や継ぎ目がチャンク境界で切れる** — 継ぎ目・リブ・エッジはワールド座標から決まり、リブは板の下の空気タイル側から描く(自チャンク内に収まる)。Task 1 のスクリーンショットで、チャンク境界(X, Y が 32 の倍数)をまたぐ板の下面に切れ目がないことを目視する。

## File Structure

- Create `src/render/hardPlate.ts`: 板の色定数と `hardSeamAt`, `hardRibAt`, `hardEdgeStrength`(純粋関数)。
- Create `src/render/hardPlate.test.ts`。
- Modify `src/render/chunkbake.ts:270-340`: HARD をアトラス/陰影パスから外し、仮暗幕を HARD パスに置き換える。
- Create `src/render/beacon.ts`: `nearestHoleX`, `beaconsInView`, `beaconPulse`, `glowStrength`, `beaconGlowAt`, `interfaceBandsNear`, `ambientDelta`(純粋関数)と `BeaconLights`(Canvas)。
- Create `src/render/beacon.test.ts`。
- Modify `src/render/background.ts`: `render` に滲み(先頭)と帯(末尾)を追加。
- Modify `src/render/background.test.ts`: `RecordingContext` に `createRadialGradient`, `save`, `restore`, `globalCompositeOperation`, `drawImage` を足し、滲み/帯の描画呼び出しを確認。
- Modify `src/render/renderer.ts`: `BeaconLights` を `Lighting` の後・`LightShafts` の前に描く。`ambientDelta` を `Lighting`/`LightShafts`/`Post` の `ambientLevel` に加える(空のフィルは除外: 色キーが毎フレーム変わり再生成 2.7 ms が走るため)。
- Create `scripts/frametime.mjs`: ヘッドレスで rAF 間隔を集めて p50/p95 を出す。
- Modify `README.md`: 計測スクリプトの使い方 1 行。

---

### Task 1: 超構造体材パレット(板の焼き込み)

**Files:**
- Create: `src/render/hardPlate.ts`
- Create: `src/render/hardPlate.test.ts`
- Modify: `src/render/chunkbake.ts:270-340`

**Interfaces:**
- Consumes: `TILE.HARD`, `isSolid` (`src/world/tiles.ts`); `mod`, `nearestPassage`, `HOLE_OFFSET`, `HOLE_WIDTH` (`src/world/interface.ts`); `biomeCellAt` (`src/world/biomeCells.ts`)。
- Produces(`src/render/hardPlate.ts`):
  - `export const HARD_FILL = '#05090f'`(PIXEL_PALETTE の 4 番目。鋼の fillDark `#070c12` より暗く、空のフィルより僅かに明るい)
  - `export const HARD_SEAM = '#10171f'`(STEEL.stringer)、`export const HARD_EDGE_TOP = '#4a6a84'`(STEEL.railTop)、`export const HARD_EDGE_BOTTOM = '#2a4258'`(STEEL.bayEdge)、`export const HARD_EDGE_SIDE = '#33506a'`(STEEL.post)
  - `export const SEAM_SPACING = 16`, `export const RIB_SPACING = 8`, `export const EDGE_PX = 2`, `export const EDGE_FALLOFF_TILES = 256`
  - `export function hardSeamAt(wx: number, wy: number): { v: boolean; h: boolean }` — `v = mod(wx,16)===0`, `h = mod(wy,16)===0`
  - `export function hardRibAt(wx: number): boolean` — `mod(wx, 8) === 0`
  - `export function hardEdgeStrength(dxToHole: number): number` — `1 − 0.7·min(1, |dx|/256)`(0.3..1)
  - `export function holeCenterX(px: number): number` — `px + HOLE_OFFSET + HOLE_WIDTH / 2`(= px + 48)

- [ ] **Step 1: 失敗するテストを書く(`src/render/hardPlate.test.ts`)**

```ts
import { describe, expect, it } from 'vitest';
import { hardSeamAt, hardRibAt, hardEdgeStrength, holeCenterX, SEAM_SPACING, RIB_SPACING } from './hardPlate';

describe('hardPlate', () => {
  it('継ぎ目は 16 タイルごと(負数も)', () => {
    expect(hardSeamAt(0, 5)).toEqual({ v: true, h: false });
    expect(hardSeamAt(-16, 16)).toEqual({ v: true, h: true });
    expect(hardSeamAt(7, -3)).toEqual({ v: false, h: false });
    expect(SEAM_SPACING).toBe(16);
  });
  it('垂下リブは 8 タイルごと', () => {
    expect(hardRibAt(8)).toBe(true);
    expect(hardRibAt(-8)).toBe(true);
    expect(hardRibAt(3)).toBe(false);
    expect(RIB_SPACING).toBe(8);
  });
  it('エッジ強度は大穴の真下で 1、256 以遠で 0.3、単調減少', () => {
    expect(hardEdgeStrength(0)).toBe(1);
    expect(hardEdgeStrength(256)).toBeCloseTo(0.3);
    expect(hardEdgeStrength(-1000)).toBeCloseTo(0.3);
    expect(hardEdgeStrength(64)).toBeGreaterThan(hardEdgeStrength(128));
  });
  it('大穴の中心は孔 +48', () => {
    expect(holeCenterX(196)).toBe(244);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/render/hardPlate.test.ts`
Expected: FAIL(モジュールが無い)

- [ ] **Step 3: `src/render/hardPlate.ts` を実装**

上記 Interfaces の定数と 4 関数。`mod` は `src/world/interface.ts` から import する。

- [ ] **Step 4: 通過を確認**

Run: `npx vitest run src/render/hardPlate.test.ts`
Expected: PASS(4 件)

- [ ] **Step 5: `chunkbake.ts` の HARD パス**

`bake()` 内で:
1. アトラス描画ループ(273 行付近)と後退内面ループ(302 行付近)の「自タイルの条件」を `isSolid(chunk[...])` から `chunk[...] === TILE.SOLID` に変える(近傍判定の `isSolid` はそのまま。HARD を固体として隣接ブロブに繋げる)。
2. 「仮の暗幕」ループを次の HARD パスに置き換える(P = BAKE_PPT、wx/wy はワールド座標):
   - 1 パス目(全 HARD タイル): `fillStyle = HARD_FILL` で `fillRect(tx*P, ty*P, P, P)`。
   - 2 パス目(全 HARD タイル): `hardSeamAt(wx, wy)` の `v` ならタイル左端に 1 px 縦線、`h` なら上端に 1 px 横線を `HARD_SEAM`、alpha 0.9 で引く(`fillRect` で 1 px 幅)。
   - 3 パス目(エッジ、HARD タイルのうち上下左右の近傍が `!isSolid`): `cell = biomeCellAt(seed, wy)`、`dx = wx − holeCenterX(nearestPassage(seed, cell, wx).x)`、`s = hardEdgeStrength(dx)`。上が空気なら上端に `EDGE_PX` 高さの `HARD_EDGE_TOP`(alpha `0.9·s`)、下が空気なら下端に `HARD_EDGE_BOTTOM`(alpha `0.9·s`)、左右が空気ならその辺に `HARD_EDGE_SIDE`(alpha 0.5、幅 `EDGE_PX`)。継ぎ目より後に描いてエッジが勝つ。
   - 4 パス目(リブ、`chunk[...] !== TILE.HARD` かつ上の近傍が `TILE.HARD` かつ `hardRibAt(wx)`): その空気タイルの上端から高さ `0.5·P`、幅 `0.25·P`、X 中央に `HARD_FILL` の矩形と、その右辺に 1 px の `HARD_EDGE_BOTTOM`(alpha 0.6)。空気側から描くのでチャンク下端でも切れない。
3. 既存コメント「段階2で超構造体材パレットに置き換える」を削除し、HARD パスの意図(§6.1: 平坦・継ぎ目・リブ・硬いエッジ、ディザ無し)を日本語コメントで書く。

- [ ] **Step 6: 既存テストと型**

Run: `npx vitest run src/render && npx tsc --noEmit`
Expected: 全 PASS、型エラーなし

- [ ] **Step 7: スクリーンショットで量塊を目視**

```bash
node scripts/screenshot.mjs --seed=20260711 --pos=196,31 --out=screenshots/s2-plate.png
node scripts/screenshot.mjs --seed=20260711 --pos=210,20 --out=screenshots/s2-overlook.png
```
Expected: 板が平坦な黒い面として読め、16 タイルごとの継ぎ目、下面のリブ、上下面の明るい 2 px エッジがある。チャンク境界(X=192, 224 / Y=0, 32)で継ぎ目・エッジが途切れない。

- [ ] **Step 8: コミット**

```bash
git add src/render/hardPlate.ts src/render/hardPlate.test.ts src/render/chunkbake.ts
git commit -m "feat: bake interface plates with the superstructure palette"
```

---

### Task 2: 光柱・滲み・帯・環境光補正の純粋関数

**Files:**
- Create: `src/render/beacon.ts`(純粋関数部分)
- Create: `src/render/beacon.test.ts`

**Interfaces:**
- Consumes: `passageX`, `nearestPassage`, `interfaceTop`, `interfaceBottom`, `ANTECHAMBER_DEPTH`, `ANTECHAMBER_HALF_WIDTH`, `ANTECHAMBER_FADE`, `PASSAGE_SLOT`, `PASSAGE_JITTER`, `OVERLOOK_RIGHT` (`src/world/interface.ts`); `biomeCellAt`, `biomeForCell` (`src/render/biome.ts`); `holeCenterX` (`./hardPlate`)。
- Produces(`src/render/beacon.ts`):
  - `export const BEACON_HALF_WIDTH = 12`, `export const POOL_CORE_RADIUS = 20`, `export const POOL_FRINGE_RADIUS = 48`, `export const PULSE_PERIOD = 7`, `export const PULSE_AMPLITUDE = 0.15`, `export const GLOW_WIDTH = 300`, `export const GLOW_FACTOR = 0.9`, `export const GLOW_FALLOFF = 256`, `export const GLOW_MIN = 0.15`, `export const BAND_FACTOR = 0.6`, `export const AMBIENT_IN_POOL = 0.15`, `export const AMBIENT_OUT_POOL = -0.1`
  - `export interface Beacon { cell: number; k: number; x: number; top: number; floor: number; color: string }` — `x` 大穴中心、`top` 板の下面 Y、`floor` 前室の床の行 Y(= top + 48)、`color` cell−1 の accent
  - `export function nearestHoleX(seed: number, cell: number, x: number): number` — `holeCenterX(passageX)` を k0−1..k0+1 から最寄りで選ぶ(`k0 = floor(x / PASSAGE_SLOT)`)
  - `export function beaconsInView(seed: number, camX: number, camY: number, spanX: number, spanY: number): Beacon[]` — ワールド矩形 `[camX ± spanX/2, camY ± spanY/2]` に、光柱矩形 `[x ± POOL_FRINGE_RADIUS] × [top, floor + 1]` が交差するもの。cell は `biomeCellAt(y0) − 1 .. biomeCellAt(y1) + 1`、k は `floor((x0 − PASSAGE_SLOT) / PASSAGE_SLOT) .. floor((x1 + PASSAGE_SLOT) / PASSAGE_SLOT)`。
  - `export function beaconPulse(timeSec: number): number` — `1 + PULSE_AMPLITUDE · sin(2π · timeSec / PULSE_PERIOD)`
  - `export function glowStrength(dx: number): number` — `1 − (1 − GLOW_MIN) · min(1, |dx| / GLOW_FALLOFF)`
  - `export interface BeaconGlow { x: number; top: number; floor: number; layerBottom: number; strength: number; color: string }`
  - `export function beaconGlowAt(seed: number, camX: number, camY: number): BeaconGlow` — `cell = biomeCellAt(seed, camY)`、`x = nearestHoleX(seed, cell, camX)`、`top/floor` はその cell の板、`layerBottom = interfaceTop(seed, cell + 1)`、`strength = glowStrength(camX − x)`、`color` は cell−1 の accent
  - `export interface InterfaceBand { cell: number; top: number; bottom: number }`
  - `export function interfaceBandsNear(seed: number, camY: number, spanY: number): InterfaceBand[]` — `|top − camY| ≤ spanY` または `|bottom − camY| ≤ spanY` の板を `biomeCellAt(camY − spanY) − 1 .. biomeCellAt(camY + spanY) + 1` から集める
  - `export function ambientDelta(seed: number, x: number, y: number): number` — `cell = biomeCellAt(seed, y)`、`dy = y − interfaceBottom`。`dy < 0 || dy > ANTECHAMBER_DEPTH` なら 0。`px = nearestPassage(...).x`、`fade = clamp01((ANTECHAMBER_HALF_WIDTH + ANTECHAMBER_FADE − |x − px|) / ANTECHAMBER_FADE)`、`d = |x − nearestHoleX|`、`u = clamp01((d − POOL_CORE_RADIUS) / (POOL_FRINGE_RADIUS − POOL_CORE_RADIUS))`、戻り値 `fade · (AMBIENT_IN_POOL + (AMBIENT_OUT_POOL − AMBIENT_IN_POOL) · u)`

- [ ] **Step 1: 失敗するテストを書く(`src/render/beacon.test.ts`)**

```ts
import { describe, expect, it } from 'vitest';
import {
  ambientDelta, beaconGlowAt, beaconPulse, beaconsInView, glowStrength, interfaceBandsNear, nearestHoleX,
  AMBIENT_IN_POOL, AMBIENT_OUT_POOL, GLOW_MIN, POOL_CORE_RADIUS, POOL_FRINGE_RADIUS, PULSE_AMPLITUDE, PULSE_PERIOD,
} from './beacon';
import { ANTECHAMBER_DEPTH, interfaceBottom, interfaceTop, passageX } from '../world/interface';
import { biomeForCell } from './biome';

const SEED = 20260711;
const px0 = passageX(SEED, 0, 0); // 196
const top0 = interfaceTop(SEED, 0); // -9
const bottom0 = interfaceBottom(SEED, 0); // 23

describe('beacon geometry', () => {
  it('最寄りの大穴は孔 +48', () => {
    expect(nearestHoleX(SEED, 0, px0)).toBe(px0 + 48);
    expect(nearestHoleX(SEED, 0, px0 - 100)).toBe(px0 + 48);
  });
  it('光柱は板の下面から前室の床まで(大界面でも 48)', () => {
    const [b] = beaconsInView(SEED, px0 + 48, bottom0 + 20, 100, 100);
    expect(b.x).toBe(px0 + 48);
    expect(b.top).toBe(bottom0);
    expect(b.floor).toBe(bottom0 + ANTECHAMBER_DEPTH);
    const px2 = passageX(SEED, 2, 0);
    const [g] = beaconsInView(SEED, px2 + 48, interfaceBottom(SEED, 2) + 20, 100, 100);
    expect(g.floor - g.top).toBe(48);
  });
  it('色は上の層(cell−1)の accent', () => {
    const [b] = beaconsInView(SEED, px0 + 48, bottom0 + 20, 100, 100);
    expect(b.color).toBe(biomeForCell(SEED, -1).accent);
  });
  it('視野に入らない光柱は返さない、広い視野では複数返す', () => {
    expect(beaconsInView(SEED, px0 - 400, bottom0 + 20, 100, 100)).toEqual([]);
    expect(beaconsInView(SEED, px0 + 48, bottom0 + 200, 100, 100)).toEqual([]);
    expect(beaconsInView(SEED, px0, bottom0 + 20, 1200, 100).length).toBeGreaterThanOrEqual(2);
  });
  it('決定論', () => {
    expect(beaconsInView(SEED, 300, 40, 200, 80)).toEqual(beaconsInView(SEED, 300, 40, 200, 80));
  });
});

describe('beaconPulse', () => {
  it('周期 7 秒で 1±0.15', () => {
    expect(PULSE_PERIOD).toBe(7);
    expect(beaconPulse(0)).toBeCloseTo(1);
    expect(beaconPulse(PULSE_PERIOD / 4)).toBeCloseTo(1 + PULSE_AMPLITUDE);
    expect(beaconPulse(PULSE_PERIOD * 0.75)).toBeCloseTo(1 - PULSE_AMPLITUDE);
    expect(beaconPulse(PULSE_PERIOD)).toBeCloseTo(1);
  });
});

describe('glow', () => {
  it('強度は距離 0 で 1、256 で 0.15、以遠は 0.15', () => {
    expect(glowStrength(0)).toBe(1);
    expect(glowStrength(128)).toBeCloseTo((1 + GLOW_MIN) / 2);
    expect(glowStrength(256)).toBeCloseTo(GLOW_MIN);
    expect(glowStrength(-900)).toBeCloseTo(GLOW_MIN);
  });
  it('滲みの中心は今いる層の板の最寄りの大穴。縦坑の中でも同じ板', () => {
    const below = beaconGlowAt(SEED, px0, bottom0 + 10);
    const inShaft = beaconGlowAt(SEED, px0, top0 + 10);
    expect(below.x).toBe(px0 + 48);
    expect(inShaft.x).toBe(below.x);
    expect(below.top).toBe(bottom0);
    expect(below.layerBottom).toBe(interfaceTop(SEED, 1));
    expect(below.strength).toBeCloseTo(glowStrength(-48));
  });
  it('見晴らし台(板の上)では 1 つ上の板の大穴を指す', () => {
    const g = beaconGlowAt(SEED, px0, top0 - 3);
    expect(g.top).toBe(interfaceBottom(SEED, -1));
  });
});

describe('interfaceBandsNear', () => {
  it('上下 1 画面以内の板だけ', () => {
    const near = interfaceBandsNear(SEED, bottom0 + 10, 20);
    expect(near.map((b) => b.cell)).toEqual([0]);
    expect(near[0]).toEqual({ cell: 0, top: top0, bottom: bottom0 });
    expect(interfaceBandsNear(SEED, bottom0 + 100, 20)).toEqual([]);
    expect(interfaceBandsNear(SEED, bottom0 + 100, 400).length).toBeGreaterThanOrEqual(2);
  });
});

describe('ambientDelta', () => {
  const floorY = bottom0 + ANTECHAMBER_DEPTH - 1;
  it('光溜まりの芯で +0.15、裾の外で −0.1、間は補間', () => {
    const hx = px0 + 48;
    expect(ambientDelta(SEED, hx, floorY)).toBeCloseTo(AMBIENT_IN_POOL);
    expect(ambientDelta(SEED, hx + POOL_CORE_RADIUS, floorY)).toBeCloseTo(AMBIENT_IN_POOL);
    expect(ambientDelta(SEED, hx - POOL_FRINGE_RADIUS, floorY)).toBeCloseTo(AMBIENT_OUT_POOL);
    const mid = ambientDelta(SEED, hx + (POOL_CORE_RADIUS + POOL_FRINGE_RADIUS) / 2, floorY);
    expect(mid).toBeCloseTo((AMBIENT_IN_POOL + AMBIENT_OUT_POOL) / 2);
  });
  it('前室の外縁 40 タイルで 0 へ戻り、前室の上下の外では 0', () => {
    expect(ambientDelta(SEED, px0 + 120, floorY)).not.toBe(0);
    expect(ambientDelta(SEED, px0 + 160, floorY)).toBe(0);
    expect(ambientDelta(SEED, px0 - 160, floorY)).toBe(0);
    expect(ambientDelta(SEED, px0, top0 + 5)).toBe(0);
    expect(ambientDelta(SEED, px0, bottom0 + ANTECHAMBER_DEPTH + 5)).toBe(0);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/render/beacon.test.ts`
Expected: FAIL(モジュールが無い)

- [ ] **Step 3: `src/render/beacon.ts` の純粋関数を実装**

Interfaces のとおり。`BeaconLights` クラスは Task 3 で同ファイルに足す。各関数の先頭に 1 行の日本語コメント(§6.2 / §6.3 のどの文に対応するか)。

- [ ] **Step 4: 通過を確認**

Run: `npx vitest run src/render/beacon.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/render/beacon.ts src/render/beacon.test.ts
git commit -m "feat: pure geometry for beacon columns, glow, bands and ambient delta"
```

---

### Task 3: 光柱と光溜まりの描画、環境光補正

**Files:**
- Modify: `src/render/beacon.ts`(`BeaconLights` 追加)
- Modify: `src/render/renderer.ts:85-110, 250-265`

**Interfaces:**
- Consumes: `beaconsInView`, `beaconPulse`, `ambientDelta`, 定数(Task 2); `Camera`; `mixHex`。
- Produces: `export class BeaconLights { constructor(seed: number); render(ctx, cam: Camera, w, h, ppt, timeSec): void }`。

- [ ] **Step 1: `BeaconLights.render` を実装**

`spanX = w / ppt`, `spanY = h / ppt` で `beaconsInView`。無ければ return。`ctx.save(); ctx.globalCompositeOperation = 'lighter'`。`pulse = beaconPulse(timeSec)`、`a = 0.28 · pulse`。各 beacon(`sx = (b.x − cam.x)·ppt + w/2`, `sy0 = (b.top − cam.y)·ppt + h/2`, `sy1 = (b.floor − cam.y)·ppt + h/2`):
1. **柱(柔らかい縁)**: 横方向の線形グラデ `[sx − 12·ppt, sx + 12·ppt]`、stops 0: 透明, 0.3: `rgba(color, a)`, 0.7: 同, 1: 透明。`fillRect(sx − 12·ppt, sy0, 24·ppt, sy1 − sy0)`。画面外の縦範囲は `max(sy0, 0)`〜`min(sy1, h)` に切り詰める(グラデ座標はそのまま)。
2. **柱の芯(硬い)**: 縦方向の線形グラデ `sy0 → sy1`、stops 0: `rgba(color, a·0.9)`, 1: `rgba(color, a·0.35)`。`fillRect(sx − 4·ppt, sy0, 8·ppt, sy1 − sy0)`(半幅 4 タイル、縁はぼかさない)。
3. **光溜まり**: 中心 `(sx, sy1)`、`createRadialGradient(sx, sy1, 0, sx, sy1, 48·ppt)`、stops 0: `rgba(color, a·1.3)`, `20/48`: `rgba(color, a·0.6)`, 1: 透明。`ctx.ellipse(sx, sy1, 48·ppt, 48·ppt·0.22, 0, 0, 2π)` を `fill`。横半径 48 で裾が孔の梯子(`x − 48`)に届き、梯子は半分だけ光を受ける(§6.2)。
`ctx.restore()`。色文字列は `rgba()` に変換するヘルパ(`lighting.ts` の `withAlpha` と同形。beacon.ts 内に private 関数として持つ)。

- [ ] **Step 2: `renderer.ts` に組み込む**

- フィールド `private beacons: BeaconLights`、コンストラクタで `new BeaconLights(seed)`。
- `render()` 内、`bb` の直後に `const ambient = clamp01(bb.ambientLevel + ambientDelta(this.seed, player.centerX, player.body.y))`(`clamp01` はファイル内のローカル関数)。
- `this.lighting.render(..., bb.ambientColor, ambient)`、`this.lightShafts.render(..., ambient)`、`this.post.render(ctx, w, h, ambient)` に差し替える。`drawSky` と `background.render` は `bb` のまま(空のフィルは色キーで再生成するため、連続変化させない。コメントに書く)。
- `this.lighting.render(...)` の直後・`this.lightShafts.render(...)` の前に `this.beacons.render(ctx, renderCam, w, h, ppt, timeSec)` を追加し、コメント: 「光柱と光溜まり。§6.3 により暗幕の上に lighter で描く(暗幕で消えない)。§6 の合成順ではプレイヤーの前だが、暗幕の上に置く規則を優先する」。

- [ ] **Step 3: 型とテスト**

Run: `npx tsc --noEmit && npx vitest run src/render`
Expected: 通過

- [ ] **Step 4: スクリーンショット**

```bash
node scripts/screenshot.mjs --seed=20260711 --out=screenshots/s2-spawn.png
node scripts/screenshot.mjs --seed=20260711 --pos=244,66 --out=screenshots/s2-pool.png
node scripts/screenshot.mjs --seed=20260711 --pos=196,31 --out=screenshots/s2-antechamber.png
```
Expected: (a) 開始地点で画面右端に光溜まりの裾が入る。(b) 大穴の真下で床に楕円の光溜まり、上へ伸びる柱、梯子(x=196)は裾の縁。(c) 前室の上部で板の下面から柱が落ちる。暗幕で柱が消えていない。

- [ ] **Step 5: コミット**

```bash
git add src/render/beacon.ts src/render/renderer.ts
git commit -m "feat: draw beacon columns and floor pools above the lighting veil"
```

---

### Task 4: 背景の滲みと界面の帯

**Files:**
- Modify: `src/render/background.ts`
- Modify: `src/render/background.test.ts`

**Interfaces:**
- Consumes: `beaconGlowAt`, `interfaceBandsNear`, `GLOW_WIDTH`, `GLOW_FACTOR`, `BAND_FACTOR` (Task 2); `interfaceThickness` (`src/world/interface.ts`); `STEEL`。
- Produces: `Background.render` の引数は変えない。内部に `private glow(ctx, camX, camY, w, h, ppt)` と `private bands(ctx, camY, w, h, ppt)`。

- [ ] **Step 1: 失敗するテストを書く(`background.test.ts` に追記)**

`RecordingContext` に `save(){}`, `restore(){}`, `globalCompositeOperation = 'source-over'`, `ellipse(){}`, `createRadialGradient()`(linear と同じスタブ)、`readonly fillRects: [number, number, number, number][]` を記録する `fillRect(x,y,w,h)` を足す。

```ts
describe('Background beacon glow and interface bands', () => {
  it('滲みのグラデと帯の矩形を描く', () => {
    const ctx = new RecordingContext();
    const seed = 20260711;
    // 前室の中(cell 0、板の下面 23 の下)。幅 w=680px, ppt=20 → 34 タイル
    new Background(seed).render(ctx as unknown as CanvasRenderingContext2D, 196, 40, 680, 380, 20, testBlend(0));
    expect(ctx.radialGradients).toBeGreaterThanOrEqual(1); // 滲み
    // 帯: cell 0 の板(top −9, bottom 23)は追従率 0.6 で画面内 → 高さ 32·0.6·20 = 384 px の矩形
    expect(ctx.fillRects.some(([, , , h]) => Math.abs(h - 32 * 0.6 * 20) < 1)).toBe(true);
  });
  it('板から 1 画面以上離れると帯を描かない', () => {
    const ctx = new RecordingContext();
    new Background(20260711).render(ctx as unknown as CanvasRenderingContext2D, 196, 200, 680, 380, 20, testBlend(0));
    expect(ctx.fillRects.some(([, , , h]) => Math.abs(h - 32 * 0.6 * 20) < 1)).toBe(false);
  });
});
```
(`radialGradients` は `createRadialGradient` の呼び出し回数カウンタ。)

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/render/background.test.ts`
Expected: 新 2 件 FAIL

- [ ] **Step 3: 実装**

`render()` の `farLayer` の直後に `this.glow(...)`(遠景シルエットの手前・塔/デッキの背後。構造が光を背に立つ)、ループの後・`globalAlpha = 1` の前に `this.bands(...)`。

- `glow`: `g = beaconGlowAt(seed, camX, camY)`。中心 `sx = (g.x − camX)·GLOW_FACTOR·ppt + w/2`、`syTop = (g.top − camY)·GLOW_FACTOR·ppt + h/2`、縦の広がり `ry = (g.layerBottom − g.top)·GLOW_FACTOR·ppt`(層の全高: 孔が頭上遠くでも画面に滲みが残る)。`createRadialGradient(sx, syTop, 0, sx, syTop, GLOW_WIDTH/2·ppt)` を `ctx.save(); ctx.translate(sx, syTop); ctx.scale(1, ry / (GLOW_WIDTH/2·ppt))` の下で `fillRect` し(楕円グラデ)、stops 0: `rgba(color, 0.22·strength)`, 0.5: `rgba(color, 0.07·strength)`, 1: 透明。`globalCompositeOperation = 'lighter'`。描画は画面矩形に `rect`+`clip` せず、`fillRect` の範囲を楕円の外接矩形∩画面に限定する。
- `bands`: `interfaceBandsNear(seed, camY, h / ppt)` の各帯について `y0 = (top − camY)·BAND_FACTOR·ppt + h/2`、`bh = (bottom − top)·BAND_FACTOR·ppt`。`fillStyle = STEEL.black`、`globalAlpha = 0.7` で `fillRect(0, y0, w, bh)`、下端に `STEEL.shadow`、alpha 0.6、高さ `max(1, 0.1·ppt)` の線。

- [ ] **Step 4: 通過と型**

Run: `npx vitest run src/render/background.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: スクリーンショット(孔が画面外の位置)**

```bash
node scripts/screenshot.mjs --seed=20260711 --pos=40,60 --out=screenshots/s2-glow-left.png
node scripts/screenshot.mjs --seed=20260711 --pos=196,250 --out=screenshots/s2-glow-far.png
```
Expected: (a) 孔 244 が 200 タイル右にあり、背景の右側が明るい。(b) 層の中腹でも頭上方向の滲みが読める。帯は板から 1 画面以内でのみ出る。

- [ ] **Step 6: コミット**

```bash
git add src/render/background.ts src/render/background.test.ts
git commit -m "feat: background glow toward the nearest drop hole and interface bands"
```

---

### Task 5: 計測と品質ゲート

**Files:**
- Create: `scripts/frametime.mjs`
- Modify: `README.md`(開発コマンドに 1 行)

- [ ] **Step 1: `scripts/frametime.mjs`**

`screenshot.mjs` と同じ起動(Vite dev server + chromium headless、1280×720、`--seed`, `--pos`, `--wait`)。`--seconds=4`(既定)の間 `page.evaluate` で `requestAnimationFrame` の間隔(ms)を配列に集め、Node 側で p50 / p95 / max を `console.log` する。`--budget=16.7` を超える p95 なら `process.exitCode = 1`。

- [ ] **Step 2: 3 地点を計測**

```bash
node scripts/frametime.mjs --seed=20260711
node scripts/frametime.mjs --seed=20260711 --pos=244,31
node scripts/frametime.mjs --seed=20260711 --pos=210,-12
```
Expected: 3 地点とも p95 ≤ 16.7 ms。超えた場合の削減順: (1) 滲みを 1/4 解像度のオフスクリーンに描いて拡大、(2) 光溜まりの半径を 48→36、(3) 柱の外側グラデを矩形 2 枚に置換。

- [ ] **Step 3: 完了スクリーンショット**

```bash
node scripts/screenshot.mjs --seed=20260711 --out=screenshots/s2-final-spawn.png
node scripts/screenshot.mjs --seed=20260711 --pos=196,31 --out=screenshots/s2-final-antechamber.png
node scripts/screenshot.mjs --seed=20260711 --pos=210,-12 --out=screenshots/s2-final-overlook.png
```
Expected: 板が黒い量塊、光柱と光溜まりが見え、孔が画面外でも背景の明るさで方角が読める。ページエラーなし。

- [ ] **Step 4: 全テスト・型・ビルド**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: 359 + 新規テスト全通過、ビルド成功

- [ ] **Step 5: README とコミット**

README 開発コマンドに `node scripts/frametime.mjs --seed=20260711 --pos=x,y   # rAF 間隔の p50/p95` を追加。

```bash
git add scripts/frametime.mjs README.md
git commit -m "chore: headless frame-time measurement script"
```

## 実装時の裁定(実装中)

- **光柱の強さ**: `BEACON_ALPHA` 0.28 → 0.1。柱+芯+光溜まりの重なりで accent が画面全体を飽和させた。
- **滲みの形**: 設計書の「幅 300 タイルの楕円」は 1 画面(34 タイル)内の勾配が約 1 割で、暗幕と 32 色量子化の後に左右差が残らなかった。`glowStrength` の折れ線(大穴 ±256)をそのまま横の形にし、さらに大穴が画面外のときは大穴側の端を 1.6 倍・反対側を 0.4 倍に偏らせる(`GLOW_LEAN = 0.6`、大穴が画面中央なら 0)。`GLOW_WIDTH` は削除。中心アルファは 0.6(0.22 では消え、0.45 では塔の矩形に沿った紫の斑になった)。
- **滲みの描き方**: 横グラデは present の量子化の「4 px 左と同色」の近道を外し、空の縦グラデとの組で色数が量子化キャッシュ(2^16)を溢れさせて 1 フレーム分以上遅くなった。アルファ 1/16 刻みの平坦な帯(`glowStrips`、純粋関数。頂点 X は 8 px 格子、深さは 1/16 に量子化)にして、空のフィルの作業キャンバス(`renderer.drawSky`)へ焼き込む。帯は大穴が画面外でも 12 本以下、配置が変わるのは頂点が 8 px 格子をまたぐときだけ(歩行 6 タイル/秒で約 8 回/秒、1 回約 3 ms)。レビューで、1/64 刻みのときは偏りで帯が 19〜42 本になり歩行中ほぼ毎フレーム塗り直していたことが分かり修正した(テストで固定)。`Background` は帯だけを描く。
- **§6.3 の縦の段差**: `ambientDelta` は板の下面から 4 タイル(`AMBIENT_TOP_FADE`)で 0 から立ち上げる(孔を抜けた瞬間に暗幕が 1 フレームで跳ばない)。底は連続床で越えないので下側の縁は不要。
- **光柱の描き方**: `lighter` の楕円パス 3 枚で約 3.5 ms(ソフトウェア描画)。光溜まりは重ねない環状の矩形階段(6 行×3 段、縦横比 0.18)、柱の縁と芯も平坦な段にし、`Lighting` の半解像度キャンバスへ `lighter` で描いて暗幕と一緒に主バッファへ乗せる(画素数 1/4、追加パス無し。主バッファの拡大は最近傍なので縁は硬い)。合成は scene×(1−暗幕−光α)+暗幕+光 で、光の下の下地が減る(柱の芯の下端と光溜まりの芯が重なる床際で約 22%、それ以外は 14% 以下)。
- **計測**: `scripts/frametime.mjs` と `?stats=1`(`renderer.render` と `present` の所要時間)。段階1 の基準は render p50 11〜12 ms / rAF p95 16.7〜16.8 ms で、予算 16.7 ms にほぼ余裕が無い。段階2 後は 4 地点×2 回すべて rAF p95 ≤ 16.8 ms、render p50 は基準 +0.3〜+2.3 ms(光溜まりの真下が最大)。present(量子化)がフレームの約 85% を占めるので、以降の描画追加は「平坦な色・少ない色数・lighter の画素数」を守ること。
- **テスト**: `glowStrips` のテストが、バッファ幅が帯幅の倍数でないとき最後の帯が閉じない実バグを捕まえた。

## 実装時の裁定(計画段階)

- 光溜まりの半径: 設計書 §6.2 は「半径 20」と「孔の梯子は光溜まりの左縁に立つ」(梯子は大穴中心の 48 左)を同時に言う。芯の半径を 20、裾を 48 まで伸ばす楕円グラデで両方を満たす。
- 光柱の合成位置: §6 の合成順(焼き込み → 光柱 → プレイヤー → ライト)と §6.3(暗幕の上に lighter)が矛盾する。暗幕で消えないことが段階2の目的なので、`Lighting` の後に描く。
- `ambientDelta` は暗幕・光条・ビネットにのみ掛け、空のフィルには掛けない(フィルは色キーで作業キャンバスを再生成するため、歩くたびに 2.7 ms の再描画が走る)。
- 滲みの縦の広がりは層の全高(板の下面から次の板の上面まで)。方角の手掛かりは主に水平方向で、層の中腹でも「上のどちら側か」が残るようにする。
- 板のディザ: 画面全体の量子化は維持(§6.3「量子化は行う」)。板の塗りはパレット色そのものなので、ディザは隣接パレット色(差 1〜2)へ揺れるだけで平坦に見える。
