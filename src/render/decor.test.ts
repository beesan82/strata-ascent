import { describe, expect, it } from 'vitest';
import { TILE } from '../world/tiles';
import { tileAt } from '../world/worldgen';
import { decorateChunk, PALETTE } from './decor';

describe('decorateChunk', () => {
  it('同一シード・同一チャンクなら同一の装飾リスト(決定論)', () => {
    expect(decorateChunk(42, 1, 1)).toEqual(decorateChunk(42, 1, 1));
  });

  it('装飾の種類が一通り出現する(広域統計)', () => {
    const kinds = new Set<string>();
    const colors = new Set<string>();
    for (let cx = 0; cx < 4; cx++) {
      for (let cy = -2; cy < 2; cy++) {
        for (const op of decorateChunk(42, cx, cy)) {
          kinds.add(op.kind);
          if ('color' in op) colors.add(op.color);
        }
      }
    }
    expect(kinds).toContain('line');
    expect(kinds).toContain('dot');
    expect(kinds).toContain('hatch');
    // エッジハイライトと梯子レールは必ずどこかにある
    expect(colors).toContain(PALETTE.edgeTop);
    expect(colors).toContain(PALETTE.rail);
  });

  it('ハッチングは内部タイル(全方向SOLID)にのみ付く', () => {
    for (const op of decorateChunk(42, 1, 1)) {
      if (op.kind !== 'hatch') continue;
      const wx = 1 * 64 + Math.floor(op.x);
      const wy = 1 * 64 + Math.floor(op.y);
      expect(tileAt(42, wx, wy)).toBe(TILE.SOLID);
      expect(tileAt(42, wx, wy - 1)).toBe(TILE.SOLID);
      expect(tileAt(42, wx, wy + 1)).toBe(TILE.SOLID);
      expect(tileAt(42, wx - 1, wy)).toBe(TILE.SOLID);
      expect(tileAt(42, wx + 1, wy)).toBe(TILE.SOLID);
    }
  });

  it('梯子タイルにはレール2本と踏み桟が付く', () => {
    // チャンク(1,1)内の梯子タイルを1つ探す
    let found = false;
    for (let ly = 0; ly < 64 && !found; ly++) {
      for (let lx = 0; lx < 64 && !found; lx++) {
        if (tileAt(42, 64 + lx, 64 + ly) !== TILE.LADDER) continue;
        found = true;
        const ops = decorateChunk(42, 1, 1).filter(
          (op) =>
            op.kind === 'line' &&
            op.color === PALETTE.rail &&
            Math.floor(op.x1) === lx &&
            Math.floor(op.y1) === ly,
        );
        expect(ops.length).toBe(2); // 縦レール2本
      }
    }
    expect(found).toBe(true);
  });
});

describe('decorateChunk セグメント装飾', () => {
  it('広域には配管・ケーブル・瓦礫・壁面装飾のいずれもが出現する', () => {
    const colors = new Set<string>();
    for (let cx = 0; cx < 6; cx++) {
      for (let cy = -3; cy < 3; cy++) {
        for (const op of decorateChunk(42, cx, cy)) {
          if ('color' in op) colors.add(op.color);
        }
      }
    }
    expect(colors).toContain(PALETTE.pipe);
    expect(colors).toContain(PALETTE.cable);
    expect(colors).toContain(PALETTE.debris);
    expect(colors).toContain(PALETTE.grill);
  });

  it('床配管は床上面のあるセグメントにのみ載る(配管線の下は必ずSOLID)', () => {
    for (let cx = 0; cx < 3; cx++) {
      for (const op of decorateChunk(42, cx, 1)) {
        if (op.kind !== 'line' || op.color !== PALETTE.pipe) continue;
        if (op.x1 === op.x2) continue; // 壁の縦配管は除外(水平配管のみ検査)
        const midX = cx * 64 + Math.floor((op.x1 + op.x2) / 2);
        const y = 1 * 64 + Math.floor(op.y1);
        expect(tileAt(42, midX, y + 1)).toBe(TILE.SOLID);
        expect(tileAt(42, midX, y)).not.toBe(TILE.SOLID);
      }
    }
  });

  it('天井ケーブルのアンカーは天井面にある(始点直上がSOLID)', () => {
    for (let cx = 0; cx < 3; cx++) {
      for (const op of decorateChunk(42, cx, 1)) {
        if (op.kind !== 'poly' || op.color !== PALETTE.cable) continue;
        const x0 = cx * 64 + Math.floor(op.pts[0]);
        const y0 = 1 * 64 + Math.floor(op.pts[1]);
        expect(tileAt(42, x0, y0 - 1)).toBe(TILE.SOLID);
      }
    }
  });

  it('床配管の判定はチャンク境界の両側で一致する(継ぎ目なし)', () => {
    // x=64(チャンク0と1の境界)付近を通る水平配管の世界座標区間を両チャンクから集めて比較
    const collect = (cx: number) => {
      const set = new Set<string>();
      for (const op of decorateChunk(42, cx, 1)) {
        if (op.kind !== 'line' || op.color !== PALETTE.pipe || op.x1 === op.x2) continue;
        const wx1 = cx * 64 + op.x1;
        const wx2 = cx * 64 + op.x2;
        const wy = 64 + op.y1;
        if (wx2 > 48 && wx1 < 80) set.add(`${wx1.toFixed(2)}:${wx2.toFixed(2)}:${wy.toFixed(2)}`);
      }
      return set;
    };
    expect(collect(0)).toEqual(collect(1));
  });
});

describe('壁の弐瓶化(段階F)', () => {
  const CH = 64;
  it('凹ベイ(bay色のrect)は完全内部領域にのみ彫られる', () => {
    let found = 0;
    for (let cx = 0; cx < 6; cx++) {
      for (let cy = -3; cy < 3; cy++) {
        for (const op of decorateChunk(42, cx, cy)) {
          if (op.kind !== 'rect' || op.color !== PALETTE.bay) continue;
          found++;
          for (const [fx, fy] of [
            [op.x, op.y], [op.x + op.w - 0.01, op.y],
            [op.x, op.y + op.h - 0.01], [op.x + op.w - 0.01, op.y + op.h - 0.01],
            [op.x + op.w / 2, op.y + op.h / 2],
          ] as const) {
            expect(tileAt(42, cx * CH + Math.floor(fx), cy * CH + Math.floor(fy))).toBe(TILE.SOLID);
          }
        }
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('錆筋は grad(縦方向・stops 0..1)で表現される', () => {
    let found = 0;
    for (let cx = 0; cx < 6; cx++) {
      for (let cy = -3; cy < 3; cy++) {
        for (const op of decorateChunk(42, cx, cy)) {
          if (op.kind !== 'grad') continue;
          // 大径配管(pipeHi起点の横グラデ)は対象外。錆筋(rust起点)のみ検査する
          if (op.stops[0][1] !== PALETTE.rust) continue;
          found++;
          expect(op.dir).toBe('v');
          expect(op.h).toBeGreaterThan(0);
          expect(op.stops.length).toBeGreaterThanOrEqual(2);
          for (const [off] of op.stops) {
            expect(off).toBeGreaterThanOrEqual(0);
            expect(off).toBeLessThanOrEqual(1);
          }
        }
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('凹ベイの判定はチャンク水平境界の両側で一致する(継ぎ目なし)', () => {
    // ベイは x方向8整列・幅7 なので垂直境界(x=64整列)は原理的にまたがない。
    // 水平境界(y=cy*64。64は7の倍数でないため境界をまたぐベイ行が存在しうる)で、
    // 境界を実際にまたぐベイ(y0∈[境界-6,境界-1])だけを比較する。この範囲は
    // 上下両チャンクの走査範囲(bt0..bt1)とバッファで完全計算できる。
    let found = 0;
    for (let cy = 0; cy < 3; cy++) {
      const boundary = (cy + 1) * CH;
      for (let cx = 0; cx < 8; cx++) {
        const collect = (ccy: number) => {
          const set = new Set<string>();
          for (const op of decorateChunk(42, cx, ccy)) {
            if (op.kind !== 'rect' || op.color !== PALETTE.bay) continue;
            const wy = ccy * CH + op.y;
            if (wy < boundary && wy + op.h > boundary) {
              set.add(`${(cx * CH + op.x).toFixed(2)}:${wy.toFixed(2)}`);
            }
          }
          return set;
        };
        const above = collect(cy);
        expect(above).toEqual(collect(cy + 1));
        found += above.size;
      }
    }
    // 恒真の排除: 境界をまたぐベイが少なくとも1つは実在すること(決定論なので安定)
    expect(found).toBeGreaterThan(0);
  });

  it('決定論: 同一入力なら同一出力(拡張後も)', () => {
    expect(decorateChunk(42, 2, -1)).toEqual(decorateChunk(42, 2, -1));
  });
});

describe('大径配管とケーブルトレイ(段階F)', () => {
  const CH = 64;
  it('大径配管(pipeHi起点の横グラデ)は縦壁面の空気側に立つ', () => {
    let found = 0;
    for (let cx = 0; cx < 10; cx++) {
      for (let cy = -5; cy < 5; cy++) {
        for (const op of decorateChunk(42, cx, cy)) {
          if (op.kind !== 'grad' || op.dir !== 'h') continue;
          if (op.stops[0][1] !== PALETTE.pipeHi) continue;
          found++;
          expect(op.h).toBe(8); // 8タイル分の縦管
          // 管の中心は空気(壁のそば・非衝突)
          const wx = cx * CH + Math.floor(op.x + op.w / 2);
          const wy = cy * CH + Math.floor(op.y + 4);
          expect(tileAt(42, wx, wy)).not.toBe(TILE.SOLID);
        }
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('ケーブルトレイ(tray色rect)は天井から吊られ、吊り下げ空間は空気', () => {
    let found = 0;
    for (let cx = 0; cx < 10; cx++) {
      for (let cy = -5; cy < 5; cy++) {
        for (const op of decorateChunk(42, cx, cy)) {
          if (op.kind !== 'rect' || op.color !== PALETTE.tray) continue;
          found++;
          const wx = cx * CH + Math.floor(op.x + op.w / 2);
          const wyTray = cy * CH + Math.floor(op.y);
          expect(tileAt(42, wx, wyTray - 3)).toBe(TILE.SOLID); // 2.2上に天井面
          expect(tileAt(42, wx, wyTray)).not.toBe(TILE.SOLID);
        }
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('ケーブルトレイは水平チャンク境界の両側で一致する(継ぎ目なし)', () => {
    // 天井装飾は天井行から下へ最大3.6タイル伸びるため、天井行が境界-4..-1 にあると
    // 下側チャンクのピクセルにも描かれる。そのトレイ rect を上下両チャンクから
    // ワールド座標キーで収集し、一致することを検証する。
    // cy はワールド走査(seed=42)で「境界直上の天井行にトレイがある」ことを確認済みの行
    // (決定論なので安定)。
    let found = 0;
    for (const cy of [-57, -55, -48, -25, -10]) {
      const boundary = (cy + 1) * CH;
      for (let cx = 0; cx < 8; cx++) {
        const collect = (ccy: number) => {
          const set = new Set<string>();
          for (const op of decorateChunk(42, cx, ccy)) {
            if (op.kind !== 'rect' || op.color !== PALETTE.tray) continue;
            const wyCeil = ccy * CH + op.y - 3.2; // op.y = 天井行 + 3.2
            if (wyCeil >= boundary - 4 && wyCeil <= boundary - 1) {
              set.add(`${(cx * CH + op.x).toFixed(2)}:${wyCeil.toFixed(2)}`);
            }
          }
          return set;
        };
        const above = collect(cy);
        expect(above).toEqual(collect(cy + 1));
        found += above.size;
      }
    }
    // 恒真の排除: 境界をまたぐトレイが少なくとも1つは実在すること(決定論なので安定)
    expect(found).toBeGreaterThan(0);
  });
});

describe('歩廊の弐瓶化(段階F)', () => {
  const CH = 64;
  it('H鋼ストリンガー(stringer色のrect)は薄い床(直下が非SOLID)にのみ付く', () => {
    let found = 0;
    for (let cx = 0; cx < 8; cx++) {
      for (let cy = -4; cy < 4; cy++) {
        for (const op of decorateChunk(42, cx, cy)) {
          if (op.kind !== 'rect' || op.color !== PALETTE.stringer) continue;
          found++;
          const wx = cx * CH + Math.floor(op.x + op.w / 2);
          const wyFloor = cy * CH + Math.floor(op.y - 0.25); // rect上辺=床タイル内
          expect(tileAt(42, wx, wyFloor)).toBe(TILE.SOLID);
          expect(tileAt(42, wx, wyFloor + 1)).not.toBe(TILE.SOLID);
          expect(tileAt(42, wx, wyFloor - 1)).not.toBe(TILE.SOLID);
        }
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('手すり上桟(railTop色・非surfaceの水平line)の直下は歩ける床', () => {
    let found = 0;
    for (let cx = 0; cx < 8; cx++) {
      for (let cy = -4; cy < 4; cy++) {
        for (const op of decorateChunk(42, cx, cy)) {
          if (op.kind !== 'line' || op.color !== PALETTE.railTop || op.surface || op.y1 !== op.y2) continue;
          found++;
          const wx = cx * CH + Math.floor((op.x1 + op.x2) / 2);
          const wyFloor = cy * CH + Math.floor(op.y1 + 0.9);
          expect(tileAt(42, wx, wyFloor)).toBe(TILE.SOLID);
          expect(tileAt(42, wx, wyFloor - 1)).not.toBe(TILE.SOLID);
        }
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('ガセット(rib色fillのpoly)は必ず壁(SOLID)に接する', () => {
    let found = 0;
    for (let cx = 0; cx < 8; cx++) {
      for (let cy = -4; cy < 4; cy++) {
        for (const op of decorateChunk(42, cx, cy)) {
          if (op.kind !== 'poly' || op.color !== PALETTE.rib || !op.fill) continue;
          found++;
          // pts[0],pts[1] = 壁側の付け根(タイル境界上)。左右どちらかの隣接タイルが壁
          const wx = cx * CH + op.pts[0];
          const wy = cy * CH + Math.floor(op.pts[1]);
          const leftWall = tileAt(42, Math.floor(wx) - 1, wy) === TILE.SOLID;
          const rightWall = tileAt(42, Math.floor(wx), wy) === TILE.SOLID;
          expect(leftWall || rightWall).toBe(true);
        }
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('歩廊装飾(H鋼・錆筋)は水平チャンク境界の両側で一致する(継ぎ目なし)', () => {
    // 歩廊装飾は床行から下へ最大3.2タイル伸びるため、床行が境界-4..-1 にあると
    // 下側チャンクのピクセルにも描かれる。その床から出る stringer rect / 錆筋grad を
    // 上下両チャンクからワールド座標キーで収集し、一致することを検証する。
    // cy はワールド走査(seed=42)で「境界直上に薄い床がある」ことを確認済みの行(決定論なので安定)。
    let found = 0;
    for (const cy of [-57, -55, -53, -50, -48]) {
      const boundary = (cy + 1) * CH;
      for (let cx = 0; cx < 8; cx++) {
        const collect = (ccy: number) => {
          const set = new Set<string>();
          for (const op of decorateChunk(42, cx, ccy)) {
            let wyFloor: number;
            if (op.kind === 'rect' && op.color === PALETTE.stringer) {
              wyFloor = ccy * CH + op.y - 0.5; // op.y = 床行 + 0.5
            } else if (op.kind === 'grad' && op.h === 2.2) {
              wyFloor = ccy * CH + op.y - 1; // op.y = 床行 + 1(歩廊の錆筋。凹ベイの錆筋は h=2.6)
            } else {
              continue;
            }
            if (wyFloor >= boundary - 4 && wyFloor <= boundary - 1) {
              set.add(`${op.kind}:${(cx * CH + op.x).toFixed(2)}:${wyFloor.toFixed(2)}`);
            }
          }
          return set;
        };
        const above = collect(cy);
        expect(above).toEqual(collect(cy + 1));
        found += above.size;
      }
    }
    // 恒真の排除: 境界近傍の歩廊装飾が少なくとも1つは実在すること(決定論なので安定)
    expect(found).toBeGreaterThan(0);
  });
});
