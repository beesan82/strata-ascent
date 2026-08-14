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

/**
 * 遠→近の3バンド。近バンドでも焼き込みチャンクより背後(すべて背景)。
 * slot/span は「視野幅(≒44タイル)」を基準に選ぶ: 画面内に各バンド2〜4基が並び、
 * span>slot で水平に重なり合って闇を充満させる(スカスカを防ぐ)。
 */
export const BANDS: readonly Band[] = [
  { depth: 0.0, factor: 0.10, slot: 24, span: 34, density: 0.8 },
  { depth: 0.5, factor: 0.20, slot: 18, span: 24, density: 0.7 },
  { depth: 1.0, factor: 0.34, slot: 13, span: 17, density: 0.6 },
];

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Structure damage ratio (0..1), deterministically varied by signed world Y cells.
 */
export function damageFor(seed: number, slotX: number, band: number, worldY: number): number {
  const yCell = Math.floor(worldY / 500);
  return clamp01(hash2(seed + 51000 + band, slotX, yCell));
}

export interface Slot {
  key: string;      // キャッシュ用の一意キー
  worldX: number;   // 構造中心のワールドX(タイル)
  depth: number;    // 所属バンドの depth
  factor: number;   // バンドの追従率
  span: number;     // 見かけ幅(タイル)
  type: System;     // 系統(プレイヤーの実座標 camXtiles,camYtiles の regionAt。可視分は統一)
  damage: number;   // 0..1
  variantSeed: number;
  /** 稀に立つ異物フラグ。true のとき描画側は系統機械でなくバイオメカ異物を出す。 */
  biomech: boolean;
}

/**
 * camXtiles 中心・spanTiles 幅の可視範囲に落ちる各バンドの構造スロットを決定論で列挙。
 * type はプレイヤーの実座標(camXtiles,camYtiles)の regionAt().system で、可視構造は
 * 「今いる系統」に統一する(背景がプレイヤーの系統を追従する設計)。
 * camYtiles is the signed world Y coordinate used for deterministic variation.
 */
export function slotsInView(
  seed: number,
  camXtiles: number,
  spanTiles: number,
  camYtiles: number = 0,
): Slot[] {
  const out: Slot[] = [];
  const rowY = Math.floor(camYtiles);
  // 系統はプレイヤーの実ワールド座標(camXtiles)で判定する。worldX はパララックス圧縮
  // 空間の値なので regionAt に渡すと実系統とずれる。可視構造は「今いる系統」で統一する
  // (REGION_SIZE=262144 に対し視野は数十タイルなので、元々スロット毎の系統差は生じない)。
  const system = regionAt(seed, Math.floor(camXtiles), rowY).system;
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
      out.push({
        key: `${bi}:${k}`,
        worldX,
        depth: B.depth,
        factor: B.factor,
        span: B.span,
        type: system,
        damage: damageFor(seed, k, bi, rowY),
        variantSeed: Math.floor(hash2(seed + 52200 + bi, k, 0) * 0xffffff),
        biomech: hash2(seed + 52300 + bi, k, 0) < 0.08,
      });
    }
  }
  return out;
}
