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
 * edgesForBlobId で「空気に面する辺」を得て、その辺にベベル(暗)と縁ハイライトを入れ、
 * SMのブロック感を出す。パネル線・角リベットも足す。純粋(引数のパレットのみに依存)。
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

  // 内部の陰影(上明るく下暗く)
  const g = ctx.createLinearGradient(ox, 0, ox, px);
  g.addColorStop(0, pal.fillLight);
  g.addColorStop(0.5, pal.fillMid);
  g.addColorStop(1, pal.fillDark);
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = g;
  ctx.fillRect(ox, 0, px, px);
  ctx.globalAlpha = 1;

  // パネル線(内部の薄い枠)
  ctx.strokeStyle = pal.line;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.4;
  ctx.strokeRect(ox + 4.5, 4.5, px - 9, px - 9);
  ctx.globalAlpha = 1;

  // 空気に面した辺: 内側ベベルの影(暗)を先に敷き、その上に縁ハイライト(明)を重ねる。
  // ※順序が逆だと暗ベベルが明ハイライトを覆ってしまうため、fillRect→edge の順にする。
  const bevel = Math.max(3, px / 8);
  ctx.lineWidth = 2;
  const edge = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.strokeStyle = pal.edge;
    ctx.beginPath(); ctx.moveTo(ox + x1, y1); ctx.lineTo(ox + x2, y2); ctx.stroke();
  };
  if (e.top) { ctx.fillStyle = pal.fillDark; ctx.fillRect(ox, 1, px, bevel * 0.4); edge(0, 1, px, 1); }
  if (e.bottom) { ctx.fillStyle = pal.fillDark; ctx.fillRect(ox, px - bevel * 0.4 - 1, px, bevel * 0.4); edge(0, px - 1, px, px - 1); }
  if (e.left) { ctx.fillStyle = pal.fillDark; ctx.fillRect(ox, 0, bevel * 0.4, px); edge(1, 0, 1, px); }
  if (e.right) { ctx.fillStyle = pal.fillDark; ctx.fillRect(ox + px - bevel * 0.4, 0, bevel * 0.4, px); edge(px - 1, 0, px - 1, px); }

  // 角リベット(空気に面した辺が交わる外角)
  ctx.fillStyle = pal.edge;
  const rivet = (cx: number, cy: number) => { ctx.beginPath(); ctx.arc(ox + cx, cy, 1.3, 0, Math.PI * 2); ctx.fill(); };
  if (e.top && e.left) rivet(4, 4);
  if (e.top && e.right) rivet(px - 4, 4);
  if (e.bottom && e.left) rivet(4, px - 4);
  if (e.bottom && e.right) rivet(px - 4, px - 4);
}
