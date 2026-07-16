import { hash2 } from '../../world/noise';
import { regionAt, type System } from '../../world/hierarchy';

/** 深度バンド。factor=カメラ追従率(小=遠)。slot=スロット間隔(タイル)。span=1構造の見かけ幅(タイル)。 */
export interface Band {
  depth: number;   // 0(最遠)..1(最近)。かすみ・明度・追従率のキー
  factor: number;
  slot: number;
  span: number;
  density: number; // スロットに構造が立つ確率
}

/** 遠→近の3バンド。近バンドでも焼き込みチャンクより背後(すべて背景) */
export const BANDS: readonly Band[] = [
  { depth: 0.0, factor: 0.12, slot: 220, span: 170, density: 0.55 },
  { depth: 0.5, factor: 0.30, slot: 140, span: 110, density: 0.5 },
  { depth: 1.0, factor: 0.55, slot: 90,  span: 70,  density: 0.42 },
];

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * 構造の損傷度(0..1)。座標ハッシュ基準 + 高度が上がるほど崩壊寄りのバイアス。
 * altitudeTiles は max(0,-worldY) 相当を呼び出し側が渡す。常に[0,1]にクランプ。
 */
export function damageFor(seed: number, slotX: number, band: number, altitudeTiles: number): number {
  const base = hash2(seed + 51000 + band, slotX, 0) * 0.7;
  const altBias = clamp01(Math.max(0, altitudeTiles) / 30000) * 0.3;
  return clamp01(base + altBias);
}

export interface Slot {
  key: string;      // キャッシュ用の一意キー
  worldX: number;   // 構造中心のワールドX(タイル)
  depth: number;    // 所属バンドの depth
  factor: number;   // バンドの追従率
  span: number;     // 見かけ幅(タイル)
  type: System;     // 系統(その座標の regionAt)
  damage: number;   // 0..1
  variantSeed: number;
}

/**
 * camXtiles 中心・spanTiles 幅の可視範囲に落ちる各バンドの構造スロットを決定論で列挙。
 * type はスロット中心・camYtiles の regionAt().system(プレイヤーがいる系統と一致させる)。
 * camYtiles は符号付きワールドY(上=負)。高度バイアス altitude は max(0,-camYtiles)。
 */
export function slotsInView(
  seed: number,
  camXtiles: number,
  spanTiles: number,
  camYtiles: number = 0,
): Slot[] {
  const out: Slot[] = [];
  const altitudeTiles = Math.max(0, -camYtiles);
  const rowY = Math.floor(camYtiles);
  for (let bi = 0; bi < BANDS.length; bi++) {
    const B = BANDS[bi];
    // 追従率ぶんだけスロット原点をずらす(パンで継ぎ目が出ない整数スロット配置)
    const centerParallax = camXtiles * B.factor;
    const k0 = Math.floor((centerParallax - spanTiles / 2) / B.slot) - 1;
    const k1 = Math.floor((centerParallax + spanTiles / 2) / B.slot) + 1;
    for (let k = k0; k <= k1; k++) {
      if (hash2(seed + 52000 + bi, k, 0) > B.density) continue; // 空スロット
      const jitter = (hash2(seed + 52100 + bi, k, 0) - 0.5) * B.slot * 0.4;
      const worldX = k * B.slot + jitter;
      const type = regionAt(seed, Math.floor(worldX), rowY).system;
      out.push({
        key: `${bi}:${k}`,
        worldX,
        depth: B.depth,
        factor: B.factor,
        span: B.span,
        type,
        damage: damageFor(seed, k, bi, altitudeTiles),
        variantSeed: Math.floor(hash2(seed + 52200 + bi, k, 0) * 0xffffff),
      });
    }
  }
  return out;
}
