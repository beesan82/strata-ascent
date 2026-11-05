import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, TILE } from '../world/tiles';
import { tileAt } from '../world/worldgen';
import {
  ANTECHAMBER_DEPTH, ANTECHAMBER_FADE, ANTECHAMBER_HALF_WIDTH, interfaceBottom, nearestPassage, passageX,
} from '../world/interface';
import { biomeBoundary, biomeIdForCell, BIOME_IDS, type BiomeId } from '../world/biomeCells';
import {
  antechamberNextBiome, DECOR_MARGIN, DecorCache, decorOpBounds, decorateChunk, DISTRICT_DECOR_COLORS,
  hatchSpacingAt, PALETTE, type DecorOp,
} from './decor';
import { VISUAL_BIOME } from './biome';
import { STEEL, mixHex } from './steel';

// decorateChunk は (seed,cx,cy) の純関数。段階Fの広域スキャンは同じチャンクを
// 複数テストで走査するため、seed=42 の結果をメモ化して再計算を避ける(挙動不変・高速化)。
// ※決定論テスト(別呼び出しの同値検証)はキャッシュを介さず decorateChunk を直接呼ぶこと。
const _decoCache = new Map<string, ReturnType<typeof decorateChunk>>();
function deco(cx: number, cy: number): ReturnType<typeof decorateChunk> {
  const k = `${cx},${cy}`;
  let v = _decoCache.get(k);
  if (!v) {
    v = decorateChunk(42, cx, cy);
    _decoCache.set(k, v);
  }
  return v;
}

describe('decorateChunk', () => {
  it('cycles hatch spacing consistently through negative stratum indices', () => {
    expect(hatchSpacingAt(0)).toBeCloseTo(0.26);
    expect(hatchSpacingAt(-1)).toBeCloseTo(0.4);
    expect(hatchSpacingAt(-501)).toBeCloseTo(0.33);
    expect(hatchSpacingAt(-1001)).toBeCloseTo(0.26);
  });

  it('同一シード・同一チャンクなら同一の装飾リスト(決定論)', () => {
    expect(decorateChunk(42, 1, 1)).toEqual(decorateChunk(42, 1, 1));
  });

  it('装飾の種類が一通り出現する(広域統計)', () => {
    const kinds = new Set<string>();
    const colors = new Set<string>();
    for (let cx = 0; cx < 4; cx++) {
      for (let cy = -2; cy < 2; cy++) {
        for (const op of deco(cx, cy)) {
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
    for (const op of deco(1, 1)) {
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
        const ops = deco(1, 1).filter(
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
        for (const op of deco(cx, cy)) {
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
      for (const op of deco(cx, 1)) {
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
      for (const op of deco(cx, 1)) {
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
      for (const op of deco(cx, 1)) {
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

describe('前室の先行表示(ゾーン化 段階 3、設計 §3-2)', () => {
  it('antechamberNextBiome: 前室の帯の中では上の層の地区、外では null', () => {
    const seed = 42;
    const cell = -1;
    const bottom = interfaceBottom(seed, cell);
    const px = passageX(seed, cell, 0);
    // 孔の真下(前室の中心)は次の地区(上の層)を返す
    expect(antechamberNextBiome(seed, px, bottom + 10)).toBe(biomeIdForCell(seed, cell - 1));
    // 帯より下(圧縮帯以深)では null
    expect(antechamberNextBiome(seed, px, bottom + ANTECHAMBER_DEPTH + 30)).toBeNull();
    // 孔から十分に遠い場所(最寄りの孔まで 160 超)では null
    let farX = px + 200;
    while (Math.abs(farX - nearestPassage(seed, cell, farX).x) <= ANTECHAMBER_HALF_WIDTH + ANTECHAMBER_FADE) farX += 8;
    expect(antechamberNextBiome(seed, farX, bottom + 10)).toBeNull();
  });

  it('前室の床セグメントに、次の地区の accent で染めた配管か帯が出る', () => {
    const seed = 42;
    const cell = -1;
    const wy = interfaceBottom(seed, cell) + ANTECHAMBER_DEPTH; // 前室の底の床の行
    const accent = VISUAL_BIOME[biomeIdForCell(seed, cell - 1)].accent;
    const expected = new Set([mixHex(PALETTE.pipe, accent, 0.5), mixHex(STEEL.post, accent, 0.55)]);
    let found = 0;
    for (const cy of [Math.floor(wy / 64), Math.floor(wy / 64) + 1]) {
      for (let cx = -4; cx < 4; cx++) {
        for (const op of decorateChunk(seed, cx, cy)) {
          if (op.kind !== 'line' || !expected.has(op.color)) continue;
          const wyOp = cy * 64 + op.y1;
          if (Math.abs(wyOp - wy) < 1.6) found++;
        }
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('前室の accent リベットは前室の帯の中だけに出る', () => {
    const seed = 42;
    const colorToBiome = new Map(BIOME_IDS.map((id) => [mixHex(PALETTE.rivet, VISUAL_BIOME[id].accent, 0.6), id]));
    let found = 0;
    for (let cx = -2; cx < 3; cx++) {
      for (let cy = -7; cy < 2; cy++) {
        for (const op of decorateChunk(seed, cx, cy)) {
          if (op.kind !== 'dot') continue;
          const id = colorToBiome.get(op.color);
          if (!id) continue;
          const wx = cx * 64 + Math.floor(op.x);
          const wy = cy * 64 + Math.floor(op.y);
          expect(antechamberNextBiome(seed, wx, wy)).toBe(id);
          found++;
        }
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});

describe('地区固有の小物・装飾(ゾーン化 段階 3)', () => {
  /** seed 42 で地区 id のセルの中央付近 3x3 チャンクの装飾を集める */
  function opsInDistrict(id: BiomeId): DecorOp[] {
    const seed = 42;
    let cell = 0;
    while (biomeIdForCell(seed, cell) !== id) cell--;
    const midY = Math.round((biomeBoundary(seed, cell) + biomeBoundary(seed, cell + 1)) / 2);
    const cy = Math.floor(midY / CHUNK_SIZE);
    const out: DecorOp[] = [];
    for (let cx = -1; cx < 2; cx++) {
      for (let cyy = cy - 1; cyy <= cy + 1; cyy++) out.push(...decorateChunk(seed, cx, cyy));
    }
    return out;
  }

  it('居住区画には残光の窓灯、電力区にはケーブル束(真っ直ぐな線)、精錬区には煤が出る', () => {
    const hab = opsInDistrict('habitation');
    expect(hab.some((op) => op.kind === 'dot' && op.color === DISTRICT_DECOR_COLORS.habitationWindow)).toBe(true);
    const power = opsInDistrict('power');
    expect(power.some((op) => op.kind === 'line' && op.color === PALETTE.cable)).toBe(true);
    const foundry = opsInDistrict('foundry');
    expect(foundry.some((op) => op.kind === 'grad' && op.stops[0][1] === DISTRICT_DECOR_COLORS.foundrySoot)).toBe(true);
    expect(foundry.some((op) => op.kind === 'dot' && op.color === DISTRICT_DECOR_COLORS.foundryEmber)).toBe(true);
  });

  it('廃棄沈殿層には錆色の残骸、生体異物区には根、大空洞水域には結露が出る', () => {
    const disposal = opsInDistrict('disposal');
    expect(disposal.some((op) => op.kind === 'poly' && op.fill && op.color === DISTRICT_DECOR_COLORS.disposalDebris)).toBe(true);
    const biomech = opsInDistrict('biomech');
    expect(biomech.some((op) => op.kind === 'poly' && op.color === DISTRICT_DECOR_COLORS.biomechRoot)).toBe(true);
    const water = opsInDistrict('waterVoid');
    expect(water.some((op) => op.kind === 'dot' && op.color === DISTRICT_DECOR_COLORS.waterCondensation)).toBe(true);
  });

  it('地区固有の小物は他の地区には出ない(寒鋼基層は基準 = 固有物なし)', () => {
    const cold = opsInDistrict('coldSteel');
    expect(cold.some((op) => op.kind === 'dot' && op.color === DISTRICT_DECOR_COLORS.habitationWindow)).toBe(false);
    expect(cold.some((op) => op.kind === 'line' && op.color === PALETTE.cable)).toBe(false);
    expect(cold.some((op) => op.kind === 'poly' && op.color === DISTRICT_DECOR_COLORS.biomechRoot)).toBe(false);
    expect(cold.some((op) => op.kind === 'dot' && op.color === DISTRICT_DECOR_COLORS.waterCondensation)).toBe(false);
  });
});

describe('壁の弐瓶化(段階F)', () => {
  const CH = 64;
  it('凹ベイ(bay色のrect)は完全内部領域にのみ彫られる', () => {
    let found = 0;
    for (let cx = 0; cx < 6; cx++) {
      for (let cy = -3; cy < 3; cy++) {
        for (const op of deco(cx, cy)) {
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
        for (const op of deco(cx, cy)) {
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
          for (const op of deco(cx, ccy)) {
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
        for (const op of deco(cx, cy)) {
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
        for (const op of deco(cx, cy)) {
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
    // (決定論なので安定。地区化段階1の地形変更で対象行が移ったため再走査して更新した)。
    let found = 0;
    for (const cy of [-105, -75, -53, -13, 7]) {
      const boundary = (cy + 1) * CH;
      for (let cx = 0; cx < 8; cx++) {
        const collect = (ccy: number) => {
          const set = new Set<string>();
          for (const op of deco(cx, ccy)) {
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
        for (const op of deco(cx, cy)) {
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
        for (const op of deco(cx, cy)) {
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
        for (const op of deco(cx, cy)) {
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
          for (const op of deco(cx, ccy)) {
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

describe('DecorCache', () => {
  it('焼き込みで描く非surface装飾だけを返し、同じチャンクは再計算しない', () => {
    const cache = new DecorCache(42);
    const ops = cache.get(1, 1);
    expect(ops).toEqual(decorateChunk(42, 1, 1).filter((op) => !op.surface));
    expect(cache.get(1, 1)).toBe(ops);
  });

  it('evictFarFrom はチェビシェフ距離 radius を超えるチャンクだけ破棄する', () => {
    const cache = new DecorCache(42);
    const near = cache.get(0, 0);
    const far = cache.get(5, 0);
    cache.evictFarFrom(0, 0, 4);
    expect(cache.get(0, 0)).toBe(near);
    expect(cache.get(5, 0)).not.toBe(far);
  });

  it('has は計算済みのチャンクだけ true', () => {
    const cache = new DecorCache(42);
    expect(cache.has(2, 2)).toBe(false);
    cache.get(2, 2);
    expect(cache.has(2, 2)).toBe(true);
  });

  it('元地形の配列(周囲 DECOR_MARGIN 込み)を渡しても、渡さない場合と同じ装飾になる', () => {
    const n = CHUNK_SIZE + DECOR_MARGIN * 2;
    for (const [cx, cy] of [[1, 1], [-2, -1]]) {
      const buf = new Uint8Array(n * n);
      for (let ly = 0; ly < n; ly++)
        for (let lx = 0; lx < n; lx++)
          buf[ly * n + lx] = tileAt(42, cx * CHUNK_SIZE + lx - DECOR_MARGIN, cy * CHUNK_SIZE + ly - DECOR_MARGIN);
      expect(decorateChunk(42, cx, cy, buf)).toEqual(decorateChunk(42, cx, cy));
    }
  });
});

describe('decorOpBounds', () => {
  const px = 1 / 16;
  it('線は太さ(最小1px)と角の尖りぶん広げた外接矩形', () => {
    const b = decorOpBounds({ kind: 'line', x1: 1, y1: 2, x2: 3, y2: 2, w: 0.1, color: '#000' }, px);
    expect(b.x0).toBeLessThanOrEqual(1 - 0.05);
    expect(b.x1).toBeGreaterThanOrEqual(3 + 0.05);
    expect(b.y0).toBeLessThanOrEqual(2 - 0.05);
    expect(b.y1).toBeGreaterThanOrEqual(2 + 0.05);
  });

  it('負の幅の矩形も正しい向きに直す', () => {
    const b = decorOpBounds({ kind: 'rect', x: 5, y: 5, w: -2, h: 1, color: '#000' }, px);
    expect(b.x0).toBeLessThanOrEqual(3);
    expect(b.x1).toBeGreaterThanOrEqual(5);
    expect(b.x1 - b.x0).toBeLessThan(2.5);
  });

  it('多角形と点も全点・半径を含む', () => {
    const p = decorOpBounds({ kind: 'poly', pts: [0, 0, 4, 1, 2, 3], w: 0.05, color: '#000', fill: true }, px);
    expect([p.x0 <= 0, p.y0 <= 0, p.x1 >= 4, p.y1 >= 3]).toEqual([true, true, true, true]);
    const d = decorOpBounds({ kind: 'dot', x: 1, y: 1, r: 0.01, color: '#000' }, px);
    expect(d.x0).toBeLessThanOrEqual(1 - px); // 半径は最小1px
    expect(d.y1).toBeGreaterThanOrEqual(1 + px);
  });

  it('実際の装飾の全命令で有限の矩形を返す', () => {
    for (const op of decorateChunk(42, 1, 1)) {
      const b = decorOpBounds(op, px);
      expect(Number.isFinite(b.x0 + b.y0 + b.x1 + b.y1)).toBe(true);
      expect(b.x1).toBeGreaterThanOrEqual(b.x0);
      expect(b.y1).toBeGreaterThanOrEqual(b.y0);
    }
  });
});
