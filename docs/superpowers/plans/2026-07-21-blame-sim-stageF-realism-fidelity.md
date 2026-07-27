# 段階F: realismモック忠実化(トーン再設計+接合ディテール) 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 承認済み realism モック(`.superpowers/brainstorm/1737-1784242068/content/realism.html`、スクショ `screenshots/mock-realism.png`)の明度設計と接合ディテール密度をゲーム本体の移動環境に持ち込む。「ほぼ黒の鋼世界に、照らされた接合部(ガセット/H鋼/ボルト/配管/手すり)だけが浮かぶ」画にする。

**Architecture:** ①モック由来の鋼鉄カラーランプを `render/steel.ts`(純粋)に一元化し、バイオームパレット・装飾色を全てそこから導出(系統色は微量ティントのみ)。②接合ディテールは既存の `decor.ts`(純粋・決定論)へセグメント装飾として追加し、`chunkbake.ts` が焼き込む。物理(`physics.ts`)・worldgen・当たり判定は無改修。③各タスク末にスクショゲート(モックと並置目視)。

**Tech Stack:** 既存(Vite/TS/Canvas2D/Vitest/Playwright)。新規依存なし。

**参照モック:** `screenshots/mock-realism.png`(= `.superpowers/brainstorm/1737-1784242068/content/realism.html`)

**全タスク共通:**
- 純粋ロジックは決定論(同一 seed+座標 → 同一出力)。既存テストは回帰なし維持
- スクショ: `node scripts/screenshot.mjs --seed=<s> [--pos=x,y] --out=screenshots/<name>.png`。exit 0+`[pageerror]`無しが必須
- 座標: y下向き正、CHUNK_SIZE=64、TILE={AIR:0,SOLID:1,LADDER:2}。装飾座標はチャンクローカルのタイル単位(浮動小数)
- `decor.ts` の hash シード領域: 601〜605 / 701〜708 使用済み。**本計画は 721〜733 を使う**(衝突禁止)
- `decorateChunk` のタイルバッファは MARGIN=17(ローカル [-17, 81) )。新セグメント走査はこの範囲で完結させること
- 実装開始前: 未コミットの作業ツリー変更(zoom調整ほか)が残っていれば先に確認・コミットしてから feat ブランチを切る

---

### Task 1: 鋼鉄カラーランプ(steel.ts)

**Files:**
- Create: `src/render/steel.ts`
- Test: `src/render/steel.test.ts`
- Modify: `src/render/biome.ts`(mixHex を steel.ts へ移設し re-export)

realism モックの色をそのまま定数化した明度ランプと、系統ティント付きタイルパレット生成、トーン検証用の相対輝度関数を提供する。`mixHex` は biome.ts から steel.ts へ移設(biome.ts が re-export するので既存 import 元は無修正)。

- [ ] **Step 1: 失敗するテストを書く**

`src/render/steel.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { mixHex, relLum, STEEL, steelPalette } from './steel';

describe('mixHex(移設)', () => {
  it('端点と中点', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});

describe('relLum', () => {
  it('黒=0、白=1、単調', () => {
    expect(relLum('#000000')).toBe(0);
    expect(relLum('#ffffff')).toBeCloseTo(1, 5);
    expect(relLum('#404040')).toBeLessThan(relLum('#808080'));
  });
});

describe('STEEL ランプ', () => {
  it('定義順で輝度が単調増加(モックの明度4段設計)', () => {
    const names = Object.keys(STEEL) as (keyof typeof STEEL)[];
    for (let i = 1; i < names.length; i++) {
      expect(relLum(STEEL[names[i]])).toBeGreaterThan(relLum(STEEL[names[i - 1]]));
    }
  });
  it('最暗〜基調はほぼ黒(闇が主役)', () => {
    expect(relLum(STEEL.base)).toBeLessThan(0.01);
    expect(relLum(STEEL.rib)).toBeLessThan(0.02);
  });
});

describe('steelPalette', () => {
  it('任意ティントで fillDark < fillMid < fillLight < edge の順序を保存', () => {
    for (const tint of ['#b07a45', '#7fc0ac', '#8fb4e6', '#d06a3c', '#b6b6e0']) {
      const p = steelPalette(tint);
      expect(relLum(p.fillDark)).toBeLessThan(relLum(p.fillMid));
      expect(relLum(p.fillMid)).toBeLessThan(relLum(p.fillLight));
      expect(relLum(p.fillLight)).toBeLessThan(relLum(p.edge));
    }
  });
  it('基調はほぼ黒・縁は可読(モックのトーン上限内)', () => {
    const p = steelPalette('#b07a45');
    expect(relLum(p.fillMid)).toBeLessThan(0.03);
    expect(relLum(p.edge)).toBeLessThan(0.2);
    expect(relLum(p.edge)).toBeGreaterThan(0.05);
  });
  it('決定論: 同じティントなら同じパレット', () => {
    expect(steelPalette('#7fc0ac')).toEqual(steelPalette('#7fc0ac'));
  });
});
```

- [ ] **Step 2: 失敗確認**

Run: `npx vitest run src/render/steel.test.ts`
Expected: FAIL(steel.ts 未定義)

- [ ] **Step 3: 実装**

`src/render/steel.ts`(新規):
```ts
import type { TilePalette } from './tileset/generate';

/** #rrggbb を線形混合(biome.ts から移設。旧挙動と完全同一) */
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

/** WCAG相対輝度(0..1)。トーン設計(明度4段)の検証用 */
export function relLum(hex: string): number {
  const p = parseInt(hex.slice(1), 16);
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch((p >> 16) & 255) + 0.7152 * ch((p >> 8) & 255) + 0.0722 * ch(p & 255);
}

/**
 * realismモック(brainstorm/1737-1784242068/content/realism.html)由来の
 * 鋼鉄カラーランプ。暗→明の順に定義(テストが単調性を検証する)。
 * 画面の明度構成はこのランプのみから組む。暖色(錆・灯)は decor.PALETTE 側。
 */
export const STEEL = {
  black: '#020408',    // 純黒(落ち影・後退内面)
  bg: '#03060a',       // 背景フィル基準
  far: '#070c12',      // 遠景躯体・凹ベイ
  shadow: '#0a121a',   // 落ち影・パネル線
  base: '#0d141c',     // 壁ベース
  stringer: '#10171f', // H鋼ストリンガー
  grate: '#141d27',    // グレーチング面
  rib: '#16202b',      // リブ柱・ガセット
  hanger: '#1c3040',   // 吊り金具・サポート
  trayEdge: '#22384a', // トレイ縁
  bayEdge: '#2a4258',  // 凹ベイ上縁の受け光・中桟
  post: '#33506a',     // 手すり支柱・ボルト・配管ハイライト
  flange: '#3d566e',   // 上フランジ受け光・クランプ
  railTop: '#4a6a84',  // 手すり上桟・空気側リム
  rim: '#7d97ad',      // 歩ける上端の明リムライト(可読性の主役)
} as const;

/** 鋼ランプに系統色を微量ティントしたタイルパレット。明度関係はランプのまま保存する */
export function steelPalette(tint: string, k = 0.07): TilePalette {
  return {
    fillDark: mixHex(STEEL.far, tint, k),
    fillMid: mixHex(STEEL.base, tint, k),
    fillLight: mixHex(STEEL.rib, tint, k),
    edge: mixHex(STEEL.railTop, tint, k * 2),
    line: STEEL.shadow,
  };
}
```

`src/render/biome.ts`: 末尾の `mixHex` 関数定義(117〜126行)を削除し、先頭に:
```ts
import { mixHex } from './steel';
export { mixHex };
```
(既存の `import type { TilePalette }` などはそのまま。`chunkbake.ts`/`renderer.ts` は `from './biome'` の re-export 経由で無修正)

- [ ] **Step 4: 通過確認**

Run: `npx vitest run src/render/steel.test.ts` → PASS
Run: `npm test` → 全PASS(biome.test.ts の mixHex テストは re-export で通る)
Run: `npx tsc --noEmit` → クリーン

- [ ] **Step 5: コミット**
```bash
git add src/render/steel.ts src/render/steel.test.ts src/render/biome.ts
git commit -m "feat: realismモック由来の鋼鉄カラーランプ(steel.ts)"
```

---

### Task 2: バイオーム暗色化と背景フィルのトーン再設計

**Files:**
- Modify: `src/render/biome.ts`(BIOMES/FOUNDRY のパレット・ambientColor・bgLayers)
- Modify: `src/render/renderer.ts:103-106`(背景フィル)
- Test: `src/render/biome.test.ts`(追記)

全系統のタイルパレットを `steelPalette(系統ティント)` に、背景レイヤー色を鋼ランプ+微量ティントに置き換える。系統の識別は「微量ティント+accent(稼働灯等の点)」で保ち、面の色はほぼ黒に統一する。

- [ ] **Step 1: 失敗するテストを追記**

`src/render/biome.test.ts` に追記:
```ts
import { relLum } from './steel';

describe('トーン再設計(realismモック水準)', () => {
  const systems = ['water', 'power', 'habitation', 'disposal', 'foundry'] as const;
  it('全系統: 基調はほぼ黒(fillMid 輝度 < 0.03)', () => {
    for (const s of systems) {
      expect(relLum(SYSTEM_BIOME[s].palette.fillMid)).toBeLessThan(0.03);
    }
  });
  it('全系統: 明度4段 fillDark < fillMid < fillLight < edge', () => {
    for (const s of systems) {
      const p = SYSTEM_BIOME[s].palette;
      expect(relLum(p.fillDark)).toBeLessThan(relLum(p.fillMid));
      expect(relLum(p.fillMid)).toBeLessThan(relLum(p.fillLight));
      expect(relLum(p.fillLight)).toBeLessThan(relLum(p.edge));
    }
  });
  it('全系統: 環境色も暗い(ambientColor 輝度 < 0.03)', () => {
    for (const s of systems) {
      expect(relLum(SYSTEM_BIOME[s].ambientColor)).toBeLessThan(0.03);
    }
  });
  it('全系統: 背景レイヤーは基調タイルより暗い(遠いほど暗い原則)', () => {
    for (const s of systems) {
      const b = SYSTEM_BIOME[s];
      for (const L of b.bgLayers) {
        expect(relLum(L.color)).toBeLessThanOrEqual(relLum(b.palette.fillMid) + 1e-6);
      }
    }
  });
});
```
(既存の「fillMid が全て異なる」テストはティント差で引き続き通ること)

- [ ] **Step 2: 失敗確認**

Run: `npx vitest run src/render/biome.test.ts`
Expected: FAIL(現行パレットは明るい)

- [ ] **Step 3: biome.ts のパレット置換**

`src/render/biome.ts` の BIOMES/FOUNDRY を以下に置き換える(構造・名前・ambientLevel・accent・factor/density/kind は不変。色のみ変更):
```ts
import { mixHex, steelPalette } from './steel';
export { mixHex };

/** 背景レイヤー色: 奥(添字小)ほど暗い鋼ランプ+微量ティント */
const bgColor = (tint: string, i: number): string =>
  mixHex(['#05080d', '#070c12', '#0a1017'][Math.min(i, 2)], tint, 0.05);

const bg = (
  tint: string,
  defs: ReadonlyArray<readonly [number, number, BgLayer['kind']]>,
): BgLayer[] =>
  defs.map(([factor, density, kind], i) => ({ factor, density, kind, color: bgColor(tint, i) }));

export const BIOMES: readonly Biome[] = [
  // BIOMES[0] (最下層) は SYSTEM_BIOME 未使用の予備パレット(温存)。
  {
    name: '最下層', ambientColor: mixHex('#2e3a44', '#020408', 0.72), ambientLevel: 0.34,
    palette: steelPalette('#6f8794'), accent: '#6f8794',
    bgLayers: bg('#6f8794', [[0.2, 0.5, 'tower'], [0.4, 0.4, 'deck']]),
  },
  {
    name: '居住区跡', ambientColor: mixHex('#2c4a4a', '#020408', 0.72), ambientLevel: 0.5,
    palette: steelPalette('#7fc0ac'), accent: '#9fd8c2',
    bgLayers: bg('#7fc0ac', [[0.18, 0.55, 'tower'], [0.35, 0.5, 'deck'], [0.5, 0.3, 'haze']]),
  },
  {
    name: '廃棄物層', ambientColor: mixHex('#4a3826', '#020408', 0.72), ambientLevel: 0.36,
    palette: steelPalette('#b07a45'), accent: '#c98f52',
    bgLayers: bg('#b07a45', [[0.2, 0.5, 'tower'], [0.4, 0.45, 'deck']]),
  },
  {
    name: '大空洞帯', ambientColor: mixHex('#2f3f5c', '#020408', 0.66), ambientLevel: 0.72,
    palette: steelPalette('#8fb4e6'), accent: '#a9c6ee',
    bgLayers: bg('#8fb4e6', [[0.12, 0.7, 'tower'], [0.3, 0.5, 'deck'], [0.55, 0.35, 'haze']]),
  },
  {
    name: '上層', ambientColor: mixHex('#3a3a55', '#020408', 0.72), ambientLevel: 0.6,
    palette: steelPalette('#b6b6e0'), accent: '#c9a0ff',
    bgLayers: bg('#b6b6e0', [[0.16, 0.55, 'tower'], [0.36, 0.45, 'deck']]),
  },
];

const FOUNDRY: Biome = {
  name: '精錬炉', ambientColor: mixHex('#4a2620', '#020408', 0.72), ambientLevel: 0.44,
  palette: steelPalette('#d06a3c'), accent: '#e8834a',
  bgLayers: bg('#d06a3c', [[0.2, 0.5, 'tower'], [0.4, 0.45, 'deck']]),
};
```

- [ ] **Step 4: renderer.ts の背景フィルを暗く**

`src/render/renderer.ts` の背景フィル(103〜106行)を:
```ts
    const lit = mixHex('#020408', mixHex(bb.ambientColor, '#000000', 0.6), bb.ambientLevel);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, mixHex(lit, '#ffffff', 0.05 * bb.ambientLevel));
    grad.addColorStop(1, mixHex(lit, '#000000', 0.45));
```
に変更(基準 `#05070a`→`#020408`、持ち上げ 0.08→0.05、下端 0.35→0.45)。

- [ ] **Step 5: 通過確認**

Run: `npm test` → 全PASS。`npx tsc --noEmit` → クリーン

- [ ] **Step 6: スクショゲート(トーン)**

```bash
node scripts/screenshot.mjs --seed=20260711 --out=screenshots/f2-spawn.png
node scripts/screenshot.mjs --seed=20260711 --pos=100,-600 --out=screenshots/f2-mid.png
node scripts/screenshot.mjs --seed=20260711 --pos=200,-1700 --out=screenshots/f2-cavern.png
node scripts/screenshot.mjs --seed=42 --out=screenshots/f2-s42.png
```
`screenshots/mock-realism.png` と並べて目視確認:
- 画面の大半がほぼ黒(闇が主役)になったか
- 歩ける上面のリムライトが際立ち足場が読めるか(**可読性ゲート**: 読めなければ chunkbake.ts のリム alpha 0.9 / `rimTopColor` の白混合 0.4 を上げて調整)
- 背景(パララックス・超構造)が近景より暗く、奥行きが正しい方向か
- 系統の違い(ティント)がかろうじて感じられるか

- [ ] **Step 7: コミット**
```bash
git add src/render/biome.ts src/render/biome.test.ts src/render/renderer.ts
git commit -m "feat: 段階F トーン再設計(鋼ランプへのバイオーム暗色化+背景フィル)"
```

---

### Task 3: DecorOp拡張と壁の弐瓶化(凹ベイ・リブ柱・錆筋・抜け区画)

**Files:**
- Modify: `src/render/decor.ts`(DecorOp 拡張・PALETTE 鋼色化・壁装飾追加)
- Modify: `src/render/chunkbake.ts`(rect/grad 描画対応)
- Test: `src/render/decor.test.ts`(追記)

モックの壁(凹ベイ+リブ柱+ボルト場+抜け区画+錆筋)を、ワールド座標整列のセグメント装飾として追加する。塗り面とグラデ(錆のフェード・配管の円筒)を表現するため DecorOp に `rect`/`grad` を追加。既存 PALETTE も鋼ランプの色へ差し替える。

- [ ] **Step 1: 失敗するテストを追記**

`src/render/decor.test.ts` に追記:
```ts
describe('壁の弐瓶化(段階F)', () => {
  const CH = 64;
  it('凹ベイ(bay色のrect)は完全内部領域にのみ彫られる', () => {
    let found = 0;
    for (let cx = 0; cx < 6; cx++) {
      for (let cy = -3; cy < 3; cy++) {
        for (const op of decorateChunk(42, cx, cy)) {
          if (op.kind !== 'rect' || op.color !== PALETTE.bay) continue;
          found++;
          // ベイ矩形の四隅+中心のタイルは全てSOLID(彫る先が壁の内部)
          for (const [fx, fy] of [
            [op.x, op.y], [op.x + op.w - 0.01, op.y],
            [op.x, op.y + op.h - 0.01], [op.x + op.w - 0.01, op.y + op.h - 0.01],
            [op.x + op.w / 2, op.y + op.h / 2],
          ] as const) {
            expect(tileAt(42, cx * CH + Math.floor(fx), cy * CH + Math.floor(fy))).toBe(TILE.SOLID);
          }
        }
      }
    }
    expect(found).toBeGreaterThan(0); // 広域には必ず出現
  });

  it('錆筋は grad(縦方向・stops 0..1)で表現される', () => {
    let found = 0;
    for (let cx = 0; cx < 6; cx++) {
      for (let cy = -3; cy < 3; cy++) {
        for (const op of decorateChunk(42, cx, cy)) {
          if (op.kind !== 'grad') continue;
          found++;
          expect(op.stops.length).toBeGreaterThanOrEqual(2);
          for (const [off] of op.stops) {
            expect(off).toBeGreaterThanOrEqual(0);
            expect(off).toBeLessThanOrEqual(1);
          }
        }
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('凹ベイの判定はチャンク境界の両側で一致する(継ぎ目なし)', () => {
    const collect = (cx: number) => {
      const set = new Set<string>();
      for (const op of decorateChunk(42, cx, 1)) {
        if (op.kind !== 'rect' || op.color !== PALETTE.bay) continue;
        const wx = cx * CH + op.x;
        if (wx > CH - 10 && wx < CH + 10) set.add(`${wx.toFixed(2)}:${(CH + op.y).toFixed(2)}`);
      }
      return set;
    };
    expect(collect(0)).toEqual(collect(1));
  });

  it('決定論: 同一入力なら同一出力(拡張後も)', () => {
    expect(decorateChunk(42, 2, -1)).toEqual(decorateChunk(42, 2, -1));
  });
});
```

- [ ] **Step 2: 失敗確認**

Run: `npx vitest run src/render/decor.test.ts`
Expected: FAIL(`PALETTE.bay` 未定義)

- [ ] **Step 3: decor.ts — DecorOp拡張とPALETTE鋼色化**

`src/render/decor.ts` の DecorOp union に2種追加:
```ts
export type DecorOp =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; w: number; color: string; surface?: boolean }
  | { kind: 'dot'; x: number; y: number; r: number; color: string; surface?: boolean }
  | { kind: 'poly'; pts: number[]; w: number; color: string; fill?: boolean; surface?: boolean }
  | { kind: 'hatch'; x: number; y: number; w: number; h: number; spacing: number; color: string; cross?: boolean; surface?: boolean }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; color: string; alpha?: number; surface?: boolean }
  | { kind: 'grad'; x: number; y: number; w: number; h: number; dir: 'h' | 'v'; stops: ReadonlyArray<readonly [number, string]>; alpha?: number; surface?: boolean };
```

PALETTE を鋼ランプ(steel.ts と同じ値のリテラル)+モックの暖色へ全面差し替え:
```ts
/** 装飾の色パレット(realismモックの鋼ランプ。暖色は錆・灯のみ) */
export const PALETTE = {
  edgeTop: '#4a6a84',
  edgeSide: '#2a4258',
  seam: '#0a121a',
  rivet: '#33506a',
  bolt: '#33506a',
  hatch: '#141d27',
  hatchFaint: '#10171f',
  pipe: '#1a232d',
  pipeThin: '#141d27',
  bracket: '#22384a',
  cable: '#141a21',
  wire: '#10161c',
  grill: '#22384a',
  debris: '#0d1218',
  debrisLine: '#2a4258',
  rail: '#33506a',
  rung: '#2a4258',
  hoop: '#1c3040',
  // ── 段階F: 壁・歩廊・配管の接合ディテール ──
  bay: '#070c12',       // 凹ベイの暗面
  bayEdge: '#2a4258',   // ベイ上縁の受け光
  rib: '#16202b',       // リブ柱・ガセット
  ribLight: '#3d566e',  // リブ柱の受け光エッジ
  stringer: '#10171f',  // H鋼ストリンガー
  web: '#16202b',       // H鋼ウェブ
  flange: '#3d566e',    // 上フランジ受け光
  shadow: '#0a121a',    // 落ち影・ジョイスト
  grateLine: '#0a121a', // グレーチングの目
  railPost: '#33506a',  // 手すり支柱
  railTop: '#4a6a84',   // 手すり上桟
  railMid: '#2a4258',   // 手すり中桟
  pipeHi: '#33506a', pipeMid: '#16222d', pipeLo: '#080d13', // 大径配管の円筒グラデ
  clamp: '#3d566e',     // バンドクランプ
  hanger: '#1c3040',    // 吊り金具
  tray: '#0d141c', trayEdge: '#22384a', trayCable: '#1c3040', // ケーブルトレイ
  rust: '#5a3a24', rust0: 'rgba(90,58,36,0)', // 錆筋(フェード終端)
  rebar: '#2a4258',     // 露出鉄筋
  hole: '#040709',      // 抜け区画
} as const;
```

- [ ] **Step 4: decor.ts — ハッチ抑制とリブ柱(タイルパス)**

`decorateChunk` の内部ハッチング(124〜129行)を置換:
```ts
      // 内部: モックの壁はフラットな暗面が基調。ハッチは一部タイルだけ淡く残し、
      // 世界座標整列のリブ柱(11タイル周期)が垂直リズムを作る。
      if (!upAir && !downAir && !leftAir && !rightAir) {
        if (hash2(seed + 604, wx, wy) < 0.22) {
          const si = stratumIndexAt(wy) % 3;
          const spacing = 0.26 + 0.07 * si;
          ops.push({ kind: 'hatch', x: lx, y: ly, w: 1, h: 1, spacing, color: PALETTE.hatchFaint, cross: false, surface: true });
        }
        // リブ柱(右側に受け光・2タイルごとにボルト)。列単位のhashで7割の柱が現存
        if (mod(wx, 11) === 0 && hash2(seed + 726, Math.floor(wx / 11), 0) < 0.7) {
          ops.push({ kind: 'rect', x: lx + 0.3, y: ly, w: 0.5, h: 1, color: PALETTE.rib });
          ops.push({ kind: 'line', x1: lx + 0.8, y1: ly, x2: lx + 0.8, y2: ly + 1, w: 0.07, color: PALETTE.ribLight });
          if (mod(wy, 2) === 0) ops.push({ kind: 'dot', x: lx + 0.55, y: ly + 0.5, r: 0.06, color: PALETTE.bolt });
        }
      }
```

- [ ] **Step 5: decor.ts — 凹ベイ(セグメントパス)**

`segmentOps` の末尾(壁面セグメントの後)に追加:
```ts
  // ── 凹ベイ: 8x7 の世界座標整列ブロックが周囲1タイル込みで完全SOLIDなら、
  // 後退した暗い区画を彫る(内側上端の落ち影+上縁の受け光+損傷+錆筋)。
  // モックの「凹ベイ+抜け区画+露出鉄筋+錆の筋」に対応する。
  const bs0 = Math.floor((bx - 16) / 8);
  const bs1 = Math.floor((bx + CHUNK_SIZE) / 8);
  const bt0 = Math.floor((by - 16) / 7);
  const bt1 = Math.floor((by + CHUNK_SIZE) / 7);
  for (let sy = bt0; sy <= bt1; sy++) {
    for (let sx = bs0; sx <= bs1; sx++) {
      if (hash2(seed + 721, sx, sy) > 0.6) continue; // 全面ベイだと壁が虚ろになるので6割
      const x0 = sx * 8;
      const y0 = sy * 7;
      let ok = true;
      for (let iy = -1; iy <= 7 && ok; iy++)
        for (let ix = -1; ix <= 8 && ok; ix++)
          ok = t(x0 + ix, y0 + iy) === TILE.SOLID; // segmentOpsのtはワールド座標アクセサ
      if (!ok) continue;
      const lx0 = x0 - bx;
      const ly0 = y0 - by;
      ops.push({ kind: 'rect', x: lx0 + 0.5, y: ly0 + 0.5, w: 7, h: 6, color: PALETTE.bay });
      ops.push({ kind: 'rect', x: lx0 + 0.5, y: ly0 + 0.5, w: 7, h: 0.5, color: '#020408', alpha: 0.6 });
      ops.push({ kind: 'line', x1: lx0 + 0.5, y1: ly0 + 0.5, x2: lx0 + 7.5, y2: ly0 + 0.5, w: 0.08, color: PALETTE.bayEdge });
      // 損傷: 抜け区画+露出鉄筋(35%)
      if (hash2(seed + 722, sx, sy) < 0.35) {
        const hx = lx0 + 1 + Math.floor(hash2(seed + 723, sx, sy) * 4);
        const hy = ly0 + 3.5;
        ops.push({ kind: 'rect', x: hx, y: hy, w: 2.4, h: 2.4, color: PALETTE.hole });
        for (let i = 0; i < 3; i++) {
          const rx = hx + 0.3 + i * 0.8;
          ops.push({ kind: 'line', x1: rx, y1: hy + 2.4, x2: rx + 0.5, y2: hy + 1.2, w: 0.05, color: PALETTE.rebar });
        }
      }
      // 錆筋: 上縁から下へフェード(50%)
      if (hash2(seed + 724, sx, sy) < 0.5) {
        const rx = lx0 + 1 + hash2(seed + 725, sx, sy) * 5.5;
        ops.push({
          kind: 'grad', x: rx, y: ly0 + 0.6, w: 0.28, h: 2.6, dir: 'v',
          stops: [[0, PALETTE.rust], [1, PALETTE.rust0]], alpha: 0.45,
        });
      }
    }
  }
```
(NOTE行の通り、`segmentOps` 内の `t` はワールド座標アクセサ。内側ループは素直に `ok = t(x0 + ix, y0 + iy) === TILE.SOLID;` と書く。走査範囲: x0+ix ∈ [bx-17, bx+72]、y0+iy ∈ [by-17, by+70] で MARGIN=17 内)

- [ ] **Step 6: chunkbake.ts — rect/grad 描画対応**

`ChunkBaker.draw` の switch に追加:
```ts
      case 'rect':
        ctx.globalAlpha = op.alpha ?? 1;
        ctx.fillStyle = op.color;
        ctx.fillRect(op.x * P, op.y * P, op.w * P, op.h * P);
        ctx.globalAlpha = 1;
        break;
      case 'grad': {
        const g = op.dir === 'v'
          ? ctx.createLinearGradient(op.x * P, op.y * P, op.x * P, (op.y + op.h) * P)
          : ctx.createLinearGradient(op.x * P, op.y * P, (op.x + op.w) * P, op.y * P);
        for (const [off, color] of op.stops) g.addColorStop(off, color);
        ctx.globalAlpha = op.alpha ?? 1;
        ctx.fillStyle = g;
        ctx.fillRect(op.x * P, op.y * P, op.w * P, op.h * P);
        ctx.globalAlpha = 1;
        break;
      }
```

- [ ] **Step 7: 通過確認**

Run: `npx vitest run src/render/decor.test.ts` → PASS(既存テスト含む)
Run: `npm test && npx tsc --noEmit` → 全PASS・クリーン

- [ ] **Step 8: スクショゲート(壁)**

```bash
node scripts/screenshot.mjs --seed=20260711 --pos=200,-1700 --out=screenshots/f3-wall.png
node scripts/screenshot.mjs --seed=42 --out=screenshots/f3-s42.png
```
mock-realism.png の左壁と比較: 凹ベイの奥行き(暗面+上縁の受け光)、リブ柱の垂直リズム、錆筋、抜け区画が読めるか。均一グリッド感が壊れたか。

- [ ] **Step 9: コミット**
```bash
git add src/render/decor.ts src/render/decor.test.ts src/render/chunkbake.ts
git commit -m "feat: 段階F 壁の弐瓶化(凹ベイ・リブ柱・錆筋・抜け区画)+DecorOp rect/grad"
```

---

### Task 4: 歩廊の弐瓶化(H鋼・ジョイスト・落ち影・グレーチング・手すり・ガセット)

**Files:**
- Modify: `src/render/decor.ts`(床セグメント拡張)
- Test: `src/render/decor.test.ts`(追記)

モックの主役「片持ち歩廊」を床セグメント(16タイル・上面空気)に実装する。下面が空気の薄い床(=歩廊)には H鋼ストリンガー+下面ジョイスト+落ち影+ガセットを、全ての床に手すり(確率)とグレーチングの目を付ける。

- [ ] **Step 1: 失敗するテストを追記**

`src/render/decor.test.ts` に追記:
```ts
describe('歩廊の弐瓶化(段階F)', () => {
  const CH = 64;
  it('H鋼ストリンガー(stringer色のrect)は薄い床(直下が非SOLID)にのみ付く', () => {
    let found = 0;
    for (let cx = 0; cx < 8; cx++) {
      for (let cy = -4; cy < 4; cy++) {
        for (const op of decorateChunk(42, cx, cy)) {
          if (op.kind !== 'rect' || op.color !== PALETTE.stringer) continue;
          found++;
          // rect はデッキタイル下端の直上に描かれる: 中央サンプルの床タイルは
          // 「SOLID かつ 直下は非SOLID かつ 直上は非SOLID」
          const wx = cx * CH + Math.floor(op.x + op.w / 2);
          const wyFloor = cy * CH + Math.floor(op.y - 0.25); // rect上辺=床タイル内
          expect(tileAt(42, wx, wyFloor)).toBe(TILE.SOLID);
          expect(tileAt(42, wx, wyFloor + 1)).not.toBe(TILE.SOLID);
          expect(tileAt(42, wx, wyFloor - 1)).not.toBe(TILE.SOLID);
        }
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('手すり上桟(railTop色の水平line)の直下は歩ける床', () => {
    let found = 0;
    for (let cx = 0; cx < 8; cx++) {
      for (let cy = -4; cy < 4; cy++) {
        for (const op of decorateChunk(42, cx, cy)) {
          if (op.kind !== 'line' || op.color !== PALETTE.railTop || op.y1 !== op.y2) continue;
          found++;
          const wx = cx * CH + Math.floor((op.x1 + op.x2) / 2);
          const wyRail = cy * CH + op.y1; // 床上面より 0.9 上
          const wyFloor = Math.floor(wyRail + 0.9);
          expect(tileAt(42, wx, wyFloor)).toBe(TILE.SOLID);
          expect(tileAt(42, wx, wyFloor - 1)).not.toBe(TILE.SOLID);
        }
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('ガセット(rib色fillのpoly)は必ず壁(SOLID)に接する', () => {
    for (let cx = 0; cx < 8; cx++) {
      for (let cy = -4; cy < 4; cy++) {
        for (const op of decorateChunk(42, cx, cy)) {
          if (op.kind !== 'poly' || op.color !== PALETTE.rib || !op.fill) continue;
          // pts[0],pts[1] = 壁側の付け根(タイル境界)。左右どちらかの隣が壁
          const wx = cx * CH + op.pts[0];
          const wy = cy * CH + Math.floor(op.pts[1]);
          const leftWall = tileAt(42, Math.floor(wx) - 1, wy) === TILE.SOLID;
          const rightWall = tileAt(42, Math.floor(wx), wy) === TILE.SOLID;
          expect(leftWall || rightWall).toBe(true);
        }
      }
    }
  });
});
```

- [ ] **Step 2: 失敗確認**

Run: `npx vitest run src/render/decor.test.ts`
Expected: FAIL(stringer rect 未出現)

- [ ] **Step 3: decor.ts — 床セグメント拡張**

`segmentOps` の床セクション(既存の配管/瓦礫分岐の**前**、`ok` 判定成立直後)に追加:
```ts
      const lx0 = x0 - bx;
      // ── 段階F: 歩廊/床の接合ディテール(既存の這う配管・瓦礫とは独立) ──
      // グレーチングの目(歩ける上面のすぐ下に短い縦目。上端リムはrelief側が引く)
      for (let i = 0; i < 32; i++) {
        const gx = lx0 + i * 0.5 + 0.25;
        ops.push({ kind: 'line', x1: gx, y1: ly + 0.12, x2: gx, y2: ly + 0.42, w: 0.05, color: PALETTE.grateLine });
      }
      // 薄い床(全16タイルの直下が非SOLID)= 歩廊: H鋼+ジョイスト+落ち影+錆筋+ガセット
      let thin = true;
      for (let i = 0; i < 16 && thin; i++) thin = t(x0 + i, wy + 1) !== TILE.SOLID;
      if (thin) {
        const yb = ly + 1; // 床タイル下端
        ops.push({ kind: 'rect', x: lx0, y: yb, w: 16, h: 0.38, color: PALETTE.shadow, alpha: 0.8 }); // 落ち影
        ops.push({ kind: 'rect', x: lx0, y: yb - 0.5, w: 16, h: 0.5, color: PALETTE.stringer });      // H鋼側面
        ops.push({ kind: 'line', x1: lx0, y1: yb - 0.5, x2: lx0 + 16, y2: yb - 0.5, w: 0.07, color: PALETTE.flange }); // 上フランジ受け光
        ops.push({ kind: 'rect', x: lx0, y: yb - 0.32, w: 16, h: 0.14, color: PALETTE.web });         // ウェブ帯
        for (let i = 1; i < 16; i += 2) {
          ops.push({ kind: 'dot', x: lx0 + i, y: yb - 0.25, r: 0.05, color: PALETTE.bolt });
        }
        for (let i = 2; i < 16; i += 4) {
          ops.push({ kind: 'line', x1: lx0 + i, y1: yb, x2: lx0 + i, y2: yb + 0.9, w: 0.1, color: PALETTE.shadow }); // 下面ジョイスト
        }
        if (hash2(seed + 727, s, wy) < 0.6) {
          const rx = lx0 + 2 + hash2(seed + 728, s, wy) * 12;
          ops.push({
            kind: 'grad', x: rx, y: yb, w: 0.2, h: 2.2, dir: 'v',
            stops: [[0, PALETTE.rust], [1, PALETTE.rust0]], alpha: 0.4,
          });
        }
        // ガセット: セグメント端の外側が壁(当該行と直下がSOLID)なら三角ブレースを壁へ噛ませる
        for (const [ex, dir] of [[x0 - 1, 1], [x0 + 16, -1]] as const) {
          if (t(ex, wy) !== TILE.SOLID || t(ex, wy + 1) !== TILE.SOLID) continue;
          const gx = ex - bx + (dir === 1 ? 1 : 0);
          const tri = [gx, yb, gx + dir * 3, yb, gx, yb + 2];
          ops.push({ kind: 'poly', pts: tri, w: 0, color: PALETTE.rib, fill: true });
          ops.push({ kind: 'poly', pts: [...tri, gx, yb], w: 0.07, color: PALETTE.ribLight });
          ops.push({ kind: 'dot', x: gx + dir * 0.8, y: yb + 0.4, r: 0.06, color: PALETTE.bolt });
          ops.push({ kind: 'dot', x: gx + dir * 1.8, y: yb + 0.3, r: 0.06, color: PALETTE.bolt });
        }
      }
      // 手すり(55%・非衝突の見た目のみ): 支柱+上桟+中桟。上面空気は床判定で保証済み
      if (hash2(seed + 729, s, wy) < 0.55) {
        for (let i = 0; i < 16; i += 2) {
          ops.push({ kind: 'line', x1: lx0 + i + 0.5, y1: ly, x2: lx0 + i + 0.5, y2: ly - 0.9, w: 0.07, color: PALETTE.railPost });
        }
        ops.push({ kind: 'line', x1: lx0, y1: ly - 0.9, x2: lx0 + 16, y2: ly - 0.9, w: 0.09, color: PALETTE.railTop });
        ops.push({ kind: 'line', x1: lx0, y1: ly - 0.45, x2: lx0 + 16, y2: ly - 0.45, w: 0.06, color: PALETTE.railMid });
      }
```
既存分岐の `const lx0 = x0 - bx;`(重複宣言になる)は削除し、上記の宣言を共用する。

- [ ] **Step 4: 通過確認**

Run: `npx vitest run src/render/decor.test.ts` → PASS
Run: `npm test && npx tsc --noEmit` → 全PASS・クリーン
(注意: 既存テスト「床配管の判定はチャンク境界の両側で一致」が新装飾の座標にも依存しないこと)

- [ ] **Step 5: スクショゲート(歩廊)**

```bash
node scripts/screenshot.mjs --seed=20260711 --out=screenshots/f4-spawn.png
node scripts/screenshot.mjs --seed=20260711 --pos=100,-600 --out=screenshots/f4-mid.png
```
mock-realism.png の歩廊と比較: H鋼の側面(上フランジ受け光+ウェブ+ボルト)、下面ジョイスト、落ち影、手すりの3段(支柱/上桟/中桟)、壁際のガセットが読めるか。**可読性ゲート**: 手すりが足場と紛らわしければ `railTop` の輝度を下げる(`#4a6a84`→`#3d566e`)。

- [ ] **Step 6: コミット**
```bash
git add src/render/decor.ts src/render/decor.test.ts
git commit -m "feat: 段階F 歩廊の弐瓶化(H鋼・ジョイスト・手すり・ガセット・グレーチング)"
```

---

### Task 5: 大径配管とケーブルトレイ

**Files:**
- Modify: `src/render/decor.ts`(縦壁の大径配管+天井のケーブルトレイ)
- Test: `src/render/decor.test.ts`(追記)

モック中央の「大径配管(円筒グラデ+バンドクランプ+サポートハンガー)」を縦8タイルの露出壁面に、モック天井の「ケーブルトレイ」を天井セグメントに追加する。

- [ ] **Step 1: 失敗するテストを追記**

`src/render/decor.test.ts` に追記:
```ts
describe('大径配管とケーブルトレイ(段階F)', () => {
  const CH = 64;
  it('大径配管(pipeHi起点の横グラデ)は縦壁面の空気側に立つ', () => {
    let found = 0;
    for (let cx = 0; cx < 10; cx++) {
      for (let cy = -5; cy < 5; cy++) {
        for (const op of decorateChunk(42, cx, cy)) {
          if (op.kind !== 'grad' || op.dir !== 'h') continue;
          if (op.stops[0][1] !== PALETTE.pipeHi) continue;
          found++;
          expect(op.h).toBe(8); // 8タイル分の縦管
          // 管の中心は空気(壁のそば・非衝突)
          const wx = cx * CH + Math.floor(op.x + op.w / 2);
          const wy = cy * CH + Math.floor(op.y + 4);
          expect(tileAt(42, wx, wy)).not.toBe(TILE.SOLID);
        }
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('ケーブルトレイ(tray色rect)は天井から吊られる(トレイ上方にSOLIDの天井)', () => {
    let found = 0;
    for (let cx = 0; cx < 10; cx++) {
      for (let cy = -5; cy < 5; cy++) {
        for (const op of decorateChunk(42, cx, cy)) {
          if (op.kind !== 'rect' || op.color !== PALETTE.tray) continue;
          found++;
          const wx = cx * CH + Math.floor(op.x + op.w / 2);
          const wyTray = cy * CH + Math.floor(op.y);
          // トレイの2.2タイル上に天井面(SOLID)がある
          expect(tileAt(42, wx, wyTray - 3)).toBe(TILE.SOLID);
          expect(tileAt(42, wx, wyTray)).not.toBe(TILE.SOLID);
        }
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 失敗確認**

Run: `npx vitest run src/render/decor.test.ts`
Expected: FAIL

- [ ] **Step 3: decor.ts — 大径配管(セグメントパス)**

`segmentOps` に追加(壁面セクションの後):
```ts
  // ── 大径配管: 縦8タイルすべて「SOLIDで空気側に露出」の壁面に、少し離して円筒管を立てる ──
  const ps0 = Math.floor((by - 16) / 8);
  const ps1 = Math.floor((by + CHUNK_SIZE) / 8);
  for (let lx = -1; lx <= CHUNK_SIZE; lx++) {
    const wx = bx + lx;
    for (let s = ps0; s <= ps1; s++) {
      const y0 = s * 8;
      for (const dir of [-1, 1] as const) {
        let ok = true;
        for (let i = 0; i < 8 && ok; i++) {
          ok = t(wx, y0 + i) === TILE.SOLID && t(wx + dir, y0 + i) === TILE.AIR;
        }
        if (!ok || hash2(seed + 730, wx, s * 2 + (dir < 0 ? 0 : 1)) > 0.16) continue;
        const ly0 = y0 - by;
        const px0 = dir === -1 ? lx - 0.75 : lx + 1.2; // 壁面から0.2離す
        ops.push({
          kind: 'grad', x: px0, y: ly0, w: 0.55, h: 8, dir: 'h',
          stops: [[0, PALETTE.pipeHi], [0.35, PALETTE.pipeMid], [1, PALETTE.pipeLo]],
        });
        // バンドクランプ(リング)
        for (const cy2 of [ly0 + 1.5, ly0 + 4.5, ly0 + 7]) {
          ops.push({ kind: 'line', x1: px0, y1: cy2, x2: px0 + 0.55, y2: cy2, w: 0.12, color: PALETTE.clamp });
        }
        // サポートハンガー(壁面→管)
        const wallX = dir === -1 ? lx : lx + 1;
        for (const hy of [ly0 + 2.5, ly0 + 6]) {
          ops.push({
            kind: 'line', x1: wallX, y1: hy,
            x2: dir === -1 ? px0 + 0.55 : px0, y2: hy, w: 0.08, color: PALETTE.hanger,
          });
        }
      }
    }
  }
```

- [ ] **Step 4: decor.ts — ケーブルトレイ(天井セクション改)**

天井セグメントの分岐(`r < 0.44` ケーブル / `r < 0.62` ワイヤー)を3分岐に変更:
```ts
      const r = hash2(seed + 703, s, wy);
      if (r < 0.44) {
        // カテナリーケーブル(既存コードそのまま・変更なし)
        const sag = 1 + hash2(seed + 704, s, wy) * 2.2;
        const pts: number[] = [];
        for (let i = 0; i <= 8; i++) {
          const u = i / 8;
          const x = lx0 + u * 8;
          const y = ly + 1 + 2 * sag * u * (1 - u);
          pts.push(x, y);
        }
        ops.push({ kind: 'poly', pts, w: 0.09, color: PALETTE.cable });
      } else if (r < 0.56) {
        // ケーブルトレイ(吊り金具2本+トレイ+内部ケーブル線)。
        // 吊り下げ先2.2タイルまで空気が続く場合のみ(狭い通路には出さない)
        let clear = true;
        for (let i = 0; i < 8 && clear; i++) {
          clear = t(x0 + i, wy + 2) !== TILE.SOLID && t(x0 + i, wy + 3) !== TILE.SOLID;
        }
        if (clear) {
          const ty = ly + 1 + 2.2;
          ops.push({ kind: 'line', x1: lx0 + 1, y1: ly + 1, x2: lx0 + 1, y2: ty, w: 0.07, color: PALETTE.hanger });
          ops.push({ kind: 'line', x1: lx0 + 7, y1: ly + 1, x2: lx0 + 7, y2: ty, w: 0.07, color: PALETTE.hanger });
          ops.push({ kind: 'rect', x: lx0, y: ty, w: 8, h: 0.4, color: PALETTE.tray });
          ops.push({ kind: 'line', x1: lx0, y1: ty, x2: lx0 + 8, y2: ty, w: 0.05, color: PALETTE.trayEdge });
          ops.push({ kind: 'line', x1: lx0 + 0.2, y1: ty + 0.28, x2: lx0 + 7.8, y2: ty + 0.28, w: 0.05, color: PALETTE.trayCable });
        }
      } else if (r < 0.68) {
        // 切れて垂れる短いワイヤー(既存コードそのまま。閾値のみ 0.62→0.68)
        const wx0 = lx0 + 1 + Math.floor(hash2(seed + 705, s, wy) * 6);
        const len = 0.8 + hash2(seed + 706, s, wy) * 1.2;
        const bend = 0.25 * (hash2(seed + 707, s, wy) - 0.5);
        ops.push({
          kind: 'poly',
          pts: [wx0, ly + 1, wx0 + bend, ly + 1 + len * 0.6, wx0 + bend * 2.5, ly + 1 + len],
          w: 0.06,
          color: PALETTE.wire,
        });
      }
```

- [ ] **Step 5: 通過確認**

Run: `npx vitest run src/render/decor.test.ts` → PASS
Run: `npm test && npx tsc --noEmit` → 全PASS・クリーン

- [ ] **Step 6: スクショゲート(配管)**

```bash
node scripts/screenshot.mjs --seed=20260711 --pos=200,-1700 --out=screenshots/f5-pipes.png
node scripts/screenshot.mjs --seed=42 --pos=100,-600 --out=screenshots/f5-s42.png
```
mock-realism.png の中央配管と比較: 円筒感(横グラデ)、クランプのリング、壁とのハンガー接続、天井トレイの吊り下げが読めるか。出現頻度が過剰/過少なら 0.16(配管)・0.12幅(トレイ)を微調整。

- [ ] **Step 7: コミット**
```bash
git add src/render/decor.ts src/render/decor.test.ts
git commit -m "feat: 段階F 大径配管(円筒グラデ+クランプ)とケーブルトレイ"
```

---

### Task 6: accent置換の廃止と配管コリドー色の鋼統一

**Files:**
- Modify: `src/render/chunkbake.ts`(ACCENT_SOURCE_COLORS 削除・conduit色変更)

現状、梯子レール・配管などの物理装飾はバイオーム accent(オレンジ等)へ置換されて画面中に暖色を散らしている。モックでは暖色は「錆・灯」だけ。置換を廃止して装飾を鋼色のまま焼き、conduit(配管コリドー)の線は鋼+微量accentに抑える。

- [ ] **Step 1: chunkbake.ts の変更**

1. `ACCENT_SOURCE_COLORS` 定数(22〜26行)を削除し、import 行から `PALETTE` を外す(`import { decorateChunk, type DecorOp } from './decor';`。PALETTE の使用箇所はこの定数のみ)
2. 装飾ループ(170〜173行)を:
```ts
    ctx.lineCap = 'round';
    for (const op of decorateChunk(this.seed, cx, cy)) {
      if (op.surface) continue;
      this.draw(ctx, op);
    }
```
3. conduit 描画(178行)の色を:
```ts
    ctx.strokeStyle = mixHex('#33506a', biome.accent, 0.25);
```
(mixHex は既に import 済みの `./biome` re-export を使用)

- [ ] **Step 2: 通過確認**

Run: `npm test && npx tsc --noEmit && npm run build` → 全PASS・クリーン

- [ ] **Step 3: スクショゲート(色の統一)**

```bash
node scripts/screenshot.mjs --seed=20260711 --out=screenshots/f6-spawn.png
node scripts/screenshot.mjs --seed=20260711 --pos=200,-1700 --out=screenshots/f6-cavern.png
```
確認: 梯子・配管のオレンジが消え、鋼の青灰モノクロームに統一されたか。暖色は錆筋・携行ライト残光・稼働灯のみか。系統の識別が完全に失われていないか(conduitの微量ティント+超構造accentで残るはず)。

- [ ] **Step 4: コミット**
```bash
git add src/render/chunkbake.ts
git commit -m "feat: 段階F 物理装飾のaccent置換を廃止し鋼色へ統一"
```

---

### Task 7: 統合スクショ比較と最終確認

**Files:** なし(検証のみ。微調整が発生した場合は該当ファイル)

- [ ] **Step 1: 全景スクショセット**

```bash
node scripts/screenshot.mjs --seed=20260711 --out=screenshots/f7-spawn.png
node scripts/screenshot.mjs --seed=20260711 --pos=100,-600 --out=screenshots/f7-mid.png
node scripts/screenshot.mjs --seed=20260711 --pos=200,-1700 --out=screenshots/f7-cavern.png
node scripts/screenshot.mjs --seed=42 --out=screenshots/f7-s42.png
node scripts/screenshot.mjs --seed=42 --pos=262344,-1700 --out=screenshots/f7-other-region.png
```
すべて exit 0+`[pageerror]`無し。

- [ ] **Step 2: モック並置の最終判定**

`screenshots/mock-realism.png` と f7-*.png を並べ、モックの5原則で判定:
1. 明度4段の階調(遠=ほぼ黒/中=暗灰/近=中灰/上端=明)になっているか
2. 一貫した光と落ち影(H鋼の下の影・ベイ内上端の影)があるか
3. 荷重を支える接合(ガセット・ボルト列・H鋼フランジ)が読めるか
4. 形に沿った風化(ボルト/エッジから下へ流れる錆)があるか
5. グリーブル3階層(大=躯体/中=配管・トレイ/小=ボルト・グレーチング目)が揃っているか
+ **可読性ゲート**: 歩ける足場が全系統で読めるか(リムライトが際立つか)

不合格項目があれば該当タスクのパラメータ(alpha/輝度/出現率)を微調整して再撮影。

- [ ] **Step 3: 最終確認**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: 全PASS・クリーン・ビルド成功

- [ ] **Step 4: 未コミット変更をコミット**
```bash
git add -A
git commit -m "feat: 段階F realismモック忠実化 統合確認"
```

---

## スコープ外(YAGNI)

- 背景超構造(`megastructure/`)のカタログ改修 — トーン変更(Task 2)で自動的に馴染む範囲まで
- 消失点方向の動的押し出し・本物の3D厚み
- 梯子のケージ化の追加作り込み(既存の背かごを維持)
- 音・セーブ・敵

## 留意

- `physics.ts`・worldgen・当たり判定は無改修。装飾はすべて焼き込みキャンバスのみ(手すり・配管・トレイは非衝突の見た目)
- 決定論: 新装飾はすべて seed+ワールド座標 hash(シード 721〜730)で決まり、チャンク境界で世界座標整列
- 可読性が最優先の不変条件: 「歩ける上面の明リム」だけは常に画面で最も明るい線として維持する(モックの `#7d97ad` 2px が基準)
- 各タスクのスクショゲートで「まだモックに足りない要素」を発見したら、本計画にタスク追記して継続する
