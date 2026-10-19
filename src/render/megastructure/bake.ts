import type { DrawOp, StructureSpec } from './spec';

/**
 * 焼き込みキャンバスの純粋部分。
 * 塔 1 本は (spec キー, 見かけ幅, 環境色, かすみ) が同じなら毎フレーム同じ絵になるので、
 * 一度だけ CPU キャンバスへ描き、以後は drawImage で貼る(ソフトウェア描画で約 5 ms → 1〜2 ms)。
 * ここにはキャンバスを触らない計算だけを置き、Vitest で検証する。
 */

/** 焼き込みキーの材料。sh は sw から決まる(1.25 倍)ので含めない。 */
export interface BakeKeyParts {
  specKey: string;
  sw: number;
  ambientColor: string;
  hf: number;
}

/** 焼き込みキャッシュのキー。sw は小数(ppt 由来)なのでそのまま文字列化する。 */
export function bakeKey(p: BakeKeyParts): string {
  return `${p.specKey}|${p.sw}|${p.ambientColor}|${p.hf}`;
}

/** 塔原点(左上)からの画素矩形。x1/y1 は排他的でなく「含む端」の実数。 */
export interface PxBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 線幅の決め方(drawOp と同じ式)。 */
export const TRUSS_LINE = (sw: number): number => Math.max(1, sw * 0.01);
export const PIPE_LINE = (sw: number, width: number): number => Math.max(1, width * sw);
export const RIM_LINE = (sw: number): number => Math.max(1, sw * 0.006);
/** glow は中心から半径 r*3(sw 基準)の円。 */
export const GLOW_REACH = 3;

/**
 * spec の全オペが塗る範囲(画素)を塔原点からの相対で求める。
 * 線は折れ線の角(miter)が線幅の外へ出るので線幅ぶん、glow は半径 r*3 ぶん外へ広げる。
 * 何も描かない spec は原点の 0 矩形を返す。
 */
export function specBounds(spec: StructureSpec, sw: number, sh: number): PxBounds {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (ax: number, ay: number, bx: number, by: number, pad: number) => {
    x0 = Math.min(x0, ax - pad); y0 = Math.min(y0, ay - pad);
    x1 = Math.max(x1, bx + pad); y1 = Math.max(y1, by + pad);
  };
  const rect = (op: { x: number; y: number; w: number; h: number }, pad: number) =>
    grow(op.x * sw, op.y * sh, (op.x + op.w) * sw, (op.y + op.h) * sh, pad);
  const poly = (pts: [number, number][], pad: number) => {
    for (const [px, py] of pts) grow(px * sw, py * sh, px * sw, py * sh, pad);
  };
  for (const op of spec.ops) opBounds(op, sw, sh, rect, poly);
  if (x0 === Infinity) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return { x0, y0, x1, y1 };
}

function opBounds(
  op: DrawOp, sw: number, sh: number,
  rect: (op: { x: number; y: number; w: number; h: number }, pad: number) => void,
  poly: (pts: [number, number][], pad: number) => void,
): void {
  switch (op.t) {
    case 'mass':
    case 'cyl':
    case 'gap':
      rect(op, 0);
      break;
    case 'truss':
      rect(op, TRUSS_LINE(sw) / 2);
      break;
    case 'panels':
    case 'frame':
      rect(op, 0.5);
      break;
    case 'pipe':
      poly(op.pts, PIPE_LINE(sw, op.width));
      break;
    case 'rim':
      poly(op.pts, RIM_LINE(sw));
      break;
    case 'glow': {
      const r = op.r * sw * GLOW_REACH;
      poly([[op.x, op.y]], 0);
      // 円なので sw/sh の比に依らず画素半径 r で広げる
      poly([[op.x - r / sw, op.y - r / sh], [op.x + r / sw, op.y + r / sh]], 0);
      break;
    }
    default: {
      const _exhaustive: never = op;
      void _exhaustive;
    }
  }
}

/** 焼き込みキャンバスの大きさと、塔原点のキャンバス内位置(整数)。 */
export interface BakeLayout {
  width: number;
  height: number;
  /** 塔原点 (0,0) をキャンバス内のどこに置くか(= -floor(x0), -floor(y0)) */
  originX: number;
  originY: number;
}

/** 境界を整数画素へ切り上げ/切り下げてキャンバスの寸法に直す。1 px の余白を全周に足す。 */
export function bakeLayout(b: PxBounds): BakeLayout {
  const x0 = Math.floor(b.x0) - 1;
  const y0 = Math.floor(b.y0) - 1;
  const x1 = Math.ceil(b.x1) + 1;
  const y1 = Math.ceil(b.y1) + 1;
  return { width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0), originX: -x0, originY: -y0 };
}

/** drawImage の 9 引数(元矩形 → 先矩形)。画面外を切り落として渡す。 */
export interface BlitRect {
  sx: number; sy: number; w: number; h: number;
  dx: number; dy: number;
}

/**
 * 画素 (dx,dy) に置いたキャンバス (cw×ch) のうち画面 (0..w, 0..h) に入る部分。
 * 塔の大半は画面上端より上(sh > 画面高)なので、見える帯だけを転写して合成量を抑える。
 * 完全に画面外なら null。
 */
export function visibleBlit(dx: number, dy: number, cw: number, ch: number, w: number, h: number): BlitRect | null {
  const x0 = Math.max(0, dx), y0 = Math.max(0, dy);
  const x1 = Math.min(w, dx + cw), y1 = Math.min(h, dy + ch);
  if (x1 <= x0 || y1 <= y0) return null;
  return { sx: x0 - dx, sy: y0 - dy, w: x1 - x0, h: y1 - y0, dx: x0, dy: y0 };
}

/**
 * 上限付き LRU。get で触った項目を末尾へ送り、set で溢れたら先頭(最も触られていない)を捨てる。
 * 可視の塔は毎フレーム触られるので、上限が可視数(数十)を超えていれば歩行中に再焼き込みは起きない。
 */
export class LruCache<V> {
  private map = new Map<string, V>();

  constructor(readonly cap: number) {}

  get size(): number {
    return this.map.size;
  }

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: string, v: V): void {
    this.map.delete(key);
    this.map.set(key, v);
    while (this.map.size > this.cap) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  has(key: string): boolean {
    return this.map.has(key);
  }
}
