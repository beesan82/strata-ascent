# High-Fidelity Pixel Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the coarse 18-color, roughly 213px-wide render buffer with a deterministic 32-color, roughly 427px-wide high-fidelity pixel pipeline that preserves BLAME!-style structural detail.

**Architecture:** Keep the existing single offscreen `PixelPipeline` and final nearest-neighbor presentation pass. Expand the fixed palette, lower Bayer dither strength, extract the layout calculation as a pure tested function, and double the internal pixels per tile from 6 to 12 without changing world, physics, camera, or layer rendering logic.

**Tech Stack:** TypeScript 5.7, Canvas2D, Vite 6, Vitest 3, Playwright screenshot script.

## Global Constraints

- Preserve the 34-tile horizontal field of view.
- Preserve discrete zoom steps `0.5 / 0.75 / 1`.
- Use a deterministic fixed 32-color palette: 28 cold steel colors followed by 4 warm rust/light accents.
- Use integer nearest-neighbor presentation with `imageSmoothingEnabled = false`.
- Keep camera and shake snapping in internal-pixel units.
- Do not modify world generation, physics, destruction, input, gameplay progression, lighting model, or facility placement.
- Do not introduce new runtime dependencies.
- `npm test`, `npx tsc --noEmit`, and `npm run build` must pass.

---

### Task 1: Expand the fixed palette to 32 colors

**Files:**
- Modify: `src/render/palette.ts`
- Modify: `src/render/palette.test.ts`
- Modify: `src/render/pixel.test.ts`

**Interfaces:**
- Consumes: `relLum(hex: string): number` from `src/render/steel.ts`.
- Produces: `PIXEL_PALETTE: readonly string[]`, `paletteRgb(): Uint8Array`, and the unchanged `nearestIndex(r, g, b, palRgb): number`.

- [ ] **Step 1: Replace the palette cardinality and ramp tests with failing 32-color tests**

In `src/render/palette.test.ts`, update the `PIXEL_PALETTE` suite to:

```ts
describe('PIXEL_PALETTE', () => {
  it('32色(寒色鋼28+暖色4)・重複なし', () => {
    expect(PIXEL_PALETTE.length).toBe(32);
    expect(new Set(PIXEL_PALETTE).size).toBe(32);
  });

  it('寒色鋼ランプ(先頭28)は輝度が単調増加', () => {
    for (let i = 1; i < 28; i++) {
      expect(relLum(PIXEL_PALETTE[i])).toBeGreaterThan(
        relLum(PIXEL_PALETTE[i - 1]),
      );
    }
  });

  it('末尾4色だけが暖色アクセント', () => {
    const warm = PIXEL_PALETTE.slice(28);
    expect(warm).toEqual(['#3d2618', '#5a3a24', '#9a6d32', '#caa64a']);
  });

  it('全色 #rrggbb 形式', () => {
    for (const c of PIXEL_PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
});
```

Update the `paletteRgb` length assertion:

```ts
expect(rgb.length).toBe(32 * 3);
```

Update the white nearest-color assertion:

```ts
it('純白は寒色鋼ランプの最明色(添字27)へ', () => {
  expect(nearestIndex(255, 255, 255, paletteRgb())).toBe(27);
});
```

Update the rust assertion wherever it appears:

```ts
expect(nearestIndex(90, 58, 36, rgb)).toBe(29);
```

- [ ] **Step 2: Run the palette tests and verify the old 18-color implementation fails**

Run:

```bash
npx vitest run src/render/palette.test.ts
```

Expected: FAIL because the palette has 18 colors, `paletteRgb()` has 54 entries, and the warm colors do not match the four-color contract.

- [ ] **Step 3: Replace `PIXEL_PALETTE` with the fixed 32-color palette**

In `src/render/palette.ts`, replace only the `PIXEL_PALETTE` definition and its comment:

```ts
/**
 * 高精細ドット絵の固定32色パレット。
 * 先頭28=寒色鋼ランプ(暗→明)、末尾4=錆・稼働灯の暖色アクセント。
 */
export const PIXEL_PALETTE: readonly string[] = [
  '#020408', '#03050a', '#04070c', '#05090f',
  '#070c12', '#091017', '#0a121a', '#0d141c',
  '#10171f', '#131b24', '#16202b', '#192633',
  '#1c3040', '#203446', '#22384a', '#263d51',
  '#2a4258', '#2f4961', '#33506a', '#39536c',
  '#3d566e', '#456078', '#4a6a84', '#53738c',
  '#5f7d94', '#6d899f', '#7d97ad', '#c7d0ce',
  '#3d2618', '#5a3a24', '#9a6d32', '#caa64a',
];
```

Do not change `paletteRgb()` or `nearestIndex()`; they already derive their behavior from the palette length.

- [ ] **Step 4: Run focused and full logic verification**

Run:

```bash
npx vitest run src/render/palette.test.ts src/render/pixel.test.ts
npx tsc --noEmit
```

Expected: all focused tests PASS and TypeScript reports no errors.

- [ ] **Step 5: Commit the palette change**

```bash
git add src/render/palette.ts src/render/palette.test.ts src/render/pixel.test.ts
git commit -m "feat: expand pixel palette to 32 colors"
```

---

### Task 2: Make high-fidelity buffer layout pure and testable

**Files:**
- Modify: `src/render/pixel.ts`
- Modify: `src/render/pixel.test.ts`

**Interfaces:**
- Consumes: positive screen dimensions, target horizontal tile count, and internal pixels per tile.
- Produces: `PixelLayout`, `computePixelLayout(screenW, screenH, targetTilesX, tilePx): PixelLayout`, `HIGH_FIDELITY_TILE_PX`, and `DITHER_STRENGTH`.

- [ ] **Step 1: Add failing tests for high-fidelity constants and layout**

Extend the import in `src/render/pixel.test.ts`:

```ts
import {
  computePixelLayout,
  DITHER_STRENGTH,
  HIGH_FIDELITY_TILE_PX,
  quantizeRgba,
} from './pixel';
```

Add:

```ts
describe('high-fidelity pixel layout', () => {
  it('uses 12 internal pixels per tile and weak dither', () => {
    expect(HIGH_FIDELITY_TILE_PX).toBe(12);
    expect(DITHER_STRENGTH).toBe(12);
  });

  it('1280x720 with 34 tiles produces a roughly 427px buffer at 3x', () => {
    expect(computePixelLayout(1280, 720, 34, 12)).toEqual({
      bufW: 427,
      bufH: 240,
      scale: 3,
    });
  });

  it('keeps minimum dimensions for a tiny screen', () => {
    expect(computePixelLayout(100, 50, 34, 12)).toEqual({
      bufW: 160,
      bufH: 90,
      scale: 1,
    });
  });
});
```

- [ ] **Step 2: Run the focused test and verify missing exports fail**

Run:

```bash
npx vitest run src/render/pixel.test.ts
```

Expected: FAIL because `computePixelLayout` and `HIGH_FIDELITY_TILE_PX` do not exist and `DITHER_STRENGTH` is still 32.

- [ ] **Step 3: Add the pure layout function and high-fidelity constants**

In `src/render/pixel.ts`, replace the existing dither constant and add the layout definitions immediately above `PixelPipeline`:

```ts
/** 高精細ピクセル表示の1タイルあたり内部ピクセル数。 */
export const HIGH_FIDELITY_TILE_PX = 12;

/** 色帯だけを散らし、構造面を市松模様で覆わない弱いディザ強度。 */
export const DITHER_STRENGTH = 12;

export interface PixelLayout {
  bufW: number;
  bufH: number;
  scale: number;
}

/** 画面寸法から整数拡大率と内部バッファ寸法を決める純関数。 */
export function computePixelLayout(
  screenW: number,
  screenH: number,
  targetTilesX: number,
  tilePx: number,
): PixelLayout {
  const targetBufW = targetTilesX * tilePx;
  const scale = Math.max(1, Math.round(screenW / targetBufW));
  return {
    scale,
    bufW: Math.max(160, Math.round(screenW / scale)),
    bufH: Math.max(90, Math.round(screenH / scale)),
  };
}
```

Replace the body of `PixelPipeline.resize()` with:

```ts
const layout = computePixelLayout(screenW, screenH, this.targetTilesX, this.tilePx);
this.scale = layout.scale;
this.bufW = layout.bufW;
this.bufH = layout.bufH;
this.buffer.width = this.bufW;
this.buffer.height = this.bufH;
this.bctx.imageSmoothingEnabled = false;
```

- [ ] **Step 4: Run the focused tests**

Run:

```bash
npx vitest run src/render/pixel.test.ts src/render/dither.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Run full automated verification**

Run:

```bash
npm test
npx tsc --noEmit
npm run build
```

Expected: all tests PASS, TypeScript reports no errors, and Vite builds successfully.

- [ ] **Step 6: Commit the layout and dither change**

```bash
git add src/render/pixel.ts src/render/pixel.test.ts
git commit -m "feat: raise pixel buffer density and soften dither"
```

---

### Task 3: Integrate 12-pixel tiles and validate structural detail

**Files:**
- Modify: `src/render/renderer.ts`
- Generate, ignored by Git: `screenshots/hifi-*.png`

**Interfaces:**
- Consumes: `HIGH_FIDELITY_TILE_PX` from `src/render/pixel.ts`.
- Produces: a `Renderer` configured for a 34-tile field of view at 12 internal pixels per tile.

- [ ] **Step 1: Wire the high-fidelity density constant into `Renderer`**

Change the pixel import in `src/render/renderer.ts`:

```ts
import { HIGH_FIDELITY_TILE_PX, PixelPipeline } from './pixel';
```

Change pipeline construction:

```ts
this.pipeline = new PixelPipeline(
  paletteRgb(),
  VIEW_TILES_X,
  HIGH_FIDELITY_TILE_PX,
);
```

Do not change `VIEW_TILES_X`, discrete zoom, render-camera snapping, mouse conversion, or presentation order.

- [ ] **Step 2: Run automated verification before visual tuning**

Run:

```bash
npm test
npx tsc --noEmit
npm run build
```

Expected: all tests PASS, TypeScript reports no errors, and Vite builds successfully.

- [ ] **Step 3: Capture the four structural-detail gates**

Run:

```bash
node scripts/screenshot.mjs --seed=20260711 --out=screenshots/hifi-spawn.png
node scripts/screenshot.mjs --seed=20260711 --pos=100,-600 --out=screenshots/hifi-mid.png
node scripts/screenshot.mjs --seed=20260711 --pos=200,-1700 --out=screenshots/hifi-cavern.png
node scripts/screenshot.mjs --seed=42 --pos=262344,-1700 --out=screenshots/hifi-water.png
```

Expected: every command exits 0 with no `[pageerror]` or console error.

- [ ] **Step 4: Inspect screenshots against explicit acceptance criteria**

Open all four images and confirm:

1. thin beams, pipes, ladders, and platform edges remain at least 1–2 internal pixels wide;
2. foreground, middle-distance, and far structures can be distinguished in cavern and water scenes;
3. broad surfaces are not dominated by a checkerboard pattern;
4. rust and operational lights remain warm;
5. the HUD is readable;
6. no black seams appear between baked chunks.

If broad surfaces are still checkerboard-dominated, change only `DITHER_STRENGTH` in `src/render/pixel.ts` within the approved range `8`, `10`, `12`, `14`, or `16`, rerun `src/render/pixel.test.ts` after updating its exact-value assertion, and recapture all four screenshots. Choose the highest value that does not obscure structural edges.

- [ ] **Step 5: Verify motion, zoom, and shake in the browser**

Run:

```bash
npm run dev
```

At `http://localhost:5173/?seed=20260711`, walk horizontally, climb, enter a more open area, aim, charge, and fire once. Confirm:

- camera motion advances on the internal pixel grid without blur;
- zoom transitions only among `0.5`, `0.75`, and `1`;
- firing shake remains visible but does not smear the scene;
- mouse aim matches the cursor;
- movement and collision behavior are unchanged.

- [ ] **Step 6: Commit renderer integration and any approved dither adjustment**

```bash
git add src/render/renderer.ts src/render/pixel.ts src/render/pixel.test.ts
git commit -m "feat: render high-fidelity pixel structures"
```

---

### Task 4: Final regression and handoff

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: completed 32-color high-fidelity pipeline.
- Produces: verified branch ready for integration.

- [ ] **Step 1: Run fresh final verification**

Run:

```bash
npm test
npx tsc --noEmit
npm run build
```

Expected: all tests PASS, TypeScript reports no errors, and Vite builds successfully.

- [ ] **Step 2: Confirm repository scope**

Run:

```bash
git status --short
git diff --check
git log --oneline -5
```

Expected: no tracked uncommitted changes, no whitespace errors, and the palette, layout/dither, and renderer commits appear in recent history. Existing unrelated untracked `.kiro/`, `docs/handoff/`, and `pnpm-lock.yaml` remain untouched.

- [ ] **Step 3: Request final code review**

Review the complete diff from commit `2aefad0` through the implementation HEAD against:

- `docs/superpowers/specs/2026-08-05-high-fidelity-pixel-pipeline-design.md`
- the screenshot acceptance criteria in Task 3
- regression risk in palette indices, buffer sizing, camera snapping, and presentation scaling

Fix all Critical and Important findings, then rerun Step 1.

- [ ] **Step 4: Finish the development branch**

Use `superpowers:finishing-a-development-branch` to offer local merge, push/PR, or branch preservation.
