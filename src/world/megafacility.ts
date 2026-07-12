import { hash2 } from './noise';
import { sectorAt, SECTOR_SIZE, type System } from './hierarchy';
import { TILE, type Tile } from './tiles';

/** 源=メガ施設の一辺(タイル)。通常部屋(128)より大きい */
export const MEGA_SIZE = 192;

/**
 * 各セクターのハブ中心に置かれる大きな源構造(発電炉/貯水池など)。
 * ハブ矩形 [hub-MEGA/2, hub+MEGA/2) 内なら構造タイル、外なら null。純粋・決定論。
 * 構造: 外郭壁(厚3)+四方の接続口、リング状キャットウォーク、中央コア(系統で形状変化)、
 *       全高の梯子2列(縦移動保証)。
 */
export function megaFacilityAt(seed: number, x: number, y: number): Tile | null {
  // このタイルが属するセクターのハブ world 座標
  const sec = sectorAt(seed, x, y);
  const sx = Math.floor(x / SECTOR_SIZE);
  const sy = Math.floor(y / SECTOR_SIZE);
  const hubX = sx * SECTOR_SIZE + sec.hubX;
  const hubY = sy * SECTOR_SIZE + sec.hubY;

  // ハブ中心のローカル座標 [0, MEGA_SIZE)
  const lx = x - (hubX - MEGA_SIZE / 2);
  const ly = y - (hubY - MEGA_SIZE / 2);
  if (lx < 0 || lx >= MEGA_SIZE || ly < 0 || ly >= MEGA_SIZE) return null;

  const S = MEGA_SIZE;
  const WALL = 3;
  const vs = (sec.sx * 2654435761 + sec.sy) | 0; // セクター由来の variant seed

  // 全高梯子2列(幅2ずつ, 縦移動保証)。壁の内側に配置
  const ladderA = WALL + 6;
  const ladderB = S - WALL - 8;
  const inInterior = lx >= WALL && lx < S - WALL && ly >= WALL && ly < S - WALL;
  if (inInterior && (lx === ladderA || lx === ladderA + 1 || lx === ladderB || lx === ladderB + 1)) {
    return TILE.LADDER;
  }

  // 外郭壁 + 四方接続口(中央付近を開口)
  const onWall = lx < WALL || lx >= S - WALL || ly < WALL || ly >= S - WALL;
  if (onWall) {
    const nearMidX = Math.abs(lx - S / 2) <= 6;
    const nearMidY = Math.abs(ly - S / 2) <= 6;
    if ((ly < WALL || ly >= S - WALL) && nearMidX) return TILE.AIR; // 上下の接続口
    if ((lx < WALL || lx >= S - WALL) && nearMidY) return TILE.AIR; // 左右の接続口
    return TILE.SOLID;
  }

  // リング状キャットウォーク(S/4間隔の水平床, 開口つき)
  const band = S / 4;
  for (let b = 1; b <= 3; b++) {
    const cy = Math.round(band * b);
    if (ly === cy && lx >= WALL && lx < S - WALL) {
      if (hash2(vs + 700, lx, b) < 0.18) return TILE.AIR;
      return TILE.SOLID;
    }
  }

  // 中央コア(系統で形状変化)
  const coreTile = core(sec.system, lx, ly, S, vs);
  if (coreTile !== null) return coreTile;

  return TILE.AIR;
}

/** 中央コア。系統ごとに形が違う源のシンボル。SOLID or null(空間) */
function core(system: System, lx: number, ly: number, S: number, vs: number): Tile | null {
  const cx = S / 2, cy = S / 2;
  const dx = lx - cx, dy = ly - cy;
  const r = Math.sqrt(dx * dx + dy * dy);
  switch (system) {
    case 'power': // 中央塔(縦長の柱)
      return Math.abs(dx) <= 10 && ly > S * 0.2 && ly < S * 0.8 ? TILE.SOLID : null;
    case 'foundry': // 中央の炉塊(大きな塊)
      return r < S * 0.16 ? TILE.SOLID : null;
    case 'water': // 底の水槽枠(下部の横帯)+中央は空
      return ly > S * 0.7 && (Math.abs(dx) > S * 0.25) ? TILE.SOLID : null;
    case 'disposal': // 中央の圧縮筒(縦の二重壁)
      return (Math.abs(Math.abs(dx) - 12) <= 2) && ly > S * 0.3 && ly < S * 0.75 ? TILE.SOLID : null;
    case 'habitation': // 中央広間: 小さな島床
      return r > S * 0.28 && r < S * 0.28 + 3 && hash2(vs + 800, lx, ly) < 0.6 ? TILE.SOLID : null;
    default:
      return null;
  }
}
