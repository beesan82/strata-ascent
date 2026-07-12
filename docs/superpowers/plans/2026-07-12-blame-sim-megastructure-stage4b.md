# 超構造体・段階4b「セクター幹線と源(メガ施設)」実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 各セクターのハブに「源=メガ施設」(発電炉/貯水池など、通常の部屋より大きいランドマーク)を置き、セクター幹線がそこへ収束する。「配管・電線を上位へたどると、そのセクターの源に着く」を成立させる。圧倒的スケールの幹線(16384)も出す。

**Architecture:** (1) `sectorTrunkAt`(network.ts): セクター級の幹線を、地区コリドーと同じ「各セルが自分の半分を描く+共有辺の交差点を順不同ペアで一致」方式で生成(HALF大きめ=太い幹線)。(2) `megaFacilityAt`(新 megafacility.ts): 各セクターのハブに大きな源構造(壁で囲まれた大ホール+中央コア+リング状キャットウォーク+全高梯子+幹線接続口)。(3) `tileAt` 合成を `メガ施設 ?? 施設 ?? 幹線 ?? 地区NW ?? ノイズ`(源のランドマークを最優先し192の範囲で一貫。梯子保持の不変条件は維持)。到達可能性: 幹線・メガ施設はキャットウォーク+梯子で移動可、ノイズ梯子も保持。

**スコープ外(次段階): クロス系統の因果(電力地域→居住地域)** は地域境界が稀なので段階5+へ。本計画は「地域内で源へ収束するネットワーク」の縦スライス。

**Tech Stack:** 既存。**参照スペック:** `docs/superpowers/specs/2026-07-12-blame-sim-megastructure-worldgen-design.md`

**全タスク共通:** 純粋関数は決定論。既存テスト(94)回帰なし維持。物理無改修。到達可能性の不変条件維持。座標: y下向き正、CHUNK=64、SECTOR_SIZE=16384、DISTRICT_SIZE=1024、ROOM_SIZE=128。`sectorAt(seed,x,y)` は `{sx,sy,system,hubX,hubY}`(hub はセクター内相対[0,SECTOR_SIZE))を返す(段階1で実装済み)。

---

### Task 1: セクター幹線の経路判定(network.ts)

**Files:** Modify `src/world/network.ts` / Test `src/world/network.test.ts`

地区コリドーと同型だが SECTOR_SIZE スケール、太さ HALF_TRUNK=4。ハブは `sectorAt().hubX/hubY`(既存)。接続は隣接セクターとの順不同ペアハッシュ。

- [ ] **Step 1: 失敗するテストを追記**

```ts
import { sectorTrunkAt, hasTrunk } from './network';
import { sectorAt, SECTOR_SIZE } from './hierarchy';

describe('hasTrunk(順不同ペア対称)', () => {
  it('A↔B と B↔A で同じ', () => {
    expect(hasTrunk(42, 3, 4, 4, 4)).toBe(hasTrunk(42, 4, 4, 3, 4));
  });
  it('接続あり/なしが両方出る', () => {
    let yes = 0, no = 0;
    for (let i = 0; i < 60; i++) { if (hasTrunk(42, i, 0, i + 1, 0)) yes++; else no++; }
    expect(yes).toBeGreaterThan(0); expect(no).toBeGreaterThan(0);
  });
});

describe('sectorTrunkAt', () => {
  it('決定論', () => {
    expect(sectorTrunkAt(42, 50000, -30000)).toEqual(sectorTrunkAt(42, 50000, -30000));
  });
  it('セクターハブ付近は幹線が通る(ハブ中心±HALF_TRUNKで非null)', () => {
    // 接続を1つ以上持つセクターを探す
    for (let s = 0; s < 20; s++) {
      const sx = s, sy = 0;
      const hasAny = hasTrunk(42, sx, sy, sx + 1, sy) || hasTrunk(42, sx, sy, sx - 1, sy) ||
                     hasTrunk(42, sx, sy, sx, sy + 1) || hasTrunk(42, sx, sy, sx, sy - 1);
      if (!hasAny) continue;
      const sec = sectorAt(42, sx * SECTOR_SIZE, sy * SECTOR_SIZE);
      const hubWX = sx * SECTOR_SIZE + sec.hubX, hubWY = sy * SECTOR_SIZE + sec.hubY;
      expect(sectorTrunkAt(42, hubWX, hubWY)).not.toBeNull();
      return;
    }
    throw new Error('接続を持つセクターが見つからない');
  });
  it('幹線の両端一致(セクター境界を跨いで連続する点が存在)', () => {
    for (let s = 0; s < 20; s++) {
      if (!hasTrunk(42, s, 0, s + 1, 0)) continue;
      const edgeX = (s + 1) * SECTOR_SIZE;
      let meet = 0;
      for (let y = 0; y < SECTOR_SIZE; y += 4) {
        if (sectorTrunkAt(42, edgeX - 1, y) && sectorTrunkAt(42, edgeX, y)) meet++;
      }
      expect(meet).toBeGreaterThan(0);
      return;
    }
    throw new Error('東接続を持つセクターが見つからない');
  });
});
```

- [ ] **Step 2: 失敗確認** `npx vitest run src/world/network.test.ts` → FAIL(未定義)

- [ ] **Step 3: 実装(network.ts に追記)**

`conduitAt` と同じ構造を SECTOR スケールで。`sectorAt` の hub を使う。`hasTrunk`/`crossFrac` は既存の hasConduit/crossFrac と同じ順不同ハッシュ方式(salt を別値に)。`Conduit` 型を再利用。HALF_TRUNK=4。実装は conduitAt を一般化しても、コピーして SECTOR 用に別関数にしてもよいが、**両端一致の交差点キャップ(段階3で追加した仕組み)を必ず含める**こと(ハブが交差点の反対側でも継ぎ目なく繋ぐ)。

推奨: 段階3の `conduitAt` を「サイズ・HALF・ハブ取得関数・salt をパラメータ化した内部共通関数」に薄くリファクタし、`conduitAt`(地区)と `sectorTrunkAt`(セクター)がそれを呼ぶ形にする(DRY・両端一致ロジックを1箇所に)。ハブ取得: 地区は `districtHub`、セクターは `sectorAt().hub`。

- [ ] **Step 4: 通過確認** `npx vitest run src/world/network.test.ts` → PASS。`npm test` 全PASS。`npx tsc --noEmit` クリーン。両端一致テストが落ちたら交差点キャップと crossFrac の一致を数値で確認(弱めない)。

- [ ] **Step 5: コミット**
```bash
git add src/world/network.ts src/world/network.test.ts
git commit -m "feat: セクター幹線の経路判定(両端一致・トランク幅)"
```

---

### Task 2: 源=メガ施設(セクターハブの大構造)

**Files:** Create `src/world/megafacility.ts` / Test `src/world/megafacility.test.ts`

各セクターのハブ中心に、通常の部屋(128)より大きい**源構造**(一辺 MEGA=192タイル程度の大ホール)。壁で囲み、中央にコア(大きな SOLID 塊 or 空洞+中央塔)、リング状キャットウォーク数段、全高梯子、四方に幹線接続口(壁の開口)。系統でコアの形をわずかに変える(発電=中央塔、水=底の水槽、精錬=中央炉塊…程度)。タイルは SOLID/AIR/LADDER。決定論(sector の hub と system と hash)。

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, expect, it } from 'vitest';
import { megaFacilityAt, MEGA_SIZE } from './megafacility';
import { sectorAt, SECTOR_SIZE } from './hierarchy';
import { TILE } from './tiles';

function sectorHubWorld(seed: number, sx: number, sy: number) {
  const s = sectorAt(seed, sx * SECTOR_SIZE, sy * SECTOR_SIZE);
  return { x: sx * SECTOR_SIZE + s.hubX, y: sy * SECTOR_SIZE + s.hubY };
}

describe('megaFacilityAt', () => {
  it('決定論', () => {
    const { x, y } = sectorHubWorld(42, 0, 0);
    expect(megaFacilityAt(42, x, y)).toBe(megaFacilityAt(42, x, y));
  });
  it('ハブ周辺に大構造(SOLID/AIR/LADDER が出る)', () => {
    const { x, y } = sectorHubWorld(42, 0, 0);
    const kinds = new Set<number | null>();
    for (let dy = -MEGA_SIZE / 2; dy < MEGA_SIZE / 2; dy += 2) {
      for (let dx = -MEGA_SIZE / 2; dx < MEGA_SIZE / 2; dx += 2) {
        kinds.add(megaFacilityAt(42, Math.round(x + dx), Math.round(y + dy)));
      }
    }
    expect(kinds.has(TILE.SOLID)).toBe(true);
    expect(kinds.has(TILE.AIR)).toBe(true);
    expect(kinds.has(TILE.LADDER)).toBe(true);
  });
  it('ハブから十分離れた点は null', () => {
    const { x, y } = sectorHubWorld(42, 0, 0);
    expect(megaFacilityAt(42, x + MEGA_SIZE, y + MEGA_SIZE)).toBeNull();
  });
  it('全高を貫く内部梯子が存在(縦移動保証)', () => {
    const { x, y } = sectorHubWorld(42, 0, 0);
    let maxRun = 0;
    for (let dx = -MEGA_SIZE / 2; dx < MEGA_SIZE / 2; dx++) {
      let run = 0, best = 0;
      for (let dy = -MEGA_SIZE / 2; dy < MEGA_SIZE / 2; dy++) {
        if (megaFacilityAt(42, Math.round(x + dx), Math.round(y + dy)) === TILE.LADDER) { run++; best = Math.max(best, run); }
        else run = 0;
      }
      maxRun = Math.max(maxRun, best);
    }
    expect(maxRun).toBeGreaterThan(MEGA_SIZE * 0.4);
  });
});
```

- [ ] **Step 2: 失敗確認** → FAIL(未作成)

- [ ] **Step 3: 実装** `src/world/megafacility.ts`。ハブ中心の矩形 [hub-MEGA/2, hub+MEGA/2) 内なら構造タイル、外なら null。外郭壁(厚3)+四方に接続口(AIR開口)、リングキャットウォーク(MEGA/4 間隔の水平床、開口つき)、中央コア(system で形状変化)、全高の梯子列を2本以上(縦移動保証、幅2で偶数走査に強い)。崩壊要素は軽く。系統は `sectorAt(seed,x,y).system` で取得。決定論は hub 座標と hash。

- [ ] **Step 4: 通過確認** → PASS。`npm test` 全PASS。`npx tsc --noEmit` クリーン。

- [ ] **Step 5: コミット**
```bash
git add src/world/megafacility.ts src/world/megafacility.test.ts
git commit -m "feat: 源=メガ施設(セクターハブの大構造)"
```

---

### Task 3: tileAt 統合と到達可能性

**Files:** Modify `src/world/worldgen.ts` / Modify `src/world/network.ts`(sectorTrunkTileAt)/ Test `src/world/worldgen.test.ts`

- [ ] **Step 1: sectorTrunkTileAt を追加(network.ts)**

`networkTileAt` と同型で、`sectorTrunkAt` を使い role→TILE。全系統(ゲートなし)。

- [ ] **Step 2: 失敗するテストを追記(worldgen.test.ts)** — 到達可能性の維持(ノイズLADDER保持)+ findSpawn 安全 + メガ施設/幹線がタイルに出る:

```ts
import { megaFacilityAt } from './megafacility';
// ... 既存 import に追加
describe('段階4b 統合', () => {
  it('ノイズLADDER保持は維持', () => {
    let checked = 0;
    for (let y = -400; y < 0 && checked < 60; y++)
      for (let x = 0; x < 1024 && checked < 60; x++)
        if (noiseTileAt(42, x, y) === TILE.LADDER) { expect(tileAt(42, x, y)).toBe(TILE.LADDER); checked++; }
    expect(checked).toBeGreaterThan(0);
  });
  it('findSpawn は SOLID の中でない', () => {
    for (const seed of [1, 42, 20260711]) {
      const { x, y } = findSpawn(seed);
      expect(tileAt(seed, Math.floor(x), Math.floor(y))).not.toBe(TILE.SOLID);
    }
  });
});
```

- [ ] **Step 3: 失敗確認** → FAIL(megaFacilityAt が tileAt に未統合、あるいは import 未使用)

- [ ] **Step 4: 実装(worldgen.ts の合成更新)**

```ts
import { networkTileAt, sectorTrunkTileAt } from './network';
import { megaFacilityAt } from './megafacility';
// ...
export function tileAt(seed: number, x: number, y: number): Tile {
  const base = noiseTileAt(seed, x, y);
  if (base === TILE.LADDER) return base;
  const overlay = megaFacilityAt(seed, x, y)
    ?? facilityTileAt(seed, x, y)
    ?? sectorTrunkTileAt(seed, x, y)
    ?? networkTileAt(seed, x, y);
  return overlay ?? base;
}
```
循環import注意: megafacility.ts は hierarchy/noise/tiles のみ。network.ts も同様。worldgen が両方を import。

- [ ] **Step 5: 通過確認** `npm test` 全PASS(既存の梯子/決定論回帰なし)。`npx tsc --noEmit` クリーン。

- [ ] **Step 6: コミット**
```bash
git add src/world/worldgen.ts src/world/network.ts src/world/worldgen.test.ts
git commit -m "feat: セクター幹線・メガ施設をtileAtへ統合(段階4b)"
```

---

### Task 4: 目視「幹線をたどると源へ」+最終確認

**Files:** 必要なら chunkbake の幹線/メガ施設 decor(任意・最小)/ 目視

- [ ] **Step 1: (任意)幹線の太配管 decor** — 幹線コリドーに太い配管/バスダクトの decor を足すと「源へ続く大動脈」感が出る。既存の配管decorがconduitベースなら、sectorTrunkAt も見て太線を足す(最小)。過剰にしない。ゲームプレイ不変。

- [ ] **Step 2: 全テスト・型・ビルド** `npm test && npx tsc --noEmit && npm run build` → 全PASS

- [ ] **Step 3: 目視** — セクターハブ座標を特定(使い捨てテストで seed 20260711 の接続を持つセクターの hub ワールド座標を print→削除)。撮る:
```
node scripts/screenshot.mjs --debug=hierarchy:30000 --pos=<hubX>,<hubY> --out=screenshots/s4b-map.png   # ハブ十字と幹線の位置
node scripts/screenshot.mjs --pos=<hubX>,<hubY> --out=screenshots/s4b-mega.png                          # 源=メガ施設(大ホール+コア+梯子)
node scripts/screenshot.mjs --pos=<hub近傍の幹線上>,<y> --out=screenshots/s4b-trunk.png                  # 太い幹線コリドー
```
PNGをReadで確認: セクターハブに通常部屋より明らかに大きい源構造(囲われた大ホール+中央コア+複数キャットウォーク+梯子)が見え、太い幹線がそこへ伸びている。系統色で塗られている。到達可能性(幹線・メガ内を歩き/昇り可、ノイズ梯子保持)が視覚的に破綻していない。

- [ ] **Step 4: コミット**
```bash
git add -A
git commit -m "feat: 幹線decorと目視確認(段階4b)"
```

---

## この計画のスコープ外(次段階)
- 段階5: クロス系統の因果(電力地域→消費地域の地域境界トランク)、セクター遠景シルエット、稀少ランドマーク、水面など施設decor、cosmeticクリーンアップ(未使用パレット等)、総合チューニング

## 留意
- 因果は「地域内で源(セクターのメガ施設)へ収束するネットワーク」として成立。クロス系統は稀な地域境界のため段階5+。
- 到達可能性: 幹線・メガ施設はキャットウォーク+梯子を含み、ノイズ梯子も保持(合成順)。完全な全域端到端保証は将来+重力子砲。
- メガ施設(192)は部屋(128)やチャンク(64)より大きく複数チャンクにまたがるが、ハブ座標基準の純粋関数なのでチャンク局所で一貫。
- 段階3の両端一致ロジックを共通化して幹線でも使う(DRY)。共通化でリグレッションが出ないよう、conduitAt の既存テストが緑のままであることを Task 1 で必ず確認。
