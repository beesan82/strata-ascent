import type { Camera } from '../core/camera';
import type { Player } from '../entities/player';
import type { ChunkStore } from '../world/chunks';
import { Lighting } from './lighting';
import { drawTiles } from './silhouette';

/** 画面の横幅に収めるタイル数(スケール感の基準) */
const VIEW_TILES_X = 44;

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private lighting = new Lighting();

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  resize(w: number, h: number): void {
    this.canvas.width = w;
    this.canvas.height = h;
    this.lighting.resize(w, h);
  }

  render(store: ChunkStore, cam: Camera, player: Player, mouseX: number, mouseY: number): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const ppt = w / VIEW_TILES_X;
    const ctx = this.ctx;

    // 背景(照らされた時に構造の背後に見える最暗色)
    ctx.fillStyle = '#07080a';
    ctx.fillRect(0, 0, w, h);

    drawTiles(ctx, store, cam.x, cam.y, w, h, ppt);

    // プレイヤー(明るいシルエット)
    const px = (player.centerX - cam.x) * ppt + w / 2;
    const py = (player.centerY - cam.y) * ppt + h / 2;
    const pw = player.body.w * ppt;
    const ph = player.body.h * ppt;
    ctx.fillStyle = '#c8ccd2';
    ctx.fillRect(px - pw / 2, py - ph / 2, pw, ph);

    // 闇+ライト
    const angle = Math.atan2(mouseY - py, mouseX - px);
    this.lighting.render(ctx, px, py, angle, ppt);
  }
}
