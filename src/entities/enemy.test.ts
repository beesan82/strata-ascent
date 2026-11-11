import { describe, expect, it } from 'vitest';
import { TILE, type Tile } from '../world/tiles';
import {
  Walker, Flyer, nextFlyerMode, Boss, stepBossPhase, BOSS_HP, BOSS_BEAM_DAMAGE, type BossPhase,
  WALKER_W, WALKER_H, WALKER_HP, WALKER_LEG_HP, WALKER_SPEED, WALKER_LEGLESS_SPEED,
  FLYER_W, FLYER_HP, FLYER_ROTOR_HP, FLYER_CRAWL_SPEED,
} from './enemy';

const noTiles = (): Tile => TILE.AIR;
/** y=10 行が床(x は全面) */
const floorTiles = (_tx: number, ty: number): Tile => (ty === 10 ? TILE.SOLID : TILE.AIR);
/** 床は x<8 まで(崖)、y=10 行 */
const ledgeTiles = (tx: number, ty: number): Tile => (ty === 10 && tx < 8 ? TILE.SOLID : TILE.AIR);
/** 床 + x=12 列の壁 */
const wallTiles = (tx: number, ty: number): Tile => {
  if (ty === 10) return TILE.SOLID;
  if (tx === 12 && ty < 10) return TILE.SOLID;
  return TILE.AIR;
};

describe('Walker(歩行敵)', () => {
  it('床の上を巡回し、重力で着地して落ちない', () => {
    const w = new Walker(2, 8, 1);
    for (let i = 0; i < 60; i++) w.update(1 / 60, floorTiles);
    expect(w.body.onGround).toBe(true);
    expect(w.body.x).toBeGreaterThan(2);
  });

  it('壁に当たると反転する', () => {
    const w = new Walker(9, 10 - WALKER_H, 1); // 床(y=10)の上にちょうど乗る
    for (let i = 0; i < 120; i++) w.update(1 / 60, wallTiles);
    expect(w.dir).toBe(-1);
    expect(w.body.x).toBeLessThan(11.2); // 壁(x=12)へめり込まない
  });

  it('床の端で反転し、落ちない', () => {
    const w = new Walker(5, 10 - WALKER_H, 1);
    for (let i = 0; i < 240; i++) w.update(1 / 60, ledgeTiles);
    expect(w.body.y).toBeLessThan(10); // 落ちていない
    expect(w.dir).toBe(-1); // 端で折り返した
  });

  it('3 発で倒れる(hit のたびに HP が減る)', () => {
    const w = new Walker(0, 0, 1);
    expect(w.hit(1)).toBe(false);
    expect(w.hit(1)).toBe(false);
    expect(w.hit(1)).toBe(true);
    expect(w.dead).toBe(true);
  });

  it('空中では重力で落ちる', () => {
    const w = new Walker(0, 0, 1);
    w.update(1 / 60, noTiles);
    expect(w.body.vy).toBeGreaterThan(0);
  });
});

describe('Walker の大型化と脚の部位破壊(2.19、設計 2026-11-12-action-overhaul)', () => {
  /** 床(y=10)の上に立つ歩行敵。矩形は y ∈ [8.4, 10]、脚の帯は下 45%(y > 9.28) */
  const standing = (x = 2): Walker => new Walker(x, 10 - WALKER_H, 1);
  const legY = (w: Walker): number => w.body.y + w.body.h - 0.1;
  const torsoY = (w: Walker): number => w.body.y + 0.2;

  it('体格は 1.8 × 1.6(プレイヤー 0.9 より大きく、頭上 2 タイルに収まる)', () => {
    const w = standing();
    expect(WALKER_W).toBe(1.8);
    expect(WALKER_H).toBe(1.6);
    expect(w.body.w).toBe(WALKER_W);
    expect(w.body.h).toBe(WALKER_H);
    expect(WALKER_H).toBeLessThan(2);
  });

  it('脚(下端の帯)への被弾 2 回で脚破壊。本体 HP 3 は減らない', () => {
    const w = standing();
    expect(WALKER_LEG_HP).toBe(2);
    const r1 = w.hitAt(1, legY(w));
    expect(r1).toEqual({ killed: false, part: true, broke: false });
    expect(w.legsBroken).toBe(false);
    const r2 = w.hitAt(1, legY(w));
    expect(r2).toEqual({ killed: false, part: true, broke: true });
    expect(w.legsBroken).toBe(true);
    expect(w.hp).toBe(WALKER_HP);
    expect(w.flashT).toBeGreaterThan(0);
  });

  it('帯の外(胴)への被弾は本体に入り、脚の耐久は減らない', () => {
    const w = standing();
    const r = w.hitAt(1, torsoY(w));
    expect(r).toEqual({ killed: false, part: false, broke: false });
    expect(w.hp).toBe(WALKER_HP - 1);
    expect(w.legHp).toBe(WALKER_LEG_HP);
  });

  it('脚破壊後は下端への被弾も本体へ入り、3 発で倒れる', () => {
    const w = standing();
    w.hitAt(1, legY(w));
    w.hitAt(1, legY(w));
    expect(w.hitAt(1, legY(w)).part).toBe(false);
    expect(w.hitAt(1, legY(w)).killed).toBe(false);
    const last = w.hitAt(1, legY(w));
    expect(last.killed).toBe(true);
    expect(w.dead).toBe(true);
  });

  it('脚破壊後の移動速度は通常の半分以下(1 秒の移動距離で比べる)', () => {
    expect(WALKER_LEGLESS_SPEED).toBeLessThanOrEqual(WALKER_SPEED / 2);
    const healthy = standing();
    const broken = standing();
    broken.hitAt(1, legY(broken));
    broken.hitAt(1, legY(broken));
    for (let i = 0; i < 60; i++) {
      healthy.update(1 / 60, floorTiles);
      broken.update(1 / 60, floorTiles);
    }
    const dh = healthy.body.x - 2;
    const db = broken.body.x - 2;
    expect(broken.body.onGround).toBe(true);
    expect(db).toBeGreaterThan(0); // 止まりはしない(よろけながら進む)
    expect(db).toBeLessThanOrEqual(dh / 2 + 1e-6);
    expect(db).toBeCloseTo(WALKER_LEGLESS_SPEED, 1);
  });

  it('重粒子砲(現在 HP ぶんの hit)は脚の状態によらず即死させる', () => {
    const w = standing();
    w.hitAt(1, legY(w));
    expect(w.hit(w.hp)).toBe(true);
    const w2 = standing();
    w2.hitAt(1, legY(w2));
    w2.hitAt(1, legY(w2));
    expect(w2.hit(w2.hp)).toBe(true);
  });
});

describe('nextFlyerMode(飛行敵の状態遷移)', () => {
  it('感知半径 7 以内に入ると追尾へ移る', () => {
    expect(nextFlyerMode('patrol', 7)).toBe('chase');
    expect(nextFlyerMode('patrol', 3)).toBe('chase');
  });

  it('半径 10 を超えると巡回へ戻る', () => {
    expect(nextFlyerMode('chase', 10.5)).toBe('patrol');
  });

  it('7〜10 の帯では現在の状態を保つ(ヒステリシス)', () => {
    expect(nextFlyerMode('patrol', 8.5)).toBe('patrol');
    expect(nextFlyerMode('chase', 8.5)).toBe('chase');
    expect(nextFlyerMode('chase', 10)).toBe('chase');
    expect(nextFlyerMode('patrol', 7.5)).toBe('patrol');
  });
});

describe('Flyer(飛行ドローン)', () => {
  it('2 発で倒れる', () => {
    const f = new Flyer(10, 10, 0);
    expect(f.hit(1)).toBe(false);
    expect(f.hit(1)).toBe(true);
    expect(f.dead).toBe(true);
  });

  it('重力を受けず、巡回ではアンカーの ±6 タイル圏を往復する', () => {
    const f = new Flyer(30, 10, 0);
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < 60 * 20; i++) {
      f.update(1 / 60, noTiles, 1000, 1000); // プレイヤーは遠方(巡回のまま)
      minX = Math.min(minX, f.centerX);
      maxX = Math.max(maxX, f.centerX);
      // 重力で落下しない: アンカー高さ ±(うねり 0.8 + 余裕)に収まる
      expect(Math.abs(f.centerY - 10)).toBeLessThan(1.2);
    }
    expect(minX).toBeGreaterThan(30 - 6.6);
    expect(maxX).toBeLessThan(30 + 6.6);
    expect(maxX - minX).toBeGreaterThan(8); // 実際に往復している
  });

  it('プレイヤーが半径 7 以内に入ると追尾し、近づく', () => {
    const f = new Flyer(10, 10, 0);
    const before = Math.hypot(f.centerX - 14, f.centerY - 10);
    for (let i = 0; i < 60; i++) f.update(1 / 60, noTiles, 14, 10);
    expect(f.mode).toBe('chase');
    const after = Math.hypot(f.centerX - 14, f.centerY - 10);
    expect(after).toBeLessThan(before);
  });

  it('追尾速度はプレイヤーの歩行(6)より遅い', () => {
    const f = new Flyer(10, 10, 0);
    f.update(1 / 60, noTiles, 16, 10); // 距離 6 → 追尾
    const speed = Math.hypot(f.body.vx, f.body.vy);
    expect(speed).toBeGreaterThan(3);
    expect(speed).toBeLessThan(6);
  });

  it('プレイヤーが遠ざかると巡回へ戻る', () => {
    const f = new Flyer(10, 10, 0);
    for (let i = 0; i < 10; i++) f.update(1 / 60, noTiles, 14, 10);
    expect(f.mode).toBe('chase');
    f.update(1 / 60, noTiles, 100, 100);
    expect(f.mode).toBe('patrol');
  });

  it('追尾中に壁へ阻まれて 1 秒以上進めないと巡回へ戻る(固着防止)', () => {
    // x=13 列に壁。プレイヤーは壁の向こう側(14, 10)
    const wall = (tx: number): Tile => (tx === 13 ? TILE.SOLID : TILE.AIR);
    const f = new Flyer(10, 10, 0);
    let sawChase = false;
    let patrolRun = 0;
    let longestPatrolAfterChase = 0;
    for (let i = 0; i < 60 * 6; i++) {
      f.update(1 / 60, wall, 14, 10);
      if (f.mode === 'chase') {
        sawChase = true;
        patrolRun = 0;
      } else if (sawChase) {
        patrolRun++;
        longestPatrolAfterChase = Math.max(longestPatrolAfterChase, patrolRun);
      }
      expect(f.body.x + f.body.w).toBeLessThanOrEqual(13.01); // 壁をすり抜けていない
    }
    expect(sawChase).toBe(true);
    // 諦めて巡回へ戻り、少なくとも 0.5 秒は巡回に留まる(その場で固着し続けない)
    expect(longestPatrolAfterChase).toBeGreaterThanOrEqual(30);
  });
});

describe('Flyer の大型化とローターの部位破壊(2.19、設計 2026-11-12-action-overhaul)', () => {
  /** ローターの帯は上 45%(矩形 [y, y+1] の y + 0.45 未満) */
  const rotorY = (f: Flyer): number => f.body.y + 0.1;
  const bodyY = (f: Flyer): number => f.body.y + f.body.h - 0.1;

  it('体格は幅 1.5(プレイヤー 0.9 より大きい)', () => {
    const f = new Flyer(10, 10, 0);
    expect(FLYER_W).toBe(1.5);
    expect(f.body.w).toBe(FLYER_W);
    expect(f.centerX).toBeCloseTo(10);
    expect(f.centerY).toBeCloseTo(10);
  });

  it('ローター(上端の帯)への被弾 1 回でローター破壊。本体 HP 2 は減らない', () => {
    const f = new Flyer(10, 10, 0);
    expect(FLYER_ROTOR_HP).toBe(1);
    const r = f.hitAt(1, rotorY(f));
    expect(r).toEqual({ killed: false, part: true, broke: true });
    expect(f.rotorBroken).toBe(true);
    expect(f.hp).toBe(FLYER_HP);
  });

  it('帯の外(胴の下側)への被弾は本体に入り、2 発で倒れる', () => {
    const f = new Flyer(10, 10, 0);
    expect(f.hitAt(1, bodyY(f))).toEqual({ killed: false, part: false, broke: false });
    expect(f.rotorBroken).toBe(false);
    expect(f.hitAt(1, bodyY(f)).killed).toBe(true);
  });

  it('ローター破壊後は上端への被弾も本体へ入る', () => {
    const f = new Flyer(10, 10, 0);
    f.hitAt(1, rotorY(f));
    const r = f.hitAt(1, rotorY(f));
    expect(r.part).toBe(false);
    expect(f.hp).toBe(FLYER_HP - 1);
  });

  it('ローター破壊後は落下して床に着き、追尾せず飛ばない(浮き上がらない)', () => {
    // アンカー (10, 5)、床は y=10 行。プレイヤーは感知半径内の真横(従来なら追尾する)
    const f = new Flyer(10, 5, 0);
    f.hitAt(1, rotorY(f));
    let prevY = f.body.y;
    for (let i = 0; i < 120; i++) {
      f.update(1 / 60, floorTiles, 13, 5);
      expect(f.body.y).toBeGreaterThanOrEqual(prevY - 1e-9); // 上昇しない
      expect(f.mode).toBe('patrol');
      prevY = f.body.y;
    }
    expect(f.body.onGround).toBe(true);
    // 床面(y=10)に接地(衝突解決の 1/16 刻み探索ぶんの隙間は残りうる)
    expect(f.body.y + f.body.h).toBeLessThanOrEqual(10);
    expect(f.body.y + f.body.h).toBeGreaterThan(10 - 1 / 16 - 1e-9);
    // 頭上にプレイヤーが来ても床に留まる
    const floorY = f.body.y;
    for (let i = 0; i < 60; i++) f.update(1 / 60, floorTiles, f.centerX, 2);
    expect(f.body.y).toBeCloseTo(floorY, 5);
    expect(f.mode).toBe('patrol');
  });

  it('ローター破壊後は地上を這い、速さは歩行敵の半分以下', () => {
    expect(FLYER_CRAWL_SPEED).toBeLessThanOrEqual(WALKER_SPEED / 2);
    const f = new Flyer(10, 5, 0);
    f.hitAt(1, rotorY(f));
    for (let i = 0; i < 120; i++) f.update(1 / 60, floorTiles, 1000, 1000); // 着地まで
    expect(f.body.onGround).toBe(true);
    const x0 = f.body.x;
    for (let i = 0; i < 60; i++) {
      f.update(1 / 60, floorTiles, 1000, 1000);
      expect(Math.abs(f.body.vx)).toBeLessThanOrEqual(FLYER_CRAWL_SPEED + 1e-9);
    }
    const moved = Math.abs(f.body.x - x0);
    expect(moved).toBeGreaterThan(0); // 這って動く
    expect(moved).toBeLessThanOrEqual(FLYER_CRAWL_SPEED + 1e-6);
  });

  it('重粒子砲(現在 HP ぶんの hit)はローターの状態によらず即死させる', () => {
    const f = new Flyer(10, 10, 0);
    f.hitAt(1, rotorY(f));
    expect(f.hit(f.hp)).toBe(true);
  });
});

describe('stepBossPhase(ボスの状態遷移、第2弾 §2)', () => {
  const inside = { playerInHall: true, hitWall: false };
  const stepN = (
    phase: BossPhase,
    t: number,
    ctx: { playerInHall: boolean; hitWall: boolean },
    frames: number,
  ): { phase: BossPhase; t: number } => {
    let s = { phase, t };
    for (let i = 0; i < frames; i++) s = stepBossPhase(s.phase, s.t, ctx, 1 / 60);
    return s;
  };

  it('巡回中、プレイヤーが広間に入ると接近へ移る。入らなければ巡回のまま', () => {
    expect(stepBossPhase('patrol', 0, inside, 1 / 60).phase).toBe('approach');
    expect(stepBossPhase('patrol', 0, { ...inside, playerInHall: false }, 1 / 60).phase).toBe('patrol');
  });

  it('接近は 3 秒間隔で予備動作へ移る', () => {
    expect(stepN('approach', 0, inside, 170).phase).toBe('approach');
    expect(stepN('approach', 0, inside, 190).phase).toBe('windup');
  });

  it('接近中にプレイヤーが広間を出ると巡回へ戻る', () => {
    expect(stepBossPhase('approach', 1, { ...inside, playerInHall: false }, 1 / 60).phase).toBe('patrol');
  });

  it('予備動作 0.7 秒で突進へ移る', () => {
    expect(stepN('windup', 0, inside, 30).phase).toBe('windup');
    expect(stepN('windup', 0, inside, 60).phase).toBe('charge');
  });

  it('突進は 0.45 秒で硬直へ移る', () => {
    expect(stepN('charge', 0, inside, 20).phase).toBe('charge');
    expect(stepN('charge', 0, inside, 40).phase).toBe('stunned');
  });

  it('突進が壁に当たると即座に硬直へ移る', () => {
    expect(stepBossPhase('charge', 0.1, { ...inside, hitWall: true }, 1 / 60).phase).toBe('stunned');
  });

  it('硬直 1.2 秒で、プレイヤーが広間にいれば接近へ、いなければ巡回へ戻る', () => {
    expect(stepN('stunned', 0, inside, 60).phase).toBe('stunned');
    expect(stepN('stunned', 0, inside, 90).phase).toBe('approach');
    expect(stepN('stunned', 0, { ...inside, playerInHall: false }, 90).phase).toBe('patrol');
  });

  it('予備動作〜硬直の突進シーケンスは、プレイヤーが広間を出ても中断しない', () => {
    const outside = { ...inside, playerInHall: false };
    expect(stepBossPhase('windup', 0.3, outside, 1 / 60).phase).toBe('windup');
    expect(stepBossPhase('charge', 0.2, outside, 1 / 60).phase).toBe('charge');
    expect(stepBossPhase('stunned', 0.5, outside, 1 / 60).phase).toBe('stunned');
  });
});

describe('Boss(広間番人、第2弾 §2)', () => {
  /** 出現: 広間の床の中央(中心 x=50、床行 y=10、広間は x 0..200) */
  const makeBoss = () => new Boss(50, 10, 0, 200);

  it('床の上に立ち、重力で着地する', () => {
    const b = makeBoss();
    for (let i = 0; i < 30; i++) b.update(1 / 60, floorTiles, 1000, 1000, false);
    expect(b.body.onGround).toBe(true);
    expect(b.body.y + b.body.h).toBeCloseTo(10, 5);
  });

  it('HP は 30 で、パルス 1 ダメージを 30 発受けて倒れる', () => {
    const b = makeBoss();
    for (let i = 0; i < BOSS_HP - 1; i++) expect(b.hit(1)).toBe(false);
    expect(b.hit(1)).toBe(true);
    expect(b.dead).toBe(true);
  });

  it('硬直中は被ダメージが 2 倍になる', () => {
    const b = makeBoss();
    b.phase = 'stunned';
    b.hit(1);
    expect(b.hp).toBe(BOSS_HP - 2);
    b.hit(10);
    expect(b.hp).toBe(BOSS_HP - 2 - 20);
  });

  it('硬直以外の相では被ダメージは等倍', () => {
    const b = makeBoss();
    b.phase = 'windup';
    b.hit(10);
    expect(b.hp).toBe(BOSS_HP - 10);
  });

  it('巡回は広間の矩形の外へ出ない(クランプ)', () => {
    const b = new Boss(50, 10, 40, 60); // 狭い広間
    for (let i = 0; i < 60 * 10; i++) {
      b.update(1 / 60, floorTiles, 1000, 1000, false); // プレイヤーは広間の外
      expect(b.body.x).toBeGreaterThanOrEqual(40);
      expect(b.body.x + b.body.w).toBeLessThanOrEqual(60);
    }
  });

  it('戦闘の相が 巡回→接近→予備動作→突進→硬直→接近 と回る', () => {
    const b = makeBoss();
    const seen: BossPhase[] = [b.phase];
    // プレイヤーは広間内の右方(中心から +30)に静止
    for (let i = 0; i < 60 * 8; i++) {
      b.update(1 / 60, floorTiles, b.centerX + 30, 9, true);
      if (seen[seen.length - 1] !== b.phase) seen.push(b.phase);
    }
    expect(seen.slice(0, 6)).toEqual(['patrol', 'approach', 'windup', 'charge', 'stunned', 'approach']);
  });

  it('予備動作の間は停止する(テレグラフ)', () => {
    const b = makeBoss();
    // 接近が始まるまで進める
    for (let i = 0; i < 60 * 4 && b.phase !== 'windup'; i++) {
      b.update(1 / 60, floorTiles, b.centerX + 30, 9, true);
    }
    expect(b.phase).toBe('windup');
    const x = b.body.x;
    b.update(1 / 60, floorTiles, b.centerX + 30, 9, true);
    expect(b.body.x).toBeCloseTo(x, 9);
  });

  it('突進の変位は歩行より速い(速度 9)', () => {
    const b = makeBoss();
    let maxStep = 0;
    for (let i = 0; i < 60 * 8; i++) {
      const prevX = b.body.x;
      const wasCharge = b.phase === 'charge';
      b.update(1 / 60, floorTiles, b.centerX + 30, 9, true);
      if (wasCharge) maxStep = Math.max(maxStep, Math.abs(b.body.x - prevX));
    }
    // 1 フレームの変位 = 速度/60。突進 9 → 0.15、接近 2.6 → 約 0.043
    expect(maxStep).toBeGreaterThan(0.1);
    expect(maxStep).toBeLessThan(0.2);
  });

  it('突進が壁に当たると、時間切れを待たず硬直する', () => {
    // 床 + x=56 列の壁。プレイヤーは壁の向こう(70, 9)
    const wallAndFloor = (tx: number, ty: number): Tile => {
      if (ty === 10) return TILE.SOLID;
      if (tx === 56 && ty < 10) return TILE.SOLID;
      return TILE.AIR;
    };
    const b = makeBoss();
    let chargeFrames = 0;
    let stunnedAfterCharge: number | null = null;
    for (let i = 0; i < 60 * 8; i++) {
      const before = b.phase;
      b.update(1 / 60, wallAndFloor, 70, 9, true);
      if (before === 'charge' && b.phase === 'stunned') {
        stunnedAfterCharge = chargeFrames;
        break;
      }
      chargeFrames = b.phase === 'charge' ? chargeFrames + 1 : 0;
    }
    expect(stunnedAfterCharge).not.toBeNull();
    expect(stunnedAfterCharge!).toBeLessThan(0.45 * 60); // 0.45 秒ぶん待たずに硬直した
  });

  it('重粒子砲は 10 ダメージ(硬直中は 2 倍の 20)で、3 発(硬直を絡めれば 2 発)で落ちる', () => {
    const b = makeBoss();
    expect(b.hit(BOSS_BEAM_DAMAGE)).toBe(false);
    expect(b.hp).toBe(BOSS_HP - 10);
    expect(b.hit(BOSS_BEAM_DAMAGE)).toBe(false);
    expect(b.hit(BOSS_BEAM_DAMAGE)).toBe(true); // 3 発で撃破
    const s = makeBoss();
    s.phase = 'stunned';
    expect(s.hit(BOSS_BEAM_DAMAGE)).toBe(false);
    expect(s.hp).toBe(BOSS_HP - 20); // 硬直中は hit() の一律 2 倍で 20
    expect(s.hit(BOSS_BEAM_DAMAGE)).toBe(true);
  });
});
