import { biomeBoundary } from './biomeCells';
import { hash2 } from './noise';

// 階層界面(各景観セルの上端にある不壊の水平板)の幾何。

export const INTERFACE_THICKNESS = 32;
export const GREAT_INTERFACE_THICKNESS = 96;
export const PASSAGE_SLOT = 384;
export const PASSAGE_JITTER = 64;
export const PASSAGE_HALF = 1;
export const GREAT_PASSAGE_HALF = 2;
export const SHAFT_OVERHANG = 4;
export const OVERLOOK_LEFT = 12;
export const OVERLOOK_RIGHT = 72;
export const OVERLOOK_HEIGHT = 8;
export const HOLE_OFFSET = 24;
export const HOLE_WIDTH = 48;
export const ANTECHAMBER_HALF_WIDTH = 120;
export const ANTECHAMBER_DEPTH = 48;
export const ANTECHAMBER_FADE = 40;
export const COMPRESSION_DEPTH = 60;
export const COMPRESSION_MASS_DROP = 0.15;

/** 正規化剰余(負数でも [0, m))。 */
export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** 大界面は 4 セルに 1 枚(mod(cell,4)===2)。 */
export function isGreatInterface(cell: number): boolean {
  return mod(cell, 4) === 2;
}

export function interfaceThickness(cell: number): number {
  return isGreatInterface(cell) ? GREAT_INTERFACE_THICKNESS : INTERFACE_THICKNESS;
}

/** 上面 Y(= 景観セル境界)。 */
export function interfaceTop(seed: number, cell: number): number {
  return biomeBoundary(seed, cell);
}

/** 下面 Y(排他的: top + 厚み)。 */
export function interfaceBottom(seed: number, cell: number): number {
  return interfaceTop(seed, cell) + interfaceThickness(cell);
}

/** k 番目の孔(通路)の中心 X。スロット中心 ± PASSAGE_JITTER。 */
export function passageX(seed: number, cell: number, k: number): number {
  const jitter = Math.floor(hash2(seed + 7001, cell, k) * (PASSAGE_JITTER * 2 + 1)) - PASSAGE_JITTER;
  return k * PASSAGE_SLOT + PASSAGE_SLOT / 2 + jitter;
}

/** x に最寄りの孔。k0 とその両隣から選ぶ(同距離なら小さい k)。 */
export function nearestPassage(seed: number, cell: number, x: number): { k: number; x: number } {
  const k0 = Math.floor(x / PASSAGE_SLOT);
  let best = { k: k0 - 1, x: passageX(seed, cell, k0 - 1) };
  for (let k = k0; k <= k0 + 1; k++) {
    const px = passageX(seed, cell, k);
    if (Math.abs(px - x) < Math.abs(best.x - x)) best = { k, x: px };
  }
  return best;
}

/** 32 タイル幅グループごとの梯子列 X(worldgen の既存式と同一)。 */
export function groupLadderX(seed: number, x: number): number {
  const group = Math.floor(x / 32);
  return group * 32 + Math.floor(hash2(seed + 404, group, 0) * 32);
}
