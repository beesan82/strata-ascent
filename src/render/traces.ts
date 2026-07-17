import { hash2 } from '../world/noise';
import { weighted } from '../world/hierarchy';

/** 床(縁)に残る痕跡の種別 */
export const FLOOR_TYPES = ['corpse', 'lamp', 'pack', 'shells'] as const;
/** 壁面に残る痕跡の種別 */
export const WALL_TYPES = ['tally', 'warning'] as const;

export type FloorTrace = (typeof FLOOR_TYPES)[number];
export type WallTrace = (typeof WALL_TYPES)[number];
export type TraceType = FloorTrace | WallTrace;

export interface Trace {
  type: TraceType;
  /** 変種・将来の断章id用の安定した非負整数(seed+座標ハッシュ由来) */
  id: number;
}

/** 床痕跡の出現率(適格タイルあたり)。稀にする。 */
const FLOOR_RATE = 0.018;
/** 壁痕跡の出現率(適格タイルあたり)。 */
const WALL_RATE = 0.022;

/** 種別の重み(遺体は最も稀。稼働灯を伴うランプ・荷袋・薬莢はやや多い) */
const FLOOR_TABLE = [
  { v: 'corpse' as const, w: 1 },
  { v: 'lamp' as const, w: 2 },
  { v: 'pack' as const, w: 3 },
  { v: 'shells' as const, w: 3 },
];
const WALL_TABLE = [
  { v: 'tally' as const, w: 2 },
  { v: 'warning' as const, w: 1 },
];

/**
 * (seed, wx, wy) に痕跡があれば返す(なければ null)。純粋・決定論。
 * kind='floor': 呼び出し側が「AIRかつ直下SOLIDの縁タイル」に対して呼ぶ想定。
 * kind='wall' : 呼び出し側が「SOLIDかつ左右いずれか空気の壁面タイル」に対して呼ぶ想定。
 * (適格判定は chunkbake 側。ここは有無と種別のみを決める。)
 */
export function traceAt(seed: number, wx: number, wy: number, kind: 'floor' | 'wall'): Trace | null {
  const rate = kind === 'floor' ? FLOOR_RATE : WALL_RATE;
  const gate = hash2(seed + (kind === 'floor' ? 8100 : 8200), wx, wy);
  if (gate >= rate) return null;
  const pick = hash2(seed + (kind === 'floor' ? 8110 : 8210), wx, wy);
  const type = kind === 'floor' ? weighted(FLOOR_TABLE, pick) : weighted(WALL_TABLE, pick);
  const id = Math.floor(hash2(seed + 8300, wx, wy) * 0x7fffffff);
  return { type, id };
}
