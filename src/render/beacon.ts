import {
  ANTECHAMBER_DEPTH, ANTECHAMBER_FADE, ANTECHAMBER_HALF_WIDTH, PASSAGE_SLOT,
  interfaceBottom, interfaceTop, nearestPassage, passageX,
} from '../world/interface';
import { biomeCellAt } from '../world/biomeCells';
import { biomeForCell } from './biome';
import { holeCenterX } from './hardPlate';

/**
 * 光柱と導光(設計書 §6.2)・ライティング補正(§6.3)の幾何と強度。純粋関数のみ。
 * 描画は BeaconLights(同ファイル下部)と Background が行う。
 *
 * 座標の約束: Y は下向き正。cell c の板は cell c の上端 [interfaceTop(c), interfaceBottom(c)) にあり、
 * その下 48 タイルが前室(cell c の中)。板の上の層は cell c − 1 で、光はそこから来る。
 */

/** 光柱の半幅(タイル)。幅 24 */
export const BEACON_HALF_WIDTH = 12;
/** 光溜まりの芯の半径(タイル) */
export const POOL_CORE_RADIUS = 20;
/** 光溜まりの裾の半径(タイル)。大穴中心から孔の梯子(−48)までで、梯子は裾の縁に立つ */
export const POOL_FRINGE_RADIUS = 48;
/** 脈動の周期(秒)と振幅 */
export const PULSE_PERIOD = 7;
export const PULSE_AMPLITUDE = 0.15;
/**
 * 背景の滲み: 追従率、強度が最小になる水平距離、最小強度。横の形は glowStrength の折れ線そのもの
 * (設計書の「幅 300」の楕円は 1 画面内の勾配が小さすぎて方角が読めなかった。Background.glow 参照)。
 */
export const GLOW_FACTOR = 0.9;
export const GLOW_FALLOFF = 256;
export const GLOW_MIN = 0.15;
/** 界面の帯の追従率 */
export const BAND_FACTOR = 0.6;
/** §6.3: 光溜まりの中の ambientLevel 補正と、その外の補正 */
export const AMBIENT_IN_POOL = 0.15;
export const AMBIENT_OUT_POOL = -0.1;

export interface Beacon {
  cell: number;
  k: number;
  /** 大穴の中心 X(光柱の軸) */
  x: number;
  /** 板の下面 Y(光柱の上端) */
  top: number;
  /** 前室の床の行 Y(光柱の下端・光溜まりの位置) */
  floor: number;
  /** 上の層(cell−1)のバイオームの accent */
  color: string;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 板 cell の光柱色: 光は上の層(cell−1)から来る */
function beaconColor(seed: number, cell: number): string {
  return biomeForCell(seed, cell - 1).accent;
}

/** x に最寄りの大穴の中心 X(k0 とその両隣から選ぶ) */
export function nearestHoleX(seed: number, cell: number, x: number): number {
  const k0 = Math.floor(x / PASSAGE_SLOT);
  let best = holeCenterX(passageX(seed, cell, k0 - 1));
  for (let k = k0; k <= k0 + 1; k++) {
    const hx = holeCenterX(passageX(seed, cell, k));
    if (Math.abs(hx - x) < Math.abs(best - x)) best = hx;
  }
  return best;
}

/**
 * 視野(camX ± spanX/2, camY ± spanY/2)に掛かる光柱。光柱の矩形は
 * X が大穴中心 ± POOL_FRINGE_RADIUS、Y が板の下面から前室の床の行まで。
 */
export function beaconsInView(seed: number, camX: number, camY: number, spanX: number, spanY: number): Beacon[] {
  const x0 = camX - spanX / 2;
  const x1 = camX + spanX / 2;
  const y0 = camY - spanY / 2;
  const y1 = camY + spanY / 2;
  const out: Beacon[] = [];
  const c0 = biomeCellAt(seed, y0) - 1;
  const c1 = biomeCellAt(seed, y1) + 1;
  const k0 = Math.floor((x0 - PASSAGE_SLOT) / PASSAGE_SLOT);
  const k1 = Math.floor((x1 + PASSAGE_SLOT) / PASSAGE_SLOT);
  for (let cell = c0; cell <= c1; cell++) {
    const top = interfaceBottom(seed, cell);
    const floor = top + ANTECHAMBER_DEPTH;
    if (top > y1 || floor + 1 < y0) continue;
    for (let k = k0; k <= k1; k++) {
      const x = holeCenterX(passageX(seed, cell, k));
      if (x + POOL_FRINGE_RADIUS < x0 || x - POOL_FRINGE_RADIUS > x1) continue;
      out.push({ cell, k, x, top, floor, color: beaconColor(seed, cell) });
    }
  }
  return out;
}

/** 周期 7 秒で ±15% の脈動係数 */
export function beaconPulse(timeSec: number): number {
  return 1 + PULSE_AMPLITUDE * Math.sin((2 * Math.PI * timeSec) / PULSE_PERIOD);
}

/** 滲みの強度: 最寄りの大穴からの水平距離 0 で 1、256 で 0.15(線形)、以遠は 0.15 */
export function glowStrength(dx: number): number {
  return 1 - (1 - GLOW_MIN) * Math.min(1, Math.abs(dx) / GLOW_FALLOFF);
}

export interface BeaconGlow {
  /** 大穴の中心 X */
  x: number;
  /** 板の下面 Y */
  top: number;
  /** 前室の床の行 Y */
  floor: number;
  /** この層の下端(次の板の上面)Y。滲みは層の全高に広げる */
  layerBottom: number;
  strength: number;
  color: string;
}

/** 今いる層(カメラ Y の cell)の板の、最寄りの大穴に向かう滲み。縦坑の中でも同じ板を指す */
export function beaconGlowAt(seed: number, camX: number, camY: number): BeaconGlow {
  const cell = biomeCellAt(seed, camY);
  const x = nearestHoleX(seed, cell, camX);
  const top = interfaceBottom(seed, cell);
  return {
    x,
    top,
    floor: top + ANTECHAMBER_DEPTH,
    layerBottom: interfaceTop(seed, cell + 1),
    strength: glowStrength(camX - x),
    color: beaconColor(seed, cell),
  };
}

/**
 * 滲みの中心アルファ(強度 1 のとき)。滲みは暗幕(最大 0.62)の下にあり、さらに 32 色へ量子化される。
 * 0.22 では消え、0.45 では塔の矩形と空で量子化先が割れて紫の斑になった(スクリーンショットで確認)。
 */
export const GLOW_ALPHA = 0.6;
/** 滲みの帯の最小幅(内部バッファ px)と、帯のアルファの刻み(1/64) */
export const GLOW_STRIP_PX = 8;
export const GLOW_ALPHA_STEPS = 64;
/** 滲みの画面内の偏り: 大穴側の端を 1+この値、反対側の端を 1−この値に(大穴が画面外のとき) */
export const GLOW_LEAN = 0.6;

/** 滲みの平坦な帯(内部バッファの x 範囲 [x0, x1) とアルファ) */
export interface GlowStrip {
  x0: number;
  x1: number;
  alpha: number;
}

/**
 * 画面幅 w(内部バッファ px)を覆う滲みの帯。最寄りの大穴の X を頂点に、水平距離 0→1、256→0.15
 * (glowStrength の折れ線)を追従率 0.9 で横に並べ、縦は層の下へ行くほど弱める(板の下面で 1、
 * 次の板の上面で 0.4)。この折れ線をそのまま横の形にするので、最寄りの大穴(最大 256 タイル先)
 * までの範囲なら画面の中に必ず明るさの勾配があり、孔が画面外でも方角が読める(矢印は置かない)。
 * 設計書の「幅 300 タイル」の楕円は 1 画面(34 タイル)内の勾配が約 1 割で、暗幕と量子化の後に
 * 偏りが残らなかった。
 * グラデではなく平坦な帯にするのは present の量子化のため(列ごとに色が変わると「4 px 左と同色」
 * の近道が効かず、空の縦グラデとの組で色数がキャッシュを溢れさせた)。アルファは 1/64 刻みに量子化し
 * 同じ刻みの隣接帯は 1 本にまとめる(1 画面で 5 段前後)。帯は空のフィルに焼き込む(renderer.drawSky)。
 */
export function glowStrips(seed: number, camX: number, camY: number, w: number, ppt: number): { color: string; strips: GlowStrip[] } {
  const g = beaconGlowAt(seed, camX, camY);
  const depth = clamp01((camY - g.top) / (g.layerBottom - g.top));
  const a = GLOW_ALPHA * (1 - 0.6 * depth);
  const sx = (g.x - camX) * GLOW_FACTOR * ppt + w / 2;
  // 偏り: 大穴が画面外ならその側の端を (1+GLOW_LEAN)、反対の端を (1−GLOW_LEAN) 倍にする。
  // 1 画面(34 タイル)は 256 タイルの減衰の約 1 割しか跨がず、そのままでは量子化後に同じ色になる。
  // 大穴が画面中央にあるときは偏り 0、画面端に達するまで線形に強める。
  const lean = GLOW_LEAN * Math.max(-1, Math.min(1, (sx - w / 2) / (w / 2)));
  const strips: GlowStrip[] = [];
  let x0 = 0;
  let level = -1;
  // w が帯幅の倍数でなくても最後の帯が w で閉じるよう、終端は x >= w で明示的に扱う
  for (let x = 0; ; x += GLOW_STRIP_PX) {
    const atEnd = x >= w;
    const xc = x + GLOW_STRIP_PX / 2;
    const dxTiles = (xc - sx) / (GLOW_FACTOR * ppt);
    const tilt = 1 + lean * ((xc - w / 2) / (w / 2));
    const next = atEnd ? -1 : Math.round(Math.min(1, a * glowStrength(dxTiles) * tilt) * GLOW_ALPHA_STEPS);
    if (next !== level) {
      if (level >= 0) strips.push({ x0, x1: Math.min(x, w), alpha: level / GLOW_ALPHA_STEPS });
      x0 = Math.min(x, w);
      level = next;
    }
    if (atEnd) break;
  }
  return { color: g.color, strips };
}

export interface InterfaceBand {
  cell: number;
  top: number;
  bottom: number;
}

/** カメラ Y から上下 spanY(1 画面)以内に上面または下面がある板 */
export function interfaceBandsNear(seed: number, camY: number, spanY: number): InterfaceBand[] {
  const out: InterfaceBand[] = [];
  const c0 = biomeCellAt(seed, camY - spanY) - 1;
  const c1 = biomeCellAt(seed, camY + spanY) + 1;
  for (let cell = c0; cell <= c1; cell++) {
    const top = interfaceTop(seed, cell);
    const bottom = interfaceBottom(seed, cell);
    if (Math.abs(top - camY) <= spanY || Math.abs(bottom - camY) <= spanY) out.push({ cell, top, bottom });
  }
  return out;
}

/**
 * §6.3 の ambientLevel 補正。前室(板の下 0..48)の中で、光溜まりの芯(大穴中心 ±20)は +0.15、
 * 裾(±48)の外は −0.1、間は線形補間。前室の外縁 40 タイルで 0 へ戻す。前室の外は 0。
 */
export function ambientDelta(seed: number, x: number, y: number): number {
  const cell = biomeCellAt(seed, y);
  const dy = y - interfaceBottom(seed, cell);
  if (dy < 0 || dy > ANTECHAMBER_DEPTH) return 0;
  const px = nearestPassage(seed, cell, x).x;
  const fade = clamp01((ANTECHAMBER_HALF_WIDTH + ANTECHAMBER_FADE - Math.abs(x - px)) / ANTECHAMBER_FADE);
  if (fade === 0) return 0;
  const d = Math.abs(x - nearestHoleX(seed, cell, x));
  const u = clamp01((d - POOL_CORE_RADIUS) / (POOL_FRINGE_RADIUS - POOL_CORE_RADIUS));
  return fade * (AMBIENT_IN_POOL + (AMBIENT_OUT_POOL - AMBIENT_IN_POOL) * u);
}

/**
 * 光柱の基準アルファ(脈動前)。lighter 合成で暗幕の上に乗せる。柱(柔らかい縁)+芯+光溜まりが
 * 重なる軸上で合計 ≈ 0.3 になり、0.28 では accent が画面全体を飽和させた。
 */
const BEACON_ALPHA = 0.1;
/** 光柱の芯の半幅(タイル)。縁をぼかさない硬い部分 */
const CORE_HALF_WIDTH = 4;
/** 光溜まりの縦横比(床に寝た楕円) */
const POOL_ASPECT = 0.18;
/** 柱の柔らかい縁の段数 */
const SOFT_STEPS = 3;
/** 柱の芯の縦の段数と、上端・下端のアルファ倍率 */
const CORE_STEPS = 4;
const CORE_TOP = 1.4;
const CORE_BOTTOM = 0.6;
/** 光溜まりの楕円を近似する矩形の行数(上下それぞれ) */
const POOL_ROWS = 6;
/** 光溜まりの段(外側から): [半径(タイル), アルファ倍率]。裾 0.2、芯の外 0.6、芯 1.3(重ねない) */
const POOL_RINGS: ReadonlyArray<readonly [number, number]> = [
  [POOL_FRINGE_RADIUS, 0.2],
  [(POOL_CORE_RADIUS + POOL_FRINGE_RADIUS) / 2, 0.6],
  [POOL_CORE_RADIUS, 1.3],
];

/**
 * 光柱と光溜まりの描画(§6.2)。Lighting の暗幕の後に lighter で描く(§6.3: 暗幕で消えない)。
 * テスト対象外(Canvas)。幾何は beaconsInView、脈動は beaconPulse。
 */
export class BeaconLights {
  constructor(private seed: number) {}

  render(
    ctx: CanvasRenderingContext2D,
    cam: { x: number; y: number },
    w: number,
    h: number,
    ppt: number,
    timeSec: number,
  ): void {
    const beacons = beaconsInView(this.seed, cam.x, cam.y, w / ppt, h / ppt);
    if (beacons.length === 0) return;
    const a = BEACON_ALPHA * beaconPulse(timeSec);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of beacons) {
      const sx = (b.x - cam.x) * ppt + w / 2;
      const sy0 = (b.top - cam.y) * ppt + h / 2;
      const sy1 = (b.floor - cam.y) * ppt + h / 2;
      // 画面内の縦範囲だけ塗る(グラデ座標は板の下面〜床のまま)
      const yA = Math.max(sy0, 0);
      const yB = Math.min(sy1, h);
      // グラデは使わず平坦な段で塗る。グラデは画素ごとに色が変わり、present の量子化キャッシュ
      // (色×Bayer 位置のキー 2^16)を溢れさせて、柱 1 本で約 6 ms 増えた。
      ctx.fillStyle = b.color;
      if (yB > yA) {
        // 柱(柔らかい縁): 芯の外側を 3 段(0.25/0.5/0.75)で広げる
        const half = BEACON_HALF_WIDTH * ppt;
        const ch = CORE_HALF_WIDTH * ppt;
        const step = (half - ch) / SOFT_STEPS;
        for (let i = 0; i < SOFT_STEPS; i++) {
          ctx.globalAlpha = a * ((i + 1) / (SOFT_STEPS + 1));
          const inner = half - step * (i + 1);
          ctx.fillRect(sx - inner - step, yA, step, yB - yA);
          ctx.fillRect(sx + inner, yA, step, yB - yA);
        }
        // 柱の芯(硬い縁): 板の下面で強く、床へ向かって 4 段で弱まる
        const segH = (sy1 - sy0) / CORE_STEPS;
        for (let i = 0; i < CORE_STEPS; i++) {
          const y0 = Math.max(yA, sy0 + segH * i);
          const y1 = Math.min(yB, sy0 + segH * (i + 1));
          if (y1 <= y0) continue;
          ctx.globalAlpha = a * (CORE_TOP - (CORE_TOP - CORE_BOTTOM) * (i / (CORE_STEPS - 1)));
          ctx.fillRect(sx - ch, y0, ch * 2, y1 - y0);
        }
      }
      // 光溜まり: 床の行の上端に寝た楕円を 3 重の平坦な段で描く。芯(20)は明るく、裾(48)は孔の梯子まで届く。
      // 楕円パスは lighter だと矩形の数倍遅い(3 枚で約 3.5 ms)ので、楕円を横長の矩形の階段で近似する
      // (ドット絵なので階段は馴染む)。
      const rx = POOL_FRINGE_RADIUS * ppt;
      const ry = rx * POOL_ASPECT;
      if (sy1 + ry >= 0 && sy1 - ry <= h && sx + rx >= 0 && sx - rx <= w) {
        // 段は重ねず、外側の環から順に「外の楕円 − 内の楕円」の帯だけを塗る(各画素を 1 回しか合成しない)。
        // 行の高さは一番外の楕円で決め、各行の中央高さでの半幅を外・内それぞれ求める。
        const rowH = ry / POOL_ROWS;
        for (let i = 0; i < POOL_RINGS.length; i++) {
          const [rOut, alpha] = POOL_RINGS[i];
          const rIn = i + 1 < POOL_RINGS.length ? POOL_RINGS[i + 1][0] : 0;
          ctx.globalAlpha = a * alpha;
          const rxOut = rOut * ppt;
          const rxIn = rIn * ppt;
          for (let j = 0; j < POOL_ROWS; j++) {
            const yMid = rowH * (j + 0.5);
            const tOut = yMid / (rxOut * POOL_ASPECT);
            if (tOut >= 1) continue;
            const hwOut = rxOut * Math.sqrt(1 - tOut * tOut);
            const tIn = rxIn > 0 ? yMid / (rxIn * POOL_ASPECT) : 1;
            const hwIn = tIn < 1 ? rxIn * Math.sqrt(1 - tIn * tIn) : 0;
            for (const yTop of [sy1 - rowH * (j + 1), sy1 + rowH * j]) {
              if (hwIn > 0) {
                ctx.fillRect(sx - hwOut, yTop, hwOut - hwIn, rowH);
                ctx.fillRect(sx + hwIn, yTop, hwOut - hwIn, rowH);
              } else {
                ctx.fillRect(sx - hwOut, yTop, hwOut * 2, rowH);
              }
            }
          }
        }
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
}
