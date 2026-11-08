import { facilityTileAt } from './facility';
import { megaFacilityAt } from './megafacility';
import { networkTileAt, sectorTrunkTileAt } from './network';
import { biomeCellAt, biomeIdForCell } from './biomeCells';
import { ANTECHAMBER_DEPTH, groupLadderX, interfaceBottom, interfaceTileAt, passageX, terrainModsAt, type TerrainMods } from './interface';
import { grandHallAt, hallChimneyAt, hallChimneyForHall, type GrandHall } from './grandhall';
import { landmarkTileAt } from './landmark';
import { restPointTileAt } from './restpoint';
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

/** 地形変調(前室・圧縮帯)込みのノイズ躯体。hall は呼び出し側で計算済みなら渡す(二重計算の回避) */
function noiseTileWith(seed: number, x: number, y: number, cell: number, mods: TerrainMods | null, hall?: GrandHall | null): Tile {
  const biomeId = biomeIdForCell(seed, cell);
  const profile = terrainProfileFor(biomeId);

  // Floor bands use the active biome profile while their phase stays in world coordinates.
  const band = Math.floor(y / profile.floorSpacing);
  const isFloorRow = mod(y, profile.floorSpacing) === 0;
  const seg = Math.floor(x / profile.segLen);
  const floorGap = isFloorRow && hash2(seed + 303, seg, band) < profile.gapChance;

  // Ladder columns take precedence over all terrain features.
  // Each signed 32-tile X group has one deterministic column, independent of Y,
  // so it remains a continuous route through floors, cavities, and biome edges.
  // 前室の内側では梯子列を抑止する(孔の梯子列だけが通る)。
  if (!mods?.suppressLadder && x === groupLadderX(seed, x)) return TILE.LADDER;
  // 前室の底は連続した床。
  if (mods?.forceFloor) return TILE.SOLID;

  // 2a. 大広間(§4.3)。内側は空気、底に 1 本だけ床の行を残す。床は不壊(HARD)とし、
  // 重粒子砲で掘れて広間番人・プレイヤーが落下するのを防ぐ。梯子列は上の判定で
  // 既に返しているため、縦の到達可能性は広間の中でも保たれる
  const hallHere = hall === undefined ? grandHallAt(seed, cell) : hall;
  if (hallHere && x >= hallHere.x0 && x < hallHere.x1 && y >= hallHere.y0 && y < hallHere.y1) {
    return y === hallHere.floorY ? TILE.HARD : TILE.AIR;
  }

  // 2b. 大広間の煙突(絶景拡張)。広間の天井から上向きの吹き抜けを空気として彫る。
  // 煙突は 1 つ上のセルの領域へ伸びる場合があるため、タイルの属するセルの煙突だけでなく
  // 下のセル(cell + 1)の広間の煙突も引く(grandHallAt 冒頭の hash ゲートで大半は安く棄却される)。
  // 優先度は広間と同じ帯: 梯子列と前室の forceFloor は上の判定で既に保持され、
  // tileAt の合成では休憩点・界面が煙突より先に決まる現行構造を維持する
  const chimneyHere = hall === undefined ? hallChimneyAt(seed, cell) : (hallHere ? hallChimneyForHall(seed, hallHere) : null);
  if (chimneyHere && x >= chimneyHere.x0 && x < chimneyHere.x1 && y >= chimneyHere.y0 && y < chimneyHere.y1) {
    return TILE.AIR;
  }
  const chimneyBelow = hallChimneyAt(seed, cell + 1);
  if (chimneyBelow && x >= chimneyBelow.x0 && x < chimneyBelow.x1 && y >= chimneyBelow.y0 && y < chimneyBelow.y1) {
    return TILE.AIR;
  }

  // 2. 巨大空洞(低頻度ノイズ)。空洞内は bridgeEvery 床帯ごとの橋だけ残る
  const cavity = valueNoise2(seed + 101, x / profile.cavityScale, y / profile.cavityScale) > profile.cavityThreshold * (mods?.cavityScale ?? 1);
  if (cavity) {
    if (isFloorRow && mod(band, profile.bridgeEvery) === 0 && !floorGap) return TILE.SOLID;
    return TILE.AIR;
  }

  // 3. 柱・壁塊(中頻度ノイズ)
  const mass = valueNoise2(seed + 202, x / profile.massScale, y / profile.massScale) > profile.massThreshold - (mods?.massDrop ?? 0);
  if (mass) return TILE.SOLID;

  // 4. 床
  if (isFloorRow && !floorGap) return TILE.SOLID;

  return TILE.AIR;
}

/**
 * 最終タイル。優先順位(設計書 §5.6):
 *   HARD(界面の板・塔・崩落斜路) > 孔(LADDER/AIR)・見晴らし台・大穴 > 前室の強制空洞 > 休憩点 >
 *   ノイズ LADDER 保持 > メガ施設・施設・幹線オーバーレイ > 躯体(地形変調込みのノイズ)。
 * 大構造は板の HARD にだけ勝つ(塔の縦坑が板を貫き、崩落が板を裂け目と斜路に置き換える)。
 * 孔・見晴らし台・大穴(LADDER/AIR)は大構造に勝つ(塔が板の下の見晴らし台の上に立っても塞がない)。
 * 不変条件: ノイズが LADDER のタイルは施設で上書きしない(上昇路を保持し到達可能性を守る)。
 * ただし大構造の中では成立しない(塔・崩落は自前の梯子・斜路が経路)。
 */
export function tileAt(seed: number, x: number, y: number): Tile {
  const iface = interfaceTileAt(seed, x, y);
  const lm = landmarkTileAt(seed, x, y);
  if (lm !== null && (iface === null || iface === TILE.HARD)) return lm;
  if (iface !== null) return iface;
  const cell = biomeCellAt(seed, y);
  const mods = terrainModsAt(seed, x, y, cell);
  const hall = grandHallAt(seed, cell);
  const base = noiseTileWith(seed, x, y, cell, mods, hall);
  // 前室の内側は施設・幹線のオーバーレイを適用しない(空洞を壁で埋めない)。
  // 前室の底(forceFloor)も同様: 施設の内部(AIR)で連続した床が欠けないようにする。
  if (mods?.suppressLadder || mods?.forceFloor) return base;
  // 休憩点の箱(梯子列は restPointTileAt が保つ)。メガ施設・施設より優先
  const rest = restPointTileAt(seed, x, y);
  if (rest !== null) return rest;
  if (base === TILE.LADDER) return base;
  // 大広間(§4.3)の内側は躯体の彫り抜き(空気 + 底の床 1 行)をそのまま使う。
  // 施設・幹線のオーバーレイが広間の床を空気で食べると、広間に置かれるもの
  // (休憩点まわり・広間番人)が足場を失うため、広間内ではオーバーレイを適用しない
  if (hall && x >= hall.x0 && x < hall.x1 && y >= hall.y0 && y < hall.y1) return base;
  const overlay = megaFacilityAt(seed, x, y)
    ?? facilityTileAt(seed, x, y)
    ?? sectorTrunkTileAt(seed, x, y)
    ?? networkTileAt(seed, x, y);
  return overlay ?? base;
}

/**
 * 不壊(HARD)か。tileAt(seed,x,y) === TILE.HARD と同値だが、界面と大構造だけを見て躯体ノイズを計算しない
 * 安い判定(Destruction.bore が未生成チャンクでも使う)。
 */
export function isHardAt(seed: number, x: number, y: number): boolean {
  const iface = interfaceTileAt(seed, x, y);
  const lm = landmarkTileAt(seed, x, y);
  if (lm !== null || iface !== null) {
    // 界面・大構造がタイルを決める位置は tileAt と同じ優先順位で判定する(広間床より先)
    if (lm !== null && (iface === null || iface === TILE.HARD)) return lm === TILE.HARD;
    return iface === TILE.HARD;
  }
  // 界面・大構造が無い位置でのみ、大広間の床の行を HARD と判定する(未生成チャンクへの
  // bore でも広間床が破壊として記録されないようにする)。梯子列は noiseTileWith で
  // 広間より先に LADDER として返るため、床の行でも HARD ではない
  if (x === groupLadderX(seed, x)) return false;
  const hall = grandHallAt(seed, biomeCellAt(seed, y));
  return hall !== null && y === hall.floorY && x >= hall.x0 && x < hall.x1;
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
