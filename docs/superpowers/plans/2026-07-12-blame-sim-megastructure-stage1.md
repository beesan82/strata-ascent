# 超構造体・段階1「階層の骨格」実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ワールド座標 (x,y) を region→sector→district→room の階層セルへ決定論的・チャンク局所に解決する純粋モジュールを作り、デバッグ可視化で階層グリッドが実際に機能していることを目視確認する。地形の見た目・当たり判定はまだ変えない(段階2以降)。

**Architecture:** `src/world/hierarchy.ts`(純粋関数+セル単位メモ化)が各階層のセル座標とハッシュ由来のプロパティ(地域の系統、セクターのハブ、地区の施設タイプ、部屋の有無/型/多様性シード)を返す。既存 `tileAt` は無改修。`src/render/debugHierarchy.ts` が `?debug=hierarchy` の時だけ階層を色で描いて検証を可能にする。

**Tech Stack:** 既存(Vite/TS/Canvas2D/Vitest/Playwright)。ランタイム依存は増やさない。

**参照スペック:** `docs/superpowers/specs/2026-07-12-blame-sim-megastructure-worldgen-design.md`

**全タスク共通の約束:**
- `hierarchy.ts` は純粋・決定論。乱数は既存 `src/world/noise.ts` の `hash2(seed,x,y)→[0,1)` のみ(`Math.random`/`Date` 禁止)
- gameplay(`tileAt` の出力、physics、既存テスト65〜66件)は段階1では変えない。回帰なし維持
- スクリーンショット: `node scripts/screenshot.mjs --out=screenshots/NAME.png [--pos=x,y] [--seed=N]`。exit 0 と [pageerror] 無しを確認。デバッグ表示は後述の通り `?debug=hierarchy` を付けて撮る(screenshot.mjs に debug 透過は Task 3 で対応)
- 座標規約: ワールドy下向き正。チャンク=64タイル

**階層グリッドのサイズ(2の冪、チャンク=64と整合):**
- ROOM_SIZE = 128(2チャンク)
- DISTRICT_SIZE = 1024(16チャンク、8×8=64部屋)
- SECTOR_SIZE = 16384(256チャンク、16×16地区)
- REGION_SIZE = 262144(4096チャンク、16×16セクター)

---

### Task 1: セル座標とハッシュ基盤+地域(region)解決

**Files:**
- Create: `src/world/hierarchy.ts`
- Test: `src/world/hierarchy.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/world/hierarchy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  REGION_SIZE, SECTOR_SIZE, DISTRICT_SIZE, ROOM_SIZE,
  cellOf, cellHash, weighted,
  regionAt, SYSTEMS,
} from './hierarchy';

describe('サイズ定数', () => {
  it('2の冪で入れ子が整合(各上位は下位の整数倍)', () => {
    expect(REGION_SIZE % SECTOR_SIZE).toBe(0);
    expect(SECTOR_SIZE % DISTRICT_SIZE).toBe(0);
    expect(DISTRICT_SIZE % ROOM_SIZE).toBe(0);
    expect(ROOM_SIZE % 64).toBe(0); // チャンク境界と揃う
  });
});

describe('cellOf', () => {
  it('負座標でも正しく床方向へ丸める', () => {
    expect(cellOf(0, 100)).toBe(0);
    expect(cellOf(99, 100)).toBe(0);
    expect(cellOf(100, 100)).toBe(1);
    expect(cellOf(-1, 100)).toBe(-1);
    expect(cellOf(-100, 100)).toBe(-1);
    expect(cellOf(-101, 100)).toBe(-2);
  });
});

describe('cellHash', () => {
  it('決定論: 同じ入力なら同じ値、値域[0,1)', () => {
    expect(cellHash(42, 3, -2, 7)).toBe(cellHash(42, 3, -2, 7));
    for (let i = 0; i < 200; i++) {
      const v = cellHash(42, i, -i, 1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('salt が違えば別系列', () => {
    let diff = 0;
    for (let i = 0; i < 100; i++) if (cellHash(1, i, i, 1) !== cellHash(1, i, i, 2)) diff++;
    expect(diff).toBeGreaterThan(90);
  });
});

describe('weighted', () => {
  it('重み付き抽選が決定論で、全項目が範囲内', () => {
    const table = [{ v: 'a', w: 1 }, { v: 'b', w: 3 }, { v: 'c', w: 1 }];
    for (let r = 0; r < 1; r += 0.01) {
      const picked = weighted(table, r);
      expect(['a', 'b', 'c']).toContain(picked);
    }
    // r=0 は先頭、r→1 は末尾
    expect(weighted(table, 0)).toBe('a');
    expect(weighted(table, 0.999)).toBe('c');
  });
});

describe('regionAt', () => {
  it('決定論: 同じ座標なら同じ地域', () => {
    expect(regionAt(42, 5000, -3000)).toEqual(regionAt(42, 5000, -3000));
  });
  it('セル内のどの点から引いても同一(チャンク局所/セル一貫性)', () => {
    const base = regionAt(42, 0, 0);
    for (const [x, y] of [[1, 1], [REGION_SIZE - 1, REGION_SIZE - 1], [12345, 250000]] as const) {
      expect(regionAt(42, x, y)).toEqual(base); // すべて region (0,0) 内
    }
    // 隣の region は別セル座標
    expect(regionAt(42, REGION_SIZE, 0).rx).toBe(1);
  });
  it('system は SYSTEMS のいずれか', () => {
    for (let i = 0; i < 50; i++) {
      const r = regionAt(42, i * REGION_SIZE, -i * REGION_SIZE);
      expect(SYSTEMS).toContain(r.system);
    }
  });
  it('広域で複数の system が出現する(単調でない)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add(regionAt(42, i * REGION_SIZE, 0).system);
    expect(seen.size).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/world/hierarchy.test.ts`
Expected: FAIL(モジュール未作成)

- [ ] **Step 3: 実装**

`src/world/hierarchy.ts`:

```ts
import { hash2 } from './noise';

export const ROOM_SIZE = 128;
export const DISTRICT_SIZE = 1024;
export const SECTOR_SIZE = 16384;
export const REGION_SIZE = 262144;

/** 支配系統 */
export const SYSTEMS = ['water', 'power', 'habitation', 'disposal', 'foundry'] as const;
export type System = (typeof SYSTEMS)[number];

/** 座標をセルサイズで床方向に割る(負座標対応) */
export function cellOf(coord: number, size: number): number {
  return Math.floor(coord / size);
}

/** セル座標+salt → [0,1) 決定論ハッシュ。level ごとに salt を変えて系列を分ける */
export function cellHash(seed: number, cx: number, cy: number, salt: number): number {
  return hash2(seed + salt * 1000, cx, cy);
}

/** 重み付き抽選。r∈[0,1)。決定論。 */
export function weighted<T>(table: { v: T; w: number }[], r: number): T {
  const total = table.reduce((s, e) => s + e.w, 0);
  let acc = 0;
  const target = r * total;
  for (const e of table) {
    acc += e.w;
    if (target < acc) return e.v;
  }
  return table[table.length - 1].v;
}

/** 地域: 支配系統を持つ最上位セル */
export interface Region {
  rx: number;
  ry: number;
  system: System;
}

const SYSTEM_TABLE = SYSTEMS.map((v) => ({ v, w: 1 }));

const regionCache = new Map<string, Region>();

export function regionAt(seed: number, x: number, y: number): Region {
  const rx = cellOf(x, REGION_SIZE);
  const ry = cellOf(y, REGION_SIZE);
  const key = `${seed},${rx},${ry}`;
  let r = regionCache.get(key);
  if (!r) {
    const system = weighted(SYSTEM_TABLE, cellHash(seed, rx, ry, 11));
    r = { rx, ry, system };
    regionCache.set(key, r);
  }
  return r;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/world/hierarchy.test.ts`
Expected: PASS

Run: `npm test`
Expected: 既存も全PASS(回帰なし)

- [ ] **Step 5: コミット**

```bash
git add src/world/hierarchy.ts src/world/hierarchy.test.ts
git commit -m "feat: 階層セルの基盤と地域(region)解決"
```

---

### Task 2: sector/district/room の解決(プロパティ+多様性シード)

**Files:**
- Modify: `src/world/hierarchy.ts`
- Test: `src/world/hierarchy.test.ts`(追記)

各階層は上位の性質を継承しつつ、自セルのハッシュで多様性パラメータを引く。段階1では「所属と主要パラメータ」までを確定し、実際のタイル生成(段階2)への入力を用意する。

- [ ] **Step 1: 失敗するテストを追記**

`src/world/hierarchy.test.ts` に追記:

```ts
import { sectorAt, districtAt, roomAt, FACILITY_BY_SYSTEM } from './hierarchy';

describe('sectorAt', () => {
  it('決定論、セル一貫性、地域の system を継承', () => {
    const s = sectorAt(42, 5000, -3000);
    expect(sectorAt(42, 5000, -3000)).toEqual(s);
    expect(s.system).toBe(regionAt(42, 5000, -3000).system);
    // ハブはセクター内の相対座標 [0,SECTOR_SIZE)
    expect(s.hubX).toBeGreaterThanOrEqual(0);
    expect(s.hubX).toBeLessThan(SECTOR_SIZE);
    expect(s.hubY).toBeGreaterThanOrEqual(0);
    expect(s.hubY).toBeLessThan(SECTOR_SIZE);
  });
});

describe('districtAt', () => {
  it('決定論、facilityType はセクター系統の施設集合のいずれか', () => {
    const d = districtAt(42, 5000, -3000);
    expect(districtAt(42, 5000, -3000)).toEqual(d);
    const sys = regionAt(42, 5000, -3000).system;
    expect(FACILITY_BY_SYSTEM[sys]).toContain(d.facilityType);
    expect(['active', 'ruined', 'sealed']).toContain(d.state);
  });
});

describe('roomAt', () => {
  it('決定論、present は真偽、present時は type と variantSeed と decay を持つ', () => {
    const r = roomAt(42, 5000, -3000);
    expect(roomAt(42, 5000, -3000)).toEqual(r);
    expect(typeof r.present).toBe('boolean');
    if (r.present) {
      expect(typeof r.type).toBe('string');
      expect(r.decay).toBeGreaterThanOrEqual(0);
      expect(r.decay).toBeLessThanOrEqual(1);
    }
  });
  it('広域で present の部屋が一定割合存在する(全部空でも全部埋めでもない)', () => {
    let present = 0;
    const N = 400;
    for (let i = 0; i < N; i++) {
      if (roomAt(42, i * ROOM_SIZE, (i % 7) * ROOM_SIZE).present) present++;
    }
    expect(present).toBeGreaterThan(N * 0.1);
    expect(present).toBeLessThan(N * 0.9);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/world/hierarchy.test.ts`
Expected: FAIL(新規エクスポート未定義)

- [ ] **Step 3: 実装(hierarchy.ts に追記)**

```ts
/** 系統ごとの施設タイプ集合 */
export const FACILITY_BY_SYSTEM: Record<System, string[]> = {
  water: ['pump', 'filter', 'tank'],
  power: ['substation', 'battery', 'control'],
  habitation: ['dwelling', 'corridor', 'hall'],
  disposal: ['compactor', 'silo'],
  foundry: ['smelter', 'caster'],
};

export interface Sector {
  sx: number;
  sy: number;
  system: System;
  hubX: number; // セクター内相対 [0,SECTOR_SIZE)
  hubY: number;
}

const sectorCache = new Map<string, Sector>();

export function sectorAt(seed: number, x: number, y: number): Sector {
  const sx = cellOf(x, SECTOR_SIZE);
  const sy = cellOf(y, SECTOR_SIZE);
  const key = `${seed},${sx},${sy}`;
  let s = sectorCache.get(key);
  if (!s) {
    const system = regionAt(seed, x, y).system;
    const hubX = Math.floor(cellHash(seed, sx, sy, 21) * SECTOR_SIZE);
    const hubY = Math.floor(cellHash(seed, sx, sy, 22) * SECTOR_SIZE);
    s = { sx, sy, system, hubX, hubY };
    sectorCache.set(key, s);
  }
  return s;
}

export interface District {
  dx: number;
  dy: number;
  facilityType: string;
  state: 'active' | 'ruined' | 'sealed';
}

const STATE_TABLE = [
  { v: 'active' as const, w: 5 },
  { v: 'ruined' as const, w: 3 },
  { v: 'sealed' as const, w: 1 },
];

const districtCache = new Map<string, District>();

export function districtAt(seed: number, x: number, y: number): District {
  const dx = cellOf(x, DISTRICT_SIZE);
  const dy = cellOf(y, DISTRICT_SIZE);
  const key = `${seed},${dx},${dy}`;
  let d = districtCache.get(key);
  if (!d) {
    const system = regionAt(seed, x, y).system;
    const facilities = FACILITY_BY_SYSTEM[system];
    const facilityType = facilities[Math.floor(cellHash(seed, dx, dy, 31) * facilities.length)];
    const state = weighted(STATE_TABLE, cellHash(seed, dx, dy, 32));
    d = { dx, dy, facilityType, state };
    districtCache.set(key, d);
  }
  return d;
}

export interface Room {
  rmx: number;
  rmy: number;
  present: boolean;
  type: string;      // present=false のときは '' 
  variantSeed: number;
  decay: number;     // 0..1
}

const roomCache = new Map<string, Room>();

export function roomAt(seed: number, x: number, y: number): Room {
  const rmx = cellOf(x, ROOM_SIZE);
  const rmy = cellOf(y, ROOM_SIZE);
  const key = `${seed},${rmx},${rmy}`;
  let r = roomCache.get(key);
  if (!r) {
    // sealed 地区は部屋が少なめ、ruined は中程度、active は多め
    const d = districtAt(seed, x, y);
    const density = d.state === 'active' ? 0.6 : d.state === 'ruined' ? 0.4 : 0.2;
    const present = cellHash(seed, rmx, rmy, 41) < density;
    const type = present ? d.facilityType : '';
    const variantSeed = Math.floor(cellHash(seed, rmx, rmy, 42) * 0xffffff);
    const decay = present ? clamp01(cellHash(seed, rmx, rmy, 43) + (d.state === 'ruined' ? 0.3 : 0)) : 0;
    r = { rmx, rmy, present, type, variantSeed, decay };
    roomCache.set(key, r);
  }
  return r;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/world/hierarchy.test.ts` → PASS。`npm test` → 全PASS

- [ ] **Step 5: コミット**

```bash
git add src/world/hierarchy.ts src/world/hierarchy.test.ts
git commit -m "feat: sector/district/room の解決と多様性シード"
```

---

### Task 3: 階層デバッグ可視化

**Files:**
- Create: `src/render/debugHierarchy.ts`
- Modify: `src/render/renderer.ts`(debug時のみ呼ぶ)
- Modify: `src/main.ts`(`?debug=hierarchy` を Renderer に伝える)
- Modify: `scripts/screenshot.mjs`(`--debug=` を URL に透過)

デバッグ表示で「階層グリッドが実際に (x,y) を正しく区切り、地域=系統・地区=施設・部屋=有無が色で読める」ことを目視確認する。通常描画には一切影響しない(フラグ時のみ)。

- [ ] **Step 1: debugHierarchy.ts を作成**

`src/render/debugHierarchy.ts`:

```ts
import type { Camera } from '../core/camera';
import {
  regionAt, sectorAt, districtAt, roomAt,
  SECTOR_SIZE, DISTRICT_SIZE, ROOM_SIZE,
} from '../world/hierarchy';

/** 系統ごとの色相 */
const SYSTEM_HUE: Record<string, number> = {
  water: 200, power: 50, habitation: 130, disposal: 20, foundry: 340,
};

/**
 * 階層グリッドを半透明で重ねて可視化する。
 * region=系統色の大枠、sector=ハブ十字、district=施設状態の枠、room=present塗り。
 */
export function drawHierarchyDebug(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  seed: number,
  w: number,
  h: number,
  ppt: number,
): void {
  const toScreenX = (wx: number) => (wx - cam.x) * ppt + w / 2;
  const toScreenY = (wy: number) => (wy - cam.y) * ppt + h / 2;

  const x0 = cam.x - w / ppt / 2, x1 = cam.x + w / ppt / 2;
  const y0 = cam.y - h / ppt / 2, y1 = cam.y + h / ppt / 2;

  ctx.save();
  ctx.globalAlpha = 0.5;

  // room present 塗り
  for (let rmy = Math.floor(y0 / ROOM_SIZE); rmy <= Math.floor(y1 / ROOM_SIZE); rmy++) {
    for (let rmx = Math.floor(x0 / ROOM_SIZE); rmx <= Math.floor(x1 / ROOM_SIZE); rmx++) {
      const wx = rmx * ROOM_SIZE, wy = rmy * ROOM_SIZE;
      const room = roomAt(seed, wx, wy);
      if (!room.present) continue;
      const region = regionAt(seed, wx, wy);
      const hue = SYSTEM_HUE[region.system] ?? 0;
      ctx.fillStyle = `hsla(${hue}, 60%, 50%, ${0.25 + room.decay * 0.4})`;
      ctx.fillRect(toScreenX(wx), toScreenY(wy), ROOM_SIZE * ppt, ROOM_SIZE * ppt);
    }
  }

  // district 枠(状態で線種)
  ctx.lineWidth = 1;
  for (let dy = Math.floor(y0 / DISTRICT_SIZE); dy <= Math.floor(y1 / DISTRICT_SIZE); dy++) {
    for (let dx = Math.floor(x0 / DISTRICT_SIZE); dx <= Math.floor(x1 / DISTRICT_SIZE); dx++) {
      const wx = dx * DISTRICT_SIZE, wy = dy * DISTRICT_SIZE;
      const d = districtAt(seed, wx, wy);
      ctx.strokeStyle = d.state === 'active' ? '#fff' : d.state === 'ruined' ? '#888' : '#a33';
      ctx.strokeRect(toScreenX(wx), toScreenY(wy), DISTRICT_SIZE * ppt, DISTRICT_SIZE * ppt);
    }
  }

  // sector ハブ十字
  ctx.strokeStyle = '#ff0';
  ctx.lineWidth = 2;
  for (let sy = Math.floor(y0 / SECTOR_SIZE); sy <= Math.floor(y1 / SECTOR_SIZE); sy++) {
    for (let sx = Math.floor(x0 / SECTOR_SIZE); sx <= Math.floor(x1 / SECTOR_SIZE); sx++) {
      const s = sectorAt(seed, sx * SECTOR_SIZE, sy * SECTOR_SIZE);
      const hx = toScreenX(sx * SECTOR_SIZE + s.hubX);
      const hy = toScreenY(sy * SECTOR_SIZE + s.hubY);
      ctx.beginPath();
      ctx.moveTo(hx - 8, hy); ctx.lineTo(hx + 8, hy);
      ctx.moveTo(hx, hy - 8); ctx.lineTo(hx, hy + 8);
      ctx.stroke();
    }
  }

  // HUD: 現在地の階層情報
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#0f0';
  ctx.font = '12px monospace';
  const region = regionAt(seed, cam.x, cam.y);
  const d = districtAt(seed, cam.x, cam.y);
  ctx.fillText(`region(${region.rx},${region.ry}) sys=${region.system} district=${d.facilityType}/${d.state}`, 12, h - 16);
  ctx.restore();
}
```

- [ ] **Step 2: renderer.ts に debug フックを追加**

- コンストラクタ引数か setter で `debugHierarchy: boolean` を保持(既定 false)。例: `setDebug(mode: string | null)` を追加し `this.debugMode = mode`
- import: `import { drawHierarchyDebug } from './debugHierarchy';`
- render() の**最後(post の後)**に:

```ts
    if (this.debugMode === 'hierarchy') {
      drawHierarchyDebug(ctx, cam, this.seed, w, h, ppt);
    }
```

(seed は Renderer が既に保持。無ければコンストラクタで受けて保持する)

- [ ] **Step 3: main.ts で ?debug= を渡す**

`src/main.ts`:
- `const debug = params.get('debug');`
- Renderer 構築後に `renderer.setDebug(debug);`

- [ ] **Step 4: screenshot.mjs に --debug を透過**

`scripts/screenshot.mjs`: 引数 `--debug` を読み、あれば URL に `&debug=<値>` を付ける(既存の --pos と同様の処理)。

- [ ] **Step 5: 型チェック+テスト+目視**

Run: `npm test && npx tsc --noEmit`
Expected: 全PASS(66 + hierarchy 追加分)、型エラーなし

Run:
```
node scripts/screenshot.mjs --debug=hierarchy --pos=100,-600 --out=screenshots/dbg-a.png
node scripts/screenshot.mjs --debug=hierarchy --pos=8000,-4000 --out=screenshots/dbg-b.png
node scripts/screenshot.mjs --pos=100,-600 --out=screenshots/dbg-off.png
```
PNGをReadで確認:
- dbg-a/b: 半透明で room 塗り(系統色)、district 枠(状態色)、sector ハブ十字が重なって見える。HUDに現在地の region/system/district が出る。座標を大きく変える(dbg-b)と系統/施設が変わる
- dbg-off: `?debug` 無しでは一切オーバーレイが出ず、通常描画のまま(段階1では地形は従来ノイズのまま)
- グリッド線がタイル格子と整合(ROOM境界=128タイルごと)

- [ ] **Step 6: コミット**

```bash
git add src/render/debugHierarchy.ts src/render/renderer.ts src/main.ts scripts/screenshot.mjs
git commit -m "feat: 階層デバッグ可視化(?debug=hierarchy)"
```

---

### Task 4: 段階1の最終確認

- [ ] **Step 1: 全テスト・型・ビルド**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: 全PASS、ビルド成功

- [ ] **Step 2: 決定論・局所性の総合目視**

同一シードで同じ座標のデバッグ表示が毎回同じこと、隣接セルで系統/施設が変わること、通常描画(debug無し)が段階0と同一であることを確認。

- [ ] **Step 3: 未コミット変更があればコミット**

```bash
git status
# 変更が残っていれば logical にコミット
```

---

## この計画のスコープ外(次段階)
- 段階2: 施設(貯水池)を実際のタイルとして `tileAt` に反映(入れる部屋)、多様性・崩壊、到達可能性保証
- 段階3: ネットワーク経路(配管/電線)+キャットウォーク併走+両端一致
- 段階4: 系統と因果(源→消費)、地域バイオーム化
- 段階5: セクター遠景シルエット、稀少ランドマーク、総合チューニング

段階1では `tileAt` の出力(地形・当たり判定)は一切変更しない。階層は「解決できてデバッグで見える」状態までが範囲。

## 留意(次段階へ申し送り)
- `regionCache`/`sectorCache`/`districtCache`/`roomCache` は現状無制限に増える。段階1の探索範囲では問題ないが、長時間プレイでの増大を防ぐため、後の段階でチャンク破棄(`ChunkStore.evictFarFrom`)と連動した上限付きキャッシュ(LRUまたは距離ベース破棄)へ差し替える。段階1では単純Mapのまま。
