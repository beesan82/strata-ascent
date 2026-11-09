import { Camera } from '../core/camera';
import type { Player } from '../entities/player';
import type { BossPhase } from '../entities/enemy';
import type { DropKind } from '../world/drop';
import type { ChunkStore } from '../world/chunks';
import { CHUNK_SIZE } from '../world/tiles';
import { Background } from './background';
import { ChunkBaker, REBAKE_DILATE } from './chunkbake';
import { rebakeTargets } from './dirtyBounds';
import { Lighting } from './lighting';
import { biomeBlend, mixHex } from './biome';
import { STEEL } from './steel';
import { drawPlayer } from './playerSprite';
import { windupPose } from './bossPose';
import { Post } from './post';
import { drawHierarchyDebug } from './debugHierarchy';
import { drawBeam, drawCharge, drawChargeGlow } from './beam';
import { debrisFragments } from './beamShape';
import { shotShape, type ShotShape } from './shotShape';
import { MegaStructure } from './megastructure';
import { LightShafts } from './lightshaft';
import { BeaconLights, ambientDelta, glowStrips, type GlowStrip } from './beacon';
import { AmbientLights } from './ambient';
import { LandmarkLights, REST_WARM_COLOR } from './landmarkLight';
import { restWarmthAt } from '../world/restpoint';
import { HIGH_FIDELITY_TILE_PX, PixelPipeline } from './pixel';
import { paletteRgb } from './palette';
import { nextBakeTask } from './bakeSchedule';
import { poseMotionOf, type Vec2 } from './playerPose';

/** 画面の横幅に収めるタイル数(スケール感の基準) */
const VIEW_TILES_X = 34;

/**
 * 焼き込みキャッシュの保持半径(プレイヤーのチャンクからのチェビシェフ距離)。
 * 1枚1024×1024(~4MB)と重いので衝突ストアより狭くする。半径2 はプレイヤーのチャンクの端からでも
 * 128 タイル先まで保持する。眺望(ズーム 0.35)の視界は約 97×55 タイルで、手動眺望の中心オフセット
 * 40 タイルを足しても中心から横 88.5・縦 57.5 タイルなので、可視範囲+先読み1チャンクが常に収まる。
 */
export const BAKE_KEEP_RADIUS = 2;

/** 発射直後の「押し」の最大振幅(px、画面座標)。SKY_PAD 以下に収める */
const PUSH_MAX = 6;
/**
 * drawSky の作業キャンバスの余白(px)。PUSH_MAX 以上で、グラデのディザ位置が内部バッファと
 * そろうよう16の倍数にする(6だと量子化後に空の画素が約0.4%入れ替わった)。
 */
const SKY_PAD = 16;

/**
 * 溜めのグローを present 後に表示解像度で重ねるか(段階1 エフェクト設計 §2-5)。
 * render p50 の悪化が +0.5ms を超える場合は false にして in-buffer の演出だけで出す
 * (裁定は docs/superpowers/plans/2026-11-09-fx-stage1.md の末尾に記録する)。
 */
const CHARGE_GLOW_OVERLAY = true;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 発射直後の単発の「押し」(main が寿命比 t を渡す。方向はビームと逆向きに効く) */
export interface BeamPush {
  angle: number;
  /** 強さ(1=発射直後 → 0=消衰) */
  t: number;
}

/** 破片の発生点(ワールド座標)。形と配置は beamShape.debrisFragments が決める */
export interface DebrisFx {
  x: number;
  y: number;
  angle: number;
  /** 発射ごとのキー(決定論ハッシュの種) */
  key: number;
  /** 発生からの経過秒 */
  age: number;
}

/** 溜め中/発射ビームの演出パラメータ(main→renderへ毎フレーム渡す) */
export interface GravitonFx {
  /** 溜め比率(0..1)。>0でチャージ発光を描く */
  chargeRatio: number;
  /** 溜めが満タン(chargeRatio=1)になってからの経過秒。完了リングの拡大に使う。未指定は 0 */
  chargeFullT?: number;
  /** 生存中のビーム。nullなら描かない */
  beam: { angle: number; alpha: number } | null;
  /** 発射直後の単発の押し。null/未指定なら画面は動かない */
  push?: BeamPush | null;
  /** 破片の発生点(掘削点・命中点)。fx 相乗りで小矩形だけを描く */
  debris?: readonly DebrisFx[];
  /** パルスの弾(ワールド座標の中心と方向)。平坦色の短矩形で描く */
  pulses?: readonly { x: number; y: number; dx: number; dy: number }[];
  /** パルスの敵弾(固定砲台の弾、ワールド座標の中心と単位方向)。熱色系で描く */
  shots?: readonly { x: number; y: number; dx: number; dy: number }[];
  /** 敵(ワールド座標の中心と被弾フラッシュ)。平坦色の矩形で描く。flyer は飛行敵、
   *  turret は固定砲台(angle が照準方向)、w/h と bossPhase がある要素はボス(体格と相で描き分ける) */
  enemies?: readonly { x: number; y: number; flash: boolean; flyer?: boolean; turret?: boolean; angle?: number; w?: number; h?: number; bossPhase?: BossPhase; bossPhaseT?: number; bossDir?: 1 | -1 }[];
  /** ドロップ(ワールド座標の中心)。hidden は点滅の消灯側フレーム */
  drops?: readonly { x: number; y: number; kind: DropKind; hidden: boolean }[];
  /** 補給キャッシュ(ワールド座標の中心)。未開封のものだけ渡す */
  caches?: readonly { x: number; y: number }[];
}

/**
 * 弾(パルス・敵弾)を 2 層(外帯+芯)で描く。軸に沿った向きは従来どおり整数 px に丸めて置き
 * (回転なし・差分なし)、斜めは速度の角度で回転させる。回転描画は低解像度+量子化で
 * 階段状になるが、それがドット調として正しい(段階1 エフェクト設計 §1)。
 */
function drawShot(
  ctx: CanvasRenderingContext2D, sx: number, sy: number, shape: ShotShape,
  outerColor: string, coreColor: string,
): void {
  if (shape.axis !== 'diag') {
    const horiz = shape.axis === 'h';
    const ow = horiz ? shape.outerLen : shape.outerWid;
    const oh = horiz ? shape.outerWid : shape.outerLen;
    ctx.fillStyle = outerColor;
    ctx.fillRect(Math.round(sx - ow / 2), Math.round(sy - oh / 2), ow, oh);
    const cw = horiz ? shape.coreLen : shape.coreWid;
    const ch = horiz ? shape.coreWid : shape.coreLen;
    ctx.fillStyle = coreColor;
    ctx.fillRect(Math.round(sx - cw / 2), Math.round(sy - ch / 2), cw, ch);
    return;
  }
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(shape.angle);
  ctx.fillStyle = outerColor;
  ctx.fillRect(-shape.outerLen / 2, -shape.outerWid / 2, shape.outerLen, shape.outerWid);
  ctx.fillStyle = coreColor;
  ctx.fillRect(-shape.coreLen / 2, -shape.coreWid / 2, shape.coreLen, shape.coreWid);
  ctx.restore();
}

/**
 * Draws weapon effects from the visible muzzle. Gameplay destruction keeps its
 * existing player-center origin in main.ts; this contract is render-only.
 * timeSec は溜め演出(収束パーティクルの位相・電弧の形)の時刻。
 */
export function drawGravitonEffects(
  ctx: CanvasRenderingContext2D,
  muzzle: Vec2,
  fx: GravitonFx,
  viewportWidth: number,
  viewportHeight: number,
  ppt: number,
  timeSec = 0,
): void {
  if (fx.chargeRatio > 0) {
    drawCharge(ctx, muzzle.x, muzzle.y, fx.chargeRatio, fx.chargeFullT ?? 0, timeSec);
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
      ppt,
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
  private ambientLights: AmbientLights;
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
    this.ambientLights = new AmbientLights(seed);
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
   * 直近フレームの render の timeSec。invalidateBored が掘削縁の熱の加熱時刻を
   * 「直近フレーム時刻」で刻むために使う(発射は update 側で起きる)。
   */
  private timeSec = 0;

  /**
   * ChunkStore.applyDestructionと対で呼ぶ。ボーリングされたチャンクと、境界際の破壊で見た目が
   * 変わる隣接チャンクの焼き込み画像を再焼き込み待ちにする。affected は Destruction.bore の戻り値。
   * あわせて再焼き込み対象へ掘削縁の熱の加熱時刻を刻む(段階 3、熱表現の強化で段階制に)。
   */
  invalidateBored(affected: Iterable<string>, store: ChunkStore): void {
    for (const key of rebakeTargets(affected, (x, y) => store.destroyedMask(x, y), CHUNK_SIZE, REBAKE_DILATE)) {
      const [cx, cy] = key.split(',').map(Number);
      this.baker.invalidate(cx, cy);
      this.baker.markHot(cx, cy, this.timeSec);
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
    this.timeSec = timeSec;
    // 掘削縁の熱: 焼き込み側の現在時刻を渡し、冷却段階が進んだチャンクは 1 回だけ焼き直す
    this.baker.nowSec = timeSec;
    this.baker.advanceHeat(timeSec);
    // cam.zoom<1 で ppt が縮み、画面に入るタイル数が増える(開放空間の豆粒化)。
    // cam.zoom は段キーパー+advanceZoom(core/zoom.ts)が段へ寄せた描画ズームそのもの:
    // 段に静止しているときは段の値、段の間を遷移しているときだけ非段の値を取る
    const renderZoom = cam.zoom;
    const ppt = (w / VIEW_TILES_X) * renderZoom;
    const ctx = this.ctx;
    const renderCam = new Camera(
      Math.round(cam.x * ppt) / ppt,
      Math.round(cam.y * ppt) / ppt,
    );
    renderCam.zoom = renderZoom;

    // 発射直後の単発の「押し」: 発射方向と逆向きへ画面全体を押し、0.1 秒で減衰する。
    // 毎フレームのランダムな震え(旧シェイク)は廃止した(段階 3、設計 §5.1)。
    // ctxを丸ごと平行移動するので各レイヤーは一貫してずれる。restoreで必ず戻す。
    if (this.profileStages) this.stageT = performance.now();
    ctx.save();
    // 押しの平行移動量(px)。present 後のグローの銃口位置にも同じずれを足す
    let pushX = 0;
    let pushY = 0;
    if (fx.push && fx.push.t > 0) {
      const mag = (PUSH_MAX * fx.push.t) / this.pipeline.scale;
      if (mag >= 0.5) {
        pushX = Math.round(-Math.cos(fx.push.angle) * mag);
        pushY = Math.round(-Math.sin(fx.push.angle) * mag);
        ctx.translate(pushX, pushY);
      }
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
    this.background.render(ctx, renderCam.x, renderCam.y, w, h, ppt, bb, timeSec);
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
    // 無敵中は点滅させる(半透明に落とす)
    const invulnDim = player.invulnT > 0 && Math.floor(timeSec * 12) % 2 === 0;
    if (invulnDim) ctx.globalAlpha = 0.35;
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
      player.ledge !== null, // 崖つかみ中はぶら下がりポーズ(ポーズ決定に相乗り。パスは増えない)
      poseMotionOf(player), // 梯子・空中・着地・よじ登り復帰(設計 2026-11-09-anim-polish)
    );
    if (invulnDim) ctx.globalAlpha = 1;
    this.mark('player');

    // バイオーム環境光+プレイヤー補助光
    // 光柱と光溜まり(§6.2)は §6.3 により暗幕の上に lighter で描く(暗幕で消えない)。
    // §6 の合成順ではプレイヤーの前だが、暗幕の上に置く規則を優先する。暗幕の半解像度キャンバスへ
    // 描いて一緒に乗せる(全画面 lighter を 1 パス節約。lighter の矩形は画素数に比例して重い)。
    // 塔の点滅・裂け目の光条・休憩点の暖色(§6.2, §6.3)も同じ overlay へ相乗りする(新しいパスは足さない。
    // 矩形は 1 画面に数枚、1 枚 1 色)。休憩点の灯の明滅と水系の落下粒(§6.6)も同じ overlay(小矩形)。
    this.lighting.render(ctx, px, py, angle, ppt, timeSec, curtainColor, ambient, (lctx, s) => {
      this.beacons.render(lctx, renderCam, w * s, h * s, ppt * s, timeSec);
      this.landmarkLights.render(lctx, renderCam, w * s, h * s, ppt * s, timeSec);
      this.ambientLights.render(lctx, renderCam, w * s, h * s, ppt * s, timeSec);
    });
    this.mark('lighting');

    // 光条(場所依存の体積光)。ライトの後・FX/postの前。暗く開けた空間だけに硬い光条が差す。
    this.lightShafts.render(ctx, renderCam, w, h, ppt, ambient);
    this.mark('shafts');

    // 重力子砲の演出: ライトの「上」に描いて発光体として読ませる。
    // ただし post(グレイン+ビネット)の「前」に描くことで画面全体の質感と馴染ませる。
    drawGravitonEffects(ctx, visualAnchors.muzzle, fx, w, h, ppt, timeSec);

    // 破片: 同じ fx 相乗りで、決定論配置の小矩形だけを描く(新規パスなし)
    if (fx.debris && fx.debris.length > 0) {
      for (const d of fx.debris) {
        for (const f of debrisFragments(d.key, d.angle, d.age)) {
          const s = Math.max(1, Math.round(f.size * ppt));
          const sx = Math.round((d.x + f.dx - renderCam.x) * ppt + w / 2);
          const sy = Math.round((d.y + f.dy - renderCam.y) * ppt + h / 2);
          ctx.globalAlpha = f.alpha;
          ctx.fillStyle = f.color;
          ctx.fillRect(Math.round(sx - s / 2), Math.round(sy - s / 2), s, s);
        }
      }
      ctx.globalAlpha = 1;
    }

    // パルスの弾: 同じ fx 相乗りで、ビームと同じ文法の 2 層(外帯=鋼、芯=白)を速度の向きに
    // 回転させて描く(段階1 エフェクト設計 §1。新規パスなし)
    if (fx.pulses && fx.pulses.length > 0) {
      for (const p of fx.pulses) {
        const sx = Math.round((p.x - renderCam.x) * ppt + w / 2);
        const sy = Math.round((p.y - renderCam.y) * ppt + h / 2);
        drawShot(ctx, sx, sy, shotShape(p.dx, p.dy, ppt), '#51728d', '#c7d0ce');
      }
    }

    // 敵弾(固定砲台): パルスと同じ描き方の相乗りで、色だけ熱色系(外帯=錆、芯=金)に変える
    if (fx.shots && fx.shots.length > 0) {
      for (const p of fx.shots) {
        const sx = Math.round((p.x - renderCam.x) * ppt + w / 2);
        const sy = Math.round((p.y - renderCam.y) * ppt + h / 2);
        drawShot(ctx, sx, sy, shotShape(p.dx, p.dy, ppt), '#9a6d32', '#caa64a');
      }
    }

    // 敵: 同じ fx 相乗りで、世界の面構成の文法(胴の面・暗い下部・目の灯)に揃える(新規パスなし)。
    // 色はすべてパレット実在色(従来色は量子化で実質この色に寄っていた)。
    // 歩行敵は錆の胴+金の目、飛行敵は鋼の胴+白の目で区別する
    if (fx.enemies && fx.enemies.length > 0) {
      const band = Math.max(1, Math.round(0.18 * ppt));
      for (const e of fx.enemies) {
        const sx = Math.round((e.x - renderCam.x) * ppt + w / 2);
        const sy = Math.round((e.y - renderCam.y) * ppt + h / 2);
        if (e.w !== undefined && e.h !== undefined) {
          // ボス「広間番人」: 体格ぶんの胴 + プレートの継ぎ目 + 暗い足元 + 向き側の目の灯。
          // 相の違いを読ませる: 予備動作は進捗が読める合図(bossPose: 沈み込み・震え・
          // 加速する点滅と終盤の熱色固定・白くなる目)、突進は熱色(錆)、
          // 硬直は淡色に芯を晒す(撃ち時の合図)
          const bw = Math.max(2, Math.round(e.w * ppt));
          const bhFull = Math.max(2, Math.round(e.h * ppt));
          const pose = e.bossPhase === 'windup' ? windupPose(e.bossPhaseT ?? 0, timeSec) : null;
          // 沈み込み: 足元(下辺)を床に anchored のまま、高さだけが縮む
          const sinkPx = pose ? Math.round(pose.sinkTiles * ppt) : 0;
          const bh = Math.max(2, bhFull - sinkPx);
          const cx = sx + (pose ? Math.round(pose.shakeTiles * ppt) : 0);
          const x0 = Math.round(cx - bw / 2);
          const bottom = Math.round(sy + bhFull / 2);
          const top = bottom - bh;
          let color = '#5a3a24';
          if (pose) color = pose.bodyColor;
          else if (e.bossPhase === 'charge') color = '#9a6d32';
          else if (e.bossPhase === 'stunned') color = '#c7d0ce';
          ctx.fillStyle = e.flash ? '#c7d0ce' : color;
          ctx.fillRect(x0, top, bw, bh);
          // プレートの継ぎ目(縦 2 本 + 横 1 本)。相の色替え・フラッシュの上にも残す。
          // alpha は HARD 板の継ぎ目(0.9)に合わせる(薄いと量子化のディザで破線状に割れる)
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = '#3d2618';
          const seamW = Math.max(1, Math.round(0.06 * ppt));
          for (const fxr of [1 / 3, 2 / 3]) {
            ctx.fillRect(Math.round(x0 + bw * fxr - seamW / 2), top, seamW, bh);
          }
          ctx.fillRect(x0, Math.round(top + bh / 2 - seamW / 2), bw, seamW);
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#3d2618';
          ctx.fillRect(x0, bottom - band, bw, band);
          // 目の灯(向き側の上部 1 点)。歩行敵と同じ文法で、フラッシュ中は色を反転して残す。
          // 予備動作中は pose の色(金→終盤は白)で明るくする
          const eye = Math.max(1, Math.round(0.16 * ppt));
          const dir = e.bossDir ?? 1;
          ctx.fillStyle = e.flash ? '#9a6d32' : pose ? pose.eyeColor : '#caa64a';
          ctx.fillRect(
            Math.round(cx + dir * bw * 0.3 - eye / 2),
            Math.round(top + bh * 0.25 - eye / 2),
            eye,
            eye,
          );
          if (e.bossPhase === 'stunned' && !e.flash) {
            // 芯は金(パレット実在色)。淡色の本体と量子化後も分離して「撃ち時」を読ませる
            const coreW = Math.max(2, Math.round(bw * 0.3));
            const coreH = Math.max(2, Math.round(bh * 0.3));
            ctx.fillStyle = '#caa64a';
            ctx.fillRect(Math.round(cx - coreW / 2), Math.round(top + bh / 2 - coreH / 2), coreW, coreH);
          }
          continue;
        }
        if (e.turret) {
          // 固定砲台: 鋼色の胴の面 + 暗い台座 + 照準方向へ向く砲身 + 金の目の灯
          const s = Math.max(2, Math.round(0.9 * ppt));
          const x0 = Math.round(sx - s / 2);
          const y0 = Math.round(sy - s / 2);
          ctx.fillStyle = e.flash ? '#c7d0ce' : '#51728d';
          ctx.fillRect(x0, y0, s, s);
          // 暗い台座(下部の帯)
          ctx.fillStyle = '#16202b';
          ctx.fillRect(x0, y0 + s - band, s, band);
          // 砲身: 照準方向へ中心から 3 刻みの小矩形を並べる(平坦色・決定論)
          const ang = e.angle ?? 0;
          const bdx = Math.cos(ang);
          const bdy = Math.sin(ang);
          const barrel = Math.max(1, Math.round(0.18 * ppt));
          ctx.fillStyle = '#16202b';
          for (let i = 1; i <= 3; i++) {
            const bx = Math.round(sx + bdx * i * s * 0.22 - barrel / 2);
            const by = Math.round(sy + bdy * i * s * 0.22 - barrel / 2);
            ctx.fillRect(bx, by, barrel, barrel);
          }
          // 目の灯(金)。フラッシュ中は胴が淡色になるので鋼色へ反転して残す
          const eye = Math.max(1, Math.round(0.16 * ppt));
          ctx.fillStyle = e.flash ? '#51728d' : '#caa64a';
          ctx.fillRect(Math.round(sx - eye / 2), Math.round(sy - s * 0.18 - eye / 2), eye, eye);
          continue;
        }
        const s = Math.max(2, Math.round((e.flyer ? 0.8 : 0.9) * ppt));
        const x0 = Math.round(sx - s / 2);
        const y0 = Math.round(sy - s / 2);
        // 胴の面
        ctx.fillStyle = e.flash ? '#c7d0ce' : e.flyer ? '#51728d' : '#9a6d32';
        ctx.fillRect(x0, y0, s, s);
        // 暗い帯: 歩行敵は足元、飛行敵は上部(回転翼の見立て)
        ctx.fillStyle = e.flyer ? '#16202b' : '#3d2618';
        const bandY = e.flyer ? y0 : y0 + s - band;
        ctx.fillRect(x0, bandY, s, band);
        // 目の灯(1 点)。フラッシュ中は胴が淡色になるので色を反転して残す
        const eye = Math.max(1, Math.round(0.16 * ppt));
        ctx.fillStyle = e.flyer
          ? (e.flash ? '#51728d' : '#c7d0ce')
          : (e.flash ? '#9a6d32' : '#caa64a');
        ctx.fillRect(Math.round(sx - eye / 2), Math.round(sy - s * 0.18 - eye / 2), eye, eye);
      }
    }

    // ドロップ: 同じ fx 相乗りで平坦色だけ(新規パスなし)。
    // 砲弾セルは紫の角型+暗い芯、回復セルは緑の十字+淡い芯、糧食セルは金の横長+切り欠き、
    // 素材セルは鋼青の縦長+淡い上端帯で、色と形の両方で判別する。
    // 色は 32 色パレットの実在色を使う(任意色は量子化で別色相へ寄る: 例 #7fc46a→金 #caa64a)
    if (fx.drops && fx.drops.length > 0) {
      const s = Math.max(2, Math.round(0.5 * ppt));
      for (const d of fx.drops) {
        if (d.hidden) continue;
        const sx = Math.round((d.x - renderCam.x) * ppt + w / 2);
        const sy = Math.round((d.y - renderCam.y) * ppt + h / 2);
        if (d.kind === 'charge') {
          ctx.fillStyle = '#8d62cb';
          ctx.fillRect(Math.round(sx - s / 2), Math.round(sy - s / 2), s, s);
          const core = Math.max(1, Math.round(s * 0.45));
          ctx.fillStyle = '#30254c';
          ctx.fillRect(Math.round(sx - core / 2), Math.round(sy - core / 2), core, core);
        } else if (d.kind === 'ration') {
          // 糧食セル: 金の横長の塊+暗色の切り欠き(サバイバル設計 §5)。色はパレット実在色
          const hgt = Math.max(2, Math.round(s * 0.62));
          ctx.fillStyle = '#caa64a';
          ctx.fillRect(Math.round(sx - s / 2), Math.round(sy - hgt / 2), s, hgt);
          const notch = Math.max(1, Math.round(s * 0.3));
          ctx.fillStyle = '#3d2618';
          ctx.fillRect(Math.round(sx - notch / 2), Math.round(sy - hgt / 2), notch, hgt);
        } else if (d.kind === 'material') {
          // 素材セル(エクストラクション段階 A): 鋼青の縦長の塊+淡い上端帯。糧食(金の横長)とは
          // 向きと色、砲弾(紫の角型)とは色と縦横比で分ける。色はパレット実在色
          const wid = Math.max(2, Math.round(s * 0.62));
          ctx.fillStyle = '#3a73a4';
          ctx.fillRect(Math.round(sx - wid / 2), Math.round(sy - s / 2), wid, s);
          const cap = Math.max(1, Math.round(s * 0.3));
          ctx.fillStyle = '#c7d0ce';
          ctx.fillRect(Math.round(sx - wid / 2), Math.round(sy - s / 2), wid, cap);
        } else {
          ctx.fillStyle = '#3c755f';
          const t = Math.max(1, Math.round(s * 0.38));
          ctx.fillRect(Math.round(sx - t / 2), Math.round(sy - s / 2), t, s);
          ctx.fillRect(Math.round(sx - s / 2), Math.round(sy - t / 2), s, t);
          const core = Math.max(1, Math.round(s * 0.3));
          ctx.fillStyle = '#c7d0ce';
          ctx.fillRect(Math.round(sx - core / 2), Math.round(sy - core / 2), core, core);
        }
      }
    }

    // 補給キャッシュ(サバイバル §6): 同じ fx 相乗り。茶の荷袋+金の留め具+暗い底帯で、
    // ドロップ(小さい単体セル)とは体格と色で分ける。色はパレット実在色
    if (fx.caches && fx.caches.length > 0) {
      for (const c of fx.caches) {
        const sx = Math.round((c.x - renderCam.x) * ppt + w / 2);
        const sy = Math.round((c.y - renderCam.y) * ppt + h / 2);
        const bw = Math.max(3, Math.round(0.9 * ppt));
        const bh = Math.max(2, Math.round(0.55 * ppt));
        ctx.fillStyle = '#5a3a24';
        ctx.fillRect(Math.round(sx - bw / 2), Math.round(sy - bh / 2), bw, bh);
        const band = Math.max(1, Math.round(bh * 0.3));
        ctx.fillStyle = '#3d2618';
        ctx.fillRect(Math.round(sx - bw / 2), Math.round(sy + bh / 2) - band, bw, band);
        const clasp = Math.max(1, Math.round(bw * 0.22));
        ctx.fillStyle = '#caa64a';
        ctx.fillRect(Math.round(sx - clasp / 2), Math.round(sy - bh / 2), clasp, Math.max(1, Math.round(bh * 0.45)));
      }
    }
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

    ctx.restore(); // 「押し」の平行移動を戻す
    // update側がボーリング/ビーム方向として読めるよう、算出したエイム角を公開する
    this.aimAngle = angle;
    const tPresent = performance.now();
    this.pipeline.present(this.screenCtx, this.canvas.width, this.canvas.height);
    this.lastPresentMs = performance.now() - tPresent;

    // 溜めのグロー(設計 §2-5): 量子化の外側、表示解像度で銃口に放射グラデーションを lighter で 1 枚重ねる。
    // 銃口の表示座標は内部バッファ座標(押しのずれ込み)に present の整数倍率と余白を掛け足して求める
    // (新しい座標系は作らない)。画素中心に合わせるため +0.5 px してから拡大する
    if (CHARGE_GLOW_OVERLAY && fx.chargeRatio > 0) {
      const s = this.pipeline.scale;
      const gx = presentX + (visualAnchors.muzzle.x + pushX + 0.5) * s;
      const gy = presentY + (visualAnchors.muzzle.y + pushY + 0.5) * s;
      drawChargeGlow(this.screenCtx, gx, gy, s, fx.chargeRatio, fx.chargeFullT ?? 0);
    }

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
