import { describe, expect, it } from 'vitest';
import {
  calculatePlayerPose,
  PLAYER_DRAW_HEIGHT_TILES,
  type Vec2,
} from './playerPose';

const magnitude = (vector: Vec2): number => Math.hypot(vector.x, vector.y);

describe('calculatePlayerPose', () => {
  it('keeps the 2.25-tile silhouette grounded and inside its height envelope', () => {
    expect(PLAYER_DRAW_HEIGHT_TILES).toBe(2.25);
    const phases = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
    const times = [0, Math.PI / (2 * 2.2), (3 * Math.PI) / (2 * 2.2)];

    for (const facing of [1, -1] as const) {
      for (const phase of phases) {
        for (const timeSec of times) {
          const pose = calculatePlayerPose(facing, phase, 0, timeSec);

          expect(pose.leftFoot.y).toBeGreaterThanOrEqual(-0.08);
          expect(pose.leftFoot.y).toBeLessThanOrEqual(0);
          expect(pose.rightFoot.y).toBeGreaterThanOrEqual(-0.08);
          expect(pose.rightFoot.y).toBeLessThanOrEqual(0);
          expect(pose.head.y).toBeGreaterThanOrEqual(-PLAYER_DRAW_HEIGHT_TILES);
          expect(pose.head.y).toBeLessThanOrEqual(0);
        }
      }
    }
  });

  it('returns finite pose values throughout the required gait and aim matrix', () => {
    const phases = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
    const angles = [-Math.PI, -Math.PI / 2, 0, Math.PI / 2, Math.PI];

    for (const phase of phases) {
      for (const angle of angles) {
        const pose = calculatePlayerPose(-1, phase, angle, 1.25);
        for (const value of [
          ...Object.values(pose).flatMap((part) =>
            typeof part === 'number' ? [part] : [part.x, part.y],
          ),
        ]) {
          expect(Number.isFinite(value)).toBe(true);
        }
      }
    }
  });

  it('mirrors body landmarks while keeping the muzzle vector in world aim space', () => {
    const aimAngle = Math.PI / 3;
    const right = calculatePlayerPose(1, 0.7, aimAngle, 0.4);
    const left = calculatePlayerPose(-1, 0.7, aimAngle, 0.4);
    const rightMuzzle = { x: right.muzzle.x - right.weaponHand.x, y: right.muzzle.y - right.weaponHand.y };
    const leftMuzzle = { x: left.muzzle.x - left.weaponHand.x, y: left.muzzle.y - left.weaponHand.y };

    expect(left.head.x).toBeCloseTo(-right.head.x);
    expect(left.neck.x).toBeCloseTo(-right.neck.x);
    expect(left.hip.x).toBeCloseTo(-right.hip.x);
    expect(left.leftKnee.x).toBeCloseTo(-right.leftKnee.x);
    expect(left.leftKnee.y).toBeCloseTo(right.leftKnee.y);
    expect(left.rightKnee.x).toBeCloseTo(-right.rightKnee.x);
    expect(left.rightKnee.y).toBeCloseTo(right.rightKnee.y);
    expect(left.leftFoot.x).toBeCloseTo(-right.leftFoot.x);
    expect(left.rightFoot.x).toBeCloseTo(-right.rightFoot.x);
    expect(left.weaponShoulder.x).toBeCloseTo(-right.weaponShoulder.x);
    expect(left.weaponShoulder.y).toBeCloseTo(right.weaponShoulder.y);
    expect(left.supportShoulder.x).toBeCloseTo(-right.supportShoulder.x);
    expect(left.supportShoulder.y).toBeCloseTo(right.supportShoulder.y);
    expect(rightMuzzle.x / magnitude(rightMuzzle)).toBeCloseTo(Math.cos(aimAngle));
    expect(rightMuzzle.y / magnitude(rightMuzzle)).toBeCloseTo(Math.sin(aimAngle));
    expect(leftMuzzle.x / magnitude(leftMuzzle)).toBeCloseTo(Math.cos(aimAngle));
    expect(leftMuzzle.y / magnitude(leftMuzzle)).toBeCloseTo(Math.sin(aimAngle));
  });

  it('moves opposing feet in opposite directions during a representative gait phase', () => {
    const pose = calculatePlayerPose(1, Math.PI / 2, 0, 0);

    expect(pose.leftFoot.x * pose.rightFoot.x).toBeLessThan(0);
    expect(pose.leftFoot.y).not.toBeCloseTo(pose.rightFoot.y);
  });

  it('keeps the status indicator within its normalized range', () => {
    for (const timeSec of [0, 0.1, 0.5, 1, 2.5, 10]) {
      const pose = calculatePlayerPose(1, 0, 0, timeSec);
      expect(pose.indicator).toBeGreaterThanOrEqual(0);
      expect(pose.indicator).toBeLessThanOrEqual(1);
    }
  });
});
