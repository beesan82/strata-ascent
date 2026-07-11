import type { ChunkStore } from '../world/chunks';
import { stratumIndexAt } from '../world/strata';
import { TILE } from '../world/tiles';

/** 階層ごとに構造の色味をわずかに変える(すべて暗色) */
const STRATUM_TINTS = ['#14181d', '#151a17', '#1a1714', '#12141c', '#171219'];

/**
 * 可視範囲のタイルをシルエットで描く。
 * camX/camY: 画面中心のワールド座標(タイル)、ppt: 1タイルあたりのピクセル数
 */
export function drawTiles(
  ctx: CanvasRenderingContext2D,
  store: ChunkStore,
  camX: number,
  camY: number,
  viewW: number,
  viewH: number,
  ppt: number,
): void {
  const halfW = viewW / ppt / 2;
  const halfH = viewH / ppt / 2;
  const x0 = Math.floor(camX - halfW) - 1;
  const x1 = Math.ceil(camX + halfW) + 1;
  const y0 = Math.floor(camY - halfH) - 1;
  const y1 = Math.ceil(camY + halfH) + 1;

  for (let ty = y0; ty <= y1; ty++) {
    const tint = STRATUM_TINTS[stratumIndexAt(ty) % STRATUM_TINTS.length];
    for (let tx = x0; tx <= x1; tx++) {
      const t = store.tileAt(tx, ty);
      if (t === TILE.AIR) continue;
      const sx = (tx - camX) * ppt + viewW / 2;
      const sy = (ty - camY) * ppt + viewH / 2;
      if (t === TILE.SOLID) {
        ctx.fillStyle = tint;
        // +1で継ぎ目の光漏れを防ぐ
        ctx.fillRect(sx, sy, ppt + 1, ppt + 1);
      } else if (t === TILE.LADDER) {
        ctx.strokeStyle = '#2a3038';
        ctx.lineWidth = Math.max(1, ppt / 12);
        ctx.beginPath();
        // 縦桟2本
        ctx.moveTo(sx + ppt * 0.25, sy);
        ctx.lineTo(sx + ppt * 0.25, sy + ppt);
        ctx.moveTo(sx + ppt * 0.75, sy);
        ctx.lineTo(sx + ppt * 0.75, sy + ppt);
        // 横桟
        ctx.moveTo(sx + ppt * 0.25, sy + ppt * 0.5);
        ctx.lineTo(sx + ppt * 0.75, sy + ppt * 0.5);
        ctx.stroke();
      }
    }
  }
}
