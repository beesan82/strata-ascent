import { biomeCellAt, biomeIdForCell, type BiomeId } from '../world/biomeCells';
import { terrainProfileFor } from '../world/biomeTerrain';
import {
  ANTECHAMBER_DEPTH, ANTECHAMBER_FADE, ANTECHAMBER_HALF_WIDTH, interfaceBottom, interfaceTop, nearestPassage,
} from '../world/interface';
import {
  GRAND_VISTA_REACH, GRAND_VISTA_ROWS, grandLampAt, grandShaftsNear, grandShaftTileAt,
  type GrandShaft,
} from '../world/grandShaft';
import { hash2 } from '../world/noise';
import { nearestRestPoint, REST_HEIGHT, restPointBand } from '../world/restpoint';
import { stratumIndexAt } from '../world/strata';
import { CHUNK_SIZE, TILE, isSolid } from '../world/tiles';
import { findSpawn, tileAt } from '../world/worldgen';
import { VISUAL_BIOME } from './biome';
import { GRAND_REST_COLOR, GRAND_SHAFT_COLORS, grandLampColor, grandWallTint } from './grandShaftColors';
import { STEEL, mixHex } from './steel';

/**
 * 前室の先行表示(ゾーン化 段階 3、設計 §3-2)。(wx, wy) が前室の帯(その層の板の直下
 * ANTECHAMBER_DEPTH 行 + 底の床の行、孔の周り ANTECHAMBER_HALF_WIDTH + FADE)の中にあれば、
 * 板の向こう(上の層 = 上昇の旅の「次の地区」)の地区 ID を返す。前室でない、
 * または上下で地区が同じなら null。
 */
/**
 * 地区固有の小物・装飾の署名色(ゾーン化 段階 3)。地区の accent を鋼に混ぜ、
 * 既存のパレット色とは重ならない色で「その地区の物」と分かるようにする。
 */
export const DISTRICT_DECOR_COLORS = {
  /** 居住区画: 残光の窓灯 */
  habitationWindow: mixHex('#caa64a', VISUAL_BIOME.habitation.accent, 0.25),
  /** 廃棄沈殿層: 錆色の残骸 */
  disposalDebris: mixHex(STEEL.base, VISUAL_BIOME.disposal.accent, 0.35),
  /** 大空洞水域: 結露の滴 */
  waterCondensation: mixHex('#9fc4e8', STEEL.post, 0.45),
  /** 精錬区: 煤 */
  foundrySoot: '#17100c',
  /** 精錬区: 燃え残りの火種 */
  foundryEmber: mixHex('#d06a3c', STEEL.black, 0.25),
  /** 生体異物区: 根状構造 */
  biomechRoot: mixHex(VISUAL_BIOME.biomech.accent, STEEL.shadow, 0.35),
} as const;

export function antechamberNextBiome(seed: number, wx: number, wy: number): BiomeId | null {
  const cell = biomeCellAt(seed, wy);
  const dy = wy - interfaceBottom(seed, cell);
  if (dy < 0 || dy > ANTECHAMBER_DEPTH) return null;
  if (Math.abs(wx - nearestPassage(seed, cell, wx).x) > ANTECHAMBER_HALF_WIDTH + ANTECHAMBER_FADE) return null;
  const next = biomeIdForCell(seed, cell - 1);
  return next === biomeIdForCell(seed, cell) ? null : next;
}

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

/**
 * 装飾命令が描きうる範囲(チャンクローカルのタイル単位)。保守的に広めに取る:
 * 線は太さ(最小 minPx)の半分に加えて角の尖り(miter上限10≒太さ×5)まで、塗りはAAの1px分を足す。
 * 部分焼き込みで、描き直す範囲に掛からない命令を省くために使う。
 */
export function decorOpBounds(op: DecorOp, minPx: number): { x0: number; y0: number; x1: number; y1: number } {
  const aa = minPx;
  const strokePad = (w: number) => Math.max(w, minPx) * 5 + aa;
  switch (op.kind) {
    case 'line': {
      const p = strokePad(op.w);
      return { x0: Math.min(op.x1, op.x2) - p, y0: Math.min(op.y1, op.y2) - p, x1: Math.max(op.x1, op.x2) + p, y1: Math.max(op.y1, op.y2) + p };
    }
    case 'dot': {
      const r = Math.max(op.r, minPx) + aa;
      return { x0: op.x - r, y0: op.y - r, x1: op.x + r, y1: op.y + r };
    }
    case 'poly': {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < op.pts.length; i += 2) {
        x0 = Math.min(x0, op.pts[i]); x1 = Math.max(x1, op.pts[i]);
        y0 = Math.min(y0, op.pts[i + 1]); y1 = Math.max(y1, op.pts[i + 1]);
      }
      const p = op.fill ? aa : strokePad(op.w);
      return { x0: x0 - p, y0: y0 - p, x1: x1 + p, y1: y1 + p };
    }
    case 'hatch':
    case 'rect':
    case 'grad':
      return {
        x0: Math.min(op.x, op.x + op.w) - aa, y0: Math.min(op.y, op.y + op.h) - aa,
        x1: Math.max(op.x, op.x + op.w) + aa, y1: Math.max(op.y, op.y + op.h) + aa,
      };
  }
}

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

/**
 * 歩く景色(2.17 後半、設計 2026-11-11-walked-scenery)の色。すべて鋼ランプ STEEL の隣り合う 2 色の混合で、
 * 暖色は PALETTE.rust だけを使う。既存の PALETTE / STEEL / 地区色とは重ならない値にして、
 * 既存テストの「色で装飾を見分ける」検査(配管・トレイ・ストリンガー等)に紛れ込まないようにする。
 */
export const SCENERY_COLORS = {
  /** 機械の残骸の胴(塗り) */
  wreck: mixHex(STEEL.base, STEEL.stringer, 0.5),
  /** 機械の残骸の頭部(塗り) */
  wreckHead: mixHex(STEEL.base, STEEL.grate, 0.3),
  /** 残滓の輪郭の受け光 */
  edge: mixHex(STEEL.bayEdge, STEEL.post, 0.5),
  /** 残滓の継ぎ目・消えた眼 */
  dark: mixHex(STEEL.far, STEEL.shadow, 0.5),
  /** 残骸の手足 */
  limb: mixHex(STEEL.rib, STEEL.hanger, 0.4),
  /** 積まれた板・塊 */
  slab: mixHex(STEEL.grate, STEEL.rib, 0.5),
  slabEdge: mixHex(STEEL.trayEdge, STEEL.bayEdge, 0.5),
  /** 倒れた梁 */
  beam: mixHex(STEEL.rib, STEEL.hanger, 0.25),
  /** 破片の野原 */
  shard: mixHex(STEEL.stringer, STEEL.grate, 0.5),
  /** 頭上の桁渡り: ウェブ・フランジ・受け光 */
  girderWeb: mixHex(STEEL.shadow, STEEL.base, 0.5),
  girderFlange: mixHex(STEEL.rib, STEEL.trayEdge, 0.5),
  girderLit: mixHex(STEEL.flange, STEEL.railTop, 0.5),
  /** 深い壁ベイの奥 */
  bayDeep: mixHex(STEEL.black, STEEL.far, 0.6),
  /** ベイの中の残滓のシルエット */
  baySilhouette: mixHex(STEEL.shadow, STEEL.stringer, 0.5),
  /** ベイの中・桁の下の配管束 */
  bayPipe: mixHex(STEEL.stringer, STEEL.rib, 0.5),
  bayPipeLit: mixHex(STEEL.hanger, STEEL.trayEdge, 0.5),
  /** 巨大壁面のステンシル(薄く、rect の alpha で載せる) */
  stencil: mixHex(STEEL.bayEdge, STEEL.railTop, 0.3),
} as const;

/**
 * 歩く景色の地区バイアス(設計 C)。terrainProfileFor と同じ流儀の表。濃さ(密度倍率)と
 * 種類の重みだけを変え、判定はすべてセグメント・ブロックの世界座標で引くのでチャンク境界で破綻しない。
 */
export interface SceneryProfile {
  /** 床の残滓の密度倍率 */
  remnant: number;
  /** 残滓の種類の重み: 機械の残骸・積まれた板・倒れた梁・破片の野原 */
  wreck: number;
  slabs: number;
  beam: number;
  field: number;
  /** 頭上の桁渡りの密度倍率 */
  girder: number;
  /** 深い壁ベイの中身(残滓・配管束)の密度倍率 */
  bayFill: number;
  /** 配管束の割合(0..1)。ベイの中身が配管束になる確率・桁の下に配管束が添う確率の元 */
  pipes: number;
  /** 巨大壁面のステンシルの密度倍率 */
  stencil: number;
  /** 錆の濃さ(残滓・桁の錆筋の確率倍率) */
  rust: number;
}

export const SCENERY_PROFILE: Record<BiomeId, SceneryProfile> = {
  // 寒鋼基層: 均一で寒い(全体に薄め)
  coldSteel: { remnant: 0.6, wreck: 1, slabs: 1, beam: 1, field: 1, girder: 0.6, bayFill: 0.5, pipes: 0.3, stencil: 0.6, rust: 0.5 },
  // 居住区画: 残滓(機械の残骸・運びかけの板)とステンシルが濃い
  habitation: { remnant: 1.6, wreck: 2, slabs: 1.5, beam: 0.6, field: 0.6, girder: 0.7, bayFill: 1.3, pipes: 0.25, stencil: 2.2, rust: 0.8 },
  // 廃棄沈殿層: 破片の野原と倒れた梁
  disposal: { remnant: 1.5, wreck: 0.7, slabs: 0.6, beam: 2.2, field: 2.6, girder: 0.6, bayFill: 0.8, pipes: 0.2, stencil: 0.5, rust: 1.3 },
  // 大空洞水域: ベイと桁で「空間の巨大さ」寄り。足元の残滓は薄い
  waterVoid: { remnant: 0.6, wreck: 1, slabs: 0.8, beam: 0.6, field: 0.6, girder: 1.6, bayFill: 1.8, pipes: 0.4, stencil: 0.8, rust: 0.9 },
  // 電力区: 桁渡りと太い配管束
  power: { remnant: 0.8, wreck: 1, slabs: 0.8, beam: 1, field: 0.6, girder: 1.9, bayFill: 1.1, pipes: 0.85, stencil: 1.0, rust: 0.6 },
  // 精錬区: 錆とスラブの山
  foundry: { remnant: 1.2, wreck: 0.8, slabs: 2.6, beam: 0.8, field: 0.8, girder: 1.0, bayFill: 0.8, pipes: 0.35, stencil: 0.7, rust: 2.0 },
  // 生体異物区: 既存の根に機械の残骸を混ぜる(残骸には根が絡む)
  biomech: { remnant: 1.0, wreck: 1.8, slabs: 0.6, beam: 0.8, field: 1.0, girder: 0.8, bayFill: 0.8, pipes: 0.3, stencil: 0.4, rust: 0.8 },
};

export function sceneryProfileFor(id: BiomeId): SceneryProfile {
  return SCENERY_PROFILE[id] ?? SCENERY_PROFILE.coldSteel;
}

/** 床の 16 タイルセグメントに残滓が出る基礎確率(地区の remnant を掛ける)。見つけると印象に残る程度に低く */
export const REMNANT_RATE = 0.12;
/**
 * 壁と床の角(出入口のない壁の脇に BEAM_RUN 列の床)に倒れた梁が出る基礎確率(地区の remnant × beam を掛け、
 * BEAM_MAX で頭打ち)。角はセグメントより少ないので残滓より高めに取る
 */
export const BEAM_RATE = 0.25;
const BEAM_MAX = 0.6;
/** 倒れた梁が要る、壁の隣から続く床の列数(梁の先 4.9 と折れた端の欠片 5.75 + 余白) */
const BEAM_RUN = 8;
/** 天井の 16 タイルセグメントに桁渡りが出る基礎確率(地区の girder を掛ける) */
export const GIRDER_RATE = 0.18;
/** 損傷のない凹ベイに中身が入る基礎確率(地区の bayFill を掛ける) */
export const BAY_FILL_RATE = 0.35;
/** ベイにならなかった閉じた壁ブロックにステンシルが出る基礎確率(地区の stencil を掛ける) */
export const STENCIL_RATE = 0.08;
/** 桁渡りの下に続いていなければならない空気の行数(桁の下端から床の上の頭まで 2 タイル以上空く) */
export const GIRDER_CLEARANCE = 6;
/** 残滓の足元の列で、床の上に空気が続いていなければならない行数(梯子・出入口・壁際を避ける) */
export const REMNANT_CLEAR_ROWS = 4;
/** 残滓が床から上へ伸びる最大の高さ(タイル)。下のチャンクの床から上のチャンクへはみ出す分を走査する */
const REMNANT_REACH = 4;
/** 休憩点の箱(天井〜床)からこの距離(チェビシェフ、タイル)以内には景色を置かない */
export const SCENERY_REST_GUARD = 8;
/** 開始地点の足元からこの距離(チェビシェフ、タイル)以内には景色を置かない */
export const SCENERY_SPAWN_GUARD = 12;

const spawnMemo = new Map<number, { x: number; y: number }>();
/** 開始地点の足元の床(列, 床の行)。findSpawn は tileAt を走査するのでシードごとに 1 回だけ引く */
function spawnFloorOf(seed: number): { x: number; y: number } {
  let s = spawnMemo.get(seed);
  if (!s) {
    const p = findSpawn(seed);
    s = { x: Math.floor(p.x), y: Math.round(p.y + 1.9) };
    spawnMemo.set(seed, s);
  }
  return s;
}

/**
 * 世界座標の矩形 [x0,x1]×[y0,y1](タイル)が、休憩点・開始地点の保護範囲に掛かるか(純粋関数)。
 * 実行時の保護(main.ts の休憩点 r=20・開始地点 r=10)より少し広く取り、灯や荷袋の読みを邪魔しない。
 * 開始地点は findSpawn(seed) の位置で、?x=&y= の上書きは見ない(装飾はシードだけの関数)。
 */
export function sceneryGuarded(seed: number, x0: number, x1: number, y0: number, y1: number): boolean {
  const sp = spawnFloorOf(seed);
  const sdx = Math.max(0, x0 - sp.x, sp.x - x1);
  const sdy = Math.max(0, y0 - sp.y, sp.y - y1);
  if (Math.max(sdx, sdy) <= SCENERY_SPAWN_GUARD) return true;
  const c0 = biomeCellAt(seed, y0);
  const c1 = biomeCellAt(seed, y1);
  for (let cell = c0; cell <= c1; cell++) {
    const band = restPointBand(seed, cell);
    if (y1 < band.y0 - SCENERY_REST_GUARD || y0 > band.y1 + SCENERY_REST_GUARD) continue;
    const rp = nearestRestPoint(seed, (x0 + x1) / 2, Math.min(Math.max(band.y0, y0), band.y1));
    const dx = Math.max(0, rp.left - x1, x0 - rp.right);
    const dy = Math.max(0, rp.floorY - REST_HEIGHT - 1 - y1, y0 - rp.floorY);
    if (Math.max(dx, dy) <= SCENERY_REST_GUARD) return true;
  }
  return false;
}

/** 重み付きの選択。r は [0,1)。重みがすべて 0 なら -1 */
function pickWeighted(r: number, weights: readonly number[]): number {
  let sum = 0;
  for (const w of weights) sum += w;
  if (sum <= 0) return -1;
  let acc = 0;
  let last = -1;
  for (let i = 0; i < weights.length; i++) {
    if (weights[i] <= 0) continue;
    last = i;
    acc += weights[i] / sum;
    if (r < acc) return i;
  }
  return last;
}

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
  const solid = (lx: number, ly: number) => isSolid(t(lx, ly));

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
  const tw = (wx: number, wy: number) => t(wx - bx, wy - by);
  segmentOps(ops, seed, bx, by, tw);
  // 歩く景色(2.17 後半): 床の残滓と頭上の桁渡り。既存装飾の上に重ねる
  sceneryOps(ops, seed, bx, by, tw);
  // 大昇降機(設計 2026-11-12-mega-structures): 支柱・ケーブル・灯の列と地区の壁の帯。描画パスは足さない
  grandShaftOps(ops, seed, bx, by);
  return ops;
}

/** 大昇降機の背面の筋交いの間隔(行) */
export const GRAND_BRACE_EVERY = 6;
/** 壁の質感のブロックの高さ(行)。地区バイアス(SCENERY_PROFILE)の錆・ステンシル・配管をこの単位で引く */
const GRAND_WALL_BLOCK = 4;
/** 壁の質感の基礎確率(地区の rust / stencil / pipes を掛ける) */
const GRAND_RUST_RATE = 0.3;
const GRAND_STENCIL_RATE = 0.12;
const GRAND_PIPE_RATE = 0.6;

/**
 * 大昇降機の焼き込み装飾(設計 2026-11-12-mega-structures「乗っている間の景色」)。純粋関数。
 * - 案内レール 2 本・釣り合いのケーブル 2 本は内側を縦に通し、背面の筋交いは GRAND_BRACE_EVERY 行ごと。
 *   乗っている間はこれと灯の列が流れ続ける。
 * - 灯は GRAND_LAMP_EVERY 行ごとに両側の壁の内側の面(grandLampAt)。色は行の地区(grandLampColor)。
 * - 壁の内側の面に地区の色の帯(grandWallTint)を引き、壁の 4 行ブロックごとに地区バイアスの表
 *   (sceneryProfileFor の rust / stencil / pipes)で錆筋・ステンシル・配管を引く。板の上面で地区が切り替わる。
 * - 眺望区間は手すりと庇の縁、停止階は乗り場の縁の注意帯、休憩所のある途中駅は暖色の灯 3 つ。
 * 判定はすべてシャフトの幾何と世界座標の行で決め、チャンクの範囲 [by−2, by+66) に掛かる分だけ出すので
 * チャンク境界で食い違わない(はみ出しは焼き込みでクリップされる)。
 */
export function grandShaftOps(ops: DecorOp[], seed: number, bx: number, by: number): void {
  const half = CHUNK_SIZE / 2;
  for (const s of grandShaftsNear(seed, bx + half, by + half, half + 2, half + 2)) grandOpsFor(ops, seed, s, bx, by);
}

function grandOpsFor(ops: DecorOp[], seed: number, s: GrandShaft, bx: number, by: number): void {
  const W = s.width;
  const wallL = s.x0 - 1;
  const wallR = s.x0 + W;
  const ry0 = Math.max(s.yTop - 3, by - 2);
  const ry1 = Math.min(s.yBottom, by + CHUNK_SIZE + 2);
  if (ry0 >= ry1) return;
  const X = (wx: number) => wx - bx;
  const Y = (wy: number) => wy - by;
  // 地区の区間(板の上面で切り替わる)ごとに: 案内レール・ケーブル・壁の内側の帯
  for (let c = biomeCellAt(seed, ry0); ; c++) {
    const y0 = Math.max(ry0, interfaceTop(seed, c));
    const y1 = Math.min(ry1, interfaceTop(seed, c + 1));
    if (y0 >= ry1) break;
    if (y0 >= y1) continue;
    const biome = biomeIdForCell(seed, c);
    for (const rx of [s.x0 + 0.55, s.x0 + W - 0.85]) {
      ops.push({ kind: 'rect', x: X(rx), y: Y(y0), w: 0.3, h: y1 - y0, color: GRAND_SHAFT_COLORS.rail });
      ops.push({ kind: 'line', x1: X(rx + 0.3), y1: Y(y0), x2: X(rx + 0.3), y2: Y(y1), w: 0.05, color: GRAND_SHAFT_COLORS.railLit });
    }
    for (const cx of [s.x0 + 1.6, s.x0 + W - 1.6]) {
      ops.push({ kind: 'line', x1: X(cx), y1: Y(y0), x2: X(cx), y2: Y(y1), w: 0.05, color: GRAND_SHAFT_COLORS.cable });
    }
    // 壁の内側の面の帯: 壁が固体の行の連なりごとに 1 枚(出入口・眺望区間では切れる)
    const tint = grandWallTint(biome);
    for (const [wx, fx] of [[wallL, 0.62], [wallR, 0.08]] as const) {
      let run = -1;
      for (let wy = y0; wy <= y1; wy++) {
        const solidWall = wy < y1 && grandShaftTileAt(seed, s, wx, wy, c) === TILE.SOLID;
        if (solidWall && run < 0) run = wy;
        if (!solidWall && run >= 0) {
          ops.push({ kind: 'rect', x: X(wx + fx), y: Y(run), w: 0.3, h: wy - run, color: tint });
          run = -1;
        }
      }
    }
  }
  // 背面の筋交い(X 字。区間をまたいでも 1 本の線なので、掛かる範囲の位相の行から引く)
  const xl = s.x0 + 0.85;
  const xr = s.x0 + W - 0.85;
  const b0 = s.yTop + Math.max(0, Math.floor((ry0 - GRAND_BRACE_EVERY - s.yTop) / GRAND_BRACE_EVERY)) * GRAND_BRACE_EVERY;
  for (let wy = b0; wy < ry1 && wy + GRAND_BRACE_EVERY <= s.yBottom; wy += GRAND_BRACE_EVERY) {
    if (wy + GRAND_BRACE_EVERY < ry0) continue;
    ops.push({ kind: 'line', x1: X(xl), y1: Y(wy), x2: X(xr), y2: Y(wy + GRAND_BRACE_EVERY), w: 0.06, color: GRAND_SHAFT_COLORS.brace });
    ops.push({ kind: 'line', x1: X(xr), y1: Y(wy), x2: X(xl), y2: Y(wy + GRAND_BRACE_EVERY), w: 0.06, color: GRAND_SHAFT_COLORS.brace });
  }
  // 灯の列(行の地区の色)
  for (let wy = ry0; wy < ry1; wy++) {
    if (!grandLampAt(seed, s, wy)) continue;
    const color = grandLampColor(biomeIdForCell(seed, biomeCellAt(seed, wy)));
    for (const [hx, lx] of [[wallL + 0.7, wallL + 0.95], [wallR, wallR + 0.05]] as const) {
      ops.push({ kind: 'rect', x: X(hx), y: Y(wy + 0.25), w: 0.3, h: 0.5, color: GRAND_SHAFT_COLORS.housing });
      ops.push({ kind: 'rect', x: X(lx - 0.6), y: Y(wy - 0.1), w: 1.2, h: 1.2, color, alpha: 0.22 });
      ops.push({ kind: 'dot', x: X(lx), y: Y(wy + 0.5), r: 0.13, color });
    }
  }
  // 壁の質感(4 行ブロックごと。ブロックは上のチャンクから伸びてくるので 1 ブロックぶん上から見る)
  for (let wy = Math.max(s.yTop - 3, ry0 - GRAND_WALL_BLOCK); wy < ry1; wy++) {
    if (((wy - s.yTop) % GRAND_WALL_BLOCK + GRAND_WALL_BLOCK) % GRAND_WALL_BLOCK !== 0) continue;
    const c = biomeCellAt(seed, wy);
    const prof = sceneryProfileFor(biomeIdForCell(seed, c));
    const block = Math.floor((wy - s.yTop) / GRAND_WALL_BLOCK);
    for (const wx of [wallL, wallR]) {
      if (grandShaftTileAt(seed, s, wx, wy, c) !== TILE.SOLID) continue;
      if (hash2(seed + 9671, wx, block) < GRAND_RUST_RATE * prof.rust) {
        ops.push({ kind: 'line', x1: X(wx + 0.45), y1: Y(wy + 0.2), x2: X(wx + 0.45), y2: Y(wy + 2.6), w: 0.1, color: GRAND_SHAFT_COLORS.rust });
      }
      if (hash2(seed + 9672, wx, block) < GRAND_STENCIL_RATE * prof.stencil) {
        ops.push({ kind: 'rect', x: X(wx + 0.2), y: Y(wy + 0.8), w: 0.6, h: 1.4, color: GRAND_SHAFT_COLORS.stencil, alpha: 0.4 });
      }
      if (hash2(seed + 9673, wx, block) < GRAND_PIPE_RATE * prof.pipes) {
        ops.push({ kind: 'line', x1: X(wx + 0.25), y1: Y(wy), x2: X(wx + 0.25), y2: Y(wy + GRAND_WALL_BLOCK), w: 0.12, color: GRAND_SHAFT_COLORS.pipe });
      }
    }
  }
  // 眺望区間: 張り出しの手すり(床の 1 行上)と庇の縁
  for (const vy of s.vistas) {
    if (vy < ry0 - 1 || vy - GRAND_VISTA_ROWS - 1 > ry1) continue;
    for (const [a, b] of [[wallL - GRAND_VISTA_REACH, wallL], [wallR + 1, wallR + 1 + GRAND_VISTA_REACH]] as const) {
      ops.push({ kind: 'line', x1: X(a), y1: Y(vy - 0.85), x2: X(b), y2: Y(vy - 0.85), w: 0.08, color: GRAND_SHAFT_COLORS.sill });
      for (let px = a + 1; px < b; px += 3) {
        ops.push({ kind: 'line', x1: X(px), y1: Y(vy - 0.85), x2: X(px), y2: Y(vy), w: 0.06, color: GRAND_SHAFT_COLORS.sill });
      }
      ops.push({ kind: 'line', x1: X(a), y1: Y(vy - GRAND_VISTA_ROWS + 0.05), x2: X(b), y2: Y(vy - GRAND_VISTA_ROWS + 0.05), w: 0.1, color: GRAND_SHAFT_COLORS.sill });
    }
  }
  // 停止階: 乗り場の縁の注意帯(壁の出入口の両脇)
  for (const st of s.stops) {
    if (st < ry0 - 1 || st > ry1 + 1) continue;
    ops.push({ kind: 'rect', x: X(wallL - 2), y: Y(st), w: 2, h: 0.12, color: GRAND_SHAFT_COLORS.stationEdge });
    ops.push({ kind: 'rect', x: X(wallR + 1), y: Y(st), w: 2, h: 0.12, color: GRAND_SHAFT_COLORS.stationEdge });
  }
  // 休憩所のある途中駅: 暖色の灯 3 つ(床の 1.4 行上)
  for (const stn of s.stations) {
    if (stn.amenity !== 'rest' || stn.upper < ry0 - 2 || stn.upper > ry1 + 2) continue;
    for (const d of [-1.5, 0, 1.5]) {
      const lx = stn.amenityX + d;
      ops.push({ kind: 'rect', x: X(lx - 0.5), y: Y(stn.upper - 1.9), w: 1, h: 1, color: GRAND_REST_COLOR, alpha: 0.25 });
      ops.push({ kind: 'dot', x: X(lx), y: Y(stn.upper - 1.4), r: 0.14, color: GRAND_REST_COLOR });
    }
  }
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
        ok = t(x0 + i, wy) === TILE.SOLID && !isSolid(t(x0 + i, wy - 1));
      }
      if (!ok) continue;
      const lx0 = x0 - bx;
      // 前室の先行表示(段階 3): 前室の床セグメントでは、次の地区の素材を滲ませる
      const anteNext = antechamberNextBiome(seed, x0 + 8, wy);
      const anteAccent = anteNext ? VISUAL_BIOME[anteNext].accent : null;
      // ── 段階F: 歩廊/床の接合ディテール(モックの片持ち歩廊。既存の這う配管・瓦礫とは独立) ──
      // グレーチングの目(歩ける上面のすぐ下に短い縦目。上端リムはrelief側が引く)
      for (let i = 0; i < 32; i++) {
        const gx = lx0 + i * 0.5 + 0.25;
        ops.push({ kind: 'line', x1: gx, y1: ly + 0.12, x2: gx, y2: ly + 0.42, w: 0.05, color: PALETTE.grateLine });
      }
      // 薄い床(全16タイルの直下が非SOLID)= 歩廊: H鋼+ジョイスト+落ち影+錆筋+ガセット
      let thin = true;
      for (let i = 0; i < 16 && thin; i++) thin = !isSolid(t(x0 + i, wy + 1));
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
          if (!isSolid(t(ex, wy)) || !isSolid(t(ex, wy + 1))) continue;
          // 三角が占める3列の2タイル下が塞がっていたら描かない(下の歩行面の上端リムを覆わない)
          let clear = true;
          for (let i = 0; i < 3 && clear; i++) clear = !isSolid(t(ex + dir * (1 + i), wy + 2));
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
        // 這う配管(太)+ときどき細い並走管、4タイルごとにブラケット。
        // 前室では配管そのものが次の地区の accent に染まる(先行表示)
        const yy = ly - 0.22;
        ops.push({ kind: 'line', x1: lx0, y1: yy, x2: lx0 + 16, y2: yy, w: 0.22, color: anteAccent ? mixHex(PALETTE.pipe, anteAccent, 0.5) : PALETTE.pipe });
        if (r < 0.3) {
          ops.push({ kind: 'line', x1: lx0, y1: yy - 0.32, x2: lx0 + 16, y2: yy - 0.32, w: 0.13, color: anteAccent ? mixHex(PALETTE.pipeThin, anteAccent, 0.4) : PALETTE.pipeThin });
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
      // 前室で配管が無い床には、床の上端に次の地区の細い帯を引く(先行表示)
      if (anteAccent && r >= 0.52) {
        ops.push({ kind: 'line', x1: lx0, y1: ly + 0.12, x2: lx0 + 16, y2: ly + 0.12, w: 0.09, color: mixHex(STEEL.post, anteAccent, 0.55) });
      }
      // 地区固有の小物(段階 3): 床の上の当たり判定なしの装飾。密度は TerrainProfile.decorMul
      const segBiome = biomeIdForCell(seed, biomeCellAt(seed, wy));
      const segMul = terrainProfileFor(segBiome).decorMul;
      if (segBiome === 'disposal' && hash2(seed + 741, s, wy) < 0.3 * segMul) {
        // 錆色の残骸(通常の瓦礫より小さく、地区色に寄る)
        const dx = lx0 + 2 + hash2(seed + 744, s, wy) * 10;
        ops.push({ kind: 'poly', pts: [dx, ly, dx + 0.7, ly - 0.4, dx + 1.6, ly - 0.18, dx + 2.4, ly], w: 0, color: DISTRICT_DECOR_COLORS.disposalDebris, fill: true });
      } else if (segBiome === 'foundry' && hash2(seed + 741, s, wy) < 0.3 * segMul) {
        // 燃え残りの火種
        for (let i = 0; i < 3; i++) {
          ops.push({ kind: 'dot', x: lx0 + 2 + hash2(seed + 745 + i, s, wy) * 12, y: ly - 0.06, r: 0.07, color: DISTRICT_DECOR_COLORS.foundryEmber });
        }
      } else if (segBiome === 'biomech' && hash2(seed + 741, s, wy) < 0.22 * segMul) {
        // 床を這う根状構造
        const rx = lx0 + 2 + hash2(seed + 746, s, wy) * 6;
        ops.push({ kind: 'poly', pts: [rx, ly - 0.02, rx + 2.5, ly - 0.2, rx + 5, ly - 0.04, rx + 7.5, ly - 0.24], w: 0.09, color: DISTRICT_DECOR_COLORS.biomechRoot });
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
        ok = t(x0 + i, wy) === TILE.SOLID && !isSolid(t(x0 + i, wy + 1));
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
          clear = !isSolid(t(x0 + i, wy + 2)) && !isSolid(t(x0 + i, wy + 3));
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
      // 地区固有の小物(段階 3): 天井の下の装飾。密度は TerrainProfile.decorMul
      const segBiomeC = biomeIdForCell(seed, biomeCellAt(seed, wy));
      const segMulC = terrainProfileFor(segBiomeC).decorMul;
      if (segBiomeC === 'power' && hash2(seed + 742, s, wy) < 0.3 * segMulC) {
        // ケーブル束(真っ直ぐな並走線。垂れ下がるカテナリーとは別物として読める)
        ops.push({ kind: 'line', x1: lx0, y1: ly + 1.14, x2: lx0 + 8, y2: ly + 1.14, w: 0.06, color: PALETTE.cable });
        ops.push({ kind: 'line', x1: lx0, y1: ly + 1.3, x2: lx0 + 8, y2: ly + 1.3, w: 0.05, color: PALETTE.pipeThin });
      } else if (segBiomeC === 'foundry' && hash2(seed + 742, s, wy) < 0.35 * segMulC) {
        // 天井から垂れる煤
        const sx = lx0 + 1 + hash2(seed + 747, s, wy) * 5;
        ops.push({ kind: 'grad', x: sx, y: ly + 1, w: 0.5, h: 1.8, dir: 'v', stops: [[0, DISTRICT_DECOR_COLORS.foundrySoot], [1, 'rgba(23,16,12,0)']], alpha: 0.5 });
      } else if (segBiomeC === 'waterVoid' && hash2(seed + 742, s, wy) < 0.5 * segMulC) {
        // 結露の滴
        for (let i = 0; i < 3; i++) {
          ops.push({ kind: 'dot', x: lx0 + 1 + hash2(seed + 748 + i, s, wy) * 6, y: ly + 1.12, r: 0.06, color: DISTRICT_DECOR_COLORS.waterCondensation });
        }
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
          ok = t(wx, y0 + i) === TILE.SOLID && !isSolid(t(wx + dir, y0 + i));
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
        // 前室の先行表示(段階 3): 前室の壁面には次の地区の accent のリベットを打つ
        const anteNextW = antechamberNextBiome(seed, wx, y0 + 2);
        if (anteNextW && hash2(seed + 732, wx, s * 2 + (dir < 0 ? 0 : 1)) < 0.55) {
          const dotColor = mixHex(PALETTE.rivet, VISUAL_BIOME[anteNextW].accent, 0.6);
          ops.push({ kind: 'dot', x: face, y: ly0 + 1.2, r: 0.09, color: dotColor });
          ops.push({ kind: 'dot', x: face, y: ly0 + 2.8, r: 0.09, color: dotColor });
        }
        // 地区固有の小物(段階 3): 壁面の装飾。密度は TerrainProfile.decorMul
        const segBiomeW = biomeIdForCell(seed, biomeCellAt(seed, y0 + 2));
        const segMulW = terrainProfileFor(segBiomeW).decorMul;
        if (segBiomeW === 'habitation' && hash2(seed + 743, wx, s * 2 + (dir < 0 ? 0 : 1)) < 0.3 * segMulW) {
          // 残光の窓灯(設計 §2.3: 居住区画の灯の密度は decor で表現する)
          ops.push({ kind: 'dot', x: face, y: ly0 + 2, r: 0.12, color: DISTRICT_DECOR_COLORS.habitationWindow });
        } else if (segBiomeW === 'biomech' && hash2(seed + 743, wx, s * 2 + (dir < 0 ? 0 : 1)) < 0.26 * segMulW) {
          // 壁を伝う根状構造
          const out = dir === -1 ? -0.16 : 0.16;
          ops.push({ kind: 'poly', pts: [face, ly0 + 0.2, face + out, ly0 + 1.6, face - out, ly0 + 3.1], w: 0.09, color: DISTRICT_DECOR_COLORS.biomechRoot });
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
      const bay = hash2(seed + 721, sx, sy) <= 0.6; // 全面ベイだと壁が虚ろになるので6割
      // ベイにならないブロックは、まれに巨大壁面のステンシル(歩く景色 B)の候補になる。
      // 地区はブロック中央の行で引く(上下どちらのチャンクから見ても同じ)
      let prof: SceneryProfile | null = null;
      if (!bay) {
        prof = sceneryProfileFor(biomeIdForCell(seed, biomeCellAt(seed, sy * 7 + 3)));
        if (hash2(seed + 771, sx, sy) >= STENCIL_RATE * prof.stencil) continue;
      }
      const x0 = sx * 8;
      const y0 = sy * 7;
      let ok = true;
      for (let iy = -1; iy <= 7 && ok; iy++)
        for (let ix = -1; ix <= 8 && ok; ix++)
          {
            // 内側 8x7 は板(HARD)に被せない。外周 1 タイルの縁だけ固体なら閉じているとみなす
            const ring = ix === -1 || ix === 8 || iy === -1 || iy === 7;
            const tt = t(x0 + ix, y0 + iy);
            ok = ring ? isSolid(tt) : tt === TILE.SOLID;
          }
      if (!ok) continue;
      const lx0 = x0 - bx;
      const ly0 = y0 - by;
      if (!bay) {
        stencilOps(ops, seed, sx, sy, lx0, ly0);
        continue;
      }
      ops.push({ kind: 'rect', x: lx0 + 0.5, y: ly0 + 0.5, w: 7, h: 6, color: PALETTE.bay });
      ops.push({ kind: 'rect', x: lx0 + 0.5, y: ly0 + 0.5, w: 7, h: 0.5, color: STEEL.black, alpha: 0.6 });
      ops.push({ kind: 'line', x1: lx0 + 0.5, y1: ly0 + 0.5, x2: lx0 + 7.5, y2: ly0 + 0.5, w: 0.08, color: PALETTE.bayEdge });
      // 歩く景色 B: ベイを深くする(奥の一段暗い面+左の内壁の陰+底の敷居の受け光)
      ops.push({ kind: 'rect', x: lx0 + 1.2, y: ly0 + 1.0, w: 5.6, h: 5.0, color: SCENERY_COLORS.bayDeep });
      ops.push({ kind: 'rect', x: lx0 + 0.5, y: ly0 + 1.0, w: 0.7, h: 5.5, color: STEEL.black, alpha: 0.35 });
      ops.push({ kind: 'line', x1: lx0 + 0.5, y1: ly0 + 6.45, x2: lx0 + 7.5, y2: ly0 + 6.45, w: 0.07, color: SCENERY_COLORS.bayPipeLit });
      // 損傷: 抜け区画+露出鉄筋(35%)
      if (hash2(seed + 722, sx, sy) < 0.35) {
        const hx = lx0 + 1 + Math.floor(hash2(seed + 723, sx, sy) * 4);
        const hy = ly0 + 3.5;
        ops.push({ kind: 'rect', x: hx, y: hy, w: 2.4, h: 2.4, color: PALETTE.hole });
        for (let i = 0; i < 3; i++) {
          const rx = hx + 0.3 + i * 0.8;
          ops.push({ kind: 'line', x1: rx, y1: hy + 2.4, x2: rx + 0.5, y2: hy + 1.2, w: 0.05, color: PALETTE.rebar });
        }
      } else {
        // 歩く景色 B: 損傷のないベイの奥に、配管の束か小さな残滓のシルエットを入れる(壁の中にも空間と物がある)
        prof ??= sceneryProfileFor(biomeIdForCell(seed, biomeCellAt(seed, sy * 7 + 3)));
        if (hash2(seed + 776, sx, sy) < BAY_FILL_RATE * prof.bayFill) {
          bayFillOps(ops, lx0, ly0, hash2(seed + 777, sx, sy) < prof.pipes, hash2(seed + 778, sx, sy));
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

/** ベイの奥の中身(歩く景色 B)。pipes なら横走りの配管束+落ちる 1 本、でなければ敷居に置かれた板と機械のシルエット */
function bayFillOps(ops: DecorOp[], lx0: number, ly0: number, pipes: boolean, jit: number): void {
  if (pipes) {
    const ys = [2.0, 2.45, 2.9];
    const ws = [0.32, 0.26, 0.22];
    for (let i = 0; i < 3; i++) {
      ops.push({ kind: 'line', x1: lx0 + 1.2, y1: ly0 + ys[i], x2: lx0 + 6.8, y2: ly0 + ys[i], w: ws[i], color: SCENERY_COLORS.bayPipe });
    }
    ops.push({ kind: 'line', x1: lx0 + 1.2, y1: ly0 + 1.86, x2: lx0 + 6.8, y2: ly0 + 1.86, w: 0.05, color: SCENERY_COLORS.bayPipeLit });
    for (const cx of [2.4, 5.6]) {
      ops.push({ kind: 'line', x1: lx0 + cx, y1: ly0 + 1.75, x2: lx0 + cx, y2: ly0 + 3.1, w: 0.1, color: SCENERY_COLORS.bayPipeLit });
    }
    const dx = lx0 + 3.6 + jit * 2;
    ops.push({ kind: 'line', x1: dx, y1: ly0 + 2.9, x2: dx, y2: ly0 + 6.45, w: 0.22, color: SCENERY_COLORS.bayPipe });
    return;
  }
  const f = ly0 + 6.45; // 敷居(ベイの底)
  const ox = jit * 0.6;
  ops.push({ kind: 'rect', x: lx0 + 1.5 + ox, y: f - 0.55, w: 2.2, h: 0.55, color: SCENERY_COLORS.baySilhouette });
  ops.push({ kind: 'rect', x: lx0 + 1.8 + ox, y: f - 1.05, w: 1.6, h: 0.5, color: SCENERY_COLORS.baySilhouette });
  const mx = lx0 + 4.3 + ox;
  const body = [mx, f, mx + 0.2, f - 1.5, mx + 1.1, f - 1.95, mx + 1.9, f - 1.35, mx + 2.0, f];
  ops.push({ kind: 'poly', pts: body, w: 0, color: SCENERY_COLORS.baySilhouette, fill: true });
  ops.push({ kind: 'poly', pts: [mx + 0.2, f - 1.5, mx + 1.1, f - 1.95, mx + 1.9, f - 1.35], w: 0.05, color: SCENERY_COLORS.bayPipeLit });
}

/** 7 セグメントの数字 0〜9(bit0..6 = a,b,c,d,e,f,g) */
const SEVEN_SEG = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f] as const;
const STENCIL_W = 1.7;
const STENCIL_H = 3.2;
const STENCIL_STROKE = 0.42;
const STENCIL_ALPHA = 0.22;

function stencilRect(ops: DecorOp[], x: number, y: number, w: number, h: number): void {
  ops.push({ kind: 'rect', x, y, w, h, color: SCENERY_COLORS.stencil, alpha: STENCIL_ALPHA });
}

/** 数字 1 文字。画の端を詰めて隙間(ステンシルのブリッジ)を残す */
function stencilDigit(ops: DecorOp[], d: number, x: number, y: number): void {
  const W = STENCIL_W, H = STENCIL_H, s = STENCIL_STROKE;
  const hw = W - 2 * s;
  const vh = (H - s) / 2 - s;
  const segs: ReadonlyArray<readonly [number, number, number, number]> = [
    [x + s, y, hw, s], // a
    [x + W - s, y + s, s, vh], // b
    [x + W - s, y + (H + s) / 2, s, vh], // c
    [x + s, y + H - s, hw, s], // d
    [x, y + (H + s) / 2, s, vh], // e
    [x, y + s, s, vh], // f
    [x + s, y + (H - s) / 2, hw, s], // g
  ];
  const m = SEVEN_SEG[d];
  for (let i = 0; i < 7; i++) if (m & (1 << i)) stencilRect(ops, ...segs[i]);
}

/**
 * 巨大壁面のステンシル(歩く景色 B)。閉じた 8x7 の壁ブロックの面に、タイル数個分の薄い区画番号を描く。
 * 数字と単純な記号(横棒・十字・下線)だけ。文字・固有名詞は使わない。
 */
function stencilOps(ops: DecorOp[], seed: number, sx: number, sy: number, lx0: number, ly0: number): void {
  const v = hash2(seed + 772, sx, sy);
  const d1 = Math.floor(hash2(seed + 773, sx, sy) * 10);
  const d2 = Math.floor(hash2(seed + 774, sx, sy) * 10);
  const glyphs: ReadonlyArray<number | 'dash' | 'plus'> = v < 0.5 ? [d1, d2] : v < 0.8 ? [d1, 'dash', d2] : [d1, 'plus'];
  const GAP = 0.5;
  const widthOf = (g: number | 'dash' | 'plus') => (g === 'dash' ? 1.0 : g === 'plus' ? 1.4 : STENCIL_W);
  let total = -GAP;
  for (const g of glyphs) total += widthOf(g) + GAP;
  const y = ly0 + 1.4;
  const s = STENCIL_STROKE;
  let x = lx0 + 4 - total / 2;
  const x0 = x;
  for (const g of glyphs) {
    if (g === 'dash') {
      stencilRect(ops, x, y + (STENCIL_H - s) / 2, 1.0, s);
    } else if (g === 'plus') {
      const vx = x + (1.4 - s) / 2;
      stencilRect(ops, x, y + (STENCIL_H - s) / 2, 1.4, s);
      stencilRect(ops, vx, y + STENCIL_H / 2 - 0.7, s, 0.7 - s / 2);
      stencilRect(ops, vx, y + (STENCIL_H + s) / 2, s, 0.7 - s / 2);
    } else {
      stencilDigit(ops, g, x, y);
    }
    x += widthOf(g) + GAP;
  }
  // 区画の下線(半数)
  if (hash2(seed + 775, sx, sy) < 0.5) stencilRect(ops, x0, y + STENCIL_H + 0.45, total, 0.26);
}

/** 機械の残骸の幅(タイル) */
const WRECK_W = 4.8;

/**
 * 機械の残骸(歩く景色 A)。歩行敵より一回り大きい機械が座り込んだまま止まったシルエット。
 * rx は左端、f は床の上面(床タイルの行)。flip で左右反転。胴の塗りの最下点は必ず f(接地)。
 */
function wreckOps(ops: DecorOp[], rx: number, f: number, flip: boolean, rust: number | null, root: boolean): void {
  const X = (u: number) => (flip ? rx + WRECK_W - u : rx + u);
  const P = (pts: readonly number[]) => pts.map((v, i) => (i % 2 === 0 ? X(v) : f + v));
  const C = SCENERY_COLORS;
  ops.push({ kind: 'poly', pts: P([0.5, 0, 0.8, -1.5, 2.1, -2.1, 3.2, -1.8, 3.6, -0.7, 3.2, 0]), w: 0, color: C.wreck, fill: true });
  ops.push({ kind: 'poly', pts: P([2.3, -1.95, 2.7, -2.65, 3.45, -2.5, 3.3, -1.8]), w: 0, color: C.wreckHead, fill: true });
  ops.push({ kind: 'poly', pts: P([0.8, -1.5, 2.1, -2.1, 3.2, -1.8]), w: 0.07, color: C.edge });
  ops.push({ kind: 'poly', pts: P([2.7, -2.65, 3.45, -2.5]), w: 0.06, color: C.edge });
  ops.push({ kind: 'dot', x: X(3.05), y: f - 2.25, r: 0.09, color: C.dark }); // 消えた眼
  ops.push({ kind: 'line', x1: X(1.7), y1: f - 1.85, x2: X(1.95), y2: f - 0.15, w: 0.06, color: C.dark }); // 胴の継ぎ目
  // 投げ出した脚(膝の継手で折れている)
  ops.push({ kind: 'line', x1: X(3.3), y1: f - 0.9, x2: X(4.2), y2: f - 0.55, w: 0.2, color: C.limb });
  ops.push({ kind: 'line', x1: X(4.2), y1: f - 0.55, x2: X(4.75), y2: f - 0.05, w: 0.18, color: C.limb });
  ops.push({ kind: 'dot', x: X(4.2), y: f - 0.55, r: 0.14, color: C.edge });
  ops.push({ kind: 'line', x1: X(4.2), y1: f - 0.55, x2: X(4.5), y2: f - 0.9, w: 0.07, color: C.edge });
  // 畳んだ脚と垂れた腕
  ops.push({ kind: 'line', x1: X(0.9), y1: f - 0.45, x2: X(0.15), y2: f - 0.12, w: 0.2, color: C.limb });
  ops.push({ kind: 'dot', x: X(0.15), y: f - 0.12, r: 0.12, color: C.edge });
  ops.push({ kind: 'poly', pts: P([1.4, -1.35, 1.0, -0.6, 1.7, -0.08]), w: 0.14, color: C.limb });
  if (rust !== null) {
    const u = 1.6 + rust * 1.2;
    ops.push({
      kind: 'grad', x: flip ? X(u) - 0.22 : X(u), y: f - 1.9, w: 0.22, h: 1.6, dir: 'v',
      stops: [[0, PALETTE.rust], [1, PALETTE.rust0]], alpha: 0.35,
    });
  }
  if (root) {
    ops.push({ kind: 'poly', pts: P([0.2, 0, 1.1, -1.1, 2.3, -1.65, 3.4, -1.05]), w: 0.09, color: DISTRICT_DECOR_COLORS.biomechRoot });
  }
}

/** 積まれた板の山の最大幅(山+脇の塊、揺らぎ込み) */
const SLABS_W = 5.2;

/** 積まれた板・塊(歩く景色 A)。誰かが運んで途中で置いていった山。最下段の板と脇の塊の下端は f(接地) */
function slabOps(ops: DecorOp[], rx: number, f: number, h: (k: number) => number, rust: number | null): void {
  const C = SCENERY_COLORS;
  const baseW = 2.4 + h(2) * 1.2;
  const n = 2 + Math.floor(h(3) * 3);
  const SH = 0.42;
  let top = f;
  for (let k = 0; k < n; k++) {
    const w = baseW - k * 0.4;
    const x = rx + 0.25 + k * 0.18 + (h(4 + k) - 0.5) * 0.3;
    top = f - SH * (k + 1);
    ops.push({ kind: 'rect', x, y: top, w, h: SH, color: C.slab });
    ops.push({ kind: 'line', x1: x, y1: top, x2: x + w, y2: top, w: 0.05, color: C.slabEdge });
    ops.push({ kind: 'line', x1: x + 0.04, y1: top, x2: x + 0.04, y2: top + SH, w: 0.05, color: C.dark });
    if (rust !== null && k === 1) {
      ops.push({
        kind: 'grad', x: x + 0.3 + rust * (w - 0.6), y: top, w: 0.2, h: 0.9, dir: 'v',
        stops: [[0, PALETTE.rust], [1, PALETTE.rust0]], alpha: 0.35,
      });
    }
  }
  // 脇に置かれた塊(下の大きい方は床に接地)
  const bx = rx + baseW + 0.6;
  ops.push({ kind: 'rect', x: bx, y: f - 0.85, w: 0.9, h: 0.85, color: C.slab });
  ops.push({ kind: 'line', x1: bx, y1: f - 0.85, x2: bx + 0.9, y2: f - 0.85, w: 0.05, color: C.slabEdge });
  ops.push({ kind: 'rect', x: bx + 0.12, y: f - 1.35, w: 0.6, h: 0.5, color: C.slab });
  ops.push({ kind: 'line', x1: bx + 0.12, y1: f - 1.35, x2: bx + 0.72, y2: f - 1.35, w: 0.05, color: C.slabEdge });
}

/**
 * 倒れた梁(歩く景色 A)。壁の面 xw から床へ斜めに倒れかかる(dir=+1 は右へ、-1 は左へ倒れる)。
 * 塗りの最初の点は壁の面の上端、最下点は f(接地)。描画のみで、通れる。
 */
function beamOps(ops: DecorOp[], xw: number, f: number, dir: 1 | -1, rust: boolean): void {
  const C = SCENERY_COLORS;
  ops.push({
    kind: 'poly', pts: [xw, f - 3.4, xw + dir * 4.9, f, xw + dir * 4.3, f, xw, f - 2.9], w: 0, color: C.beam, fill: true,
  });
  ops.push({ kind: 'line', x1: xw, y1: f - 3.4, x2: xw + dir * 4.9, y2: f, w: 0.06, color: C.edge }); // 上フランジの受け光
  ops.push({ kind: 'line', x1: xw, y1: f - 3.15, x2: xw + dir * 4.6, y2: f, w: 0.05, color: C.dark }); // ウェブ
  ops.push({ kind: 'dot', x: xw + dir * 0.4, y: f - 3.0, r: 0.06, color: C.edge });
  ops.push({ kind: 'dot', x: xw + dir * 0.75, y: f - 2.75, r: 0.06, color: C.edge });
  // 折れた端の欠片
  ops.push({ kind: 'poly', pts: [xw + dir * 4.9, f, xw + dir * 5.3, f - 0.28, xw + dir * 5.75, f], w: 0, color: C.slab, fill: true });
  if (rust) {
    ops.push({ kind: 'line', x1: xw + dir * 1.29, y1: f - 2.03, x2: xw + dir * 2.58, y2: f - 1.16, w: 0.08, color: PALETTE.rust });
  }
}

/**
 * 破片の野原(歩く景色 A)。既存の瓦礫(点)ではなく、セグメントの足元一帯に低い破片を敷く。
 * 下敷きの低い堆積(塗り、最下点は f)+小片・平たい破片・錆の粒。
 */
function fieldOps(ops: DecorOp[], seed: number, s: number, wy: number, lx0: number, f: number): void {
  const C = SCENERY_COLORS;
  const drift: number[] = [lx0 + 1, f];
  for (let i = 0; i < 8; i++) {
    drift.push(lx0 + 1.6 + i * 1.7, f - 0.1 - hash2(seed + 800, s * 64 + i, wy) * 0.2);
  }
  drift.push(lx0 + 15, f);
  ops.push({ kind: 'poly', pts: drift, w: 0, color: C.shard, fill: true });
  const n = 10 + Math.floor(hash2(seed + 801, s, wy) * 8);
  for (let i = 0; i < n; i++) {
    const x = lx0 + 1 + hash2(seed + 802, s * 64 + i, wy) * 13.2;
    const a = hash2(seed + 803, s * 64 + i, wy);
    const b = hash2(seed + 804, s * 64 + i, wy);
    const kind = hash2(seed + 805, s * 64 + i, wy);
    if (kind < 0.55) {
      ops.push({ kind: 'poly', pts: [x, f, x + 0.25 + a * 0.3, f - 0.2 - b * 0.28, x + 0.6 + a * 0.4, f], w: 0, color: C.shard, fill: true });
    } else if (kind < 0.85) {
      ops.push({ kind: 'line', x1: x, y1: f - 0.06, x2: x + 0.5 + a * 0.7, y2: f - 0.12 - b * 0.15, w: 0.07, color: C.edge });
    } else {
      ops.push({ kind: 'dot', x, y: f - 0.06, r: 0.06, color: PALETTE.rust });
    }
  }
}

/**
 * 頭上の桁渡り(歩く景色 B)。天井の下に吊られた太い H 桁(上フランジの受け光・ウェブ・補剛材・下フランジ)と
 * その落ち影。c は天井の下面(天井行 + 1)。下端は c+1.68(配管束が添えば c+2.33)で、
 * 下に GIRDER_CLEARANCE 行の空気を要求するので、床に立つ頭との間は 2 タイル以上空く。
 */
function girderOps(ops: DecorOp[], lx0: number, c: number, rust: number | null, pipes: boolean): void {
  const C = SCENERY_COLORS;
  for (const hx of [2, 8, 14]) {
    ops.push({ kind: 'line', x1: lx0 + hx, y1: c, x2: lx0 + hx, y2: c + 0.45, w: 0.14, color: C.girderFlange }); // 吊り材
  }
  ops.push({ kind: 'rect', x: lx0, y: c + 0.45, w: 16, h: 0.18, color: C.girderFlange });
  ops.push({ kind: 'rect', x: lx0, y: c + 0.63, w: 16, h: 0.85, color: C.girderWeb });
  ops.push({ kind: 'rect', x: lx0, y: c + 1.48, w: 16, h: 0.2, color: C.girderFlange });
  ops.push({ kind: 'line', x1: lx0, y1: c + 0.45, x2: lx0 + 16, y2: c + 0.45, w: 0.06, color: C.girderLit });
  for (let i = 1; i < 16; i += 2) {
    ops.push({ kind: 'line', x1: lx0 + i, y1: c + 0.63, x2: lx0 + i, y2: c + 1.48, w: 0.12, color: C.girderFlange }); // 補剛材
  }
  for (const ex of [0.1, 15.9]) {
    ops.push({ kind: 'line', x1: lx0 + ex, y1: c + 0.45, x2: lx0 + ex, y2: c + 1.68, w: 0.08, color: C.girderLit }); // 継手板
  }
  ops.push({
    kind: 'grad', x: lx0, y: c + 1.68, w: 16, h: 0.9, dir: 'v',
    stops: [[0, STEEL.black], [1, 'rgba(2,4,8,0)']], alpha: 0.45,
  });
  if (rust !== null) {
    ops.push({
      kind: 'grad', x: lx0 + 1 + rust * 13, y: c + 1.68, w: 0.24, h: 1.2, dir: 'v',
      stops: [[0, PALETTE.rust], [1, PALETTE.rust0]], alpha: 0.35,
    });
  }
  if (pipes) {
    // 桁の下に添う配管束(電力区で濃い)
    for (const px of [4, 12]) {
      ops.push({ kind: 'line', x1: lx0 + px, y1: c + 1.68, x2: lx0 + px, y2: c + 2.3, w: 0.07, color: C.bayPipeLit });
    }
    ops.push({ kind: 'line', x1: lx0, y1: c + 1.95, x2: lx0 + 16, y2: c + 1.95, w: 0.22, color: C.bayPipe });
    ops.push({ kind: 'line', x1: lx0, y1: c + 2.22, x2: lx0 + 16, y2: c + 2.22, w: 0.18, color: C.bayPipe });
    ops.push({ kind: 'line', x1: lx0, y1: c + 1.85, x2: lx0 + 16, y2: c + 1.85, w: 0.05, color: C.bayPipeLit });
  }
}

/**
 * 歩く景色(2.17 後半、設計 2026-11-11-walked-scenery)の床の残滓と頭上の桁渡り。
 * 判定は世界座標整列の 16 タイルセグメントと (s, wy) のハッシュ(倒れた梁だけは壁と床の角の世界座標の
 * ハッシュ)で、地区は行 wy で引く。
 * セグメントは 16 整列なので垂直のチャンク境界(64 整列)をまたがない。水平境界は、残滓が床から上へ
 * 最大 REMNANT_REACH、桁が天井から下へ最大 3.6 伸びる分を両側のチャンクが走査して一致させる。
 * バッファ読みは最悪 床 ly=68 の wy+1 → ローカル 69、天井 ly=64 の wy+6 → 70 で MARGIN=17 内。
 * 横は x0+17(最右のセグメント)がバッファ外になりうるが、そのセグメントはこのチャンクの画素に重ならない。
 */
function sceneryOps(
  ops: DecorOp[],
  seed: number,
  bx: number,
  by: number,
  t: (wx: number, wy: number) => number,
): void {
  // 床の上 REMNANT_CLEAR_ROWS 行が空気(梯子でもない)で、床の直下が梯子でない列か
  const clearAbove = (c0: number, c1: number, wy: number): boolean => {
    for (let x = c0; x <= c1; x++) {
      if (t(x, wy + 1) === TILE.LADDER) return false;
      for (let k = 1; k <= REMNANT_CLEAR_ROWS; k++) if (t(x, wy - k) !== TILE.AIR) return false;
    }
    return true;
  };
  // 床の行から上へ REMNANT_CLEAR_ROWS 行が固体の壁(出入口の穴が無い)か
  const wallAt = (x: number, wy: number): boolean => {
    for (let k = 0; k <= REMNANT_CLEAR_ROWS; k++) if (!isSolid(t(x, wy - k))) return false;
    return true;
  };
  // 床の 16 タイルセグメント s(床の行 wy)の残滓の種類(0 残骸・1 板・2 梁の枠・3 野原)。残滓のセグメントでなければ -1。
  // 種類の重みは当初のまま(セグメントの端の外が壁なら梁の重みを持つ)にして、残骸・板・野原の出方を変えない
  const remnantKind = (s: number, wy: number, prof: SceneryProfile): number => {
    const x0 = s * 16;
    for (let i = 0; i < 16; i++) {
      if (t(x0 + i, wy) !== TILE.SOLID || isSolid(t(x0 + i, wy - 1))) return -1;
    }
    if (hash2(seed + 761, s, wy) >= REMNANT_RATE * prof.remnant) return -1;
    const wallSeg = wallAt(x0 - 1, wy) || wallAt(x0 + 16, wy);
    return pickWeighted(hash2(seed + 762, s, wy), [prof.wreck, prof.slabs, wallSeg ? prof.beam : 0, prof.field]);
  };

  // ── 床の残滓: 16 タイルセグメント(segmentOps の床と同じ判定) ──
  const fs0 = Math.floor((bx - 16) / 16);
  const fs1 = Math.floor((bx + CHUNK_SIZE) / 16);
  for (let ly = 0; ly <= CHUNK_SIZE + REMNANT_REACH; ly++) {
    const wy = by + ly;
    const biome = biomeIdForCell(seed, biomeCellAt(seed, wy));
    const prof = sceneryProfileFor(biome);
    for (let s = fs0; s <= fs1; s++) {
      const kind = remnantKind(s, wy, prof);
      // 梁の枠(kind 2)はここでは描かない。倒れた梁は下の「壁と床の角」の走査で置く
      if (kind < 0 || kind === 2) continue;
      const x0 = s * 16;
      const h = (k: number) => hash2(seed + 780 + k, s, wy);
      const rust = h(9) < Math.min(0.9, 0.35 * prof.rust) ? h(8) : null;
      const lx0 = x0 - bx;
      if (kind === 0 || kind === 1) {
        const W = kind === 0 ? WRECK_W : SLABS_W;
        const fx = x0 + 1.5 + h(0) * (16 - 3 - W);
        const c0 = Math.floor(fx) - 2;
        const c1 = Math.ceil(fx + W) + 1;
        if (!clearAbove(c0, c1, wy) || sceneryGuarded(seed, c0, c1, wy - REMNANT_CLEAR_ROWS, wy)) continue;
        if (kind === 0) wreckOps(ops, fx - bx, ly, h(1) < 0.5, rust, biome === 'biomech');
        else slabOps(ops, fx - bx, ly, h, rust);
      } else if (kind === 3) {
        if (!clearAbove(x0, x0 + 15, wy) || sceneryGuarded(seed, x0, x0 + 15, wy - REMNANT_CLEAR_ROWS, wy)) continue;
        fieldOps(ops, seed, s, wy, lx0, ly);
      }
    }
  }

  // ── 倒れた梁: 壁と床の角ごと(壁の列 wx・床の行 wy・倒れる向き dir)に判定する ──
  // 床セグメントは 16 列すべてが床でなければならないので、壁がセグメントの端(16 整列の列)にちょうど来ることは
  // ほとんど無い。梁はセグメントに縛らず、角の世界座標のハッシュで置く。
  // 壁: 床の行から上へ REMNANT_CLEAR_ROWS 行が SOLID(出入口の穴が無い)。床: 壁の隣から BEAM_RUN 列が
  // 「SOLID の床・上 REMNANT_CLEAR_ROWS 行が空気・直下に梯子なし」。床の残滓のセグメントとは重ねない。
  // 壁の列はローカル [-7, 70]: このチャンクの画素に掛かる梁(壁の面から 5.75 先まで)をすべて含む。
  // 読みは最悪 床の列 ±BEAM_RUN と足元のセグメント(ローカル [-17, 80])・行 wy-4..wy+1 で MARGIN=17 内。
  for (let ly = 0; ly <= CHUNK_SIZE + REMNANT_REACH; ly++) {
    const wy = by + ly;
    let prof: SceneryProfile | null = null;
    for (let wx = bx - 7; wx <= bx + CHUNK_SIZE + 6; wx++) {
      let wall = true;
      for (let k = 0; k <= REMNANT_CLEAR_ROWS && wall; k++) wall = t(wx, wy - k) === TILE.SOLID;
      if (!wall) continue;
      for (const dir of [1, -1] as const) {
        if (t(wx + dir, wy) !== TILE.SOLID || t(wx + dir, wy - 1) !== TILE.AIR) continue;
        const c0 = dir === 1 ? wx + 1 : wx - BEAM_RUN;
        const c1 = dir === 1 ? wx + BEAM_RUN : wx - 1;
        const p = (prof ??= sceneryProfileFor(biomeIdForCell(seed, biomeCellAt(seed, wy))));
        const key = wx * 2 + (dir === 1 ? 1 : 0);
        if (hash2(seed + 795, key, wy) >= Math.min(BEAM_MAX, BEAM_RATE * p.remnant * p.beam)) continue;
        let floor = true;
        for (let x = c0; x <= c1 && floor; x++) floor = t(x, wy) === TILE.SOLID;
        if (!floor || !clearAbove(c0, c1, wy)) continue;
        let claimed = false;
        for (let s = Math.floor(c0 / 16); s <= Math.floor(c1 / 16) && !claimed; s++) {
          const k = remnantKind(s, wy, p);
          claimed = k >= 0 && k !== 2;
        }
        if (claimed || sceneryGuarded(seed, Math.min(wx, c0), Math.max(wx, c1), wy - REMNANT_CLEAR_ROWS, wy)) continue;
        const rust = hash2(seed + 796, key, wy) < Math.min(0.9, 0.35 * p.rust);
        beamOps(ops, (dir === 1 ? wx + 1 : wx) - bx, ly, dir, rust);
      }
    }
  }

  // ── 頭上の桁渡り: 天井の 16 タイルセグメント(下面が空気の SOLID)で、下に GIRDER_CLEARANCE 行の空気 ──
  // 吊りトレイ(segmentOps の 8 タイル天井 r∈[0.44,0.56))のある区間には出さない(吊り金具と桁が交差するため)
  const gs0 = Math.floor((bx - 16) / 16);
  const gs1 = Math.floor((bx + CHUNK_SIZE) / 16);
  for (let ly = -4; ly <= CHUNK_SIZE; ly++) {
    const wy = by + ly;
    for (let s = gs0; s <= gs1; s++) {
      const x0 = s * 16;
      let ok = true;
      for (let i = 0; i < 16 && ok; i++) {
        ok = t(x0 + i, wy) === TILE.SOLID && t(x0 + i, wy + 1) === TILE.AIR;
      }
      if (!ok) continue;
      const prof = sceneryProfileFor(biomeIdForCell(seed, biomeCellAt(seed, wy)));
      if (hash2(seed + 791, s, wy) >= GIRDER_RATE * prof.girder) continue;
      const rA = hash2(seed + 703, 2 * s, wy);
      const rB = hash2(seed + 703, 2 * s + 1, wy);
      if ((rA >= 0.44 && rA < 0.56) || (rB >= 0.44 && rB < 0.56)) continue;
      for (let i = 0; i < 16 && ok; i++) {
        for (let k = 2; k <= GIRDER_CLEARANCE && ok; k++) ok = t(x0 + i, wy + k) === TILE.AIR;
      }
      if (!ok || sceneryGuarded(seed, x0, x0 + 15, wy, wy + GIRDER_CLEARANCE)) continue;
      const rust = hash2(seed + 792, s, wy) < Math.min(0.9, 0.35 * prof.rust) ? hash2(seed + 793, s, wy) : null;
      girderOps(ops, x0 - bx, ly + 1, rust, hash2(seed + 794, s, wy) < prof.pipes * 0.6);
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
