export const PLAYER_DRAW_HEIGHT_TILES = 2.25;

export interface Vec2 {
  x: number;
  y: number;
}

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

const IDLE_BOB_AMPLITUDE = 0.018;
const FOOT_LIFT_TILES = 0.08;

export function calculatePlayerPose(
  facing: 1 | -1,
  walkPhase: number,
  aimAngle: number,
  timeSec: number,
): PlayerPose {
  const idleBob = Math.sin(timeSec * 2.2) * IDLE_BOB_AMPLITUDE;
  const gait = Math.sin(walkPhase);
  const leftLift = Math.max(0, gait) * FOOT_LIFT_TILES;
  const rightLift = Math.max(0, -gait) * FOOT_LIFT_TILES;
  const leftFoot: Vec2 = { x: facing * (-0.11 + gait * 0.2), y: -leftLift };
  const rightFoot: Vec2 = { x: facing * (0.11 - gait * 0.2), y: -rightLift };
  const hip: Vec2 = { x: facing * 0.035, y: -0.83 + idleBob };
  const neck: Vec2 = { x: facing * 0.015, y: -1.76 + idleBob };
  const aim = { x: Math.cos(aimAngle), y: Math.sin(aimAngle) };
  const weaponShoulder: Vec2 = { x: facing * 0.23, y: -1.62 + idleBob };
  const supportShoulder: Vec2 = { x: facing * -0.19, y: -1.58 + idleBob };
  const weaponHand: Vec2 = {
    x: weaponShoulder.x + aim.x * 0.38,
    y: weaponShoulder.y + aim.y * 0.38,
  };
  const supportHand: Vec2 = {
    x: weaponHand.x - aim.x * 0.24 - aim.y * 0.09,
    y: weaponHand.y - aim.y * 0.24 + aim.x * 0.09,
  };

  return {
    head: { x: facing * 0.045, y: -2.08 + idleBob },
    neck,
    hip,
    leftKnee: {
      x: (hip.x + leftFoot.x) / 2 + facing * (0.08 - gait * 0.035),
      y: -0.43 + idleBob * 0.45 - leftLift * 0.35,
    },
    rightKnee: {
      x: (hip.x + rightFoot.x) / 2 + facing * (-0.08 + gait * 0.035),
      y: -0.43 + idleBob * 0.45 - rightLift * 0.35,
    },
    leftFoot,
    rightFoot,
    weaponShoulder,
    supportShoulder,
    weaponHand,
    supportHand,
    muzzle: {
      x: weaponHand.x + aim.x * 0.56,
      y: weaponHand.y + aim.y * 0.56,
    },
    coatSwing: facing * Math.sin(walkPhase - 0.55) * 0.09,
    indicator: 0.72 + Math.sin(timeSec * 4.2) * 0.18,
  };
}
