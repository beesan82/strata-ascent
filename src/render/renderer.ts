import type { Camera } from '../core/camera';
import type { Player } from '../entities/player';
import type { ChunkStore } from '../world/chunks';
import { CHUNK_SIZE } from '../world/tiles';
import { Background } from './background';
import { ChunkBaker } from './chunkbake';
import { Lighting } from './lighting';
import { drawPlayer } from './playerSprite';

/** 画面の横幅に収めるタイル数(スケール感の基準) */
const VIEW_TILES_X = 44;

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private lighting = new Lighting();
  private baker: ChunkBaker;
  private background: Background;

  constructor(
    private canvas: HTMLCanvasElement,
    seed: number,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.baker = new ChunkBaker(seed);
    this.background = new Background(seed);
  }

  resize(w: number, h: number): void {
    this.canvas.width = w;
    this.canvas.height = h;
    this.lighting.resize(w, h);
  }

  /** ChunkStore.evictFarFromと対で呼ぶ(焼き込みキャッシュの解放) */
  evictFarFrom(cx: number, cy: number, radius: number): void {
    this.baker.evictFarFrom(cx, cy, radius);
  }

  render(store: ChunkStore, cam: Camera, player: Player, mouseX: number, mouseY: number): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const ppt = w / VIEW_TILES_X;
    const ctx = this.ctx;

    ctx.fillStyle = '#050607';
    ctx.fillRect(0, 0, w, h);

    // パララックス遠景(闇の奥の巨大構造)
    this.background.render(ctx, cam.x, cam.y, w, h, ppt);

    // 可視チャンクの焼き込み画像を貼る
    const chunkPx = CHUNK_SIZE * ppt;
    const cx0 = Math.floor((cam.x - w / ppt / 2) / CHUNK_SIZE);
    const cx1 = Math.floor((cam.x + w / ppt / 2) / CHUNK_SIZE);
    const cy0 = Math.floor((cam.y - h / ppt / 2) / CHUNK_SIZE);
    const cy1 = Math.floor((cam.y + h / ppt / 2) / CHUNK_SIZE);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const baked = this.baker.get(cx, cy, store);
        const sx = (cx * CHUNK_SIZE - cam.x) * ppt + w / 2;
        const sy = (cy * CHUNK_SIZE - cam.y) * ppt + h / 2;
        ctx.drawImage(baked, sx, sy, chunkPx, chunkPx);
      }
    }

    // プレイヤー(コートの人影)
    const px = (player.centerX - cam.x) * ppt + w / 2;
    const py = (player.centerY - cam.y) * ppt + h / 2;
    const angle = Math.atan2(mouseY - py, mouseX - px);
    drawPlayer(ctx, px, py, ppt, player.facing, player.walkPhase, angle);

    // 闇+ライト
    this.lighting.render(ctx, px, py, angle, ppt);
  }
}
