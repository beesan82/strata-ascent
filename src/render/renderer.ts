import { Camera } from '../core/camera';
import type { Player } from '../entities/player';
import type { ChunkStore } from '../world/chunks';
import { CHUNK_SIZE } from '../world/tiles';
import { Background } from './background';
import { ChunkBaker, REBAKE_DILATE } from './chunkbake';
import { rebakeTargets } from './dirtyBounds';
import { Lighting } from './lighting';
import { biomeBlend, mixHex } from './biome';
import { STEEL } from './steel';
import { drawPlayer } from './playerSprite';
import { Post } from './post';
import { drawHierarchyDebug } from './debugHierarchy';
import { drawBeam, drawCharge } from './beam';
import { MegaStructure } from './megastructure';
import { LightShafts } from './lightshaft';
import { BeaconLights, ambientDelta, glowStrips, type GlowStrip } from './beacon';
import { LandmarkLights, REST_WARM_COLOR } from './landmarkLight';
import { restWarmthAt } from '../world/restpoint';
import { HIGH_FIDELITY_TILE_PX, PixelPipeline } from './pixel';
import { paletteRgb } from './palette';
import { quantizeZoom } from '../core/zoom';
import { nextBakeTask } from './bakeSchedule';
import type { Vec2 } from './playerPose';

/** 画面の横幅に収めるタイル数(スケール感の基準) */
const VIEW_TILES_X = 34;

/**
 * 焼き込みキャッシュの保持半径(プレイヤーのチャンクからのチェビシェフ距離)。
 * 1枚1024×1024(~4MB)と重いので衝突ストアより狭くする。半径2 はプレイヤーのチャンクの端からでも
 * 128 タイル先まで保持する。眺望(ズーム 0.35)の視界は約 97×55 タイルで、手動眺望の中心オフセット
 * 40 タイルを足しても中心から横 88.5・縦 57.5 タイルなので、可視範囲+先読み1チャンクが常に収まる。
 */
export const BAKE_KEEP_RADIUS = 2;

/** 発射直後の画面シェイク最大振幅(px) */
const SHAKE_MAX = 6;
/**
 * drawSky の作業キャンバスの余白(px)。SHAKE_MAX 以上で、グラデのディザ位置が内部バッファと
 * そろうよう16の倍数にする(6だと量子化後に空の画素が約0.4%入れ替わった)。
 */
const SKY_PAD = 16;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 溜め中/発射ビームの演出パラメータ(main→renderへ毎フレーム渡す) */
export interface GravitonFx {
  /** 溜め比率(0..1)。>0でチャージ発光を描く */
  chargeRatio: number;
  /** 生存中のビーム。nullなら描かない */
  beam: { angle: number; alpha: number } | null;
}

/**
 * Draws weapon effects from the visible muzzle. Gameplay destruction keeps its
 * existing player-center origin in main.ts; this contract is render-only.
 */
export function drawGravitonEffects(
  ctx: CanvasRenderingContext2D,
  muzzle: Vec2,
  fx: GravitonFx,
  viewportWidth: number,
  viewportHeight: number,
): void {
  if (fx.chargeRatio > 0) {
    drawCharge(ctx, muzzle.x, muzzle.y, fx.chargeRatio);
  }
  if (fx.beam) {
    const beamLength = Math.hypot(viewportWidth, viewportHeight) * 1.15;
    drawBeam(
      ctx,
      muzzle.x,
      muzzle.y,
      fx.beam.angle,
      beamLength,
      fx.beam.alpha,
    );
  }
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private screenCtx: CanvasRenderingContext2D;
  private pipeline: PixelPipeline;
  private lighting = new Lighting();
  private post = new Post();
  private baker: ChunkBaker;
  private background: Background;
  private megastructure: MegaStructure;
  private lightShafts: LightShafts;
  private beacons: BeaconLights;
  private landmarkLights: LandmarkLights;
  private debugMode: string | null = null;
  /**
   * 直近フレームで算出したエイム角(ワールド空間・マウス方向)。
   * update側(main)がビーム/ボーリング方向として読む。1フレーム遅延は許容。
   */
  aimAngle = 0;
  /**
   * 直近フレームの present(同期ラスタ化+量子化+転写)の所要時間(ms)。計測用(main の ?stats=1)。
   * 描画コマンドはここで初めてラスタ化されるので、描画パスの重さもこの値に現れる。
   */
  lastPresentMs = 0;
  /** 直近 present の内訳 [getImageData, quantize, putImageData, 転写](ms)。PixelPipeline.lastParts。 */
  get lastPresentParts(): Float64Array {
    return this.pipeline.lastParts;
  }
  /** 次フレームの量子化前の生画素を複写させる(scripts/dumpframe.mjs)。複写後は lastRawFrame で読む。 */
  captureRawFrame(): void {
    this.pipeline.captureRaw = true;
  }
  get lastRawFrame(): Uint8ClampedArray | null {
    return this.pipeline.lastRaw;
  }
  get bufferSize(): { w: number; h: number } {
    return { w: this.pipeline.bufW, h: this.pipeline.bufH };
  }
  /**
   * true のとき描画段階ごとに 1×1 の getImageData で同期ラスタ化させ、段階ごとの所要時間(ms)を
   * stageMs に残す(main の ?stats=2 → scripts/frametime.mjs --stages)。バッチ化が崩れるので
   * 合計は通常より少し重くなるが、どの段階が重いかは分かる。
   */
  profileStages = false;
  stageMs: Record<string, number> = {};
  private stageT = 0;
  private mark(name: string): void {
    if (!this.profileStages) return;
    this.ctx.getImageData(0, 0, 1, 1);
    const t = performance.now();
    this.stageMs[name] = t - this.stageT;
    this.stageT = t;
  }
  /** drawSky の作業キャンバスと、その色・寸法のキー */
  private sky: { key: string; canvas: HTMLCanvasElement } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private seed: number,
  ) {
    this.screenCtx = canvas.getContext('2d')!;
    this.pipeline = new PixelPipeline(
      paletteRgb(),
      VIEW_TILES_X,
      HIGH_FIDELITY_TILE_PX,
    );
    this.ctx = this.pipeline.ctx;
    this.baker = new ChunkBaker(seed);
    this.background = new Background(seed);
    this.megastructure = new MegaStructure(seed);
    this.lightShafts = new LightShafts(seed);
    this.beacons = new BeaconLights(seed);
    this.landmarkLights = new LandmarkLights(seed);
  }

  setDebug(mode: string | null): void {
    this.debugMode = mode;
  }

  resize(w: number, h: number): void {
    this.canvas.width = w;
    this.canvas.height = h;
    this.pipeline.resize(w, h);
    this.ctx = this.pipeline.ctx;
    this.lighting.resize(this.pipeline.bufW, this.pipeline.bufH);
    this.post.resize(this.pipeline.bufW, this.pipeline.bufH);
  }

  /** ChunkStore.evictFarFromと対で呼ぶ(焼き込みキャッシュの解放) */
  evictFarFrom(cx: number, cy: number, radius: number): void {
    this.baker.evictFarFrom(cx, cy, radius);
  }

  /**
   * ChunkStore.applyDestructionと対で呼ぶ。ボーリングされたチャンクと、境界際の破壊で見た目が
   * 変わる隣接チャンクの焼き込み画像を再焼き込み待ちにする。affected は Destruction.bore の戻り値。
   */
  invalidateBored(affected: Iterable<string>, store: ChunkStore): void {
    for (const key of rebakeTargets(affected, (x, y) => store.destroyedMask(x, y), CHUNK_SIZE, REBAKE_DILATE)) {
      const [cx, cy] = key.split(',').map(Number);
      this.baker.invalidate(cx, cy);
    }
  }

  /**
   * 最初のフィル(縦グラデ)。CPUキャンバスへの全面グラデ塗りは1回約2.7msかかるため、色が変わった
   * ときだけ作業キャンバスへ塗り、毎フレームは等倍で貼る。シェイクで生じる端の隙間を隠すため
   * 少し外側まで塗る(shake=0でも無害)。グラデの座標は従来どおり内部バッファの 0..h。
   */
  private drawSky(
    ctx: CanvasRenderingContext2D, w: number, h: number, top: string, bottom: string,
    glow: { color: string; strips: GlowStrip[] },
  ): void {
    // 滲みの帯(§6.2)もここへ焼き込む。帯はアルファ 1/64 刻み・8 px 単位なので、立ち止まっていれば
    // キーは変わらず、歩いても数フレームに 1 回しか塗り直さない(毎フレーム全面 lighter を避ける)。
    const glowKey = glow.strips.map((s) => `${s.x0}-${s.x1}:${s.alpha}`).join(',');
    const key = `${w}x${h}:${top}:${bottom}:${glow.color}:${glowKey}`;
    if (this.sky?.key !== key) {
      const canvas = this.sky?.canvas ?? document.createElement('canvas');
      canvas.width = w + SKY_PAD * 2;
      canvas.height = h + SKY_PAD * 2;
      // 内部バッファと同じCPUラスタで塗る(GPUキャンバスだと貼るたびに読み戻しが起きる)
      const sctx = canvas.getContext('2d', { willReadFrequently: true })!;
      const grad = sctx.createLinearGradient(0, SKY_PAD, 0, SKY_PAD + h);
      grad.addColorStop(0, top);
      grad.addColorStop(1, bottom);
      sctx.fillStyle = grad;
      sctx.fillRect(0, 0, canvas.width, canvas.height);
      sctx.globalCompositeOperation = 'lighter';
      sctx.fillStyle = glow.color;
      for (const s of glow.strips) {
        if (s.alpha <= 0) continue;
        sctx.globalAlpha = s.alpha;
        // 端の帯は余白まで延ばす(シェイクで余白が見えても途切れない)
        const x0 = s.x0 === 0 ? 0 : s.x0 + SKY_PAD;
        const x1 = s.x1 === w ? canvas.width : s.x1 + SKY_PAD;
        sctx.fillRect(x0, 0, x1 - x0, canvas.height);
      }
      sctx.globalAlpha = 1;
      sctx.globalCompositeOperation = 'source-over';
      this.sky = { key, canvas };
    }
    ctx.drawImage(this.sky.canvas, -SKY_PAD, -SKY_PAD);
  }

  render(
    store: ChunkStore, cam: Camera, player: Player,
    mouseX: number, mouseY: number, timeSec: number,
    fx: GravitonFx,
  ): void {
    const w = this.pipeline.bufW;
    const h = this.pipeline.bufH;
    // cam.zoom<1 で ppt が縮み、画面に入るタイル数が増える(開放空間の豆粒化)
    const renderZoom = quantizeZoom(cam.zoom);
    const ppt = (w / VIEW_TILES_X) * renderZoom;
    const ctx = this.ctx;
    const renderCam = new Camera(
      Math.round(cam.x * ppt) / ppt,
      Math.round(cam.y * ppt) / ppt,
    );
    renderCam.zoom = renderZoom;

    // 発射直後の画面シェイク: シーン全体を微小にずらす。ビームの残光(alpha)に比例。
    // ctxを丸ごと平行移動するので各レイヤーは一貫してずれる。restoreで必ず戻す。
    const shake = fx.beam ? fx.beam.alpha * SHAKE_MAX : 0;
    if (this.profileStages) this.stageT = performance.now();
    ctx.save();
    if (shake > 0.01) {
      const internalShake = Math.max(1, Math.round(shake / this.pipeline.scale));
      ctx.translate(
        (Math.random() < 0.5 ? -1 : 1) * internalShake,
        (Math.random() < 0.5 ? -1 : 1) * internalShake,
      );
    }

    // バイオーム混合(背景・環境光で共有)
    const bb = biomeBlend(this.seed, player.centerX, player.body.y);
    // §6.3 の補正: 前室の光溜まりの中で +0.15、外で −0.1(距離補間)。暗幕・光条・ビネットにだけ掛け、
    // 空のフィルには掛けない(フィルは色キーで作業キャンバスを再生成するため、歩くたびに再描画が走る)。
    const ambient = clamp01(bb.ambientLevel + ambientDelta(this.seed, player.centerX, player.body.y));
    // 休憩点(§6.3)の中では暗幕の色を暖色へ寄せる(追加の描画なし。暗幕の 1 回のフィルの色が変わるだけ)
    const warmth = restWarmthAt(this.seed, player.centerX, player.body.y);
    const curtainColor = warmth > 0 ? mixHex(bb.ambientColor, REST_WARM_COLOR, 0.5 * warmth) : bb.ambientColor;

    // 背景(最初のフィル): ほぼ黒の鋼基準色をベースに、バイオーム環境色でわずかに持ち上げる。
    // ambientLevelが高いほど明るく色づき(水系統=大空洞帯は暗青の空気に)、
    // ambientの低い系統(廃棄物層など)はほぼ暗いまま。SOLIDタイルより必ず暗くしてシルエットを保つ。
    // 上を少し明るく下を暗くする縦グラデで開放空間に奥行きを与える。
    const lit = mixHex(STEEL.black, mixHex(bb.ambientColor, '#000000', 0.6), bb.ambientLevel);
    // 光の滲み(§6.2): 最寄りの大穴へ向かう横の明るさの偏りを空のフィルに焼き込む(遠景の背後)
    const glow = glowStrips(this.seed, renderCam.x, renderCam.y, w, ppt);
    this.drawSky(ctx, w, h, mixHex(lit, '#ffffff', 0.05 * bb.ambientLevel), mixHex(lit, '#000000', 0.45), glow);
    this.mark('sky');

    // パララックス遠景(バイオーム配色の多層構造)
    this.background.render(ctx, renderCam.x, renderCam.y, w, h, ppt, bb);
    this.mark('background');

    // 意味を持つ超構造(遠→中→近の深度＋かすみ)。焼き込みチャンクより背後、遠景パララックスより手前。
    this.megastructure.render(ctx, renderCam, w, h, ppt, bb);
    this.mark('megastructure');

    // 可視チャンクの焼き込み画像を貼る
    const chunkPx = CHUNK_SIZE * ppt;
    const cx0 = Math.floor((renderCam.x - w / ppt / 2) / CHUNK_SIZE);
    const cx1 = Math.floor((renderCam.x + w / ppt / 2) / CHUNK_SIZE);
    const cy0 = Math.floor((renderCam.y - h / ppt / 2) / CHUNK_SIZE);
    const cy1 = Math.floor((renderCam.y + h / ppt / 2) / CHUNK_SIZE);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const baked = this.baker.get(cx, cy, store);
        const sx = (cx * CHUNK_SIZE - renderCam.x) * ppt + w / 2;
        const sy = (cy * CHUNK_SIZE - renderCam.y) * ppt + h / 2;
        ctx.drawImage(baked, sx, sy, chunkPx, chunkPx);
      }
    }
    this.mark('chunks');

    // プレイヤー(コートの人影)
    const px = Math.round((player.centerX - renderCam.x) * ppt + w / 2);
    const py = Math.round((player.centerY - renderCam.y) * ppt + h / 2);
    const presentX = Math.floor(
      (this.canvas.width - this.pipeline.bufW * this.pipeline.scale) / 2,
    );
    const presentY = Math.floor(
      (this.canvas.height - this.pipeline.bufH * this.pipeline.scale) / 2,
    );
    const mbx = (
      mouseX - presentX
    ) / this.pipeline.scale;
    const mby = (
      mouseY - presentY
    ) / this.pipeline.scale;
    const angle = Math.atan2(mby - py, mbx - px);
    const isWalking = player.body.onGround && player.body.vx !== 0;
    const visualAnchors = drawPlayer(
      ctx,
      px,
      py,
      ppt,
      player.facing,
      player.walkPhase,
      isWalking,
      angle,
      bb.ambientColor,
      timeSec,
    );
    this.mark('player');

    // バイオーム環境光+プレイヤー補助光
    // 光柱と光溜まり(§6.2)は §6.3 により暗幕の上に lighter で描く(暗幕で消えない)。
    // §6 の合成順ではプレイヤーの前だが、暗幕の上に置く規則を優先する。暗幕の半解像度キャンバスへ
    // 描いて一緒に乗せる(全画面 lighter を 1 パス節約。lighter の矩形は画素数に比例して重い)。
    // 塔の点滅・裂け目の光条・休憩点の暖色(§6.2, §6.3)も同じ overlay へ相乗りする(新しいパスは足さない。
    // 矩形は 1 画面に数枚、1 枚 1 色)。
    this.lighting.render(ctx, px, py, angle, ppt, timeSec, curtainColor, ambient, (lctx, s) => {
      this.beacons.render(lctx, renderCam, w * s, h * s, ppt * s, timeSec);
      this.landmarkLights.render(lctx, renderCam, w * s, h * s, ppt * s, timeSec);
    });
    this.mark('lighting');

    // 光条(場所依存の体積光)。ライトの後・FX/postの前。暗く開けた空間だけに硬い光条が差す。
    this.lightShafts.render(ctx, renderCam, w, h, ppt, ambient);
    this.mark('shafts');

    // 重力子砲の演出: ライトの「上」に描いて発光体として読ませる。
    // ただし post(グレイン+ビネット)の「前」に描くことで画面全体の質感と馴染ませる。
    drawGravitonEffects(ctx, visualAnchors.muzzle, fx, w, h);
    this.mark('fx');

    // ポストプロセス(グレイン+ビネット)
    this.post.render(ctx, w, h, ambient);
    this.mark('post');

    if (this.debugMode && this.debugMode.startsWith('hierarchy')) {
      // 'hierarchy' または 'hierarchy:<tilesAcross>'。既定は広域俯瞰(40000タイル)。
      const n = Number(this.debugMode.split(':')[1]);
      const tilesAcross = Number.isFinite(n) && n > 0 ? n : 40000;
      drawHierarchyDebug(ctx, renderCam, this.seed, w, h, tilesAcross);
    }

    ctx.restore(); // シェイクの平行移動を戻す
    // update側がボーリング/ビーム方向として読めるよう、算出したエイム角を公開する
    this.aimAngle = angle;
    const tPresent = performance.now();
    this.pipeline.present(this.screenCtx, this.canvas.width, this.canvas.height);
    this.lastPresentMs = performance.now() - tPresent;

    // 同期焼き込みのなかったフレームだけ、先読み/再焼き込みを1仕事進める
    if (!this.baker.takeBakedThisFrame()) {
      const task = nextBakeTask({
        cx0, cx1, cy0, cy1,
        centerCx: Math.floor(player.centerX / CHUNK_SIZE),
        centerCy: Math.floor(player.centerY / CHUNK_SIZE),
        keepRadius: BAKE_KEEP_RADIUS,
        isBaked: (x, y) => this.baker.isFresh(x, y),
        isGenerated: (x, y) => store.has(x, y),
        isDecorReady: (x, y) => this.baker.isDecorReady(x, y),
      });
      if (task?.kind === 'generate') store.getChunk(task.cx, task.cy);
      else if (task?.kind === 'decor') this.baker.prepareDecor(task.cx, task.cy, store);
      else if (task?.kind === 'bake') this.baker.refresh(task.cx, task.cy, store);
    }
  }
}
