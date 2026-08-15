# Frequent Distinct Biomes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make major visual and terrain biomes change every 300–450 vertical tiles and remain clearly distinguishable by color, background, lighting, floor layout, structural density, and cavity scale.

**Architecture:** Move signed-Y biome-cell selection into a world-level shared module so rendering and world generation consume one deterministic result without a `world -> render` dependency. Attach a validated terrain profile to each biome ID, use that profile in base terrain generation, and keep facilities/networks as overlays. Preserve fixed-seed behavior and continuous render blending while terrain switches discretely at cell boundaries.

**Tech Stack:** TypeScript 5.7, Canvas 2D, Vitest 3, Vite 6, Playwright screenshot script

## Global Constraints

- Cell boundary formula is `n * 375 + jitter(seed, n)` with integer jitter from -75 through +75.
- Every cell width is between 300 and 450 tiles.
- Render blending spans 50 tiles on each side of a boundary.
- Positive and negative Y use the same signed algorithm and are not `abs(y)` mirrors.
- Adjacent cells never select the same biome.
- The five biome identities remain cold steel, habitation echo, disposal sediment, water void, and power anomaly.
- Disposal sediment has the highest floor-gap chance.
- Water void has the lowest structural density and highest cavity density.
- Terrain parameters switch at boundaries; floor periods are not interpolated per tile.
- Rendering and world generation consume the same biome-cell selection functions.
- Undefined biome IDs fall back to cold steel and its standard terrain profile.
- Keep default seed `20260711`; only `?seed=<number>` overrides it.
- Do not change facilities, destruction, physics, weapons, or player rendering.
- Add no runtime dependency.

## File Structure

- Create `src/world/biomeCells.ts`: shared biome IDs, signed cell boundaries, cell lookup, and deterministic selection.
- Create `src/world/biomeCells.test.ts`: shared selector contracts.
- Modify `src/render/biome.ts`: visual definitions keyed by shared biome ID; 50-tile blending.
- Modify `src/render/biome.test.ts`: adapt to shared selector and preserve visual blend tests.
- Create `src/world/biomeTerrain.ts`: five terrain profiles and fallback lookup.
- Create `src/world/biomeTerrain.test.ts`: value ranges and differentiating-order contracts.
- Modify `src/world/worldgen.ts`: generate base terrain from the shared biome ID/profile and use continuous ladder shafts.
- Modify `src/world/worldgen.test.ts`: per-biome terrain statistics and boundary connectivity.
- Modify `src/render/chunkbake.test.ts`: update boundary fixtures for the shorter cell scale.
- Modify `scripts/screenshot.mjs` only if deterministic biome-center capture needs a read-only diagnostic option; preserve existing CLI behavior.

---

### Task 1: Shared Short Biome-Cell Selector

**Files:**
- Create: `src/world/biomeCells.ts`
- Create: `src/world/biomeCells.test.ts`
- Modify: `src/render/biome.ts`
- Modify: `src/render/biome.test.ts`
- Modify: `src/render/chunkbake.test.ts`

**Interfaces:**
- Consumes: numeric seed and signed world Y.
- Produces: `BiomeId`, `BIOME_IDS`, `BIOME_CELL_BASE`, `BIOME_CELL_JITTER`, `BIOME_BLEND_HALF_WIDTH`, `biomeBoundary`, `biomeCellAt`, and `biomeIdForCell`.

- [ ] **Step 1: Write failing shared-selector tests**

Create `src/world/biomeCells.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  BIOME_BLEND_HALF_WIDTH,
  BIOME_CELL_BASE,
  BIOME_CELL_JITTER,
  biomeBoundary,
  biomeCellAt,
  biomeIdForCell,
} from './biomeCells';

describe('short signed biome cells', () => {
  it('uses the approved sizing constants', () => {
    expect(BIOME_CELL_BASE).toBe(375);
    expect(BIOME_CELL_JITTER).toBe(75);
    expect(BIOME_BLEND_HALF_WIDTH).toBe(50);
  });

  it('keeps widths between 300 and 450 tiles', () => {
    for (const seed of [1, 42, 20260711]) {
      for (let cell = -100; cell <= 100; cell++) {
        const width = biomeBoundary(seed, cell + 1) - biomeBoundary(seed, cell);
        expect(width).toBeGreaterThanOrEqual(300);
        expect(width).toBeLessThanOrEqual(450);
      }
    }
  });

  it('is deterministic, non-repeating, and not mirrored', () => {
    for (const seed of [1, 42, 20260711]) {
      for (let cell = -100; cell < 100; cell++) {
        expect(biomeIdForCell(seed, cell)).toBe(biomeIdForCell(seed, cell));
        expect(biomeIdForCell(seed, cell)).not.toBe(biomeIdForCell(seed, cell + 1));
      }
      const positive = Array.from({ length: 20 }, (_, i) => biomeIdForCell(seed, i + 1));
      const negative = Array.from({ length: 20 }, (_, i) => biomeIdForCell(seed, -i - 1));
      expect(positive).not.toEqual(negative);
    }
  });

  it('resolves coordinates on both sides of every sampled boundary', () => {
    for (let cell = -20; cell <= 20; cell++) {
      const edge = biomeBoundary(20260711, cell);
      expect(biomeCellAt(20260711, edge - 1)).toBe(cell - 1);
      expect(biomeCellAt(20260711, edge)).toBe(cell);
    }
  });
});
```

- [ ] **Step 2: Run the new test and verify the module is missing**

Run: `npm test -- src/world/biomeCells.test.ts`

Expected: FAIL because `src/world/biomeCells.ts` does not exist.

- [ ] **Step 3: Implement the shared selector**

Create `src/world/biomeCells.ts` by moving the existing signed-hash, boundary, cell lookup, and parity-pool selection out of `src/render/biome.ts`. Use these exact exports:

```ts
export const BIOME_IDS = ['coldSteel', 'habitation', 'disposal', 'waterVoid', 'power'] as const;
export type BiomeId = (typeof BIOME_IDS)[number];

export const BIOME_CELL_BASE = 375;
export const BIOME_CELL_JITTER = 75;
export const BIOME_BLEND_HALF_WIDTH = 50;

const EVEN_POOL: readonly BiomeId[] = ['coldSteel', 'habitation'];
const ODD_POOL: readonly BiomeId[] = ['disposal', 'waterVoid', 'power'];
```

Retain the current signed 32-bit hash structure, changing only the constants and return type. `biomeIdForCell` selects from disjoint parity pools, normalizing negative remainder. `biomeCellAt` checks the guessed cell and adjacent jittered boundaries without cumulative traversal.

- [ ] **Step 4: Rewire rendering to the shared selector**

In `src/render/biome.ts`:

```ts
import {
  BIOME_BLEND_HALF_WIDTH,
  biomeBoundary,
  biomeCellAt,
  biomeIdForCell,
  type BiomeId,
} from '../world/biomeCells';
export { BIOME_BLEND_HALF_WIDTH, biomeBoundary, biomeCellAt } from '../world/biomeCells';
```

Create a `VISUAL_BIOME: Record<BiomeId, Biome>` mapping. Keep `BIOMES` as a stable ordered compatibility array derived from `BIOME_IDS`. Implement `biomeForCell` as `VISUAL_BIOME[biomeIdForCell(seed, cell)] ?? VISUAL_BIOME.coldSteel`. Remove duplicate cell constants and hashing from the render module.

- [ ] **Step 5: Update render and chunk-bake tests**

Import shared constants from `../world/biomeCells` in tests. Keep assertions that ambient color, palette, accent, and background transition continuously at `edge - 50`, `edge`, and `edge + 50`. Update hard-coded sample distances that assumed a 1,500-tile cell.

- [ ] **Step 6: Run shared and render tests**

Run: `npm test -- src/world/biomeCells.test.ts src/render/biome.test.ts src/render/background.test.ts src/render/chunkbake.test.ts src/render/renderer.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the shared short-cell selector**

```powershell
git add src/world/biomeCells.ts src/world/biomeCells.test.ts src/render/biome.ts src/render/biome.test.ts src/render/chunkbake.test.ts
git commit -m "feat: shorten shared biome cells"
```

### Task 2: Biome Terrain Profiles

**Files:**
- Create: `src/world/biomeTerrain.ts`
- Create: `src/world/biomeTerrain.test.ts`

**Interfaces:**
- Consumes: `BiomeId` from `src/world/biomeCells.ts`.
- Produces: `TerrainProfile`, `TERRAIN_PROFILE`, and `terrainProfileFor`.

- [ ] **Step 1: Write failing profile-contract tests**

```ts
import { describe, expect, it } from 'vitest';
import { BIOME_IDS } from './biomeCells';
import { TERRAIN_PROFILE, terrainProfileFor } from './biomeTerrain';

describe('biome terrain profiles', () => {
  it('defines a valid profile for every biome', () => {
    for (const id of BIOME_IDS) {
      const p = terrainProfileFor(id);
      expect(p.floorSpacing).toBeGreaterThanOrEqual(6);
      expect(p.floorSpacing).toBeLessThanOrEqual(14);
      expect(p.gapChance).toBeGreaterThanOrEqual(0);
      expect(p.gapChance).toBeLessThanOrEqual(1);
      expect(p.massThreshold).toBeGreaterThan(0);
      expect(p.massThreshold).toBeLessThan(1);
      expect(p.cavityThreshold).toBeGreaterThan(0);
      expect(p.cavityThreshold).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the approved differentiating order', () => {
    expect(TERRAIN_PROFILE.disposal.gapChance).toBeGreaterThan(
      Math.max(...BIOME_IDS.filter((id) => id !== 'disposal').map((id) => TERRAIN_PROFILE[id].gapChance)),
    );
    expect(TERRAIN_PROFILE.waterVoid.massThreshold).toBeGreaterThan(
      Math.max(...BIOME_IDS.filter((id) => id !== 'waterVoid').map((id) => TERRAIN_PROFILE[id].massThreshold)),
    );
    expect(TERRAIN_PROFILE.waterVoid.cavityThreshold).toBeLessThan(
      Math.min(...BIOME_IDS.filter((id) => id !== 'waterVoid').map((id) => TERRAIN_PROFILE[id].cavityThreshold)),
    );
  });

  it('falls back to cold steel', () => {
    expect(terrainProfileFor('invalid' as never)).toBe(TERRAIN_PROFILE.coldSteel);
  });
});
```

- [ ] **Step 2: Run the focused test and verify the module is missing**

Run: `npm test -- src/world/biomeTerrain.test.ts`

Expected: FAIL because `biomeTerrain.ts` does not exist.

- [ ] **Step 3: Implement the five profiles**

```ts
import type { BiomeId } from './biomeCells';

export interface TerrainProfile {
  floorSpacing: number;
  gapChance: number;
  massThreshold: number;
  cavityThreshold: number;
}

export const TERRAIN_PROFILE: Record<BiomeId, TerrainProfile> = {
  coldSteel:   { floorSpacing: 8,  gapChance: 0.18, massThreshold: 0.55, cavityThreshold: 0.84 },
  habitation:  { floorSpacing: 6,  gapChance: 0.12, massThreshold: 0.48, cavityThreshold: 0.90 },
  disposal:    { floorSpacing: 10, gapChance: 0.48, massThreshold: 0.61, cavityThreshold: 0.74 },
  waterVoid:   { floorSpacing: 14, gapChance: 0.32, massThreshold: 0.72, cavityThreshold: 0.56 },
  power:       { floorSpacing: 9,  gapChance: 0.28, massThreshold: 0.58, cavityThreshold: 0.70 },
};

export function terrainProfileFor(id: BiomeId): TerrainProfile {
  return TERRAIN_PROFILE[id] ?? TERRAIN_PROFILE.coldSteel;
}
```

Here, a higher `massThreshold` means lower structural density, and a lower `cavityThreshold` means higher cavity density; tests encode those semantics.

- [ ] **Step 4: Run profile tests**

Run: `npm test -- src/world/biomeTerrain.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit terrain profiles**

```powershell
git add src/world/biomeTerrain.ts src/world/biomeTerrain.test.ts
git commit -m "feat: define distinct biome terrain profiles"
```

### Task 3: Generate Terrain from the Shared Biome

**Files:**
- Modify: `src/world/worldgen.ts`
- Modify: `src/world/worldgen.test.ts`
- Modify: `src/world/strata.ts` only to remove stale ownership comments; keep exports for decoration compatibility.

**Interfaces:**
- Consumes: `biomeCellAt(seed, y)`, `biomeIdForCell(seed, cell)`, and `terrainProfileFor(id)`.
- Produces: existing `noiseTileAt`, `tileAt`, and `generateChunk` behavior with biome-driven base terrain.

- [ ] **Step 1: Write failing per-biome terrain tests**

Add a helper in `src/world/worldgen.test.ts` that finds one cell of each biome within cells `-100..100`, samples a 256×256 region around its center with `noiseTileAt`, and returns counts for `AIR`, `SOLID`, and `LADDER` plus floor-row occupancy.

```ts
it('produces measurably distinct terrain for all five biomes', () => {
  const stats = sampleAllBiomeCenters(20260711);
  expect(stats.waterVoid.airRatio).toBeGreaterThan(stats.coldSteel.airRatio);
  expect(stats.waterVoid.airRatio).toBeGreaterThan(stats.habitation.airRatio);
  expect(stats.habitation.solidRatio).toBeGreaterThan(stats.waterVoid.solidRatio);
  expect(stats.disposal.floorGapRatio).toBeGreaterThan(stats.coldSteel.floorGapRatio);
  for (const id of BIOME_IDS) {
    expect(stats[id].air).toBeGreaterThan(0);
    expect(stats[id].solid).toBeGreaterThan(0);
    expect(stats[id].ladder).toBeGreaterThan(0);
  }
});
```

- [ ] **Step 2: Add a failing continuous-shaft test**

```ts
it('keeps at least one deterministic ladder shaft continuous across biome boundaries', () => {
  for (let cell = -10; cell <= 10; cell++) {
    const edge = biomeBoundary(20260711, cell);
    const ladderColumns = Array.from({ length: 96 }, (_, x) => x).filter((x) =>
      Array.from({ length: 25 }, (_, dy) => noiseTileAt(20260711, x, edge - 12 + dy))
        .every((tile) => tile === TILE.LADDER),
    );
    expect(ladderColumns.length).toBeGreaterThan(0);
  }
});
```

- [ ] **Step 3: Run worldgen tests and verify current strata-driven behavior fails**

Run: `npm test -- src/world/worldgen.test.ts`

Expected: FAIL because `noiseTileAt` still consumes `stratumAt` and ladder columns change by floor band.

- [ ] **Step 4: Use the shared biome terrain profile**

At the start of `noiseTileAt`:

```ts
const cell = biomeCellAt(seed, y);
const biomeId = biomeIdForCell(seed, cell);
const profile = terrainProfileFor(biomeId);
```

Replace every use of `s.floorSpacing`, `s.gapChance`, `s.massThreshold`, and `s.cavityThreshold` with `profile.*`. Keep noise scales, overlay precedence, and deterministic hashing unchanged.

- [ ] **Step 5: Make ladder shafts independent of floor and biome bands**

Use one deterministic ladder column per 32-tile horizontal group:

```ts
const group = Math.floor(x / 32);
const ladderX = group * 32 + Math.floor(hash2(seed + 404, group, 0) * 32);
if (x === ladderX) return TILE.LADDER;
```

This produces continuous vertical escape shafts through every biome boundary while remaining independent of chunk generation order.

- [ ] **Step 6: Update obsolete strata-based tests and comments**

Remove expectations that base terrain follows `stratumAt`. Keep `strata.ts` and its unit tests if `render/decor.ts` still consumes signed stratum indices; document that strata now drive decorative cadence only, not base terrain.

- [ ] **Step 7: Run world and dependent tests**

Run: `npm test -- src/world/biomeCells.test.ts src/world/biomeTerrain.test.ts src/world/worldgen.test.ts src/world/chunks.test.ts src/entities/player.test.ts src/render/decor.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit biome-driven terrain generation**

```powershell
git add src/world/worldgen.ts src/world/worldgen.test.ts src/world/strata.ts
git commit -m "feat: drive terrain from visual biomes"
```

### Task 4: Visual Differentiation and Final Verification

**Files:**
- Modify: `src/render/biome.ts` only if screenshot evidence requires stronger visual separation within the approved identities.
- Modify: `src/render/biome.test.ts` for any changed palette/background contracts.
- Modify: `scripts/screenshot.mjs` only if needed for deterministic diagnostics without changing existing arguments.

**Interfaces:**
- Consumes: completed shared cells and biome-driven terrain.
- Produces: visually verified frequent distinct biomes.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`

Expected: all tests PASS. Ensure stale `.worktrees/` content is absent or excluded so tests are not silently duplicated.

- [ ] **Step 2: Run type checking and production build**

Run: `npx tsc --noEmit`

Expected: exit code 0.

Run: `npm run build`

Expected: exit code 0.

- [ ] **Step 3: Find deterministic centers for all five biomes**

Use `biomeIdForCell(20260711, cell)` over `-100..100`, choose the first cell for each ID, then calculate:

```ts
centerY = Math.floor((biomeBoundary(seed, cell) + biomeBoundary(seed, cell + 1)) / 2);
```

Record the five `(BiomeId, cell, centerY)` fixtures in the verification report; do not hard-code guessed positions.

- [ ] **Step 4: Capture and inspect five biome centers**

For every recorded center:

```powershell
node scripts/screenshot.mjs --seed=20260711 --pos=8,<centerY> --freeze=true --out=screenshots/biome-<id>.png
```

Inspect all five PNGs. Each neighboring comparison must differ in at least three of: palette, background structure, fog/lighting, floor spacing, cavity scale. Screenshots remain ignored and uncommitted.

- [ ] **Step 5: Capture two real boundaries**

For two consecutive boundaries calculated with `biomeBoundary`, capture `edge-51`, `edge`, and `edge+51`. Confirm continuous color/background blending inside the ±50 band, clear identity outside it, no full-screen pop, and a continuous ladder shaft.

- [ ] **Step 6: Tune only when evidence fails the acceptance rule**

If a pair differs in fewer than three required channels, adjust only its `ambientColor`, `ambientLevel`, `accent`, `bgLayers`, or existing terrain profile values while preserving the fixed ordering constraints. Add or update a direct test for every tuned numeric relationship, rerun focused tests, and recapture the affected scenes.

- [ ] **Step 7: Verify fixed seed and unchanged subsystems**

Confirm `src/main.ts` still contains `const DEFAULT_SEED = 20260711` and URL-only override logic. Run facility, destruction, physics, graviton, and player tests explicitly:

```powershell
npm test -- src/world/facility.test.ts src/world/destruction.test.ts src/entities/physics.test.ts src/entities/graviton.test.ts src/entities/player.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit evidence-driven tuning only if files changed**

```powershell
git add src/render/biome.ts src/render/biome.test.ts scripts/screenshot.mjs
git commit -m "fix: strengthen biome visual separation"
```

Do not create an empty commit when verification requires no tuning.

