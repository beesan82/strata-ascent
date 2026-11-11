import { describe, expect, it } from 'vitest';
import { BIOME_IDS } from '../world/biomeCells';
import { nearestRestPoint, REST_HEIGHT, restPointAt } from '../world/restpoint';
import { CHUNK_SIZE, TILE } from '../world/tiles';
import { findSpawn, tileAt } from '../world/worldgen';
import {
  decorateChunk, DISTRICT_DECOR_COLORS, GIRDER_CLEARANCE, PALETTE, SCENERY_COLORS, SCENERY_PROFILE,
  SCENERY_REST_GUARD, sceneryGuarded, type DecorOp,
} from './decor';
import { STEEL } from './steel';

// 歩く景色(2.17 後半、設計 2026-11-11-walked-scenery)のテスト。
// decorateChunk は (seed,cx,cy) の純関数なので seed=42 の結果をメモ化して走査を共有する。
// ※決定論テストはキャッシュを介さず decorateChunk を直接呼ぶ。
const SEED = 42;
const CH = CHUNK_SIZE;
const memo = new Map<string, DecorOp[]>();
function deco(cx: number, cy: number): DecorOp[] {
  const k = `${cx},${cy}`;
  let v = memo.get(k);
  if (!v) {
    v = decorateChunk(SEED, cx, cy);
    memo.set(k, v);
  }
  return v;
}

const C = SCENERY_COLORS;
const isWreck = (op: DecorOp) => op.kind === 'poly' && !!op.fill && op.color === C.wreck;
const isSlab = (op: DecorOp) => op.kind === 'rect' && op.color === C.slab;
const isBeam = (op: DecorOp) => op.kind === 'poly' && !!op.fill && op.color === C.beam;
const isField = (op: DecorOp) => op.kind === 'poly' && !!op.fill && op.color === C.shard;
const isGirder = (op: DecorOp) => op.kind === 'rect' && op.color === C.girderWeb;
const isStencil = (op: DecorOp) => op.kind === 'rect' && op.color === C.stencil;
const isBayDeep = (op: DecorOp) => op.kind === 'rect' && op.color === C.bayDeep;
const isBaySilhouette = (op: DecorOp) => (op.kind === 'rect' || op.kind === 'poly') && op.color === C.baySilhouette;

/** 走査範囲(チャンク)。見つかった数が limit に達したら打ち切る(低頻度のモチーフでも重くならないように) */
const CX0 = -4, CX1 = 4, CY0 = -14, CY1 = 3;
function scan(pred: (op: DecorOp) => boolean, limit: number): Array<{ cx: number; cy: number; op: DecorOp }> {
  const out: Array<{ cx: number; cy: number; op: DecorOp }> = [];
  for (let cy = CY0; cy <= CY1; cy++) {
    for (let cx = CX0; cx <= CX1; cx++) {
      for (const op of deco(cx, cy)) {
        if (!pred(op)) continue;
        out.push({ cx, cy, op });
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

function polyBox(pts: number[]): { x0: number; x1: number; y0: number; y1: number } {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
  }
  return { x0, x1, y0, y1 };
}

/** 残滓の足元(世界座標の列 [wx0, wx1)、床の行 wyF)の検査: 床・上の空気・下に梯子なし・保護範囲の外 */
function expectGrounded(wx0: number, wx1: number, wyF: number): void {
  for (let wx = wx0; wx < wx1; wx++) {
    expect(tileAt(SEED, wx, wyF)).toBe(TILE.SOLID);
    for (let k = 1; k <= 3; k++) expect(tileAt(SEED, wx, wyF - k)).toBe(TILE.AIR);
    expect(tileAt(SEED, wx, wyF + 1)).not.toBe(TILE.LADDER);
  }
  const sp = findSpawn(SEED);
  const sx = Math.floor(sp.x);
  const sy = Math.round(sp.y + 1.9);
  const sd = Math.max(Math.max(0, wx0 - sx, sx - wx1), Math.max(0, wyF - 3 - sy, sy - wyF));
  expect(sd).toBeGreaterThan(10);
  const rp = nearestRestPoint(SEED, (wx0 + wx1) / 2, wyF);
  const rd = Math.max(
    Math.max(0, rp.left - wx1, wx0 - rp.right),
    Math.max(0, rp.floorY - REST_HEIGHT - 1 - wyF, wyF - 3 - rp.floorY),
  );
  expect(rd).toBeGreaterThan(4);
}

describe('歩く景色: 地区バイアスの表と色(設計 C)', () => {
  it('すべての地区に表があり、値は非負', () => {
    for (const id of BIOME_IDS) {
      const p = SCENERY_PROFILE[id];
      expect(p).toBeDefined();
      for (const v of Object.values(p)) expect(v).toBeGreaterThanOrEqual(0);
      expect(p.pipes).toBeLessThanOrEqual(1);
    }
  });

  it('設計書の例どおりの寄り方をする', () => {
    const P = SCENERY_PROFILE;
    const others = (id: keyof typeof P) => BIOME_IDS.filter((b) => b !== id).map((b) => P[b]);
    // 居住区画は残滓とステンシルが濃い
    for (const o of others('habitation')) {
      expect(P.habitation.stencil).toBeGreaterThan(o.stencil);
      expect(P.habitation.remnant).toBeGreaterThan(o.remnant);
    }
    // 廃棄沈殿層は破片の野原と倒れた梁
    expect(P.disposal.field).toBeGreaterThan(Math.max(P.disposal.wreck, P.disposal.slabs));
    expect(P.disposal.beam).toBeGreaterThan(Math.max(P.disposal.wreck, P.disposal.slabs));
    // 電力区は桁渡りと太い配管束
    for (const o of others('power')) {
      expect(P.power.girder).toBeGreaterThan(o.girder);
      expect(P.power.pipes).toBeGreaterThan(o.pipes);
    }
    // 精錬区は錆とスラブの山
    for (const o of others('foundry')) {
      expect(P.foundry.rust).toBeGreaterThan(o.rust);
      expect(P.foundry.slabs).toBeGreaterThan(o.slabs);
    }
    // 大空洞水域はベイと桁で空間の巨大さ寄り
    expect(P.waterVoid.bayFill).toBeGreaterThan(P.coldSteel.bayFill);
    expect(P.waterVoid.girder).toBeGreaterThan(P.coldSteel.girder);
    // 寒鋼基層は薄め
    expect(P.coldSteel.remnant).toBeLessThan(1);
    // 生体異物区は残滓(機械の残骸)を混ぜる
    expect(P.biomech.wreck).toBeGreaterThan(P.coldSteel.wreck);
  });

  it('景色の色は互いに異なり、既存の PALETTE・STEEL・地区色と重ならない', () => {
    const mine = Object.values(SCENERY_COLORS);
    expect(new Set(mine).size).toBe(mine.length);
    const existing = new Set<string>([
      ...Object.values(PALETTE), ...Object.values(STEEL), ...Object.values(DISTRICT_DECOR_COLORS),
    ]);
    for (const c of mine) expect(existing.has(c)).toBe(false);
  });
});

describe('歩く景色: 保護範囲 sceneryGuarded', () => {
  it('開始地点の足元は保護される', () => {
    const sp = findSpawn(SEED);
    const x = Math.floor(sp.x);
    const y = Math.round(sp.y + 1.9);
    expect(sceneryGuarded(SEED, x, x, y, y)).toBe(true);
    expect(sceneryGuarded(SEED, x + 30, x + 31, y, y)).toBe(false);
  });

  it('休憩点の箱とその周り SCENERY_REST_GUARD は保護され、その外は保護されない', () => {
    const rp = restPointAt(SEED, -1, 1);
    expect(sceneryGuarded(SEED, rp.x, rp.x, rp.floorY - 3, rp.floorY - 1)).toBe(true);
    expect(sceneryGuarded(SEED, rp.right + SCENERY_REST_GUARD, rp.right + SCENERY_REST_GUARD + 2, rp.floorY - 1, rp.floorY - 1)).toBe(true);
    expect(sceneryGuarded(SEED, rp.right + SCENERY_REST_GUARD + 1, rp.right + SCENERY_REST_GUARD + 3, rp.floorY - 1, rp.floorY - 1)).toBe(false);
    const above = rp.floorY - REST_HEIGHT - 1 - SCENERY_REST_GUARD - 5;
    expect(sceneryGuarded(SEED, rp.x, rp.x, above, above)).toBe(false);
  });
});

const MOTIFS: Array<[string, (op: DecorOp) => boolean]> = [
  ['機械の残骸', isWreck],
  ['積まれた板', isSlab],
  ['倒れた梁', isBeam],
  ['破片の野原', isField],
  ['頭上の桁渡り', isGirder],
  ['巨大壁面のステンシル', isStencil],
  ['深い壁ベイ', isBayDeep],
  ['ベイの中のシルエット', isBaySilhouette],
];

describe('歩く景色: 出現と配置(設計 A・B)', () => {
  it.each(MOTIFS)('%s が広域のどこかに出る', (_name, pred) => {
    expect(scan(pred, 1).length).toBeGreaterThan(0);
  });

  it('機械の残骸は床の上面に接地し、梯子・保護範囲を避ける', () => {
    const found = scan(isWreck, 12);
    expect(found.length).toBeGreaterThan(0);
    for (const { cx, cy, op } of found) {
      if (op.kind !== 'poly') continue;
      const b = polyBox(op.pts);
      expect(Number.isInteger(b.y1)).toBe(true); // 最下点 = 床の上面
      expectGrounded(Math.floor(cx * CH + b.x0), Math.ceil(cx * CH + b.x1), cy * CH + b.y1);
    }
  });

  it('積まれた板の最下段は床の上面に接地し、梯子・保護範囲を避ける', () => {
    let found = 0;
    for (const { cx, cy, op } of scan(isSlab, 40)) {
      if (op.kind !== 'rect') continue;
      const bottom = op.y + op.h;
      if (Math.abs(bottom - Math.round(bottom)) > 1e-6) continue; // 上の段は対象外
      found++;
      expectGrounded(Math.floor(cx * CH + op.x), Math.ceil(cx * CH + op.x + op.w), cy * CH + Math.round(bottom));
    }
    expect(found).toBeGreaterThan(0);
  });

  it('破片の野原は床の上面に接地し、梯子・保護範囲を避ける', () => {
    const found = scan(isField, 30);
    expect(found.length).toBeGreaterThan(0);
    for (const { cx, cy, op } of found) {
      if (op.kind !== 'poly') continue;
      const b = polyBox(op.pts);
      expect(Number.isInteger(b.y1)).toBe(true);
      expectGrounded(Math.floor(cx * CH + b.x0), Math.ceil(cx * CH + b.x1), cy * CH + b.y1);
    }
  });

  it('倒れた梁は壁(出入口のない固体)から床へ倒れかかる', () => {
    const found = scan(isBeam, 8);
    expect(found.length).toBeGreaterThan(0);
    for (const { cx, cy, op } of found) {
      if (op.kind !== 'poly') continue;
      const b = polyBox(op.pts);
      const wyF = cy * CH + b.y1;
      expect(Number.isInteger(wyF)).toBe(true);
      // pts[0] は壁の面(タイル境界)。左右どちらかの隣が床から 4 行上まで固体の壁
      const wxw = cx * CH + op.pts[0];
      const wallCol = [Math.round(wxw) - 1, Math.round(wxw)].find((x) => tileAt(SEED, x, wyF - 2) === TILE.SOLID);
      expect(wallCol).toBeDefined();
      for (let k = 0; k <= 4; k++) expect(tileAt(SEED, wallCol!, wyF - k)).not.toBe(TILE.AIR);
      // 倒れた先(足元)は床
      const footX = Math.floor(cx * CH + (op.pts[2] + op.pts[4]) / 2);
      expect(tileAt(SEED, footX, wyF)).toBe(TILE.SOLID);
      expect(tileAt(SEED, footX, wyF - 1)).toBe(TILE.AIR);
    }
  });

  it('頭上の桁渡りは天井の下面に吊られ、下に GIRDER_CLEARANCE 行の空気がある(頭より十分上)', () => {
    const found = scan(isGirder, 12);
    expect(found.length).toBeGreaterThan(0);
    for (const { cx, cy, op } of found) {
      if (op.kind !== 'rect') continue;
      expect(op.w).toBe(16);
      expect(((cx * CH + op.x) % 16 + 16) % 16).toBe(0); // 16 整列(垂直のチャンク境界をまたがない)
      const ceil = cy * CH + op.y - 1.63; // web.y = 天井行 + 1.63
      expect(Math.abs(ceil - Math.round(ceil))).toBeLessThan(1e-6);
      const row = Math.round(ceil);
      for (const fx of [0.5, 8, 15.5]) {
        const wx = Math.floor(cx * CH + op.x + fx);
        expect(tileAt(SEED, wx, row)).toBe(TILE.SOLID);
        for (let k = 1; k <= GIRDER_CLEARANCE; k++) expect(tileAt(SEED, wx, row + k)).toBe(TILE.AIR);
      }
    }
  });

  it('ステンシル・深いベイ・ベイの中のシルエットは閉じた壁(SOLID)の面にだけ描かれる', () => {
    let found = 0;
    for (const pred of [isStencil, isBayDeep, isBaySilhouette]) {
      for (const { cx, cy, op } of scan(pred, 30)) {
        let box: { x0: number; x1: number; y0: number; y1: number };
        if (op.kind === 'rect') box = { x0: op.x, x1: op.x + op.w, y0: op.y, y1: op.y + op.h };
        else if (op.kind === 'poly') box = polyBox(op.pts);
        else continue;
        found++;
        for (const [fx, fy] of [
          [box.x0, box.y0], [box.x1 - 0.01, box.y0], [box.x0, box.y1 - 0.01], [box.x1 - 0.01, box.y1 - 0.01],
          [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2],
        ] as const) {
          expect(tileAt(SEED, cx * CH + Math.floor(fx), cy * CH + Math.floor(fy))).toBe(TILE.SOLID);
        }
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('決定論: 景色を含むチャンクは同一入力なら同一出力', () => {
    const [hit] = scan((op) => isWreck(op) || isSlab(op) || isBeam(op) || isField(op) || isGirder(op), 1);
    expect(hit).toBeDefined();
    expect(decorateChunk(SEED, hit.cx, hit.cy)).toEqual(decorateChunk(SEED, hit.cx, hit.cy));
  });
});

describe('歩く景色: チャンク境界の一致', () => {
  /**
   * 上下に隣り合うチャンク (cx,cy)/(cx,cy+1) で key を集めて比べる。found が need に達したら打ち切る。
   * range で走査範囲(チャンク)を、pairOk で比べる組の事前の絞り込み(地形だけを見る安い判定)を差し替えられる
   */
  function compareAcross(
    keysOf: (cx: number, cy: number, boundary: number) => Set<string>,
    need: number,
    range = { cx0: CX0, cx1: CX1, cy0: CY0, cy1: CY1 },
    pairOk: (cx: number, boundary: number) => boolean = () => true,
  ): number {
    let found = 0;
    for (let cy = range.cy0; cy < range.cy1; cy++) {
      const boundary = (cy + 1) * CH;
      for (let cx = range.cx0; cx <= range.cx1; cx++) {
        if (!pairOk(cx, boundary)) continue;
        const above = keysOf(cx, cy, boundary);
        expect(above).toEqual(keysOf(cx, cy + 1, boundary));
        found += above.size;
        if (found >= need) return found;
      }
    }
    return found;
  }

  it('床の残滓は水平チャンク境界の両側で一致する(床が境界の直下 4 行以内)', () => {
    // 残滓は床から上へ最大 3.4 伸びるので、床の行が [境界, 境界+3] だと上のチャンクの画素にも描かれる
    const found = compareAcross((cx, ccy, boundary) => {
      const set = new Set<string>();
      for (const op of deco(cx, ccy)) {
        let wyF: number;
        let wx: number;
        if ((isWreck(op) || isBeam(op) || isField(op)) && op.kind === 'poly') {
          const b = polyBox(op.pts);
          wyF = ccy * CH + b.y1;
          wx = cx * CH + b.x0;
        } else if (isSlab(op) && op.kind === 'rect') {
          const bottom = op.y + op.h;
          if (Math.abs(bottom - Math.round(bottom)) > 1e-6) continue;
          wyF = ccy * CH + Math.round(bottom);
          wx = cx * CH + op.x;
        } else {
          continue;
        }
        if (wyF >= boundary && wyF <= boundary + 3) set.add(`${op.kind}:${op.color}:${wx.toFixed(2)}:${wyF}`);
      }
      return set;
    }, 4);
    expect(found).toBeGreaterThan(0);
  });

  it('頭上の桁渡りは水平チャンク境界の両側で一致する(天井が境界の直上 4 行以内)', () => {
    // 桁の天井はほぼ躯体の床帯の行(floorSpacing の倍数)。寒鋼基層(8)は 64 を割り切るので、床帯が境界の
    // 直上 4 行に来ることが無い。既定の走査範囲(cy −14..3)は寒鋼のセル 0 と隣の 3 セルだけなので、
    // 1 サイクル(7 地区)を含むよう上へ広げる。広げた分の重さは、境界の直上 4 行に「16 列の天井 +
    // 下に GIRDER_CLEARANCE 行の空気」(桁の必要条件)が地形に無い組を tileAt だけで飛ばして抑える。
    const range = { cx0: CX0, cx1: CX1, cy0: -60, cy1: CY1 };
    const pairOk = (cx: number, boundary: number): boolean => {
      for (let x0 = cx * CH - 16; x0 <= cx * CH + CH; x0 += 16) {
        for (let row = boundary - 4; row <= boundary - 1; row++) {
          let ok = true;
          for (let i = 0; i < 16 && ok; i++) {
            ok = tileAt(SEED, x0 + i, row) === TILE.SOLID;
            for (let k = 1; k <= GIRDER_CLEARANCE && ok; k++) ok = tileAt(SEED, x0 + i, row + k) === TILE.AIR;
          }
          if (ok) return true;
        }
      }
      return false;
    };
    const found = compareAcross((cx, ccy, boundary) => {
      const set = new Set<string>();
      for (const op of deco(cx, ccy)) {
        if (!isGirder(op) || op.kind !== 'rect') continue;
        const ceil = Math.round(ccy * CH + op.y - 1.63);
        if (ceil >= boundary - 4 && ceil <= boundary - 1) set.add(`${(cx * CH + op.x).toFixed(2)}:${ceil}`);
      }
      return set;
    }, 4, range, pairOk);
    expect(found).toBeGreaterThan(0);
  });

  it('ステンシル・深いベイ・ベイの中身は水平チャンク境界の両側で一致する(境界をまたぐ 7 行ブロック)', () => {
    const found = compareAcross((cx, ccy, boundary) => {
      const set = new Set<string>();
      for (const op of deco(cx, ccy)) {
        if (!(isStencil(op) || isBayDeep(op) || isBaySilhouette(op))) continue;
        let x: number, y: number;
        if (op.kind === 'rect') { x = op.x; y = op.y; }
        else if (op.kind === 'poly') { const b = polyBox(op.pts); x = b.x0; y = b.y0; }
        else continue;
        const wy = ccy * CH + y;
        const y0 = Math.floor(wy / 7) * 7; // ブロックの上端(7 整列)
        if (y0 >= boundary - 6 && y0 <= boundary - 1) set.add(`${op.kind}:${op.color}:${(cx * CH + x).toFixed(2)}:${wy.toFixed(2)}`);
      }
      return set;
    }, 6);
    expect(found).toBeGreaterThan(0);
  });
});
