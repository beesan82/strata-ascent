# Task 1 Report: Shared Short Biome-Cell Selector

## Changed files

- `src/world/biomeCells.ts` — shared signed-Y cell boundaries, resolution, and biome ID selection.
- `src/world/biomeCells.test.ts` — selector constants, spacing, determinism, signed-direction, adjacency, and boundary tests.
- `src/render/biome.ts` — visual biome ID map, ordered compatibility array, shared-selector bridge, and constant re-exports.
- `src/render/biome.test.ts` — shared visual-map and short-cell compatibility coverage.
- `src/render/chunkbake.test.ts` — short-cell-safe interior and blend fixtures.

## Design notes

- Cell boundaries use a 375-tile base and deterministic signed hash jitter. The jitter is bounded by `[-75, +75]` and normalized to retain 300–450 tile gaps.
- Selection returns stable `BiomeId` values from disjoint even and odd pools, so neighboring cells cannot share an ID. Negative cells retain their signed hash input.
- Rendering maps IDs through `VISUAL_BIOME`; `BIOMES` remains a compatibility array derived from `BIOME_IDS`, and system/foundry lookup remains intact.
- Boundary blending continues to cover all visual channels over exactly ±50 tiles.

## Verification

- `npm test -- src/world/biomeCells.test.ts src/render/biome.test.ts src/render/background.test.ts src/render/chunkbake.test.ts src/render/renderer.test.ts` — passed: 5 files, 32 tests.
- `npm test` — passed: 35 files, 285 tests.
- `npm run build` — passed: `tsc` and Vite production build.
- `git diff --check` — passed.

## Commit

- `feat: shorten shared biome cells` (this commit)

## Self-review

- Independent read-only review found no blocking issues.
- Confirmed shared ownership, signed inputs, direct boundary resolution, compatibility exports, complete blend channels, and no added dependencies.

## Concerns

None.

## Fix Round 1

### Root cause and correction

- The first implementation reduced the jitter modulus to `BIOME_CELL_JITTER + 1` to preserve cell widths, which incorrectly limited offsets to `[-75, 0]`.
- Jitter now uses the signed 32-bit hash normalized with `>>> 0` before modulus, producing full-range `[-75, +75]` anchor offsets. Direct midpoint interpolation between consecutive anchors caps each boundary delta at 75 tiles, preserving 300–450 tile cell widths without traversal from zero.
- Added deterministic coverage proving sampled jitter remains integral and in bounds with both signs represented, and that every `BIOME_IDS` entry is reachable in the broad signed sample.
- Updated the chunk-blend fixture to a deterministic boundary whose 64-tile chunk centers both lie inside the ±50 blend interval.

### Verification

- `npm test -- src/world/biomeCells.test.ts src/render/biome.test.ts src/render/background.test.ts src/render/chunkbake.test.ts src/render/renderer.test.ts` — passed: 5 files, 33 tests.
- `npm test` — passed: 35 files, 286 tests.
- `npm run build` — passed: `tsc` and Vite production build.

### Commit

- `fix: normalize biome jitter range` (this commit)

## Fix Round 2

### Root cause and correction

- The paired-anchor interpolation in Fix Round 1 used `floor(cell / 2)` and a second neighboring hash input, violating the required per-cell signed-hash boundary contract.
- `biomeJitter` now maps only `unsignedHash(seed, cell)` to an integral, symmetric subset `[-37, +38]` of the allowed `[-75, +75]` interval. This keeps each direct, independent boundary offset within the required bounds while ensuring every adjacent boundary gap remains 300–450 tiles.
- Added fixed observable boundary fixtures for signed negative and non-negative cells. They fail under the former paired-anchor algorithm and prove that each boundary follows its own signed hash mapping.

### Verification

- `npm test -- src/world/biomeCells.test.ts src/render/biome.test.ts src/render/background.test.ts src/render/chunkbake.test.ts src/render/renderer.test.ts` — passed: 5 files, 34 tests.
- `npm test` — passed: 35 files, 287 tests.
- `npm run build` — passed: `tsc` and Vite production build.

### Commit

- `fix: restore direct biome hash mapping` (this commit)
