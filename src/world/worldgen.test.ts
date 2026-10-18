import { describe, expect, it } from 'vitest';
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
import { findSpawn, generateChunk, noiseTileAt, tileAt, tileAtLive } from './worldgen';
import { Destruction } from './destruction';
import { ANTECHAMBER_DEPTH, interfaceBottom, interfaceTileAt, interfaceTop, passageX, terrainModsAt } from './interface';

/** 界面の地物・前室の内側ではノイズ梯子の不変条件を適用しない */
function inInterfaceZone(seed: number, x: number, y: number): boolean {
  return interfaceTileAt(seed, x, y) !== null || !!terrainModsAt(seed, x, y)?.suppressLadder;
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
    // ladderXは実装(tileAt)の式をそのまま再現している。実装と鏡写しの結合だが、
    // 「梯子は常にどんな地形も貫通する」性質を固定する目的で意図的に許容する。
    const TEST_RANGE_UNIT = 8;
    for (const seed of [1, 42, 20260711]) {
      for (let group = 0; group < 8; group++) {
        // The same signed-X column must be a ladder throughout all Y values.
        for (let y = -TEST_RANGE_UNIT * 40; y < TEST_RANGE_UNIT * 41; y++) {
          const ladderX =
            group * 32 + Math.floor(hash2(seed + 404, group, 0) * 32);
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
  it('スポーンは固体の中ではなく、cell 0 の前室の中(孔の左 24 タイル)', () => {
    for (const seed of seeds) {
      const { x, y } = findSpawn(seed);
      expect(isSolid(tileAt(seed, Math.floor(x), Math.floor(y)))).toBe(false);
      expect(isSolid(tileAt(seed, Math.floor(x), Math.floor(y) + 1))).toBe(false);
      const px = passageX(seed, 0, 0);
      expect(Math.floor(x)).toBe(px - 24);
      expect(y).toBeGreaterThan(interfaceBottom(seed, 0));
      expect(y).toBeLessThan(interfaceBottom(seed, 0) + ANTECHAMBER_DEPTH);
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
        if (interfaceTileAt(42, x, y) === null && noiseTileAt(42, x, y) === TILE.LADDER) {
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
        if (interfaceTileAt(42, x, y) === null && noiseTileAt(42, x, y) === TILE.LADDER) {
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
        if (interfaceTileAt(42, x, y) === null && noiseTileAt(42, x, y) === TILE.LADDER) { expect(tileAt(42, x, y)).toBe(TILE.LADDER); checked++; }
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
});

describe('界面と前室の合成', () => {
  const seeds = [1, 42, 20260711];
  it('tileAt は界面タイルを最優先にする(施設・メガ施設の上でも)', () => {
    for (const seed of seeds) for (let cell = -4; cell <= 4; cell++) {
      const top = interfaceTop(seed, cell);
      for (let x = -2000; x <= 2000; x += 97) {
        const iface = interfaceTileAt(seed, x, top + 3);
        expect(iface).not.toBe(null);
        expect(tileAt(seed, x, top + 3)).toBe(iface);
      }
    }
  });
  it('前室の底は連続した床(梯子列は通す)、前室の内側に梯子列も施設の壁もない', () => {
    for (const seed of seeds) for (let cell = -2; cell <= 2; cell++) for (const k of [-1, 0, 2]) {
      const bottom = interfaceBottom(seed, cell), px = passageX(seed, cell, k);
      for (let x = px - 120; x <= px + 120; x++) {
        const t = tileAt(seed, x, bottom + ANTECHAMBER_DEPTH);
        expect(t === TILE.SOLID || t === TILE.LADDER).toBe(true);
      }
      for (let x = px - 119; x < px + 120; x++) {
        if (x === px) continue;
        for (let y = bottom; y < bottom + ANTECHAMBER_DEPTH; y += 5) {
          if (interfaceTileAt(seed, x, y) !== null) continue; // 大穴の最下行(dy=0)は界面が AIR を返す
          expect(tileAt(seed, x, y)).not.toBe(TILE.LADDER);
          expect(tileAt(seed, x, y)).toBe(noiseTileAt(seed, x, y)); // 施設オーバーレイが効いていない
        }
      }
    }
  });
  it('前室の内側は空洞(床帯を除いて空気率 0.9 以上)、圧縮帯は通常より固体が多い', () => {
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
