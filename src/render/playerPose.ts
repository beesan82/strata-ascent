import {
  footCyclePosition,
  gaitBodyOffset,
  gaitFoot,
  stepFraction,
} from '../core/gait';

export const PLAYER_DRAW_HEIGHT_TILES = 2.25;

/**
 * 体の中心から足元(ポーズ原点)までの縦オフセット(タイル)。
 * 物理ボディの高さ 1.75 の半分で、描画(playerSprite の feetY)と
 * 発射原点の計算で同じ値を共有する(二重管理で銃口がずれるのを防ぐ)。
 */
export const PLAYER_FEET_OFFSET_TILES = 0.875;

/**
 * ポーズから銃口のワールド座標を求める。描画(playerSprite.drawPlayer)が
 * スクリーン座標で行うアンカー計算と同じ変換をタイル座標で行うもので、
 * パルスの発射原点はこれと一致させる(中心固定だと弾が腰から出る)。
 */
export function poseMuzzleWorld(
  centerX: number,
  centerY: number,
  facing: 1 | -1,
  walkPhase: number,
  isWalking: boolean,
  aimAngle: number,
  timeSec: number,
  hanging = false,
): Vec2 {
  const pose = calculatePlayerPose(facing, walkPhase, isWalking, aimAngle, timeSec, hanging);
  return {
    x: centerX + pose.muzzle.x,
    y: centerY + PLAYER_FEET_OFFSET_TILES + pose.muzzle.y,
  };
}

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
/**
 * 崖つかみ(設計 2026-11-09-ledge-grab)のポーズ原点から見た縁の上面の高さ(タイル、上が負)。
 * 物理ボディの高さ 1.75 + 掴まり中の体上端の沈み(physics.LEDGE_HANG_DEPTH = 0.25)。
 * 手はこの高さに置き、頭はこれより下に収める(体が縁からぶら下がる形)
 */
const HANG_LEDGE_Y = -2.0;

/**
 * 掴まり中のポーズ。両腕を縁へ伸ばし、体は縁の下にぶら下がる。脚は軽く曲げて垂らす。
 * 武器は使えないので銃口は縁の上へ向け(腕の延長)、発射原点との整合は問わない。
 * 歩行の揺れは乗せず、呼吸の bob だけ共有する(描画パスは増えない)
 */
function hangingPose(facing: 1 | -1, timeSec: number): PlayerPose {
  const idleBob = Math.sin(timeSec * 2.2) * IDLE_BOB_AMPLITUDE;
  const hip: Vec2 = { x: facing * 0.02, y: -0.62 + idleBob };
  const neck: Vec2 = { x: facing * 0.1, y: -1.55 + idleBob };
  const head: Vec2 = { x: facing * 0.12, y: -1.82 + idleBob };
  // 肩は持ち上がり、手は体の側面(±0.375)を越えて縁の上面にかかる
  const weaponShoulder: Vec2 = { x: facing * 0.2, y: -1.5 + idleBob };
  const supportShoulder: Vec2 = { x: facing * 0.06, y: -1.47 + idleBob };
  const weaponHand: Vec2 = { x: facing * 0.62, y: HANG_LEDGE_Y - 0.03 };
  const supportHand: Vec2 = { x: facing * 0.48, y: HANG_LEDGE_Y - 0.04 };
  // 銃口は肩→手の延長(縁の上へ抜ける向き)
  const armDx = weaponHand.x - weaponShoulder.x;
  const armDy = weaponHand.y - weaponShoulder.y;
  const armLen = Math.hypot(armDx, armDy) || 1;
  const leftFoot: Vec2 = { x: -facing * 0.16, y: 0 };
  const rightFoot: Vec2 = { x: facing * 0.02, y: -0.06 };
  return {
    head,
    neck,
    hip,
    leftKnee: { x: hip.x - facing * 0.04, y: -0.34 + idleBob * 0.5 },
    rightKnee: { x: hip.x + facing * 0.12, y: -0.36 + idleBob * 0.5 },
    leftFoot,
    rightFoot,
    weaponShoulder,
    supportShoulder,
    weaponHand,
    supportHand,
    muzzle: {
      x: weaponHand.x + (armDx / armLen) * 0.3,
      y: weaponHand.y + (armDy / armLen) * 0.3,
    },
    coatSwing: 0,
    indicator: 0.72 + Math.sin(timeSec * 4.2) * 0.18,
  };
}

export function calculatePlayerPose(
  facing: 1 | -1,
  walkPhase: number,
  isWalking: boolean,
  aimAngle: number,
  timeSec: number,
  hanging = false,
): PlayerPose {
  // 掴まり中は歩行・照準のポーズ決定に乗らず、固定のぶら下がりポーズにする
  if (hanging) return hangingPose(facing, timeSec);
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
