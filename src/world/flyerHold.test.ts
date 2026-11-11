import { describe, expect, it } from 'vitest';
import { TILE, type Tile } from './tiles';
import {
  chooseFlyerSpawns,
  findAirPockets,
  FLYER_HOLD_RADIUS,
  newFlyerSpawns,
  retainFlyers,
  type HeldFlyer,
} from './spawn';

/**
 * 飛行敵の粘着保持(設計 2026-11-11-flyer-stickiness)。main.ts の refreshEnemies と同じ手順
 * (窓 ±40 × ±24 のポケット走査 → 選定 → 保持 → 新規出現)を純粋関数だけで再現して固定する。
 */

/** 全面が空気(ポケットがタイル単位で重なって大量に取れる。窓依存が最も強く出る場) */
const openSky = (): Tile => TILE.AIR;

const SCAN_X = 40;
const SCAN_Y = 24;

const held = (spawnId: string, anchorX: number, anchorY: number): HeldFlyer => ({
  spawnId,
  flyer: { anchorX, anchorY },
});

/** プレイヤー位置 (px, py) を中心にした窓での選定 */
function desiredAt(seed: number, px: number, py: number) {
  const pockets = findAirPockets(openSky, px - SCAN_X, py - SCAN_Y, px + SCAN_X, py + SCAN_Y);
  return chooseFlyerSpawns(seed, 5, pockets, [], 'waterVoid', []);
}

/** refreshEnemies の飛行敵の部分と同じ 1 回ぶんの更新 */
function refresh(seed: number, current: readonly HeldFlyer[], px: number, py: number): HeldFlyer[] {
  const desired = desiredAt(seed, px, py);
  const kept = retainFlyers(current, new Set(desired.map((d) => d.id)), px, py);
  return [...kept, ...newFlyerSpawns(desired, kept).map((d) => held(d.id, d.x, d.y))];
}

describe('飛行敵の粘着保持(retainFlyers / newFlyerSpawns)', () => {
  it('前提: 開けた空間では窓を数タイルずらすだけで選定 ID 集合が入れ替わる(真因の再現)', () => {
    let changed = false;
    for (const seed of [55, 1, 42, 20260711]) {
      const base = new Set(desiredAt(seed, 100, 100).map((d) => d.id));
      for (let dx = 1; dx <= 8 && !changed; dx++) {
        const shifted = desiredAt(seed, 100 + dx, 100).map((d) => d.id);
        if (shifted.length !== base.size || shifted.some((id) => !base.has(id))) changed = true;
      }
    }
    expect(changed).toBe(true);
  });

  it('窓をずらしても、保持半径内の既存個体は消えない(同じ実体のまま残る)', () => {
    for (const seed of [55, 1, 42, 20260711]) {
      let flyers = refresh(seed, [], 100, 100);
      expect(flyers.length).toBeGreaterThan(0);
      // 右へ 1 タイルずつ、縦にも少し揺らしながら歩く(30 フレームごとの再走査を想定)
      for (let step = 1; step <= 24; step++) {
        const px = 100 + step;
        const py = 100 + (step % 3) - 1;
        const next = refresh(seed, flyers, px, py);
        for (const e of flyers) {
          const inRadius = Math.max(Math.abs(e.flyer.anchorX - px), Math.abs(e.flyer.anchorY - py)) <= FLYER_HOLD_RADIUS;
          if (inRadius) expect(next).toContain(e);
        }
        flyers = next;
      }
    }
  });

  it('保持と新規出現を繰り返しても、個体どうしの密度上限(32×16)は破られない', () => {
    for (const seed of [55, 1, 42, 20260711]) {
      let flyers = refresh(seed, [], 100, 100);
      for (let step = 1; step <= 60; step++) {
        flyers = refresh(seed, flyers, 100 + step * 2, 100 + Math.floor(step / 4));
        for (let i = 0; i < flyers.length; i++) {
          for (let j = i + 1; j < flyers.length; j++) {
            const a = flyers[i].flyer;
            const b = flyers[j].flyer;
            expect(Math.abs(a.anchorX - b.anchorX) < 32 && Math.abs(a.anchorY - b.anchorY) < 16).toBe(false);
          }
        }
        expect(new Set(flyers.map((e) => e.spawnId)).size).toBe(flyers.length);
      }
    }
  });

  it('アンカーが保持半径(チェビシェフ 64)の外に出た個体だけを捨てる', () => {
    const inside = held('f:a', 64, -64);
    const edge = held('f:b', -64, 10);
    const outX = held('f:c', 64.5, 0);
    const outY = held('f:d', 0, -65);
    const kept = retainFlyers([inside, edge, outX, outY], new Set(), 0, 0);
    expect(kept).toEqual([inside, edge]);
  });

  it('今回の選定に入っている個体は距離によらず残す', () => {
    const far = held('f:far', 500, 500);
    expect(retainFlyers([far], new Set(['f:far']), 0, 0)).toEqual([far]);
  });

  it('地区ゲートが閉じた(選定が空)ときも保持半径内の個体は残り、外の個体だけが消える', () => {
    const near = held('f:near', 10, 5);
    const far = held('f:far', 100, 0);
    expect(retainFlyers([near, far], new Set(), 0, 0)).toEqual([near]);
  });

  it('新規出現: 既に実体がある ID と、保持個体の密度範囲内の選定は湧かせない', () => {
    const kept = [held('f:0,0', 2.5, 2), held('f:old', 100, 100)];
    const desired = [
      { id: 'f:0,0', x: 2.5, y: 2, phase: 0 }, // 既に実体がある
      { id: 'f:near', x: 100 + 31, y: 100 - 15, phase: 0 }, // 保持個体の 32×16 の内側
      { id: 'f:edge', x: 100 + 32, y: 100, phase: 0 }, // 横 32 ちょうどは近接ではない(chooseFlyerSpawns と同じ境界)
      { id: 'f:free', x: 300, y: 300, phase: 0 },
    ];
    expect(newFlyerSpawns(desired, kept).map((d) => d.id)).toEqual(['f:edge', 'f:free']);
  });

  it('保持個体が無ければ選定がそのまま新規出現になる(従来どおり)', () => {
    const desired = desiredAt(55, 100, 100);
    expect(newFlyerSpawns(desired, [])).toEqual(desired);
  });
});
