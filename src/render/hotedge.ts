/**
 * 掘削縁の熱色残光(段階 3、設計 §5.1)の判定と、熱表現の強化(溶け・赤熱)の段階定義。
 * 掘削直後の縁に熱色を残す表現は焼き込み側に相乗りさせ、時間で冷える切り替えは
 * 「段階が変わったら 1 回だけ再焼き込みする」ことで行う(毎フレームの再焼き込みはしない)。
 * ここは「どの面が掘削縁か」と「経過秒からどの冷却段階か」の純粋関数だけを持つ。
 */
import { TILE, isSolid } from '../world/tiles';
import { hash2 } from '../world/noise';

/** 発射後、掘削縁の熱が残る総秒数(ChunkBaker の段階管理で使う) */
export const HEAT_SECONDS = 8;

/**
 * 冷却段階: 0=白熱(直後) / 1=赤熱〜錆 / 2=暗い錆 / 3=冷却済み(描かない)。
 * パレットに真の赤は無いため「赤熱」は色相でなく、白→金→錆→暗褐の明度勾配と
 * 縁の太さ・溶けだれで表現する(量子化の最近傍計算で確認済み: 純粋な赤は錆に落ちる)。
 */
export type HeatStage = 0 | 1 | 2 | 3;

/** 段階の境界(秒): [白熱の終わり, 赤熱の終わり, 暗い錆の終わり] */
export const HEAT_STAGE_ENDS: readonly [number, number, number] = [1.5, 4, HEAT_SECONDS];

/** 経過秒 → 冷却段階。負の経過(時計の巻き戻り)は最も熱い段階として扱う */
export function heatStageAt(elapsedSec: number): HeatStage {
  if (elapsedSec < HEAT_STAGE_ENDS[0]) return 0;
  if (elapsedSec < HEAT_STAGE_ENDS[1]) return 1;
  if (elapsedSec < HEAT_STAGE_ENDS[2]) return 2;
  return 3;
}

/** 熱い縁の 1 層。depth は面からの累積の深さ(タイル)で、外側の層ほど大きい */
export interface HeatLayer {
  color: string;
  alpha: number;
  depth: number;
}

/** 冷却段階ごとの見た目。layers は外側→内側(面際)の順に重ねる */
export interface HeatLook {
  layers: readonly HeatLayer[];
  /** 溶けだれの最大長(タイル)。0 はだれを出さない */
  dripMaxLen: number;
  /** 溶けだれの色と、先端の滴の色(いずれもパレット実在色) */
  dripColor: string;
  dripTipColor: string;
}

export const HEAT_LOOKS: readonly [HeatLook, HeatLook, HeatLook] = [
  {
    // 白熱: 白い芯 + 金 + 錆の外帯。最も太い
    layers: [
      { color: '#9a6d32', alpha: 0.55, depth: 0.36 },
      { color: '#caa64a', alpha: 0.75, depth: 0.22 },
      { color: '#c7d0ce', alpha: 0.95, depth: 0.1 },
    ],
    dripMaxLen: 1.0,
    dripColor: '#caa64a',
    dripTipColor: '#c7d0ce',
  },
  {
    // 赤熱〜錆: 錆の帯 + 金の際線(従来の見た目より一段太く・濃く)
    layers: [
      { color: '#9a6d32', alpha: 0.6, depth: 0.27 },
      { color: '#caa64a', alpha: 0.85, depth: 0.07 },
    ],
    dripMaxLen: 0.45,
    dripColor: '#9a6d32',
    dripTipColor: '#caa64a',
  },
  {
    // 末段: 暗い錆だけが薄く残る
    layers: [{ color: '#5a3a24', alpha: 0.5, depth: 0.22 }],
    dripMaxLen: 0,
    dripColor: '#5a3a24',
    dripTipColor: '#5a3a24',
  },
];

export type HotSide = 'n' | 'e' | 's' | 'w';

export interface HotEdge {
  /** チャンク内タイル座標 */
  x: number;
  y: number;
  /** クレーターに面している辺 */
  side: HotSide;
}

/**
 * (size+2)×(size+2) のグリッド。中心 size×size が対象チャンク、
 * 周囲 1 セルは隣接チャンク分(境界の縁判定用)。添字は (y+1)*(size+2)+(x+1)。
 */
export interface HotEdgeGrids {
  /** 現在地形(破壊反映済み) */
  current: Uint8Array;
  /** 元地形(破壊前) */
  pristine: Uint8Array;
  /** 破壊マスク(0/1) */
  destroyed: Uint8Array;
}

/** 溶けだれ 1 本。座標はチャンク内タイル単位(小数可)で、(x, y) が左上 */
export interface MeltDrip {
  x: number;
  y: number;
  /** 幅(タイル) */
  w: number;
  /** 長さ(タイル、下向き) */
  len: number;
  /** 先端に滴(明るい色の短い矩形)を描くか */
  tip: boolean;
}

/**
 * 溶けだれの配置(熱い段階だけ)。掘削縁から下向きに熱色が垂れる筋を、
 * ワールド座標と面の種類だけから決定論で決める(地形生成には影響しない)。
 * 天井面(s)からは下の空気セルへ垂らし、床面(n)・壁面(e/w)では固体の面を伝わせる。
 * 上のチャンクの最下行タイルの s 面も源に含める(このチャンクの最上行へ垂れる分)。
 * 逆にこのチャンクの最下行の s 面からのだれは、下のチャンク側の焼き込みが描く。
 */
export function meltDrips(
  g: HotEdgeGrids, size: number, stage: HeatStage, seed: number, originX: number, originY: number,
): MeltDrip[] {
  if (stage === 3) return [];
  const look = HEAT_LOOKS[stage];
  if (look.dripMaxLen <= 0) return [];
  const n = size + 2;
  const edges: HotEdge[] = hotEdges(g, size);
  // 上のチャンクの最下行(y=-1)の s 面: 直下のセル(このチャンクの最上行)がクレーターなら源になる
  for (let x = 0; x < size; x++) {
    if (!isSolid(g.current[0 * n + (x + 1)])) continue;
    if (isCrater(g, n, x, 0)) edges.push({ x, y: -1, side: 's' });
  }
  const sideIdx = (s: HotSide): number => (s === 'n' ? 0 : s === 'e' ? 1 : s === 's' ? 2 : 3);
  const noneBelow = stage === 0 ? 0.4 : 0.62; // この値未満のロールでは出ない(冷えるほど疎ら)
  const out: MeltDrip[] = [];
  for (const e of edges) {
    const wx = originX + e.x;
    const wy = originY + e.y;
    const hy = wy * 4 + sideIdx(e.side);
    const roll = hash2(seed + 7919, wx, hy);
    const count = roll < noneBelow ? 0 : roll < noneBelow + 0.42 ? 1 : 2;
    for (let i = 0; i < count; i++) {
      const off = hash2(seed + 104729, wx * 2 + i, hy);
      const lenRoll = hash2(seed + 1299709, wx * 2 + i, hy);
      const w = 0.07 + off * 0.06;
      let len = (0.3 + lenRoll * 0.7) * look.dripMaxLen;
      let x: number;
      let y: number;
      if (e.side === 'n') {
        // 床の縁: 自タイルの面を上端から伝う
        x = e.x + off * (1 - w);
        y = e.y;
        len = Math.min(len, 0.95);
      } else if (e.side === 's') {
        // 天井の縁: 直下の空気セルへ垂れる
        x = e.x + off * (1 - w);
        y = e.y + 1;
        len = Math.min(len, 0.98);
      } else {
        // 壁面: 面の際を、上寄りの位置から下へ伝う(自タイルの中に収める)
        const start = off * 0.3;
        x = e.side === 'w' ? e.x + 0.03 : e.x + 1 - w - 0.03;
        y = e.y + start;
        len = Math.min(len, 0.98 - start);
      }
      if (len <= 0.05) continue;
      out.push({ x, y, w, len, tip: len >= 0.25 });
    }
  }
  return out;
}

/** クレーター = 破壊済み かつ 元地形が空気でないセル(未生成への記録だけのセルを除く) */
function isCrater(g: HotEdgeGrids, n: number, x: number, y: number): boolean {
  const i = (y + 1) * n + (x + 1);
  return g.destroyed[i] === 1 && g.pristine[i] !== TILE.AIR;
}

/**
 * 掘削縁の一覧: 現在固体のタイルのうち、4 近傍のいずれかがクレーターである面。
 * HARD も固体として縁を持つ(板の際を掘った熱が板の面に残る)。
 */
export function hotEdges(g: HotEdgeGrids, size: number): HotEdge[] {
  const n = size + 2;
  const out: HotEdge[] = [];
  const sides: Array<[number, number, HotSide]> = [
    [0, -1, 'n'],
    [1, 0, 'e'],
    [0, 1, 's'],
    [-1, 0, 'w'],
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isSolid(g.current[(y + 1) * n + (x + 1)])) continue;
      for (const [dx, dy, side] of sides) {
        if (isCrater(g, n, x + dx, y + dy)) out.push({ x, y, side });
      }
    }
  }
  return out;
}
