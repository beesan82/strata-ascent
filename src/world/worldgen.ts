import { facilityTileAt } from './facility';
import { megaFacilityAt } from './megafacility';
import { networkTileAt, sectorTrunkTileAt } from './network';
import { biomeCellAt, biomeIdForCell } from './biomeCells';
import { terrainProfileFor } from './biomeTerrain';
import { hash2, valueNoise2 } from './noise';
import { CHUNK_SIZE, TILE, type Tile } from './tiles';
import type { Destruction } from './destruction';

/** 負数でも正しく回る剰余 */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** シード+ワールドタイル座標 → 素のノイズ躯体タイル種。純粋関数(同じ入力なら常に同じ出力) */
export function noiseTileAt(seed: number, x: number, y: number): Tile {
  const cell = biomeCellAt(seed, y);
  const biomeId = biomeIdForCell(seed, cell);
  const profile = terrainProfileFor(biomeId);

  // Floor bands use the active biome profile while their phase stays in world coordinates.
  const band = Math.floor(y / profile.floorSpacing);
  const isFloorRow = mod(y, profile.floorSpacing) === 0;
  const seg = Math.floor(x / 16);
  const floorGap = isFloorRow && hash2(seed + 303, seg, band) < profile.gapChance;

  // Ladder columns take precedence over all terrain features.
  // Each signed 32-tile X group has one deterministic column, independent of Y,
  // so it remains a continuous route through floors, cavities, and biome edges.
  const group = Math.floor(x / 32);
  const ladderX = group * 32 + Math.floor(hash2(seed + 404, group, 0) * 32);
  if (x === ladderX) return TILE.LADDER;

  // 2. 巨大空洞(低頻度ノイズ)。空洞内は4床帯ごとの橋だけ残る
  const cavity = valueNoise2(seed + 101, x / 160, y / 160) > profile.cavityThreshold;
  if (cavity) {
    if (isFloorRow && mod(band, 4) === 0 && !floorGap) return TILE.SOLID;
    return TILE.AIR;
  }

  // 3. 柱・壁塊(中頻度ノイズ)
  const mass = valueNoise2(seed + 202, x / 28, y / 28) > profile.massThreshold;
  if (mass) return TILE.SOLID;

  // 4. 床
  if (isFloorRow && !floorGap) return TILE.SOLID;

  return TILE.AIR;
}

/**
 * 最終タイル = 施設オーバーレイ + 素のノイズ躯体。
 * 不変条件: ノイズが LADDER のタイルは施設で上書きしない(上昇路を保持し到達可能性を守る)。
 */
export function tileAt(seed: number, x: number, y: number): Tile {
  const base = noiseTileAt(seed, x, y);
  if (base === TILE.LADDER) return base;
  const overlay = megaFacilityAt(seed, x, y)
    ?? facilityTileAt(seed, x, y)
    ?? sectorTrunkTileAt(seed, x, y)
    ?? networkTileAt(seed, x, y);
  return overlay ?? base;
}

/** 実描画・物理が使う経路。破壊差分を最優先で反映(空なら tileAt と同値) */
export function tileAtLive(seed: number, x: number, y: number, destruction: Destruction): Tile {
  if (destruction.isDestroyed(x, y)) return TILE.AIR;
  return tileAt(seed, x, y);
}

/** チャンク(64x64)のタイル配列を生成。index = ty * CHUNK_SIZE + tx */
export function generateChunk(seed: number, cx: number, cy: number): Uint8Array {
  const data = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
  const baseX = cx * CHUNK_SIZE;
  const baseY = cy * CHUNK_SIZE;
  for (let ty = 0; ty < CHUNK_SIZE; ty++) {
    for (let tx = 0; tx < CHUNK_SIZE; tx++) {
      data[ty * CHUNK_SIZE + tx] = tileAt(seed, baseX + tx, baseY + ty);
    }
  }
  return data;
}

/** 開始地点: x=8付近で「足元が床・体の入る空間」を上から探す */
export function findSpawn(seed: number): { x: number; y: number } {
  for (let y = -1; y < 400; y++) {
    const head = tileAt(seed, 8, y - 1);
    const body = tileAt(seed, 8, y);
    const below = tileAt(seed, 8, y + 1);
    if (head !== TILE.SOLID && body !== TILE.SOLID && below === TILE.SOLID) {
      // 床の上面(y+1の上端)に高さ1.75の体を置く。少し浮かせて重力で着地させる
      // 体(幅0.75)が検証済みのx=8列に収まるようx=8.1に置く
      return { x: 8.1, y: y + 1 - 1.9 };
    }
  }
  console.warn('findSpawn: フォールバック位置を使用');
  return { x: 8.1, y: 0 };
}
