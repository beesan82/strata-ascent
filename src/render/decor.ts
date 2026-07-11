import { hash2 } from '../world/noise';
import { stratumIndexAt } from '../world/strata';
import { CHUNK_SIZE, TILE } from '../world/tiles';
import { tileAt } from '../world/worldgen';

/**
 * 装飾の描画命令。座標はチャンクローカルのタイル単位(浮動小数)。
 * チャンク境界をまたぐ装飾は範囲外の座標を取ることがある(焼き込み時にクリップされる)。
 */
export type DecorOp =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; w: number; color: string }
  | { kind: 'dot'; x: number; y: number; r: number; color: string }
  | { kind: 'poly'; pts: number[]; w: number; color: string; fill?: boolean }
  | { kind: 'hatch'; x: number; y: number; w: number; h: number; spacing: number; color: string };

/** 装飾の色パレット(すべて暗色。ライトに照らされて初めて質感として読める) */
export const PALETTE = {
  edgeTop: '#4a545e',
  edgeSide: '#39424b',
  seam: '#0a0d10',
  rivet: '#3b434b',
  hatch: '#2b3238',
  pipe: '#252c33',
  pipeThin: '#1f262c',
  bracket: '#30383f',
  cable: '#20262c',
  wire: '#191f24',
  grill: '#39424b',
  debris: '#1a2026',
  debrisLine: '#39424b',
  rail: '#39424b',
  rung: '#2c343b',
  hoop: '#242b31',
} as const;

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** チャンク(cx, cy)の装飾を計算する純粋関数。同じ入力なら常に同じ出力 */
export function decorateChunk(seed: number, cx: number, cy: number): DecorOp[] {
  const ops: DecorOp[] = [];
  const bx = cx * CHUNK_SIZE;
  const by = cy * CHUNK_SIZE;
  const t = (lx: number, ly: number) => tileAt(seed, bx + lx, by + ly);
  const solid = (lx: number, ly: number) => t(lx, ly) === TILE.SOLID;

  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    const wy = by + ly;
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const wx = bx + lx;
      const tile = t(lx, ly);
      if (tile === TILE.LADDER) {
        ladderOps(ops, wx, wy, lx, ly);
        continue;
      }
      if (tile !== TILE.SOLID) continue;

      const upAir = !solid(lx, ly - 1);
      const downAir = !solid(lx, ly + 1);
      const leftAir = !solid(lx - 1, ly);
      const rightAir = !solid(lx + 1, ly);

      // エッジハイライト(空気に面した輪郭。上面は明るく太く)
      if (upAir) ops.push({ kind: 'line', x1: lx, y1: ly + 0.06, x2: lx + 1, y2: ly + 0.06, w: 0.12, color: PALETTE.edgeTop });
      if (downAir) ops.push({ kind: 'line', x1: lx, y1: ly + 0.97, x2: lx + 1, y2: ly + 0.97, w: 0.06, color: PALETTE.edgeSide });
      if (leftAir) ops.push({ kind: 'line', x1: lx + 0.03, y1: ly, x2: lx + 0.03, y2: ly + 1, w: 0.06, color: PALETTE.edgeSide });
      if (rightAir) ops.push({ kind: 'line', x1: lx + 0.97, y1: ly, x2: lx + 0.97, y2: ly + 1, w: 0.06, color: PALETTE.edgeSide });

      // パネル継ぎ目(ワールド座標基準なのでチャンクをまたいで連続する)
      const seamV = hash2(seed + 601, wx, 0) < 0.22;
      if (seamV && !rightAir) {
        ops.push({ kind: 'line', x1: lx + 1, y1: ly, x2: lx + 1, y2: ly + 1, w: 0.08, color: PALETTE.seam });
        if (upAir) ops.push({ kind: 'dot', x: lx + 1, y: ly + 0.35, r: 0.07, color: PALETTE.rivet });
      }
      const seamH = hash2(seed + 602, 0, wy) < 0.16;
      if (seamH && !downAir) {
        ops.push({ kind: 'line', x1: lx, y1: ly + 1, x2: lx + 1, y2: ly + 1, w: 0.08, color: PALETTE.seam });
        if (hash2(seed + 603, wx, wy) < 0.35) {
          ops.push({ kind: 'dot', x: lx + 0.5, y: ly + 1, r: 0.07, color: PALETTE.rivet });
        }
      }

      // 内部ハッチング(露出面のないタイルのみ。階層で密度が変わる)
      if (!upAir && !downAir && !leftAir && !rightAir) {
        const spacing = 0.3 + 0.1 * (stratumIndexAt(wy) % 3);
        ops.push({ kind: 'hatch', x: lx, y: ly, w: 1, h: 1, spacing, color: PALETTE.hatch });
      }
    }
  }
  return ops;
}

/** 梯子1タイル分: レール2本+踏み桟+4タイルごとの背かご */
function ladderOps(ops: DecorOp[], _wx: number, wy: number, lx: number, ly: number): void {
  ops.push({ kind: 'line', x1: lx + 0.25, y1: ly, x2: lx + 0.25, y2: ly + 1, w: 0.1, color: PALETTE.rail });
  ops.push({ kind: 'line', x1: lx + 0.75, y1: ly, x2: lx + 0.75, y2: ly + 1, w: 0.1, color: PALETTE.rail });
  ops.push({ kind: 'line', x1: lx + 0.25, y1: ly + 0.5, x2: lx + 0.75, y2: ly + 0.5, w: 0.08, color: PALETTE.rung });
  if (mod(wy, 4) === 0) {
    ops.push({
      kind: 'poly',
      pts: [lx - 0.05, ly + 0.2, lx + 0.15, ly - 0.05, lx + 0.5, ly - 0.15, lx + 0.85, ly - 0.05, lx + 1.05, ly + 0.2],
      w: 0.07,
      color: PALETTE.hoop,
    });
  }
}
