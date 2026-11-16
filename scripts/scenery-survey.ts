/**
 * 景色の密度の走査(2.21、設計 2026-11-16-strata-2.21-design §0.2 の検証用)。
 *
 * 床の行を水平に 360 タイル(歩行 6 タイル/秒 × 60 秒)歩く仮想歩行を、7 地区ごとに取り、
 * 各位置の開放度から決まるズーム段の視野で次を数える:
 * - 基礎の層: スパン標が視野に 1 つ以上ある位置の割合(合格: 合算 90% 以上、地区ごと最低 75%)
 * - 残されたもの: 歩行 60 秒あたりに視野へ入る回数(合格: 合算 6 回以上、うち 2.21 の新要素
 *   = 行列・サイロが 1.5 回以上)。2.17 の残滓だけの値も「現行値」として分けて出す
 * - 巨柱: 歩行 1080 タイルあたりに視野へ入る本数(合格: 1 本以上)と、穴の入口での見かけ幅
 *
 * 歩行は床の行に沿い、立てない位置は 12 タイル以内で次の立てる位置へ進む(届かなければ打ち切る)。
 * 位置は 3 タイル刻み(視野幅は最小でも 28 タイルあるので、入る回数の数え落としは起きない)。
 *
 * 使い方: npx vite-node scripts/scenery-survey.ts [--seed=20260711]
 */
import { sampleOpenness, targetZoomForOpenness, quantizeZoom } from '../src/core/zoom';
import { biomeCellAt, biomeIdForCell, BIOME_IDS, type BiomeId } from '../src/world/biomeCells';
import { interfaceTop } from '../src/world/interface';
import { TILE, isSolid } from '../src/world/tiles';
import { baseTileAt, tileAt } from '../src/world/worldgen';
import { pillarsInRect } from '../src/world/pillar';
import {
  floorRubbleAt, processionsInRect, remnantKindWith, sceneryProfileFor, siloCovering, spanMarkAt, SPAN_PITCH,
} from '../src/render/decor';

const SEEDS = [20260711, 1, 42, 7];
const WALK_LEN = 360;
const STEP = 3;
/** 視野(内部バッファ 427×240、タイル 15 px) */
const VIEW_W = 427 / 15;
const VIEW_H = 240 / 15;
/** 巨柱の本数を揃える歩行距離(タイル)。歩行 3 本ぶん */
const PILLAR_WALK_UNIT = 1080;
/** 穴の入口での本体の見かけ幅(視野幅に対する本体幅の割合)の目安 */
const PILLAR_APPARENT_MIN = 0.35;

interface Item { id: string; kind: 'remnant' | 'procession' | 'silo'; x0: number; x1: number; y0: number; y1: number }

interface Walk { seed: number; district: BiomeId; x: number; wy: number }

function standable(get: (x: number, y: number) => number, x: number, wy: number): boolean {
  return isSolid(get(x, wy)) && get(x, wy - 1) === TILE.AIR && get(x, wy - 2) === TILE.AIR;
}

/** 地区ごとに歩行の起点(長い床ランの左端)を集める */
function collectWalks(seed: number, district: BiomeId, limit: number): Walk[] {
  const get = (x: number, y: number): number => tileAt(seed, x, y);
  const walks: Walk[] = [];
  for (let cell = -24; cell <= 24 && walks.length < limit; cell++) {
    if (biomeIdForCell(seed, cell) !== district) continue;
    const top = interfaceTop(seed, cell);
    const bottom = interfaceTop(seed, cell + 1);
    for (let wy = top + 24; wy < bottom - 8 && walks.length < limit; wy += 7) {
      // この行に 24 タイル以上の床ランがあるか(左端を探す)
      let run = 0;
      for (let x = -1152; x <= 1152; x++) {
        if (standable(get, x, wy)) {
          run++;
          if (run === 24) {
            const wx = x - 23;
            if (!walks.some((w) => w.wy === wy && Math.abs(w.x - wx) < 200)) walks.push({ seed, district, x: wx, wy });
            break;
          }
        } else run = 0;
      }
    }
  }
  return walks;
}

/** 歩行の回廊(視野が届く範囲)にある景色の要素を列挙する */
function corridorItems(seed: number, x0: number, x1: number, y0: number, y1: number): Item[] {
  const get = (gx: number, gy: number): number => tileAt(seed, gx, gy);
  const items: Item[] = [];
  // 残滓(2.17 の現行値): sceneryOps の残滓(残骸・板・野原)と segmentOps の瓦礫の山。
  // 設計 §0.2 の現行値 3.5 回/60 秒は、この両方を数えた値として整合する(残滓だけでは 0.3 回台)
  for (let r = y0; r <= y1; r++) {
    const prof = sceneryProfileFor(biomeIdForCell(seed, biomeCellAt(seed, r)));
    for (let s = Math.floor(x0 / 16); s <= Math.floor(x1 / 16); s++) {
      const kind = remnantKindWith(get, seed, s, r, prof);
      if (kind === 0 || kind === 1 || kind === 3) {
        items.push({ id: `rem:${s},${r}`, kind: 'remnant', x0: s * 16, x1: s * 16 + 16, y0: r - 4, y1: r });
        continue;
      }
      // 瓦礫は「16 タイル全部が上面の空いた床」のセグメントにだけ描かれる
      let full = true;
      for (let i = 0; i < 16 && full; i++) {
        full = get(s * 16 + i, r) === TILE.SOLID && !isSolid(get(s * 16 + i, r - 1));
      }
      if (full && floorRubbleAt(seed, s, r)) {
        items.push({ id: `rub:${s},${r}`, kind: 'remnant', x0: s * 16, x1: s * 16 + 16, y0: r - 1, y1: r });
      }
    }
  }
  // 行列(2.21): 列全体で 1 件
  for (const p of processionsInRect(get, seed, x0, x1, y0, y1)) {
    items.push({ id: `proc:${p.seg},${p.wy}`, kind: 'procession', x0: p.x0, x1: p.x1, y0: p.wy - 4, y1: p.wy });
  }
  // サイロ(2.21): 区画ごとに、カバーするサイロを 1 件にまとめる
  const silos = new Map<string, Item>();
  for (let sy = Math.floor(y0 / 7); sy <= Math.floor(y1 / 7); sy++) {
    for (let sx = Math.floor(x0 / 8); sx <= Math.floor(x1 / 8); sx++) {
      const silo = siloCovering(seed, sx, sy);
      if (!silo) continue;
      silos.set(`silo:${silo.ax},${silo.ay}`, {
        id: `silo:${silo.ax},${silo.ay}`, kind: 'silo',
        x0: silo.x, x1: silo.x + silo.w, y0: silo.y, y1: silo.y + silo.h,
      });
    }
  }
  items.push(...silos.values());
  return items;
}

interface WalkResult {
  positions: number;
  spanVisible: number;
  entries: Record<Item['kind'], number>;
  /** 歩行中に本体が視野へ入った巨柱の本数(柱の id で重複を除く) */
  pillars: number;
  /** 穴の入口(穴の行の乗り場)に立っていた位置の数と、そのうち見かけ幅が目安以上だった数 */
  doorStands: number;
  doorWide: number;
}

/**
 * 地形追従の仮想歩行: 1 タイルずつ右へ進み、各列で立てる床の行を探す
 * (上は段差アシストとジャンプで 3 行まで、下は落ちるだけなので 10 行まで)。
 * 立てる床が無ければ歩行はそこで終わる。位置の記録は STEP タイルごと。
 */
function tracePath(seed: number, x: number, wy: number): { px: number; py: number }[] {
  const get = (gx: number, gy: number): number => tileAt(seed, gx, gy);
  const path: { px: number; py: number }[] = [];
  let px = x;
  let py = wy;
  let travelled = 0;
  while (travelled < WALK_LEN) {
    if (travelled % STEP === 0) path.push({ px, py });
    let advanced = false;
    // 現在の行に近い順に候補を試す
    const order = [0, -1, 1, -2, 2, -3, 3, 4, 5, 6, 7, 8, 9, 10];
    for (const d of order) {
      if (standable(get, px + 1, py + d)) {
        px += 1;
        py += d;
        travelled += 1;
        advanced = true;
        break;
      }
    }
    if (!advanced) break;
  }
  return path;
}

function runWalk(walk: Walk): WalkResult {
  const { seed, x, wy } = walk;
  const get = (gx: number, gy: number): number => tileAt(seed, gx, gy);
  const path = tracePath(seed, x, wy);
  const res: WalkResult = {
    positions: path.length, spanVisible: 0, entries: { remnant: 0, procession: 0, silo: 0 },
    pillars: 0, doorStands: 0, doorWide: 0,
  };
  if (path.length === 0) return res;
  const yMin = Math.min(...path.map((p) => p.py)) - 40;
  const yMax = Math.max(...path.map((p) => p.py)) + 20;
  const items = corridorItems(seed, x - 48, x + WALK_LEN + 48, yMin, yMax);
  const spanMarks: { x: number; y: number }[] = [];
  for (let sx = Math.floor((x - 48) / SPAN_PITCH) * SPAN_PITCH; sx <= x + WALK_LEN + 48; sx += SPAN_PITCH) {
    for (let r = yMin; r <= yMax; r++) {
      if (spanMarkAt(get, seed, sx, r)) spanMarks.push({ x: sx, y: r });
    }
  }
  // 巨柱(2.21): 回廊に掛かる柱。採択の土台は柱なし地形(baseTileAt)
  const pillars = pillarsInRect(seed, x - 48, x + WALK_LEN + 48, yMin, yMax, (gx, gy) => baseTileAt(seed, gx, gy));
  const seenPillars = new Set<string>();
  let visible = new Set<string>();
  for (const { px, py } of path) {
    const openness = sampleOpenness(get, px, py - 1);
    const zoom = quantizeZoom(targetZoomForOpenness(openness));
    const vw = VIEW_W / zoom;
    const vh = VIEW_H / zoom;
    const vx0 = px + 0.5 - vw / 2;
    const vx1 = px + 0.5 + vw / 2;
    const vy0 = py - 1 - vh / 2;
    const vy1 = py - 1 + vh / 2;
    if (spanMarks.some((m) => m.x + 2 >= vx0 && m.x <= vx1 && m.y + 2.2 >= vy0 && m.y - 0.14 <= vy1)) res.spanVisible++;
    const nowVisible = new Set<string>();
    for (const it of items) {
      if (it.x1 < vx0 || it.x0 > vx1 || it.y1 < vy0 || it.y0 > vy1) continue;
      nowVisible.add(it.id);
      if (!visible.has(it.id)) res.entries[it.kind]++;
    }
    visible = nowVisible;
    for (const p of pillars) {
      // 本体(幅 w、yTop〜yBottom)が視野に掛かれば 1 本。同じ柱は歩行 1 本につき 1 回だけ数える
      if (!seenPillars.has(p.id) && p.x0 + p.w >= vx0 && p.x0 <= vx1 && p.yBottom + 1 >= vy0 && p.yTop <= vy1) {
        seenPillars.add(p.id);
      }
      // 穴の入口: 足元の床の行が穴の行で、列が乗り場(梯子列と本体の間)にある
      const onLanding = (px > p.landL && px < p.x0) || (px >= p.x0 + p.w && px < p.landR);
      if (onLanding && p.doors.includes(py)) {
        res.doorStands++;
        if (p.w / vw >= PILLAR_APPARENT_MIN) res.doorWide++;
      }
    }
  }
  res.pillars = seenPillars.size;
  return res;
}

function main(): void {
  const onlySeed = process.argv.find((a) => a.startsWith('--seed='))?.slice(7);
  const seeds = onlySeed ? [Number(onlySeed)] : SEEDS;
  const perDistrict = new Map<BiomeId, { walks: number; positions: number; span: number; rem: number; proc: number; silo: number }>();
  let totWalks = 0;
  /** 巨柱の集計(既存の集計とは別に持つ)。tiles は歩いた距離(位置数 × STEP) */
  const pillarAgg = new Map<BiomeId, { tiles: number; pillars: number; stands: number; wide: number }>();
  for (const seed of seeds) {
    for (const district of BIOME_IDS) {
      const walks = collectWalks(seed, district, 6);
      for (const walk of walks) {
        const r = runWalk(walk);
        if (r.positions === 0) continue;
        totWalks++;
        const agg = perDistrict.get(district) ?? { walks: 0, positions: 0, span: 0, rem: 0, proc: 0, silo: 0 };
        agg.walks++;
        agg.positions += r.positions;
        agg.span += r.spanVisible;
        agg.rem += r.entries.remnant;
        agg.proc += r.entries.procession;
        agg.silo += r.entries.silo;
        perDistrict.set(district, agg);
        const pa = pillarAgg.get(district) ?? { tiles: 0, pillars: 0, stands: 0, wide: 0 };
        pa.tiles += r.positions * STEP;
        pa.pillars += r.pillars;
        pa.stands += r.doorStands;
        pa.wide += r.doorWide;
        pillarAgg.set(district, pa);
      }
    }
  }
  console.log(`歩行 ${totWalks} 本(シード ${seeds.join(', ')})`);
  console.log('地区 | 歩行 | スパン標が見える位置 | 残滓(2.17)/60秒 | 行列/60秒 | サイロ/60秒');
  let T = { walks: 0, positions: 0, span: 0, rem: 0, proc: 0, silo: 0 };
  for (const district of BIOME_IDS) {
    const a = perDistrict.get(district);
    if (!a) { console.log(`${district} | 0 | - | - | - | -`); continue; }
    const spanPct = (100 * a.span) / a.positions;
    console.log(`${district} | ${a.walks} | ${spanPct.toFixed(1)}% | ${(a.rem / a.walks).toFixed(2)} | ${(a.proc / a.walks).toFixed(2)} | ${(a.silo / a.walks).toFixed(2)}`);
    T = { walks: T.walks + a.walks, positions: T.positions + a.positions, span: T.span + a.span, rem: T.rem + a.rem, proc: T.proc + a.proc, silo: T.silo + a.silo };
  }
  const spanPct = (100 * T.span) / T.positions;
  const remTotal = T.rem / T.walks;
  const newTotal = (T.proc + T.silo) / T.walks;
  console.log(`合算 | ${T.walks} | ${spanPct.toFixed(1)}% | ${remTotal.toFixed(2)} | ${(T.proc / T.walks).toFixed(2)} | ${(T.silo / T.walks).toFixed(2)}`);
  console.log(`合格ライン: スパン合算 90% 以上(地区ごと最低 75%) / 残されたもの合算 ${(remTotal + newTotal).toFixed(2)} 回/60秒 (6 以上) / 新要素 ${newTotal.toFixed(2)} 回/60秒 (1.5 以上)`);
  // 巨柱(2.21): 歩行 1080 タイルあたりに本体が視野へ入る本数と、穴の入口での見かけ幅
  console.log(`地区 | 歩行 | 巨柱/${PILLAR_WALK_UNIT}タイル | 穴の入口で見かけ幅 ${Math.round(PILLAR_APPARENT_MIN * 100)}% 以上`);
  const P = { tiles: 0, pillars: 0, stands: 0, wide: 0 };
  const widePct = (wide: number, stands: number): string =>
    stands > 0 ? `${((100 * wide) / stands).toFixed(1)}% (${wide}/${stands} 位置)` : '- (入口に立った位置なし)';
  for (const district of BIOME_IDS) {
    const a = pillarAgg.get(district);
    if (!a || a.tiles === 0) { console.log(`${district} | 0 | - | -`); continue; }
    console.log(`${district} | ${perDistrict.get(district)?.walks ?? 0} | ${((a.pillars * PILLAR_WALK_UNIT) / a.tiles).toFixed(2)} | ${widePct(a.wide, a.stands)}`);
    P.tiles += a.tiles;
    P.pillars += a.pillars;
    P.stands += a.stands;
    P.wide += a.wide;
  }
  const pillarRate = P.tiles > 0 ? (P.pillars * PILLAR_WALK_UNIT) / P.tiles : 0;
  console.log(`合算 | ${T.walks} | ${pillarRate.toFixed(2)} | ${widePct(P.wide, P.stands)}`);
  console.log(`合格ライン: 巨柱 合算 ${pillarRate.toFixed(2)} 本/${PILLAR_WALK_UNIT}タイル (1 以上) / 穴の入口での見かけ幅 ${Math.round(PILLAR_APPARENT_MIN * 100)}% 以上の割合 ${widePct(P.wide, P.stands)}`);
}

main();
