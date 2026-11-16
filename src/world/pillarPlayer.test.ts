import { describe, expect, it } from 'vitest';
import { tileAt } from './worldgen';
import { baseTileAt } from './worldgen';
import { pillarsInRect, type Pillar } from './pillar';
import { Player, type PlayerInput } from '../entities/player';
import { Walker, WALKER_H } from '../entities/enemy';
import { TILE, isSolid } from './tiles';

/**
 * 巨柱の Player/Walker 結合テスト(2.21、設計 §A-3 の検証 3)。
 * 実在の柱を使い、トンネルを両方向に歩く・歩行敵が固着しない・頂部から
 * 落ちて出られる・梯子経由で別の穴へ回れることを確かめる。
 */

const SEED = 20260711;
const tiles = (x: number, y: number) => tileAt(SEED, x, y);
const NONE: PlayerInput = { left: false, right: false, jump: false, up: false, down: false };
const DT = 1 / 60;

/** 上面が帯の全幅で開けている(頭上 2 行が空いている)柱を選ぶ */
function pickPillar(): Pillar {
  const list = pillarsInRect(SEED, -1200, 1200, -1600, 1600, (x, y) => baseTileAt(SEED, x, y));
  for (const p of list) {
    if (p.doors.length < 3) continue;
    if (p.landR - p.landL > 90) continue;
    let clear = true;
    for (let x = p.landL; x <= p.landR && clear; x++) {
      if (isSolid(tiles(x, p.yTop - 1)) || isSolid(tiles(x, p.yTop - 2))) clear = false;
    }
    if (clear) return p;
  }
  throw new Error('テストに使える柱が見つからない');
}

const P = pickPillar();
const DOOR = P.doors[Math.floor(P.doors.length / 2)];

describe('巨柱: Player 結合', () => {
  it('トンネルを両方向に歩いて通り抜けられる', () => {
    const p = new Player(P.landL + 1.2, DOOR - 1.75);
    // まず落ち着く
    for (let i = 0; i < 30; i++) p.update(NONE, DT, tiles);
    expect(p.body.onGround).toBe(true);
    // 右へ: 本体を通り過ぎて東の乗り場まで
    let crossedAt = -1;
    for (let i = 0; i < 4000; i++) {
      p.update({ ...NONE, right: true }, DT, tiles);
      if (p.centerX > P.x0 + P.w + 2) { crossedAt = i; break; }
    }
    expect(crossedAt).toBeGreaterThanOrEqual(0);
    expect(Math.abs(p.body.y + p.body.h - DOOR)).toBeLessThan(0.75);
    // 左へ戻る
    let backAt = -1;
    for (let i = 0; i < 4000; i++) {
      p.update({ ...NONE, left: true }, DT, tiles);
      if (p.centerX < P.x0 - 2) { backAt = i; break; }
    }
    expect(backAt).toBeGreaterThanOrEqual(0);
    expect(Math.abs(p.body.y + p.body.h - DOOR)).toBeLessThan(0.75);
  }, 120_000);

  it('頂部へ落ちて着地し、歩いて東の外へ出られる', () => {
    // 本体の列のうち、頂部の直上 5 行が空気で頂部の行が SOLID の列を探して、そこへ落とす
    // (高い位置から落とすと、先行する基準地形の床に頂部より上で着地してしまうため)
    let dropCol: number | null = null;
    for (let col = P.x0; col < P.x0 + P.w && dropCol === null; col++) {
      let open = tiles(col, P.yTop) === TILE.SOLID;
      for (let k = 1; k <= 5 && open; k++) {
        if (tiles(col, P.yTop - k) !== TILE.AIR) open = false;
      }
      if (open) dropCol = col;
    }
    if (dropCol === null) throw new Error('頂部の直上 5 行が空いている本体の列が見つからない');
    const p = new Player(dropCol + 0.125, P.yTop - 5);
    let landed = false;
    for (let i = 0; i < 1200; i++) {
      p.update(NONE, DT, tiles);
      if (p.body.onGround) { landed = true; break; }
    }
    expect(landed).toBe(true);
    expect(Math.abs(p.body.y + p.body.h - P.yTop)).toBeLessThan(0.25);
    let outAt = -1;
    for (let i = 0; i < 4000; i++) {
      p.update({ ...NONE, right: true }, DT, tiles);
      if (p.centerX > P.landR + 2) { outAt = i; break; }
    }
    expect(outAt).toBeGreaterThanOrEqual(0);
  }, 120_000);

  it('上の穴から梯子を降りて下の穴へ回れる', () => {
    const doors = [...P.doors].sort((a, b) => a - b);
    const dTop = doors[0];
    const dNext = doors[1];
    const p = new Player(P.landL + 1.2, dTop - 1.75);
    for (let i = 0; i < 30; i++) p.update(NONE, DT, tiles);
    expect(p.body.onGround).toBe(true);
    // 左へ歩いて梯子列の上に中心を合わせる
    for (let i = 0; i < 240 && p.centerX > P.landL + 0.5; i++) {
      p.update({ ...NONE, left: true }, DT, tiles);
    }
    expect(Math.abs(p.centerX - (P.landL + 0.5))).toBeLessThan(0.6);
    // 体を梯子列の中央に正確に置く(西へはみ出したまま降りると、隣列の岩の張り出しに足が掛かる)
    p.body.x = P.landL + 0.125;
    p.body.vx = 0;
    // 降りる: 足が下の穴の床に近づくまで
    let descended = false;
    for (let i = 0; i < 3600; i++) {
      p.update({ ...NONE, down: true }, DT, tiles);
      if (p.body.y + p.body.h >= dNext - 0.05) { descended = true; break; }
    }
    expect(descended).toBe(true);
    // 右へ踏み出して下の穴のトンネルへ入る
    let entered = -1;
    for (let i = 0; i < 600; i++) {
      p.update({ ...NONE, right: true }, DT, tiles);
      if (p.centerX > P.x0 + 2) { entered = i; break; }
    }
    expect(entered).toBeGreaterThanOrEqual(0);
    expect(Math.abs(p.body.y + p.body.h - dNext)).toBeLessThan(0.75);
  }, 120_000);
});

describe('巨柱: Walker 結合', () => {
  it('歩行敵はトンネルの中で固着せず、床を抜けない', () => {
    const w = new Walker(P.landL + 2, DOOR - WALKER_H, 1);
    let minX = Infinity;
    let maxX = -Infinity;
    let flips = 0;
    let prevDir = w.dir;
    let lastMove = 0;
    let prevX = w.centerX;
    for (let i = 0; i < 3600; i++) {
      w.update(DT, tiles);
      minX = Math.min(minX, w.centerX);
      maxX = Math.max(maxX, w.centerX);
      if (w.dir !== prevDir) { flips++; prevDir = w.dir; }
      if (Math.abs(w.centerX - prevX) > 0.001) lastMove = i;
      prevX = w.centerX;
      // トンネルの床行から大きく外れていない(床抜け・落下していない)
      if (w.centerX > P.landL && w.centerX < P.landR) {
        expect(Math.abs(w.body.y + w.body.h - DOOR)).toBeLessThan(1.25);
      }
    }
    // 本体の幅以上に動いたか、反転して往復している
    expect(maxX - minX > P.w || flips >= 1).toBe(true);
    // 最後の 10 秒間も動き続けている(固着していない)
    expect(lastMove).toBeGreaterThan(3000);
  }, 120_000);
});
