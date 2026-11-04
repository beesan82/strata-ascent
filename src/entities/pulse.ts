import { moveBody, type Body, type TileLookup } from './physics';

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
   * firing の間、間隔を置いて (originX, originY) から (dirX, dirY) へ撃つ。
   * 弾は moveBody の掃引衝突で進み、壁に当たるか射程を超えると消える。
   */
  update(
    dt: number,
    firing: boolean,
    originX: number,
    originY: number,
    dirX: number,
    dirY: number,
    tiles: TileLookup,
  ): void {
    this.cooldown -= dt;
    if (firing && this.cooldown <= 0) {
      this.cooldown = PULSE_INTERVAL;
      this.shotsFired++;
      this.pulses.push({
        body: {
          x: originX - PULSE_SIZE / 2,
          y: originY - PULSE_SIZE / 2,
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
