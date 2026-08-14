# Player Visual Foreground Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the minimal player silhouette with a readable 2.25-tile original female mechanical humanoid while preserving the existing physics body and controls.

**Architecture:** Split pure pose calculation from Canvas drawing. Compose the sprite from legs, torso armor, head, arms/weapon, and light accents, with all dimensions relative to tile pixel size and the feet anchored to the existing player render point.

**Tech Stack:** TypeScript 5.7, Canvas 2D, Vitest 3, Vite 6

## Global Constraints

- Rendered height is 2.25 tiles; the `Player` physics body remains unchanged.
- Main identifiers are a white face, black head/uniform, dark-red chest armor, narrow visor, and small chest indicator.
- Keep the character original; reference only limited-color, hard-silhouette, low-resolution-face, and red-focal-point principles.
- The weapon remains aligned to the existing renderer aim angle.
- Dark environments must not erase the face and chest identifiers.
- Do not change movement, jumping, climbing, collision, destruction, or weapon statistics.
- No new runtime dependency and no raster asset pipeline.

## File Structure

- Create `src/render/playerPose.ts`: pure pose types and joint calculation.
- Create `src/render/playerPose.test.ts`: pose dimensions, finiteness, facing, gait, and aim tests.
- Modify `src/render/playerSprite.ts`: componentized Canvas drawing using `PlayerPose`.
- Create `src/render/playerSprite.test.ts`: mocked-Canvas smoke tests and color/readability contracts.
- Modify `src/render/renderer.ts`: pass time for idle indicator animation while retaining current physics anchor.

---

### Task 1: Pure Mechanical-Humanoid Pose Model

**Files:**
- Create: `src/render/playerPose.ts`
- Create: `src/render/playerPose.test.ts`
- Test: `src/render/playerPose.test.ts`

**Interfaces:**
- Consumes: `facing: 1 | -1`, `walkPhase: number`, `aimAngle: number`, and `timeSec: number`.
- Produces: `PLAYER_DRAW_HEIGHT_TILES`, `Vec2`, `PlayerPose`, and `calculatePlayerPose(...)`.

- [ ] **Step 1: Write the failing pose tests**

```ts
import { describe, expect, it } from 'vitest';
import { calculatePlayerPose, PLAYER_DRAW_HEIGHT_TILES } from './playerPose';

describe('calculatePlayerPose', () => {
  it('uses a 2.25-tile drawing envelope with feet at y=0', () => {
    const pose = calculatePlayerPose(1, 0, 0, 0);
    expect(PLAYER_DRAW_HEIGHT_TILES).toBe(2.25);
    expect(Math.max(pose.leftFoot.y, pose.rightFoot.y)).toBeCloseTo(0);
    expect(pose.head.y).toBeGreaterThanOrEqual(-2.25);
  });

  it('keeps all joints finite through gait and aim extremes', () => {
    for (const phase of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      for (const angle of [-Math.PI, -Math.PI / 2, 0, Math.PI / 2, Math.PI]) {
        const pose = calculatePlayerPose(1, phase, angle, 3.5);
        for (const point of Object.values(pose)) {
          if (typeof point === 'object' && point && 'x' in point) {
            expect(Number.isFinite(point.x)).toBe(true);
            expect(Number.isFinite(point.y)).toBe(true);
          }
        }
      }
    }
  });

  it('mirrors body joints but keeps world aim direction', () => {
    const right = calculatePlayerPose(1, 0.7, 0.25, 1);
    const left = calculatePlayerPose(-1, 0.7, 0.25, 1);
    expect(left.head.x).toBeCloseTo(-right.head.x);
    expect(left.muzzle.x - left.weaponHand.x).toBeCloseTo(
      right.muzzle.x - right.weaponHand.x,
    );
  });

  it('moves opposing feet in opposite gait phases', () => {
    const pose = calculatePlayerPose(1, Math.PI / 2, 0, 0);
    expect(Math.sign(pose.leftFoot.x)).not.toBe(Math.sign(pose.rightFoot.x));
  });
});
```

- [ ] **Step 2: Run the focused test and verify the module is missing**

Run: `npm test -- src/render/playerPose.test.ts`

Expected: FAIL because `playerPose.ts` does not exist.

- [ ] **Step 3: Implement the pose types and minimal joint model**

```ts
export const PLAYER_DRAW_HEIGHT_TILES = 2.25;

export interface Vec2 { x: number; y: number }

export interface PlayerPose {
  head: Vec2;
  neck: Vec2;
  hip: Vec2;
  leftKnee: Vec2;
  rightKnee: Vec2;
  leftFoot: Vec2;
  rightFoot: Vec2;
  weaponShoulder: Vec2;
  supportShoulder: Vec2;
  weaponHand: Vec2;
  supportHand: Vec2;
  muzzle: Vec2;
  coatSwing: number;
  indicator: number;
}

export function calculatePlayerPose(
  facing: 1 | -1,
  walkPhase: number,
  aimAngle: number,
  timeSec: number,
): PlayerPose {
  const gait = Math.sin(walkPhase);
  const lift = Math.max(0, Math.cos(walkPhase)) * 0.08;
  const idle = Math.sin(timeSec * 2.1) * 0.015;
  const hip = { x: 0, y: -0.92 + idle };
  const weaponShoulder = { x: 0.18 * facing, y: -1.55 + idle };
  const supportShoulder = { x: -0.16 * facing, y: -1.55 + idle };
  const aim = { x: Math.cos(aimAngle), y: Math.sin(aimAngle) };
  const weaponHand = { x: weaponShoulder.x + aim.x * 0.42, y: weaponShoulder.y + aim.y * 0.42 };
  return {
    head: { x: 0.03 * facing, y: -2.03 + idle * 0.4 },
    neck: { x: 0, y: -1.78 + idle * 0.6 },
    hip,
    leftKnee: { x: gait * 0.10 * facing, y: -0.48 },
    rightKnee: { x: -gait * 0.10 * facing, y: -0.48 },
    leftFoot: { x: gait * 0.18 * facing, y: -lift },
    rightFoot: { x: -gait * 0.18 * facing, y: -Math.max(0, -Math.cos(walkPhase)) * 0.08 },
    weaponShoulder,
    supportShoulder,
    weaponHand,
    supportHand: { x: weaponHand.x - aim.x * 0.13, y: weaponHand.y - aim.y * 0.13 + 0.08 },
    muzzle: { x: weaponHand.x + aim.x * 0.55, y: weaponHand.y + aim.y * 0.55 },
    coatSwing: -gait * 0.12,
    indicator: 0.72 + Math.sin(timeSec * 2.7) * 0.18,
  };
}
```

The mirror test deliberately requires body landmarks to mirror while the muzzle vector remains in world-space aim direction. Adjust only the local shoulder selection if needed; do not multiply the aim vector by `facing`.

- [ ] **Step 4: Run pose tests**

Run: `npm test -- src/render/playerPose.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the pose model**

```powershell
git add src/render/playerPose.ts src/render/playerPose.test.ts
git commit -m "feat: add mechanical player pose model"
```

### Task 2: Componentized Foreground Sprite

**Files:**
- Modify: `src/render/playerSprite.ts`
- Create: `src/render/playerSprite.test.ts`
- Modify: `src/render/renderer.ts`
- Test: `src/render/playerSprite.test.ts`

**Interfaces:**
- Consumes: `calculatePlayerPose`, `PlayerPose`, ambient color, pixels per tile, render position, facing, walk phase, aim angle, and time.
- Produces: `PLAYER_COLORS`, existing `drawPlayer(...)` extended with `timeSec: number` as its final argument.

- [ ] **Step 1: Write failing public-contract and draw smoke tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import { drawPlayer, PLAYER_COLORS } from './playerSprite';

describe('drawPlayer', () => {
  it('keeps face and chest colors above the dark-environment floor', () => {
    expect(PLAYER_COLORS.face).toBe('#d9dddc');
    expect(PLAYER_COLORS.chest).toBe('#7f1f28');
    expect(PLAYER_COLORS.indicator).toBe('#e64747');
  });

  it('draws a complete component stack without leaking canvas state', () => {
    const save = vi.fn();
    const restore = vi.fn();
    const fill = vi.fn();
    const stroke = vi.fn();
    const ctx = {
      save, restore, translate: vi.fn(), scale: vi.fn(),
      beginPath: vi.fn(), closePath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
      arc: vi.fn(), fill, stroke, fillRect: vi.fn(),
      fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt',
    } as unknown as CanvasRenderingContext2D;
    drawPlayer(ctx, 100, 100, 16, 1, 0.5, 0.25, '#020408', 2);
    expect(save).toHaveBeenCalled();
    expect(restore).toHaveBeenCalledTimes(save.mock.calls.length);
    expect(fill).toHaveBeenCalled();
    expect(stroke).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the sprite test and verify the new contract fails**

Run: `npm test -- src/render/playerSprite.test.ts`

Expected: FAIL because `PLAYER_COLORS` and the time argument do not exist.

- [ ] **Step 3: Replace the monolithic silhouette with component functions**

At the top of `src/render/playerSprite.ts`:

```ts
import { calculatePlayerPose, type PlayerPose, type Vec2 } from './playerPose';

export const PLAYER_COLORS = {
  face: '#d9dddc',
  uniform: '#151820',
  uniformLight: '#303640',
  joint: '#6f7479',
  chest: '#7f1f28',
  chestLight: '#a9363e',
  visor: '#171015',
  indicator: '#e64747',
  weapon: '#353a40',
} as const;
```

Implement these focused helpers in the same file:

```ts
function line(ctx: CanvasRenderingContext2D, a: Vec2, b: Vec2, s: number, color: string, width: number): void;
function drawLegs(ctx: CanvasRenderingContext2D, pose: PlayerPose, s: number, ambient: string): void;
function drawTorso(ctx: CanvasRenderingContext2D, pose: PlayerPose, s: number, ambient: string): void;
function drawHead(ctx: CanvasRenderingContext2D, pose: PlayerPose, s: number, ambient: string): void;
function drawArmsAndWeapon(ctx: CanvasRenderingContext2D, pose: PlayerPose, s: number, ambient: string): void;
function drawAccents(ctx: CanvasRenderingContext2D, pose: PlayerPose, s: number): void;
```

Draw order must be rear leg, rear arm, coat/torso, front leg, head, front arm/weapon, then accents. Use hard polygon edges and round only the small joint circles. Mix environment color into uniform and joints by at most 30%; mix into face and chest by at most 12% so identifiers retain minimum brightness.

- [ ] **Step 4: Anchor the 2.25-tile sprite at the existing feet position**

Replace `drawPlayer` with:

```ts
export function drawPlayer(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  ppt: number,
  facing: 1 | -1,
  walkPhase: number,
  aimAngle: number,
  ambientColor: string,
  timeSec: number,
): void {
  const pose = calculatePlayerPose(facing, walkPhase, aimAngle, timeSec);
  const feetY = py + 0.875 * ppt;
  ctx.save();
  ctx.translate(Math.round(px), Math.round(feetY));
  drawLegs(ctx, pose, ppt, ambientColor);
  drawTorso(ctx, pose, ppt, ambientColor);
  drawHead(ctx, pose, ppt, ambientColor);
  drawArmsAndWeapon(ctx, pose, ppt, ambientColor);
  drawAccents(ctx, pose, ppt);
  ctx.restore();
}
```

The `0.875 * ppt` offset converts the renderer's current player-center anchor to the unchanged 1.75-tile physics body's feet. Do not modify `Player.body` dimensions.

- [ ] **Step 5: Pass render time from the renderer**

In `src/render/renderer.ts`:

```ts
drawPlayer(
  ctx, px, py, ppt, player.facing, player.walkPhase,
  angle, bb.ambientColor, timeSec,
);
```

- [ ] **Step 6: Run sprite, pose, renderer, and player tests**

Run: `npm test -- src/render/playerPose.test.ts src/render/playerSprite.test.ts src/render/renderer.test.ts src/entities/player.test.ts`

Expected: PASS, with no changes required in `src/entities/player.ts`.

- [ ] **Step 7: Commit the foreground sprite**

```powershell
git add src/render/playerSprite.ts src/render/playerSprite.test.ts src/render/renderer.ts
git commit -m "feat: foreground the mechanical player sprite"
```

### Task 3: Player Visual Verification

**Files:**
- Modify only if visual verification exposes a defect in `src/render/playerPose.ts`, `src/render/playerSprite.ts`, or their tests.
- Verify: `screenshots/` remains untracked.

**Interfaces:**
- Consumes: completed Tasks 1-2 and the existing screenshot script.
- Produces: verified readable sprite in representative lighting and aim poses.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 2: Run type checking and production build**

Run: `npx tsc --noEmit`

Expected: exit code 0.

Run: `npm run build`

Expected: exit code 0.

- [ ] **Step 3: Capture bright, dark, and transition scenes**

```powershell
node scripts/screenshot.mjs --seed=20260711 --x=8 --y=-3200 --out=screenshots/player-dark.png
node scripts/screenshot.mjs --seed=20260711 --x=8 --y=0 --out=screenshots/player-origin.png
node scripts/screenshot.mjs --seed=20260711 --x=8 --y=3200 --out=screenshots/player-positive.png
```

Expected: face, red chest, separate legs, and weapon silhouette remain readable in all three images; feet align to the floor; the head does not collide visually with ordinary ceilings more than the intentionally enlarged sprite permits.

- [ ] **Step 4: Verify motion and aim interactively**

Run: `npm run dev`

Check: idle indicator pulses subtly; walking alternates feet and knees; left/right facing mirrors body construction; mouse aim keeps the pistol pointed at the cursor in all quadrants; physics collision and ladder behavior are unchanged.

- [ ] **Step 5: Compare against originality constraints**

Check that the result contains no copied insignia, costume panel layout, character-specific hairstyle, or exact weapon silhouette from SIGNALIS. The accepted shared traits are limited palette, hard silhouette, white face focal point, dark-red chest focus, and low-resolution facial treatment.

- [ ] **Step 6: Commit only if verification required corrective edits**

```powershell
git add src/render/playerPose.ts src/render/playerPose.test.ts src/render/playerSprite.ts src/render/playerSprite.test.ts src/render/renderer.ts
git commit -m "fix: refine player sprite readability"
```
