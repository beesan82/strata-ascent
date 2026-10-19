import { facilityTileAt } from './facility';
import { megaFacilityAt } from './megafacility';
import { networkTileAt, sectorTrunkTileAt } from './network';
import { biomeCellAt, biomeIdForCell } from './biomeCells';
import { ANTECHAMBER_DEPTH, groupLadderX, interfaceBottom, interfaceTileAt, passageX, terrainModsAt, type TerrainMods } from './interface';
import { terrainProfileFor } from './biomeTerrain';
import { hash2, valueNoise2 } from './noise';
import { CHUNK_SIZE, isSolid, TILE, type Tile } from './tiles';
import type { Destruction } from './destruction';

/** 負数でも正しく回る剰余 */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/**
 * シード+ワールドタイル座標 → ノイズ躯体タイル種(施設オーバーレイ・界面タイルは含まない)。
 * 界面の地形変調(前室・圧縮帯)は含む。純粋関数(同じ入力なら常に同じ出力)。
 * 本体の合成は tileAt 内の noiseTileWith を使うため、主にテストが参照する。
 */
export function noiseTileAt(seed: number, x: number, y: number): Tile {
  const cell = biomeCellAt(seed, y);
  return noiseTileWith(seed, x, y, cell, terrainModsAt(seed, x, y, cell));
}

/** 地形変調(前室・圧縮帯)込みのノイズ躯体。 */
function noiseTileWith(seed: number, x: number, y: number, cell: number, mods: TerrainMods | null): Tile {
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
  // 前室の内側では梯子列を抑止する(孔の梯子列だけが通る)。
  if (!mods?.suppressLadder && x === groupLadderX(seed, x)) return TILE.LADDER;
  // 前室の底は連続した床。
  if (mods?.forceFloor) return TILE.SOLID;

  // 2. 巨大空洞(低頻度ノイズ)。空洞内は4床帯ごとの橋だけ残る
  const cavity = valueNoise2(seed + 101, x / 160, y / 160) > profile.cavityThreshold * (mods?.cavityScale ?? 1);
  if (cavity) {
    if (isFloorRow && mod(band, 4) === 0 && !floorGap) return TILE.SOLID;
    return TILE.AIR;
  }

  // 3. 柱・壁塊(中頻度ノイズ)
  const mass = valueNoise2(seed + 202, x / 28, y / 28) > profile.massThreshold - (mods?.massDrop ?? 0);
  if (mass) return TILE.SOLID;

  // 4. 床
  if (isFloorRow && !floorGap) return TILE.SOLID;

  return TILE.AIR;
}

/**
 * 最終タイル。優先順位:
 *   界面タイル(板・縦坑・見晴らし台・大穴) > 前室内(内側・底)はオーバーレイなしで躯体 >
 *   ノイズ LADDER 保持 > 施設・幹線オーバーレイ > 躯体(地形変調込みのノイズ)。
 * 不変条件: ノイズが LADDER のタイルは施設で上書きしない(上昇路を保持し到達可能性を守る)。
 */
export function tileAt(seed: number, x: number, y: number): Tile {
  // 界面(板・縦坑・見晴らし台・大穴)が最優先。
  const iface = interfaceTileAt(seed, x, y);
  if (iface !== null) return iface;
  const cell = biomeCellAt(seed, y);
  const mods = terrainModsAt(seed, x, y, cell);
  const base = noiseTileWith(seed, x, y, cell, mods);
  // 前室の内側は施設・幹線のオーバーレイを適用しない(空洞を壁で埋めない)。
  // 前室の底(forceFloor)も同様: 施設の内部(AIR)で連続した床が欠けないようにする。
  if (mods?.suppressLadder || mods?.forceFloor) return base;
  if (base === TILE.LADDER) return base;
  const overlay = megaFacilityAt(seed, x, y)
    ?? facilityTileAt(seed, x, y)
    ?? sectorTrunkTileAt(seed, x, y)
    ?? networkTileAt(seed, x, y);
  return overlay ?? base;
}

/** 実描画・物理が使う経路。破壊差分を最優先で反映(空なら tileAt と同値)。HARD は破壊済みでも HARD のまま */
export function tileAtLive(seed: number, x: number, y: number, destruction: Destruction): Tile {
  if (destruction.isDestroyed(x, y)) {
    // 多層防御: 誤って記録された板(HARD)も不壊(破壊済みの経路でだけ tileAt を計算する)
    return tileAt(seed, x, y) === TILE.HARD ? TILE.HARD : TILE.AIR;
  }
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

/** 開始時のズームは 1 で横 ±17 タイルしか見えないため、孔の梯子が必ず画面に入る距離 */
export const SPAWN_OFFSET_FROM_PASSAGE = 12;

/** 開始地点: cell 0 の前室の中、孔の左 SPAWN_OFFSET_FROM_PASSAGE タイル(梯子列なら左へずらした)列を床(最下段)から上へ走査し、最初の「足元が床・体の入る空間」を返す。通常は連続した床の行そのもの */
export function findSpawn(seed: number): { x: number; y: number } {
  const px = passageX(seed, 0, 0);
  let sx = px - SPAWN_OFFSET_FROM_PASSAGE;
  // 床の行では 32 タイル梯子列が抑止されないため、その列だと足元が LADDER になる。左へ最大 4 ずらす
  for (let i = 0; i < 4 && groupLadderX(seed, sx) === sx; i++) sx--;
  const bottom = interfaceBottom(seed, 0);
  for (let y = bottom + ANTECHAMBER_DEPTH - 1; y >= bottom + 1; y--) {
    const head = tileAt(seed, sx, y - 1);
    const body = tileAt(seed, sx, y);
    const below = tileAt(seed, sx, y + 1);
    if (!isSolid(head) && !isSolid(body) && isSolid(below)) {
      // 床の上面(y+1の上端)に高さ1.75の体を置く。少し浮かせて重力で着地させる
      // 体(幅0.75)が検証済みの列 sx に収まるよう sx+0.1 に置く
      return { x: sx + 0.1, y: y + 1 - 1.9 };
    }
  }
  console.warn('findSpawn: フォールバック位置を使用');
  // フォールバックも前室の床の上(空中ではなく)
  return { x: sx + 0.1, y: bottom + ANTECHAMBER_DEPTH - 1.9 };
}
