import { hash2 } from '../world/noise';
import { stratumIndexAt } from '../world/strata';
import { CHUNK_SIZE, TILE } from '../world/tiles';
import { tileAt } from '../world/worldgen';
import { STEEL, mixHex } from './steel';

/**
 * 装飾の描画命令。座標はチャンクローカルのタイル単位(浮動小数)。
 * チャンク境界をまたぐ装飾は範囲外の座標を取ることがある(焼き込み時にクリップされる)。
 */
// surface: アトラスのオートタイルが同等の表現を描くようになった「表面線画」
// (辺ハイライト・パネル継ぎ目・リベット・ハッチ)を示す。焼き込み時に二重描画を避けて間引く。
export type DecorOp =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; w: number; color: string; surface?: boolean }
  | { kind: 'dot'; x: number; y: number; r: number; color: string; surface?: boolean }
  | { kind: 'poly'; pts: number[]; w: number; color: string; fill?: boolean; surface?: boolean }
  | { kind: 'hatch'; x: number; y: number; w: number; h: number; spacing: number; color: string; cross?: boolean; surface?: boolean }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; color: string; alpha?: number; surface?: boolean }
  | { kind: 'grad'; x: number; y: number; w: number; h: number; dir: 'h' | 'v'; stops: ReadonlyArray<readonly [number, string]>; alpha?: number; surface?: boolean };

/** 装飾の色パレット(realismモックの鋼ランプSTEELから導出。暖色は錆のみリテラル) */
export const PALETTE = {
  edgeTop: STEEL.railTop,
  edgeSide: STEEL.bayEdge,
  seam: STEEL.shadow,
  rivet: STEEL.post,
  bolt: STEEL.post,
  hatch: STEEL.grate,
  hatchFaint: STEEL.stringer,
  pipe: STEEL.rib,
  pipeThin: STEEL.grate,
  bracket: STEEL.trayEdge,
  cable: STEEL.stringer,
  wire: STEEL.shadow,
  grill: STEEL.trayEdge,
  debris: STEEL.base,
  debrisLine: STEEL.bayEdge,
  rail: STEEL.post,
  rung: STEEL.bayEdge,
  hoop: STEEL.hanger,
  // ── 段階F: 壁・歩廊・配管の接合ディテール ──
  bay: STEEL.far,           // 凹ベイの暗面
  bayEdge: STEEL.bayEdge,   // ベイ上縁の受け光
  rib: STEEL.rib,           // リブ柱・ガセット
  ribLight: STEEL.flange,   // リブ柱の受け光エッジ
  stringer: STEEL.stringer, // H鋼ストリンガー
  web: STEEL.rib,           // H鋼ウェブ
  flange: STEEL.flange,     // 上フランジ受け光
  shadow: STEEL.shadow,     // 落ち影・ジョイスト
  grateLine: STEEL.shadow,  // グレーチングの目
  railPost: STEEL.post,     // 手すり支柱
  railTop: STEEL.railTop,   // 手すり上桟
  railMid: STEEL.bayEdge,   // 手すり中桟
  pipeHi: STEEL.post, pipeMid: STEEL.rib, pipeLo: STEEL.far, // 大径配管の円筒グラデ
  clamp: STEEL.flange,      // バンドクランプ
  hanger: STEEL.hanger,     // 吊り金具
  tray: STEEL.base, trayEdge: STEEL.trayEdge, trayCable: STEEL.hanger, // ケーブルトレイ
  rust: '#5a3a24', rust0: 'rgba(90,58,36,0)', // 錆筋(形に沿った風化。フェード終端)
  rebar: STEEL.bayEdge,     // 露出鉄筋
  hole: mixHex(STEEL.black, STEEL.far, 0.35), // 抜け区画
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
      if (upAir) ops.push({ kind: 'line', x1: lx, y1: ly + 0.06, x2: lx + 1, y2: ly + 0.06, w: 0.12, color: PALETTE.edgeTop, surface: true });
      if (downAir) ops.push({ kind: 'line', x1: lx, y1: ly + 0.97, x2: lx + 1, y2: ly + 0.97, w: 0.06, color: PALETTE.edgeSide, surface: true });
      if (leftAir) ops.push({ kind: 'line', x1: lx + 0.03, y1: ly, x2: lx + 0.03, y2: ly + 1, w: 0.06, color: PALETTE.edgeSide, surface: true });
      if (rightAir) ops.push({ kind: 'line', x1: lx + 0.97, y1: ly, x2: lx + 0.97, y2: ly + 1, w: 0.06, color: PALETTE.edgeSide, surface: true });

      // パネル継ぎ目(ワールド座標基準なのでチャンクをまたいで連続する)。
      // 密なパネル格子を作るため出現率を上げ、継ぎ目沿いに一定間隔でリベットを打つ。
      const seamV = hash2(seed + 601, wx, 0) < 0.34;
      if (seamV && !rightAir) {
        ops.push({ kind: 'line', x1: lx + 1, y1: ly, x2: lx + 1, y2: ly + 1, w: 0.08, color: PALETTE.seam, surface: true });
        if (upAir) ops.push({ kind: 'dot', x: lx + 1, y: ly + 0.35, r: 0.07, color: PALETTE.rivet, surface: true });
        else if (mod(wy, 3) === 0) ops.push({ kind: 'dot', x: lx + 1, y: ly + 0.5, r: 0.05, color: PALETTE.rivet, surface: true });
      }
      const seamH = hash2(seed + 602, 0, wy) < 0.26;
      if (seamH && !downAir) {
        ops.push({ kind: 'line', x1: lx, y1: ly + 1, x2: lx + 1, y2: ly + 1, w: 0.08, color: PALETTE.seam, surface: true });
        if (hash2(seed + 603, wx, wy) < 0.4) {
          ops.push({ kind: 'dot', x: lx + 0.5, y: ly + 1, r: 0.06, color: PALETTE.rivet, surface: true });
        }
      }
      // パネル交点のボルト群(縦横の継ぎ目が交わる内側の角に4点)
      if (seamV && seamH && !rightAir && !downAir && hash2(seed + 605, wx, wy) < 0.5) {
        const cxp = lx + 1;
        const cyp = ly + 1;
        for (const [ox, oy] of [
          [-0.16, -0.16],
          [0.16, -0.16],
          [-0.16, 0.16],
          [0.16, 0.16],
        ] as const) {
          ops.push({ kind: 'dot', x: cxp + ox, y: cyp + oy, r: 0.04, color: PALETTE.bolt });
        }
      }

      // 内部: モックの壁はフラットな暗面が基調。ハッチは一部タイルだけ淡く残し、
      // 世界座標整列のリブ柱(11タイル周期)が垂直リズムを作る。
      if (!upAir && !downAir && !leftAir && !rightAir) {
        if (hash2(seed + 604, wx, wy) < 0.22) {
          const si = stratumIndexAt(wy) % 3;
          const spacing = 0.26 + 0.07 * si;
          ops.push({ kind: 'hatch', x: lx, y: ly, w: 1, h: 1, spacing, color: PALETTE.hatchFaint, cross: false, surface: true });
        }
        // リブ柱(右側に受け光・2タイルごとにボルト)。列単位のhashで7割の柱が現存
        if (mod(wx, 11) === 0 && hash2(seed + 726, Math.floor(wx / 11), 0) < 0.7) {
          ops.push({ kind: 'rect', x: lx + 0.3, y: ly, w: 0.5, h: 1, color: PALETTE.rib });
          ops.push({ kind: 'line', x1: lx + 0.8, y1: ly, x2: lx + 0.8, y2: ly + 1, w: 0.07, color: PALETTE.ribLight });
          if (mod(wy, 2) === 0) ops.push({ kind: 'dot', x: lx + 0.55, y: ly + 0.5, r: 0.06, color: PALETTE.bolt });
        }
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
      if (r < 0.52) {
        // 這う配管(太)+ときどき細い並走管、4タイルごとにブラケット
        const yy = ly - 0.22;
        ops.push({ kind: 'line', x1: lx0, y1: yy, x2: lx0 + 16, y2: yy, w: 0.22, color: PALETTE.pipe });
        if (r < 0.3) {
          ops.push({ kind: 'line', x1: lx0, y1: yy - 0.32, x2: lx0 + 16, y2: yy - 0.32, w: 0.13, color: PALETTE.pipeThin });
        }
        for (let i = 2; i < 16; i += 4) {
          ops.push({ kind: 'line', x1: lx0 + i, y1: yy, x2: lx0 + i, y2: ly, w: 0.1, color: PALETTE.bracket });
        }
      } else if (r < 0.66) {
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
      if (r < 0.44) {
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
      } else if (r < 0.62) {
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
        if (r < 0.2) {
          // 排気グリル(短い横線5本)
          for (let i = 0; i < 5; i++) {
            const gy = ly0 + 0.7 + i * 0.42;
            const gx = dir === -1 ? lx + 0.12 : lx + 0.55;
            ops.push({ kind: 'line', x1: gx, y1: gy, x2: gx + 0.33, y2: gy, w: 0.07, color: PALETTE.grill });
          }
        } else if (r < 0.36) {
          // 壁面を走る縦配管
          ops.push({ kind: 'line', x1: face, y1: ly0, x2: face, y2: ly0 + 4, w: 0.14, color: PALETTE.pipe });
          ops.push({ kind: 'dot', x: face, y: ly0 + 2, r: 0.12, color: PALETTE.bracket });
        }
      }
    }
  }

  // ── 凹ベイ: 8x7 の世界座標整列ブロックが周囲1タイル込みで完全SOLIDなら、
  // 後退した暗い区画を彫る(内側上端の落ち影+上縁の受け光+損傷+錆筋)。
  // モックの「凹ベイ+抜け区画+露出鉄筋+錆の筋」に対応する。
  const bs0 = Math.floor((bx - 16) / 8);
  const bs1 = Math.floor((bx + CHUNK_SIZE) / 8);
  const bt0 = Math.floor((by - 16) / 7);
  const bt1 = Math.floor((by + CHUNK_SIZE) / 7);
  for (let sy = bt0; sy <= bt1; sy++) {
    for (let sx = bs0; sx <= bs1; sx++) {
      if (hash2(seed + 721, sx, sy) > 0.6) continue; // 全面ベイだと壁が虚ろになるので6割
      const x0 = sx * 8;
      const y0 = sy * 7;
      let ok = true;
      for (let iy = -1; iy <= 7 && ok; iy++)
        for (let ix = -1; ix <= 8 && ok; ix++)
          ok = t(x0 + ix, y0 + iy) === TILE.SOLID;
      if (!ok) continue;
      const lx0 = x0 - bx;
      const ly0 = y0 - by;
      ops.push({ kind: 'rect', x: lx0 + 0.5, y: ly0 + 0.5, w: 7, h: 6, color: PALETTE.bay });
      ops.push({ kind: 'rect', x: lx0 + 0.5, y: ly0 + 0.5, w: 7, h: 0.5, color: STEEL.black, alpha: 0.6 });
      ops.push({ kind: 'line', x1: lx0 + 0.5, y1: ly0 + 0.5, x2: lx0 + 7.5, y2: ly0 + 0.5, w: 0.08, color: PALETTE.bayEdge });
      // 損傷: 抜け区画+露出鉄筋(35%)
      if (hash2(seed + 722, sx, sy) < 0.35) {
        const hx = lx0 + 1 + Math.floor(hash2(seed + 723, sx, sy) * 4);
        const hy = ly0 + 3.5;
        ops.push({ kind: 'rect', x: hx, y: hy, w: 2.4, h: 2.4, color: PALETTE.hole });
        for (let i = 0; i < 3; i++) {
          const rx = hx + 0.3 + i * 0.8;
          ops.push({ kind: 'line', x1: rx, y1: hy + 2.4, x2: rx + 0.5, y2: hy + 1.2, w: 0.05, color: PALETTE.rebar });
        }
      }
      // 錆筋: 上縁から下へフェード(50%)
      if (hash2(seed + 724, sx, sy) < 0.5) {
        const rx = lx0 + 1 + hash2(seed + 725, sx, sy) * 5.5;
        ops.push({
          kind: 'grad', x: rx, y: ly0 + 0.6, w: 0.28, h: 2.6, dir: 'v',
          stops: [[0, PALETTE.rust], [1, PALETTE.rust0]], alpha: 0.45,
        });
      }
    }
  }
}
