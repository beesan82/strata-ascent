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
          const pose = calculatePlayerPose(facing, phase, true, 0, timeSec);

          expect(pose.leftFoot.y).toBeGreaterThanOrEqual(-0.08);
          expect(pose.leftFoot.y).toBeLessThanOrEqual(0);
          expect(pose.rightFoot.y).toBeGreaterThanOrEqual(-0.08);
          expect(pose.rightFoot.y).toBeLessThanOrEqual(0);
          expect(Math.max(pose.leftFoot.y, pose.rightFoot.y)).toBeCloseTo(0);
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
        const pose = calculatePlayerPose(-1, phase, true, angle, 1.25);
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
    const right = calculatePlayerPose(1, 0.7, true, aimAngle, 0.4);
    const left = calculatePlayerPose(-1, 0.7, true, aimAngle, 0.4);
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
    const pose = calculatePlayerPose(1, Math.PI / 2, true, 0, 0);

    expect(pose.leftFoot.x * pose.rightFoot.x).toBeLessThan(0);
    expect(pose.leftFoot.y).not.toBeCloseTo(pose.rightFoot.y);
  });

  it('settles every stopped gait phase into the same neutral grounded pose', () => {
    const stoppedMidLeftStep = calculatePlayerPose(
      1,
      Math.PI / 2,
      false,
      0.35,
      1.1,
    );
    const stoppedMidRightStep = calculatePlayerPose(
      1,
      (3 * Math.PI) / 2,
      false,
      0.35,
      1.1,
    );

    for (const key of [
      'hip',
      'head',
      'leftKnee',
      'rightKnee',
      'leftFoot',
      'rightFoot',
      'weaponShoulder',
      'supportShoulder',
      'weaponHand',
      'supportHand',
      'muzzle',
    ] as const) {
      expect(stoppedMidLeftStep[key]).toEqual(stoppedMidRightStep[key]);
    }
    expect(stoppedMidLeftStep.leftFoot).toEqual({ x: -0.11, y: 0 });
    expect(stoppedMidLeftStep.rightFoot).toEqual({ x: 0.11, y: 0 });
    expect(stoppedMidLeftStep.coatSwing).toBe(0);
  });

  it('uses gait phase for arm recoil and counter-stabilized head and body motion', () => {
    const aimAngle = -0.65;
    const crossover = calculatePlayerPose(1, 0, true, aimAngle, 0);
    const leftStep = calculatePlayerPose(1, Math.PI / 2, true, aimAngle, 0);
    const rightStep = calculatePlayerPose(
      1,
      (3 * Math.PI) / 2,
      true,
      aimAngle,
      0,
    );

    const leftArmRecoil = leftStep.weaponShoulder.x - crossover.weaponShoulder.x;
    const rightArmRecoil = rightStep.weaponShoulder.x - crossover.weaponShoulder.x;
    expect(Math.abs(leftArmRecoil)).toBeGreaterThan(0.02);
    expect(leftArmRecoil).toBeCloseTo(-rightArmRecoil);

    const leftHipSway = leftStep.hip.x - crossover.hip.x;
    const leftHeadCorrection = leftStep.head.x - crossover.head.x;
    expect(leftHipSway * leftHeadCorrection).toBeLessThan(0);
    expect(Math.abs(leftHeadCorrection)).toBeLessThan(Math.abs(leftHipSway));
    expect(leftStep.hip.y).toBeLessThan(crossover.hip.y);
    expect(rightStep.hip.y).toBeCloseTo(leftStep.hip.y);

    for (const pose of [crossover, leftStep, rightStep]) {
      const muzzleVector = {
        x: pose.muzzle.x - pose.weaponHand.x,
        y: pose.muzzle.y - pose.weaponHand.y,
      };
      expect(muzzleVector.x / magnitude(muzzleVector)).toBeCloseTo(
        Math.cos(aimAngle),
      );
      expect(muzzleVector.y / magnitude(muzzleVector)).toBeCloseTo(
        Math.sin(aimAngle),
      );
    }
  });

  it('keeps local coat swing identical across mirrored facings', () => {
    const right = calculatePlayerPose(1, 1.2, true, 0, 0);
    const left = calculatePlayerPose(-1, 1.2, true, 0, 0);

    expect(left.coatSwing).toBeCloseTo(right.coatSwing);
  });

  it('keeps the status indicator within its normalized range', () => {
    for (const timeSec of [0, 0.1, 0.5, 1, 2.5, 10]) {
      const pose = calculatePlayerPose(1, 0, false, 0, timeSec);
      expect(pose.indicator).toBeGreaterThanOrEqual(0);
      expect(pose.indicator).toBeLessThanOrEqual(1);
    }
  });
});
