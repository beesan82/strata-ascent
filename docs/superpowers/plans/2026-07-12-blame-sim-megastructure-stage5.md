# 超構造体・段階5「遠景スケールと発見・仕上げ」実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 遠景に巨大構造のシルエットと稀少な巨大ランドマークを描き、圧倒的スケールと「あれは何だ」の発見を出す。施設のdecor(水面など)と cosmetic クリーンアップで全体を仕上げる。

**Architecture:** すべて**視覚のみ**(当たり判定・tileAt は変更しない)ので到達可能性リスクなし。(1) `background.ts` に遠景の巨大シルエット層+稀少ランドマーク(決定論・低頻度)。(2) `chunkbake`/`decor` に施設のフレーバーdecor(水面帯など)。(3) cosmetic クリーンアップ(未使用パレット・古いコメント・N/S港整合)。

**スコープ外: クロス系統の因果**(電力地域→消費地域の地域境界トランク)は稀な地域境界依存のため見送り。地域内で源へ収束する既存の因果で足りる。ゲームプレイ(tileAt/physics)は一切変更しない。

**Tech Stack:** 既存。**参照スペック:** `docs/superpowers/specs/2026-07-12-blame-sim-megastructure-worldgen-design.md`

**全タスク共通:** 決定論。既存テスト(107)回帰なし維持。tileAt/physics 無改修(視覚のみ)。スクショで目視。座標: y下向き正、SECTOR_SIZE=16384。

---

### Task 1: 遠景の巨大シルエットと稀少ランドマーク(背景層)

**Files:** Modify `src/render/background.ts` / Test `src/render/background.test.ts`(新規・決定論の軽量テスト)

現状の background は近距離のtower/deck/hazeパララックス。ここに**最遠層の巨大シルエット**を足す: 極低パララックス係数(0.05前後)で、画面より大きい巨大構造(塔・ドーム・ガントリー・リング)のシルエットをごく淡く描く。さらに**稀少ランドマーク**: 低確率(数セクターに1つ程度)で、桁違いに巨大/異質なシルエット(例: 画面を貫く超巨大柱、傾いたリング構造)を描き、「あれは何だ」を作る。すべて決定論(hash2 と粗いグリッド)。系統色を薄く乗せる。

- [ ] **Step 1: 決定論の軽量テストを書く**

background の描画は目視だが、シルエット配置の決定論と稀少度は純粋関数に切り出してテストする。`background.ts` に配置計算のヘルパを純粋関数として公開:

`src/render/background.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { farSilhouettes, rareLandmarkAt } from './background';

describe('farSilhouettes', () => {
  it('決定論: 同じ範囲・シードなら同じ配置', () => {
    const a = farSilhouettes(42, 0, 100000);
    const b = farSilhouettes(42, 0, 100000);
    expect(a).toEqual(b);
  });
  it('広域で複数のシルエットが返る', () => {
    expect(farSilhouettes(42, 0, 200000).length).toBeGreaterThan(2);
  });
  it('各シルエットは種別と位置と大きさを持つ', () => {
    for (const s of farSilhouettes(42, 0, 200000)) {
      expect(['tower', 'dome', 'gantry', 'ring']).toContain(s.kind);
      expect(s.w).toBeGreaterThan(0);
      expect(s.h).toBeGreaterThan(0);
    }
  });
});

describe('rareLandmarkAt', () => {
  it('決定論', () => {
    expect(rareLandmarkAt(42, 5)).toEqual(rareLandmarkAt(42, 5));
  });
  it('稀少: 大半のスロットは landmark なし(null)', () => {
    let present = 0;
    const N = 200;
    for (let i = 0; i < N; i++) if (rareLandmarkAt(42, i)) present++;
    expect(present).toBeGreaterThan(0);
    expect(present).toBeLessThan(N * 0.25); // 稀少
  });
});
```

- [ ] **Step 2: 失敗確認** → FAIL(ヘルパ未定義)

- [ ] **Step 3: 実装(background.ts)**

`farSilhouettes(seed, camXtiles, spanTiles): { kind, x, y, w, h, color }[]` — 遠景スロット(例 8000タイル間隔)ごとに hash で巨大シルエットを配置(種別・寸法・色を hash から)。純粋。
`rareLandmarkAt(seed, slot): { kind, w, h } | null` — 粗いスロット(例セクター単位)ごとに低確率(<0.15)で巨大ランドマークを返す。純粋。
`Background.render(...)` に最遠層の描画を追加: `farSilhouettes` と `rareLandmark` を極低パララックス・低alpha(0.06〜0.12)で、近景層より背後に描く。系統色(bb)を薄く乗せる。既存の tower/deck/haze はそのまま前面側に。

描画は視覚のみ。tileAt 不変。

- [ ] **Step 4: 通過+目視**

Run: `npm test`(107+新規)、`npx tsc --noEmit`、`npm run build` → 全PASS
Run: 複数箇所を撮る。特に稀少ランドマークが見える座標を探して撮る:
```
node scripts/screenshot.mjs --seed=20260711 --pos=2736,10823 --out=screenshots/s5-far.png
node scripts/screenshot.mjs --seed=20260711 --pos=100000,-5000 --out=screenshots/s5-far2.png
```
PNGをReadで確認: 闇/背景の奥に巨大な塔・ドーム・リング等のシルエットがごく淡く見え、スケール感が増している。稀少ランドマークが「あれは何だ」の存在感を出している。前景のプレイ視認性を邪魔していない(淡い)。

- [ ] **Step 5: コミット**
```bash
git add src/render/background.ts src/render/background.test.ts
git commit -m "feat: 遠景の巨大シルエットと稀少ランドマーク(圧倒的スケール)"
```

---

### Task 2: 施設フレーバーdecorとcosmeticクリーンアップ

**Files:** Modify `src/render/chunkbake.ts` または `src/render/decor.ts`(施設decor)/ `src/render/biome.ts`(未使用パレット)/ 各所コメント

- [ ] **Step 1: 施設フレーバーdecor(最小)**

水系の貯水チャンバー/メガ施設の下部に「水面」帯(半透明の水色の水平ライン+ゆらぎ)を decor で描く(視覚のみ)。実装は chunkbake の焼き込み時、水系region かつ facility/mega の内部下部で水面ラインを引く程度。過剰にしない。他系統は既存のaccent配管で足りるので追加は任意。

- [ ] **Step 2: cosmeticクリーンアップ**

- `biome.ts`: `BIOMES[0]`(最下層 steel)が SYSTEM_BIOME で未参照になっている。コメントで「予備パレット」と明記するか、SYSTEM_BIOME のどれかに使う(例: 未使用なら残しつつ `/** 未使用: 予備 */`)。
- `renderer.ts`/他: 古いコメント(高度ベースのバイオーム前提など段階4で陳腐化した記述)を修正。
- (任意・低優先) `megafacility.ts` の N/S 接続口を、幹線の垂直セグメントが来やすい位置に寄せる整合改善。難しければ skip(視覚のみの軽微な不整合)。

- [ ] **Step 3: 通過+目視**

Run: `npm test`、`npx tsc --noEmit`、`npm run build` → 全PASS
Run: 水系の貯水施設/メガ施設を撮って水面が見えるか確認:
```
node scripts/screenshot.mjs --seed=20260711 --pos=2736,10823 --out=screenshots/s5-water.png
```
PNGをReadで確認: 水系施設の下部に水面の表現が出て「貯水施設」らしさが増している。他は破綻なし。

- [ ] **Step 4: コミット**
```bash
git add -A
git commit -m "feat: 施設の水面decorとcosmeticクリーンアップ"
```

---

### Task 3: 総合ビジュアルチューニングと最終確認

**Files:** 調整対象(background alpha/密度、シルエット寸法、水面色など)

- [ ] **Step 1: 全系統・複数スケールで撮る**

各系統の地域、セクターハブ(源)、幹線、遠景シルエットが見える引き、階層マップ。例:
```
node scripts/screenshot.mjs --seed=20260711 --pos=2736,10823 --out=screenshots/final-water-hub.png
node scripts/screenshot.mjs --seed=20260711 --pos=-998576,-1045576 --out=screenshots/final-foundry.png
node scripts/screenshot.mjs --seed=20260711 --pos=-474288,-1045576 --out=screenshots/final-power.png
node scripts/screenshot.mjs --seed=20260711 --pos=100000,-5000 --out=screenshots/final-open.png
node scripts/screenshot.mjs --debug=hierarchy:200000 --pos=0,0 --out=screenshots/final-map.png
```

- [ ] **Step 2: 目視評価と調整**

全PNGを開き、目標「圧倒的スケールの機械都市 / 系統ごとの個性 / 源へ収束するネットワーク / 遠景の巨大構造 / 発見のある稀少ランドマーク / 読みやすさ」を満たすか評価。過剰/不足があれば background alpha・シルエット寸法・水面色などを調整(調整→撮影→確認を最大3周)。前景のプレイ視認性を損なわないこと。

- [ ] **Step 3: 全テスト+ビルド+コミット**

Run: `npm test && npx tsc --noEmit && npm run build` → 全PASS
```bash
git add -A
git commit -m "feat: 段階5の総合チューニング"
```

---

## この計画のスコープ外
- クロス系統の因果(地域境界トランク)— 稀少で費用対効果が低いため見送り
- ゲーム機構(敵/戦闘/目的/能力/資源)
- 音
- 実CC0タイル素材の実導入(差し替え口は既存)

## 留意
- 段階5は全て視覚のみ。tileAt/physics は不変で、到達可能性・決定論・既存テストは自動的に保たれる(background/decor はロジックに影響しない)。
- 遠景シルエット・稀少ランドマークは淡く(alpha低め)。前景のプレイ視認性を最優先。
- これで超構造体アークの主要素(階層・施設・ネットワーク・源・全系統配色・遠景スケール・発見)が揃う。以降は必要に応じてクロス系統因果やゲーム機構(段階3-4の当初構想: セーフガード/重力子砲/物語)へ。
