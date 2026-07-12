# 超構造体・段階4「全系統の施設と地域配色」実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 施設とネットワークを全系統に広げ、配色を「高度」ではなく「地域=系統」で決める。歩く地域ごとに施設の中身も色・性格も変わる。「ここは水の領域」「ここは電力の領域」と読める。

**Architecture:** (1) `facility.ts` の水系統ゲートを外し全 present room をチャンバー化。(2) `networkTileAt`+chunkbake配管decorの水系統ゲートを外し全地域で配管コリドー。(3) `biome.ts` を「系統→バイオーム」写像に作り替え、`biomeAt`/`biomeBlend` を `(seed,x,y)` の地域系統ベースに。renderer/chunkbake の呼び出しを座標渡しに更新。到達可能性の不変条件(施設/配管はノイズ LADDER を上書きしない)は維持。

**スコープ(重要): セクター幹線と因果(発電→電線→ポンプ)は段階4bへ繰り延べ。** 本計画は「全系統の施設・配管+地域配色」の縦スライス。

**Tech Stack:** 既存。**参照スペック:** `docs/superpowers/specs/2026-07-12-blame-sim-megastructure-worldgen-design.md`

**全タスク共通:**
- 純粋関数は決定論。既存テスト(95件)は、意図的に挙動を変える biome テスト以外は回帰なし維持。物理は無改修
- スクショ: `node scripts/screenshot.mjs`。exit0+[pageerror]無し
- 座標: y下向き正、CHUNK=64、REGION_SIZE=262144、DISTRICT_SIZE=1024、ROOM_SIZE=128

---

### Task 1: 全系統の施設チャンバー(facility.ts の水ゲート除去)

**Files:**
- Modify: `src/world/facility.ts`
- Test: `src/world/facility.test.ts`(追記・更新)

現状 `facilityTileAt` は `system!=='water'` で null を返す。これを外し、**全系統の present room** をチャンバー化する。チャンバー骨格(外郭壁・入口・内部梯子・キャットウォーク・崩壊)は共通。系統ごとの内部フレーバーは軽く差をつける(例: 部屋タイプで band 数やコア有無を変える)が、タイル種は SOLID/AIR/LADDER のまま(色・見た目は biome/decor が担う)。

- [ ] **Step 1: テストを更新(水限定の前提を全系統へ)**

`src/world/facility.test.ts` の「水系統でない present room は null」テストを削除し、代わりに次を追加。既存の findWaterRoom は残してよいが、汎用の findRoomOfSystem を使う:

```ts
describe('facilityTileAt 全系統(段階4)', () => {
  it('どの系統の present room でもチャンバーが生成される(SOLID/AIR/LADDER/null が出る)', () => {
    for (const sys of ['water', 'power', 'habitation', 'disposal', 'foundry'] as const) {
      const { rmx, rmy } = findRoomOfSystem(42, sys);
      const kinds = new Set<number | null>();
      for (let ly = 0; ly < ROOM_SIZE; ly += 2) {
        for (let lx = 0; lx < ROOM_SIZE; lx += 2) {
          kinds.add(facilityTileAt(42, rmx * ROOM_SIZE + lx, rmy * ROOM_SIZE + ly));
        }
      }
      expect(kinds.has(TILE.SOLID)).toBe(true);
      expect(kinds.has(TILE.AIR)).toBe(true);
      expect(kinds.has(TILE.LADDER)).toBe(true);
      expect(kinds.has(null)).toBe(true);
    }
  });

  it('不在(present=false)の room は null', () => {
    // present=false のセルを探す
    for (let rmx = 0; rmx < 2000; rmx++) {
      if (!roomAt(42, rmx * ROOM_SIZE, 0).present) {
        expect(facilityTileAt(42, rmx * ROOM_SIZE + 64, 64)).toBeNull();
        return;
      }
    }
    throw new Error('present=false の room が見つからない');
  });
});
```

(既存の「縦LADDER貫通」「決定論」テストは水room対象のまま残す。`findRoomOfSystem` は段階2で `facility.test.ts` に定義済みのはず。無ければ段階3計画のヘルパを移植)

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/world/facility.test.ts`
Expected: FAIL(power等でチャンバーが出ず null になる=現状の水ゲート)

- [ ] **Step 3: 実装(水ゲート除去)**

`facility.ts` 冒頭の `if (regionAt(seed, x, y).system !== 'water') return null;` を削除。`roomAt(...).present` が false のときだけ null(不在)を返す。それ以外は現行のチャンバー生成ロジックをそのまま全系統に適用。

系統フレーバー(軽微・任意): `regionAt(seed,x,y).system` を取り、band 数の基準を系統でわずかに変える程度(例: `foundry`/`power` は band を1増やして機械的、`habitation` は減らして広間的)。過剰にしない。タイル種は SOLID/AIR/LADDER のまま。

- [ ] **Step 4: 通過を確認**

Run: `npx vitest run src/world/facility.test.ts` → PASS。`npm test` → 全PASS(到達可能性テスト回帰なし: チャンバーは依然ノイズ LADDER を上書きしない=合成順で保証)。`npx tsc --noEmit` クリーン

- [ ] **Step 5: コミット**

```bash
git add src/world/facility.ts src/world/facility.test.ts
git commit -m "feat: 全系統の施設チャンバー(水ゲート除去)"
```

---

### Task 2: 全系統のネットワーク(配管コリドーを全地域へ)

**Files:**
- Modify: `src/world/network.ts`
- Modify: `src/render/chunkbake.ts`(配管decorの水ゲート除去)
- Test: `src/world/network.test.ts`(更新)

- [ ] **Step 1: テスト更新**

`network.test.ts` の「水系統でない region では null」テストを、「全系統でコリドーがタイル化される」テストに置換:

```ts
it('全系統でコリドー上は role に応じた TILE(段階4)', () => {
  for (const sys of ['power', 'habitation', 'disposal', 'foundry'] as const) {
    // 該当systemのregion原点を探す
    let origin: { rwx: number; rwy: number } | null = null;
    for (let r = 0; r < 24 && !origin; r++) {
      for (const [rx, ry] of [[r, 0], [0, r], [r, -1], [-1, r], [r, r]] as const) {
        if (regionAt(42, rx * REGION_SIZE, ry * REGION_SIZE).system === sys) {
          origin = { rwx: rx * REGION_SIZE, rwy: ry * REGION_SIZE }; break;
        }
      }
    }
    if (!origin) continue; // その系統が近傍に無ければskip
    const bx = Math.floor(origin.rwx / DISTRICT_SIZE), by = Math.floor(origin.rwy / DISTRICT_SIZE);
    let sawConduit = false;
    for (let dyi = 0; dyi < 3 && !sawConduit; dyi++) {
      for (let dxi = 0; dxi < 3 && !sawConduit; dxi++) {
        for (let ly = 0; ly < DISTRICT_SIZE && !sawConduit; ly += 8) {
          for (let lx = 0; lx < DISTRICT_SIZE; lx += 8) {
            const wx = (bx + dxi) * DISTRICT_SIZE + lx, wy = (by + dyi) * DISTRICT_SIZE + ly;
            if (conduitAt(42, wx, wy) && networkTileAt(42, wx, wy) !== null) { sawConduit = true; break; }
          }
        }
      }
    }
    expect(sawConduit).toBe(true);
  }
});
```

(段階3の「水系統でない region では null」テストは削除)

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/world/network.test.ts`
Expected: FAIL(非水系統で networkTileAt が null)

- [ ] **Step 3: 実装**

`network.ts` の `networkTileAt` 冒頭 `if (regionAt(seed, x, y).system !== 'water') return null;` を削除(全地域で conduit をタイル化)。`conduitAt` は元々 region 非依存なのでそのまま。

`chunkbake.ts` の配管decorの水ゲート `if (regionAt(this.seed, wx, wy).system !== 'water') continue;` を削除(全地域のコリドーに配管decorを描く)。decor色は既に `biome.accent` なので系統ごとに色が変わる。

- [ ] **Step 4: 通過を確認**

Run: `npx vitest run src/world/network.test.ts` → PASS。`npm test` → 全PASS。`npx tsc --noEmit` クリーン。既存の worldgen 梯子・決定論テスト回帰なし(networkもノイズLADDERを上書きしない)

- [ ] **Step 5: コミット**

```bash
git add src/world/network.ts src/render/chunkbake.ts src/world/network.test.ts
git commit -m "feat: 全系統のネットワーク配管(水ゲート除去)"
```

---

### Task 3: 地域=系統で配色(biome.ts を地域ベースへ)

**Files:**
- Modify: `src/render/biome.ts`
- Modify: `src/render/renderer.ts`
- Modify: `src/render/chunkbake.ts`
- Test: `src/render/biome.test.ts`(全面更新)

配色選択を「高度 stratum」から「地域 system」へ移す。5系統それぞれに配色を割り当て、地域ごとに世界の色・性格が変わる。

系統→配色の割当(既存4パレット流用+foundryに新パレット):
- water → 大空洞帯(青)
- habitation → 居住区跡(青緑)
- disposal → 廃棄物層(琥珀)
- power → 上層(蒼白/紫)
- foundry → 新規(赤橙・溶鉱)

- [ ] **Step 1: テストを全面更新**

`src/render/biome.test.ts` を次に置換(高度ベースのテストを地域ベースへ):

```ts
import { describe, expect, it } from 'vitest';
import { biomeForSystem, biomeAt, biomeBlend, mixHex, SYSTEM_BIOME } from './biome';
import { regionAt, REGION_SIZE } from '../world/hierarchy';

describe('biomeForSystem', () => {
  it('biomeForSystem は SYSTEM_BIOME と一致', () => {
    expect(biomeForSystem('water')).toBe(SYSTEM_BIOME.water);
    expect(biomeForSystem('foundry')).toBe(SYSTEM_BIOME.foundry);
  });
  it('全系統に配色があり、パラメータが妥当', () => {
    for (const sys of ['water', 'power', 'habitation', 'disposal', 'foundry'] as const) {
      const b = SYSTEM_BIOME[sys];
      expect(b.ambientLevel).toBeGreaterThan(0);
      expect(b.ambientLevel).toBeLessThanOrEqual(1);
      expect(b.palette.fillMid).toMatch(/^#[0-9a-f]{6}$/i);
      expect(b.ambientColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(b.bgLayers.length).toBeGreaterThanOrEqual(2);
    }
  });
  it('系統ごとに異なる配色(少なくとも fillMid が全て異なる)', () => {
    const mids = new Set(['water', 'power', 'habitation', 'disposal', 'foundry'].map(
      (s) => SYSTEM_BIOME[s as keyof typeof SYSTEM_BIOME].palette.fillMid));
    expect(mids.size).toBe(5);
  });
});

describe('biomeAt(地域ベース)', () => {
  it('その座標の地域 system の配色を返す(決定論)', () => {
    const b = biomeAt(42, 5000, -3000);
    expect(biomeAt(42, 5000, -3000)).toBe(b);
    expect(b).toBe(SYSTEM_BIOME[regionAt(42, 5000, -3000).system]);
  });
  it('別地域(REGION_SIZE 先)では別 system → 別配色になりうる', () => {
    const systems = new Set<string>();
    for (let i = 0; i < 24; i++) systems.add(regionAt(42, i * REGION_SIZE, 0).system);
    expect(systems.size).toBeGreaterThan(1); // 複数系統が存在
  });
});

describe('biomeBlend(地域ベース)', () => {
  it('地域内では from=to=地域配色, t=0(決定論)', () => {
    const bb = biomeBlend(42, 5000, -3000);
    expect(biomeBlend(42, 5000, -3000)).toEqual(bb);
    expect(bb.t).toBe(0);
    expect(bb.from).toBe(bb.to);
    expect(bb.ambientColor).toBe(bb.from.ambientColor);
    expect(bb.ambientLevel).toBe(bb.from.ambientLevel);
  });
});

describe('mixHex', () => {
  it('端点と中点', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/render/biome.test.ts` → FAIL(新API未定義)

- [ ] **Step 3: 実装(biome.ts)**

`biome.ts` を次の方針で更新:
- `BgLayer`/`Biome`/`mixHex` は維持。既存の5 `BIOMES` 配列は残してよい(パレット定義の供給源)。
- `System` を import: `import { regionAt, type System } from '../world/hierarchy';`(hierarchy が System を export 済み)。`STRATUM_HEIGHT` import は不要になるので削除。
- foundry 用の新 Biome を1つ追加(赤橙):
```ts
const FOUNDRY: Biome = {
  name: '精錬炉', ambientColor: '#4a2620', ambientLevel: 0.44,
  palette: { fillDark: '#241310', fillMid: '#432018', fillLight: '#6b3426', edge: '#d06a3c', line: '#160b08' },
  accent: '#e8834a',
  bgLayers: [
    { factor: 0.2, color: '#2a1512', density: 0.5, kind: 'tower' },
    { factor: 0.4, color: '#3a1d18', density: 0.45, kind: 'deck' },
  ],
};
```
- 系統→配色の写像:
```ts
export const SYSTEM_BIOME: Record<System, Biome> = {
  water: BIOMES[3],       // 大空洞帯(青)
  habitation: BIOMES[1],  // 居住区跡(青緑)
  disposal: BIOMES[2],    // 廃棄物層(琥珀)
  power: BIOMES[4],       // 上層(蒼白/紫)
  foundry: FOUNDRY,       // 精錬炉(赤橙)
};

export function biomeForSystem(system: System): Biome {
  return SYSTEM_BIOME[system];
}
```
- `biomeAt`/`biomeBlend` を地域ベースへ:
```ts
/** ワールド座標 → その地域の系統に対応する配色 */
export function biomeAt(seed: number, x: number, y: number): Biome {
  return SYSTEM_BIOME[regionAt(seed, x, y).system];
}

/** 地域内は単一配色(t=0)。地域境界は稀なので遷移補間はしない(照明が均す) */
export function biomeBlend(seed: number, x: number, y: number): BiomeBlend {
  const b = biomeAt(seed, x, y);
  return { from: b, to: b, t: 0, ambientLevel: b.ambientLevel, ambientColor: b.ambientColor };
}
```
- 旧 `indexAt`(高度ベース)は削除。

- [ ] **Step 4: renderer.ts / chunkbake.ts の呼び出し更新**

`renderer.ts`:
- `const bb = biomeBlend(player.body.y);` → `const bb = biomeBlend(this.seed, player.centerX, player.body.y);`(Renderer は seed を保持済み。player.centerX があるはず。無ければ player.body.x + w/2 等で中心x)

`chunkbake.ts`:
- import を `import { biomeForSystem } from './biome';` に。`import { stratumIndexAt } from '../world/strata';` は不要なら削除。`BIOMES` import は atlasFor が使うなら残す。
- チャンクのバイオーム選択を高度→地域へ: 現行 `const bIdx = stratumIndexAt(centerY) % BIOMES.length; const biome = BIOMES[bIdx];` を
```ts
const centerX = cx * CHUNK_SIZE + CHUNK_SIZE / 2;
const centerY = cy * CHUNK_SIZE + CHUNK_SIZE / 2;
const biome = biomeForSystem(regionAt(this.seed, centerX, centerY).system);
```
に変更。`atlasFor(biomeIdx)` はキーを biome ベースへ: `atlasByBiome` を `Map<string, Atlas>` にし、キーを `biome.name`(or system)にする。`atlasFor` の引数を `biome: Biome` にして `generateAtlas(biome.palette)` をキャッシュ。呼び出しを `this.atlasFor(biome)` に。

(regionAt は既に chunkbake で import 済み)

- [ ] **Step 5: 検証(テスト+型+目視)**

Run: `npm test && npx tsc --noEmit`
Expected: 全PASS(biome.test は新APIで緑。renderer/chunkbake の型整合)

Run: 複数地域を撮って系統ごとに色が違うことを確認。まず階層マップで各系統の region 座標を掴む:
```
node scripts/screenshot.mjs --debug=hierarchy:600000 --pos=100,-600 --out=screenshots/s4-map.png
```
map から複数系統(色・ラベル)の region を読み、各系統の region 内部へ寄って通常描画で撮る(例):
```
node scripts/screenshot.mjs --pos=<water region内>,<y> --out=screenshots/s4-water.png
node scripts/screenshot.mjs --pos=<power region内>,<y> --out=screenshots/s4-power.png
node scripts/screenshot.mjs --pos=<foundry region内>,<y> --out=screenshots/s4-foundry.png
```
PNGをReadで確認: 地域ごとに**タイル色・環境光・背景・配管accent色**が系統色になっている(水=青、電力=蒼白紫、廃棄=琥珀、精錬=赤橙、居住=青緑)。施設チャンバーと配管コリドーが全系統で出ている。

- [ ] **Step 6: コミット**

```bash
git add src/render/biome.ts src/render/renderer.ts src/render/chunkbake.ts src/render/biome.test.ts
git commit -m "feat: 配色を地域=系統ベースへ(全系統の色・性格)"
```

---

### Task 4: 段階4の最終確認

- [ ] **Step 1: 全テスト・型・ビルド**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: 全PASS、ビルド成功

- [ ] **Step 2: 目視総合**

複数系統の地域を歩き、施設・配管・色が系統ごとに変わること、到達可能性(ノイズ梯子保持+チャンバー/コリドーの移動)が保たれていることを確認。階層マップで系統分布も確認。

- [ ] **Step 3: 未コミット変更があればコミット**

---

## この計画のスコープ外(次段階)
- 段階4b: セクター幹線(トランク)+因果(発電炉→電線→消費施設の実接続)。クロス地域/クロスセクターの源→消費ルーティング
- 段階5: セクター遠景シルエット、稀少ランドマーク、水面など施設decor、総合チューニング
- 段階4は「全系統の施設・配管+地域配色」の縦スライス。因果と幹線は段階4b。

## 留意
- 地域境界は 262144 タイルごとと稀なので、配色は広大な範囲で一定(=「広大な機能地域」の圧倒感)。局所の変化は施設/地区/部屋/崩壊の多様性が担う。配色の遷移補間はしない(境界を跨ぐことが稀+照明が均す)。もしプレイ感が単調すぎるなら、段階5で地域サイズや配色の副変調を再検討する。
- foundry パレットは新規なので、明るさ/彩度が他系統と浮かないかを目視で確認・微調整。
- 到達可能性の不変条件(ノイズ LADDER 保持)は合成順で維持。全系統化で施設/配管が増えるが、上昇路は常に保たれる。
