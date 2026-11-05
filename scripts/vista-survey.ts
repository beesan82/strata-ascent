/**
 * 絶景の余地の計測(ゾーン化 段階 2 Task 4、設計 §6.5 の検証用)。
 *
 * 定義: 「開けた大空間(絶景点)」= sampleOpenness(半径 22 の開放度)が 0.9 以上の地点。
 * 深さ方向のサンプル列(x を 64 間隔)ごとに y を 32 間隔で走査し、
 * (a) 絶景点の割合、(b) 絶景点が 5 点以上縦に連続する区間(=高さ 160 タイル級の
 * 開けた空間)の数を数える。レア枠(rareLandmarkAt / farSilhouettes)の出現も併せて数える。
 *
 * 使い方: npx vite-node scripts/vista-survey.ts
 */
import { sampleOpenness } from '../src/core/zoom';
import { tileAt } from '../src/world/worldgen';
import { biomeCellAt, biomeIdForCell, BIOME_IDS } from '../src/world/biomeCells';
import { farSilhouettes, rareLandmarkAt } from '../src/render/background';

const SEEDS = [1, 42, 20260711, 7, 99];
const VISTA_OPENNESS = 0.9;
const RUN_MIN = 5;
const RUN_LONG = 10;

let totalPoints = 0;
let totalVista = 0;
let totalRuns = 0;
let totalLongRuns = 0;
const perDistrict = new Map<string, { points: number; vista: number }>();
for (const seed of SEEDS) {
  const tiles = (x: number, y: number): number => tileAt(seed, x, y);
  let points = 0;
  let vista = 0;
  let runs = 0;
  let longRuns = 0;
  for (let x = -2400; x <= 2400; x += 64) {
    let run = 0;
    const flush = (): void => {
      if (run >= RUN_MIN) runs++;
      if (run >= RUN_LONG) longRuns++;
      run = 0;
    };
    for (let y = -3600; y <= 600; y += 32) {
      points++;
      const isVista = sampleOpenness(tiles, x, y) >= VISTA_OPENNESS;
      const id = biomeIdForCell(seed, biomeCellAt(seed, y));
      const bucket = perDistrict.get(id) ?? { points: 0, vista: 0 };
      bucket.points++;
      if (isVista) bucket.vista++;
      perDistrict.set(id, bucket);
      if (isVista) {
        vista++;
        run++;
      } else {
        flush();
      }
    }
    flush();
  }
  totalPoints += points;
  totalVista += vista;
  totalRuns += runs;
  totalLongRuns += longRuns;
  console.log(`seed ${seed}: 絶景点 ${vista}/${points} (${(100 * vista / points).toFixed(2)}%), 大きな開け区間 ${runs}, 長大区間 ${longRuns}`);
}
console.log(`合計: 絶景点 ${totalVista}/${totalPoints} (${(100 * totalVista / totalPoints).toFixed(2)}%), 大きな開け区間 ${totalRuns}, 長大区間 ${totalLongRuns}`);
for (const id of BIOME_IDS) {
  const b = perDistrict.get(id);
  if (b) console.log(`地区別 ${id}: ${b.vista}/${b.points} (${(100 * b.vista / b.points).toFixed(2)}%)`);
}

// レア枠(潰れていないことの確認)
let rare = 0;
let rareSlots = 0;
for (const seed of SEEDS) for (let slot = -20; slot <= 20; slot++) {
  rareSlots++;
  if (rareLandmarkAt(seed, slot)) rare++;
}
console.log(`レア枠: rareLandmarkAt ${rare}/${rareSlots} スロット (${(100 * rare / rareSlots).toFixed(1)}%)`);
let farCount = 0;
for (const seed of SEEDS) farCount += farSilhouettes(seed, 0, 4800).length;
console.log(`レア枠: farSilhouettes(x=0, 幅 4800) 合計 ${farCount}(5 seed)`);
