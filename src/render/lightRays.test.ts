import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, TILE } from '../world/tiles';
import {
  chunkSolidLookup, circleRays, clipPolygonToRect, columnReach, coneRays, haloRadius, rayDistance, raysBlocked, reachRuns,
  CIRCLE_RAYS, CONE_RAYS, HALO_RAYS, LAMP_HALO_RAYS, WALL_SKIN, type SolidAt,
} from './lightRays';

const open: SolidAt = () => false;

/** x = wallX の列が固体の壁(gapY の行だけ穴が開いている) */
function wallAt(wallX: number, gapY?: number): SolidAt {
  return (tx, ty) => tx === wallX && ty !== gapY;
}

function dist(pts: Float64Array, i: number, cx: number, cy: number): number {
  return Math.hypot(pts[i * 2] - cx, pts[i * 2 + 1] - cy);
}

describe('rayDistance(レイの到達距離)', () => {
  it('開けた場所では全半径まで届く', () => {
    expect(rayDistance(10.5, 10.5, 1, 0, 9, open)).toBe(9);
    expect(rayDistance(10.5, 10.5, Math.SQRT1_2, -Math.SQRT1_2, 22, open)).toBe(22);
  });

  it('右の壁の表面で止まり、照らし代だけ壁へ入る', () => {
    // 中心 x=10.5、壁の列 x=13 → 表面まで 2.5
    expect(rayDistance(10.5, 10.5, 1, 0, 9, wallAt(13))).toBeCloseTo(2.5 + WALL_SKIN);
  });

  it('左・上・下の壁でも表面で止まる', () => {
    expect(rayDistance(10.25, 10.5, -1, 0, 9, wallAt(7))).toBeCloseTo(2.25 + WALL_SKIN);
    const ceiling: SolidAt = (_x, y) => y === 6;
    expect(rayDistance(10.5, 10.75, 0, -1, 9, ceiling)).toBeCloseTo(3.75 + WALL_SKIN);
    const floor: SolidAt = (_x, y) => y === 12;
    expect(rayDistance(10.5, 10.75, 0, 1, 9, floor)).toBeCloseTo(1.25 + WALL_SKIN);
  });

  it('斜めのレイも最初に入った固体タイルの表面で止まる', () => {
    // 45° で x=13 の列へ: 表面 x=13 に達するのは距離 2.5×√2
    const d = rayDistance(10.5, 10.5, Math.SQRT1_2, Math.SQRT1_2, 20, wallAt(13));
    expect(d).toBeCloseTo(2.5 * Math.SQRT2 + WALL_SKIN);
  });

  it('壁が半径の外なら全半径(照らし代で半径を超えない)', () => {
    expect(rayDistance(10.5, 10.5, 1, 0, 2, wallAt(13))).toBe(2);
    expect(rayDistance(10.5, 10.5, 1, 0, 2.6, wallAt(13))).toBe(2.6);
  });

  it('壁の隙間を通るレイは壁の向こうまで届く', () => {
    expect(rayDistance(10.5, 10.5, 1, 0, 9, wallAt(13, 10))).toBe(9);
    // 隙間でない行のレイは止まる
    expect(rayDistance(10.5, 11.5, 1, 0, 9, wallAt(13, 10))).toBeCloseTo(2.5 + WALL_SKIN);
  });

  it('中心のタイルが固体でも光は消えない(中心のタイルは見ない)', () => {
    const inside: SolidAt = (x, y) => x === 10 && y === 10;
    expect(rayDistance(10.5, 10.5, 1, 0, 9, inside)).toBe(9);
  });

  it('タイル境界ちょうどから負の向きへ出ると、隣のタイルを即座に見る', () => {
    expect(rayDistance(10, 10.5, -1, 0, 9, wallAt(9))).toBeCloseTo(WALL_SKIN);
  });
});

describe('circleRays(円の補助光)', () => {
  it('開けた場所では全端点が半径の円周上に乗る', () => {
    const pts = circleRays(20.3, 15.7, 9, CIRCLE_RAYS, open);
    expect(pts.length).toBe(CIRCLE_RAYS * 2);
    for (let i = 0; i < CIRCLE_RAYS; i++) expect(dist(pts, i, 20.3, 15.7)).toBeCloseTo(9);
  });

  it('全周を等角度で刻む(最初のレイは +x 向き)', () => {
    const pts = circleRays(0.5, 0.5, 4, 4, open);
    expect(pts[0]).toBeCloseTo(4.5);
    expect(pts[1]).toBeCloseTo(0.5);
    expect(pts[2]).toBeCloseTo(0.5);
    expect(pts[3]).toBeCloseTo(4.5);
    expect(pts[4]).toBeCloseTo(-3.5);
    expect(pts[6]).toBeCloseTo(0.5);
    expect(pts[7]).toBeCloseTo(-3.5);
  });

  it('右の壁があると右向きのレイだけ短くなり、端点は壁の中へ照らし代より深く入らない', () => {
    const pts = circleRays(10.5, 10.5, 9, CIRCLE_RAYS, wallAt(13));
    expect(dist(pts, 0, 10.5, 10.5)).toBeCloseTo(2.5 + WALL_SKIN);
    // 左向き(i = n/2)は全半径
    expect(dist(pts, CIRCLE_RAYS / 2, 10.5, 10.5)).toBeCloseTo(9);
    for (let i = 0; i < CIRCLE_RAYS; i++) expect(pts[i * 2]).toBeLessThanOrEqual(13 + WALL_SKIN + 1e-9);
  });

  it('同じ入力なら同じ端点(決定論)', () => {
    const a = circleRays(33.1, 7.9, 9, CIRCLE_RAYS, wallAt(36, 8));
    const b = circleRays(33.1, 7.9, 9, CIRCLE_RAYS, wallAt(36, 8));
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('out を渡すとそこへ書いて同じ配列を返す', () => {
    const out = new Float64Array(CIRCLE_RAYS * 2);
    expect(circleRays(1.5, 1.5, 9, CIRCLE_RAYS, open, out)).toBe(out);
  });
});

describe('coneRays(ライトコーン)', () => {
  it('扇の両端を含めて count 本を刻み、開けた場所では全半径', () => {
    const pts = coneRays(10.5, 10.5, 22, 0.3, 0.34, CONE_RAYS, open);
    expect(pts.length).toBe(CONE_RAYS * 2);
    const a0 = Math.atan2(pts[1] - 10.5, pts[0] - 10.5);
    const a1 = Math.atan2(pts[(CONE_RAYS - 1) * 2 + 1] - 10.5, pts[(CONE_RAYS - 1) * 2] - 10.5);
    expect(a0).toBeCloseTo(0.3 - 0.34);
    expect(a1).toBeCloseTo(0.3 + 0.34);
    for (let i = 0; i < CONE_RAYS; i++) expect(dist(pts, i, 10.5, 10.5)).toBeCloseTo(22);
  });

  it('扇の外へはレイを飛ばさない(全端点が扇の角度範囲に入る)', () => {
    const pts = coneRays(10.5, 10.5, 22, Math.PI / 2, 0.34, CONE_RAYS, open);
    for (let i = 0; i < CONE_RAYS; i++) {
      const a = Math.atan2(pts[i * 2 + 1] - 10.5, pts[i * 2] - 10.5);
      expect(a).toBeGreaterThanOrEqual(Math.PI / 2 - 0.34 - 1e-9);
      expect(a).toBeLessThanOrEqual(Math.PI / 2 + 0.34 + 1e-9);
    }
  });

  it('正面の壁で止まり、隙間の行を通るレイだけが奥まで届く', () => {
    const pts = coneRays(10.5, 10.5, 22, 0, 0.34, CONE_RAYS, wallAt(14, 10));
    let through = 0;
    for (let i = 0; i < CONE_RAYS; i++) {
      const x = pts[i * 2];
      if (x > 14 + WALL_SKIN + 1e-9) {
        through++;
        // 通ったレイは壁の列で隙間の行(y=10)を通っている
        const k = (14 - 10.5) / (x - 10.5);
        const yAtWall = 10.5 + (pts[i * 2 + 1] - 10.5) * k;
        expect(Math.floor(yAtWall)).toBe(10);
      }
    }
    expect(through).toBeGreaterThan(0);
    expect(through).toBeLessThan(CONE_RAYS);
  });
});

describe('columnReach(光柱・光条の列ごとの平行光、2.16)', () => {
  it('開けた場所では全列が end まで届く(下向き・上向き)', () => {
    expect(Array.from(columnReach(5, 3, 10, 30, open))).toEqual([30, 30, 30]);
    expect(Array.from(columnReach(5, 3, 30, 10, open))).toEqual([10, 10, 10]);
  });

  it('下向きは床の上面+照らし代で止まり、その下(床の中)へは届かない', () => {
    // x=6 の列だけ y=20 の行が固体
    const floor: SolidAt = (x, y) => x === 6 && y === 20;
    const r = columnReach(5, 3, 10, 30, floor);
    expect(r[0]).toBe(30);
    expect(r[1]).toBeCloseTo(20 + WALL_SKIN);
    expect(r[2]).toBe(30);
  });

  it('上向きは天井の下面−照らし代で止まる', () => {
    const ceiling: SolidAt = (_x, y) => y === 14;
    const r = columnReach(0, 2, 30, 10, ceiling);
    expect(r[0]).toBeCloseTo(15 - WALL_SKIN);
    expect(r[1]).toBeCloseTo(15 - WALL_SKIN);
  });

  it('起点の行が固体の列には光が入らない(壁の中から光らない)', () => {
    const wall: SolidAt = (x) => x === 1;
    const down = columnReach(0, 3, 10, 30, wall);
    expect(down[1]).toBe(10);
    // 上向きで start が整数なら、その 1 つ上の行(y=29)が起点の行
    const row29: SolidAt = (x, y) => x === 0 && y === 29;
    expect(columnReach(0, 1, 30, 10, row29)[0]).toBe(30);
    // 下向きで start が整数なら、その行(y=10)が起点の行
    const row10: SolidAt = (x, y) => x === 0 && y === 10;
    expect(columnReach(0, 1, 10, 30, row10)[0]).toBe(10);
  });

  it('照らし代で end を超えない', () => {
    const floor: SolidAt = (_x, y) => y === 29;
    expect(columnReach(0, 1, 10, 29.1, floor)[0]).toBeCloseTo(29.1, 9);
  });

  it('out を渡すとそこへ書いて同じ配列を返す', () => {
    const out = new Float64Array(8);
    expect(columnReach(0, 3, 0, 5, open, out)).toBe(out);
  });
});

describe('reachRuns(同じ到達位置の列をまとめる)', () => {
  it('全列が同じなら矩形の幅のまま 1 区間', () => {
    const reach = new Float64Array([30, 30, 30, 30]);
    expect(reachRuns(reach, 10, 4, 10.5, 13.25)).toEqual([{ x0: 10.5, x1: 13.25, reach: 30 }]);
  });

  it('到達位置の変わり目で区切る(列の境界で切り、両端は矩形で切る)', () => {
    const reach = new Float64Array([30, 20.3, 20.3, 30]);
    expect(reachRuns(reach, 10, 4, 10.5, 13.5)).toEqual([
      { x0: 10.5, x1: 11, reach: 30 },
      { x0: 11, x1: 13, reach: 20.3 },
      { x0: 13, x1: 13.5, reach: 30 },
    ]);
  });

  it('reach の外の列は返さない', () => {
    const reach = new Float64Array([1, 2]);
    expect(reachRuns(reach, 10, 2, 8, 20)).toEqual([
      { x0: 10, x1: 11, reach: 1 },
      { x0: 11, x1: 12, reach: 2 },
    ]);
    expect(reachRuns(reach, 10, 2, 0, 5)).toEqual([]);
  });
});

describe('点光源の暈(haloRadius / raysBlocked / clipPolygonToRect、2.16)', () => {
  it('レイの本数は光源の種類ごとに小さく保つ(暈 16 本、休憩点の灯 12 本)', () => {
    expect(HALO_RAYS).toBe(16);
    expect(LAMP_HALO_RAYS).toBe(12);
    expect(HALO_RAYS).toBeLessThan(CIRCLE_RAYS);
  });

  it('開けた場所ではレイの多角形が暈の矩形を必ず含む(形が変わらない)', () => {
    for (const rays of [HALO_RAYS, LAMP_HALO_RAYS]) {
      const r = haloRadius(10, 9.5, 7, 7, 13, 10, rays);
      const pts = circleRays(10, 9.5, r, rays, open);
      expect(raysBlocked(pts, rays, 10, 9.5, r)).toBe(false);
      // 多角形で切っても矩形の面積が保たれる
      const poly = clipPolygonToRect(pts, rays, 7, 7, 13, 10);
      expect(polyArea(poly)).toBeCloseTo(6 * 3, 5);
    }
  });

  it('壁があるとレイが止まり、暈は壁の手前(照らし代まで)だけになる', () => {
    // 灯 (10, 9.5) の右 x=12 の列が壁。暈は x 7..13
    const wall = wallAt(12);
    const r = haloRadius(10, 9.5, 7, 7, 13, 10, HALO_RAYS);
    const pts = circleRays(10, 9.5, r, HALO_RAYS, wall);
    expect(raysBlocked(pts, HALO_RAYS, 10, 9.5, r)).toBe(true);
    const poly = clipPolygonToRect(pts, HALO_RAYS, 7, 7, 13, 10);
    for (let i = 0; i < poly.length; i += 2) expect(poly[i]).toBeLessThanOrEqual(12 + WALL_SKIN + 1e-9);
    // 壁の向こう(x ≥ 12.3)は塗らないので、面積は元の矩形より小さい
    expect(polyArea(poly)).toBeLessThan(6 * 3);
    expect(polyArea(poly)).toBeGreaterThan(0);
  });

  it('clipPolygonToRect: 重ならなければ空、矩形の内側の多角形はそのまま', () => {
    const square = [0, 0, 2, 0, 2, 2, 0, 2];
    expect(clipPolygonToRect(square, 4, 5, 5, 6, 6)).toEqual([]);
    expect(polyArea(clipPolygonToRect(square, 4, -1, -1, 3, 3))).toBeCloseTo(4);
    expect(polyArea(clipPolygonToRect(square, 4, 1, 1, 3, 3))).toBeCloseTo(1);
  });
});

/** [x0,y0,...] の多角形の面積(靴紐公式) */
function polyArea(p: number[]): number {
  let s = 0;
  const m = p.length / 2;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    s += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1];
  }
  return Math.abs(s) / 2;
}

describe('chunkSolidLookup(チャンクからの固体判定)', () => {
  function chunkWith(tiles: [number, number, number][]): Uint8Array {
    const c = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    for (const [x, y, t] of tiles) c[y * CHUNK_SIZE + x] = t;
    return c;
  }

  it('SOLID と HARD を固体、AIR と梯子を非固体とする', () => {
    const c = chunkWith([[1, 2, TILE.SOLID], [3, 4, TILE.HARD], [5, 6, TILE.LADDER]]);
    const solid = chunkSolidLookup((cx, cy) => (cx === 0 && cy === 0 ? c : undefined));
    expect(solid(1, 2)).toBe(true);
    expect(solid(3, 4)).toBe(true);
    expect(solid(5, 6)).toBe(false);
    expect(solid(0, 0)).toBe(false);
  });

  it('負の座標のチャンクも正しく引く', () => {
    const c = chunkWith([[CHUNK_SIZE - 1, CHUNK_SIZE - 1, TILE.SOLID]]);
    const solid = chunkSolidLookup((cx, cy) => (cx === -1 && cy === -1 ? c : undefined));
    expect(solid(-1, -1)).toBe(true);
    expect(solid(-2, -1)).toBe(false);
  });

  it('未生成のチャンクは空気として扱い、同じチャンクの連続参照では peek を呼び直さない', () => {
    let calls = 0;
    const solid = chunkSolidLookup(() => {
      calls++;
      return undefined;
    });
    expect(solid(3, 3)).toBe(false);
    expect(solid(4, 3)).toBe(false);
    expect(calls).toBe(1);
    expect(solid(CHUNK_SIZE + 1, 3)).toBe(false);
    expect(calls).toBe(2);
  });
});
