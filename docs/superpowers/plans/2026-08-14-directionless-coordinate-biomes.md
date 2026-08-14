# Directionless Coordinate Biomes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make terrain and visual biomes change deterministically in both Y directions without implying that either direction is brighter, darker, safer, older, or more ruined.

**Architecture:** Keep the existing region hierarchy for facilities, but resolve visual biomes from a new jittered one-dimensional Y cell function. Resolve terrain strata from signed 500-tile bands, and remove remaining altitude-only visual bias. Preserve existing renderer-facing `BiomeBlend` and world-generation entry points where practical.

**Tech Stack:** TypeScript 5.7, Canvas 2D, Vitest 3, Vite 6

## Global Constraints

- Visual-cell boundaries use `n * 1500 + jitter(seed, n)`, where jitter is an integer from -150 through +150.
- Visual-cell widths therefore remain between 1,200 and 1,800 tiles.
- Blend across 200 tiles on each side of a visual-cell boundary.
- Terrain strata change every 500 tiles in both signed Y directions.
- Positive and negative cells use the same algorithm but must not be mirror copies based on absolute Y.
- Do not change facility placement, destruction, physics, or weapon behavior.
- Undefined biome selection falls back to the existing cold-steel biome `BIOMES[0]`.
- HUD copy must show signed `座標 Y`, not clamped altitude.
- No new runtime dependency.

## File Structure

- Modify `src/render/biome.ts`: visual-cell boundaries, deterministic biome selection, and blend output.
- Modify `src/render/biome.test.ts`: cell-width, determinism, non-repetition, fallback, and continuity tests.
- Modify `src/world/strata.ts`: signed band indexing and seeded stratum selection.
- Modify `src/world/strata.test.ts`: positive/negative band and deterministic-selection tests.
- Modify `src/world/worldgen.ts`: pass the world seed into stratum selection.
- Modify `src/world/worldgen.test.ts`: update stratum calls and cover positive-Y boundaries.
- Modify `src/render/megastructure/place.ts`: remove one-way altitude damage bias.
- Modify `src/render/megastructure/place.test.ts`: assert directionless, bounded deterministic damage.
- Create `src/core/coordinate.ts`: pure signed-Y HUD conversion.
- Create `src/core/coordinate.test.ts`: signed coordinate tests.
- Modify `src/main.ts`: display signed Y coordinate.

---

### Task 1: Jittered Visual-Biome Cells and Smooth Blending

**Files:**
- Modify: `src/render/biome.ts`
- Modify: `src/render/biome.test.ts`
- Test: `src/render/biome.test.ts`

**Interfaces:**
- Consumes: existing `BIOMES`, `Biome`, `BiomeBlend`, `mixHex`, and `hash2(seed, x, y)`.
- Produces: `biomeBoundary(seed: number, cell: number): number`, `biomeCellAt(seed: number, y: number): number`, `biomeForCell(seed: number, cell: number): Biome`, and existing `biomeBlend(seed, x, y): BiomeBlend` with nontrivial `from`, `to`, and `t`.

- [ ] **Step 1: Replace region-based tests with failing coordinate-cell tests**

```ts
import {
  BIOMES, biomeAt, biomeBlend, biomeBoundary, biomeCellAt,
  biomeForCell, mixHex, SYSTEM_BIOME,
} from './biome';

describe('visual biome cells', () => {
  it('keeps every jittered cell between 1200 and 1800 tiles', () => {
    for (let cell = -50; cell < 50; cell++) {
      const width = biomeBoundary(42, cell + 1) - biomeBoundary(42, cell);
      expect(width).toBeGreaterThanOrEqual(1200);
      expect(width).toBeLessThanOrEqual(1800);
    }
  });

  it('resolves signed cells independently and deterministically', () => {
    expect(biomeCellAt(42, 2400)).toBe(biomeCellAt(42, 2400));
    expect(biomeForCell(42, 2)).not.toBe(biomeForCell(42, 1));
    expect(biomeForCell(42, -2)).not.toBe(biomeForCell(42, -1));
    const positive = Array.from({ length: 12 }, (_, i) => biomeForCell(42, i + 1).name);
    const negative = Array.from({ length: 12 }, (_, i) => biomeForCell(42, -i - 1).name);
    expect(positive).not.toEqual(negative);
  });

  it('blends continuously through a 400-tile transition band', () => {
    const edge = biomeBoundary(42, 3);
    const before = biomeBlend(42, 0, edge - 200);
    const middle = biomeBlend(42, 0, edge);
    const after = biomeBlend(42, 0, edge + 200);
    expect(before.t).toBeCloseTo(0);
    expect(middle.t).toBeCloseTo(0.5);
    expect(after.t).toBeCloseTo(0);
    expect(middle.from).not.toBe(middle.to);
  });

  it('returns the same value for the same seed and coordinate', () => {
    expect(biomeBlend(77, 12, -3456)).toEqual(biomeBlend(77, 12, -3456));
    expect(biomeAt(77, 12, -3456)).toBe(biomeAt(77, 12, -3456));
  });
});
```

- [ ] **Step 2: Run the focused test and verify the new exports are missing**

Run: `npm test -- src/render/biome.test.ts`

Expected: FAIL because `biomeBoundary`, `biomeCellAt`, and `biomeForCell` are not exported and region-based blend expectations no longer match.

- [ ] **Step 3: Implement boundary lookup and deterministic non-repeating selection**

```ts
import { hash2 } from '../world/noise';

export const BIOME_CELL_BASE = 1500;
export const BIOME_CELL_JITTER = 150;
export const BIOME_BLEND_HALF_WIDTH = 200;

const signedHash = (seed: number, cell: number, salt: number): number =>
  hash2(seed + salt, cell, cell < 0 ? -1 : 1);

export function biomeBoundary(seed: number, cell: number): number {
  const jitter = Math.round((signedHash(seed, cell, 701) * 2 - 1) * BIOME_CELL_JITTER);
  return cell * BIOME_CELL_BASE + jitter;
}

export function biomeCellAt(seed: number, y: number): number {
  const guess = Math.floor(y / BIOME_CELL_BASE);
  for (let cell = guess - 1; cell <= guess + 1; cell++) {
    if (y >= biomeBoundary(seed, cell) && y < biomeBoundary(seed, cell + 1)) return cell;
  }
  return guess;
}

export function biomeForCell(seed: number, cell: number): Biome {
  const evenPool = [0, 1];
  const oddPool = [2, 3, 4];
  const pool = ((cell % 2) + 2) % 2 === 0 ? evenPool : oddPool;
  const index = pool[Math.floor(signedHash(seed, cell, 709) * pool.length) % pool.length];
  return BIOMES[index] ?? BIOMES[0];
}
```

The disjoint even/odd pools guarantee that adjacent cells differ without recursion. Add a test over cells `-100..100` proving `biomeForCell(seed, n) !== biomeForCell(seed, n - 1)`.

- [ ] **Step 4: Implement the 400-tile blend window**

```ts
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export function biomeAt(seed: number, _x: number, y: number): Biome {
  return biomeForCell(seed, biomeCellAt(seed, y));
}

export function biomeBlend(seed: number, _x: number, y: number): BiomeBlend {
  const cell = biomeCellAt(seed, y);
  const left = biomeBoundary(seed, cell);
  const right = biomeBoundary(seed, cell + 1);
  const nearestIsLeft = y - left < right - y;
  const edge = nearestIsLeft ? left : right;
  const fromCell = nearestIsLeft ? cell - 1 : cell;
  const toCell = fromCell + 1;
  const distance = y - edge;
  if (Math.abs(distance) >= BIOME_BLEND_HALF_WIDTH) {
    const biome = biomeForCell(seed, cell);
    return { from: biome, to: biome, t: 0, ambientLevel: biome.ambientLevel, ambientColor: biome.ambientColor };
  }
  const from = biomeForCell(seed, fromCell);
  const to = biomeForCell(seed, toCell);
  const t = clamp01((distance + BIOME_BLEND_HALF_WIDTH) / (BIOME_BLEND_HALF_WIDTH * 2));
  return {
    from, to, t,
    ambientLevel: from.ambientLevel + (to.ambientLevel - from.ambientLevel) * t,
    ambientColor: mixHex(from.ambientColor, to.ambientColor, t),
  };
}
```

Update the test at `edge + 200` to assert the resolved single biome is the right-hand biome; `t` returns to zero outside transitions by the existing `BiomeBlend` contract.

- [ ] **Step 5: Run biome tests and the full renderer-adjacent suite**

Run: `npm test -- src/render/biome.test.ts src/render/background.test.ts src/render/renderer.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the visual-cell implementation**

```powershell
git add src/render/biome.ts src/render/biome.test.ts
git commit -m "feat: add directionless visual biome cells"
```

### Task 2: Signed Seeded Terrain Strata

**Files:**
- Modify: `src/world/strata.ts`
- Modify: `src/world/strata.test.ts`
- Modify: `src/world/worldgen.ts`
- Modify: `src/world/worldgen.test.ts`
- Test: `src/world/strata.test.ts`
- Test: `src/world/worldgen.test.ts`

**Interfaces:**
- Consumes: `hash2(seed, x, y)` and existing `STRATA` parameter objects.
- Produces: `stratumIndexAt(worldY: number): number` returning a signed band; `stratumAt(seed: number, worldY: number): Stratum`.

- [ ] **Step 1: Write failing signed-band tests**

```ts
it('returns signed 500-tile bands in both directions', () => {
  expect(stratumIndexAt(-501)).toBe(-2);
  expect(stratumIndexAt(-1)).toBe(-1);
  expect(stratumIndexAt(0)).toBe(0);
  expect(stratumIndexAt(499)).toBe(0);
  expect(stratumIndexAt(500)).toBe(1);
});

it('selects deterministic non-repeating strata on both sides', () => {
  for (let band = -20; band <= 20; band++) {
    expect(stratumAt(42, band * STRATUM_HEIGHT)).toBe(stratumAt(42, band * STRATUM_HEIGHT));
    if (band > -20) {
      expect(stratumAt(42, band * STRATUM_HEIGHT)).not.toBe(
        stratumAt(42, (band - 1) * STRATUM_HEIGHT),
      );
    }
  }
});
```

- [ ] **Step 2: Run strata tests and verify the signature and expectations fail**

Run: `npm test -- src/world/strata.test.ts`

Expected: FAIL because positive Y is clamped and `stratumAt` does not accept a seed.

- [ ] **Step 3: Implement signed bands and bounded deterministic selection**

```ts
import { hash2 } from './noise';

export function stratumIndexAt(worldY: number): number {
  return Math.floor(worldY / STRATUM_HEIGHT);
}

export function stratumAt(seed: number, worldY: number): Stratum {
  const band = stratumIndexAt(worldY);
  const evenPool = [0, 1];
  const oddPool = [2, 3, 4];
  const pool = ((band % 2) + 2) % 2 === 0 ? evenPool : oddPool;
  const r = hash2(seed + 811, band, band < 0 ? -1 : 1);
  const index = pool[Math.floor(r * pool.length) % pool.length];
  return STRATA[index] ?? STRATA[0];
}
```

The disjoint parity pools guarantee that adjacent strata differ. The `-20..20` adjacency test verifies this contract across zero.

- [ ] **Step 4: Pass the seed from world generation and update test call sites**

Change `src/world/worldgen.ts`:

```ts
const s = stratumAt(seed, y);
```

Update every `stratumAt(y)` call in `src/world/worldgen.test.ts` to `stratumAt(seed, y)`. Add a chunk test spanning `y=499..562` and assert every generated tile equals `tileAt` across the positive-Y band boundary, mirroring the existing negative-boundary test.

- [ ] **Step 5: Run strata and world-generation tests**

Run: `npm test -- src/world/strata.test.ts src/world/worldgen.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit signed strata**

```powershell
git add src/world/strata.ts src/world/strata.test.ts src/world/worldgen.ts src/world/worldgen.test.ts
git commit -m "feat: generate strata in both y directions"
```

### Task 3: Remove Directional Damage Bias and Fix HUD Coordinates

**Files:**
- Modify: `src/render/megastructure/place.ts`
- Modify: `src/render/megastructure/place.test.ts`
- Create: `src/core/coordinate.ts`
- Create: `src/core/coordinate.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: signed world Y and existing megastructure placement seed.
- Produces: `displayY(bodyY: number, bodyHeight: number): number` and directionless bounded structure damage.

- [ ] **Step 1: Write failing HUD-coordinate tests**

```ts
import { describe, expect, it } from 'vitest';
import { displayY } from './coordinate';

describe('displayY', () => {
  it('preserves both signs instead of clamping one side to zero', () => {
    expect(displayY(100.2, 1.75)).toBe(102);
    expect(displayY(-100.2, 1.75)).toBe(-98);
  });
});
```

- [ ] **Step 2: Replace the monotonic-altitude damage test with directionless assertions**

In `src/render/megastructure/place.test.ts`, remove the test that requires damage to increase with altitude. Add:

```ts
it('is deterministic and bounded without a monotonic y trend', () => {
  const ys = [-100000, -10000, 0, 10000, 100000];
  const values = ys.map((y) => damageFor(42, 7, 1, y));
  expect(values).toEqual(ys.map((y) => damageFor(42, 7, 1, y)));
  for (const value of values) {
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  }
  expect(values).not.toEqual([...values].sort((a, b) => a - b));
});
```

- [ ] **Step 3: Run focused tests and verify failures**

Run: `npm test -- src/core/coordinate.test.ts src/render/megastructure/place.test.ts`

Expected: FAIL because `displayY` is missing and the existing damage model has a one-way altitude term.

- [ ] **Step 4: Implement signed HUD conversion and remove the altitude term**

Create `src/core/coordinate.ts`:

```ts
export function displayY(bodyY: number, bodyHeight: number): number {
  return Math.round(bodyY + bodyHeight);
}
```

In `src/render/megastructure/place.ts`, keep the existing `damageFor` signature but reinterpret its fourth parameter as signed `worldY`. Replace its body with:

```ts
export function damageFor(seed: number, slotX: number, band: number, worldY: number): number {
  const yCell = Math.floor(worldY / 500);
  return clamp01(hash2(seed + 51000 + band, slotX, yCell));
}
```

In `slotsInView`, delete `altitudeTiles`, keep `rowY`, and call `damageFor(seed, k, bi, rowY)`.

In `src/main.ts`:

```ts
import { displayY } from './core/coordinate';

const coordinateY = displayY(player.body.y, player.body.h);
hud.textContent = `座標 Y ${coordinateY} — ${SYSTEM_LABEL[sys]} [seed:${seed}] — ${cannon}`;
```

- [ ] **Step 5: Run focused tests and search for remaining altitude semantics**

Run: `npm test -- src/core/coordinate.test.ts src/render/megastructure/place.test.ts`

Run: `rg -n "Math\.max\(0,\s*-.*[Yy]|高度が|高度バイアス|高度 " src`

Expected: tests PASS; search returns no runtime directional-bias calculation or HUD altitude copy. Comments in historical tests must be updated when they describe behavior that changed.

- [ ] **Step 6: Commit directionless coordinate semantics**

```powershell
git add src/core/coordinate.ts src/core/coordinate.test.ts src/render/megastructure/place.ts src/render/megastructure/place.test.ts src/main.ts
git commit -m "fix: remove directional altitude semantics"
```

### Task 4: Landscape Integration Verification

**Files:**
- Modify only if verification exposes a defect in files owned by Tasks 1-3.
- Verify: `screenshots/` output remains untracked per existing project policy.

**Interfaces:**
- Consumes: completed Tasks 1-3.
- Produces: verified directionless coordinate-biome feature.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`

Expected: all test files PASS.

- [ ] **Step 2: Run type checking and production build**

Run: `npx tsc --noEmit`

Expected: exit code 0.

Run: `npm run build`

Expected: exit code 0 and Vite emits `dist/` successfully.

- [ ] **Step 3: Capture representative coordinates**

```powershell
node scripts/screenshot.mjs --seed=20260711 --x=8 --y=-3200 --out=screenshots/biome-neg.png
node scripts/screenshot.mjs --seed=20260711 --x=8 --y=0 --out=screenshots/biome-zero.png
node scripts/screenshot.mjs --seed=20260711 --x=8 --y=3200 --out=screenshots/biome-pos.png
```

Expected: three valid PNGs with visibly different environment treatment; positive and negative images do not form a simple mirrored progression.

- [ ] **Step 4: Inspect a calculated boundary**

Use a temporary `tsx`-free Vitest assertion or browser query coordinate derived from `biomeBoundary(20260711, 2)`. Capture one image 200 tiles before and one 200 tiles after. Confirm no full-frame color discontinuity and no background layer pop.

- [ ] **Step 5: Commit only if verification required corrective edits**

```powershell
git add src/render/biome.ts src/render/biome.test.ts src/world/strata.ts src/world/strata.test.ts src/world/worldgen.ts src/world/worldgen.test.ts src/render/megastructure/place.ts src/render/megastructure/place.test.ts src/core/coordinate.ts src/core/coordinate.test.ts src/main.ts
git commit -m "fix: stabilize coordinate biome integration"
```
