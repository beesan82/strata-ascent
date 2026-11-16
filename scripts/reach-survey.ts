/**
 * 到達保存の広域走査(2.21、設計 2026-11-16-strata-2.21-design §A-3 の検証 2 の広域版)。
 *
 * シードごとに矩形 x ∈ [-2304, 2304]、y ∈ [-3000, 3000] に掛かる巨柱を列挙し、1 本ずつ
 * checkPillarPreservation(柱なし地形 baseTileAt と最終形 tileAt の到達関係の保存)を掛ける。
 * あわせて、各穴の行で帯の左外から右外へ渡る最短手数(pillarCrossingDistance)を柱なし/柱ありで
 * 取り、回り道の長さ(柱あり − 柱なし)を集計する。
 * - 合格: 違反(本ゲート violations と柱自身の通行保証 doorViolations)が全体で 0
 * - 本数: 全シード合計で 500 本以上を想定(満たなければその旨を表示する。範囲は広げない)
 *
 * 柱 1 本につき窓(柱の全幅を上下左右に 48 タイル広げた範囲)のタイルを 1 回だけ生成して使い回す
 * (保存の検査と穴ごとの回り道の計測が同じ窓を読むため)。
 *
 * 使い方: npx vite-node scripts/reach-survey.ts [--seed=20260711]
 */
import { BIOME_IDS, biomeIdForCell, type BiomeId } from '../src/world/biomeCells';
import { pillarsInRect, type Pillar } from '../src/world/pillar';
import { checkPillarPreservation, pillarCrossingDistance, type ReachGet } from '../src/world/reach';
import { baseTileAt, tileAt } from '../src/world/worldgen';

const SEEDS = [20260711, 42, 1234567, 987654321];
const X0 = -2304;
const X1 = 2304;
const Y0 = -3000;
const Y1 = 3000;
/** 全シード合計の本数の想定下限 */
const MIN_PILLARS = 500;
/** reach.ts の窓の広げ幅(checkPillarPreservation / pillarCrossingDistance と同じ) */
const WIN_PAD = 48;
/** 違反の例として表示する件数の上限 */
const EXAMPLE_MAX = 10;
const UNSET = 255;

/**
 * 柱の窓の範囲だけタイルを配列に持つ引き手(窓の外は元の引き手へ流す)。
 * 値は元の引き手と同じなので、検査の結果は変わらない
 */
function windowCache(get: ReachGet, p: Pillar): ReachGet {
  const x0 = p.landL - WIN_PAD;
  const y0 = p.yTop - WIN_PAD;
  const w = p.landR + WIN_PAD - x0 + 1;
  const h = p.yBottom + WIN_PAD - y0 + 1;
  const data = new Uint8Array(w * h).fill(UNSET);
  return (x: number, y: number): number => {
    const lx = x - x0;
    const ly = y - y0;
    if (lx < 0 || ly < 0 || lx >= w || ly >= h) return get(x, y);
    const i = ly * w + lx;
    let t = data[i];
    if (t === UNSET) {
      t = get(x, y);
      data[i] = t;
    }
    return t;
  };
}

/** 昇順に並べた配列の中央値(空なら NaN) */
function median(sorted: readonly number[]): number {
  if (sorted.length === 0) return NaN;
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function fmt(n: number): string {
  return Number.isNaN(n) ? '-' : Number.isInteger(n) ? String(n) : n.toFixed(1);
}

interface SeedResult {
  seed: number;
  pillars: number;
  /** 違反のあった柱の本数 */
  badPillars: number;
  violations: number;
  doorViolations: number;
}

function main(): void {
  const onlySeed = process.argv.find((a) => a.startsWith('--seed='))?.slice(7);
  const seeds = onlySeed ? [Number(onlySeed)] : SEEDS;
  const perSeed: SeedResult[] = [];
  const perDistrict = new Map<BiomeId, { pillars: number; bad: number }>();
  const widths: number[] = [];
  /** 回り道の長さ(柱あり − 柱なしの最短手数)。穴ごとに 1 件 */
  const detours: number[] = [];
  /** 柱ありの最短手数そのもの */
  const finDists: number[] = [];
  let doorsMeasured = 0;
  let doorsUnmeasured = 0;
  const examples: string[] = [];

  console.log(`到達保存の広域走査: x ${X0}..${X1}、y ${Y0}..${Y1}(シード ${seeds.join(', ')})`);
  for (const seed of seeds) {
    const started = Date.now();
    const baseGet: ReachGet = (x, y) => baseTileAt(seed, x, y);
    const finGet: ReachGet = (x, y) => tileAt(seed, x, y);
    const pillars = pillarsInRect(seed, X0, X1, Y0, Y1, baseGet);
    const res: SeedResult = { seed, pillars: pillars.length, badPillars: 0, violations: 0, doorViolations: 0 };
    for (const p of pillars) {
      const base = windowCache(baseGet, p);
      const fin = windowCache(finGet, p);
      const r = checkPillarPreservation(base, fin, p);
      const bad = r.violations.length + r.doorViolations.length > 0;
      res.violations += r.violations.length;
      res.doorViolations += r.doorViolations.length;
      if (bad) res.badPillars++;
      for (const v of r.violations) {
        if (examples.length < EXAMPLE_MAX) examples.push(`シード ${seed} ${p.id} 本ゲート: ${v}`);
      }
      for (const v of r.doorViolations) {
        if (examples.length < EXAMPLE_MAX) examples.push(`シード ${seed} ${p.id} 通行保証: ${v}`);
      }
      const district = biomeIdForCell(seed, p.cell);
      const agg = perDistrict.get(district) ?? { pillars: 0, bad: 0 };
      agg.pillars++;
      if (bad) agg.bad++;
      perDistrict.set(district, agg);
      widths.push(p.w);
      for (const door of p.doors) {
        const d = pillarCrossingDistance(base, fin, p, door);
        if (d === null) {
          doorsUnmeasured++;
          continue;
        }
        doorsMeasured++;
        detours.push(d.fin - d.base);
        finDists.push(d.fin);
      }
    }
    perSeed.push(res);
    const sec = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`シード ${seed}: 柱 ${res.pillars} 本 / 違反 ${res.violations + res.doorViolations} 件(本ゲート ${res.violations}、通行保証 ${res.doorViolations}、違反のある柱 ${res.badPillars} 本) / ${sec} 秒`);
  }

  const totalPillars = perSeed.reduce((s, r) => s + r.pillars, 0);
  const totalViolations = perSeed.reduce((s, r) => s + r.violations, 0);
  const totalDoorViolations = perSeed.reduce((s, r) => s + r.doorViolations, 0);
  const totalBad = perSeed.reduce((s, r) => s + r.badPillars, 0);

  console.log('');
  console.log(`柱 ${totalPillars} 本(シード ${seeds.join(', ')})`);
  if (totalPillars < MIN_PILLARS) {
    console.log(`注意: 範囲内の柱は ${totalPillars} 本で、想定の ${MIN_PILLARS} 本に満たない(範囲は広げていない)`);
  }
  console.log('地区 | 柱 | 違反のある柱');
  for (const district of BIOME_IDS) {
    const a = perDistrict.get(district);
    console.log(a ? `${district} | ${a.pillars} | ${a.bad}` : `${district} | 0 | -`);
  }
  console.log(`合算 | ${totalPillars} | ${totalBad}`);

  widths.sort((a, b) => a - b);
  detours.sort((a, b) => a - b);
  finDists.sort((a, b) => a - b);
  console.log(`柱の幅: 最小 ${fmt(widths[0] ?? NaN)} / 中央値 ${fmt(median(widths))} / 最大 ${fmt(widths[widths.length - 1] ?? NaN)}`);
  console.log(`回り道の長さ(穴の行の横断、柱あり − 柱なしの最短手数): 中央値 ${fmt(median(detours))} / 最大 ${fmt(detours[detours.length - 1] ?? NaN)}(穴 ${doorsMeasured} か所、測れなかった穴 ${doorsUnmeasured} か所)`);
  console.log(`柱ありの横断の最短手数: 中央値 ${fmt(median(finDists))} / 最大 ${fmt(finDists[finDists.length - 1] ?? NaN)}`);
  // 違反の件数は柱 1 本あたり本ゲート 5 件・通行保証 3 件で打ち切られる(reach.ts の仕様)。0 か否かの判定には影響しない
  console.log(`違反総数: ${totalViolations + totalDoorViolations} 件(本ゲート ${totalViolations}、通行保証 ${totalDoorViolations}。柱 1 本あたり 5 件・3 件で打ち切り) (0 であること)`);
  for (const e of examples) console.log(`  ${e}`);
}

main();
