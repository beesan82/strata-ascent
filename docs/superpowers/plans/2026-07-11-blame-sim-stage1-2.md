# Blame!風探検ゲーム 段階1〜2(歩ける闇+無限の構造体) 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 闇に沈む無限のプロシージャル超構造体を、ライトを頼りに歩き・跳び・梯子で昇れるブラウザゲームを動かす。

**Architecture:** Vite + TypeScript + Canvas 2D、ゲームエンジン不使用。ワールド生成は「シード+ワールド座標 → タイル」の純粋関数で、チャンクストアが遅延生成・キャッシュする。描画はシルエット層の上に闇レイヤーを重ね、光源部分を切り抜く。物理はAABB vs タイルの軸別衝突判定。

**Tech Stack:** Vite 6 / TypeScript 5 / Vitest 3(ランタイム依存ゼロ)

**参照スペック:** `docs/superpowers/specs/2026-07-11-blame-sim-design.md`

**座標系の約束(全タスク共通):**
- ワールド座標は「タイル単位」の浮動小数。**yは下向きが正**(画面と同じ)。上に昇る=yが減る
- 高度(altitude) = `max(0, -y)`。高度500タイルごとに階層(stratum)が切り替わる
- チャンクは64×64タイル。チャンク座標 `(cx, cy)` はワールドタイル座標を64で割った床関数

---

### Task 1: プロジェクト土台

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `index.html`
- Create: `.gitignore`
- Create: `src/main.ts`(仮実装)

- [ ] **Step 1: 設定ファイル群を作成**

`package.json`:

```json
{
  "name": "blame-sim",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "~5.7.2",
    "vite": "^6.0.0",
    "vitest": "^3.0.0"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

`index.html`:

```html
<!doctype html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <title>BLAME! SIM</title>
  <style>
    html, body { margin: 0; height: 100%; overflow: hidden; background: #000; }
    canvas { display: block; }
    #hud {
      position: fixed; left: 12px; top: 10px;
      color: #9aa4ad; font: 12px monospace; letter-spacing: 0.2em;
      pointer-events: none; user-select: none;
    }
  </style>
</head>
<body>
  <canvas id="game"></canvas>
  <div id="hud"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

`.gitignore`:

```
node_modules/
dist/
```

`src/main.ts`(仮 — Task 10 で置き換える):

```ts
const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
ctx.fillStyle = '#07080a';
ctx.fillRect(0, 0, canvas.width, canvas.height);
ctx.fillStyle = '#9aa4ad';
ctx.font = '16px monospace';
ctx.fillText('BLAME! SIM — bootstrap OK', 40, 60);
```

- [ ] **Step 2: 依存をインストール**

Run: `npm install`
Expected: エラーなく完了し `node_modules/` が生成される

- [ ] **Step 3: 開発サーバーの起動確認**

Run: `npm run dev` をバックグラウンドで起動し、表示されたURL(通常 `http://localhost:5173`)にアクセス。黒い画面に「BLAME! SIM — bootstrap OK」が出ればOK。確認後サーバーは止めてよい。

- [ ] **Step 4: コミット**

```bash
git add package.json tsconfig.json index.html .gitignore src/main.ts package-lock.json
git commit -m "chore: Vite + TypeScript プロジェクト土台"
```

---

### Task 2: タイル定義とノイズ関数

**Files:**
- Create: `src/world/tiles.ts`
- Create: `src/world/noise.ts`
- Test: `src/world/noise.test.ts`

- [ ] **Step 1: タイル定義を作成(定数のみ、テスト不要)**

`src/world/tiles.ts`:

```ts
export const TILE = {
  AIR: 0,
  SOLID: 1,
  LADDER: 2,
} as const;

export type Tile = (typeof TILE)[keyof typeof TILE];

export const CHUNK_SIZE = 64;
```

- [ ] **Step 2: ノイズの失敗するテストを書く**

`src/world/noise.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hash2, valueNoise2 } from './noise';

describe('hash2', () => {
  it('同じ入力なら同じ値を返す(決定論)', () => {
    expect(hash2(42, 10, -5)).toBe(hash2(42, 10, -5));
  });

  it('値は [0, 1) に収まる', () => {
    for (let i = 0; i < 1000; i++) {
      const v = hash2(7, i * 31, -i * 17);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('シードが違えば分布が変わる', () => {
    let diff = 0;
    for (let i = 0; i < 100; i++) {
      if (hash2(1, i, i) !== hash2(2, i, i)) diff++;
    }
    expect(diff).toBeGreaterThan(90);
  });
});

describe('valueNoise2', () => {
  it('同じ入力なら同じ値(決定論)', () => {
    expect(valueNoise2(42, 3.7, -1.2)).toBe(valueNoise2(42, 3.7, -1.2));
  });

  it('値は [0, 1] に収まり、なめらかに変化する', () => {
    let prev = valueNoise2(9, 0, 0);
    for (let i = 1; i <= 200; i++) {
      const v = valueNoise2(9, i * 0.05, 0);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(Math.abs(v - prev)).toBeLessThan(0.2); // 隣接サンプルが急変しない
      prev = v;
    }
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npx vitest run src/world/noise.test.ts`
Expected: FAIL(`./noise` モジュールが存在しない)

- [ ] **Step 4: ノイズを実装**

`src/world/noise.ts`:

```ts
/** 整数座標+シード → [0, 1) の決定論的ハッシュ */
export function hash2(seed: number, x: number, y: number): number {
  let h = seed | 0;
  h = Math.imul(h ^ (x | 0), 0x27d4eb2d);
  h = Math.imul(h ^ (y | 0), 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** 格子点ハッシュのスムーズ補間による2D値ノイズ。入力のスケーリングは呼び出し側で行う */
export function valueNoise2(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const v00 = hash2(seed, x0, y0);
  const v10 = hash2(seed, x0 + 1, y0);
  const v01 = hash2(seed, x0, y0 + 1);
  const v11 = hash2(seed, x0 + 1, y0 + 1);
  const top = v00 * (1 - sx) + v10 * sx;
  const bottom = v01 * (1 - sx) + v11 * sx;
  return top * (1 - sy) + bottom * sy;
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npx vitest run src/world/noise.test.ts`
Expected: PASS(5件)

- [ ] **Step 6: コミット**

```bash
git add src/world/tiles.ts src/world/noise.ts src/world/noise.test.ts
git commit -m "feat: タイル定義と決定論的2Dノイズ"
```

---

### Task 3: 階層(strata)定義

**Files:**
- Create: `src/world/strata.ts`
- Test: `src/world/strata.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/world/strata.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { STRATA, STRATUM_HEIGHT, stratumAt, stratumIndexAt } from './strata';

describe('stratumIndexAt', () => {
  it('地表以下(y >= 0)は高度0として階層0', () => {
    expect(stratumIndexAt(0)).toBe(0);
    expect(stratumIndexAt(100)).toBe(0);
  });

  it('高度500タイルごとに階層が1つ進む(yは上がマイナス)', () => {
    expect(stratumIndexAt(-499)).toBe(0);
    expect(stratumIndexAt(-500)).toBe(1);
    expect(stratumIndexAt(-999)).toBe(1);
    expect(stratumIndexAt(-1000)).toBe(2);
  });
});

describe('stratumAt', () => {
  it('定義済み階層を順に返し、末尾以降はループする', () => {
    expect(stratumAt(0)).toBe(STRATA[0]);
    expect(stratumAt(-STRATUM_HEIGHT * STRATA.length)).toBe(STRATA[0]);
    expect(stratumAt(-STRATUM_HEIGHT * (STRATA.length + 1))).toBe(STRATA[1]);
  });

  it('各階層のパラメータは妥当な範囲', () => {
    for (const s of STRATA) {
      expect(s.floorSpacing).toBeGreaterThanOrEqual(6);
      expect(s.gapChance).toBeGreaterThanOrEqual(0);
      expect(s.gapChance).toBeLessThan(1);
      expect(s.massThreshold).toBeGreaterThan(0);
      expect(s.massThreshold).toBeLessThan(1);
      expect(s.cavityThreshold).toBeGreaterThan(0);
      expect(s.cavityThreshold).toBeLessThanOrEqual(1);
    }
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/world/strata.test.ts`
Expected: FAIL(`./strata` モジュールが存在しない)

- [ ] **Step 3: 実装**

`src/world/strata.ts`:

```ts
/** 階層(高度帯)ごとの生成パラメータ */
export interface Stratum {
  name: string;
  /** 床の垂直間隔(タイル) */
  floorSpacing: number;
  /** 床セグメント(16タイル幅)が欠落する確率 */
  gapChance: number;
  /** 柱・壁塊ノイズの閾値。低いほど構造が密 */
  massThreshold: number;
  /** 巨大空洞ノイズの閾値。低いほど空洞が広い */
  cavityThreshold: number;
}

export const STRATUM_HEIGHT = 500;

export const STRATA: readonly Stratum[] = [
  { name: '最下層',   floorSpacing: 8,  gapChance: 0.15, massThreshold: 0.55, cavityThreshold: 0.85 },
  { name: '居住区跡', floorSpacing: 10, gapChance: 0.2,  massThreshold: 0.6,  cavityThreshold: 0.8 },
  { name: '廃棄物層', floorSpacing: 12, gapChance: 0.45, massThreshold: 0.62, cavityThreshold: 0.78 },
  { name: '大空洞帯', floorSpacing: 14, gapChance: 0.35, massThreshold: 0.7,  cavityThreshold: 0.6 },
  { name: '上層',     floorSpacing: 12, gapChance: 0.3,  massThreshold: 0.68, cavityThreshold: 0.7 },
];

/** ワールドy座標 → 階層インデックス(0始まり、ループ前の通し番号) */
export function stratumIndexAt(worldY: number): number {
  const altitude = Math.max(0, -worldY);
  return Math.floor(altitude / STRATUM_HEIGHT);
}

/** ワールドy座標 → 階層パラメータ(末尾以降はループ) */
export function stratumAt(worldY: number): Stratum {
  return STRATA[stratumIndexAt(worldY) % STRATA.length];
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/world/strata.test.ts`
Expected: PASS(4件)

- [ ] **Step 5: コミット**

```bash
git add src/world/strata.ts src/world/strata.test.ts
git commit -m "feat: 階層(strata)ごとの生成パラメータ"
```

---

### Task 4: ワールド生成

**Files:**
- Create: `src/world/worldgen.ts`
- Test: `src/world/worldgen.test.ts`

生成ルール(すべてワールド座標の純粋関数なのでチャンク境界の継ぎ目は発生しない):
1. **巨大空洞**: 低頻度ノイズが階層の `cavityThreshold` を超えた領域は空洞。空洞内は4床帯ごとの「橋」だけ残る
2. **柱・壁塊**: 中頻度ノイズが `massThreshold` を超えたら SOLID
3. **床**: `floorSpacing` ごとの行が床。16タイル幅セグメント単位で `gapChance` の確率で欠落(開口部)
4. **梯子**: 32タイル幅の列グループごとに1本、床帯(band)単位で位置が変わる。床行も貫通する(昇降路)

> **スペックとの差分:** 設計書の「チャンク内の到達可能性を明示的にチェックして孤立空間に梯子を追加する」方式は、「全列グループに常に梯子を置く」規則に簡略化した。これで上方向ルートは実用上常に存在する。プレイして詰みが目立つ場合は段階3(重力子砲=詰み防止手段)の前に到達可能性チェックを追加検討する。

- [ ] **Step 1: 失敗するテストを書く**

`src/world/worldgen.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, TILE } from './tiles';
import { findSpawn, generateChunk, tileAt } from './worldgen';

describe('generateChunk', () => {
  it('同一シード・同一チャンク座標なら完全に同じ出力(決定論)', () => {
    const a = generateChunk(42, 3, -2);
    const b = generateChunk(42, 3, -2);
    expect(a).toEqual(b);
  });

  it('シードが違えば出力が変わる', () => {
    const a = generateChunk(1, 0, 0);
    const b = generateChunk(2, 0, 0);
    expect(a).not.toEqual(b);
  });

  it('チャンクは64x64タイルで、tileAtと一致する', () => {
    const chunk = generateChunk(42, 1, 1);
    expect(chunk.length).toBe(CHUNK_SIZE * CHUNK_SIZE);
    for (let ty = 0; ty < CHUNK_SIZE; ty += 7) {
      for (let tx = 0; tx < CHUNK_SIZE; tx += 7) {
        expect(chunk[ty * CHUNK_SIZE + tx]).toBe(
          tileAt(42, 1 * CHUNK_SIZE + tx, 1 * CHUNK_SIZE + ty),
        );
      }
    }
  });
});

describe('tileAt', () => {
  // 生成パラメータを調整した場合、以下の統計的テストは閾値の見直しが必要になることがある。
  // 失敗したら盲目的にリトライせず、生成結果を目視(またはカウント出力)して原因を確認すること。
  it('広域(256x128タイル)には空気・地形・梯子がすべて存在する', () => {
    for (const seed of [1, 42, 20260711]) {
      const counts = { air: 0, solid: 0, ladder: 0 };
      for (let y = -128; y < 0; y++) {
        for (let x = 0; x < 256; x++) {
          const t = tileAt(seed, x, y);
          if (t === TILE.AIR) counts.air++;
          else if (t === TILE.SOLID) counts.solid++;
          else if (t === TILE.LADDER) counts.ladder++;
        }
      }
      expect(counts.air).toBeGreaterThan(0);
      expect(counts.solid).toBeGreaterThan(0);
      expect(counts.ladder).toBeGreaterThan(0);
    }
  });

  it('床行には開口部(欠落セグメント)が存在する', () => {
    // 最下層(高度0〜500)の床間隔は8。床行のうちAIRになっている箇所が広域に必ずある
    let gaps = 0;
    for (let x = 0; x < 512; x++) {
      if (tileAt(42, x, -8) !== TILE.SOLID) gaps++;
    }
    expect(gaps).toBeGreaterThan(0);
  });
});

describe('findSpawn', () => {
  it('スポーン位置はSOLIDの中ではない', () => {
    for (const seed of [1, 42, 20260711]) {
      const { x, y } = findSpawn(seed);
      expect(tileAt(seed, Math.floor(x), Math.floor(y))).not.toBe(TILE.SOLID);
    }
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/world/worldgen.test.ts`
Expected: FAIL(`./worldgen` モジュールが存在しない)

- [ ] **Step 3: 実装**

`src/world/worldgen.ts`:

```ts
import { hash2, valueNoise2 } from './noise';
import { stratumAt } from './strata';
import { CHUNK_SIZE, TILE, type Tile } from './tiles';

/** 負数でも正しく回る剰余 */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** シード+ワールドタイル座標 → タイル種。純粋関数(同じ入力なら常に同じ出力) */
export function tileAt(seed: number, x: number, y: number): Tile {
  const s = stratumAt(y);

  // 床帯(band): floorSpacing行ごとのまとまり。床行はbandの先頭行
  const band = Math.floor(y / s.floorSpacing);
  const isFloorRow = mod(y, s.floorSpacing) === 0;
  const seg = Math.floor(x / 16);
  const floorGap = hash2(seed + 303, seg, band) < s.gapChance;

  // 1. 巨大空洞(低頻度ノイズ)。空洞内は4床帯ごとの橋だけ残る
  const cavity = valueNoise2(seed + 101, x / 160, y / 160) > s.cavityThreshold;
  if (cavity) {
    if (isFloorRow && mod(band, 4) === 0 && !floorGap) return TILE.SOLID;
    return TILE.AIR;
  }

  // 2. 柱・壁塊(中頻度ノイズ)
  const mass = valueNoise2(seed + 202, x / 28, y / 28) > s.massThreshold;
  if (mass) return TILE.SOLID;

  // 3. 梯子: 32タイル幅の列グループごとに1本。床行も貫通して上下のbandをつなぐ
  const group = Math.floor(x / 32);
  const ladderX = group * 32 + Math.floor(hash2(seed + 404, group, band) * 32);
  if (x === ladderX) return TILE.LADDER;

  // 4. 床
  if (isFloorRow && !floorGap) return TILE.SOLID;

  return TILE.AIR;
}

/** チャンク(64x64)のタイル配列を生成。index = ty * CHUNK_SIZE + tx */
export function generateChunk(seed: number, cx: number, cy: number): Uint8Array {
  const data = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  const baseX = cx * CHUNK_SIZE;
  const baseY = cy * CHUNK_SIZE;
  for (let ty = 0; ty < CHUNK_SIZE; ty++) {
    for (let tx = 0; tx < CHUNK_SIZE; tx++) {
      data[ty * CHUNK_SIZE + tx] = tileAt(seed, baseX + tx, baseY + ty);
    }
  }
  return data;
}

/** 開始地点: x=8付近で「足元が床・体の入る空間」を上から探す */
export function findSpawn(seed: number): { x: number; y: number } {
  for (let y = -1; y < 400; y++) {
    const head = tileAt(seed, 8, y - 1);
    const body = tileAt(seed, 8, y);
    const below = tileAt(seed, 8, y + 1);
    if (head !== TILE.SOLID && body !== TILE.SOLID && below === TILE.SOLID) {
      // 床の上面(y+1の上端)に高さ1.75の体を置く。少し浮かせて重力で着地させる
      // 体(幅0.75)が検証済みのx=8列に収まるようx=8.1に置く
      return { x: 8.1, y: y + 1 - 1.9 };
    }
  }
  return { x: 8.1, y: 0 };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/world/worldgen.test.ts`
Expected: PASS(6件)。統計的テストが失敗した場合はテスト内コメントに従い原因を確認する

- [ ] **Step 5: コミット**

```bash
git add src/world/worldgen.ts src/world/worldgen.test.ts
git commit -m "feat: プロシージャルワールド生成(空洞・柱・床・梯子)"
```

---

### Task 5: チャンクストア

**Files:**
- Create: `src/world/chunks.ts`
- Test: `src/world/chunks.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/world/chunks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ChunkStore } from './chunks';
import { tileAt } from './worldgen';

describe('ChunkStore', () => {
  it('同じチャンクを二度取得するとキャッシュされた同一インスタンスを返す', () => {
    const store = new ChunkStore(42);
    const a = store.getChunk(0, 0);
    const b = store.getChunk(0, 0);
    expect(a).toBe(b);
    expect(store.size).toBe(1);
  });

  it('tileAtはworldgenの結果と一致する(負座標も含む)', () => {
    const store = new ChunkStore(42);
    for (const [x, y] of [[0, 0], [63, 63], [64, 64], [-1, -1], [-65, 130]] as const) {
      expect(store.tileAt(x, y)).toBe(tileAt(42, x, y));
    }
  });

  it('evictFarFromは遠いチャンクだけ破棄する', () => {
    const store = new ChunkStore(42);
    store.getChunk(0, 0);
    store.getChunk(1, 0);
    store.getChunk(10, 10);
    store.evictFarFrom(0, 0, 2);
    expect(store.size).toBe(2);
    // 近いチャンクは残っている(再生成されない=同一インスタンス)
    const kept = store.getChunk(1, 0);
    expect(store.size).toBe(2);
    expect(kept).toBe(store.getChunk(1, 0));
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/world/chunks.test.ts`
Expected: FAIL(`./chunks` モジュールが存在しない)

- [ ] **Step 3: 実装**

`src/world/chunks.ts`:

```ts
import { CHUNK_SIZE, type Tile } from './tiles';
import { generateChunk } from './worldgen';

/** チャンクの遅延生成・キャッシュ・破棄。ワールドへの唯一のアクセス窓口 */
export class ChunkStore {
  private chunks = new Map<string, Uint8Array>();

  constructor(readonly seed: number) {}

  get size(): number {
    return this.chunks.size;
  }

  getChunk(cx: number, cy: number): Uint8Array {
    const key = `${cx},${cy}`;
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = generateChunk(this.seed, cx, cy);
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  /** ワールドタイル座標でタイルを引く(必要なチャンクは自動生成) */
  tileAt(x: number, y: number): Tile {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cy = Math.floor(y / CHUNK_SIZE);
    const tx = x - cx * CHUNK_SIZE;
    const ty = y - cy * CHUNK_SIZE;
    return this.getChunk(cx, cy)[ty * CHUNK_SIZE + tx] as Tile;
  }

  /** 指定チャンクからチェビシェフ距離radiusを超えるチャンクを破棄 */
  evictFarFrom(cx: number, cy: number, radius: number): void {
    for (const key of this.chunks.keys()) {
      const [kx, ky] = key.split(',').map(Number);
      if (Math.max(Math.abs(kx - cx), Math.abs(ky - cy)) > radius) {
        this.chunks.delete(key);
      }
    }
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/world/chunks.test.ts`
Expected: PASS(3件)

- [ ] **Step 5: コミット**

```bash
git add src/world/chunks.ts src/world/chunks.test.ts
git commit -m "feat: チャンクの遅延生成・キャッシュ・破棄"
```

---

### Task 6: 物理(AABB vs タイル)

**Files:**
- Create: `src/entities/physics.ts`
- Test: `src/entities/physics.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/entities/physics.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TILE, type Tile } from '../world/tiles';
import { moveBody, type Body } from './physics';

/** y=5行だけが床、x=10列だけが壁のテストワールド */
const testTiles = (tx: number, ty: number): Tile => {
  if (ty === 5) return TILE.SOLID;
  if (tx === 10) return TILE.SOLID;
  return TILE.AIR;
};

const emptyTiles = (): Tile => TILE.AIR;

function makeBody(x: number, y: number): Body {
  return { x, y, w: 0.75, h: 1.75, vx: 0, vy: 0, onGround: false };
}

describe('moveBody', () => {
  it('何もない空間では等速で動く', () => {
    const b = makeBody(0, 0);
    b.vx = 4;
    b.vy = 2;
    moveBody(b, 0.5, emptyTiles);
    expect(b.x).toBeCloseTo(2);
    expect(b.y).toBeCloseTo(1);
    expect(b.onGround).toBe(false);
  });

  it('落下すると床の上で止まり、onGroundになる', () => {
    const b = makeBody(2, 2); // 体の底 = 3.75、床上面 = 5
    b.vy = 10;
    moveBody(b, 1, testTiles);
    expect(b.y + b.h).toBeLessThanOrEqual(5 + 1e-6);
    expect(b.y + b.h).toBeGreaterThan(4.8); // 床のすぐ上まで詰めている
    expect(b.vy).toBe(0);
    expect(b.onGround).toBe(true);
  });

  it('壁に向かって歩くと壁の手前で止まる', () => {
    const b = makeBody(8, 0); // 右端 = 8.75、壁の左面 = 10
    b.vx = 10;
    moveBody(b, 1, testTiles);
    expect(b.x + b.w).toBeLessThanOrEqual(10 + 1e-6);
    expect(b.x + b.w).toBeGreaterThan(9.8);
    expect(b.vx).toBe(0);
  });

  it('梯子タイルは通り抜けられる(SOLIDのみが衝突対象)', () => {
    const ladderTiles = (_tx: number, ty: number): Tile =>
      ty === 5 ? TILE.LADDER : TILE.AIR;
    const b = makeBody(0, 3);
    b.vy = 10;
    moveBody(b, 1, ladderTiles);
    expect(b.y).toBeCloseTo(13); // 素通り
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/entities/physics.test.ts`
Expected: FAIL(`./physics` モジュールが存在しない)

- [ ] **Step 3: 実装**

`src/entities/physics.ts`:

```ts
import { TILE, type Tile } from '../world/tiles';

/** 物理ボディ。座標はタイル単位、(x, y)は左上、yは下向きが正 */
export interface Body {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  onGround: boolean;
}

export type TileLookup = (tx: number, ty: number) => Tile;

const EPS = 1e-9;
const STEP = 1 / 16;

function collides(tiles: TileLookup, x: number, y: number, w: number, h: number): boolean {
  const x0 = Math.floor(x);
  const x1 = Math.floor(x + w - EPS);
  const y0 = Math.floor(y);
  const y1 = Math.floor(y + h - EPS);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (tiles(tx, ty) === TILE.SOLID) return true;
    }
  }
  return false;
}

/** 軸別に移動して衝突解決する。衝突した軸の速度は0になり、下方向の衝突でonGroundが立つ */
export function moveBody(body: Body, dt: number, tiles: TileLookup): void {
  // X軸
  let nx = body.x + body.vx * dt;
  if (collides(tiles, nx, body.y, body.w, body.h)) {
    const step = Math.sign(body.vx) * STEP;
    nx = body.x;
    while (!collides(tiles, nx + step, body.y, body.w, body.h)) nx += step;
    body.vx = 0;
  }
  body.x = nx;

  // Y軸
  let ny = body.y + body.vy * dt;
  body.onGround = false;
  if (collides(tiles, body.x, ny, body.w, body.h)) {
    const step = Math.sign(body.vy) * STEP;
    ny = body.y;
    while (!collides(tiles, body.x, ny + step, body.w, body.h)) ny += step;
    if (body.vy > 0) body.onGround = true;
    body.vy = 0;
  }
  body.y = ny;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/entities/physics.test.ts`
Expected: PASS(4件)

- [ ] **Step 5: コミット**

```bash
git add src/entities/physics.ts src/entities/physics.test.ts
git commit -m "feat: AABB vs タイルの軸別衝突物理"
```

---

### Task 7: プレイヤー

**Files:**
- Create: `src/entities/player.ts`
- Test: `src/entities/player.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/entities/player.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TILE, type Tile } from '../world/tiles';
import { Player, type PlayerInput } from './player';

const noInput: PlayerInput = { left: false, right: false, jump: false, up: false, down: false };
const emptyTiles = (): Tile => TILE.AIR;
/** y=10行が床 */
const floorTiles = (_tx: number, ty: number): Tile => (ty === 10 ? TILE.SOLID : TILE.AIR);
/** x=3列が梯子、y=10行が床 */
const ladderTiles = (tx: number, ty: number): Tile => {
  if (ty === 10) return TILE.SOLID;
  if (tx === 3) return TILE.LADDER;
  return TILE.AIR;
};

describe('Player', () => {
  it('空中では重力で落ちる', () => {
    const p = new Player(0, 0);
    p.update(noInput, 1 / 60, emptyTiles);
    expect(p.body.vy).toBeGreaterThan(0);
    expect(p.body.y).toBeGreaterThan(0);
  });

  it('左右入力で移動する', () => {
    const p = new Player(5, 0);
    p.update({ ...noInput, right: true }, 1 / 60, emptyTiles);
    expect(p.body.x).toBeGreaterThan(5);
  });

  it('接地中のみジャンプできる', () => {
    const p = new Player(0, 8);
    // 着地するまで落とす
    for (let i = 0; i < 120; i++) p.update(noInput, 1 / 60, floorTiles);
    expect(p.body.onGround).toBe(true);
    p.update({ ...noInput, jump: true }, 1 / 60, floorTiles);
    expect(p.body.vy).toBeLessThan(0); // 上向き

    // 空中で再ジャンプはできない(vyは重力に従うだけ)
    const vyAfterJump = p.body.vy;
    p.update({ ...noInput, jump: true }, 1 / 60, floorTiles);
    expect(p.body.vy).toBeGreaterThan(vyAfterJump);
  });

  it('梯子の上では重力を受けず、上入力で昇れる', () => {
    const p = new Player(2.8, 5); // 体の中心xが梯子列(x=3)に重なる
    const y0 = p.body.y;
    p.update({ ...noInput, up: true }, 1 / 60, ladderTiles);
    expect(p.body.y).toBeLessThan(y0);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/entities/player.test.ts`
Expected: FAIL(`./player` モジュールが存在しない)

- [ ] **Step 3: 実装**

`src/entities/player.ts`:

```ts
import { TILE } from '../world/tiles';
import { moveBody, type Body, type TileLookup } from './physics';

export interface PlayerInput {
  left: boolean;
  right: boolean;
  jump: boolean;
  up: boolean;
  down: boolean;
}

const WALK_SPEED = 6; // タイル/秒
const CLIMB_SPEED = 4;
const JUMP_VELOCITY = -13;
const GRAVITY = 30;
const MAX_FALL = 25;

export class Player {
  body: Body;

  constructor(x: number, y: number) {
    this.body = { x, y, w: 0.75, h: 1.75, vx: 0, vy: 0, onGround: false };
  }

  get centerX(): number {
    return this.body.x + this.body.w / 2;
  }

  get centerY(): number {
    return this.body.y + this.body.h / 2;
  }

  update(input: PlayerInput, dt: number, tiles: TileLookup): void {
    const b = this.body;
    b.vx = (input.right ? WALK_SPEED : 0) - (input.left ? WALK_SPEED : 0);

    if (this.onLadder(tiles)) {
      b.vy = (input.down ? CLIMB_SPEED : 0) - (input.up ? CLIMB_SPEED : 0);
    } else {
      b.vy = Math.min(b.vy + GRAVITY * dt, MAX_FALL);
      if (input.jump && b.onGround) b.vy = JUMP_VELOCITY;
    }

    moveBody(b, dt, tiles);
  }

  private onLadder(tiles: TileLookup): boolean {
    return tiles(Math.floor(this.centerX), Math.floor(this.centerY)) === TILE.LADDER;
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/entities/player.test.ts`
Expected: PASS(4件)

- [ ] **Step 5: コミット**

```bash
git add src/entities/player.ts src/entities/player.test.ts
git commit -m "feat: プレイヤーの移動・ジャンプ・梯子昇降"
```

---

### Task 8: 入力とカメラ

**Files:**
- Create: `src/core/input.ts`
- Create: `src/core/camera.ts`
- Test: `src/core/camera.test.ts`

入力はブラウザイベントの薄いラッパーなのでユニットテストは書かない。カメラは純粋ロジックなのでテストする。

- [ ] **Step 1: カメラの失敗するテストを書く**

`src/core/camera.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Camera } from './camera';

describe('Camera', () => {
  it('目標に向かって近づく(指数的追従)', () => {
    const cam = new Camera(0, 0);
    cam.follow(10, -20, 1 / 60);
    expect(cam.x).toBeGreaterThan(0);
    expect(cam.x).toBeLessThan(10);
    expect(cam.y).toBeLessThan(0);
    expect(cam.y).toBeGreaterThan(-20);
  });

  it('時間が経てば目標にほぼ一致する', () => {
    const cam = new Camera(0, 0);
    for (let i = 0; i < 300; i++) cam.follow(10, -20, 1 / 60);
    expect(cam.x).toBeCloseTo(10, 1);
    expect(cam.y).toBeCloseTo(-20, 1);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/core/camera.test.ts`
Expected: FAIL(`./camera` モジュールが存在しない)

- [ ] **Step 3: カメラと入力を実装**

`src/core/camera.ts`:

```ts
/** プレイヤーを滑らかに追うカメラ。(x, y)は画面中心のワールド座標(タイル単位) */
export class Camera {
  constructor(
    public x: number,
    public y: number,
  ) {}

  follow(targetX: number, targetY: number, dt: number): void {
    const k = 1 - Math.exp(-8 * dt);
    this.x += (targetX - this.x) * k;
    this.y += (targetY - this.y) * k;
  }
}
```

`src/core/input.ts`:

```ts
import type { PlayerInput } from '../entities/player';

/** キーボード・マウス状態の集約。updateループから同期的に読む */
export class Input {
  private keys = new Set<string>();
  mouseX = 0;
  mouseY = 0;

  constructor() {
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  get state(): PlayerInput {
    return {
      left: this.keys.has('ArrowLeft') || this.keys.has('KeyA'),
      right: this.keys.has('ArrowRight') || this.keys.has('KeyD'),
      jump: this.keys.has('Space'),
      up: this.keys.has('ArrowUp') || this.keys.has('KeyW'),
      down: this.keys.has('ArrowDown') || this.keys.has('KeyS'),
    };
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/core/camera.test.ts`
Expected: PASS(2件)

- [ ] **Step 5: コミット**

```bash
git add src/core/camera.ts src/core/camera.test.ts src/core/input.ts
git commit -m "feat: カメラ追従と入力集約"
```

---

### Task 9: 描画(シルエット+闇+ライト)

**Files:**
- Create: `src/render/silhouette.ts`
- Create: `src/render/lighting.ts`
- Create: `src/render/renderer.ts`

描画はブラウザでの目視確認のみ(ユニットテストなし)。ルックの正解は「ほぼ闇。プレイヤー周囲の環境光とマウス方向のライト円錐だけが構造を照らし、構造はシルエットで浮かぶ」。

- [ ] **Step 1: シルエット描画を実装**

`src/render/silhouette.ts`:

```ts
import type { ChunkStore } from '../world/chunks';
import { stratumIndexAt } from '../world/strata';
import { TILE } from '../world/tiles';

/** 階層ごとに構造の色味をわずかに変える(すべて暗色) */
const STRATUM_TINTS = ['#14181d', '#151a17', '#1a1714', '#12141c', '#171219'];

/**
 * 可視範囲のタイルをシルエットで描く。
 * camX/camY: 画面中心のワールド座標(タイル)、ppt: 1タイルあたりのピクセル数
 */
export function drawTiles(
  ctx: CanvasRenderingContext2D,
  store: ChunkStore,
  camX: number,
  camY: number,
  viewW: number,
  viewH: number,
  ppt: number,
): void {
  const halfW = viewW / ppt / 2;
  const halfH = viewH / ppt / 2;
  const x0 = Math.floor(camX - halfW) - 1;
  const x1 = Math.ceil(camX + halfW) + 1;
  const y0 = Math.floor(camY - halfH) - 1;
  const y1 = Math.ceil(camY + halfH) + 1;

  for (let ty = y0; ty <= y1; ty++) {
    const tint = STRATUM_TINTS[stratumIndexAt(ty) % STRATUM_TINTS.length];
    for (let tx = x0; tx <= x1; tx++) {
      const t = store.tileAt(tx, ty);
      if (t === TILE.AIR) continue;
      const sx = (tx - camX) * ppt + viewW / 2;
      const sy = (ty - camY) * ppt + viewH / 2;
      if (t === TILE.SOLID) {
        ctx.fillStyle = tint;
        // +1で継ぎ目の光漏れを防ぐ
        ctx.fillRect(sx, sy, ppt + 1, ppt + 1);
      } else if (t === TILE.LADDER) {
        ctx.strokeStyle = '#2a3038';
        ctx.lineWidth = Math.max(1, ppt / 12);
        ctx.beginPath();
        // 縦桟2本
        ctx.moveTo(sx + ppt * 0.25, sy);
        ctx.lineTo(sx + ppt * 0.25, sy + ppt);
        ctx.moveTo(sx + ppt * 0.75, sy);
        ctx.lineTo(sx + ppt * 0.75, sy + ppt);
        // 横桟
        ctx.moveTo(sx + ppt * 0.25, sy + ppt * 0.5);
        ctx.lineTo(sx + ppt * 0.75, sy + ppt * 0.5);
        ctx.stroke();
      }
    }
  }
}
```

- [ ] **Step 2: ライティングを実装**

`src/render/lighting.ts`:

```ts
/**
 * 闇レイヤー。オフスクリーンCanvasを闇で塗り、光源部分をdestination-outで
 * 切り抜いてからメイン画面に重ねる。
 */
export class Lighting {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;

  resize(w: number, h: number): void {
    this.canvas.width = w;
    this.canvas.height = h;
  }

  /**
   * px/py: プレイヤーの画面座標(ピクセル)、angle: ライト方向(ラジアン)、
   * ppt: 1タイルあたりのピクセル数(光の半径をタイル数で指定するため)
   */
  render(mainCtx: CanvasRenderingContext2D, px: number, py: number, angle: number, ppt: number): void {
    const { width: w, height: h } = this.canvas;
    const ctx = this.ctx;

    // ほぼ完全な闇を敷く
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.965)';
    ctx.fillRect(0, 0, w, h);

    ctx.globalCompositeOperation = 'destination-out';

    // プレイヤー周囲の環境光(半径6タイル)
    const ambientR = 6 * ppt;
    const ambient = ctx.createRadialGradient(px, py, 0, px, py, ambientR);
    ambient.addColorStop(0, 'rgba(0, 0, 0, 0.85)');
    ambient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = ambient;
    ctx.beginPath();
    ctx.arc(px, py, ambientR, 0, Math.PI * 2);
    ctx.fill();

    // ライトの円錐(半径22タイル、半角0.32rad)
    const coneR = 22 * ppt;
    const halfAngle = 0.32;
    const cone = ctx.createRadialGradient(px, py, 0, px, py, coneR);
    cone.addColorStop(0, 'rgba(0, 0, 0, 0.95)');
    cone.addColorStop(0.7, 'rgba(0, 0, 0, 0.5)');
    cone.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.arc(px, py, coneR, angle - halfAngle, angle + halfAngle);
    ctx.closePath();
    ctx.fill();

    mainCtx.drawImage(this.canvas, 0, 0);
  }
}
```

- [ ] **Step 3: レンダラー統括を実装**

`src/render/renderer.ts`:

```ts
import type { Camera } from '../core/camera';
import type { Player } from '../entities/player';
import type { ChunkStore } from '../world/chunks';
import { Lighting } from './lighting';
import { drawTiles } from './silhouette';

/** 画面の横幅に収めるタイル数(スケール感の基準) */
const VIEW_TILES_X = 44;

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private lighting = new Lighting();

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize(w: number, h: number): void {
    this.canvas.width = w;
    this.canvas.height = h;
    this.lighting.resize(w, h);
  }

  render(store: ChunkStore, cam: Camera, player: Player, mouseX: number, mouseY: number): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const ppt = w / VIEW_TILES_X;
    const ctx = this.ctx;

    // 背景(照らされた時に構造の背後に見える最暗色)
    ctx.fillStyle = '#07080a';
    ctx.fillRect(0, 0, w, h);

    drawTiles(ctx, store, cam.x, cam.y, w, h, ppt);

    // プレイヤー(明るいシルエット)
    const px = (player.centerX - cam.x) * ppt + w / 2;
    const py = (player.centerY - cam.y) * ppt + h / 2;
    const pw = player.body.w * ppt;
    const ph = player.body.h * ppt;
    ctx.fillStyle = '#c8ccd2';
    ctx.fillRect(px - pw / 2, py - ph / 2, pw, ph);

    // 闇+ライト
    const angle = Math.atan2(mouseY - py, mouseX - px);
    this.lighting.render(ctx, px, py, angle, ppt);
  }
}
```

- [ ] **Step 4: 型チェックが通ることを確認**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 5: コミット**

```bash
git add src/render/silhouette.ts src/render/lighting.ts src/render/renderer.ts
git commit -m "feat: シルエット描画・闇レイヤー・レンダラー統括"
```

---

### Task 10: ゲームループ統合

**Files:**
- Modify: `src/main.ts`(仮実装を全置換)

- [ ] **Step 1: main.tsを本実装に置き換える**

`src/main.ts`(全置換):

```ts
import { Camera } from './core/camera';
import { Input } from './core/input';
import { Player } from './entities/player';
import { Renderer } from './render/renderer';
import { ChunkStore } from './world/chunks';
import { stratumAt } from './world/strata';
import { CHUNK_SIZE } from './world/tiles';
import { findSpawn } from './world/worldgen';

const DEFAULT_SEED = 20260711;
const STEP_MS = 1000 / 60;
const EVICT_INTERVAL_FRAMES = 120;
const EVICT_RADIUS = 4;

// ?seed=123 で世界を変えられる
const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed')) || DEFAULT_SEED;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hud = document.getElementById('hud')!;

const store = new ChunkStore(seed);
const spawn = findSpawn(seed);
const player = new Player(spawn.x, spawn.y);
const camera = new Camera(player.centerX, player.centerY);
const input = new Input();
const renderer = new Renderer(canvas);

function resize(): void {
  renderer.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

const tiles = (tx: number, ty: number) => store.tileAt(tx, ty);

let frames = 0;

function update(dt: number): void {
  player.update(input.state, dt, tiles);
  camera.follow(player.centerX, player.centerY, dt);

  frames++;
  if (frames % EVICT_INTERVAL_FRAMES === 0) {
    const pcx = Math.floor(player.centerX / CHUNK_SIZE);
    const pcy = Math.floor(player.centerY / CHUNK_SIZE);
    store.evictFarFrom(pcx, pcy, EVICT_RADIUS);
  }
}

function updateHud(): void {
  const altitude = Math.max(0, Math.floor(-player.body.y));
  const stratum = stratumAt(player.body.y);
  hud.textContent = `高度 ${altitude}m — ${stratum.name} [seed:${seed}]`;
}

let last = performance.now();
let acc = 0;

function frame(now: number): void {
  acc += Math.min(now - last, 100); // タブ復帰時のスパイラル防止
  last = now;
  while (acc >= STEP_MS) {
    update(STEP_MS / 1000);
    acc -= STEP_MS;
  }
  renderer.render(store, camera, player, input.mouseX, input.mouseY);
  updateHud();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
```

- [ ] **Step 2: 全テストと型チェック**

Run: `npm test && npx tsc --noEmit`
Expected: 全テストPASS、型エラーなし

- [ ] **Step 3: ブラウザで手動確認**

Run: `npm run dev` を起動してブラウザで開き、以下を確認:

1. 画面がほぼ闇で、プレイヤー周囲だけ照らされている
2. マウスを動かすとライトの円錐が追従する
3. A/D(←→)で歩き、Spaceでジャンプし、床・壁で正しく止まる
4. 梯子(縦桟の見えるタイル)に重なってW(↑)を押すと昇れる
5. 昇り続ける(または `?seed=` を変えて落下地点を探す)と、HUDの高度が増え、階層名が変わる
6. 巨大空洞(広い暗黒空間)がどこかに存在する
7. 数分歩き回ってもフレーム落ち・メモリ肥大がない(チャンク破棄が効いている)

問題があれば修正してから次へ。**操作感(ジャンプの高さ・歩く速さ)とルック(闇の濃さ・ライトの radius)はここで調整してよい**。調整した定数はコミットに含める。

- [ ] **Step 4: コミット**

```bash
git add src/main.ts
git commit -m "feat: ゲームループ統合 — 闇の構造体を歩ける"
```

---

### Task 11: 最終確認

- [ ] **Step 1: 全テスト・型チェック・ビルド**

Run: `npm test && npm run build`
Expected: 全テストPASS、ビルド成功(`dist/` 生成)

- [ ] **Step 2: ビルド成果物の動作確認**

Run: `npm run preview` で `dist/` を配信し、ブラウザで開いてTask 10 Step 3の項目1〜4を再確認

- [ ] **Step 3: 未コミットの変更があればコミット**

```bash
git status
# 変更が残っていれば:
git add -A
git commit -m "chore: 段階1-2完了時点の調整"
```

---

## この計画のスコープ外(次の計画で扱う)

- 段階3: セーフガードAI、重力子放射線射出装置(地形破壊・破壊差分マップ)、死亡と中継塔リスポーン
- 段階4: ログ端末と断章、ライトエネルギー管理、セーブ/ロード、巨大空間のカメラズーム演出、環境音

`Player.lightEnergy` などのリソース項目は段階4まで導入しない(YAGNI)。
