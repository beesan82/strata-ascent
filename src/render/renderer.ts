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
import { drawBeam, drawCharge } from './beam';
import { MegaStructure } from './megastructure';
import { LightShafts } from './lightshaft';

/** 画面の横幅に収めるタイル数(スケール感の基準) */
const VIEW_TILES_X = 44;

/** 発射直後の画面シェイク最大振幅(px) */
const SHAKE_MAX = 6;

/** 溜め中/発射ビームの演出パラメータ(main→renderへ毎フレーム渡す) */
export interface GravitonFx {
  /** 溜め比率(0..1)。>0でチャージ発光を描く */
  chargeRatio: number;
  /** 生存中のビーム。nullなら描かない */
  beam: { angle: number; alpha: number } | null;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private lighting = new Lighting();
  private post = new Post();
  private baker: ChunkBaker;
  private background: Background;
  private megastructure: MegaStructure;
  private lightShafts: LightShafts;
  private debugMode: string | null = null;
  /**
   * 直近フレームで算出したエイム角(ワールド空間・マウス方向)。
   * update側(main)がビーム/ボーリング方向として読む。1フレーム遅延は許容。
   */
  aimAngle = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private seed: number,
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.baker = new ChunkBaker(seed);
    this.background = new Background(seed);
    this.megastructure = new MegaStructure(seed);
    this.lightShafts = new LightShafts(seed);
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

  /** ChunkStore.invalidateと対で呼ぶ(ボーリングされたチャンクの焼き込み画像を破棄) */
  invalidate(cx: number, cy: number): void {
    this.baker.invalidate(cx, cy);
  }

  render(
    store: ChunkStore, cam: Camera, player: Player,
    mouseX: number, mouseY: number, timeSec: number,
    fx: GravitonFx,
  ): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    // cam.zoom<1 で ppt が縮み、画面に入るタイル数が増える(開放空間の豆粒化)
    const ppt = (w / VIEW_TILES_X) * cam.zoom;
    const ctx = this.ctx;

    // 発射直後の画面シェイク: シーン全体を微小にずらす。ビームの残光(alpha)に比例。
    // ctxを丸ごと平行移動するので各レイヤーは一貫してずれる。restoreで必ず戻す。
    const shake = fx.beam ? fx.beam.alpha * SHAKE_MAX : 0;
    ctx.save();
    if (shake > 0.01) {
      ctx.translate((Math.random() * 2 - 1) * shake, (Math.random() * 2 - 1) * shake);
    }

    // バイオーム混合(背景・環境光で共有)
    const bb = biomeBlend(this.seed, player.centerX, player.body.y);

    // 背景(最初のフィル): 開放空間もバイオーム環境色でわずかに持ち上げる。
    // ambientLevelが高いほど明るく色づき(水系統=大空洞帯は暗青の空気に)、
    // ambientの低い系統(廃棄物層など)はほぼ暗いまま。SOLIDタイルより必ず暗くしてシルエットを保つ。
    // 上を少し明るく下を暗くする縦グラデで開放空間に奥行きを与える。
    const lit = mixHex('#05070a', mixHex(bb.ambientColor, '#000000', 0.5), bb.ambientLevel);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, mixHex(lit, '#ffffff', 0.08 * bb.ambientLevel));
    grad.addColorStop(1, mixHex(lit, '#000000', 0.35));
    ctx.fillStyle = grad;
    // シェイクで生じる端の隙間を隠すため少し外側まで塗る(shake=0でも無害)
    ctx.fillRect(-SHAKE_MAX, -SHAKE_MAX, w + SHAKE_MAX * 2, h + SHAKE_MAX * 2);

    // パララックス遠景(バイオーム配色の多層構造)
    this.background.render(ctx, cam.x, cam.y, w, h, ppt, bb);

    // 意味を持つ超構造(遠→中→近の深度＋かすみ)。焼き込みチャンクより背後、遠景パララックスより手前。
    this.megastructure.render(ctx, cam, w, h, ppt, bb);

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

    // 光条(場所依存の体積光)。ライトの後・FX/postの前。暗く開けた空間だけに硬い光条が差す。
    this.lightShafts.render(ctx, cam, w, h, ppt, bb.ambientLevel);

    // 重力子砲の演出: ライトの「上」に描いて発光体として読ませる。
    // ただし post(グレイン+ビネット)の「前」に描くことで画面全体の質感と馴染ませる。
    if (fx.chargeRatio > 0) {
      drawCharge(ctx, px, py, fx.chargeRatio);
    }
    if (fx.beam) {
      // ワールド length=300 タイルは画面外まで伸びる貫通ビーム。対角を覆う長さで十分。
      const beamLen = Math.hypot(w, h) * 1.15;
      drawBeam(ctx, px, py, fx.beam.angle, beamLen, fx.beam.alpha);
    }

    // ポストプロセス(グレイン+ビネット)
    this.post.render(ctx, w, h, bb.ambientLevel);

    if (this.debugMode && this.debugMode.startsWith('hierarchy')) {
      // 'hierarchy' または 'hierarchy:<tilesAcross>'。既定は広域俯瞰(40000タイル)。
      const n = Number(this.debugMode.split(':')[1]);
      const tilesAcross = Number.isFinite(n) && n > 0 ? n : 40000;
      drawHierarchyDebug(ctx, cam, this.seed, w, h, tilesAcross);
    }

    ctx.restore(); // シェイクの平行移動を戻す
    // update側がボーリング/ビーム方向として読めるよう、算出したエイム角を公開する
    this.aimAngle = angle;
  }
}
