import { TILE, isSolid } from './tiles';
import type { Pillar } from './pillar';

/**
 * 到達可能性の保存の検証(2.21、設計 2026-11-16-strata-2.21-design §A-3 の検証 2)。
 *
 * 窓(柱の外形と乗り場を上下左右に 48 タイル広げた範囲)の中で、「立てるセル」を
 * ノードにした有向グラフを 2 つ作る。セル (x, y) は足の行(体は y と y−1 を占め、
 * 床は y+1)として表す。
 * - 基準(柱なし地形)は実際の移動モデル: 歩行・段差・落下・梯子に加え、ジャンプと
 *   縁つかみ。距離は player.ts の定数(歩行 6、ジャンプ初速 −13、重力 30 →
 *   ジャンプ高さ 約 2.8 タイル、同高の水平 約 5.2 タイル)から導き、保守側に丸める:
 *   同高は水平 5 まで、1 行上は 4 まで、2 行上は 3 まで、3 行上は縁つかみ
 *   (届く先の隣に壁があるときだけ、水平 1 まで)。
 * - 柱あり地形は保守モデル: 横へ 1 列、上りは 1 行まで、下りは制限なし、梯子は同じ。
 *   加えて、基準の辺のうち、両端と通り道が柱で変わったタイルから 3 タイル以上
 *   離れている辺はそのまま使う(地形が変わっていないので同じ動きができる)。
 *
 * 比較は強連結成分(SCC)へ潰してビットセットで引く(全点対 BFS は計算量が持たない)。
 * 設計の「ゾーン境界法」は端点同士の到達だけを見る近似だが、ここでは窓の全域で
 * 端点集合(変わったタイルから 8 以内の立てるセル + 窓の左右端のセル)の到達を
 * そのまま比べる。ゾーン法より強い検査になる。
 *
 * 合格条件は 2 段(実装時の裁定、計画書に記録):
 * - 本ゲート: 実移動モデル同士(基準 vs 柱あり)で、端点セルの組の到達が保存される
 *   (柱に埋まったセルを除く)。窓の左右の横断も端点集合に含めて明示に確かめる。
 * - 柱自身の通行保証: 各穴の左右の乗り場と、穴同士の梯子移動が、保守モデルでも
 *   通ること(穴のセルから BFS で確かめる)。
 * 保守モデルを全域の保存判定に使うと、柱と無関係な既存地形のジャンプ依存の
 * 連絡(この世界の標準的な移動)まで届かないと数えてしまうため(実測で 1 本あたり
 * 数千〜数万組)、保存の判定は実移動モデル同士に一本化し、保守モデルは柱自身の
 * 通行保証にだけ使う。
 */

export type ReachGet = (x: number, y: number) => number;

const JUMP_MAX_DX = [5, 4, 3] as const; // 上る行数 0・1・2 に対する水平の上限

interface Win {
  x0: number;
  y0: number;
  w: number;
  h: number;
  base: Uint8Array;
  fin: Uint8Array;
  baseStand: Uint8Array;
  finStand: Uint8Array;
  /** 変わったタイルからチェビシェフ 2 以内(辺の「そのまま使う」判定用) */
  nearChanged: Uint8Array;
  /** 変わったタイルからチェビシェフ 8 以内(端点セルの判定用) */
  nearChanged8: Uint8Array;
  /** 列ごとの立てるセルの行リスト(落下辺の高速化) */
  baseStandRows: number[][];
  finStandRows: number[][];
  /** セルごとに、その列で真下に最初に現れる固体の行(無ければ h) */
  baseNextSolid: Int32Array;
  finNextSolid: Int32Array;
}

function buildWin(baseGet: ReachGet, finGet: ReachGet, x0: number, x1: number, y0: number, y1: number): Win {
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const base = new Uint8Array(w * h);
  const fin = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      base[y * w + x] = baseGet(x0 + x, y0 + y);
      fin[y * w + x] = finGet(x0 + x, y0 + y);
    }
  }
  const win: Win = {
    x0, y0, w, h, base, fin,
    baseStand: new Uint8Array(w * h), finStand: new Uint8Array(w * h),
    nearChanged: new Uint8Array(w * h), nearChanged8: new Uint8Array(w * h),
    baseStandRows: [], finStandRows: [],
    baseNextSolid: new Int32Array(w * h), finNextSolid: new Int32Array(w * h),
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      win.baseStand[i] = standableArr(win, base, x, y) ? 1 : 0;
      win.finStand[i] = standableArr(win, fin, x, y) ? 1 : 0;
      if (base[i] !== fin[i]) {
        for (let dy = -8; dy <= 8; dy++) {
          for (let dx = -8; dx <= 8; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            win.nearChanged8[ny * w + nx] = 1;
            if (Math.max(Math.abs(dx), Math.abs(dy)) <= 2) win.nearChanged[ny * w + nx] = 1;
          }
        }
      }
    }
  }
  // 落下辺の高速化: 列ごとの立てる行リストと、次の固体の行
  for (const [arr, stand, rowsOut, nextOut] of [
    [base, win.baseStand, win.baseStandRows, win.baseNextSolid],
    [fin, win.finStand, win.finStandRows, win.finNextSolid],
  ] as const) {
    for (let x = 0; x < w; x++) {
      const rows: number[] = [];
      let next = h;
      for (let y = h - 1; y >= 0; y--) {
        nextOut[y * w + x] = next;
        if (isSolid(arr[y * w + x])) next = y;
        if (stand[y * w + x]) rows.push(y);
      }
      rows.reverse();
      rowsOut.push(rows);
    }
  }
  return win;
}

/** 窓の外は空気として読む(窓の縁が開口部になる) */
function at(win: Win, arr: Uint8Array, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= win.w || y >= win.h) return TILE.AIR;
  return arr[y * win.w + x];
}

function standableArr(win: Win, arr: Uint8Array, x: number, y: number): boolean {
  if (isSolid(at(win, arr, x, y)) || isSolid(at(win, arr, x, y - 1))) return false;
  return isSolid(at(win, arr, x, y + 1)) || at(win, arr, x, y) === TILE.LADDER || at(win, arr, x, y + 1) === TILE.LADDER;
}

function ladderNode(win: Win, arr: Uint8Array, x: number, y: number): boolean {
  return at(win, arr, x, y) === TILE.LADDER && !isSolid(at(win, arr, x, y - 1));
}

/** 辺の通り道(両端と、その間の体の掃引範囲)が nearChanged に触れないか */
function edgeCarried(win: Win, x0: number, y0: number, x1: number, y1: number): boolean {
  const xa = Math.min(x0, x1);
  const xb = Math.max(x0, x1);
  const ya = Math.min(y0, y1) - 1;
  const yb = Math.max(y0, y1);
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      if (x < 0 || y < 0 || x >= win.w || y >= win.h) continue;
      if (win.nearChanged[y * win.w + x]) return false;
    }
  }
  return true;
}

type MoveModel = 'base' | 'full' | 'final';

/**
 * (x, y) からの辺を out(窓内インデックス)へ追加する。
 * model: 'base' は基準地形の実移動モデル(ジャンプあり)、'full' は柱あり地形の
 * 実移動モデル、'final' は柱あり地形の保守モデル+そのまま使う辺。
 */
function neighbors(win: Win, model: MoveModel, x: number, y: number, out: number[]): void {
  const arr = model === 'base' ? win.base : win.fin;
  const stand = model === 'base' ? win.baseStand : win.finStand;
  const idx = (nx: number, ny: number): number => ny * win.w + nx;
  const push = (nx: number, ny: number): void => {
    if (nx < 0 || ny < 0 || nx >= win.w || ny >= win.h) return;
    if (stand[idx(nx, ny)] || ladderNode(win, arr, nx, ny)) out.push(idx(nx, ny));
  };
  // 歩行・段差(上下 1)
  for (const dx of [-1, 1]) {
    push(x + dx, y);
    push(x + dx, y - 1);
    push(x + dx, y + 1);
  }
  // 落下(自列と左右の列へ漂いながら)。着地点は列ごとの事前計算から引く
  const standRows = model === 'base' ? win.baseStandRows : win.finStandRows;
  const nextSolid = model === 'base' ? win.baseNextSolid : win.finNextSolid;
  for (const dx of [0, -1, 1]) {
    const c = x + dx;
    if (c < 0 || c >= win.w) continue;
    const limit = nextSolid[y * win.w + c];
    const rows = standRows[c];
    let lo = 0;
    let hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid] <= y) lo = mid + 1;
      else hi = mid;
    }
    for (let ri = lo; ri < rows.length && rows[ri] < limit; ri++) {
      out.push(idx(c, rows[ri]));
    }
  }
  // 梯子: 自列か足元が梯子なら上下と乗り降り
  if (at(win, arr, x, y) === TILE.LADDER || at(win, arr, x, y + 1) === TILE.LADDER || ladderNode(win, arr, x, y)) {
    push(x, y - 1);
    push(x, y + 1);
    for (const dx of [-1, 1]) {
      push(x + dx, y);
      push(x + dx, y - 1);
      push(x + dx, y + 1);
    }
  }
  // 隣の列の梯子へ掴まる
  for (const dx of [-1, 1]) {
    if (ladderNode(win, arr, x + dx, y)) out.push(idx(x + dx, y));
  }
  if (model === 'base' || model === 'full') {
    // ジャンプ: 上る行数ごとに水平の上限が縮む
    for (let dy = 0; dy <= 2; dy++) {
      const maxDx = JUMP_MAX_DX[dy];
      for (let dx = -maxDx; dx <= maxDx; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y - dy;
        if (nx < 0 || ny < 0 || nx >= win.w || ny >= win.h) continue;
        if (stand[idx(nx, ny)]) out.push(idx(nx, ny));
      }
    }
    // 縁つかみ: 3 行上、水平 1 まで、届く先の隣に壁があるときだけ
    for (const dx of [-1, 0, 1]) {
      const nx = x + dx;
      const ny = y - 3;
      if (nx < 0 || ny < 0 || nx >= win.w || ny >= win.h) continue;
      if (!stand[idx(nx, ny)]) continue;
      if (isSolid(at(win, arr, nx + 1, ny)) || isSolid(at(win, arr, nx - 1, ny)) ||
          isSolid(at(win, arr, nx + 1, ny + 1)) || isSolid(at(win, arr, nx - 1, ny + 1))) {
        out.push(idx(nx, ny));
      }
    }
  } else {
    // そのまま使う辺: 基準の辺のうち、通り道が変わったタイルから 3 以上離れているもの
    const baseOut: number[] = [];
    neighbors(win, 'base', x, y, baseOut);
    for (const v of baseOut) {
      const vx = v % win.w;
      const vy = Math.floor(v / win.w);
      if (!win.finStand[v] && !ladderNode(win, win.fin, vx, vy)) continue;
      if (edgeCarried(win, x, y, vx, vy)) out.push(v);
    }
  }
}

interface ModelGraph {
  /** 窓内インデックス → ノード番号(ノードでなければ −1) */
  nodeId: Int32Array;
  /** ノード番号 → 窓内インデックス */
  cells: number[];
  /** ノード番号 → 成分番号 */
  comp: Int32Array;
  compCount: number;
  /** 成分番号 → 到達できる端点集合(端点番号のビットセット) */
  compReach: Uint32Array[];
  words: number;
}

/**
 * モデルのグラフを作り、SCC へ潰して、成分ごとの「到達できる端点集合」を引く。
 * 端点集合 S は呼び出し側が窓内インデックスの配列で渡す(両モデル共通)。
 */
function buildModelGraph(win: Win, model: MoveModel, endpoints: readonly number[], endpointPos: Map<number, number>): ModelGraph {
  const arr = model === 'base' ? win.base : win.fin;
  const stand = model === 'base' ? win.baseStand : win.finStand;
  const total = win.w * win.h;
  const nodeId = new Int32Array(total).fill(-1);
  const cells: number[] = [];
  for (let y = 0; y < win.h; y++) {
    for (let x = 0; x < win.w; x++) {
      const i = y * win.w + x;
      if (stand[i] || ladderNode(win, arr, x, y)) {
        nodeId[i] = cells.length;
        cells.push(i);
      }
    }
  }
  const n = cells.length;
  const adj: number[][] = new Array(n);
  const radj: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    adj[i] = [];
    radj[i] = [];
  }
  const out: number[] = [];
  for (let u = 0; u < n; u++) {
    const cell = cells[u];
    out.length = 0;
    neighbors(win, model, cell % win.w, Math.floor(cell / win.w), out);
    const seen = new Set<number>();
    for (const vc of out) {
      const v = nodeId[vc];
      if (v < 0 || v === u || seen.has(v)) continue;
      seen.add(v);
      adj[u].push(v);
      radj[v].push(u);
    }
  }
  // Kosaraju 1: 終了順
  const visited = new Uint8Array(n);
  const order: number[] = [];
  const stack: [number, number][] = [];
  for (let s = 0; s < n; s++) {
    if (visited[s]) continue;
    visited[s] = 1;
    stack.push([s, 0]);
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const u = top[0];
      if (top[1] < adj[u].length) {
        const v = adj[u][top[1]++];
        if (!visited[v]) {
          visited[v] = 1;
          stack.push([v, 0]);
        }
      } else {
        order.push(u);
        stack.pop();
      }
    }
  }
  // Kosaraju 2: 転置グラフで成分付け
  const comp = new Int32Array(n).fill(-1);
  let compCount = 0;
  const stack2: number[] = [];
  for (let oi = order.length - 1; oi >= 0; oi--) {
    const s = order[oi];
    if (comp[s] >= 0) continue;
    comp[s] = compCount;
    stack2.push(s);
    while (stack2.length > 0) {
      const u = stack2.pop()!;
      for (const v of radj[u]) {
        if (comp[v] < 0) {
          comp[v] = compCount;
          stack2.push(v);
        }
      }
    }
    compCount++;
  }
  // 成分 DAG の到達(端点ビットセット)。後継を先に処理するため逆トポロジカル順に回す
  const words = Math.max(1, Math.ceil(endpoints.length / 32));
  const compReach: Uint32Array[] = new Array(compCount);
  for (let c = 0; c < compCount; c++) compReach[c] = new Uint32Array(words);
  for (let u = 0; u < n; u++) {
    const pos = endpointPos.get(cells[u]);
    if (pos !== undefined) {
      const c = comp[u];
      compReach[c][pos >> 5] |= 1 << (pos & 31);
    }
  }
  const compSucc: Set<number>[] = new Array(compCount);
  const indeg = new Int32Array(compCount);
  for (let c = 0; c < compCount; c++) compSucc[c] = new Set();
  for (let u = 0; u < n; u++) {
    for (const v of adj[u]) {
      const cu = comp[u];
      const cv = comp[v];
      if (cu !== cv && !compSucc[cu].has(cv)) {
        compSucc[cu].add(cv);
        indeg[cv]++;
      }
    }
  }
  const topo: number[] = [];
  const ready: number[] = [];
  for (let c = 0; c < compCount; c++) if (indeg[c] === 0) ready.push(c);
  while (ready.length > 0) {
    const c = ready.pop()!;
    topo.push(c);
    for (const s of compSucc[c]) {
      if (--indeg[s] === 0) ready.push(s);
    }
  }
  for (let ti = topo.length - 1; ti >= 0; ti--) {
    const c = topo[ti];
    for (const s of compSucc[c]) {
      const src = compReach[s];
      const dst = compReach[c];
      for (let wdi = 0; wdi < words; wdi++) dst[wdi] |= src[wdi];
    }
  }
  return { nodeId, cells, comp, compCount, compReach, words };
}

export interface PreservationResult {
  /** 本ゲート(実移動モデル同士)の違反。0 でなければならない */
  violations: string[];
  /** 柱自身の通行保証(保守モデル)の違反。0 でなければならない */
  doorViolations: string[];
  endpoints: number;
  sources: number;
}

/**
 * 保守モデルで start から届くセル集合(BFS。柱自身の通行保証用)。
 * 探索は帯の内側(梯子列の 1 列外まで)に限る: 保証したいのは「柱の構造
 * (トンネルと梯子)だけで行き来できること」であり、帯の外の地形は使わない。
 */
function bfsConservative(win: Win, start: number, minLX: number, maxLX: number): Uint8Array {
  const visited = new Uint8Array(win.w * win.h);
  const queue = new Int32Array(win.w * win.h);
  let qh = 0;
  let qt = 0;
  queue[qt++] = start;
  visited[start] = 1;
  const out: number[] = [];
  while (qh < qt) {
    const u = queue[qh++];
    out.length = 0;
    neighbors(win, 'final', u % win.w, Math.floor(u / win.w), out);
    for (const v of out) {
      const vx = v % win.w;
      if (vx < minLX || vx > maxLX) continue;
      if (!visited[v]) {
        visited[v] = 1;
        queue[qt++] = v;
      }
    }
  }
  return visited;
}

/**
 * 柱 1 本について到達関係の保存を確かめる。窓は柱の全幅(乗り場込み)を
 * 上下左右に 48 タイル広げた範囲。
 */
export function checkPillarPreservation(
  baseGet: ReachGet, finGet: ReachGet, pillar: Pillar,
): PreservationResult {
  const x0 = pillar.landL - 48;
  const x1 = pillar.landR + 48;
  const y0 = pillar.yTop - 48;
  const y1 = pillar.yBottom + 48;
  const win = buildWin(baseGet, finGet, x0, x1, y0, y1);
  // 端点集合: 変わったタイルから 8 以内の立てるセル + 窓の左右端(横断の明示確認)
  const endpointSet = new Set<number>();
  for (let y = 0; y < win.h; y++) {
    for (let x = 0; x < win.w; x++) {
      const i = y * win.w + x;
      const nearZone = win.nearChanged8[i] === 1;
      const edgeZone = x <= 2 || x >= win.w - 3;
      if ((nearZone || edgeZone) && (win.baseStand[i] || win.finStand[i])) endpointSet.add(i);
    }
  }
  // 柱自身の通行保証の端点: 各穴について、乗り場の帯の中で本体に最も近い
  // 立てるセルを左右から取る(足の行は穴の床の 1 つ上)
  const doorCells: { door: number; left: number; right: number }[] = [];
  for (const d of pillar.doors) {
    const fy = d - 1 - y0;
    if (fy < 0 || fy >= win.h) continue;
    let left = -1;
    let right = -1;
    for (let x = pillar.x0 - 1; x >= pillar.landL; x--) {
      const i = fy * win.w + (x - x0);
      if (win.finStand[i]) { left = i; break; }
    }
    for (let x = pillar.x0 + pillar.w; x <= pillar.landR; x++) {
      const i = fy * win.w + (x - x0);
      if (win.finStand[i]) { right = i; break; }
    }
    if (left >= 0 && right >= 0) {
      doorCells.push({ door: d, left, right });
      endpointSet.add(left);
      endpointSet.add(right);
    }
  }
  const endpoints = [...endpointSet];
  const endpointPos = new Map<number, number>();
  endpoints.forEach((cell, i) => endpointPos.set(cell, i));
  const baseG = buildModelGraph(win, 'base', endpoints, endpointPos);
  const fullG = buildModelGraph(win, 'full', endpoints, endpointPos);
  const violations: string[] = [];
  const doorViolations: string[] = [];
  let sources = 0;
  const fmt = (cell: number): string => `(${x0 + (cell % win.w)},${y0 + Math.floor(cell / win.w)})`;
  const reaches = (g: ModelGraph, a: number, b: number): boolean => {
    const ga = g.nodeId[a];
    const gb = g.nodeId[b];
    if (ga < 0 || gb < 0) return false;
    const pos = endpointPos.get(b)!;
    const bits = g.compReach[g.comp[ga]];
    return (bits[pos >> 5] & (1 << (pos & 31))) !== 0;
  };
  for (const a of endpoints) {
    const aBase = baseG.nodeId[a];
    const aFull = fullG.nodeId[a];
    if (aBase < 0 || aFull < 0) continue; // 基準で立てない、または柱に埋まった源は除く
    sources++;
    const baseBits = baseG.compReach[baseG.comp[aBase]];
    for (let pos = 0; pos < endpoints.length; pos++) {
      if (!(baseBits[pos >> 5] & (1 << (pos & 31)))) continue;
      const b = endpoints[pos];
      if (fullG.nodeId[b] < 0) continue; // 埋まった行き先は除く
      if (!reaches(fullG, a, b)) {
        violations.push(`${fmt(a)} -> ${fmt(b)}`);
        if (violations.length >= 5) {
          return { violations, doorViolations, endpoints: endpoints.length, sources };
        }
      }
    }
  }
  // 柱自身の通行保証: 全ての穴セルが保守モデルで相互に届くこと
  // (同じ穴の左右の乗り場と、穴同士の梯子移動をまとめて確かめる)
  const doorAll: number[] = [];
  for (const dc of doorCells) doorAll.push(dc.left, dc.right);
  const minLX = pillar.landL - 1 - x0;
  const maxLX = pillar.landR + 1 - x0;
  for (const s of doorAll) {
    const vis = bfsConservative(win, s, minLX, maxLX);
    for (const t of doorAll) {
      if (!vis[t]) {
        doorViolations.push(`穴のセル ${fmt(s)} から ${fmt(t)} へ保守モデルで届かない`);
        break;
      }
    }
    if (doorViolations.length >= 3) break;
  }
  return { violations, doorViolations, endpoints: endpoints.length, sources };
}

export interface CrossingDistance {
  /** 基準地形での最短手数(辺の数) */
  base: number;
  /** 柱あり地形での最短手数 */
  fin: number;
}

/**
 * 指定した穴の行で、帯の左外の立てるセルから右外の立てるセルまでの最短手数を
 * 基準/柱ありの両方で数える(回り道の長さの目安。scripts/reach-survey.ts 用)。
 * どちらかで届かない、または足場が見つからなければ null。
 */
export function pillarCrossingDistance(
  baseGet: ReachGet, finGet: ReachGet, pillar: Pillar, door: number,
): CrossingDistance | null {
  const x0 = pillar.landL - 48;
  const x1 = pillar.landR + 48;
  const y0 = pillar.yTop - 48;
  const y1 = pillar.yBottom + 48;
  const win = buildWin(baseGet, finGet, x0, x1, y0, y1);
  const findCell = (stand: Uint8Array, wx: number, wy: number): number => {
    for (let r = 0; r <= 6; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = wx + dx - x0;
          const y = wy + dy - y0;
          if (x < 0 || y < 0 || x >= win.w || y >= win.h) continue;
          if (stand[y * win.w + x]) return y * win.w + x;
        }
      }
    }
    return -1;
  };
  const bfsDist = (model: 'base' | 'full', s: number, t: number): number => {
    if (s < 0 || t < 0) return -1;
    const dist = new Int32Array(win.w * win.h).fill(-1);
    const queue = new Int32Array(win.w * win.h);
    let qh = 0;
    let qt = 0;
    queue[qt++] = s;
    dist[s] = 0;
    const out: number[] = [];
    while (qh < qt) {
      const u = queue[qh++];
      if (u === t) return dist[u];
      out.length = 0;
      neighbors(win, model, u % win.w, Math.floor(u / win.w), out);
      for (const v of out) {
        if (dist[v] < 0) {
          dist[v] = dist[u] + 1;
          queue[qt++] = v;
        }
      }
    }
    return -1;
  };
  const sb = findCell(win.baseStand, pillar.landL - 2, door - 1);
  const tb = findCell(win.baseStand, pillar.landR + 2, door - 1);
  const sf = findCell(win.finStand, pillar.landL - 2, door - 1);
  const tf = findCell(win.finStand, pillar.landR + 2, door - 1);
  const base = bfsDist('base', sb, tb);
  const fin = bfsDist('full', sf, tf);
  if (base < 0 || fin < 0) return null;
  return { base, fin };
}
