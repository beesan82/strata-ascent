# 重力子放射線射出装置 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** マウス方向へ太い貫通ビームを撃ち、地形を大規模に永続破壊する切り札(チャージ制・最大3発・自動回復)を実装する。既存のワールド生成の決定論・純粋性は壊さない。

**Architecture:** 破壊差分ストア(`destruction.ts`)を唯一の可変レイヤーとし、`tileAtLive`(破壊込み)を実描画・物理の経路に据える。`tileAt`(純粋・生成専用)は不変で既存テストを守る。重力子砲の状態機械(`graviton.ts`)がチャージ/弾数/発射→bore を管理。演出(ビーム/銃口グロー/画面シェイク)は描画層。

**Tech Stack:** 既存(Vite/TS/Canvas2D/Vitest/Playwright)。

**参照スペック:** `docs/superpowers/specs/2026-07-12-blame-sim-graviton-design.md`

**全タスク共通:**
- 純粋ロジックは決定論。既存テスト(112)は回帰なし維持
- スクショ: `node scripts/screenshot.mjs`。exit0+[pageerror]無し
- 座標: y下向き正、CHUNK=64、TILE={AIR:0,SOLID:1,LADDER:2}
- 既存: `ChunkStore(seed)` が `getChunk`/`tileAt(x,y)`/`evictFarFrom`。`generateChunk(seed,cx,cy)` は `worldgen.tileAt` を使う。`Input` は keys Set + mouseX/mouseY、`GAME_KEYS` で preventDefault。`Player` は centerX/centerY/body。renderer は seed 保持・biomeBlend(seed,x,y)・player 描画・lighting・post。

---

### Task 1: 破壊差分ストア(destruction.ts)

**Files:** Create `src/world/destruction.ts` / Test `src/world/destruction.test.ts`

破壊されたワールドタイル座標の Set を保持。`bore` は始点から角度方向へ length タイル、半径 radius の太さで、経路上の**非AIR**タイルを破壊集合へ追加。`isDestroyed(x,y)` を提供。破壊で影響を受けたチャンク座標を返し、呼び出し側がキャッシュ無効化に使う。

- [ ] **Step 1: 失敗するテストを書く**

`src/world/destruction.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { Destruction } from './destruction';
import { TILE, type Tile } from './tiles';

/** y=5行が床、x=10列が壁、他はAIRのテストワールド */
const testTiles = (x: number, y: number): Tile => {
  if (y === 5) return TILE.SOLID;
  if (x === 10) return TILE.SOLID;
  return TILE.AIR;
};

describe('Destruction', () => {
  it('初期状態では何も破壊されていない', () => {
    const d = new Destruction();
    expect(d.isDestroyed(0, 0)).toBe(false);
    expect(d.size).toBe(0);
  });

  it('bore は経路上の非AIRタイルのみ破壊集合へ入れる(AIRは無視)', () => {
    const d = new Destruction();
    // 水平右向きに床(y=5)を横切るビーム。始点(0,5)から角度0で length 20, radius 1
    d.bore(0, 5, 0, 20, 1, testTiles);
    // 経路上の床タイル(y=5, x=0..20 かつ radius内)は破壊される
    expect(d.isDestroyed(3, 5)).toBe(true);
    expect(d.isDestroyed(10, 5)).toBe(true); // 壁と床の交点も
    // AIRだった箇所(y=6 は radius1 で y=5±1 に入るが元AIR)は破壊集合に入らない
    expect(d.isDestroyed(3, 8)).toBe(false); // 経路外
  });

  it('isDestroyed は破壊した座標で true、それ以外 false(決定論)', () => {
    const d = new Destruction();
    d.bore(0, 5, 0, 20, 0, testTiles); // radius0=中心線のみ
    expect(d.isDestroyed(7, 5)).toBe(true);
    expect(d.isDestroyed(7, 5)).toBe(true); // 再問い合わせ一致
    expect(d.isDestroyed(7, 4)).toBe(false);
  });

  it('bore は影響を受けたチャンク座標の集合を返す', () => {
    const d = new Destruction();
    const chunks = d.bore(0, 5, 0, 200, 1, testTiles); // 長いビーム→複数チャンク
    expect(chunks.size).toBeGreaterThan(0);
    // 破壊タイル (100,5) が属するチャンク (1,0) が含まれる (CHUNK_SIZE=64)
    expect(chunks.has('1,0')).toBe(true);
  });

  it('縦方向・斜め方向でも破壊が経路に沿う', () => {
    const d = new Destruction();
    d.bore(10, 0, Math.PI / 2, 10, 0, testTiles); // 下向きに壁(x=10)を貫く
    expect(d.isDestroyed(10, 3)).toBe(true);
    expect(d.isDestroyed(10, 5)).toBe(true);
  });
});
```

- [ ] **Step 2: 失敗確認** `npx vitest run src/world/destruction.test.ts` → FAIL

- [ ] **Step 3: 実装**

`src/world/destruction.ts`:
```ts
import { CHUNK_SIZE, TILE, type Tile } from './tiles';

/** 破壊差分ストア。破壊されたワールドタイル座標を保持する唯一の可変レイヤー */
export class Destruction {
  private cells = new Set<string>();

  get size(): number {
    return this.cells.size;
  }

  isDestroyed(x: number, y: number): boolean {
    return this.cells.has(`${x},${y}`);
  }

  /**
   * (x0,y0) から angle 方向へ length タイル、太さ radius(半径)のビームで
   * 経路上の非AIRタイルを破壊集合へ追加する。tiles は現在のタイル取得関数。
   * 影響を受けたチャンク座標("cx,cy")の集合を返す(キャッシュ無効化用)。
   */
  bore(x0: number, y0: number, angle: number, length: number, radius: number, tiles: (x: number, y: number) => Tile): Set<string> {
    const chunks = new Set<string>();
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    // ビームに垂直な方向(太さ方向)
    const px = -dy;
    const py = dx;
    for (let t = 0; t <= length; t += 0.5) {
      const cxx = x0 + dx * t;
      const cyy = y0 + dy * t;
      for (let r = -radius; r <= radius; r += 0.5) {
        const wx = Math.round(cxx + px * r);
        const wy = Math.round(cyy + py * r);
        if (tiles(wx, wy) === TILE.AIR) continue;
        const key = `${wx},${wy}`;
        if (this.cells.has(key)) continue;
        this.cells.add(key);
        const cx = Math.floor(wx / CHUNK_SIZE);
        const cy = Math.floor(wy / CHUNK_SIZE);
        chunks.add(`${cx},${cy}`);
      }
    }
    return chunks;
  }
}
```

- [ ] **Step 4: 通過確認** `npx vitest run src/world/destruction.test.ts` → PASS。`npm test` 全PASS。`npx tsc --noEmit` クリーン

- [ ] **Step 5: コミット**
```bash
git add src/world/destruction.ts src/world/destruction.test.ts
git commit -m "feat: 破壊差分ストア(bore/isDestroyed)"
```

---

### Task 2: tileAtLive 合成と ChunkStore への注入

**Files:** Modify `src/world/worldgen.ts` / Modify `src/world/chunks.ts` / Test `src/world/worldgen.test.ts`

- [ ] **Step 1: 失敗するテストを追記**

`src/world/worldgen.test.ts`:
```ts
import { tileAtLive } from './worldgen';
import { Destruction } from './destruction';

describe('tileAtLive(破壊差分込み)', () => {
  it('破壊ストアが空なら tileAt と完全一致(回帰なし)', () => {
    const d = new Destruction();
    for (const [x, y] of [[0, 0], [63, -8], [200, -520], [-40, 130]] as const) {
      expect(tileAtLive(42, x, y, d)).toBe(tileAt(42, x, y));
    }
  });
  it('破壊された座標は必ず AIR(生成が何であれ)', () => {
    const d = new Destruction();
    // SOLID なタイルを探して破壊
    let found = false;
    for (let y = -50; y < 0 && !found; y++)
      for (let x = 0; x < 200 && !found; x++)
        if (tileAt(42, x, y) === TILE.SOLID) { d.bore(x, y, 0, 0, 0, (ax, ay) => tileAt(42, ax, ay)); found = true;
          expect(tileAtLive(42, x, y, d)).toBe(TILE.AIR); }
    expect(found).toBe(true);
  });
});
```

- [ ] **Step 2: 失敗確認** → FAIL(tileAtLive 未定義)

- [ ] **Step 3: 実装**

`worldgen.ts` に追加(既存 tileAt は不変):
```ts
import type { Destruction } from './destruction';
/** 実描画・物理が使う経路。破壊差分を最優先で反映(空なら tileAt と同値) */
export function tileAtLive(seed: number, x: number, y: number, destruction: Destruction): Tile {
  if (destruction.isDestroyed(x, y)) return TILE.AIR;
  return tileAt(seed, x, y);
}
```

`chunks.ts`: ChunkStore に destruction を注入し、生成経路を live に:
- コンストラクタ `constructor(readonly seed: number, private destruction?: Destruction)`
- `getChunk` の生成を、生成後に破壊差分を上書き適用する形にする。最小変更: `generateChunk(seed,cx,cy)` はそのまま使い、生成直後にそのチャンク内の破壊セルを AIR に上書き:
```ts
getChunk(cx, cy) {
  const key = `${cx},${cy}`;
  let chunk = this.chunks.get(key);
  if (!chunk) {
    chunk = generateChunk(this.seed, cx, cy);
    if (this.destruction) this.applyDestruction(chunk, cx, cy);
    this.chunks.set(key, chunk);
  }
  return chunk;
}
private applyDestruction(chunk: Uint8Array, cx: number, cy: number) {
  const base = cx * CHUNK_SIZE, baseY = cy * CHUNK_SIZE;
  for (let ty = 0; ty < CHUNK_SIZE; ty++)
    for (let tx = 0; tx < CHUNK_SIZE; tx++)
      if (this.destruction!.isDestroyed(base + tx, baseY + ty)) chunk[ty * CHUNK_SIZE + tx] = TILE.AIR;
}
```
- **チャンク焼き直し無効化**: `invalidate(cx,cy)` を追加し、キャッシュから該当チャンクを削除(次回 getChunk で再生成→破壊適用):
```ts
invalidate(cx: number, cy: number): void { this.chunks.delete(`${cx},${cy}`); }
```
(TILE import を chunks.ts に追加)

- [ ] **Step 4: 通過確認** `npm test` 全PASS(既存 worldgen 決定論・梯子テストは tileAt を使うので不変)。`npx tsc --noEmit` クリーン

- [ ] **Step 5: コミット**
```bash
git add src/world/worldgen.ts src/world/chunks.ts src/world/worldgen.test.ts
git commit -m "feat: tileAtLive破壊合成とChunkStore注入・無効化"
```

---

### Task 3: 重力子砲の状態機械(graviton.ts)+ 発射入力

**Files:** Create `src/entities/graviton.ts` / Test `src/entities/graviton.test.ts` / Modify `src/core/input.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/entities/graviton.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { Graviton } from './graviton';

describe('Graviton', () => {
  it('初期弾数は3', () => {
    expect(new Graviton().charges).toBe(3);
  });
  it('チャージ完了(fireHeld を CHARGE_TIME 保持→離す)で fire が1回呼ばれ弾数-1', () => {
    const g = new Graviton();
    const fire = vi.fn();
    // 長押し
    for (let i = 0; i < 60; i++) g.update(1 / 60, true, fire); // 1秒 > CHARGE_TIME
    expect(fire).not.toHaveBeenCalled(); // 押している間は撃たない
    g.update(1 / 60, false, fire); // 離す
    expect(fire).toHaveBeenCalledTimes(1);
    expect(g.charges).toBe(2);
  });
  it('チャージ未完で離すと発射しない', () => {
    const g = new Graviton();
    const fire = vi.fn();
    g.update(0.1, true, fire); // わずかに押す
    g.update(1 / 60, false, fire); // すぐ離す(CHARGE_TIME未満)
    expect(fire).not.toHaveBeenCalled();
    expect(g.charges).toBe(3);
  });
  it('長押し継続では連射しない(離すまで1発)', () => {
    const g = new Graviton();
    const fire = vi.fn();
    for (let i = 0; i < 300; i++) g.update(1 / 60, true, fire); // 5秒押しっぱ
    expect(fire).not.toHaveBeenCalled();
  });
  it('弾数0ではチャージ・発射できない', () => {
    const g = new Graviton();
    const fire = vi.fn();
    for (let n = 0; n < 3; n++) { // 3発撃つ
      for (let i = 0; i < 60; i++) g.update(1 / 60, true, fire);
      g.update(1 / 60, false, fire);
    }
    expect(g.charges).toBe(0);
    fire.mockClear();
    for (let i = 0; i < 60; i++) g.update(1 / 60, true, fire);
    g.update(1 / 60, false, fire);
    expect(fire).not.toHaveBeenCalled();
  });
  it('時間経過で弾数が自動回復(上限3)', () => {
    const g = new Graviton();
    const fire = vi.fn();
    for (let i = 0; i < 60; i++) g.update(1 / 60, true, fire);
    g.update(1 / 60, false, fire); // 1発消費 → 2
    expect(g.charges).toBe(2);
    for (let i = 0; i < 60 * 7; i++) g.update(1 / 60, false, fire); // 7秒待つ(RECHARGE=6s)
    expect(g.charges).toBe(3); // 上限で頭打ち
  });
  it('チャージ進捗 chargeRatio は 0..1', () => {
    const g = new Graviton();
    const fire = vi.fn();
    g.update(0.3, true, fire);
    expect(g.chargeRatio).toBeGreaterThan(0);
    expect(g.chargeRatio).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: 失敗確認** → FAIL

- [ ] **Step 3: 実装**

`src/entities/graviton.ts`:
```ts
const MAX_CHARGES = 3;
const CHARGE_TIME = 0.6;   // 秒: 発射に必要な溜め
const RECHARGE_TIME = 6;   // 秒: 弾1発の自動回復

/** 重力子砲の状態機械。チャージ/弾数/自動回復を管理(描画・破壊には非依存) */
export class Graviton {
  charges = MAX_CHARGES;
  private chargeT = 0;      // 現在の溜め秒
  private charging = false;
  private rechargeT = 0;

  get chargeRatio(): number {
    return Math.min(1, this.chargeT / CHARGE_TIME);
  }

  /**
   * held: 発射キーが押されているか。fire: チャージ完了→離した瞬間に呼ぶコールバック。
   * 弾数プールを消費し、時間で自動回復する。
   */
  update(dt: number, held: boolean, fire: () => void): void {
    // 自動回復(満タンでなければ)
    if (this.charges < MAX_CHARGES) {
      this.rechargeT += dt;
      if (this.rechargeT >= RECHARGE_TIME) {
        this.rechargeT -= RECHARGE_TIME;
        this.charges++;
      }
    } else {
      this.rechargeT = 0;
    }

    if (held && this.charges > 0) {
      this.charging = true;
      this.chargeT += dt;
    } else {
      // 離した / 弾切れ
      if (this.charging && this.chargeT >= CHARGE_TIME && this.charges > 0) {
        this.charges--;
        fire();
      }
      this.charging = false;
      this.chargeT = 0;
    }
  }
}
```

`src/core/input.ts`: 発射キーを追加。GAME_KEYS に 'KeyF' を足し、state に `fire` を追加… ただし PlayerInput は移動用なので、Input に別途 `get fireHeld(): boolean { return this.keys.has('KeyF'); }` を追加(マウス左も許容するなら mousedown を拾う)。まずは KeyF のみ。

- [ ] **Step 4: 通過確認** `npx vitest run src/entities/graviton.test.ts` → PASS。`npm test` 全PASS。`npx tsc --noEmit` クリーン

- [ ] **Step 5: コミット**
```bash
git add src/entities/graviton.ts src/entities/graviton.test.ts src/core/input.ts
git commit -m "feat: 重力子砲の状態機械と発射入力"
```

---

### Task 4: 統合・演出・HUD

**Files:** Create `src/render/beam.ts` / Modify `src/render/renderer.ts` / Modify `src/main.ts`

演出はスクショ目視。

- [ ] **Step 1: main.ts 結線**

- `const destruction = new Destruction();`
- `const store = new ChunkStore(seed, destruction);`
- `const graviton = new Graviton();`
- `tiles` コールバックを `(tx,ty) => store.tileAt(tx,ty)` のまま(store は破壊適用済みチャンクを返す)
- update ループ:
  ```ts
  const aim = Math.atan2(input.mouseY - <playerScreenY>, input.mouseX - <playerScreenX>);
  // プレイヤー画面座標が要る。renderer と同じ ppt/カメラで算出、または簡易にワールド角へ変換。
  // 簡易: マウスは画面中心(プレイヤー)基準の相対角として atan2(mouseY - h/2, mouseX - w/2)
  graviton.update(dt, input.fireHeld, () => {
    const length = 300, radius = 3;
    const affected = destruction.bore(player.centerX, player.centerY, aim, length, radius, tiles);
    for (const key of affected) { const [cx, cy] = key.split(',').map(Number); store.invalidate(cx, cy); }
    graviton.lastBeam = { x: player.centerX, y: player.centerY, angle: aim, length, ttl: 0.12 };
  });
  ```
  - aim は「画面中心=プレイヤー」を使い `atan2(mouseY - innerHeight/2, mouseX - innerWidth/2)`(lighting の angle と同様の基準)。lighting は px,py(プレイヤー画面座標)基準なので、それと合わせる。renderer 側で angle を算出して graviton へ渡す設計でもよい。実装者判断で「ビーム方向 = ライトの照射方向と一致」させること。
  - `graviton.lastBeam`(発射演出用)を Graviton に任意フィールドとして持たせるか、main のローカルに持つ。ttl を毎フレーム減らし renderer に渡す。

- HUD: `弾数 ${graviton.charges}/3` を高度・系統の行に追記。チャージ中は `▮`ゲージ等。

- [ ] **Step 2: beam.ts(演出)**

`src/render/beam.ts`: `drawBeam(ctx, px, py, angle, lengthPx, alpha)` — プレイヤー画面座標から angle 方向へ太い白グラデのビーム(中心明るく縁ぼかし)+銃口の閃光円。`drawCharge(ctx, px, py, ratio)` — チャージ中に銃口へ溜まる光(ratio で半径・輝度)。

- [ ] **Step 3: renderer.ts 統合**

- `render(...)` に発射ビーム(lastBeam が生きていれば)とチャージグロー(chargeRatio)を、プレイヤー描画の後・ライトの前後で描く(ビームは明るいのでライトの上=post前が見やすい)。
- 画面シェイク: 発射直後の数フレーム、描画全体を数px揺らす(ctx.translate をフレーム先頭で乱数オフセット、決定論不要)。renderer に `shake(intensity)` を持たせ main が発射時に呼ぶ、または lastBeam.ttl から算出。
- renderer が angle を算出して main/graviton と共有する形が自然(px,py は renderer が持つ)。**発射方向はライト円錐と一致**させる。

- [ ] **Step 4: 検証(テスト+型+目視)**

Run: `npm test && npx tsc --noEmit && npm run build` → 全PASS
Run: dev サーバ or スクショで実際に撃つのは操作が要る。スクショハーネスは入力を送れないため、**発射済みの状態を再現**して確認する方法を用意する:
- 簡易確認: `?fire=1` のようなデバッグクエリで「起動直後に1発デバッグ発射」する仕込みを main に一時的に入れ(または screenshot.mjs に keypress を送る Playwright 操作を追加)、破壊痕とビーム演出を撮る。
  - 推奨: `screenshot.mjs` に `--press=KeyF --hold=800` オプションを足し、Playwright で `page.keyboard.down/up('KeyF')` を送れるようにする(汎用的で今後も使える)。
- 撮影: 撃つ前と撃った後(長押し→離す)を撮り、(a)チャージ中の銃口グロー、(b)発射時の太いビーム、(c)地形に空いた巨大な穴(貫通)が残ること、を目視。HUD 弾数が減ることも確認。

- [ ] **Step 5: コミット**
```bash
git add -A
git commit -m "feat: 重力子砲の統合・ビーム演出・HUD弾数"
```

---

### Task 5: 最終確認

- [ ] `npm test && npx tsc --noEmit && npm run build` 全PASS
- [ ] スクショで「チャージ→発射→巨大な貫通穴が永続、弾数消費、時間で回復」を確認
- [ ] 未コミット変更をコミット

---

## スコープ外
- 敵・当たり(地形のみ破壊)
- セーブ(破壊はリロードで消える)
- 音・弾薬アイテム

## 留意
- `tileAt`(純粋)は不変で既存テストを守り、`tileAtLive`/ChunkStore 経由でのみ破壊が見える
- 破壊は tileAt 合成の最優先=詰み防止の最終手段。ノイズ梯子・施設・メガ施設も破壊可
- 発射方向はライト円錐と一致(照準の一貫性)
- スクショハーネスに入力送出(--press/--hold)を足すと、以後の操作系機能の目視確認に再利用できる
