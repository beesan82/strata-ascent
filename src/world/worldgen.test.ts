import { describe, expect, it, vi } from 'vitest';
import { Player } from '../entities/player';
import {
  BIOME_IDS,
  biomeBoundary,
  biomeCellAt,
  biomeIdForCell,
  type BiomeId,
} from './biomeCells';
import { terrainProfileFor } from './biomeTerrain';
import { hash2 } from './noise';
import { CHUNK_SIZE, isSolid, TILE } from './tiles';
import { SPAWN_OFFSET_FROM_PASSAGE, findSpawn, generateChunk, isHardAt, noiseTileAt, tileAt, tileAtLive } from './worldgen';
import { girderY, isTowerFamily, landmarkAt, landmarkTileAt, rampTopY, shaftLadderX, towerSpec, type Landmark } from './landmark';
import { restPointAt, restPointTileAt } from './restpoint';
import { Destruction } from './destruction';
import { ANTECHAMBER_DEPTH, groupLadderX, interfaceBottom, interfaceTileAt, interfaceTop, passageX, terrainModsAt } from './interface';

/** 界面の地物・前室の内側・大構造・休憩点の箱ではノイズ梯子の不変条件を適用しない(大構造は梯子列を切ってよい) */
function inInterfaceZone(seed: number, x: number, y: number): boolean {
  return interfaceTileAt(seed, x, y) !== null || !!terrainModsAt(seed, x, y)?.suppressLadder
    || landmarkTileAt(seed, x, y) !== null || restPointTileAt(seed, x, y) !== null;
}

function representativeBiomeCenter(seed: number, target: BiomeId): number {
  for (let cell = -100; cell <= 100; cell++) {
    if (biomeIdForCell(seed, cell) !== target) continue;
    const start = biomeBoundary(seed, cell);
    const end = biomeBoundary(seed, cell + 1);
    const center = Math.floor((start + end) / 2);
    if (biomeCellAt(seed, center) === cell) return center;
  }
  throw new Error(`No representative cell found for ${target}`);
}

function floorGapRate(seed: number, biomeId: BiomeId): number {
  const centerY = representativeBiomeCenter(seed, biomeId);
  const { floorSpacing } = terrainProfileFor(biomeId);
  let floorTiles = 0;
  let gaps = 0;
  for (let y = centerY - 120; y < centerY + 120; y++) {
    if (((y % floorSpacing) + floorSpacing) % floorSpacing !== 0) continue;
    for (let x = -512; x < 512; x++) {
      floorTiles++;
      if (noiseTileAt(seed, x, y) !== TILE.SOLID) gaps++;
    }
  }
  return gaps / floorTiles;
}

function countBiomeTiles(seed: number, biomeId: BiomeId): Record<'air' | 'solid' | 'ladder', number> {
  const centerY = representativeBiomeCenter(seed, biomeId);
  const counts = { air: 0, solid: 0, ladder: 0 };
  for (let y = centerY - 96; y < centerY + 96; y++) {
    for (let x = -256; x < 256; x++) {
      const tile = noiseTileAt(seed, x, y);
      if (tile === TILE.AIR) counts.air++;
      else if (tile === TILE.SOLID) counts.solid++;
      else if (tile === TILE.LADDER) counts.ladder++;
    }
  }
  return counts;
}

describe('generateChunk', () => {
  it('同一シード・同一チャンク座標なら完全に同じ出力(決定論)', () => {
    const a = generateChunk(42, 3, -2);
    const b = generateChunk(42, 3, -2);
    expect(a).toEqual(b);
  });

  it('シードが違えば出力が変わる', () => {
    const a = generateChunk(1, 0, 0);
    const b = generateChunk(2, 0, 0);
    expect(a).not.toEqual(b);
  });

  it('チャンクは64x64タイルで、tileAtと一致する', () => {
    const chunk = generateChunk(42, 1, 1);
    expect(chunk.length).toBe(CHUNK_SIZE * CHUNK_SIZE);
    for (let ty = 0; ty < CHUNK_SIZE; ty += 7) {
      for (let tx = 0; tx < CHUNK_SIZE; tx += 7) {
        expect(chunk[ty * CHUNK_SIZE + tx]).toBe(
          tileAt(42, 1 * CHUNK_SIZE + tx, 1 * CHUNK_SIZE + ty),
        );
      }
    }
  });

  it('matches tileAt across signed biome boundaries', () => {
    const seed = 42;
    for (let cell = -10; cell <= 10; cell++) {
      const edge = biomeBoundary(seed, cell);
      for (let y = edge - 1; y <= edge + 1; y++) {
        const cy = Math.floor(y / CHUNK_SIZE);
        const chunk = generateChunk(seed, 2, cy);
        const ty = y - cy * CHUNK_SIZE;
        for (let tx = 0; tx < CHUNK_SIZE; tx += 7) {
          expect(chunk[ty * CHUNK_SIZE + tx]).toBe(
            tileAt(seed, 2 * CHUNK_SIZE + tx, y),
          );
        }
      }
    }
  });
});

describe('tileAt', () => {
  // 生成パラメータを調整した場合、以下の統計的テストは閾値の見直しが必要になることがある。
  // 失敗したら盲目的にリトライせず、生成結果を目視(またはカウント出力)して原因を確認すること。
  it('広域(256x128タイル)には空気・地形・梯子がすべて存在する', () => {
    for (const seed of [1, 42, 20260711]) {
      const counts = { air: 0, solid: 0, ladder: 0 };
      for (let y = -128; y < 0; y++) {
        for (let x = 0; x < 256; x++) {
          const t = tileAt(seed, x, y);
          if (t === TILE.AIR) counts.air++;
          else if (t === TILE.SOLID) counts.solid++;
          else if (t === TILE.LADDER) counts.ladder++;
        }
      }
      expect(counts.air).toBeGreaterThan(0);
      expect(counts.solid).toBeGreaterThan(0);
      expect(counts.ladder).toBeGreaterThan(0);
    }
  });

  it('梯子列は質量ノイズ(柱・壁塊)にも巨大空洞にも分断されない(全行LADDER)', () => {
    // 回帰テスト: 梯子判定は巨大空洞・質量ノイズ・床のいずれよりも先に行われるため、
    // 梯子列は空洞の有無に関わらず全行LADDERであることを固定する
    // (将来のパラメータ調整で退行させない)。
    // ladderX は実装と同じ groupLadderX(interface.ts)で求める。
    // 「梯子は常にどんな地形も貫通する」性質を固定する。
    const TEST_RANGE_UNIT = 8;
    for (const seed of [1, 42, 20260711]) {
      for (let group = 0; group < 8; group++) {
        // The same signed-X column must be a ladder throughout all Y values.
        for (let y = -TEST_RANGE_UNIT * 40; y < TEST_RANGE_UNIT * 41; y++) {
          const ladderX = groupLadderX(seed, group * 32);
          if (inInterfaceZone(seed, ladderX, y)) continue;
          expect(tileAt(seed, ladderX, y)).toBe(TILE.LADDER);
        }
      }
    }
  });

  it('includes deterministic gaps in the signed band containing Y=-8', () => {
    // Sample the band containing Y=-8; some floor segments should deterministically be AIR.
    let gaps = 0;
    for (let x = 0; x < 512; x++) {
      if (tileAt(42, x, -8) !== TILE.SOLID) gaps++;
    }
    expect(gaps).toBeGreaterThan(0);
  });
});

describe('biome-driven terrain', () => {
  const seed = 20260711;

  it('contains air, solid, and ladders at a representative center for every visual biome', () => {
    for (const biomeId of BIOME_IDS) {
      const counts = countBiomeTiles(seed, biomeId);
      expect(counts.air).toBeGreaterThan(0);
      expect(counts.solid).toBeGreaterThan(0);
      expect(counts.ladder).toBeGreaterThan(0);
    }
  });

  it('makes water void airier and habitation denser than cold steel', () => {
    const waterVoid = countBiomeTiles(seed, 'waterVoid');
    const coldSteel = countBiomeTiles(seed, 'coldSteel');
    const habitation = countBiomeTiles(seed, 'habitation');

    expect(waterVoid.air).toBeGreaterThan(coldSteel.air);
    expect(waterVoid.air).toBeGreaterThan(habitation.air);
    expect(habitation.solid).toBeGreaterThan(waterVoid.solid);
  });

  it('makes disposal floor rows gap more often than cold steel', () => {
    expect(floorGapRate(seed, 'disposal')).toBeGreaterThan(floorGapRate(seed, 'coldSteel'));
  });

  it('keeps a deterministic ladder column continuous through every sampled biome boundary', () => {
    const ladderColumns = Array.from({ length: 3 }, (_, group) =>
      group * 32 + Math.floor(hash2(seed + 404, group, 0) * 32),
    );

    for (let cell = -10; cell <= 10; cell++) {
      const edge = biomeBoundary(seed, cell);
      // 境界の両側(板の上面 -1 と板の下面 + 48 + 1)で同じ列が LADDER
      const ys = [edge - 1, interfaceBottom(seed, cell) + ANTECHAMBER_DEPTH + 1];
      expect(ladderColumns.some((x) =>
        ys.every((y) => inInterfaceZone(seed, x, y) || noiseTileAt(seed, x, y) === TILE.LADDER)
          && ys.some((y) => !inInterfaceZone(seed, x, y)),
      )).toBe(true);
    }
  });

  it('uses the same continuous ladder rule in signed X groups', () => {
    for (const group of [-3, -2, -1]) {
      const ladderX = group * 32 + Math.floor(hash2(seed + 404, group, 0) * 32);
      for (const y of [-900, -1, 0, 900]) {
        if (inInterfaceZone(seed, ladderX, y)) continue;
        expect(noiseTileAt(seed, ladderX, y)).toBe(TILE.LADDER);
      }
    }
  });
});

describe('findSpawn', () => {
  const seeds = [1, 42, 20260711];
  it('スポーンは固体の中ではなく、cell 0 の前室の中(孔の左 12 タイル)', () => {
    for (const seed of seeds) {
      const { x, y } = findSpawn(seed);
      expect(isSolid(tileAt(seed, Math.floor(x), Math.floor(y)))).toBe(false);
      expect(isSolid(tileAt(seed, Math.floor(x), Math.floor(y) + 1))).toBe(false);
      expect(isSolid(tileAt(seed, Math.floor(x), Math.floor(y) + 2))).toBe(true);
      const px = passageX(seed, 0, 0);
      // 列が 32 タイル梯子列に当たる場合は左へずらす(最大 4)
      const sx = Math.floor(x);
      expect(px - sx).toBeGreaterThanOrEqual(SPAWN_OFFSET_FROM_PASSAGE);
      expect(px - sx).toBeLessThanOrEqual(SPAWN_OFFSET_FROM_PASSAGE + 4);
      expect(groupLadderX(seed, sx)).not.toBe(sx);
      expect(y).toBeGreaterThan(interfaceBottom(seed, 0));
      expect(y).toBeLessThan(interfaceBottom(seed, 0) + ANTECHAMBER_DEPTH);
    }
  });
  it('seed 1..300 の全てで前室の床の上に立ち、フォールバックを使わない', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (let seed = 1; seed <= 300; seed++) {
        const { x, y } = findSpawn(seed);
        const sx = Math.floor(x), fy = Math.floor(y);
        expect(isSolid(tileAt(seed, sx, fy))).toBe(false);
        expect(isSolid(tileAt(seed, sx, fy + 1))).toBe(false);
        expect(isSolid(tileAt(seed, sx, fy + 2))).toBe(true);
      }
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('孔の到達可能性', () => {
  it('前室の底から孔の梯子を登り切ると板の上面に立てる(Player 結合)', () => {
    for (const seed of [1, 42, 20260711]) for (const cell of [0, -1, 2]) {
      const top = interfaceTop(seed, cell), bottom = interfaceBottom(seed, cell);
      const px = passageX(seed, cell, 0);
      const tiles = (tx: number, ty: number) => tileAt(seed, tx, ty);
      const player = new Player(px + 0.125, bottom + ANTECHAMBER_DEPTH - 1.75 - 0.05);
      const up = { left: false, right: false, jump: false, up: true, down: false };
      const idle = { ...up, up: false };
      const right = { ...idle, right: true };
      for (let i = 0; i < 3600; i++) player.update(up, 1 / 60, tiles);
      // 梯子の上端(top-4)にぶら下がった状態から右へ歩いて板の上面に降りる
      expect(player.body.y + player.body.h).toBeLessThanOrEqual(top - 2);
      for (let i = 0; i < 60; i++) player.update(right, 1 / 60, tiles);
      for (let i = 0; i < 60; i++) player.update(idle, 1 / 60, tiles);
      const feet = player.body.y + player.body.h;
      expect(feet).toBeLessThanOrEqual(top + 1e-6);
      expect(feet).toBeGreaterThan(top - 1 / 16 - 1e-6);
      expect(player.body.onGround).toBe(true);
    }
  });
  it('板の上面から上へ続く 32 タイル梯子列が見晴らし台の中にある、または板の上面に接している', () => {
    for (const seed of [1, 42, 20260711]) for (const cell of [0, -1, 2]) {
      const top = interfaceTop(seed, cell), px = passageX(seed, cell, 0);
      let found = false;
      for (let x = px - 12; x < px + 72 && !found; x++) {
        found = tileAt(seed, x, top - 1) === TILE.LADDER && tileAt(seed, x, top - 9) === TILE.LADDER;
      }
      expect(found).toBe(true);
    }
  });
});

describe('tileAt 合成(段階2)', () => {
  it('施設が無い座標では tileAt は noiseTileAt と一致する', () => {
    for (const [x, y] of [[0, 0], [63, -8], [200, -520], [-40, 130]] as const) {
      expect(tileAt(42, x, y)).toBe(noiseTileAt(42, x, y));
    }
  });

  it('ノイズが LADDER のタイルは tileAt でも必ず LADDER(上昇路保持の不変条件)', () => {
    let checked = 0;
    for (let y = -200; y < 0 && checked < 50; y++) {
      for (let x = 0; x < 512 && checked < 50; x++) {
        if (!inInterfaceZone(42, x, y) && noiseTileAt(42, x, y) === TILE.LADDER) {
          expect(tileAt(42, x, y)).toBe(TILE.LADDER);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('施設統合後の到達可能性', () => {
  it('ノイズLADDER保持: 施設領域でもノイズの梯子は残る(既存の上昇保証)', () => {
    let checked = 0;
    for (let y = -400; y < 0 && checked < 80; y++) {
      for (let x = 0; x < 1024 && checked < 80; x++) {
        if (!inInterfaceZone(42, x, y) && noiseTileAt(42, x, y) === TILE.LADDER) {
          expect(tileAt(42, x, y)).toBe(TILE.LADDER);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('findSpawn はSOLIDの中ではない(施設統合後も安全)', () => {
    for (const seed of [1, 42, 20260711]) {
      const { x, y } = findSpawn(seed);
      expect(tileAt(seed, Math.floor(x), Math.floor(y))).not.toBe(TILE.SOLID);
    }
  });
});

describe('段階4b 統合', () => {
  it('ノイズLADDER保持は維持', () => {
    let checked = 0;
    for (let y = -400; y < 0 && checked < 60; y++)
      for (let x = 0; x < 1024 && checked < 60; x++)
        if (!inInterfaceZone(42, x, y) && noiseTileAt(42, x, y) === TILE.LADDER) { expect(tileAt(42, x, y)).toBe(TILE.LADDER); checked++; }
    expect(checked).toBeGreaterThan(0);
  });
  it('findSpawn は SOLID の中でない', () => {
    for (const seed of [1, 42, 20260711]) {
      const { x, y } = findSpawn(seed);
      expect(tileAt(seed, Math.floor(x), Math.floor(y))).not.toBe(TILE.SOLID);
    }
  });
});

describe('tileAtLive(破壊差分込み)', () => {
  it('破壊ストアが空なら tileAt と完全一致(回帰なし)', () => {
    const d = new Destruction();
    for (const [x, y] of [[0, 0], [63, -8], [200, -520], [-40, 130]] as const) {
      expect(tileAtLive(42, x, y, d)).toBe(tileAt(42, x, y));
    }
  });
  it('破壊された座標は必ず AIR(生成が何であれ)', () => {
    const d = new Destruction();
    // SOLID なタイルを探して破壊
    let found = false;
    for (let y = -50; y < 0 && !found; y++)
      for (let x = 0; x < 200 && !found; x++)
        if (tileAt(42, x, y) === TILE.SOLID) { d.bore(x, y, 0, 0, 0, (ax, ay) => tileAt(42, ax, ay)); found = true;
          expect(tileAtLive(42, x, y, d)).toBe(TILE.AIR); }
    expect(found).toBe(true);
  });
  it('未生成チャンク越しの bore でも界面の板(HARD)は破壊されない(生成+applyTo 後も、tileAtLive でも HARD)', () => {
    const seed = 20260711;
    const x = passageX(seed, 0, 0) - 100;
    const y = interfaceTop(seed, 0) + 10;
    expect(tileAt(seed, x, y)).toBe(TILE.HARD);
    const d = new Destruction();
    // 発射時は未生成扱い(tiles=undefined)。述語は main.ts と同じ界面判定
    d.bore(x - 5, y, 0, 10, 1, () => undefined, (ax, ay) => interfaceTileAt(seed, ax, ay) === TILE.HARD);
    expect(d.isDestroyed(x, y)).toBe(false);
    const cx = Math.floor(x / CHUNK_SIZE), cy = Math.floor(y / CHUNK_SIZE);
    const chunk = generateChunk(seed, cx, cy);
    d.applyTo(chunk, cx, cy);
    expect(chunk[(y - cy * CHUNK_SIZE) * CHUNK_SIZE + (x - cx * CHUNK_SIZE)]).toBe(TILE.HARD);
    expect(tileAtLive(seed, x, y, d)).toBe(TILE.HARD);
  });
  it('破壊マスクが HARD の位置に立っていても tileAtLive は HARD を返す', () => {
    const seed = 20260711;
    const x = passageX(seed, 0, 0) - 100;
    const y = interfaceTop(seed, 0) + 10;
    const d = new Destruction();
    d.bore(x, y, 0, 0, 0, () => undefined); // 述語なし=旧挙動で盲目的に記録
    expect(d.isDestroyed(x, y)).toBe(true);
    expect(tileAtLive(seed, x, y, d)).toBe(TILE.HARD);
  });
});

describe('界面と前室の合成', () => {
  const seeds = [1, 42, 20260711];
  it('tileAt は界面タイルを最優先にする(施設・メガ施設の上でも)', () => {
    for (const seed of seeds) for (let cell = -4; cell <= 4; cell++) {
      const top = interfaceTop(seed, cell);
      for (let x = -2000; x <= 2000; x += 97) {
        const iface = interfaceTileAt(seed, x, top + 3);
        expect(iface).not.toBe(null);
        if (landmarkTileAt(seed, x, top + 3) !== null) continue; // 崩落の裂け目・塔の縦坑は板に勝つ
        expect(tileAt(seed, x, top + 3)).toBe(iface);
      }
    }
  });
  it('前室の底は連続した床(梯子列は通す)、前室の内側に梯子列も施設の壁もない', () => {
    for (const seed of seeds) for (let cell = -2; cell <= 2; cell++) for (const k of [-1, 0, 2]) {
      const bottom = interfaceBottom(seed, cell), px = passageX(seed, cell, k);
      for (let x = px - 120; x <= px + 120; x++) {
        if (landmarkTileAt(seed, x, bottom + ANTECHAMBER_DEPTH) !== null) continue; // 大構造(縦坑・斜路・橋)が前室の床を横切る
        const t = tileAt(seed, x, bottom + ANTECHAMBER_DEPTH);
        expect(t === TILE.SOLID || t === TILE.LADDER || t === TILE.HARD).toBe(true);
      }
      for (let x = px - 119; x < px + 120; x++) {
        if (x === px) continue;
        for (let y = bottom; y < bottom + ANTECHAMBER_DEPTH; y += 5) {
          if (interfaceTileAt(seed, x, y) !== null) continue; // 大穴の最下行(dy=0)は界面が AIR を返す
          if (landmarkTileAt(seed, x, y) !== null) continue; // 崩落の楔は前室に食い込む
          expect(tileAt(seed, x, y)).not.toBe(TILE.LADDER);
          expect(tileAt(seed, x, y)).toBe(noiseTileAt(seed, x, y)); // 施設オーバーレイが効いていない
        }
      }
    }
  });
  it('前室の内側は空気率 0.9 以上、圧縮帯は通常より固体が多い', () => {
    const seed = 20260711, cell = 0;
    const bottom = interfaceBottom(seed, cell), px = passageX(seed, cell, 0);
    let air = 0, n = 0;
    for (let y = bottom + 1; y < bottom + ANTECHAMBER_DEPTH; y++) for (let x = px - 110; x <= px + 110; x++) {
      n++; if (tileAt(seed, x, y) !== TILE.SOLID) air++;
    }
    expect(air / n).toBeGreaterThan(0.9);
    const solidRatio = (y0: number, y1: number, x0: number) => {
      let s = 0, m = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x0 + 200; x++) { m++; if (noiseTileAt(seed, x, y) === TILE.SOLID) s++; }
      return s / m;
    };
    // 参照は同じ X 範囲で圧縮帯の下の行(同じ景観セル・同じプロファイル)。X をずらすと隣の孔の圧縮帯に入りうる
    const compressed = solidRatio(bottom + 50, bottom + 108, px - 100);
    const reference = solidRatio(bottom + 120, bottom + 178, px - 100);
    expect(compressed).toBeGreaterThan(reference);
  });
});

describe('段階4: 大構造と休憩点の合成', () => {
  const seeds = [1, 42, 20260711];
  const landmarks = (): { seed: number; lm: Landmark }[] =>
    seeds.flatMap((seed) => [-3, -2, -1, 0, 1, 2, 3].flatMap((cell) =>
      [-4, -3, -2, -1, 0, 1, 2, 3, 4].flatMap((k) => {
        const lm = landmarkAt(seed, cell, k);
        return lm ? [{ seed, lm }] : [];
      })));
  it('塔系の縦坑は板を貫き、殻は板の上の層・板の中・層の中で HARD。孔・見晴らし台・大穴は塔系に勝つ', () => {
    let towers = 0;
    for (const { seed, lm } of landmarks()) {
      if (!isTowerFamily(lm.kind)) continue;
      towers++;
      const spec = towerSpec(lm.kind)!;
      for (let y = lm.floor - 1; y >= lm.top - 4; y--) expect(tileAt(seed, shaftLadderX(lm, y), y)).toBe(TILE.LADDER);
      expect(tileAt(seed, lm.x - (spec.halfWidth - 4), lm.top + 5)).toBe(TILE.HARD);
      expect(tileAt(seed, lm.x - (spec.halfWidth - 4), lm.bottom + 10)).toBe(TILE.HARD);
      if (lm.kind !== 'vertebra') expect(tileAt(seed, lm.x + 1, lm.top + 5)).toBe(TILE.AIR);
      // 板の下(cell+1)の孔・見晴らし台・大穴と塔系の X が重なる座標は界面のタイルのまま
      const px1 = passageX(seed, lm.cell + 1, lm.k);
      for (let x = px1 - 12; x < px1 + 72; x++) if (Math.abs(x - lm.x) < spec.halfWidth) {
        for (const y of [lm.floor - 1, lm.floor - 8]) {
          expect(tileAt(seed, x, y)).toBe(interfaceTileAt(seed, x, y));
        }
      }
    }
    expect(towers).toBeGreaterThan(0);
  });
  it('崩落の裂け目は板を開け、斜路は HARD、斜路の上は空気', () => {
    let collapses = 0;
    for (const { seed, lm } of landmarks()) {
      if (lm.kind !== 'collapse') continue;
      collapses++;
      expect(tileAt(seed, lm.gapLeft + 2, lm.top + 1)).toBe(TILE.AIR);
      for (let x = lm.gapLeft; x < lm.gapRight; x += 7) {
        const r = rampTopY(lm, x);
        expect(tileAt(seed, x, r)).toBe(TILE.HARD);
        if (r > lm.top) expect(tileAt(seed, x, r - 1)).toBe(TILE.AIR);
      }
    }
    expect(collapses).toBeGreaterThan(0);
  });
  it('休憩点は箱の中で tileAt === restPointTileAt(メガ施設・施設より優先)', () => {
    for (const seed of seeds) for (const cell of [-1, 0, 2]) for (const k of [-1, 0, 1]) {
      const rp = restPointAt(seed, cell, k);
      for (let x = rp.left; x <= rp.right; x++) for (let y = rp.floorY - 13; y <= rp.floorY; y++) {
        if (landmarkTileAt(seed, x, y) !== null) continue; // 稀な塔との重なりは大構造が勝つ
        expect(tileAt(seed, x, y)).toBe(restPointTileAt(seed, x, y));
      }
    }
  });
  it('isHardAt は tileAt === HARD と同値(板・塔系の殻・斜路・橋床・柱・普通の SOLID)', () => {
    for (const { seed, lm } of landmarks()) {
      const pts: [number, number][] = isTowerFamily(lm.kind)
        ? [[lm.x - (towerSpec(lm.kind)!.halfWidth - 4), lm.bottom + 10], [shaftLadderX(lm, lm.bottom + 10), lm.bottom + 10], [lm.x - 200, lm.top + 3], [lm.x - (towerSpec(lm.kind)!.halfWidth - 4), lm.floor - 1]]
        : lm.kind === 'collapse'
          ? [[lm.gapLeft + 4, rampTopY(lm, lm.gapLeft + 4)], [lm.gapLeft + 4, lm.top + 1], [lm.gapLeft - 50, lm.top + 3]]
          : lm.kind === 'girder'
            ? [[lm.gapLeft + 4, girderY(lm)], [lm.gapLeft + 4, girderY(lm) - 5], [lm.gapLeft - 50, lm.top + 3]]
            : [[lm.x, lm.bottom + 20], [lm.gapLeft + 1, lm.bottom + 20], [lm.gapLeft - 50, lm.top + 3]];
      for (const [x, y] of pts) expect(isHardAt(seed, x, y)).toBe(tileAt(seed, x, y) === TILE.HARD);
    }
    let solids = 0;
    for (let y = 40; y < 300 && solids < 20; y += 13) for (let x = 0; x < 400; x += 17) if (tileAt(42, x, y) === TILE.SOLID) { solids++; expect(isHardAt(42, x, y)).toBe(false); }
    expect(solids).toBeGreaterThan(0);
  });
  it('bore は塔系の殻の HARD を残す(未生成でも、生成+applyTo 後も、tileAtLive でも)', () => {
    const { seed, lm } = landmarks().find((e) => isTowerFamily(e.lm.kind))!;
    const x = lm.x - (towerSpec(lm.kind)!.halfWidth - 4), y = lm.bottom + 10;
    expect(tileAt(seed, x, y)).toBe(TILE.HARD);
    const d = new Destruction();
    d.bore(x - 5, y, 0, 10, 1, () => undefined, (ax, ay) => isHardAt(seed, ax, ay));
    expect(d.isDestroyed(x, y)).toBe(false);
    const cx = Math.floor(x / CHUNK_SIZE), cy = Math.floor(y / CHUNK_SIZE);
    const chunk = generateChunk(seed, cx, cy);
    d.applyTo(chunk, cx, cy);
    expect(chunk[(y - cy * CHUNK_SIZE) * CHUNK_SIZE + (x - cx * CHUNK_SIZE)]).toBe(TILE.HARD);
    expect(tileAtLive(seed, x, y, d)).toBe(TILE.HARD);
    d.bore(x - 5, y, 0, 10, 1, (ax, ay) => tileAt(seed, ax, ay));
    expect(tileAtLive(seed, x, y, d)).toBe(TILE.HARD);
  });
});

describe('大構造の到達可能性', () => {
  const seeds = [1, 42, 20260711];
  const landmarks = (): { seed: number; lm: Landmark }[] =>
    seeds.flatMap((seed) => [-3, -2, -1, 0, 1, 2, 3].flatMap((cell) =>
      [-4, -3, -2, -1, 0, 1, 2, 3, 4].flatMap((k) => {
        const lm = landmarkAt(seed, cell, k);
        return lm ? [{ seed, lm }] : [];
      })));
  it('塔系: 床の板の上から内部の梯子を登り切ると頂部の床に立てる(Player 結合。椎骨柱はうねりへ寄せながら登る)', () => {
    for (const { seed, lm } of landmarks()) {
      if (!isTowerFamily(lm.kind)) continue;
      const tiles = (tx: number, ty: number) => tileAt(seed, tx, ty);
      const player = new Player(lm.x + 0.125, lm.floor - 1.75 - 0.05);
      const idle = { left: false, right: false, jump: false, up: false, down: false };
      const right = { ...idle, right: true };
      // 層の高さは最大 400 タイル超、梯子は 4 タイル/秒なので 2 分ぶん回す
      for (let i = 0; i < 7200; i++) {
        const feetRow = Math.floor(player.body.y + player.body.h);
        const dir = shaftLadderX(lm, feetRow) + 0.5 - player.centerX;
        player.update({ ...idle, up: true, left: dir < -0.1, right: dir > 0.1 }, 1 / 60, tiles);
      }
      expect(player.body.y + player.body.h).toBeLessThanOrEqual(lm.top - 2);
      for (let i = 0; i < 60; i++) player.update(right, 1 / 60, tiles);
      const feetBeforeIdle = player.body.y + player.body.h;
      for (let i = 0; i < 60; i++) player.update(idle, 1 / 60, tiles);
      const feet = player.body.y + player.body.h;
      expect(feet).toBeLessThanOrEqual(lm.top + 1e-6);
      // 頂部の床の上に立つ。32 タイル梯子列が頂部の開口を通る配置では梯子に掴まったまま床の高さにいる。
      // 中心が揃った上の層の塔系へ登り継いだ場合も、梯子に掴まって静止しているなら到達とみなす
      const onLadder = tileAt(seed, Math.floor(player.centerX), Math.floor(feet - 1e-6)) === TILE.LADDER;
      const hanging = !player.body.onGround && Math.abs(feet - feetBeforeIdle) <= 1e-6;
      if (!onLadder && !hanging) expect(feet).toBeGreaterThan(lm.top - 1 / 16 - 1e-6);
      expect(player.body.onGround || onLadder || hanging).toBe(true);
    }
  });
  it('大桁橋: 橋床の左端から右へ歩くと落ちずに渡れる(Player 結合)', () => {
    let bridges = 0;
    for (const { seed, lm } of landmarks()) {
      if (lm.kind !== 'girder') continue;
      bridges++;
      const tiles = (tx: number, ty: number) => tileAt(seed, tx, ty);
      const gy = girderY(lm);
      const player = new Player(lm.gapLeft + 2 + 0.125, gy - 1.75 - 0.05);
      const right = { left: false, right: true, jump: false, up: false, down: false };
      for (let i = 0; i < 700; i++) player.update(right, 1 / 60, tiles);
      expect(player.body.x).toBeGreaterThan(lm.x + 10);
      const feet = player.body.y + player.body.h;
      expect(feet).toBeLessThanOrEqual(gy + 1e-6);
      expect(feet).toBeGreaterThan(gy - 1);
    }
    expect(bridges).toBeGreaterThan(0);
  });
  it('吹き抜けホール: 中に落ちても床の板に着地し、塞がれていない(Player 結合)', () => {
    let halls = 0;
    for (const { seed, lm } of landmarks()) {
      if (lm.kind !== 'atrium') continue;
      halls++;
      const tiles = (tx: number, ty: number) => tileAt(seed, tx, ty);
      // 梯子列でない列を選んで落とす
      let sx = lm.x + 3;
      while (tileAt(seed, sx, lm.bottom + 30) !== TILE.AIR && sx < lm.x + 12) sx++;
      expect(tileAt(seed, sx, lm.bottom + 30)).toBe(TILE.AIR);
      const player = new Player(sx + 0.125, lm.bottom + 2);
      const idle = { left: false, right: false, jump: false, up: false, down: false };
      for (let i = 0; i < 3600; i++) player.update(idle, 1 / 60, tiles);
      const feet = player.body.y + player.body.h;
      expect(feet).toBeLessThanOrEqual(lm.floor + 1e-6);
      expect(feet).toBeGreaterThan(lm.floor - 1);
      expect(player.body.onGround).toBe(true);
    }
    expect(halls).toBeGreaterThan(0);
  });
  it('崩落: 斜路の足から右へジャンプしながら歩くと板の上面に出る(Player 結合)', () => {
    for (const { seed, lm } of landmarks()) {
      if (lm.kind !== 'collapse') continue;
      const tiles = (tx: number, ty: number) => tileAt(seed, tx, ty);
      const player = new Player(lm.gapLeft - 3 + 0.125, lm.baseY - 1.75 - 0.05);
      const go = { left: false, right: true, jump: true, up: false, down: false };
      let reached = false;
      for (let i = 0; i < 3600 && !reached; i++) {
        player.update(go, 1 / 60, tiles);
        reached = player.body.x >= lm.gapRight + 1 && player.body.y + player.body.h <= lm.top + 1e-6;
      }
      expect(reached).toBe(true);
    }
  });
});
