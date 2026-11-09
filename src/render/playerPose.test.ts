import { describe, expect, it } from 'vitest';
import { CLIMB_UP_POSE_TIME, LAND_POSE_TIME } from '../entities/player';
import {
  calculatePlayerPose,
  climbUpCrouch,
  GROUNDED_MOTION,
  landingSink,
  PLAYER_DRAW_HEIGHT_TILES,
  PLAYER_FEET_OFFSET_TILES,
  type PlayerPose,
  type PoseMotion,
  poseMuzzleWorld,
  type Vec2,
} from './playerPose';

const magnitude = (vector: Vec2): number => Math.hypot(vector.x, vector.y);
/** 接地・梯子外・タイマなしを基準に一部だけ上書きした運動状態 */
const motion = (over: Partial<PoseMotion>): PoseMotion => ({ ...GROUNDED_MOTION, ...over });
const allValues = (pose: PlayerPose): number[] =>
  Object.values(pose).flatMap((part) => (typeof part === 'number' ? [part] : [part.x, part.y]));
/** 2 つのポーズの全成分の最大差 */
const maxDiff = (a: PlayerPose, b: PlayerPose): number => {
  const va = allValues(a);
  const vb = allValues(b);
  let m = 0;
  for (let i = 0; i < va.length; i++) m = Math.max(m, Math.abs(va[i] - vb[i]));
  return m;
};
const muzzleDir = (pose: PlayerPose): Vec2 => {
  const v = { x: pose.muzzle.x - pose.weaponHand.x, y: pose.muzzle.y - pose.weaponHand.y };
  const len = magnitude(v);
  return { x: v.x / len, y: v.y / len };
};

describe('calculatePlayerPose', () => {
  it('keeps the 2.25-tile silhouette grounded and inside its height envelope', () => {
    expect(PLAYER_DRAW_HEIGHT_TILES).toBe(2.25);
    const phases = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
    const times = [0, Math.PI / (2 * 2.2), (3 * Math.PI) / (2 * 2.2)];

    for (const facing of [1, -1] as const) {
      for (const phase of phases) {
        for (const timeSec of times) {
          const pose = calculatePlayerPose(facing, phase, true, 0, timeSec);

          expect(pose.leftFoot.y).toBeGreaterThanOrEqual(-0.14);
          expect(pose.leftFoot.y).toBeLessThanOrEqual(0);
          expect(pose.rightFoot.y).toBeGreaterThanOrEqual(-0.14);
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

describe('calculatePlayerPose 崖つかみのポーズ(段階 2)', () => {
  /** 物理ボディ 1.75 + 掴まり中の沈み 0.25 = 縁の上面はポーズ原点から 2.0 上 */
  const ledgeY = -2.0;

  it('両手が縁の上面(体の側面より外)にかかり、頭は縁より下に収まる', () => {
    for (const facing of [1, -1] as const) {
      const pose = calculatePlayerPose(facing, 1.3, true, 0.5, 0.7, true);
      for (const hand of [pose.weaponHand, pose.supportHand]) {
        expect(hand.y).toBeLessThanOrEqual(ledgeY);
        expect(hand.y).toBeGreaterThan(ledgeY - 0.1);
        expect(hand.x * facing).toBeGreaterThan(0.375); // 体の側面(w/2)を越えて壁側へ
      }
      expect(pose.head.y - 0.15).toBeGreaterThan(ledgeY); // 頭頂が縁の上面より下
      expect(Math.max(pose.leftFoot.y, pose.rightFoot.y)).toBeLessThanOrEqual(0);
      expect(pose.coatSwing).toBe(0);
      for (const value of Object.values(pose).flatMap((part) =>
        typeof part === 'number' ? [part] : [part.x, part.y],
      )) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it('歩行位相と照準に依らず同じポーズになり、左右は鏡像', () => {
    const a = calculatePlayerPose(1, 0, false, 0, 0.4, true);
    const b = calculatePlayerPose(1, 2.5, true, -1.2, 0.4, true);
    expect(a).toEqual(b);
    const left = calculatePlayerPose(-1, 0, false, 0, 0.4, true);
    expect(left.head.x).toBeCloseTo(-a.head.x);
    expect(left.weaponHand.x).toBeCloseTo(-a.weaponHand.x);
    expect(left.weaponHand.y).toBeCloseTo(a.weaponHand.y);
    expect(left.leftFoot.x).toBeCloseTo(-a.leftFoot.x);
  });

  it('hanging を渡さなければ従来のポーズのまま', () => {
    expect(calculatePlayerPose(1, 0.7, true, 0.3, 0.4)).toEqual(calculatePlayerPose(1, 0.7, true, 0.3, 0.4, false));
    expect(poseMuzzleWorld(10, 10, 1, 0, false, 0, 0)).toEqual(poseMuzzleWorld(10, 10, 1, 0, false, 0, 0, false));
  });

  it('掴まりは運動状態(空中・梯子・タイマ)より優先される', () => {
    const plain = calculatePlayerPose(1, 0, false, 0, 0.4, true);
    const busy = calculatePlayerPose(1, 0, false, 0, 0.4, true, motion({
      onGround: false, vy: 12, onLadder: true, climbPhase: 1, landT: LAND_POSE_TIME, landVy: 25, climbUpT: CLIMB_UP_POSE_TIME,
    }));
    expect(busy).toEqual(plain);
  });
});

describe('calculatePlayerPose 運動状態(アニメーション作り込み 2026-11-09)', () => {
  it('motion を省略すると GROUNDED_MOTION と同じで、従来の静止・歩行ポーズのまま', () => {
    for (const walking of [false, true]) {
      expect(calculatePlayerPose(1, 1.1, walking, 0.3, 0.7, false, GROUNDED_MOTION))
        .toEqual(calculatePlayerPose(1, 1.1, walking, 0.3, 0.7));
    }
    expect(poseMuzzleWorld(3, 8, -1, 0.5, true, 1, 0.2, false, GROUNDED_MOTION))
      .toEqual(poseMuzzleWorld(3, 8, -1, 0.5, true, 1, 0.2));
  });

  describe('梯子', () => {
    const ladder = (phase: number, vy: number, facing: 1 | -1 = 1, timeSec = 0) =>
      calculatePlayerPose(facing, 0, false, 0.3, timeSec, false, motion({ onLadder: true, onGround: false, climbPhase: phase, vy }));

    it('昇降中は腕が位相で交互に上の段へ伸びる', () => {
      const a = ladder(Math.PI / 2, -4);
      expect(a.weaponHand.y).toBeLessThan(a.supportHand.y); // 武器側の手が上
      const b = ladder((3 * Math.PI) / 2, -4);
      expect(b.weaponHand.y).toBeGreaterThan(b.supportHand.y); // 入れ替わる
      expect(a.weaponHand.y).toBeCloseTo(b.supportHand.y);
      // 両手とも頭の高さ以上(頭より上の段を掴む)
      for (const pose of [a, b]) {
        expect(Math.min(pose.weaponHand.y, pose.supportHand.y)).toBeLessThan(pose.head.y);
      }
    });

    it('昇降中は脚が交互に段を踏み替え、上段を踏む脚ほど膝が前へ出る', () => {
      const a = ladder(0, 4);
      expect(a.leftFoot.y).toBeLessThan(a.rightFoot.y); // 左足が上段
      expect(a.leftKnee.x).toBeGreaterThan(a.rightKnee.x);
      const b = ladder(Math.PI, 4);
      expect(b.rightFoot.y).toBeLessThan(b.leftFoot.y);
      expect(b.rightKnee.x).toBeGreaterThan(b.leftKnee.x);
      // 中間では両足とも浮いている(段の間)
      const mid = ladder(Math.PI / 2, 4);
      expect(mid.leftFoot.y).toBeLessThan(0);
      expect(mid.rightFoot.y).toBeLessThan(0);
      expect(Math.max(a.leftFoot.y, a.rightFoot.y)).toBeLessThanOrEqual(0);
    });

    it('昇降していないときは位相に依らず同じしがみつき静止ポーズで、昇り始め(位相 0)と連続', () => {
      const still = ladder(0, 0);
      expect(ladder(2.2, 0)).toEqual(still);
      expect(maxDiff(ladder(0, -4), still)).toBeLessThan(1e-9); // timeSec = 0 なので bob も 0
      expect(still.coatSwing).toBe(0);
    });

    it('左右は鏡像で、値は有限、頭は描画高さの範囲内', () => {
      for (const phase of [0, 0.9, Math.PI / 2, Math.PI, 4.5]) {
        const r = ladder(phase, -4, 1, 0.7);
        const l = ladder(phase, -4, -1, 0.7);
        expect(l.head.x).toBeCloseTo(-r.head.x);
        expect(l.weaponHand.x).toBeCloseTo(-r.weaponHand.x);
        expect(l.weaponHand.y).toBeCloseTo(r.weaponHand.y);
        expect(l.leftFoot.x).toBeCloseTo(-r.leftFoot.x);
        expect(l.leftKnee.x).toBeCloseTo(-r.leftKnee.x);
        expect(r.head.y).toBeGreaterThanOrEqual(-PLAYER_DRAW_HEIGHT_TILES);
        for (const v of allValues(r)) expect(Number.isFinite(v)).toBe(true);
      }
    });

    it('梯子上でも接地していれば(床面で梯子の列に立つ)地上のポーズになる', () => {
      const onFloor = calculatePlayerPose(1, 0.7, true, 0.3, 0.4, false, motion({ onLadder: true, onGround: true, climbPhase: 2 }));
      expect(onFloor).toEqual(calculatePlayerPose(1, 0.7, true, 0.3, 0.4));
    });
  });

  describe('空中', () => {
    const air = (vy: number, aim = 0, facing: 1 | -1 = 1) =>
      calculatePlayerPose(facing, 0, false, aim, 0.4, false, motion({ onGround: false, vy }));

    it('上昇では脚を後ろへ畳み、落下では床へ向けて伸ばす', () => {
      const rising = air(-12);
      const apex = air(0);
      const falling = air(20);
      // 上昇: 両足が大きく浮き、頂点より後ろ
      expect(rising.leftFoot.y).toBeLessThan(-0.25);
      expect(rising.rightFoot.y).toBeLessThan(-0.25);
      expect(rising.leftFoot.x).toBeLessThan(apex.leftFoot.x);
      expect(rising.rightFoot.x).toBeLessThan(apex.rightFoot.x);
      // 膝は畳むほど前上へ
      expect(rising.leftKnee.x).toBeGreaterThan(apex.leftKnee.x);
      // 落下: 足はほぼ床の高さまで伸び、前脚が前へ
      expect(falling.leftFoot.y).toBeGreaterThan(-0.02);
      expect(falling.rightFoot.y).toBeGreaterThan(-0.02);
      expect(falling.rightFoot.x).toBeGreaterThan(apex.rightFoot.x);
      // 体: 上昇で伸び(頭が高い)、落下で前傾(頭が前)
      expect(rising.head.y).toBeLessThan(apex.head.y);
      expect(falling.head.x).toBeGreaterThan(rising.head.x);
      expect(falling.neck.x).toBeGreaterThan(apex.neck.x);
      // 落下で肩が少し上がる
      expect(falling.supportShoulder.y).toBeLessThan(apex.supportShoulder.y);
    });

    it('vy の閾値で切り替えず連続に補間する(頂点付近で飛ばない。速度が増すほど形が進む)', () => {
      expect(maxDiff(air(-0.05), air(0.05))).toBeLessThan(0.01);
      expect(maxDiff(air(-3), air(-3.1))).toBeLessThan(0.02);
      const feetY = (vy: number) => air(vy).leftFoot.y;
      expect(feetY(-13)).toBeLessThan(feetY(-6));
      expect(feetY(-6)).toBeLessThan(feetY(0));
      expect(feetY(0)).toBeLessThan(feetY(8));
      expect(feetY(8)).toBeLessThan(feetY(25));
      // 最大落下でも上限に収まる(tanh の飽和)
      expect(maxDiff(air(25), air(60))).toBeLessThan(0.02);
    });

    it('照準の腕は空中でも照準方向を保ち、銃口は手から照準方向へ出る', () => {
      for (const vy of [-12, 0, 15]) {
        for (const aim of [-Math.PI / 2, -0.6, 0, 0.8, Math.PI]) {
          const pose = air(vy, aim);
          const dir = muzzleDir(pose);
          expect(dir.x).toBeCloseTo(Math.cos(aim));
          expect(dir.y).toBeCloseTo(Math.sin(aim));
          const hand = { x: pose.weaponHand.x - pose.weaponShoulder.x, y: pose.weaponHand.y - pose.weaponShoulder.y };
          expect(hand.x / magnitude(hand)).toBeCloseTo(Math.cos(aim));
        }
      }
    });

    it('左右は鏡像で、頭は描画高さの範囲内、値は有限', () => {
      for (const vy of [-13, -5, 0, 4, 25]) {
        const r = air(vy, 0.3, 1);
        const l = air(vy, 0.3, -1);
        expect(l.head.x).toBeCloseTo(-r.head.x);
        expect(l.hip.x).toBeCloseTo(-r.hip.x);
        expect(l.leftFoot.x).toBeCloseTo(-r.leftFoot.x);
        expect(l.rightKnee.x).toBeCloseTo(-r.rightKnee.x);
        expect(l.rightKnee.y).toBeCloseTo(r.rightKnee.y);
        expect(r.head.y).toBeGreaterThanOrEqual(-PLAYER_DRAW_HEIGHT_TILES);
        expect(Math.max(r.leftFoot.y, r.rightFoot.y)).toBeLessThanOrEqual(0);
        for (const v of allValues(r)) expect(Number.isFinite(v)).toBe(true);
      }
    });
  });

  describe('着地の沈み込み', () => {
    const ground = (landT: number, landVy: number, walking = false) =>
      calculatePlayerPose(1, 1.3, walking, 0.2, 0.4, false, motion({ landT, landVy }));

    it('着地直後が最も沈み、時間で戻る。小さな段差(落下速度 5 未満)では沈まない', () => {
      const base = ground(0, 0);
      const just = ground(LAND_POSE_TIME, 16);
      const half = ground(LAND_POSE_TIME / 2, 16);
      expect(just.hip.y).toBeGreaterThan(base.hip.y); // 腰が下がる(下が正)
      expect(half.hip.y).toBeGreaterThan(base.hip.y);
      expect(half.hip.y - base.hip.y).toBeCloseTo((just.hip.y - base.hip.y) / 2);
      expect(ground(0, 16)).toEqual(base);
      expect(ground(LAND_POSE_TIME, 4.9)).toEqual(base);
      // 上半身も下がり、膝は前へ出る。足は床のまま
      expect(just.head.y).toBeGreaterThan(base.head.y);
      expect(just.leftKnee.x).toBeGreaterThan(base.leftKnee.x);
      expect(just.leftFoot).toEqual(base.leftFoot);
      expect(just.rightFoot).toEqual(base.rightFoot);
    });

    it('深さは落下速度で増え、最大落下(25)で上限に達する', () => {
      expect(landingSink(LAND_POSE_TIME, 4.9)).toBe(0);
      expect(landingSink(LAND_POSE_TIME, 5)).toBeGreaterThan(0);
      expect(landingSink(LAND_POSE_TIME, 12)).toBeGreaterThan(landingSink(LAND_POSE_TIME, 6));
      expect(landingSink(LAND_POSE_TIME, 25)).toBeGreaterThan(landingSink(LAND_POSE_TIME, 12));
      expect(landingSink(LAND_POSE_TIME, 100)).toBe(landingSink(LAND_POSE_TIME, 25));
      expect(landingSink(LAND_POSE_TIME, 25)).toBeLessThanOrEqual(0.25);
      expect(landingSink(0, 25)).toBe(0);
      expect(landingSink(LAND_POSE_TIME / 4, 25)).toBeCloseTo(landingSink(LAND_POSE_TIME, 25) / 4);
    });

    it('歩行と重なっても足の gait はそのままで、体だけ沈む', () => {
      const walk = ground(0, 0, true);
      const landWalk = ground(LAND_POSE_TIME, 20, true);
      expect(landWalk.leftFoot).toEqual(walk.leftFoot);
      expect(landWalk.rightFoot).toEqual(walk.rightFoot);
      expect(landWalk.coatSwing).toBe(walk.coatSwing);
      expect(landWalk.hip.y).toBeGreaterThan(walk.hip.y);
      expect(landWalk.hip.x).toBe(walk.hip.x);
      // 照準は保たれる
      expect(muzzleDir(landWalk).x).toBeCloseTo(Math.cos(0.2));
      expect(muzzleDir(landWalk).y).toBeCloseTo(Math.sin(0.2));
    });
  });

  describe('よじ登りの復帰', () => {
    const recover = (climbUpT: number, over: Partial<PoseMotion> = {}) =>
      calculatePlayerPose(1, 0.6, false, 0.2, 0.4, false, motion({ climbUpT, ...over }));

    it('登った直後は縁に手をついた屈み(腰が低く、手が床近く、頭が前下)', () => {
      const base = recover(0);
      const crouch = recover(CLIMB_UP_POSE_TIME);
      expect(crouch.hip.y).toBeGreaterThan(-0.6);
      expect(crouch.hip.y).toBeGreaterThan(base.hip.y + 0.25);
      expect(crouch.weaponHand.y).toBeGreaterThan(-0.2);
      expect(crouch.supportHand.y).toBeGreaterThan(-0.2);
      expect(crouch.head.y).toBeGreaterThan(-1.7);
      expect(crouch.head.x).toBeGreaterThan(base.head.x + 0.2);
      expect(Math.max(crouch.leftFoot.y, crouch.rightFoot.y)).toBeLessThanOrEqual(0);
      for (const v of allValues(crouch)) expect(Number.isFinite(v)).toBe(true);
    });

    it('前半は屈んだまま、後半で滑らかに立ち、終わりは土台のポーズに一致する', () => {
      expect(climbUpCrouch(CLIMB_UP_POSE_TIME)).toBe(1);
      expect(climbUpCrouch(CLIMB_UP_POSE_TIME * 0.7)).toBe(1); // 経過 30% はまだ屈み
      const late = climbUpCrouch(CLIMB_UP_POSE_TIME * 0.3);
      expect(late).toBeGreaterThan(0);
      expect(late).toBeLessThan(1);
      expect(climbUpCrouch(CLIMB_UP_POSE_TIME * 0.1)).toBeLessThan(late);
      expect(climbUpCrouch(0)).toBe(0);
      const base = recover(0);
      expect(maxDiff(recover(0.005), base)).toBeLessThan(0.05);
      expect(recover(0)).toEqual(base);
      // 立ち上がりは単調
      let prev = recover(CLIMB_UP_POSE_TIME * 0.5).hip.y;
      for (const f of [0.4, 0.3, 0.2, 0.1, 0.05]) {
        const y = recover(CLIMB_UP_POSE_TIME * f).hip.y;
        expect(y).toBeLessThanOrEqual(prev);
        prev = y;
      }
    });

    it('直後に跳んでも空中ポーズへ屈みを混ぜて重ねる(飛ばない)', () => {
      const air = recover(0, { onGround: false, vy: -10 });
      const mixed = recover(CLIMB_UP_POSE_TIME * 0.3, { onGround: false, vy: -10 });
      const crouch = recover(CLIMB_UP_POSE_TIME);
      // 混合は空中ポーズと屈みの間にある
      expect(mixed.hip.y).toBeGreaterThan(air.hip.y);
      expect(mixed.hip.y).toBeLessThan(crouch.hip.y);
      expect(recover(0, { onGround: false, vy: -10 })).toEqual(air);
    });

    it('左右は鏡像', () => {
      const r = calculatePlayerPose(1, 0, false, 0, 0.4, false, motion({ climbUpT: CLIMB_UP_POSE_TIME }));
      const l = calculatePlayerPose(-1, 0, false, 0, 0.4, false, motion({ climbUpT: CLIMB_UP_POSE_TIME }));
      expect(l.hip.x).toBeCloseTo(-r.hip.x);
      expect(l.head.x).toBeCloseTo(-r.head.x);
      expect(l.weaponHand.x).toBeCloseTo(-r.weaponHand.x);
      expect(l.weaponHand.y).toBeCloseTo(r.weaponHand.y);
      expect(l.leftKnee.x).toBeCloseTo(-r.leftKnee.x);
    });
  });

  it('poseMuzzleWorld は運動状態を含めて描画アンカー計算と一致する', () => {
    const states: PoseMotion[] = [
      motion({ onGround: false, vy: -9 }),
      motion({ onGround: false, vy: 14 }),
      motion({ onLadder: true, onGround: false, climbPhase: 1.2, vy: -4 }),
      motion({ landT: LAND_POSE_TIME, landVy: 18 }),
      motion({ climbUpT: CLIMB_UP_POSE_TIME * 0.5 }),
    ];
    for (const m of states) {
      const pose = calculatePlayerPose(-1, 0.4, false, 0.9, 0.7, false, m);
      const w = poseMuzzleWorld(3.25, 8.5, -1, 0.4, false, 0.9, 0.7, false, m);
      expect(w.x).toBeCloseTo(3.25 + pose.muzzle.x);
      expect(w.y).toBeCloseTo(8.5 + PLAYER_FEET_OFFSET_TILES + pose.muzzle.y);
    }
  });
});

describe('poseMuzzleWorld(発射原点用の銃口ワールド座標)', () => {
  it('静止・右向き水平では中心の 1.17 前方・0.745 上方が銃口になる', () => {
    const m = poseMuzzleWorld(10, 10, 1, 0, false, 0, 0);
    expect(m.x).toBeCloseTo(11.17);
    expect(m.y).toBeCloseTo(10 - 0.745);
  });

  it('描画アンカー計算と一致する(中心 + 足元オフセット + ポーズの銃口)', () => {
    const angles = [-Math.PI / 2, -Math.PI / 4, 0, Math.PI / 4, Math.PI / 2, Math.PI];
    for (const facing of [1, -1] as const) {
      for (const angle of angles) {
        for (const walking of [false, true]) {
          const pose = calculatePlayerPose(facing, 1.1, walking, angle, 0.7);
          const m = poseMuzzleWorld(3.25, 8.5, facing, 1.1, walking, angle, 0.7);
          expect(m.x).toBeCloseTo(3.25 + pose.muzzle.x);
          expect(m.y).toBeCloseTo(8.5 + PLAYER_FEET_OFFSET_TILES + pose.muzzle.y);
        }
      }
    }
  });

  it('真上照準では銃口が中心より大きく上へ来る(腰固定にはならない)', () => {
    const m = poseMuzzleWorld(10, 10, 1, 0, false, -Math.PI / 2, 0);
    expect(m.y).toBeCloseTo(10 - 1.685);
    expect(m.x).toBeCloseTo(10.23);
  });
});
