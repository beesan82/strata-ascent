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

  // 事前計算: [-MARGIN, CHUNK_SIZE+MARGIN) のタイルを1回のtileAtパスでバッファ化する。
  // 以降のタイル参照(タイルパス・セグメントパスの両方)はすべてこのバッファから読み、
  // tileAt呼び出しを 5*64*64 回から 98*98 回へ削減する。MARGIN=17 は全セグメント走査
  // (床16/天井8幅の水平走査 + 隣接1タイル確認、壁4幅の垂直走査)を範囲内に収める。
  const MARGIN = 17;
  const N = CHUNK_SIZE + 2 * MARGIN; // 98
  const buf = new Int8Array(N * N);
  for (let ly = -MARGIN; ly < CHUNK_SIZE + MARGIN; ly++) {
    const rowBase = (ly + MARGIN) * N;
    for (let lx = -MARGIN; lx < CHUNK_SIZE + MARGIN; lx++) {
      buf[rowBase + (lx + MARGIN)] = tileAt(seed, bx + lx, by + ly);
    }
  }
  // ローカル座標でバッファを読む(範囲外は AIR 扱い)
  const t = (lx: number, ly: number): number => {
    const ix = lx + MARGIN;
    const iy = ly + MARGIN;
    if (ix < 0 || iy < 0 || ix >= N || iy >= N) return TILE.AIR;
    return buf[iy * N + ix];
  };
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

  // セグメント装飾はワールド座標整列で判定する。世界座標アクセサをバッファ読みで渡す。
  segmentOps(ops, seed, bx, by, (wx, wy) => t(wx - bx, wy - by));
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

/**
 * ワールド座標整列セグメント単位の装飾(チャンク境界で継ぎ目が出ない)。
 * 走査範囲は ±MARGIN=17 のタイルバッファで答えられるセグメントに絞る:
 * このチャンクのピクセルに重なるセグメントはすべて計算され(隣接チャンクも同一結論に至る)、
 * バッファ外を読むセグメントは走査しない(それらは隣接チャンクが完全に計算し、焼き込み時にクリップされる)。
 * 具体的には x0/y0 を [base-16, base+CHUNK_SIZE] に収める(床/天井は x0+幅-1 が base+79 まで、
 * 壁は y0+3 が base+67 までとなり、いずれもバッファ [-17, 80] の範囲内)。
 */
function segmentOps(
  ops: DecorOp[],
  seed: number,
  bx: number,
  by: number,
  t: (wx: number, wy: number) => number,
): void {
  // ── 床: 16タイルセグメント。全タイルが「上面が空気のSOLID」なら配管か瓦礫 ──
  const fs0 = Math.floor((bx - 16) / 16);
  const fs1 = Math.floor((bx + CHUNK_SIZE) / 16);
  for (let ly = -1; ly <= CHUNK_SIZE; ly++) {
    const wy = by + ly;
    for (let s = fs0; s <= fs1; s++) {
      const x0 = s * 16;
      let ok = true;
      for (let i = 0; i < 16 && ok; i++) {
        ok = t(x0 + i, wy) === TILE.SOLID && t(x0 + i, wy - 1) !== TILE.SOLID;
      }
      if (!ok) continue;
      const lx0 = x0 - bx;
      const r = hash2(seed + 701, s, wy);
      if (r < 0.45) {
        // 這う配管(太)+ときどき細い並走管、5タイルごとにブラケット
        const yy = ly - 0.22;
        ops.push({ kind: 'line', x1: lx0, y1: yy, x2: lx0 + 16, y2: yy, w: 0.22, color: PALETTE.pipe });
        if (r < 0.22) {
          ops.push({ kind: 'line', x1: lx0, y1: yy - 0.3, x2: lx0 + 16, y2: yy - 0.3, w: 0.13, color: PALETTE.pipeThin });
        }
        for (let i = 2; i < 16; i += 5) {
          ops.push({ kind: 'line', x1: lx0 + i, y1: yy, x2: lx0 + i, y2: ly, w: 0.1, color: PALETTE.bracket });
        }
      } else if (r < 0.58) {
        // 瓦礫の山
        const dx = lx0 + 3 + hash2(seed + 702, s, wy) * 8;
        ops.push({
          kind: 'poly',
          pts: [dx, ly, dx + 0.8, ly - 0.55, dx + 1.5, ly - 0.3, dx + 2.2, ly - 0.7, dx + 3, ly],
          w: 0,
          color: PALETTE.debris,
          fill: true,
        });
        ops.push({
          kind: 'poly',
          pts: [dx + 0.3, ly - 0.1, dx + 0.9, ly - 0.45, dx + 1.4, ly - 0.25],
          w: 0.06,
          color: PALETTE.debrisLine,
        });
      }
    }
  }

  // ── 天井: 8タイルセグメント。全タイルが「下面が空気のSOLID」ならケーブル ──
  const cs0 = Math.floor((bx - 16) / 8);
  const cs1 = Math.floor((bx + CHUNK_SIZE) / 8);
  for (let ly = -1; ly <= CHUNK_SIZE; ly++) {
    const wy = by + ly;
    for (let s = cs0; s <= cs1; s++) {
      const x0 = s * 8;
      let ok = true;
      for (let i = 0; i < 8 && ok; i++) {
        ok = t(x0 + i, wy) === TILE.SOLID && t(x0 + i, wy + 1) !== TILE.SOLID;
      }
      if (!ok) continue;
      const lx0 = x0 - bx;
      const r = hash2(seed + 703, s, wy);
      if (r < 0.35) {
        // カテナリーケーブル(2次ベジェを9点でサンプリング)
        const sag = 1 + hash2(seed + 704, s, wy) * 2.2;
        const pts: number[] = [];
        for (let i = 0; i <= 8; i++) {
          const u = i / 8;
          const x = lx0 + u * 8;
          const y = ly + 1 + 2 * sag * u * (1 - u);
          pts.push(x, y);
        }
        ops.push({ kind: 'poly', pts, w: 0.09, color: PALETTE.cable });
      } else if (r < 0.5) {
        // 切れて垂れる短いワイヤー
        const wx0 = lx0 + 1 + Math.floor(hash2(seed + 705, s, wy) * 6);
        const len = 0.8 + hash2(seed + 706, s, wy) * 1.2;
        const bend = 0.25 * (hash2(seed + 707, s, wy) - 0.5);
        ops.push({
          kind: 'poly',
          pts: [wx0, ly + 1, wx0 + bend, ly + 1 + len * 0.6, wx0 + bend * 2.5, ly + 1 + len],
          w: 0.06,
          color: PALETTE.wire,
        });
      }
    }
  }

  // ── 壁面: 縦4タイルセグメント。左右どちらかに面が露出していたらグリル/縦配管 ──
  const ws0 = Math.floor((by - 16) / 4);
  const ws1 = Math.floor((by + CHUNK_SIZE) / 4);
  for (let lx = -1; lx <= CHUNK_SIZE; lx++) {
    const wx = bx + lx;
    for (let s = ws0; s <= ws1; s++) {
      const y0 = s * 4;
      for (const dir of [-1, 1] as const) {
        let ok = true;
        for (let i = 0; i < 4 && ok; i++) {
          ok = t(wx, y0 + i) === TILE.SOLID && t(wx + dir, y0 + i) !== TILE.SOLID;
        }
        if (!ok) continue;
        const face = dir === -1 ? lx + 0.08 : lx + 0.92;
        const ly0 = y0 - by;
        const r = hash2(seed + 708, wx, s * 2 + (dir < 0 ? 0 : 1));
        if (r < 0.14) {
          // 排気グリル(短い横線4本)
          for (let i = 0; i < 4; i++) {
            const gy = ly0 + 0.8 + i * 0.45;
            const gx = dir === -1 ? lx + 0.12 : lx + 0.55;
            ops.push({ kind: 'line', x1: gx, y1: gy, x2: gx + 0.33, y2: gy, w: 0.07, color: PALETTE.grill });
          }
        } else if (r < 0.26) {
          // 壁面を走る縦配管
          ops.push({ kind: 'line', x1: face, y1: ly0, x2: face, y2: ly0 + 4, w: 0.14, color: PALETTE.pipe });
          ops.push({ kind: 'dot', x: face, y: ly0 + 2, r: 0.12, color: PALETTE.bracket });
        }
      }
    }
  }
}
