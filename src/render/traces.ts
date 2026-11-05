import { hash2 } from '../world/noise';
import { weighted } from '../world/hierarchy';
import { biomeCellAt, biomeIdForCell, type BiomeId } from '../world/biomeCells';
import { nearestRestPoint, REST_HALO, REST_HEIGHT } from '../world/restpoint';

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

/** 休憩点(§5.4)の周囲 REST_HALO タイルでの出現率の倍率 */
const REST_RATE_MULTIPLIER = 5;

/**
 * 地区ごとの痕跡の重み倍率(ゾーン化 段階 3、設計 §4.2: 箱の内外の痕跡を地区で切り替える)。
 * 基準(寒鋼基層 = 倍率なし)から、地区の性格へ寄せる: 居住区画は人の痕跡(刻印・荷袋)、
 * 廃棄沈殿層は薬莢と瓦礫まわりの遺体、電力区は警告、大空洞水域は灯(帰り道の目印)、
 * 精錬区は薬莢(鋳殻)と警告、生体異物区は遺体が多く刻印は少ない。
 */
export const DISTRICT_TRACE_MUL: Record<BiomeId, Partial<Record<TraceType, number>>> = {
  coldSteel: {},
  habitation: { tally: 2.2, pack: 1.6 },
  disposal: { shells: 2.2, corpse: 1.4, tally: 0.7 },
  waterVoid: { lamp: 1.6 },
  power: { warning: 2.4, shells: 1.6 },
  foundry: { shells: 1.8, warning: 1.5, corpse: 1.3 },
  biomech: { corpse: 2.0, lamp: 0.6, tally: 0.6 },
};

/** 地区の重み倍率を適用した種別表(traceAt の抽選とテストが共有する) */
export function traceTableFor(id: BiomeId, kind: 'floor' | 'wall'): { v: TraceType; w: number }[] {
  const base: ReadonlyArray<{ v: TraceType; w: number }> = kind === 'floor' ? FLOOR_TABLE : WALL_TABLE;
  const mul = DISTRICT_TRACE_MUL[id];
  return base.map((e) => ({ v: e.v, w: e.w * (mul[e.v] ?? 1) }));
}

/**
 * 休憩点の刻印の刻線数(地区の刻印パターン)。設計 §4.2 の「地区名の刻印」は、
 * 内部バッファの解像度と 32 色量子化では文字が読めないため、刻線の本数で
 * 地区を表す形にした(段階 3 の裁定)。近くで見れば数えられる差。
 */
export const REST_TALLY_STROKES: Record<BiomeId, number> = {
  coldSteel: 4,
  habitation: 7,
  disposal: 3,
  waterVoid: 5,
  power: 6,
  foundry: 4,
  biomech: 8,
};

/** (wx, wy) が休憩点の箱の灯そのものなら、その休憩点の cell(灯色の地区参照用)。それ以外は null */
export function restLampCellAt(seed: number, wx: number, wy: number): number | null {
  const rp = nearestRestPoint(seed, wx, wy);
  return wy === rp.floorY - 1 && rp.lamps.includes(wx) ? rp.cell : null;
}

/** (wx, wy) が休憩点の箱の刻印そのものなら、その休憩点の cell。それ以外は null */
export function restTallyCellAt(seed: number, wx: number, wy: number): number | null {
  const rp = nearestRestPoint(seed, wx, wy);
  return wy === rp.tallyY && wx === rp.left ? rp.cell : null;
}

/**
 * (seed, wx, wy) に痕跡があれば返す(なければ null)。純粋・決定論。
 * 休憩点(§5.4): 床の 1 段上の決められた X に灯(3〜5)と荷袋、左の壁の内側の面に刻印を必ず置き、
 * 箱の周囲 24 タイルでは出現率を 5 倍にする(痕跡は孔と休憩点の周辺に濃く出る)。
 * kind='floor': 呼び出し側が「AIRかつ直下SOLIDの縁タイル」に対して呼ぶ想定。
 * kind='wall' : 呼び出し側が「SOLIDかつ左右いずれか空気の壁面タイル」に対して呼ぶ想定。
 * (適格判定は chunkbake 側。ここは有無と種別のみを決める。)
 */
export function traceAt(seed: number, wx: number, wy: number, kind: 'floor' | 'wall'): Trace | null {
  // id は将来の断章lookupキー。kind を混ぜて、同座標の床/壁で衝突しないようにする。
  const id = Math.floor(hash2(seed + 8300 + (kind === 'floor' ? 0 : 1), wx, wy) * 0x7fffffff);
  const rp = nearestRestPoint(seed, wx, wy);
  const near = wx >= rp.left - REST_HALO && wx <= rp.right + REST_HALO
    && wy >= rp.floorY - REST_HEIGHT - 1 - REST_HALO && wy <= rp.floorY + REST_HALO;
  if (near) {
    if (kind === 'floor' && wy === rp.floorY - 1) {
      if (rp.lamps.includes(wx)) return { type: 'lamp', id };
      if (wx === rp.packX) return { type: 'pack', id };
    }
    if (kind === 'wall' && wy === rp.tallyY && wx === rp.left) return { type: 'tally', id };
  }
  const rate = (kind === 'floor' ? FLOOR_RATE : WALL_RATE) * (near ? REST_RATE_MULTIPLIER : 1);
  const gate = hash2(seed + (kind === 'floor' ? 8100 : 8200), wx, wy);
  if (gate >= rate) return null;
  const pick = hash2(seed + (kind === 'floor' ? 8110 : 8210), wx, wy);
  const type = weighted(traceTableFor(biomeIdForCell(seed, biomeCellAt(seed, wy)), kind), pick);
  return { type, id };
}
