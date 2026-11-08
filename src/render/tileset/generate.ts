import { BLOB_COUNT, edgesForBlobId } from './autotile';
import { rowAtlas, TILE_PX, type Atlas } from './atlas';

/** バイオームが与えるタイル塗り分け色(暗→明の3段+縁のハイライト+内部線) */
export interface TilePalette {
  fillDark: string;
  fillMid: string;
  fillLight: string;
  edge: string;   // 空気に面した縁のハイライト
  line: string;   // パネル線・内部ディテール
}

/**
 * 各ブロブ形状を TILE_PX 角で描いて横一列アトラスに焼く。
 * edgesForBlobId で「空気に面する辺」を得て、その辺の内側にベベル(暗)を入れる。
 * 面の明度構造・継ぎ目・リベットはプレート単位で chunkbake 側が重ねる(段階 1)。
 * タイル単位のパネル線・縁の明線は「1 タイル周期の内装」に読めるため廃止した。純粋。
 */
export function generateAtlas(pal: TilePalette): Atlas {
  const canvas = document.createElement('canvas');
  canvas.width = TILE_PX * BLOB_COUNT;
  canvas.height = TILE_PX;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  for (let id = 0; id < BLOB_COUNT; id++) {
    drawTile(ctx, id * TILE_PX, TILE_PX, pal, edgesForBlobId(id));
  }
  return rowAtlas(canvas);
}

interface Edges { top: boolean; right: boolean; bottom: boolean; left: boolean }

function drawTile(ctx: CanvasRenderingContext2D, ox: number, px: number, pal: TilePalette, e: Edges): void {
  // ベース塗り
  ctx.fillStyle = pal.fillMid;
  ctx.fillRect(ox, 0, px, px);

  // 内部の陰影(上明るく下暗く)。面の主役はプレート単位の明度段(段階 1)に譲るため
  // 弱める(0.35 → 0.15)。残すのはタイル内のわずかな立体感だけ。
  const g = ctx.createLinearGradient(ox, 0, ox, px);
  g.addColorStop(0, pal.fillLight);
  g.addColorStop(0.5, pal.fillMid);
  g.addColorStop(1, pal.fillDark);
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = g;
  ctx.fillRect(ox, 0, px, px);
  ctx.globalAlpha = 1;

  // 空気に面した辺の内側にベベルの影(暗)だけを敷く。縁の明線と角リベットは
  // chunkbake のリム/プレート継ぎ目が担う(輪郭の均一な発光を避けるため)。
  const bevel = Math.max(3, px / 8);
  if (e.top) { ctx.fillStyle = pal.fillDark; ctx.fillRect(ox, 1, px, bevel * 0.4); }
  if (e.bottom) { ctx.fillStyle = pal.fillDark; ctx.fillRect(ox, px - bevel * 0.4 - 1, px, bevel * 0.4); }
  if (e.left) { ctx.fillStyle = pal.fillDark; ctx.fillRect(ox, 0, bevel * 0.4, px); }
  if (e.right) { ctx.fillStyle = pal.fillDark; ctx.fillRect(ox + px - bevel * 0.4, 0, bevel * 0.4, px); }
}
