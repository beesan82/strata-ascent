import { hash2 } from '../world/noise';
import { stratumIndexAt } from '../world/strata';
import { CHUNK_SIZE, TILE } from '../world/tiles';
import { tileAt } from '../world/worldgen';
import { STEEL, mixHex } from './steel';

export function hatchSpacingAt(worldY: number): number {
  const index = stratumIndexAt(worldY);
  const cycle = ((index % 3) + 3) % 3;
  return 0.26 + 0.07 * cycle;
}

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

/** decorateChunk が参照するチャンク周囲の幅(タイル) */
export const DECOR_MARGIN = 17;

/**
 * チャンク(cx, cy)の装飾を計算する純粋関数。同じ入力なら常に同じ出力。
 * pristine を渡すと、元地形(破壊前)を tileAt で引き直す代わりにそれを使う。並びは
 * (CHUNK_SIZE+2*DECOR_MARGIN)² で、チャンク左上から (-DECOR_MARGIN,-DECOR_MARGIN) ずらした位置が先頭。
 * 値は tileAt(seed, ...) と同じでなければならない(ChunkStore.pristineAround)。
 */
export function decorateChunk(seed: number, cx: number, cy: number, pristine?: Uint8Array): DecorOp[] {
  const ops: DecorOp[] = [];
  const bx = cx * CHUNK_SIZE;
  const by = cy * CHUNK_SIZE;

  // 事前計算: [-MARGIN, CHUNK_SIZE+MARGIN) のタイルを1回のtileAtパスでバッファ化する。
  // 以降のタイル参照(タイルパス・セグメントパスの両方)はすべてこのバッファから読み、
  // tileAt呼び出しを 5*64*64 回から 98*98 回へ削減する。MARGIN=17 は全セグメント走査
  // (床16/天井8幅の水平走査 + 隣接1タイル確認、壁4幅の垂直走査)を範囲内に収める。
  const MARGIN = DECOR_MARGIN;
  const N = CHUNK_SIZE + 2 * MARGIN; // 98
  let buf: Uint8Array | Int8Array;
  if (pristine) {
    buf = pristine;
  } else {
    buf = new Int8Array(N * N);
    for (let ly = -MARGIN; ly < CHUNK_SIZE + MARGIN; ly++) {
      const rowBase = (ly + MARGIN) * N;
      for (let lx = -MARGIN; lx < CHUNK_SIZE + MARGIN; lx++) {
        buf[rowBase + (lx + MARGIN)] = tileAt(seed, bx + lx, by + ly);
      }
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
          const spacing = hatchSpacingAt(wy);
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
  // 歩廊装飾は床から下へ最大3.2タイル伸びるため、上のチャンクにはみ出す床(ローカル負側)も
  // 走査する(ly=-4 から)。バッファ読みは最悪 ly-1=-5 で MARGIN=17 内。
  const fs0 = Math.floor((bx - 16) / 16);
  const fs1 = Math.floor((bx + CHUNK_SIZE) / 16);
  for (let ly = -4; ly <= CHUNK_SIZE; ly++) {
    const wy = by + ly;
    for (let s = fs0; s <= fs1; s++) {
      const x0 = s * 16;
      let ok = true;
      for (let i = 0; i < 16 && ok; i++) {
        ok = t(x0 + i, wy) === TILE.SOLID && t(x0 + i, wy - 1) !== TILE.SOLID;
      }
      if (!ok) continue;
      const lx0 = x0 - bx;
      // ── 段階F: 歩廊/床の接合ディテール(モックの片持ち歩廊。既存の這う配管・瓦礫とは独立) ──
      // グレーチングの目(歩ける上面のすぐ下に短い縦目。上端リムはrelief側が引く)
      for (let i = 0; i < 32; i++) {
        const gx = lx0 + i * 0.5 + 0.25;
        ops.push({ kind: 'line', x1: gx, y1: ly + 0.12, x2: gx, y2: ly + 0.42, w: 0.05, color: PALETTE.grateLine });
      }
      // 薄い床(全16タイルの直下が非SOLID)= 歩廊: H鋼+ジョイスト+落ち影+錆筋+ガセット
      let thin = true;
      for (let i = 0; i < 16 && thin; i++) thin = t(x0 + i, wy + 1) !== TILE.SOLID;
      if (thin) {
        const yb = ly + 1; // 床タイル下端
        ops.push({ kind: 'rect', x: lx0, y: yb, w: 16, h: 0.38, color: PALETTE.shadow, alpha: 0.8 }); // 落ち影
        ops.push({ kind: 'rect', x: lx0, y: yb - 0.5, w: 16, h: 0.5, color: PALETTE.stringer });      // H鋼側面
        ops.push({ kind: 'line', x1: lx0, y1: yb - 0.5, x2: lx0 + 16, y2: yb - 0.5, w: 0.07, color: PALETTE.flange }); // 上フランジ受け光
        ops.push({ kind: 'rect', x: lx0, y: yb - 0.32, w: 16, h: 0.14, color: PALETTE.web });         // ウェブ帯
        for (let i = 1; i < 16; i += 2) {
          ops.push({ kind: 'dot', x: lx0 + i, y: yb - 0.25, r: 0.05, color: PALETTE.bolt });
        }
        for (let i = 2; i < 16; i += 4) {
          ops.push({ kind: 'line', x1: lx0 + i, y1: yb, x2: lx0 + i, y2: yb + 0.9, w: 0.1, color: PALETTE.shadow }); // 下面ジョイスト
        }
        if (hash2(seed + 727, s, wy) < 0.6) {
          const rx = lx0 + 2 + hash2(seed + 728, s, wy) * 12;
          ops.push({
            kind: 'grad', x: rx, y: yb, w: 0.2, h: 2.2, dir: 'v',
            stops: [[0, PALETTE.rust], [1, PALETTE.rust0]], alpha: 0.4,
          }); // 錆筋(エッジから下へ)
        }
        // ガセット: セグメント端の外側が壁(当該行と直下がSOLID)なら三角ブレースを壁へ噛ませる
        for (const [ex, dir] of [[x0 - 1, 1], [x0 + 16, -1]] as const) {
          if (t(ex, wy) !== TILE.SOLID || t(ex, wy + 1) !== TILE.SOLID) continue;
          // 三角が占める3列の2タイル下が塞がっていたら描かない(下の歩行面の上端リムを覆わない)
          let clear = true;
          for (let i = 0; i < 3 && clear; i++) clear = t(ex + dir * (1 + i), wy + 2) !== TILE.SOLID;
          if (!clear) continue;
          const gx = ex - bx + (dir === 1 ? 1 : 0);
          const tri = [gx, yb, gx + dir * 3, yb, gx, yb + 2];
          ops.push({ kind: 'poly', pts: tri, w: 0, color: PALETTE.rib, fill: true });
          ops.push({ kind: 'poly', pts: [...tri, gx, yb], w: 0.07, color: PALETTE.ribLight });
          ops.push({ kind: 'dot', x: gx + dir * 0.8, y: yb + 0.4, r: 0.06, color: PALETTE.bolt });
          ops.push({ kind: 'dot', x: gx + dir * 1.8, y: yb + 0.3, r: 0.06, color: PALETTE.bolt });
        }
      }
      // 手すり(55%・非衝突の見た目のみ): 支柱+上桟+中桟。上面空気は床判定で保証済み
      if (hash2(seed + 729, s, wy) < 0.55) {
        for (let i = 0; i < 16; i += 2) {
          ops.push({ kind: 'line', x1: lx0 + i + 0.5, y1: ly, x2: lx0 + i + 0.5, y2: ly - 0.9, w: 0.07, color: PALETTE.railPost });
        }
        ops.push({ kind: 'line', x1: lx0, y1: ly - 0.9, x2: lx0 + 16, y2: ly - 0.9, w: 0.09, color: PALETTE.railTop });
        ops.push({ kind: 'line', x1: lx0, y1: ly - 0.45, x2: lx0 + 16, y2: ly - 0.45, w: 0.06, color: PALETTE.railMid });
      }
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

  // ── 天井: 8タイルセグメント。全タイルが「下面が空気のSOLID」ならケーブル/トレイ ──
  // 天井装飾は下へ最大3.6タイル伸びる(トレイ ty+0.28=ly+3.48、カテナリー sag最大 ly+2.6)。
  // 天井行が上のチャンクにあっても下のチャンクのピクセルに描かれるため、ly=-4 から走査する
  // (歩廊装飾の境界切断と同型の対策)。バッファ読みは最悪 wy+3 → ローカル 67 で MARGIN=17 内。
  const cs0 = Math.floor((bx - 16) / 8);
  const cs1 = Math.floor((bx + CHUNK_SIZE) / 8);
  for (let ly = -4; ly <= CHUNK_SIZE; ly++) {
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
      } else if (r < 0.56) {
        // ケーブルトレイ(吊り金具2本+トレイ+内部ケーブル線)。
        // 吊り下げ先2.2タイルまで空気が続く場合のみ(狭い通路には出さない)
        let clear = true;
        for (let i = 0; i < 8 && clear; i++) {
          clear = t(x0 + i, wy + 2) !== TILE.SOLID && t(x0 + i, wy + 3) !== TILE.SOLID;
        }
        if (clear) {
          const ty = ly + 1 + 2.2;
          ops.push({ kind: 'line', x1: lx0 + 1, y1: ly + 1, x2: lx0 + 1, y2: ty, w: 0.07, color: PALETTE.hanger });
          ops.push({ kind: 'line', x1: lx0 + 7, y1: ly + 1, x2: lx0 + 7, y2: ty, w: 0.07, color: PALETTE.hanger });
          ops.push({ kind: 'rect', x: lx0, y: ty, w: 8, h: 0.4, color: PALETTE.tray });
          ops.push({ kind: 'line', x1: lx0, y1: ty, x2: lx0 + 8, y2: ty, w: 0.05, color: PALETTE.trayEdge });
          ops.push({ kind: 'line', x1: lx0 + 0.2, y1: ty + 0.28, x2: lx0 + 7.8, y2: ty + 0.28, w: 0.05, color: PALETTE.trayCable });
        }
      } else if (r < 0.68) {
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

  // ── 大径配管: 縦8タイルすべて「SOLIDで空気側に露出」の壁面に、少し離して円筒管を立てる ──
  // モックの「大径配管(円筒グラデ+クランプ+ハンガー)」。管は空気側(非衝突・見た目のみ)。
  // 境界整合: 管は縦8タイル・8整列(y0=s*8)なので水平チャンク境界(64=8の倍数)を横切らない。
  // 横方向は lx=-1..CHUNK_SIZE を走査し、垂直境界の両側チャンクが同一の wx を評価して一致する
  // (管の描画は最大 lx±1.75 だが焼き込みクリップで整合)。t 読みは wx±1 → ローカル [-2,65] でバッファ内。
  const ps0 = Math.floor((by - 16) / 8);
  const ps1 = Math.floor((by + CHUNK_SIZE) / 8);
  for (let lx = -1; lx <= CHUNK_SIZE; lx++) {
    const wx = bx + lx;
    for (let s = ps0; s <= ps1; s++) {
      const y0 = s * 8;
      for (const dir of [-1, 1] as const) {
        let ok = true;
        for (let i = 0; i < 8 && ok; i++) {
          ok = t(wx, y0 + i) === TILE.SOLID && t(wx + dir, y0 + i) === TILE.AIR;
        }
        if (!ok || hash2(seed + 730, wx, s * 2 + (dir < 0 ? 0 : 1)) > 0.16) continue;
        const ly0 = y0 - by;
        const px0 = dir === -1 ? lx - 0.75 : lx + 1.2; // 壁面から0.2離す
        ops.push({
          kind: 'grad', x: px0, y: ly0, w: 0.55, h: 8, dir: 'h',
          stops: [[0, PALETTE.pipeHi], [0.35, PALETTE.pipeMid], [1, PALETTE.pipeLo]],
        });
        // バンドクランプ(リング)
        for (const cy2 of [ly0 + 1.5, ly0 + 4.5, ly0 + 7]) {
          ops.push({ kind: 'line', x1: px0, y1: cy2, x2: px0 + 0.55, y2: cy2, w: 0.12, color: PALETTE.clamp });
        }
        // サポートハンガー(壁面→管)
        const wallX = dir === -1 ? lx : lx + 1;
        for (const hy of [ly0 + 2.5, ly0 + 6]) {
          ops.push({
            kind: 'line', x1: wallX, y1: hy,
            x2: dir === -1 ? px0 + 0.55 : px0, y2: hy, w: 0.08, color: PALETTE.hanger,
          });
        }
      }
    }
  }

  // ── 凹ベイ: 8x7 の世界座標整列ブロックが周囲1タイル込みで完全SOLIDなら、
  // 後退した暗い区画を彫る(内側上端の落ち影+上縁の受け光+損傷+錆筋)。
  // モックの「凹ベイ+抜け区画+露出鉄筋+錆の筋」に対応する。
  // 注意: y0 は7整列のため走査端(bt0)のベイがバッファ下端外(y0-1 < by-17)を読むことが
  // あるが、t() のAIRフォールバックで ok=false となりスキップされる。そのベイの描画範囲は
  // このチャンクのピクセルに重ならないため無害で、隣接チャンクが完全に計算する
  // (segmentOps冒頭コメントの方針どおり)。
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

/**
 * 焼き込みで描く装飾(非surface)のチャンク単位メモ。decorateChunk は元地形だけを見る純関数で
 * 破壊の影響を受けないため、ボーリング後の再焼き込みで同じ計算をやり直さずに済む。
 */
export class DecorCache {
  private ops = new Map<string, DecorOp[]>();

  constructor(private seed: number) {}

  /** pristine は decorateChunk と同じ(省略時は tileAt で引き直す) */
  get(cx: number, cy: number, pristine?: () => Uint8Array): DecorOp[] {
    const key = `${cx},${cy}`;
    let ops = this.ops.get(key);
    if (!ops) {
      ops = decorateChunk(this.seed, cx, cy, pristine?.()).filter((op) => !op.surface);
      this.ops.set(key, ops);
    }
    return ops;
  }

  /** チャンクの装飾が計算済みか */
  has(cx: number, cy: number): boolean {
    return this.ops.has(`${cx},${cy}`);
  }

  /** ChunkBaker.evictFarFrom と同じ規則で破棄する */
  evictFarFrom(cx: number, cy: number, radius: number): void {
    for (const key of this.ops.keys()) {
      const [kx, ky] = key.split(',').map(Number);
      if (Math.max(Math.abs(kx - cx), Math.abs(ky - cy)) > radius) this.ops.delete(key);
    }
  }
}
