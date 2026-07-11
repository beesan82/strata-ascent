# Super Metroid級ビジュアル刷新 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「闇+懐中電灯」を捨て、オートタイル+バイオーム別の色付き環境光+多層パララックスで、Super Metroidのように明るく読みやすく密度の高い探索画面にする。

**Architecture:** アセット非依存パイプライン。起動時にコード生成の47ブロブ・タイルアトラス(Canvas)を焼き、`autotile.ts`(純粋関数)が近傍ビットマスクからタイルIDを決める。`chunkbake.ts` がSOLIDをアトラスから貼りアクセントを重ねる。`biome.ts`(純粋)が階層→色・明度・背景を定義し、`lighting.ts` は全体を照らすバイオーム環境光+プレイヤー補助光へ転換。ゲームプレイ(worldgen/physics)には一切触れない。

**Tech Stack:** 既存(Vite/TS/Canvas 2D/Vitest/Playwright)。ランタイム依存は増やさない。

**参照スペック:** `docs/superpowers/specs/2026-07-12-blame-sim-supermetroid-look-design.md`

**全タスク共通の約束:**
- 見た目の定数(色・明度・線幅・確率)は初期値。スクリーンショットで目視し、SM級に近づける範囲での調整は実装者裁量(調整はコミットに含める)
- gameplay(`src/world/*`, `src/entities/physics.ts`, `player.ts`の移動ロジック)は変更しない。`player.ts`はTask 7で描画用フィールド追加のみ許可(既にfacing/walkPhaseあり)
- 既存の全テスト(現在50件)は回帰なしで維持
- スクリーンショット: `node scripts/screenshot.mjs --out=screenshots/NAME.png [--pos=x,y] [--seed=N]`。exit 0 と [pageerror] 無しを毎回確認
- 座標規約: ワールドy下向き正、CHUNK_SIZE=64、既存 `tileAt(seed,x,y)` が真実の地形

---

### Task 1: オートタイル(近傍ビットマスク → 47ブロブID)

**Files:**
- Create: `src/render/tileset/autotile.ts`
- Test: `src/render/tileset/autotile.test.ts`

47ブロブ(blob/Wang)方式: あるSOLIDタイルの周囲8方向の「同種(SOLID)か否か」から、辺4・角4の接続を見てタイル形状IDを決める。角は「両隣の辺が繋がっている時のみ」内側として意味を持つ標準ルール。IDは0〜47の範囲に正規化された連番(内部表現は自由だが決定論的で衝突しないこと)。

- [ ] **Step 1: 失敗するテストを書く**

`src/render/tileset/autotile.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { blobId, BLOB_COUNT } from './autotile';

/** 8近傍の真偽(N,E,S,W,NE,SE,SW,NW)を受けてIDを返すヘルパ */
function id(n: boolean, e: boolean, s: boolean, w: boolean, ne: boolean, se: boolean, sw: boolean, nw: boolean) {
  return blobId({ n, e, s, w, ne, se, sw, nw });
}
const T = true;
const F = false;

describe('blobId', () => {
  it('決定論的: 同じ近傍なら同じID', () => {
    expect(id(T, F, T, F, F, F, F, F)).toBe(id(T, F, T, F, F, F, F, F));
  });

  it('孤立タイル(周囲すべて空気)は単一のID', () => {
    const isolated = id(F, F, F, F, F, F, F, F);
    expect(isolated).toBeGreaterThanOrEqual(0);
    expect(isolated).toBeLessThan(BLOB_COUNT);
  });

  it('全方向SOLIDは「内部」ID、孤立とは別物', () => {
    const inner = id(T, T, T, T, T, T, T, T);
    const isolated = id(F, F, F, F, F, F, F, F);
    expect(inner).not.toBe(isolated);
  });

  it('角ビットは両隣の辺が繋がっている時のみ意味を持つ(標準47ブロブ規則)', () => {
    // N,EがSOLIDでNE角が空気 → 内隅。NE角のSOLID有無で見た目が変わる
    const cornerAir = id(T, T, F, F, F, F, F, F);
    const cornerSolid = id(T, T, F, F, T, F, F, F);
    expect(cornerAir).not.toBe(cornerSolid);
    // N,EのどちらかがAIRなら、NE角のSOLID有無はIDに影響しない(角は無意味)
    const a = id(T, F, F, F, T, F, F, F);
    const b = id(T, F, F, F, F, F, F, F);
    expect(a).toBe(b);
  });

  it('全IDは 0..BLOB_COUNT-1 に収まり、BLOB_COUNTは47', () => {
    expect(BLOB_COUNT).toBe(47);
    // 256通りの辺+角の組合せを走査し、範囲を確認
    for (let m = 0; m < 256; m++) {
      const nb = {
        n: !!(m & 1), e: !!(m & 2), s: !!(m & 4), w: !!(m & 8),
        ne: !!(m & 16), se: !!(m & 32), sw: !!(m & 64), nw: !!(m & 128),
      };
      const v = blobId(nb);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(BLOB_COUNT);
    }
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/render/tileset/autotile.test.ts`
Expected: FAIL(モジュール未作成)

- [ ] **Step 3: 実装**

`src/render/tileset/autotile.ts`:

```ts
/** 対象タイルの8近傍がSOLID(同種)かどうか */
export interface Neighbors {
  n: boolean; e: boolean; s: boolean; w: boolean;
  ne: boolean; se: boolean; sw: boolean; nw: boolean;
}

/** 標準47ブロブ(孤立を含む全形状) */
export const BLOB_COUNT = 47;

/**
 * 標準47ブロブ規則。辺(N,E,S,W)の接続を基本に、角(NE,SE,SW,NW)は
 * 両隣の辺が繋がっている場合のみ「内側が埋まっているか」を意味づける。
 * これにより角の見た目(外向き丸め/内隅)が一意に決まる。
 * 返り値は 0..47 の決定論的な連番(canonical mask → 密な索引)。
 */
export function blobId(nb: Neighbors): number {
  // 角は両隣の辺が両方SOLIDのときのみ有効
  const ne = nb.n && nb.e && nb.ne;
  const se = nb.s && nb.e && nb.se;
  const sw = nb.s && nb.w && nb.sw;
  const nw = nb.n && nb.w && nb.nw;
  // 正規化マスク: 辺4bit + 有効な角4bit = 8bit(ただし到達可能な組合せは48通り)
  const mask =
    (nb.n ? 1 : 0) | (nb.e ? 2 : 0) | (nb.s ? 4 : 0) | (nb.w ? 8 : 0) |
    (ne ? 16 : 0) | (se ? 32 : 0) | (sw ? 64 : 0) | (nw ? 128 : 0);
  return CANONICAL.get(mask)!;
}

/** 到達可能な48マスクを昇順で密な索引へ写す(モジュール読込時に1度構築) */
const CANONICAL: Map<number, number> = (() => {
  const seen = new Set<number>();
  for (let m = 0; m < 256; m++) {
    const n = !!(m & 1), e = !!(m & 2), s = !!(m & 4), w = !!(m & 8);
    const ne = n && e && !!(m & 16);
    const se = s && e && !!(m & 32);
    const sw = s && w && !!(m & 64);
    const nw = n && w && !!(m & 128);
    const canon =
      (n ? 1 : 0) | (e ? 2 : 0) | (s ? 4 : 0) | (w ? 8 : 0) |
      (ne ? 16 : 0) | (se ? 32 : 0) | (sw ? 64 : 0) | (nw ? 128 : 0);
    seen.add(canon);
  }
  const sorted = [...seen].sort((a, b) => a - b);
  const map = new Map<number, number>();
  sorted.forEach((canon, i) => map.set(canon, i));
  return map;
})();
```

注: 上の構築で `seen` の要素数はちょうど47になる(辺の組合せごとに有効な角のみを数えた標準47ブロブ。検算: 辺0=1, 辺1=4, 辺2=隣接4×2+対向2=10, 辺3=4×4=16, 辺4=2^4=16, 計47)。テストの `BLOB_COUNT===47` はこれを固定する。万一実際の `seen.size` が47と異なった場合は、`BLOB_COUNT` を `CANONICAL.size` から導出する形にし(`export const BLOB_COUNT = CANONICAL.size;`、ただしCANONICALを先に定義)、テスト期待値も実値に合わせること(値域と決定論のテストが本質)。

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/render/tileset/autotile.test.ts`
Expected: PASS(5件)。BLOB_COUNTが48でなければ上の注に従い実際の値へ両者を揃える

- [ ] **Step 5: コミット**

```bash
git add src/render/tileset/autotile.ts src/render/tileset/autotile.test.ts
git commit -m "feat: オートタイル(近傍ビットマスク→ブロブID)"
```

---

### Task 2: 生成タイルアトラスと索引

**Files:**
- Create: `src/render/tileset/atlas.ts`
- Create: `src/render/tileset/generate.ts`

DOM/Canvas依存のためユニットテストなし。検証は型チェック+Task 4のスクリーンショット。

- [ ] **Step 1: atlas.ts(索引と差し替え口)を作成**

`src/render/tileset/atlas.ts`:

```ts
import { BLOB_COUNT } from './autotile';

/** 1タイルのピクセル寸法(焼き込み解像度)。SMは16px由来だが密度のため32pxで焼く */
export const TILE_PX = 32;

/**
 * タイルアトラス。48ブロブ形状を横一列に並べたCanvas。
 * blobId を渡すと該当タイルの矩形(sx,sy,sw,sh)を返す。
 * source は生成Canvasでも、後からloadImageAtlasで差し替えたHTMLImageElementでもよい。
 */
export interface Atlas {
  source: CanvasImageSource;
  rect(blobId: number): { sx: number; sy: number; sw: number; sh: number };
}

/** 横一列(48×1)配置のアトラス索引を作る */
export function rowAtlas(source: CanvasImageSource): Atlas {
  return {
    source,
    rect(id: number) {
      const i = Math.max(0, Math.min(BLOB_COUNT - 1, id));
      return { sx: i * TILE_PX, sy: 0, sw: TILE_PX, sh: TILE_PX };
    },
  };
}
```

- [ ] **Step 2: generate.ts(コード生成タイル)を作成**

`src/render/tileset/generate.ts`:

```ts
import { BLOB_COUNT, type Neighbors } from './autotile';
import { rowAtlas, TILE_PX, type Atlas } from './atlas';

/** バイオームが与えるタイル塗り分け色(暗→明の3段+縁のハイライト) */
export interface TilePalette {
  fillDark: string;
  fillMid: string;
  fillLight: string;
  edge: string;      // 空気に面した縁のハイライト
  line: string;      // パネル線・内部ディテール
}

/**
 * 各ブロブ形状を TILE_PX 角で描いて横一列アトラスに焼く。
 * 形状ごとに「どの辺が空気に面するか」を復元し、その辺にベベル(明→暗)と
 * 縁ハイライトを入れることでSMのブロック感を出す。パネル線・リベットも足す。
 */
export function generateAtlas(pal: TilePalette): Atlas {
  const canvas = document.createElement('canvas');
  canvas.width = TILE_PX * BLOB_COUNT;
  canvas.height = TILE_PX;
  const ctx = canvas.getContext('2d')!;

  for (let id = 0; id < BLOB_COUNT; id++) {
    const ox = id * TILE_PX;
    const edges = edgesForBlob(id); // このブロブが「空気に面する辺」集合(近似復元)
    drawTile(ctx, ox, TILE_PX, pal, edges);
  }
  return rowAtlas(canvas);
}

interface Edges { top: boolean; right: boolean; bottom: boolean; left: boolean }

/**
 * blobId から代表的な近傍を逆引きし、空気に面する辺を復元する。
 * autotileと同じ正規化を使い、最初に一致する近傍パターンの辺情報を採用する
 * (辺の見た目は辺bitのみで決まるので、この復元で十分)。
 */
function edgesForBlob(id: number): Edges {
  for (let m = 0; m < 16; m++) {
    const n = !!(m & 1), e = !!(m & 2), s = !!(m & 4), w = !!(m & 8);
    const nb: Neighbors = { n, e, s, w, ne: n && e, se: s && e, sw: s && w, nw: n && w };
    // 遅延import回避のため blobId を動的参照せず、辺bitから同じ正規化を再現
    if (canonicalIndex(nb) === id) {
      return { top: !n, right: !e, bottom: !s, left: !w };
    }
  }
  // 角のみ異なるブロブは辺が全接続(内部)。空気に面する辺なし
  return { top: false, right: false, bottom: false, left: false };
}

/** autotile.ts の CANONICAL と同じ写像を再現(循環import回避のためローカルに再実装) */
function canonicalIndex(nb: Neighbors): number {
  const ne = nb.n && nb.e && nb.ne;
  const se = nb.s && nb.e && nb.se;
  const sw = nb.s && nb.w && nb.sw;
  const nw = nb.n && nb.w && nb.nw;
  const canon =
    (nb.n ? 1 : 0) | (nb.e ? 2 : 0) | (nb.s ? 4 : 0) | (nb.w ? 8 : 0) |
    (ne ? 16 : 0) | (se ? 32 : 0) | (sw ? 64 : 0) | (nw ? 128 : 0);
  return CANON_LOCAL.get(canon)!;
}
const CANON_LOCAL: Map<number, number> = (() => {
  const seen = new Set<number>();
  for (let m = 0; m < 256; m++) {
    const n = !!(m & 1), e = !!(m & 2), s = !!(m & 4), w = !!(m & 8);
    const ne = n && e && !!(m & 16), se = s && e && !!(m & 32), sw = s && w && !!(m & 64), nw = n && w && !!(m & 128);
    seen.add((n?1:0)|(e?2:0)|(s?4:0)|(w?8:0)|(ne?16:0)|(se?32:0)|(sw?64:0)|(nw?128:0));
  }
  const map = new Map<number, number>();
  [...seen].sort((a, b) => a - b).forEach((c, i) => map.set(c, i));
  return map;
})();

function drawTile(ctx: CanvasRenderingContext2D, ox: number, px: number, pal: TilePalette, e: Edges): void {
  // ベース塗り(中間色)
  ctx.fillStyle = pal.fillMid;
  ctx.fillRect(ox, 0, px, px);

  // 内部の微妙な陰影(上明るく下暗く)
  const g = ctx.createLinearGradient(ox, 0, ox, px);
  g.addColorStop(0, pal.fillLight);
  g.addColorStop(0.5, pal.fillMid);
  g.addColorStop(1, pal.fillDark);
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = g;
  ctx.fillRect(ox, 0, px, px);
  ctx.globalAlpha = 1;

  // パネル線(内部の十字より薄いディテール)
  ctx.strokeStyle = pal.line;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.4;
  ctx.strokeRect(ox + 4.5, 4.5, px - 9, px - 9);
  ctx.globalAlpha = 1;

  // 空気に面した辺: 縁ハイライト(外側)+内側にベベルの影
  const bevel = Math.max(3, px / 8);
  ctx.lineWidth = 2;
  ctx.strokeStyle = pal.edge;
  const drawEdge = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.beginPath();
    ctx.moveTo(ox + x1, y1);
    ctx.lineTo(ox + x2, y2);
    ctx.stroke();
  };
  ctx.fillStyle = pal.fillDark;
  if (e.top) { drawEdge(0, 1, px, 1); ctx.fillRect(ox, 1, px, bevel * 0.4); }
  if (e.bottom) { drawEdge(0, px - 1, px, px - 1); ctx.fillRect(ox, px - bevel * 0.4 - 1, px, bevel * 0.4); }
  if (e.left) { drawEdge(1, 0, 1, px); ctx.fillRect(ox, 0, bevel * 0.4, px); }
  if (e.right) { drawEdge(px - 1, 0, px - 1, px); ctx.fillRect(ox + px - bevel * 0.4, 0, bevel * 0.4, px); }

  // 角のリベット(空気に面した辺が交わる外角に小さな点)
  ctx.fillStyle = pal.edge;
  const rivet = (cx: number, cy: number) => { ctx.beginPath(); ctx.arc(ox + cx, cy, 1.3, 0, Math.PI * 2); ctx.fill(); };
  if (e.top && e.left) rivet(4, 4);
  if (e.top && e.right) rivet(px - 4, 4);
  if (e.bottom && e.left) rivet(4, px - 4);
  if (e.bottom && e.right) rivet(px - 4, px - 4);
}
```

- [ ] **Step 3: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 4: コミット**

```bash
git add src/render/tileset/atlas.ts src/render/tileset/generate.ts
git commit -m "feat: 生成タイルアトラスと索引(差し替え口つき)"
```

---

### Task 3: chunkbake をオートタイル描画へ改修

**Files:**
- Modify: `src/render/chunkbake.ts`
- Modify: `src/render/renderer.ts`(Atlas を Renderer が生成して baker に渡す)

段階1の要。既存のSOLID平板塗りを、autotile+アトラスのdrawImageに置換。装飾(梯子・配管等のdecor)は当面そのまま重ねる(色は後続タスクでバイオーム化)。この段階では暫定パレット1つで動かす。

- [ ] **Step 1: chunkbake.ts を改修**

現在の `ChunkBaker.bake()` の「SOLIDタイルを階層色で塗る」ループを、次の方針で置換する:
- コンストラクタで `Atlas` を受け取り保持(`constructor(private seed: number, private atlas: Atlas)`)
- SOLIDタイルごとに、周囲8近傍を `store.tileAt` で調べ `blobId` を計算し、`atlas.rect(id)` の矩形を `ctx.drawImage(atlas.source, sx,sy,sw,sh, tx*BAKE_PPT, ty*BAKE_PPT, BAKE_PPT+1, BAKE_PPT+1)` で貼る
- 近傍の「同種」判定は SOLID のみ(LADDER/AIRは非SOLID)。チャンク境界をまたぐ近傍参照は `store.tileAt`(純粋・シームレス)を使うので継ぎ目は出ない
- 既存の装飾描画(decorateChunk のループ)は**梯子と配管・ケーブル・瓦礫アクセントのみ残す**。ハッチング/エッジ/継ぎ目/リベットはタイルアトラス側に移ったので、decorのそれらは二重になる — **ハッチ・エッジ・継ぎ目・リベットの描画をスキップ**し、`kind==='hatch'` と、`color` が `PALETTE.edgeTop/edgeSide/seam/rivet` のopは描かない(梯子rail/rung/hoop、pipe/cable/debris/grill系は残す)。フィルタは chunkbake 側の draw 呼び出し前に行う
- `BAKE_PPT` は既存値を維持

- [ ] **Step 2: renderer.ts を改修**

- import: `import { generateAtlas } from './tileset/generate';`
- コンストラクタで暫定パレットからアトラスを生成し baker へ渡す:

```ts
    const atlas = generateAtlas({
      fillDark: '#1a2026', fillMid: '#2b343d', fillLight: '#3d4a55',
      edge: '#5b6b78', line: '#12171b',
    });
    this.baker = new ChunkBaker(seed, atlas);
```

- [ ] **Step 3: 検証**

Run: `npm test && npx tsc --noEmit`
Expected: 全既存テストPASS(50 + autotile 5 = 55)、型エラーなし

Run: `node scripts/screenshot.mjs --out=screenshots/t3-a.png --pos=100,-600` と `--out=screenshots/t3-b.png --seed=42 --pos=50,-300`
PNGをReadで開き確認: SOLIDの塊が**辺・角の付いたブロックタイル**で描かれ、塊の輪郭に縁ハイライトとベベルが出ている。平板な単色塗りではない。梯子・配管は残っている。チャンク境界(64タイル)で継ぎ目が出ていない。ハッチ等の二重描画が起きていない。**貧相に見えるなら縁・ベベル・パネル線の強さを generate.ts で調整**(この段階はまだ暗い/単色だが、"ブロックとして立体的か"を確認)

- [ ] **Step 4: コミット**

```bash
git add src/render/chunkbake.ts src/render/renderer.ts
git commit -m "feat: chunkbakeをオートタイル描画へ(段階1: ブロック化)"
```

---

### Task 4: バイオーム定義と選択(純粋ロジック)

**Files:**
- Create: `src/render/biome.ts`
- Test: `src/render/biome.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/render/biome.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BIOMES, biomeAt, biomeBlend } from './biome';

describe('biomeAt', () => {
  it('地表(y=0)は最初のバイオーム、深いほど進む(yは上が負)', () => {
    expect(biomeAt(0)).toBe(BIOMES[0]);
    expect(biomeAt(-600)).toBe(BIOMES[1]); // 高度500超で次
  });

  it('末尾以降はループ(strataと同じ)', () => {
    expect(biomeAt(-500 * BIOMES.length)).toBe(BIOMES[0]);
  });

  it('各バイオームのパラメータが妥当な範囲', () => {
    for (const b of BIOMES) {
      expect(b.ambientLevel).toBeGreaterThan(0);
      expect(b.ambientLevel).toBeLessThanOrEqual(1);
      expect(b.palette.fillMid).toMatch(/^#[0-9a-f]{6}$/i);
      expect(b.bgLayers.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('biomeBlend', () => {
  it('係数tは0..1で単調、境界をまたいで補間する', () => {
    const mid = biomeBlend(-500); // ちょうど境界
    expect(mid.t).toBeGreaterThanOrEqual(0);
    expect(mid.t).toBeLessThanOrEqual(1);
    expect([mid.from, mid.to]).toContain(BIOMES[0]);
  });

  it('境界の外(帯の中央)はtが0または1に張り付く(クランプ)', () => {
    // 遷移帯を外れた高度では単一バイオーム(t=0)
    const deep = biomeBlend(-250); // 帯の中央付近
    expect(deep.t === 0 || deep.t === 1).toBe(true);
  });

  it('補間した環境光レベルは両端の間に入る', () => {
    const b = biomeBlend(-480); // 境界手前の遷移帯
    const lo = Math.min(b.from.ambientLevel, b.to.ambientLevel);
    const hi = Math.max(b.from.ambientLevel, b.to.ambientLevel);
    expect(b.ambientLevel).toBeGreaterThanOrEqual(lo - 1e-9);
    expect(b.ambientLevel).toBeLessThanOrEqual(hi + 1e-9);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/render/biome.test.ts`
Expected: FAIL(モジュール未作成)

- [ ] **Step 3: 実装**

`src/render/biome.ts`:

```ts
import type { TilePalette } from './tileset/generate';
import { STRATUM_HEIGHT } from '../world/strata';

/** パララックス背景1層の定義 */
export interface BgLayer {
  factor: number;   // カメラ追従率(小さいほど遠い)
  color: string;
  density: number;  // 構造の出現確率
  kind: 'tower' | 'deck' | 'haze';
}

/** バイオーム: 階層帯の見た目一式 */
export interface Biome {
  name: string;
  ambientColor: string;   // 環境光の色
  ambientLevel: number;   // 0..1 基準の明るさ
  palette: TilePalette;   // タイルアトラスの塗り
  accent: string;         // 梯子・配管などアクセント色
  bgLayers: BgLayer[];
}

export const BIOMES: readonly Biome[] = [
  {
    name: '最下層', ambientColor: '#2e3a44', ambientLevel: 0.34,
    palette: { fillDark: '#141b1f', fillMid: '#26333a', fillLight: '#3a4a52', edge: '#5f7681', line: '#0f1418' },
    accent: '#6f8794',
    bgLayers: [
      { factor: 0.2, color: '#1b2830', density: 0.5, kind: 'tower' },
      { factor: 0.4, color: '#24343d', density: 0.4, kind: 'deck' },
    ],
  },
  {
    name: '居住区跡', ambientColor: '#2c4a4a', ambientLevel: 0.5,
    palette: { fillDark: '#17272a', fillMid: '#2c4747', fillLight: '#436a63', edge: '#7fc0ac', line: '#101f1f' },
    accent: '#9fd8c2',
    bgLayers: [
      { factor: 0.18, color: '#1c3232', density: 0.55, kind: 'tower' },
      { factor: 0.35, color: '#274444', density: 0.5, kind: 'deck' },
      { factor: 0.5, color: '#2f5050', density: 0.3, kind: 'haze' },
    ],
  },
  {
    name: '廃棄物層', ambientColor: '#4a3826', ambientLevel: 0.36,
    palette: { fillDark: '#221812', fillMid: '#3d2c1e', fillLight: '#5c432c', edge: '#b07a45', line: '#160f0a' },
    accent: '#c98f52',
    bgLayers: [
      { factor: 0.2, color: '#2a1f16', density: 0.5, kind: 'tower' },
      { factor: 0.4, color: '#3a2b1d', density: 0.45, kind: 'deck' },
    ],
  },
  {
    name: '大空洞帯', ambientColor: '#2f3f5c', ambientLevel: 0.72,
    palette: { fillDark: '#1a2334', fillMid: '#2f4160', fillLight: '#4a648f', edge: '#8fb4e6', line: '#121a28' },
    accent: '#a9c6ee',
    bgLayers: [
      { factor: 0.12, color: '#233350', density: 0.7, kind: 'tower' },
      { factor: 0.3, color: '#2c4066', density: 0.5, kind: 'deck' },
      { factor: 0.55, color: '#3a588a', density: 0.35, kind: 'haze' },
    ],
  },
  {
    name: '上層', ambientColor: '#3a3a55', ambientLevel: 0.6,
    palette: { fillDark: '#1e1e2c', fillMid: '#34344c', fillLight: '#50506f', edge: '#b6b6e0', line: '#14141e' },
    accent: '#c9a0ff',
    bgLayers: [
      { factor: 0.16, color: '#26263a', density: 0.55, kind: 'tower' },
      { factor: 0.36, color: '#31314a', density: 0.45, kind: 'deck' },
    ],
  },
];

const TRANSITION = 60; // 遷移帯の幅(タイル)

function indexAt(worldY: number): number {
  const altitude = Math.max(0, -worldY);
  return Math.floor(altitude / STRATUM_HEIGHT);
}

/** ワールドy → バイオーム(末尾ループ) */
export function biomeAt(worldY: number): Biome {
  return BIOMES[indexAt(worldY) % BIOMES.length];
}

/** バイオーム遷移の補間結果 */
export interface BiomeBlend {
  from: Biome;
  to: Biome;
  t: number;            // 0=from, 1=to
  ambientLevel: number; // 補間済み
  ambientColor: string; // 補間済み(簡易: t<0.5でfrom, それ以外to だが数値混合)
}

/**
 * 境界の下側 TRANSITION タイルで from→to を線形補間。
 * 帯の外では t=0(単一バイオーム)。
 */
export function biomeBlend(worldY: number): BiomeBlend {
  const altitude = Math.max(0, -worldY);
  const idx = Math.floor(altitude / STRATUM_HEIGHT);
  const into = altitude - idx * STRATUM_HEIGHT; // 現バイオームに入ってからの深さ
  const from = BIOMES[idx % BIOMES.length];
  // 次の境界(altitude = (idx+1)*STRATUM_HEIGHT)の手前 TRANSITION で次へ補間
  const distToNext = STRATUM_HEIGHT - into;
  let t = 0;
  let to = from;
  if (distToNext < TRANSITION) {
    to = BIOMES[(idx + 1) % BIOMES.length];
    t = (TRANSITION - distToNext) / TRANSITION; // 0→1
  }
  const ambientLevel = from.ambientLevel + (to.ambientLevel - from.ambientLevel) * t;
  const ambientColor = mixHex(from.ambientColor, to.ambientColor, t);
  return { from, to, t, ambientLevel, ambientColor };
}

/** #rrggbb を線形混合 */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
  const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/render/biome.test.ts`
Expected: PASS(7件)

- [ ] **Step 5: コミット**

```bash
git add src/render/biome.ts src/render/biome.test.ts
git commit -m "feat: バイオーム定義と遷移補間"
```

---

### Task 5: バイオーム環境光へ転換(明るい世界)

**Files:**
- Modify: `src/render/lighting.ts`
- Modify: `src/render/renderer.ts`

段階2の要。「闇を敷いて光で切り抜く」をやめ、「バイオーム色のうっすらした環境光で全体を見せ、プレイヤー周囲を補助光で持ち上げる」に変える。

- [ ] **Step 1: lighting.ts を書き換え**

新しい責務: メイン画面の上に「バイオーム環境光」を乗算/スクリーン合成し、プレイヤー補助光で局所的に明るくする。闇(0.965の黒)を廃止。

`src/render/lighting.ts`(全置換):

```ts
/**
 * バイオーム環境光+プレイヤー補助光。
 * 闇を切り抜く旧方式を廃止し、全体が見える明るい画面にする。
 */
export class Lighting {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private outW = 0;
  private outH = 0;

  resize(w: number, h: number): void {
    this.outW = w;
    this.outH = h;
    this.canvas.width = Math.ceil(w / 2);
    this.canvas.height = Math.ceil(h / 2);
  }

  /**
   * ambientColor/ambientLevel: バイオームの環境光。
   * px,py: プレイヤー画面座標、angle: 補助光の向き、ppt: 1タイルpx、timeSec: 揺らぎ用。
   * 合成方針:
   *  1) 画面全体に「1-ambientLevel」ぶんの暗さ(バイオーム色寄りの暗色)を乗せる(軽い減光)
   *  2) プレイヤー周囲と前方に加算光(明るい круг+扇)を足す
   */
  render(
    mainCtx: CanvasRenderingContext2D,
    px: number, py: number, angle: number, ppt: number, timeSec: number,
    ambientColor: string, ambientLevel: number,
  ): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const ctx = this.ctx;
    const hx = px / 2, hy = py / 2, hp = ppt / 2;

    // 1) 環境減光: 全体をバイオーム色の暗幕で軽く覆う(ambientLevelが高いほど薄い)
    const dark = Math.max(0, 0.82 - ambientLevel * 0.82); // level=1→0, level=0.34→~0.54
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = withAlpha(darken(ambientColor, 0.35), dark);
    ctx.fillRect(0, 0, w, h);

    // 2) 補助光: destination-out で暗幕を局所的に消す(=明るくする)
    ctx.globalCompositeOperation = 'destination-out';
    const flicker = 1 + 0.02 * Math.sin(timeSec * 6.3) + 0.012 * Math.sin(timeSec * 17.1);
    const ambientR = 8 * hp;
    const amb = ctx.createRadialGradient(hx, hy, 0, hx, hy, ambientR);
    amb.addColorStop(0, 'rgba(0,0,0,0.9)');
    amb.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = amb;
    ctx.beginPath(); ctx.arc(hx, hy, ambientR, 0, Math.PI * 2); ctx.fill();

    const coneR = 20 * hp * flicker;
    const half = 0.34;
    const cone = ctx.createRadialGradient(hx, hy, 0, hx, hy, coneR);
    cone.addColorStop(0, 'rgba(0,0,0,0.85)');
    cone.addColorStop(0.7, 'rgba(0,0,0,0.4)');
    cone.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cone;
    ctx.beginPath(); ctx.moveTo(hx, hy);
    ctx.arc(hx, hy, coneR, angle - half, angle + half); ctx.closePath(); ctx.fill();

    ctx.globalCompositeOperation = 'source-over';
    mainCtx.drawImage(this.canvas, 0, 0, this.outW, this.outH);
  }
}

function darken(hex: string, f: number): string {
  const p = parseInt(hex.slice(1), 16);
  const r = Math.round(((p >> 16) & 255) * f);
  const g = Math.round(((p >> 8) & 255) * f);
  const b = Math.round((p & 255) * f);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
function withAlpha(hex: string, a: number): string {
  const p = parseInt(hex.slice(1), 16);
  return `rgba(${(p >> 16) & 255},${(p >> 8) & 255},${p & 255},${a})`;
}
```

- [ ] **Step 2: renderer.ts を改修**

- `biomeBlend` を import
- render() で現在のプレイヤー高度から `const bb = biomeBlend(player.body.y);` を取得
- `this.lighting.render(ctx, px, py, angle, ppt, timeSec, bb.ambientColor, bb.ambientLevel);` に変更

- [ ] **Step 3: 検証**

Run: `npm test && npx tsc --noEmit`
Expected: 全PASS

Run: `node scripts/screenshot.mjs --out=screenshots/t5-a.png --pos=100,-600` と `--out=screenshots/t5-b.png --pos=100,-1600`
PNGを開き確認: **画面全体が見える明るさ**になっている(真っ暗ではない)。プレイヤー周囲はさらに明るい。バイオーム色がうっすら乗っている。大空洞帯(t5-b)は最下層系より明るい。ブロックタイルの立体感が見える

- [ ] **Step 4: コミット**

```bash
git add src/render/lighting.ts src/render/renderer.ts
git commit -m "feat: バイオーム環境光へ転換(段階2: 明るい世界)"
```

---

### Task 6: バイオーム配色の全面適用と多層パララックス

**Files:**
- Modify: `src/render/renderer.ts`
- Modify: `src/render/chunkbake.ts`(アトラスをバイオームごとに持つ)
- Modify: `src/render/background.ts`(全置換: バイオーム別多層)

段階3の要。タイルアトラスをバイオームパレットで焼き分け、背景をバイオーム別の多層パララックスにする。

- [ ] **Step 1: chunkbake をバイオーム別アトラスに**

- `ChunkBaker` を、コンストラクタで単一Atlasを受け取る代わりに「バイオームindex→Atlas」のキャッシュを持つよう改修。各チャンクの中心高度から `biomeAt` でバイオームを引き、対応アトラス(なければ `generateAtlas(biome.palette)` で生成しキャッシュ)でタイルを貼る
- 装飾アクセント色は、暫定の PALETTE ではなくそのチャンクのバイオーム `accent` を使う(梯子・配管・ケーブル・瓦礫)。decor.ts は色を返すのでbake側で上書きする方針: bake時に accent 系の色を biome.accent に置換して描く(edge/hatch/seam/rivetは既にスキップ済み)

- [ ] **Step 2: background.ts を全置換**

バイオーム別の多層パララックス。`render(ctx, camX, camY, w, h, ppt, biomeBlend)` を受け、`biomeBlend.from`/`to` の `bgLayers` を t で混ぜて描く。各層は kind に応じ tower(縦帯)/deck(横帯)/haze(色グラデの霞)を hash2 で決定論的に配置し、`factor` で視差。色は層色、alphaは 0.18〜0.4 程度でバイオーム明度に応じて調整。

`renderer.ts`: 背景描画を `this.background.render(ctx, cam.x, cam.y, w, h, ppt, bb);` に変更(bg fillの後、チャンクの前)。

- [ ] **Step 3: 検証**

Run: `npm test && npx tsc --noEmit`
Expected: 全PASS

Run: 各バイオームを撮る:
```
node scripts/screenshot.mjs --out=screenshots/t6-teika.png --pos=100,-100
node scripts/screenshot.mjs --out=screenshots/t6-kyoju.png --pos=100,-600
node scripts/screenshot.mjs --out=screenshots/t6-haiki.png --pos=100,-1100
node scripts/screenshot.mjs --out=screenshots/t6-kudo.png --pos=100,-1600
node scripts/screenshot.mjs --out=screenshots/t6-jou.png --pos=100,-2100
```
全PNGを開き確認: バイオームごとに**色・明度・背景がはっきり違う**(青緑の居住区、琥珀の廃棄物、明るい藍の大空洞…)。タイルもその色。背景に多層の構造が見える。境界高度(例 -500 付近)を撮って遷移が滑らかかも確認(`--pos=100,-490` と `--pos=100,-510`)

- [ ] **Step 4: コミット**

```bash
git add src/render/renderer.ts src/render/chunkbake.ts src/render/background.ts
git commit -m "feat: バイオーム配色の全面適用と多層パララックス(段階3)"
```

---

### Task 7: プレイヤー色付き・ポスト調整・実素材差し替え口・総合チューニング

**Files:**
- Modify: `src/render/playerSprite.ts`
- Modify: `src/render/post.ts`
- Modify: `src/render/renderer.ts`
- Create: `src/render/tileset/loadImage.ts`(実PNG差し替え口)

段階4(仕上げ)。

- [ ] **Step 1: プレイヤーを色付き+リムライトに**

`playerSprite.ts` の `drawPlayer` に `ambientColor: string` 引数を追加。コート本体をバイオーム環境光で軽く色付けし、光源側(aimAngle側)の輪郭に明るいリムライト線を入れる。既存の頭・コート・腕・向き反転・歩行ボブは維持。renderer から `bb.ambientColor` を渡す。

- [ ] **Step 2: ポストをバイオーム明度連動に**

`post.ts` の `render` に `ambientLevel: number` を追加。グレインalphaを現状の半分程度に、ビネットの濃さを `(1 - ambientLevel)` に比例させる(明るい大空洞ではほぼ無し)。renderer から渡す。

- [ ] **Step 3: 実PNGアトラス差し替え口**

`src/render/tileset/loadImage.ts`:

```ts
import { rowAtlas, type Atlas } from './atlas';

/**
 * 48ブロブが横一列(各TILE_PX角)に並んだPNGを読み、Atlasを返す。
 * 失敗時は null を返す(呼び出し側が生成アトラスにフォールバック)。
 * public/tiles/<name>.png を想定。
 */
export async function loadImageAtlas(url: string): Promise<Atlas | null> {
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return rowAtlas(img);
  } catch {
    console.warn(`タイルアトラス読込失敗、生成タイルにフォールバック: ${url}`);
    return null;
  }
}
```

この段階では**実PNGの取得は必須にしない**。`loadImageAtlas` を用意し、renderer は「実PNGがあれば使い、無ければ generateAtlas」の分岐だけ入れる(URLは存在しなくてよい=常にフォールバック)。実際の素材導入は任意の後続作業とし、パイプラインが差し替え可能であることをコードで示すに留める。

Kenney等のCC0 PNGを実際に入れたい場合の手順を `docs/superpowers/notes/tileset-swap.md` に短く記す(URL、必要な並べ替え=48ブロブ横一列/TILE_PX、public/tiles/ に置く)。

- [ ] **Step 4: 総合チューニングと全バイオーム確認**

```
node scripts/screenshot.mjs --out=screenshots/final-teika.png --pos=100,-100
node scripts/screenshot.mjs --out=screenshots/final-kyoju.png --pos=100,-600
node scripts/screenshot.mjs --out=screenshots/final-haiki.png --pos=100,-1100
node scripts/screenshot.mjs --out=screenshots/final-kudo.png --pos=100,-1600
node scripts/screenshot.mjs --out=screenshots/final-jou.png --pos=100,-2100
node scripts/screenshot.mjs --seed=42 --out=screenshots/final-seed42.png --pos=50,-300
```
全PNGを目視し、「Super Metroidのように明るく・色付きで・立体的なブロック・多層背景・読みやすい」を満たすか評価。足りなければ generate.ts(タイルの陰影・パネル)、biome.ts(色・明度)、lighting.ts(補助光の強さ)、background.ts(層の量)を調整(調整→撮影→確認を最大3周)。

- [ ] **Step 5: 全テスト+ビルド+コミット**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: 全PASS、ビルド成功

```bash
git add -A
git commit -m "feat: プレイヤー色付き・ポスト連動・実素材差し替え口・総合チューニング(段階4)"
```

---

## この計画のスコープ外
- ゲームプレイ変更(worldgen/physics/操作)
- 段階3-4のゲーム内容(セーフガード・重力子砲・物語・セーブ)
- 敵・アイテムのスプライト
- 音
- 実CC0素材の実導入(差し替え口のみ用意。導入は任意の後続作業)
