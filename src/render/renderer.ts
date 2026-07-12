import type { Camera } from '../core/camera';
import type { Player } from '../entities/player';
import type { ChunkStore } from '../world/chunks';
import { CHUNK_SIZE } from '../world/tiles';
import { Background } from './background';
import { ChunkBaker } from './chunkbake';
import { Lighting } from './lighting';
import { biomeBlend, mixHex } from './biome';
import { drawPlayer } from './playerSprite';
import { Post } from './post';
import { drawHierarchyDebug } from './debugHierarchy';

/** 画面の横幅に収めるタイル数(スケール感の基準) */
const VIEW_TILES_X = 44;

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private lighting = new Lighting();
  private post = new Post();
  private baker: ChunkBaker;
  private background: Background;
  private debugMode: string | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private seed: number,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.baker = new ChunkBaker(seed);
    this.background = new Background(seed);
  }

  setDebug(mode: string | null): void {
    this.debugMode = mode;
  }

  resize(w: number, h: number): void {
    this.canvas.width = w;
    this.canvas.height = h;
    this.lighting.resize(w, h);
    this.post.resize(w, h);
  }

  /** ChunkStore.evictFarFromと対で呼ぶ(焼き込みキャッシュの解放) */
  evictFarFrom(cx: number, cy: number, radius: number): void {
    this.baker.evictFarFrom(cx, cy, radius);
  }

  render(store: ChunkStore, cam: Camera, player: Player, mouseX: number, mouseY: number, timeSec: number): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const ppt = w / VIEW_TILES_X;
    const ctx = this.ctx;

    // バイオーム混合(背景・環境光で共有)
    const bb = biomeBlend(player.body.y);

    // 背景(最初のフィル): 開放空間もバイオーム環境色でわずかに持ち上げる。
    // ambientLevelが高いほど明るく色づき(大空洞帯は暗青の空気に)、
    // 低いバイオーム(最下層)はほぼ暗いまま。SOLIDタイルより必ず暗くしてシルエットを保つ。
    // 上を少し明るく下を暗くする縦グラデで開放空間に奥行きを与える。
    const lit = mixHex('#05070a', mixHex(bb.ambientColor, '#000000', 0.5), bb.ambientLevel);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, mixHex(lit, '#ffffff', 0.08 * bb.ambientLevel));
    grad.addColorStop(1, mixHex(lit, '#000000', 0.35));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // パララックス遠景(バイオーム配色の多層構造)
    this.background.render(ctx, cam.x, cam.y, w, h, ppt, bb);

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
    drawPlayer(ctx, px, py, ppt, player.facing, player.walkPhase, angle, bb.ambientColor);

    // バイオーム環境光+プレイヤー補助光
    this.lighting.render(ctx, px, py, angle, ppt, timeSec, bb.ambientColor, bb.ambientLevel);

    // ポストプロセス(グレイン+ビネット)
    this.post.render(ctx, w, h, bb.ambientLevel);

    if (this.debugMode && this.debugMode.startsWith('hierarchy')) {
      // 'hierarchy' または 'hierarchy:<tilesAcross>'。既定は広域俯瞰(40000タイル)。
      const n = Number(this.debugMode.split(':')[1]);
      const tilesAcross = Number.isFinite(n) && n > 0 ? n : 40000;
      drawHierarchyDebug(ctx, cam, this.seed, w, h, tilesAcross);
    }
  }
}
