import {
  footCyclePosition,
  gaitBodyOffset,
  gaitFoot,
  stepFraction,
} from '../core/gait';
import { CLIMB_UP_POSE_TIME, LAND_POSE_TIME, type Player } from '../entities/player';

export const PLAYER_DRAW_HEIGHT_TILES = 2.25;

/**
 * 体の中心から足元(ポーズ原点)までの縦オフセット(タイル)。
 * 物理ボディの高さ 1.75 の半分で、描画(playerSprite の feetY)と
 * 発射原点の計算で同じ値を共有する(二重管理で銃口がずれるのを防ぐ)。
 */
export const PLAYER_FEET_OFFSET_TILES = 0.875;

/**
 * ポーズ決定に使う運動状態(設計 2026-11-09-anim-polish)。Player の描画専用フィールドをそのまま写す。
 * 省略時(GROUNDED_MOTION)は「接地・梯子外・タイマなし」で、従来のポーズ計算と完全に一致する。
 * 掴まり(hanging)は既存の省略可能引数のまま残し、ここには含めない
 */
export interface PoseMotion {
  /** 梯子ポーズで描くべきか(Player.onLadderNow) */
  onLadder: boolean;
  /** 梯子昇降の位相(Player.climbPhase。段 1 つ = π) */
  climbPhase: number;
  /** 接地しているか(body.onGround)。false なら空中ポーズ */
  onGround: boolean;
  /** 鉛直速度(タイル/秒、下が正)。空中ポーズの補間と、梯子の昇降中かの判定に使う */
  vy: number;
  /** 着地の沈み込みの残り時間(秒、Player.landT) */
  landT: number;
  /** 着地時の落下速度(Player.landVy) */
  landVy: number;
  /** よじ登り復帰ポーズの残り時間(秒、Player.climbUpT) */
  climbUpT: number;
}

/** 接地・梯子外・タイマなし。motion を省略したときの既定で、従来のポーズと同一になる */
export const GROUNDED_MOTION: PoseMotion = {
  onLadder: false,
  climbPhase: 0,
  onGround: true,
  vy: 0,
  landT: 0,
  landVy: 0,
  climbUpT: 0,
};

/** Player の描画専用フィールドから PoseMotion を組む(renderer と main の発射原点で同じ値を使う) */
export function poseMotionOf(player: Player): PoseMotion {
  return {
    onLadder: player.onLadderNow,
    climbPhase: player.climbPhase,
    onGround: player.body.onGround,
    vy: player.body.vy,
    landT: player.landT,
    landVy: player.landVy,
    climbUpT: player.climbUpT,
  };
}

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
  motion: PoseMotion = GROUNDED_MOTION,
): Vec2 {
  const pose = calculatePlayerPose(facing, walkPhase, isWalking, aimAngle, timeSec, hanging, motion);
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

// ---- アニメーション作り込み(設計 2026-11-09-anim-polish) ----
/** 梯子: 手の基準高さ(頭の少し上の段)、位相で上下に振れる量、段の踏み替えで足が上がる量(タイル) */
const LADDER_HAND_Y = -1.98;
const LADDER_HAND_SWING_TILES = 0.2;
const LADDER_FOOT_STEP_TILES = 0.3;
/**
 * 空中: vy をならす尺度(タイル/秒)。tanh(vy / 尺度) を -1..1 の連続な相として使い、
 * 閾値で切り替えない(ジャンプ初速 13 で約 -0.94、最大落下 25 でほぼ 1)
 */
const AIR_VY_SCALE = 7.5;
/** 着地: 沈み込みの上限(タイル)。これ未満の落下速度では沈まず(小さな段差降り)、上限速度で最大になる */
const LAND_SINK_MAX_TILES = 0.22;
/** 着地音の LAND_MIN_VY と同じ値(音が鳴る着地だけ沈む) */
const LAND_SINK_MIN_VY = 5;
/** entities/player の MAX_FALL */
const LAND_SINK_FULL_VY = 25;
/** 沈む最小の着地でも上限のこの割合は沈む(見えないほど浅くならないように) */
const LAND_SINK_FLOOR = 0.3;
/** よじ登り復帰: 経過のこの割合までは屈んだままで、残りで滑らかに立つ */
const CLIMB_UP_HOLD_FRACTION = 0.4;

const smoothstep = (v: number): number => {
  const t = v < 0 ? 0 : v > 1 ? 1 : v;
  return t * t * (3 - 2 * t);
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpVec = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

/** 2 つのポーズを t(0=a, 1=b)で線形に混ぜる。よじ登り復帰の屈みを土台のポーズに重ねるのに使う */
function lerpPose(a: PlayerPose, b: PlayerPose, t: number): PlayerPose {
  return {
    head: lerpVec(a.head, b.head, t),
    neck: lerpVec(a.neck, b.neck, t),
    hip: lerpVec(a.hip, b.hip, t),
    leftKnee: lerpVec(a.leftKnee, b.leftKnee, t),
    rightKnee: lerpVec(a.rightKnee, b.rightKnee, t),
    leftFoot: lerpVec(a.leftFoot, b.leftFoot, t),
    rightFoot: lerpVec(a.rightFoot, b.rightFoot, t),
    weaponShoulder: lerpVec(a.weaponShoulder, b.weaponShoulder, t),
    supportShoulder: lerpVec(a.supportShoulder, b.supportShoulder, t),
    weaponHand: lerpVec(a.weaponHand, b.weaponHand, t),
    supportHand: lerpVec(a.supportHand, b.supportHand, t),
    muzzle: lerpVec(a.muzzle, b.muzzle, t),
    coatSwing: lerp(a.coatSwing, b.coatSwing, t),
    indicator: lerp(a.indicator, b.indicator, t),
  };
}

/** 胸のインジケータの明滅(全ポーズ共通) */
const indicatorPulse = (timeSec: number): number => 0.72 + Math.sin(timeSec * 4.2) * 0.18;

/** 武器を使わないポーズの銃口: 肩→手の延長に 0.3 置く(掴まりの前例。発射原点との整合は問わない) */
function muzzleAlongArm(shoulder: Vec2, hand: Vec2): Vec2 {
  const armDx = hand.x - shoulder.x;
  const armDy = hand.y - shoulder.y;
  const armLen = Math.hypot(armDx, armDy) || 1;
  return {
    x: hand.x + (armDx / armLen) * 0.3,
    y: hand.y + (armDy / armLen) * 0.3,
  };
}

/**
 * 着地の沈み込みの量(タイル、下が正)。着地直後が最大で、残り時間に比例して戻る。
 * 落下速度が LAND_SINK_MIN_VY 未満なら 0、LAND_SINK_FULL_VY で上限
 */
export function landingSink(landT: number, landVy: number): number {
  if (landT <= 0 || landVy < LAND_SINK_MIN_VY) return 0;
  const k = Math.min(1, (landVy - LAND_SINK_MIN_VY) / (LAND_SINK_FULL_VY - LAND_SINK_MIN_VY));
  const strength = LAND_SINK_FLOOR + (1 - LAND_SINK_FLOOR) * k;
  const remain = Math.min(1, landT / LAND_POSE_TIME);
  return LAND_SINK_MAX_TILES * strength * remain;
}

/**
 * よじ登り復帰の屈みの度合い(0=通常、1=屈み切り)。登った瞬間から
 * CLIMB_UP_HOLD_FRACTION までは 1 のまま、残りで滑らかに 0 へ戻る
 */
export function climbUpCrouch(climbUpT: number): number {
  if (climbUpT <= 0) return 0;
  const progress = 1 - Math.min(1, climbUpT / CLIMB_UP_POSE_TIME);
  return 1 - smoothstep((progress - CLIMB_UP_HOLD_FRACTION) / (1 - CLIMB_UP_HOLD_FRACTION));
}

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
    // 銃口は肩→手の延長(縁の上へ抜ける向き)
    muzzle: muzzleAlongArm(weaponShoulder, weaponHand),
    coatSwing: 0,
    indicator: indicatorPulse(timeSec),
  };
}

/**
 * 梯子のポーズ。横向きのまま梯子(体の中心の列)にしがみつく。
 * 昇降中は腕が位相で交互に上の段へ伸び、脚は交互に段を踏み替える(上段を踏む脚ほど膝が前へ出る)。
 * 昇降していなければ位相 0 と同じしがみつき静止ポーズ(腕は同じ高さ、左足が上段)なので、
 * 昇り始めでポーズが飛ばない。止まった瞬間は歩行と同じく静止ポーズへ切り替わる。
 * 体は実際に動くので昇降中は呼吸の bob を乗せない。銃口は腕の延長(掴まりと同じ扱い)
 */
function ladderPose(facing: 1 | -1, timeSec: number, climbPhase: number, vy: number): PlayerPose {
  const climbing = vy !== 0;
  const idleBob = climbing ? 0 : Math.sin(timeSec * 2.2) * IDLE_BOB_AMPLITUDE;
  // + で武器側の手が上・支え手が下。足は cos で、腕と四分の一周期ずれて踏み替える
  const armSwing = climbing ? Math.sin(climbPhase) : 0;
  const leftStep = climbing ? 0.5 + 0.5 * Math.cos(climbPhase) : 1;
  const rightStep = 1 - leftStep;
  const hip: Vec2 = { x: -facing * 0.03, y: -0.86 + idleBob };
  const neck: Vec2 = { x: facing * 0.04, y: -1.76 + idleBob };
  const head: Vec2 = { x: facing * 0.07, y: -2.02 + idleBob };
  const weaponShoulder: Vec2 = { x: facing * 0.17, y: -1.64 + idleBob };
  const supportShoulder: Vec2 = { x: -facing * 0.05, y: -1.6 + idleBob };
  // 手は頭の上の段にかかり、上へ伸ばす側ほど少し前へ出る
  const weaponHand: Vec2 = {
    x: facing * (0.24 + 0.05 * armSwing),
    y: LADDER_HAND_Y - LADDER_HAND_SWING_TILES * armSwing,
  };
  const supportHand: Vec2 = {
    x: facing * (0.12 - 0.05 * armSwing),
    y: LADDER_HAND_Y + LADDER_HAND_SWING_TILES * armSwing,
  };
  const leftFoot: Vec2 = { x: -facing * 0.06, y: -LADDER_FOOT_STEP_TILES * leftStep };
  const rightFoot: Vec2 = { x: facing * 0.1, y: -LADDER_FOOT_STEP_TILES * rightStep };
  const knee = (foot: Vec2, step: number): Vec2 => ({
    x: (hip.x + foot.x) / 2 + facing * (0.08 + 0.18 * step),
    y: (hip.y + foot.y) / 2 - 0.02 - 0.04 * step,
  });
  return {
    head,
    neck,
    hip,
    leftKnee: knee(leftFoot, leftStep),
    rightKnee: knee(rightFoot, rightStep),
    leftFoot,
    rightFoot,
    weaponShoulder,
    supportShoulder,
    weaponHand,
    supportHand,
    muzzle: muzzleAlongArm(weaponShoulder, weaponHand),
    coatSwing: 0,
    indicator: indicatorPulse(timeSec),
  };
}

/**
 * 空中のポーズ。vy の連続関数(tanh)で 上昇 ↔ 頂点 ↔ 落下 を補間する。
 * 上昇: 両脚を後ろへ畳み(足は後ろ上、膝は前上)、体が少し伸びる。
 * 頂点: 中立(足を軽く浮かせた立ち姿)。
 * 落下: 脚を床へ向けて伸ばし前脚を前へ出す。肩が少し上がり、首・頭が前へ出て前傾する。
 * 照準の腕(武器の肩→手→銃口)は地上と同じ照準追従を保つ。体が動くので呼吸の bob は乗せない
 */
function airbornePose(facing: 1 | -1, aimAngle: number, timeSec: number, vy: number): PlayerPose {
  const t = Math.tanh(vy / AIR_VY_SCALE);
  const rise = Math.max(0, -t);
  const fall = Math.max(0, t);
  const hip: Vec2 = { x: facing * (0.035 + 0.03 * fall), y: -0.83 - 0.05 * rise };
  const neck: Vec2 = {
    x: facing * (0.015 + 0.02 * rise + 0.09 * fall),
    y: -1.76 - 0.04 * rise + 0.02 * fall,
  };
  const head: Vec2 = {
    x: facing * (0.05 + 0.03 * rise + 0.13 * fall),
    y: -2.04 - 0.04 * rise + 0.03 * fall,
  };
  const leftFoot: Vec2 = {
    x: facing * (-0.11 - 0.14 * rise - 0.06 * fall),
    y: -0.1 - 0.22 * rise + 0.1 * fall,
  };
  const rightFoot: Vec2 = {
    x: facing * (0.11 - 0.08 * rise + 0.14 * fall),
    y: -0.06 - 0.26 * rise + 0.06 * fall,
  };
  // 膝は畳むほど前上へ。後脚(左)より前脚(右)を少し前へ出して重なりを避ける
  const knee = (foot: Vec2, forward: number): Vec2 => ({
    x: (hip.x + foot.x) / 2 + facing * (forward + 0.22 * rise + 0.03 * fall),
    y: (hip.y + foot.y) / 2 - 0.04 - 0.08 * rise,
  });
  const aim = { x: Math.cos(aimAngle), y: Math.sin(aimAngle) };
  const weaponShoulder: Vec2 = {
    x: facing * (0.23 + 0.07 * fall),
    y: -1.62 - 0.03 * rise - 0.04 * fall,
  };
  const supportShoulder: Vec2 = {
    x: facing * (-0.19 + 0.07 * fall),
    y: -1.58 - 0.03 * rise - 0.05 * fall,
  };
  const weaponHand: Vec2 = {
    x: weaponShoulder.x + aim.x * 0.38,
    y: weaponShoulder.y + aim.y * 0.38,
  };
  const supportHand: Vec2 = {
    x: weaponHand.x - aim.x * 0.24 - aim.y * 0.09,
    y: weaponHand.y - aim.y * 0.24 + aim.x * 0.09,
  };
  return {
    head,
    neck,
    hip,
    leftKnee: knee(leftFoot, 0.07),
    rightKnee: knee(rightFoot, 0.1),
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
    // コートは上昇で後ろへ流れ、落下でも前傾の後ろへ引かれる(どちらも後ろ向き、頂点で 0)
    coatSwing: -0.07 * rise - 0.04 * fall,
    indicator: indicatorPulse(timeSec),
  };
}

/**
 * よじ登り直後の屈み(縁の上面に両手をついて腰を落とした形)。
 * climbUpCrouch の度合いで土台のポーズ(地上・空中・梯子)に重ねる。銃口は腕の延長
 */
function climbUpCrouchPose(facing: 1 | -1, timeSec: number): PlayerPose {
  const hip: Vec2 = { x: -facing * 0.08, y: -0.52 };
  const neck: Vec2 = { x: facing * 0.24, y: -1.22 };
  const head: Vec2 = { x: facing * 0.34, y: -1.46 };
  const weaponShoulder: Vec2 = { x: facing * 0.34, y: -1.1 };
  const supportShoulder: Vec2 = { x: facing * 0.1, y: -1.08 };
  const weaponHand: Vec2 = { x: facing * 0.52, y: -0.1 };
  const supportHand: Vec2 = { x: facing * 0.36, y: -0.08 };
  const leftFoot: Vec2 = { x: -facing * 0.2, y: 0 };
  const rightFoot: Vec2 = { x: facing * 0.12, y: 0 };
  // 深い屈みなので膝は大きく前へ張り出す
  const knee = (foot: Vec2): Vec2 => ({
    x: (hip.x + foot.x) / 2 + facing * 0.3,
    y: (hip.y + foot.y) / 2 - 0.1,
  });
  return {
    head,
    neck,
    hip,
    leftKnee: knee(leftFoot),
    rightKnee: knee(rightFoot),
    leftFoot,
    rightFoot,
    weaponShoulder,
    supportShoulder,
    weaponHand,
    supportHand,
    muzzle: muzzleAlongArm(weaponShoulder, weaponHand),
    coatSwing: 0,
    indicator: indicatorPulse(timeSec),
  };
}

/**
 * 地上のポーズ(静止・歩行)。従来の calculatePlayerPose 本体で、着地の沈み込み sink(タイル、下が正)を
 * 足した。sink は腰をそのまま下げ、上半身はそれより少し小さく追従し(背を丸める)、膝を前へ出す。
 * 足は床に着いたままなので歩行 gait と重なっても破綻しない。sink = 0 なら従来と同一
 */
function groundPose(
  facing: 1 | -1,
  walkPhase: number,
  isWalking: boolean,
  aimAngle: number,
  timeSec: number,
  sink: number,
): PlayerPose {
  const idleBob = Math.sin(timeSec * 2.2) * IDLE_BOB_AMPLITUDE;
  // 上半身の揺れ(横揺れ・腕の反動)は sin のままでよい(地面に触れないので滑りの問題がない)。
  // 足は core/gait の非対称プロファイル(接地期は対地静止、遊脚期は速く戻る)で決める
  const sway = isWalking ? Math.sin(walkPhase) : 0;
  const bodyOffset = isWalking ? gaitBodyOffset(stepFraction(walkPhase)) : 0;
  const lean = isWalking ? WALK_LEAN_TILES : 0;
  const upperSink = sink * 0.85;
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
    y: -0.83 + idleBob + bodyOffset + sink,
  };
  const neck: Vec2 = {
    x: facing * (0.015 + sway * WALK_BODY_SWAY_TILES * 0.5 + lean * 0.8),
    y: -1.76 + idleBob + bodyOffset * 0.5 + upperSink,
  };
  const aim = { x: Math.cos(aimAngle), y: Math.sin(aimAngle) };
  const weaponShoulder: Vec2 = {
    x: facing * (0.23 - sway * WALK_ARM_RECOIL_TILES + lean * 0.8),
    y: -1.62 + idleBob + bodyOffset * 0.5 + upperSink,
  };
  const supportShoulder: Vec2 = {
    x: facing * (-0.19 - sway * WALK_ARM_RECOIL_TILES * 0.5 + lean * 0.8),
    y: -1.58 + idleBob + bodyOffset * 0.5 + upperSink,
  };
  const weaponHand: Vec2 = {
    x: weaponShoulder.x + aim.x * 0.38,
    y: weaponShoulder.y + aim.y * 0.38,
  };
  const supportHand: Vec2 = {
    x: weaponHand.x - aim.x * 0.24 - aim.y * 0.09,
    y: weaponHand.y - aim.y * 0.24 + aim.x * 0.09,
  };
  // 膝は腰-足の中点から前へ張り出し、遊脚で持ち上がるほど、また着地で沈むほど強く曲がる
  const knee = (foot: Vec2, lift: number): Vec2 => ({
    x: (hip.x + foot.x) / 2 + facing * (0.06 + lift * 0.85 + sink * 0.9),
    y: (hip.y + foot.y) / 2 - 0.03 - lift * 0.18,
  });

  return {
    head: {
      x: facing * (0.05 - sway * WALK_HEAD_STABILIZATION_TILES + lean),
      y: -2.04 + idleBob + bodyOffset * 0.5 + upperSink,
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
    indicator: indicatorPulse(timeSec),
  };
}

/**
 * プレイヤーのポーズ(純粋関数)。優先順位は
 *   掴まり ＞ よじ登り復帰(土台に重ねる) ＞ 梯子 ＞ 空中 ＞ 着地(地上に重ねる) ＞ 歩行/静止
 * - 掴まり中は他をすべて無視して固定のぶら下がりポーズ。
 * - 梯子は「梯子上かつ非接地」のとき。床面で梯子の列に立っているときは地上扱い。
 * - 空中は非接地のとき(vy で上昇〜落下を連続補間)。
 * - 着地の沈み込みは地上ポーズにだけ足す(歩行 gait と重なっても足は床のまま)。
 * - よじ登り復帰は、地上・空中・梯子のどの土台にも屈みを混ぜて重ねる(直後に跳んでも飛ばない)。
 * motion を省略すると従来(接地・梯子外・タイマなし)のポーズと同一になる
 */
export function calculatePlayerPose(
  facing: 1 | -1,
  walkPhase: number,
  isWalking: boolean,
  aimAngle: number,
  timeSec: number,
  hanging = false,
  motion: PoseMotion = GROUNDED_MOTION,
): PlayerPose {
  // 掴まり中は歩行・照準のポーズ決定に乗らず、固定のぶら下がりポーズにする
  if (hanging) return hangingPose(facing, timeSec);
  const base = motion.onLadder && !motion.onGround
    ? ladderPose(facing, timeSec, motion.climbPhase, motion.vy)
    : !motion.onGround
      ? airbornePose(facing, aimAngle, timeSec, motion.vy)
      : groundPose(
        facing,
        walkPhase,
        isWalking,
        aimAngle,
        timeSec,
        landingSink(motion.landT, motion.landVy),
      );
  const crouch = climbUpCrouch(motion.climbUpT);
  if (crouch <= 0) return base;
  return lerpPose(base, climbUpCrouchPose(facing, timeSec), crouch);
}
