import { hash2 } from './noise';

export const ROOM_SIZE = 128;
export const DISTRICT_SIZE = 1024;
export const SECTOR_SIZE = 16384;
export const REGION_SIZE = 262144;

export const SYSTEMS = ['water', 'power', 'habitation', 'disposal', 'foundry'] as const;
export type System = (typeof SYSTEMS)[number];

/** 座標をセルサイズで床方向に割る(負座標対応) */
export function cellOf(coord: number, size: number): number {
  return Math.floor(coord / size);
}

/** セル座標+salt → [0,1) 決定論ハッシュ。level ごとに salt を変えて系列を分ける */
export function cellHash(seed: number, cx: number, cy: number, salt: number): number {
  return hash2(seed + salt * 1000, cx, cy);
}

/** 重み付き抽選。r∈[0,1)。決定論。 */
export function weighted<T>(table: { v: T; w: number }[], r: number): T {
  const total = table.reduce((s, e) => s + e.w, 0);
  let acc = 0;
  const target = r * total;
  for (const e of table) {
    acc += e.w;
    if (target < acc) return e.v;
  }
  return table[table.length - 1].v;
}

export interface Region {
  rx: number;
  ry: number;
  system: System;
}

const SYSTEM_TABLE = SYSTEMS.map((v) => ({ v, w: 1 }));

const regionCache = new Map<string, Region>();

export function regionAt(seed: number, x: number, y: number): Region {
  const rx = cellOf(x, REGION_SIZE);
  const ry = cellOf(y, REGION_SIZE);
  const key = `${seed},${rx},${ry}`;
  let r = regionCache.get(key);
  if (!r) {
    const system = weighted(SYSTEM_TABLE, cellHash(seed, rx, ry, 11));
    r = { rx, ry, system };
    regionCache.set(key, r);
  }
  return r;
}
