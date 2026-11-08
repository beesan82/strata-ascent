import { ANTECHAMBER_DEPTH, COMPRESSION_DEPTH, interfaceBottom, interfaceTop } from './interface';
import { hash2 } from './noise';
import { restPointAt } from './restpoint';

/**
 * 大広間(設計書 §4.3)。反復する構造の中の例外として、7 セルに 1 回程度の低頻度で
 * セル内に幅 200・高さ 200 の吹き抜け空間を決定論で挿入する。純粋関数のみ。
 *
 * 置き方の裁定:
 * - 休憩点の骨格(位置・幾何)は動かさない。広間は、そのセルの休憩点の 1 つに中心を寄せて
 *   配置し「広間の中に休憩点が 1 つ入る」ことを保証する(設計 §4.3 の「寄せて置く」を
 *   休憩点ではなく広間側の移動で実現する)。
 * - 前室+圧縮帯(板の直下 dy <= ANTECHAMBER_DEPTH + COMPRESSION_DEPTH)には触れない。
 *   高さ 200 をその下に確保できない浅い層では広間を出さない。
 * - 地区の顔(ランドマーク §4.1)とは独立の抽選にする。
 */

export const GRAND_HALL_RATE = 1 / 7;
export const GRAND_HALL_WIDTH = 200;
export const GRAND_HALL_HEIGHT = 200;
/** 広間の床の行は、寄せた休憩点の床から最低この行数だけ下に置く */
export const GRAND_HALL_REST_DROP = 40;

/** 煙突(絶景拡張)の幅。広間より十分狭い縦の吹き抜けとして上向きに延長する */
export const HALL_CHIMNEY_WIDTH = 96;
/** 煙突の高さの候補(hash で 1 つ選ぶ)。初期値 128/160/192 では絶景計測の長大区間が伸びなかったため引き上げた(計画書の計測参照) */
export const HALL_CHIMNEY_HEIGHTS = [192, 256, 320] as const;

export interface GrandHall {
  cell: number;
  /** 中心を寄せた休憩点のスロット */
  k: number;
  x0: number;
  /** 排他 */
  x1: number;
  y0: number;
  /** 排他(= floorY + 1) */
  y1: number;
  /** 底に残る 1 本の床の行(不壊の HARD) */
  floorY: number;
}

/** 層 cell の大広間。抽選に外れるか、寸法を確保できない層では null */
export function grandHallAt(seed: number, cell: number): GrandHall | null {
  if (hash2(seed + 9301, cell, 0) >= GRAND_HALL_RATE) return null;
  const bottom = interfaceBottom(seed, cell);
  const top = interfaceTop(seed, cell + 1);
  const minFloorY = bottom + ANTECHAMBER_DEPTH + COMPRESSION_DEPTH + GRAND_HALL_HEIGHT - 1;
  if (minFloorY >= top) return null;
  const k = Math.floor(hash2(seed + 9302, cell, 0) * 5) - 2;
  const rp = restPointAt(seed, cell, k);
  const floorY = Math.max(rp.floorY + GRAND_HALL_REST_DROP, minFloorY);
  if (floorY >= top) return null;
  const x0 = rp.x - GRAND_HALL_WIDTH / 2;
  return {
    cell,
    k,
    x0,
    x1: x0 + GRAND_HALL_WIDTH,
    y0: floorY - GRAND_HALL_HEIGHT + 1,
    y1: floorY + 1,
    floorY,
  };
}

export interface HallChimney {
  cell: number;
  x0: number;
  /** 排他 */
  x1: number;
  /** 煙突の上端(= y1 − height) */
  y0: number;
  /** 排他(= 広間の y0。煙突は広間の天井から上向きに伸びる) */
  y1: number;
  height: number;
}

/** 広間から煙突の幾何を導く(高さの hash だけを使う) */
export function hallChimneyForHall(seed: number, hall: GrandHall): HallChimney {
  const height = HALL_CHIMNEY_HEIGHTS[Math.floor(hash2(seed + 9303, hall.cell, 0) * HALL_CHIMNEY_HEIGHTS.length)];
  const cx = (hall.x0 + hall.x1) / 2;
  const x0 = cx - HALL_CHIMNEY_WIDTH / 2;
  return {
    cell: hall.cell,
    x0,
    x1: x0 + HALL_CHIMNEY_WIDTH,
    y0: hall.y0 - height,
    y1: hall.y0,
    height,
  };
}

/**
 * 大広間の煙突: 広間の上向きに幅の狭い縦の吹き抜けを決定論で延長する(絶景拡張)。
 * 広間の寸法・出現率は変えず、高さだけ hash で候補から選ぶ。広間が無いセルでは null。
 * 範囲は [hall.y0 − height, hall.y0) で、1 つ上のセルの領域へ伸びる場合がある。
 */
export function hallChimneyAt(seed: number, cell: number): HallChimney | null {
  const hall = grandHallAt(seed, cell);
  return hall ? hallChimneyForHall(seed, hall) : null;
}
