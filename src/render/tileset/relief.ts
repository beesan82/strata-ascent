/** タイルの4辺が空気に面しているか(露出しているか) */
export interface ReliefEdges {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

/** 後退内面の帯。座標はタイル正規化(0..1, x=右, y=下)。from→to はグラデーション端点(露出面→内側)。 */
export interface ReliefBand {
  x: number;
  y: number;
  w: number;
  h: number;
  from: [number, number];
  to: [number, number];
}

/** 露出辺のリム線分。タイル正規化座標。top=歩ける上端(明るく描く印) */
export interface RimSeg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  top: boolean;
}

/**
 * 4近傍のSOLID有無(引数はいずれも「その方向がSOLIDか」)から露出辺を返す。
 * 露出 = 近傍が非SOLID(空気に面する)。純粋関数。
 */
export function reliefEdges(nSolid: boolean, eSolid: boolean, sSolid: boolean, wSolid: boolean): ReliefEdges {
  return { top: !nSolid, right: !eSolid, bottom: !sSolid, left: !wSolid };
}

/**
 * 露出辺ごとに、露出面から内側へ depth ぶん後退する暗帯の矩形とグラデ端点を返す。
 * グラデは露出面(from)側を濃く、内側(to)側を透明にする想定(色はchunkbake側)。
 * 各辺の帯は方向がタイル間で揃うため、同じ辺が連続すると継ぎ目なく1本の帯に見える。純粋関数。
 */
export function reliefBands(e: ReliefEdges, depth: number): ReliefBand[] {
  const out: ReliefBand[] = [];
  if (e.top) out.push({ x: 0, y: 0, w: 1, h: depth, from: [0, 0], to: [0, depth] });
  if (e.bottom) out.push({ x: 0, y: 1 - depth, w: 1, h: depth, from: [0, 1], to: [0, 1 - depth] });
  if (e.left) out.push({ x: 0, y: 0, w: depth, h: 1, from: [0, 0], to: [depth, 0] });
  if (e.right) out.push({ x: 1 - depth, y: 0, w: depth, h: 1, from: [1, 0], to: [1 - depth, 0] });
  return out;
}

/**
 * 露出辺のリム線分。上端(歩ける面)は top=true にして呼び出し側が明るく描く。純粋関数。
 */
export function rimSegments(e: ReliefEdges): RimSeg[] {
  const out: RimSeg[] = [];
  if (e.top) out.push({ x1: 0, y1: 0, x2: 1, y2: 0, top: true });
  if (e.bottom) out.push({ x1: 0, y1: 1, x2: 1, y2: 1, top: false });
  if (e.left) out.push({ x1: 0, y1: 0, x2: 0, y2: 1, top: false });
  if (e.right) out.push({ x1: 1, y1: 0, x2: 1, y2: 1, top: false });
  return out;
}
