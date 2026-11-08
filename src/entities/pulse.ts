import { bodyOverlapsSolid, moveBody, type Body, type TileLookup } from './physics';

/**
 * 連射武器「パルス」(アクション化 第1弾・第2段、設計書 2026-11-04-action-phase1)。
 * 敵専用の投射物で、地形は掘れない(壁で消える)。重粒子砲(掘る儀式の一手)とは別系統。
 */
export const PULSE_INTERVAL = 1 / 6; // 連射間隔(秒)= 約 6 発/秒
export const PULSE_SPEED = 30; // タイル/秒
export const PULSE_RANGE = 14; // 射程(タイル)
export const PULSE_SIZE = 0.4; // 弾の一辺(タイル)
export const PULSE_DAMAGE = 1; // 敵への威力

export interface Pulse {
  body: Body;
  dx: number;
  dy: number;
  traveled: number;
}

type DirInput = { left: boolean; right: boolean; up: boolean; down: boolean };

/** 銃口が埋まっているときの後退刻み(タイル)。physics の衝突探索と同じ 1/16 */
const SPAWN_STEP = 1 / 16;

/**
 * パルスのスポーン中心を決める。銃口 (muzzleX, muzzleY) が地形に埋まっていなければ
 * そのまま使い、埋まっていれば安全点 (safeX, safeY = プレイヤー中心) へ向けて
 * 少しずつ後退し、最初に弾の箱が地形と重ならない位置を使う。
 * 銃口が壁の中にある角度・距離で撃っても、弾が壁の中で生まれて即消えたり、
 * 壁際の敵に届かなくなったりする退行を防ぐため。安全点まで埋まっている場合は
 * 安全点を返し、従来どおり moveBody の埋没ガードで即消滅する(退行なし)。
 */
export function resolvePulseSpawn(
  tiles: TileLookup,
  muzzleX: number,
  muzzleY: number,
  safeX: number,
  safeY: number,
): { x: number; y: number } {
  const half = PULSE_SIZE / 2;
  const embedded = (cx: number, cy: number): boolean =>
    bodyOverlapsSolid(tiles, cx - half, cy - half, PULSE_SIZE, PULSE_SIZE);
  if (!embedded(muzzleX, muzzleY)) return { x: muzzleX, y: muzzleY };
  const dist = Math.hypot(safeX - muzzleX, safeY - muzzleY);
  const steps = Math.max(1, Math.ceil(dist / SPAWN_STEP));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const cx = muzzleX + (safeX - muzzleX) * t;
    const cy = muzzleY + (safeY - muzzleY) * t;
    if (!embedded(cx, cy)) return { x: cx, y: cy };
  }
  return { x: safeX, y: safeY };
}

/** 8 方向照準: 入力から単位ベクトルを作る(入力が無ければ向きの水平) */
export function pulseAimDir(input: DirInput, facing: 1 | -1): { x: number; y: number } {
  const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  if (dx === 0 && dy === 0) return { x: facing, y: 0 };
  const len = Math.hypot(dx, dy);
  return { x: dx / len, y: dy / len };
}

export class PulseGun {
  pulses: Pulse[] = [];
  /** 発射した総数(検証用) */
  shotsFired = 0;
  private cooldown = 0;

  /**
   * firing の間、間隔を置いて銃口 (originX, originY) から (dirX, dirY) へ撃つ。
   * 弾は moveBody の掃引衝突で進み、壁に当たるか射程を超えると消える。
   * 銃口が地形に埋まっている場合は、安全点 (safeX, safeY) へ後退した位置から
   * 生む(resolvePulseSpawn)。安全点の既定は銃口自身(後退なし)。
   */
  update(
    dt: number,
    firing: boolean,
    originX: number,
    originY: number,
    dirX: number,
    dirY: number,
    tiles: TileLookup,
    safeX: number = originX,
    safeY: number = originY,
  ): void {
    this.cooldown -= dt;
    if (firing && this.cooldown <= 0) {
      this.cooldown = PULSE_INTERVAL;
      this.shotsFired++;
      const spawn = resolvePulseSpawn(tiles, originX, originY, safeX, safeY);
      this.pulses.push({
        body: {
          x: spawn.x - PULSE_SIZE / 2,
          y: spawn.y - PULSE_SIZE / 2,
          w: PULSE_SIZE,
          h: PULSE_SIZE,
          vx: dirX * PULSE_SPEED,
          vy: dirY * PULSE_SPEED,
          onGround: false,
        },
        dx: dirX,
        dy: dirY,
        traveled: 0,
      });
    }

    const alive: Pulse[] = [];
    for (const p of this.pulses) {
      p.body.vx = p.dx * PULSE_SPEED;
      p.body.vy = p.dy * PULSE_SPEED;
      moveBody(p.body, dt, tiles);
      p.traveled += PULSE_SPEED * dt;
      // 壁に当たると moveBody がその軸の速度を 0 にする。それを命中とみなす
      const hitWall =
        (p.dx !== 0 && p.body.vx === 0) || (p.dy !== 0 && p.body.vy === 0);
      if (!hitWall && p.traveled <= PULSE_RANGE) alive.push(p);
    }
    this.pulses = alive;
  }
}
