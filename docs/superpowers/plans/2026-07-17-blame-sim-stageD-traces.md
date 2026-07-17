# 段階D: 人の痕跡(環境ストーリーテリング) 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「ここで誰かが力尽きた」と読める痕跡 — 遺体(骨)・落ちた携行ライト・荷袋・空薬莢(床の縁)、壁に刻まれた日数の正字・消えかけた警告記号 — を決定論的に散らし、無人の構造体に人の気配と物語の断片を与える。

**Architecture:** 「その座標に痕跡があるか・何の痕跡か」を返す**純粋関数** `render/traces.ts` の `traceAt(seed, wx, wy, kind)` を新設。`chunkbake.ts` が焼き込み時に、床(AIRの直下がSOLID)には床痕跡を、壁面(SOLIDの左右いずれかが空気)には壁痕跡を、`traceAt` の返り値に応じて描く。**非衝突・当たり無改修**(tileAtに一切影響しない・焼き込みキャンバスへの描画のみ)。`traceAt` は (seed,wx,wy) で決定論的なので、将来の断章テキストは同じ関数の返り値 `id` から座標→テキストを引ける(接続口。テキスト本体は本スコープ外)。

**Tech Stack:** TypeScript + Canvas 2D + Vitest。設計書: [docs/superpowers/specs/2026-07-17-blame-sim-nihei-visual-realism-design.md](../specs/2026-07-17-blame-sim-nihei-visual-realism-design.md) の「4. 人の痕跡」。決定論ハッシュ `hash2`(`world/noise.ts`)、`weighted`(`world/hierarchy.ts`)を再利用。

**スコープ注記:** 痕跡の視覚配置と描画のみ。断章テキスト本体・端末UI・拾う/読むインタラクションは対象外(座標→id の接続口だけ用意)。

---

## ファイル構成

- Create: `src/render/traces.ts` — `traceAt(seed, wx, wy, kind)` と型 `TraceType`/`Trace`(純粋・決定論)。責務: 痕跡の有無・種別・変種idの判定のみ。
- Create: `src/render/traces.test.ts` — 上記のユニットテスト。
- Modify: `src/render/chunkbake.ts` — 焼き込み末尾で床/壁の適格タイルに痕跡を描く(種別ごとの小ルーチン)。

---

### Task 1: 痕跡配置の純粋関数

**Files:**
- Create: `src/render/traces.ts`
- Test: `src/render/traces.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/render/traces.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { traceAt, FLOOR_TYPES, WALL_TYPES } from './traces';

const SEED = 20260711;

describe('traceAt', () => {
  it('決定論: 同じ引数は同じ結果', () => {
    for (let i = 0; i < 50; i++) {
      const a = traceAt(SEED, i * 7, i * 3, 'floor');
      const b = traceAt(SEED, i * 7, i * 3, 'floor');
      expect(a).toEqual(b);
    }
  });

  it('床痕跡は稀(適格タイルの5%未満)', () => {
    let hit = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) if (traceAt(SEED, i, 0, 'floor')) hit++;
    expect(hit / N).toBeGreaterThan(0);      // 皆無ではない
    expect(hit / N).toBeLessThan(0.05);      // だが稀
  });

  it('壁痕跡も稀(適格タイルの6%未満)', () => {
    let hit = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) if (traceAt(SEED, i, 1, 'wall')) hit++;
    expect(hit / N).toBeGreaterThan(0);
    expect(hit / N).toBeLessThan(0.06);
  });

  it('kind=floor は床種別のみ、kind=wall は壁種別のみを返す', () => {
    for (let i = 0; i < 4000; i++) {
      const f = traceAt(SEED, i, 0, 'floor');
      if (f) expect(FLOOR_TYPES).toContain(f.type);
      const w = traceAt(SEED, i, 5, 'wall');
      if (w) expect(WALL_TYPES).toContain(w.type);
    }
  });

  it('id は変種用に安定した整数', () => {
    const t = traceAt(SEED, 12345, 0, 'floor') ?? traceAt(SEED, 1, 0, 'floor');
    // どこかに1つはある(上のテストで存在は保証)。あれば id は非負整数。
    for (let i = 0; i < 4000; i++) {
      const r = traceAt(SEED, i, 0, 'floor');
      if (r) {
        expect(Number.isInteger(r.id)).toBe(true);
        expect(r.id).toBeGreaterThanOrEqual(0);
        break;
      }
    }
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/render/traces.test.ts`
Expected: FAIL(`Cannot find module './traces'`)

- [ ] **Step 3: 実装を書く**

`src/render/traces.ts`:

```ts
import { hash2 } from '../world/noise';
import { weighted } from '../world/hierarchy';

/** 床(縁)に残る痕跡の種別 */
export const FLOOR_TYPES = ['corpse', 'lamp', 'pack', 'shells'] as const;
/** 壁面に残る痕跡の種別 */
export const WALL_TYPES = ['tally', 'warning'] as const;

export type FloorTrace = (typeof FLOOR_TYPES)[number];
export type WallTrace = (typeof WALL_TYPES)[number];
export type TraceType = FloorTrace | WallTrace;

export interface Trace {
  type: TraceType;
  /** 変種・将来の断章id用の安定した非負整数(seed+座標ハッシュ由来) */
  id: number;
}

/** 床痕跡の出現率(適格タイルあたり)。稀にする。 */
const FLOOR_RATE = 0.018;
/** 壁痕跡の出現率(適格タイルあたり)。 */
const WALL_RATE = 0.022;

/** 種別の重み(遺体は最も稀。稼働灯を伴うランプ・荷袋・薬莢はやや多い) */
const FLOOR_TABLE = [
  { v: 'corpse' as const, w: 1 },
  { v: 'lamp' as const, w: 2 },
  { v: 'pack' as const, w: 3 },
  { v: 'shells' as const, w: 3 },
];
const WALL_TABLE = [
  { v: 'tally' as const, w: 2 },
  { v: 'warning' as const, w: 1 },
];

/**
 * (seed, wx, wy) に痕跡があれば返す(なければ null)。純粋・決定論。
 * kind='floor': 呼び出し側が「AIRかつ直下SOLIDの縁タイル」に対して呼ぶ想定。
 * kind='wall' : 呼び出し側が「SOLIDかつ左右いずれか空気の壁面タイル」に対して呼ぶ想定。
 * (適格判定は chunkbake 側。ここは有無と種別のみを決める。)
 */
export function traceAt(seed: number, wx: number, wy: number, kind: 'floor' | 'wall'): Trace | null {
  const rate = kind === 'floor' ? FLOOR_RATE : WALL_RATE;
  const gate = hash2(seed + (kind === 'floor' ? 8100 : 8200), wx, wy);
  if (gate >= rate) return null;
  const pick = hash2(seed + (kind === 'floor' ? 8110 : 8210), wx, wy);
  const type = kind === 'floor' ? weighted(FLOOR_TABLE, pick) : weighted(WALL_TABLE, pick);
  const id = Math.floor(hash2(seed + 8300, wx, wy) * 0x7fffffff);
  return { type, id };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/render/traces.test.ts`
Expected: PASS(5テスト)

- [ ] **Step 5: コミット**

```bash
git add src/render/traces.ts src/render/traces.test.ts
git commit -m "feat: 人の痕跡の決定論配置traceAt(純粋)"
```

---

### Task 2: chunkbake へ痕跡を焼き込み、スクショ確認

**Files:**
- Modify: `src/render/chunkbake.ts`

Canvas描画。tsc + 全既存テスト回帰なしで確認し、見た目はコーディネータがスクショ判定する。

- [ ] **Step 1: import を追加**

`src/render/chunkbake.ts` の import 群に追加(既存の relief import 行の直後など):

```ts
import { traceAt, type Trace } from './traces';
```

- [ ] **Step 2: 焼き込み末尾に痕跡ループを追加**

`bake()` の `return canvas;` の**直前**に次を挿入する。`P`(既存の `const P = BAKE_PPT;`)・`chunk`・`store`・`bx`・`by`・`biome` は同スコープで利用可能:

```ts
    // 人の痕跡(環境ストーリーテリング)。床の縁(AIRかつ直下SOLID)と壁面(SOLIDかつ左右空気)に
    // 決定論的に散らす。焼き込みのみ・非衝突。ライトに照らされて初めて読める暗い色調。
    for (let ty = 0; ty < CHUNK_SIZE; ty++) {
      const wy = by + ty;
      for (let tx = 0; tx < CHUNK_SIZE; tx++) {
        const wx = bx + tx;
        const here = chunk[ty * CHUNK_SIZE + tx];
        if (here === TILE.AIR) {
          // 床の縁: このAIRの直下がSOLID
          if (store.tileAt(wx, wy + 1) !== TILE.SOLID) continue;
          const tr = traceAt(this.seed, wx, wy, 'floor');
          if (tr) this.drawFloorTrace(ctx, tr, tx, ty);
        } else if (here === TILE.SOLID) {
          // 壁面: 左右いずれかが空気(縦面が露出)
          const faceLeft = store.tileAt(wx - 1, wy) !== TILE.SOLID;
          const faceRight = store.tileAt(wx + 1, wy) !== TILE.SOLID;
          if (!faceLeft && !faceRight) continue;
          const tr = traceAt(this.seed, wx, wy, 'wall');
          if (tr) this.drawWallTrace(ctx, tr, tx, ty, faceLeft ? -1 : 1);
        }
      }
    }
```

- [ ] **Step 3: 描画ルーチンをクラスに追加**

`ChunkBaker` クラス内(`private draw(...)` メソッドの直前など)に2メソッドを追加する:

```ts
  /** 床の縁の痕跡。タイル(tx,ty)内の正規化座標で描く(y=1が床面)。暗い色調。 */
  private drawFloorTrace(ctx: CanvasRenderingContext2D, tr: Trace, tx: number, ty: number): void {
    const P = BAKE_PPT;
    const X = (x: number) => (tx + x) * P;
    const Y = (y: number) => (ty + y) * P;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    switch (tr.type) {
      case 'corpse': {
        // 壁にもたれ力尽きた骨。頭蓋+背骨+肋+投げ出した脚。
        ctx.strokeStyle = '#8f8a7e';
        ctx.fillStyle = '#12100c';
        ctx.lineWidth = Math.max(1, 0.05 * P);
        ctx.globalAlpha = 0.8;
        ctx.beginPath(); ctx.arc(X(0.5), Y(0.6), 0.11 * P, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); // 頭蓋
        ctx.beginPath();
        ctx.moveTo(X(0.5), Y(0.71)); ctx.lineTo(X(0.55), Y(0.95));                                   // 背骨
        ctx.moveTo(X(0.44), Y(0.78)); ctx.lineTo(X(0.6), Y(0.78));                                    // 肋
        ctx.moveTo(X(0.45), Y(0.84)); ctx.lineTo(X(0.6), Y(0.84));
        ctx.moveTo(X(0.55), Y(0.95)); ctx.lineTo(X(0.3), Y(0.93));                                    // 脚
        ctx.moveTo(X(0.55), Y(0.95)); ctx.lineTo(X(0.82), Y(0.9));
        ctx.stroke();
        break;
      }
      case 'lamp': {
        // 落ちた携行ライト + 消えかけの残光
        const gx = X(0.5), gy = Y(0.9);
        const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, 0.6 * P);
        g.addColorStop(0, 'rgba(202,166,74,0.35)');
        g.addColorStop(1, 'rgba(202,166,74,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(gx, gy, 0.6 * P, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#141d27';
        ctx.strokeStyle = '#33506a';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.rect(X(0.4), Y(0.88), 0.24 * P, 0.08 * P); ctx.fill(); ctx.stroke();
        break;
      }
      case 'pack': {
        // 落とした荷袋
        ctx.fillStyle = '#12161b';
        ctx.strokeStyle = '#3a4a3a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(X(0.36), Y(0.98)); ctx.lineTo(X(0.4), Y(0.82));
        ctx.lineTo(X(0.6), Y(0.82)); ctx.lineTo(X(0.64), Y(0.98));
        ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      }
      case 'shells': {
        // 空薬莢の散らばり
        ctx.fillStyle = '#7a6a3a';
        ctx.globalAlpha = 0.75;
        for (const [ox, oy] of [[0.32, 0.96], [0.46, 0.98], [0.6, 0.95], [0.7, 0.98]] as const) {
          ctx.fillRect(X(ox), Y(oy), 0.08 * P, 0.03 * P);
        }
        break;
      }
    }
    ctx.restore();
  }

  /** 壁面の痕跡。露出面側(dir: -1=左,1=右)寄りに描く。 */
  private drawWallTrace(ctx: CanvasRenderingContext2D, tr: Trace, tx: number, ty: number, dir: -1 | 1): void {
    const P = BAKE_PPT;
    const base = dir === -1 ? 0.12 : 0.62; // 露出面側の帯
    const X = (x: number) => (tx + base + x) * P;
    const Y = (y: number) => (ty + y) * P;
    ctx.save();
    ctx.lineCap = 'round';
    switch (tr.type) {
      case 'tally': {
        // 日数の正字風(縦4本+斜め1本)
        ctx.strokeStyle = '#5a6a70';
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = Math.max(1, 0.04 * P);
        for (let i = 0; i < 4; i++) {
          ctx.beginPath(); ctx.moveTo(X(0.02 + i * 0.07), Y(0.35)); ctx.lineTo(X(0.02 + i * 0.07), Y(0.6)); ctx.stroke();
        }
        ctx.beginPath(); ctx.moveTo(X(-0.02), Y(0.48)); ctx.lineTo(X(0.24), Y(0.47)); ctx.stroke();
        break;
      }
      case 'warning': {
        // 消えかけた警告の矢印/記号(塗り)
        ctx.fillStyle = '#3a4658';
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.moveTo(X(0), Y(0.42)); ctx.lineTo(X(0.16), Y(0.42)); ctx.lineTo(X(0.14), Y(0.36));
        ctx.lineTo(X(0.26), Y(0.5)); ctx.lineTo(X(0.14), Y(0.64)); ctx.lineTo(X(0.16), Y(0.58));
        ctx.lineTo(X(0), Y(0.58)); ctx.closePath(); ctx.fill();
        break;
      }
    }
    ctx.restore();
  }
```

注: `Trace` 型は `import { traceAt, type Trace } from './traces';` で導入済み。`drawFloorTrace`/`drawWallTrace` は `ctx.save()/restore()` で状態を隔離し、`globalAlpha` 等が他の焼き込み処理へ漏れないようにする。

- [ ] **Step 4: 型チェックと既存テスト回帰なしを確認**

Run: `npx tsc --noEmit && npm test`
Expected: 型エラーなし。全既存テスト PASS(描画は自動テスト対象外)。

- [ ] **Step 5: コミット**

```bash
git add src/render/chunkbake.ts
git commit -m "feat: chunkbakeに人の痕跡(遺体/ランプ/荷袋/薬莢/刻み/警告)を焼き込み"
```

- [ ] **Step 6: スクリーンショットで痕跡を確認(コーディネータ)**

Run:

```bash
node scripts/screenshot.mjs --out=screenshots/d-a.png --seed=20260711 --pos=524488,-560 --wait=3000
node scripts/screenshot.mjs --out=screenshots/d-b.png --seed=20260711 --wait=3000
node scripts/screenshot.mjs --out=screenshots/d-c.png --seed=42 --pos=200,-560 --wait=3000
```

痕跡は稀なので1枚に写らないことがある。写らなければ位置/シードを変えて数枚撮る。デバッグ用に一時的に `FLOOR_RATE`/`WALL_RATE` を上げて「描画自体が正しいか」を先に確認し、確認後に元の稀な値へ戻して撮り直すのも可(戻し忘れ厳禁)。

- [ ] **Step 7: 目視で合否を判定(コーディネータ)**

期待:
- 床の縁に遺体(骨)・落ちたランプ(淡い残光)・荷袋・薬莢が**稀に**現れ、「ここで誰かが力尽きた」と読める。
- 壁面に日数の刻み・消えかけた警告が稀に現れる。
- いずれも暗い色調で、ライトに照らされて初めて読める(景観を邪魔しない)。密度が高すぎない。

不合格時の調整(コード側・再コミット): `FLOOR_RATE`/`WALL_RATE`(密度)、各ルーチンの座標/色/alpha。

- [ ] **Step 8: 確認できたら完了。段階D完了、レビューへ。**

---

## セルフレビュー結果

- **スペック網羅(段階D)**: 遺体・携行ライト(残光)・荷袋・薬莢(床)＋日数刻み・警告(壁)= `FLOOR_TYPES`/`WALL_TYPES` と各描画ルーチン、決定論配置 `traceAt`、非衝突オーバーレイ(焼き込みのみ)、将来の断章接続口(座標→id)を Task1/2 が満たす。テキスト本体・インタラクションはスコープ外と明記。
- **プレースホルダ**: なし。全コード・全コマンド・期待出力・調整箇所を明記。
- **型整合**: `Trace`/`TraceType`/`FloorTrace`/`WallTrace`/`FLOOR_TYPES`/`WALL_TYPES`/`traceAt`(traces.ts)を chunkbake・テストが一致使用。`weighted`(hierarchy.ts 既存 export、`{v,w}[]` と r∈[0,1))・`hash2`(noise.ts)を traces.ts が正しく使用。chunkbake の `drawFloorTrace(ctx,tr,tx,ty)`/`drawWallTrace(ctx,tr,tx,ty,dir)` は呼び出しと一致。
- **回帰**: `physics.ts`・worldgen・アトラス無改修。当たり判定は矩形のまま。痕跡は焼き込みキャンバスへの描画のみで tileAt に影響しない。`traceAt` は store を参照せず純粋。既存テストは不変(traces.test を追加するのみ)。
