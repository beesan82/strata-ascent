import {
  footCyclePosition,
  gaitBodyOffset,
  gaitFoot,
  stepFraction,
} from '../core/gait';

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
const WALK_BODY_SWAY_TILES = 0.05;
const WALK_HEAD_STABILIZATION_TILES = 0.02;
const WALK_ARM_RECOIL_TILES = 0.04;
/** 歩行中の前傾(タイル)。腰に対して首・頭が前へ出る量 */
const WALK_LEAN_TILES = 0.045;
/** コートの揺れの振幅と、歩容に対する位相の遅れ(着地に反応して遅れて翻る) */
const COAT_SWING_TILES = 0.14;
const COAT_LAG_RAD = 1.15;

export function calculatePlayerPose(
  facing: 1 | -1,
  walkPhase: number,
  isWalking: boolean,
  aimAngle: number,
  timeSec: number,
): PlayerPose {
  const idleBob = Math.sin(timeSec * 2.2) * IDLE_BOB_AMPLITUDE;
  // 上半身の揺れ(横揺れ・腕の反動)は sin のままでよい(地面に触れないので滑りの問題がない)。
  // 足は core/gait の非対称プロファイル(接地期は対地静止、遊脚期は速く戻る)で決める
  const sway = isWalking ? Math.sin(walkPhase) : 0;
  const bodyOffset = isWalking ? gaitBodyOffset(stepFraction(walkPhase)) : 0;
  const lean = isWalking ? WALK_LEAN_TILES : 0;
  const leftGait = isWalking
    ? gaitFoot(footCyclePosition(walkPhase, 0))
    : { forward: 0, lift: 0 };
  const rightGait = isWalking
    ? gaitFoot(footCyclePosition(walkPhase, Math.PI))
    : { forward: 0, lift: 0 };
  const leftFoot: Vec2 = {
    x: facing * (-0.11 + leftGait.forward),
    y: leftGait.lift > 0 ? -leftGait.lift : 0,
  };
  const rightFoot: Vec2 = {
    x: facing * (0.11 + rightGait.forward),
    y: rightGait.lift > 0 ? -rightGait.lift : 0,
  };
  const hip: Vec2 = {
    x: facing * (0.035 + sway * WALK_BODY_SWAY_TILES),
    y: -0.83 + idleBob + bodyOffset,
  };
  const neck: Vec2 = {
    x: facing * (0.015 + sway * WALK_BODY_SWAY_TILES * 0.5 + lean * 0.8),
    y: -1.76 + idleBob + bodyOffset * 0.5,
  };
  const aim = { x: Math.cos(aimAngle), y: Math.sin(aimAngle) };
  const weaponShoulder: Vec2 = {
    x: facing * (0.23 - sway * WALK_ARM_RECOIL_TILES + lean * 0.8),
    y: -1.62 + idleBob + bodyOffset * 0.5,
  };
  const supportShoulder: Vec2 = {
    x: facing * (-0.19 - sway * WALK_ARM_RECOIL_TILES * 0.5 + lean * 0.8),
    y: -1.58 + idleBob + bodyOffset * 0.5,
  };
  const weaponHand: Vec2 = {
    x: weaponShoulder.x + aim.x * 0.38,
    y: weaponShoulder.y + aim.y * 0.38,
  };
  const supportHand: Vec2 = {
    x: weaponHand.x - aim.x * 0.24 - aim.y * 0.09,
    y: weaponHand.y - aim.y * 0.24 + aim.x * 0.09,
  };
  // 膝は腰-足の中点から前へ張り出し、遊脚で持ち上がるほど強く曲がる
  const knee = (foot: Vec2, lift: number): Vec2 => ({
    x: (hip.x + foot.x) / 2 + facing * (0.06 + lift * 0.85),
    y: (hip.y + foot.y) / 2 - 0.03 - lift * 0.18,
  });

  return {
    head: {
      x: facing * (0.05 - sway * WALK_HEAD_STABILIZATION_TILES + lean),
      y: -2.04 + idleBob + bodyOffset * 0.5,
    },
    neck,
    hip,
    leftKnee: knee(leftFoot, leftGait.lift),
    rightKnee: knee(rightFoot, rightGait.lift),
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
    coatSwing: isWalking ? Math.sin(walkPhase - COAT_LAG_RAD) * COAT_SWING_TILES : 0,
    indicator: 0.72 + Math.sin(timeSec * 4.2) * 0.18,
  };
}
