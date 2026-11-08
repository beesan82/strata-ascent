import type { ChunkStore } from '../world/chunks';
import { CHUNK_SIZE, TILE, isSolid } from '../world/tiles';
import { blobId } from './tileset/autotile';
import type { Atlas } from './tileset/atlas';
import { generateAtlas, type TilePalette } from './tileset/generate';
import { regionAt } from '../world/hierarchy';
import { conduitAt } from '../world/network';
import { facilityTileAt } from '../world/facility';
import { megaFacilityAt } from '../world/megafacility';
import { nearestPassage, terrainModsAt } from '../world/interface';
import { biomeCellAt, biomeIdForCell } from '../world/biomeCells';
import {
  EDGE_PX, HARD_EDGE_BOTTOM, HARD_EDGE_SIDE, HARD_EDGE_TOP, HARD_FILL, HARD_SEAM,
  hardEdgeStrength, hardRibAt, hardSeamAt, holeCenterX,
} from './hardPlate';
import { biomeBlend, blendBiomeVisuals, mixHex, type BiomeBlend } from './biome';
import { reliefEdges, reliefBands, rimSegments } from './tileset/relief';
import { plateAt } from './tileset/plate';
import { stainSegmentAt } from './stains';
import { DECOR_MARGIN, DecorCache, decorOpBounds, type DecorOp } from './decor';
import { craterCells, dirtyBoundsAround, expandRect, type CellRect } from './dirtyBounds';
import { restLampCellAt, restTallyCellAt, REST_TALLY_STROKES, traceAt, type Trace } from './traces';
import { restLampColor } from './landmarkLight';
import { STEEL } from './steel';

/** 焼き込み解像度(px/タイル)。表示は拡縮されるが16pxあれば線は読める */
export const BAKE_PPT = 16;

/** #rrggbb を rgba() 文字列にする(灯の暈のグラデーション用) */
function rgbaOf(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Bounds the atlas cache while retaining visible progress through the 400-tile blend band. */
export const CHUNK_VISUAL_BLEND_STEPS = 16;
/**
 * 部分再焼き込みで破壊タイルから広げる幅(タイル)。破壊の影響は隣接タイルのオートタイル/
 * 陰影、1〜2タイル上の痕跡・水面判定と、それらのはみ出し(灯の光暈≈0.5タイル)に収まる。
 */
export const REBAKE_DILATE = 2;
/**
 * 先読みの新規焼き込みを分ける帯の高さ(タイル)。1チャンク全面を1フレームで焼くと JS 約25ms に加え
 * フレーム末のラスタ化が約40ms 乗るので、帯ごとに別フレームで焼いて写す。
 */
const PREFETCH_BAND = 8;

export interface ChunkVisual extends BiomeBlend {
  cacheKey: string;
}

/** Resolve the deterministic visual palette at a chunk center, independent of facility regions. */
export function chunkVisualAt(seed: number, cx: number, cy: number): ChunkVisual {
  const centerX = cx * CHUNK_SIZE + CHUNK_SIZE / 2;
  const centerY = cy * CHUNK_SIZE + CHUNK_SIZE / 2;
  const exact = biomeBlend(seed, centerX, centerY);
  const step = exact.from === exact.to ? 0 : Math.round(exact.t * CHUNK_VISUAL_BLEND_STEPS);
  const t = step / CHUNK_VISUAL_BLEND_STEPS;
  return {
    ...blendBiomeVisuals(exact.from, exact.to, t),
    cacheKey: `${exact.from.name}>${exact.to.name}:${step}`,
  };
}

/** チャンク1枚を一度だけオフスクリーンCanvasへ焼き込み、以後はdrawImageで貼る */
export class ChunkBaker {
  private cache = new Map<string, HTMLCanvasElement>();
  /** 無効化済みで再焼き込み待ちのチャンク(画像は cache に古いまま残す) */
  private stale = new Set<string>();
  private bakedThisFrame = false;
  private patterns = new Map<string, CanvasPattern>();
  /** バイオーム名 → タイルアトラス(生成は高価なのでキャッシュ) */
  private atlasByBiome = new Map<string, Atlas>();
  /** 装飾はボーリング後の再焼き込みでも変わらないので使い回す */
  private decor: DecorCache;
  /** 部分再焼き込みの作業用キャンバス(全面サイズ、使い回す) */
  private scratch: HTMLCanvasElement | null = null;
  /** 装飾・配管の作業レイヤー(decorLayer) */
  private layer: HTMLCanvasElement | null = null;
  /** 帯ごとに焼いている途中の先読みチャンク(次に焼く帯の先頭行)。完成するまで cache には入れない */
  private pending = new Map<string, { canvas: HTMLCanvasElement; nextRow: number }>();

  constructor(private seed: number) {
    this.decor = new DecorCache(seed);
  }

  /** バイオームに対応する色付きアトラスを取得(なければ生成してキャッシュ) */
  private atlasFor(key: string, palette: TilePalette): Atlas {
    let atlas = this.atlasByBiome.get(key);
    if (!atlas) {
      atlas = generateAtlas(palette);
      this.atlasByBiome.set(key, atlas);
    }
    return atlas;
  }

  get size(): number {
    return this.cache.size;
  }

  /**
   * 焼き込み画像を返す。未焼き込みならその場で焼く(可視チャンクに穴を開けないため)。
   * 無効化済み(stale)の画像は、再焼き込みされるまで古いまま返す。
   */
  get(cx: number, cy: number, store: ChunkStore): HTMLCanvasElement {
    const key = `${cx},${cy}`;
    let canvas = this.cache.get(key);
    if (!canvas) {
      canvas = this.bake(cx, cy, store);
      this.cache.set(key, canvas);
      this.pending.delete(key);
      this.bakedThisFrame = true;
    }
    return canvas;
  }

  /** 最新の焼き込み画像があるか(未焼き込み・無効化済みなら false) */
  isFresh(cx: number, cy: number): boolean {
    const key = `${cx},${cy}`;
    return this.cache.has(key) && !this.stale.has(key);
  }

  /**
   * 先読み/再焼き込み: 指定チャンクを(再)焼き込みしてキャッシュする。
   * 無効化済みの画像があれば、破壊タイル(境界際の隣チャンク分を含む)の外接矩形だけを描き直して
   * 同じキャンバスへ写す(新規キャンバスを作らない)。写した範囲は全面焼き込みと同じ画素になる。
   * 未焼き込みのチャンクは PREFETCH_BAND 行ずつ焼き、全部の帯が揃った時点で cache に入れる
   * (それまで isFresh は false のままなので、スケジューラが次のフレームで続きを頼む)。
   */
  refresh(cx: number, cy: number, store: ChunkStore): void {
    const key = `${cx},${cy}`;
    const old = this.cache.get(key);
    const clip = old && this.stale.has(key)
      ? dirtyBoundsAround((x, y) => store.destroyedMask(x, y), cx, cy, CHUNK_SIZE, REBAKE_DILATE)
      : null;
    if (old && clip) {
      this.bakeRectInto(old, clip, cx, cy, store);
    } else if (!old) {
      let p = this.pending.get(key);
      if (!p) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = CHUNK_SIZE * BAKE_PPT;
        p = { canvas, nextRow: 0 };
        this.pending.set(key, p);
      }
      const h = Math.min(PREFETCH_BAND, CHUNK_SIZE - p.nextRow);
      this.bakeRectInto(p.canvas, { x: 0, y: p.nextRow, w: CHUNK_SIZE, h }, cx, cy, store);
      p.nextRow += h;
      if (p.nextRow < CHUNK_SIZE) return;
      this.pending.delete(key);
      this.cache.set(key, p.canvas);
    } else {
      this.cache.set(key, this.bake(cx, cy, store));
    }
    this.stale.delete(key);
  }

  /** 装飾・配管を描く作業レイヤー(全面サイズ、使い回す) */
  private decorLayer(): HTMLCanvasElement {
    if (!this.layer) {
      this.layer = document.createElement('canvas');
      this.layer.width = this.layer.height = CHUNK_SIZE * BAKE_PPT;
    }
    return this.layer;
  }

  /** 装飾・配管を切り抜くクレーターのセル(破壊済み かつ 元地形が空気でない) */
  private craterOf(cx: number, cy: number, store: ChunkStore): CellRect[] {
    const destroyed = store.destroyedMask(cx, cy);
    return destroyed ? craterCells(destroyed, store.pristineAround(cx, cy, 0), CHUNK_SIZE) : [];
  }

  /**
   * rect(タイル単位)の範囲だけを全面焼き込みと同じ画素で描き、target へ写す。
   * クリップは使わない(クリップ端の画素が全面焼き込みと食い違う)。範囲+1タイルだけを作業キャンバスへ
   * 描き、範囲の矩形を等倍・整数座標で写す。CPUキャンバス同士なので写すのは単なる画素コピー。
   */
  private bakeRectInto(target: HTMLCanvasElement, rect: CellRect, cx: number, cy: number, store: ChunkStore): void {
    if (!this.scratch) {
      this.scratch = document.createElement('canvas');
      this.scratch.width = this.scratch.height = CHUNK_SIZE * BAKE_PPT;
    }
    this.bake(cx, cy, store, this.scratch, expandRect(rect, 1, CHUNK_SIZE));
    const P = BAKE_PPT;
    const tctx = target.getContext('2d', { willReadFrequently: true })!;
    tctx.clearRect(rect.x * P, rect.y * P, rect.w * P, rect.h * P);
    tctx.drawImage(this.scratch, rect.x * P, rect.y * P, rect.w * P, rect.h * P, rect.x * P, rect.y * P, rect.w * P, rect.h * P);
  }

  /** 焼き込みに使う装飾が計算済みか(先読みスケジューラ用) */
  isDecorReady(cx: number, cy: number): boolean {
    return this.decor.has(cx, cy);
  }

  /** 焼き込みの前に装飾だけを計算しておく(焼き込みとは別フレームの仕事にするため) */
  prepareDecor(cx: number, cy: number, store: ChunkStore): void {
    this.decorFor(cx, cy, store);
  }

  /** 装飾(元地形は ChunkStore の生成済みチャンクから取り、worldgen を引き直さない) */
  private decorFor(cx: number, cy: number, store: ChunkStore): DecorOp[] {
    return this.decor.get(cx, cy, () => store.pristineAround(cx, cy, DECOR_MARGIN));
  }

  /** このフレームで重い仕事(get の同期焼き込み・無効化)があったか。読むとリセットされる */
  takeBakedThisFrame(): boolean {
    const v = this.bakedThisFrame;
    this.bakedThisFrame = false;
    return v;
  }

  /**
   * 指定チャンクの焼き込み画像を無効化する。ChunkStore.applyDestructionと対で呼ぶ。
   * 画像は再焼き込みまで古いものを表示し続け、発射フレームに焼き込みが集中するのを避ける。
   */
  invalidate(cx: number, cy: number): void {
    const key = `${cx},${cy}`;
    if (this.cache.has(key)) this.stale.add(key);
    // 帯ごとに焼いている途中なら、焼き済みの帯が古いので最初からやり直す
    this.pending.delete(key);
    // 発射フレームは破壊計算を済ませた後なので、再焼き込みは次フレームから始める
    this.bakedThisFrame = true;
  }

  /** ChunkStoreのevictFarFromと同じ規則でキャッシュを破棄する(main側で対で呼ぶ) */
  evictFarFrom(cx: number, cy: number, radius: number): void {
    for (const key of this.cache.keys()) {
      const [kx, ky] = key.split(',').map(Number);
      if (Math.max(Math.abs(kx - cx), Math.abs(ky - cy)) > radius) {
        this.cache.delete(key);
        this.stale.delete(key);
      }
    }
    for (const key of this.pending.keys()) {
      const [kx, ky] = key.split(',').map(Number);
      if (Math.max(Math.abs(kx - cx), Math.abs(ky - cy)) > radius) this.pending.delete(key);
    }
    this.decor.evictFarFrom(cx, cy, radius);
  }

  /**
   * target を渡すとそのキャンバスの tiles(タイル単位)の範囲を消し、その中のタイルだけを描く
   * (部分再焼き込み用。装飾は全体を描く)。正しい画素になるのは tiles の外周1タイル幅を除いた内側だけ。
   */
  private bake(
    cx: number, cy: number, store: ChunkStore,
    target?: HTMLCanvasElement, tiles?: CellRect,
  ): HTMLCanvasElement {
    const px = CHUNK_SIZE * BAKE_PPT;
    const canvas = target ?? document.createElement('canvas');
    if (!target) {
      canvas.width = px;
      canvas.height = px;
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    // 再利用時に前回の描画状態を持ち越さないよう、焼き込み全体を save/restore で囲む
    ctx.save();
    const span = tiles ?? { x: 0, y: 0, w: CHUNK_SIZE, h: CHUNK_SIZE };
    if (target) ctx.clearRect(span.x * BAKE_PPT, span.y * BAKE_PPT, span.w * BAKE_PPT, span.h * BAKE_PPT);
    // タイルは滑らかに陰影付けされているが、境界で隣接アトラスセルを拾わないよう
    // スムージングを無効化してエッジをこの解像度で明瞭に保つ。
    ctx.imageSmoothingEnabled = false;
    // タイル単位の描画はタイルから最大0.5タイル程度しかはみ出さないので、部分再焼き込みでは
    // 写す範囲+1タイルのタイルだけを回せば、写す範囲の画素は全面焼き込みと同じになる
    const chunk = store.getChunk(cx, cy);
    const bx = cx * CHUNK_SIZE;
    const by = cy * CHUNK_SIZE;
    // 近傍参照(最大2タイル下)はチャンク+周囲2タイルの配列から読む。タイルごとの store.tileAt は
    // Map を文字列キーで引くため、焼き込み1回で数万回になり重かった。
    const NEAR_PAD = 2;
    const nearN = CHUNK_SIZE + NEAR_PAD * 2;
    const near = store.tilesAround(cx, cy, NEAR_PAD);
    const around = (lx: number, ly: number): number => near[(ly + NEAR_PAD) * nearN + lx + NEAR_PAD];

    // Tile palette and accent follow the visual-cell blend at the chunk center.
    // Facility-only effects still consult the independent hierarchy system below.
    const centerX = cx * CHUNK_SIZE + CHUNK_SIZE / 2;
    const centerYw = cy * CHUNK_SIZE + CHUNK_SIZE / 2;
    const system = regionAt(this.seed, centerX, centerYw).system;
    const biome = chunkVisualAt(this.seed, cx, cy);
    const atlas = this.atlasFor(biome.cacheKey, biome.palette);

    // ベース: SOLIDタイルを8近傍から求めたブロブIDでオートタイル描画する。
    // 近傍参照は周囲込みの配列経由なのでチャンクをまたいでも継ぎ目なく一致する。
    // HARD(界面の板)は近傍としては固体(ブロブが繋がる)だが、自身は専用パスで平坦に塗る。
    for (let ty = span.y; ty < span.y + span.h; ty++) {
      for (let tx = span.x; tx < span.x + span.w; tx++) {
        if (chunk[ty * CHUNK_SIZE + tx] !== TILE.SOLID) continue;
        const nb = {
          n: isSolid(around(tx, ty - 1)),
          e: isSolid(around(tx + 1, ty)),
          s: isSolid(around(tx, ty + 1)),
          w: isSolid(around(tx - 1, ty)),
          ne: isSolid(around(tx + 1, ty - 1)),
          se: isSolid(around(tx + 1, ty + 1)),
          sw: isSolid(around(tx - 1, ty + 1)),
          nw: isSolid(around(tx - 1, ty - 1)),
        };
        const r = atlas.rect(blobId(nb));
        ctx.drawImage(
          atlas.source,
          r.sx, r.sy, r.sw, r.sh,
          tx * BAKE_PPT, ty * BAKE_PPT, BAKE_PPT + 1, BAKE_PPT + 1,
        );
      }
    }

    // プレート単位の面の明度構造(段階 1、設計 §3.1)。アトラスはバイオーム単位でキャッシュされ
    // ワールド座標を持たないため、プレートの明度段・継ぎ目・角リベットはここで重ねる。
    // 割り付けはワールド座標のハッシュのみから決まるので、部分再焼き込みでも全面と一致する。
    // 明度段はパレット実在色の重ねで作る(暗段=STEEL.black、明段=#c7d0ce(パレット 27 番))。
    for (let ty = span.y; ty < span.y + span.h; ty++) {
      for (let tx = span.x; tx < span.x + span.w; tx++) {
        if (chunk[ty * CHUNK_SIZE + tx] !== TILE.SOLID) continue;
        const plate = plateAt(this.seed, bx + tx, by + ty);
        const x0 = tx * BAKE_PPT;
        const y0 = ty * BAKE_PPT;
        if (plate.tone === 0) {
          ctx.globalAlpha = 0.3;
          ctx.fillStyle = STEEL.black;
          ctx.fillRect(x0, y0, BAKE_PPT, BAKE_PPT);
        } else if (plate.tone === 2) {
          ctx.globalAlpha = 0.08;
          ctx.fillStyle = '#c7d0ce';
          ctx.fillRect(x0, y0, BAKE_PPT, BAKE_PPT);
        }
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = biome.palette.line;
        if (plate.seamTop) ctx.fillRect(x0, y0, BAKE_PPT, 1);
        if (plate.seamLeft) ctx.fillRect(x0, y0, 1, BAKE_PPT);
        // プレート四隅のリベット(角のタイルだけが自分の角を描く)
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = biome.palette.edge;
        const rivet = (cx: number, cy: number) => {
          ctx.beginPath(); ctx.arc(cx, cy, 1.3, 0, Math.PI * 2); ctx.fill();
        };
        const inset = 2;
        if (plate.lx === 0 && plate.ly === 0) rivet(x0 + inset, y0 + inset);
        if (plate.lx === plate.w - 1 && plate.ly === 0) rivet(x0 + BAKE_PPT - inset, y0 + inset);
        if (plate.lx === 0 && plate.ly === plate.h - 1) rivet(x0 + inset, y0 + BAKE_PPT - inset);
        if (plate.lx === plate.w - 1 && plate.ly === plate.h - 1) rivet(x0 + BAKE_PPT - inset, y0 + BAKE_PPT - inset);
        // 垂れ汚れ・錆の滲み(段階 1、設計 §3.1)。プレート上面からプレート内だけに垂れる。
        // 錆色 #9a6d32 はパレット 30 番の実在色。
        const stain = stainSegmentAt(this.seed, bx + tx, by + ty, plate);
        if (stain) {
          ctx.globalAlpha = (stain.kind === 1 ? 0.2 : 0.26) * stain.fade;
          ctx.fillStyle = stain.kind === 1 ? '#9a6d32' : STEEL.black;
          const sw = stain.w * BAKE_PPT;
          ctx.fillRect((tx + stain.cx) * BAKE_PPT - sw / 2, y0, sw, BAKE_PPT);
        }
      }
    }
    ctx.globalAlpha = 1;

    // 後退内面(厚み)＋上端リムライト。空気に面したSOLIDエッジに、露出面から内側へ純黒へ
    // 後退する暗帯を敷き、歩ける上端に明るいリム線を引く(可読性)。焼き込みのみ・当たり無改修。
    // 濃さ/深さは ambientLevel 連動で、明バイオームでは控えめにして足場を読める範囲に保つ。
    // リムは段階 1 で間引いた: 上端のみ弱めて残し(alpha 0.55・幅 0.08)、側面・下端は消す
    // (全辺の均一な発光が「図面」に見える主因だったため。立体感は陰影帯と面の段差で作る)。
    const P = BAKE_PPT;
    const reliefDepth = 0.24 + (1 - biome.ambientLevel) * 0.12; // 0.24〜0.36 タイル
    const bandAlpha = 0.32 + (1 - biome.ambientLevel) * 0.34;   // 0.32〜0.66
    const rimTopColor = mixHex(biome.palette.edge, '#ffffff', 0.4);
    for (let ty = span.y; ty < span.y + span.h; ty++) {
      for (let tx = span.x; tx < span.x + span.w; tx++) {
        if (chunk[ty * CHUNK_SIZE + tx] !== TILE.SOLID) continue; // HARD は陰影帯・リムを付けない(平坦)
        const edges = reliefEdges(
          isSolid(around(tx, ty - 1)),
          isSolid(around(tx + 1, ty)),
          isSolid(around(tx, ty + 1)),
          isSolid(around(tx - 1, ty)),
        );
        ctx.globalAlpha = 1; // 前タイルのリムで変えたalphaを帯描画前にリセット
        for (const b of reliefBands(edges, reliefDepth)) {
          const grad = ctx.createLinearGradient(
            (tx + b.from[0]) * P, (ty + b.from[1]) * P,
            (tx + b.to[0]) * P, (ty + b.to[1]) * P,
          );
          grad.addColorStop(0, `rgba(2,4,10,${bandAlpha})`);
          grad.addColorStop(1, 'rgba(2,4,10,0)');
          ctx.fillStyle = grad;
          ctx.fillRect((tx + b.x) * P, (ty + b.y) * P, b.w * P, b.h * P);
        }
        for (const s of rimSegments(edges)) {
          if (!s.top) continue; // 側面・下端のリムは廃止(段階 1)
          ctx.strokeStyle = rimTopColor;
          ctx.globalAlpha = 0.55;
          ctx.lineWidth = Math.max(1, 0.08 * P);
          ctx.beginPath();
          ctx.moveTo((tx + s.x1) * P, (ty + s.y1) * P);
          ctx.lineTo((tx + s.x2) * P, (ty + s.y2) * P);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;

    this.bakeHardPlates(ctx, chunk, around, bx, by, span);

    // 装飾(アトラスが描く表面線画=surfaceタグ付きはスキップ、物理装飾は残す)。
    // モックの色構成に合わせ、物理装飾は鋼ランプ由来のPALETTE色のまま焼く
    // (旧accent置換は廃止。暖色は錆・灯のみに限定する)。
    // 装飾と配管は元地形から決まるので、破壊で消えたセル(元が空気でないもの)を消してから重ねる。
    // クリップで切り抜くと、穴と同じ行に掛かる命令まで描き方(縁のAA)が変わり、部分再焼き込みと
    // 食い違う。そこで別の透明なレイヤーへ描き、クレーターのセルを clearRect(16px単位で正確)で
    // 消してから焼き込みへ等倍で重ねる。クレーターの外の画素は破壊の有無に左右されない。
    const layer = this.decorLayer();
    const dctx = layer.getContext('2d', { willReadFrequently: true })!;
    dctx.save();
    dctx.clearRect(span.x * P, span.y * P, span.w * P, span.h * P);
    dctx.lineCap = 'round';
    for (const op of this.decorFor(cx, cy, store)) {
      if (tiles) {
        // 部分焼き込みでは、描く範囲に掛からない命令を省く(範囲内の画素には影響しない)
        const b = decorOpBounds(op, 1 / P);
        if (b.x1 < span.x || b.x0 > span.x + span.w || b.y1 < span.y || b.y0 > span.y + span.h) continue;
      }
      this.draw(dctx, op);
    }

    // 配管コリドー: 全系統のconduitに配管ラインを重ね、通路が「配管」として読めるようにする。
    // networkTileAtと同じ条件なので、conduitが歩けるタイルを生む場所と正確に一致する。
    // 装飾は焼き込みキャンバスへの描画のみ。tileAt/ゲームプレイには一切影響しない。
    // 配管コリドーの線は鋼基調+系統accentを微量ティント(暖色の氾濫を防ぐ。系統識別は残す)
    dctx.strokeStyle = mixHex(STEEL.post, biome.accent, 0.25);
    dctx.lineWidth = Math.max(1, 0.14 * P);
    for (let ty = span.y; ty < span.y + span.h; ty++) {
      const wy = by + ty;
      for (let tx = span.x; tx < span.x + span.w; tx++) {
        const wx = bx + tx;
        const c = conduitAt(this.seed, wx, wy);
        if (!c) continue;
        dctx.beginPath();
        if (c.role === 'vertical') {
          // 縦シャフト: タイル中央に縦配管/ケーブルを1本
          const x = (tx + 0.5) * P;
          dctx.moveTo(x, ty * P);
          dctx.lineTo(x, (ty + 1) * P);
        } else {
          // 水平コリドー(floor/inside): タイル上部に水平配管を1本
          const y = (ty + 0.18) * P;
          dctx.moveTo(tx * P, y);
          dctx.lineTo((tx + 1) * P, y);
        }
        dctx.stroke();
      }
    }
    for (const r of this.craterOf(cx, cy, store)) dctx.clearRect(r.x * P, r.y * P, r.w * P, r.h * P);
    dctx.restore();
    ctx.drawImage(layer, span.x * P, span.y * P, span.w * P, span.h * P, span.x * P, span.y * P, span.w * P, span.h * P);
    ctx.lineCap = 'round'; // 以降の水面・痕跡は従来どおり丸い線端で描く

    // 水系統の施設内部にだけ「たまり水の水面」を淡く描く(視覚のみ)。
    // ゲート: 水地域 かつ そのタイルが施設/メガ施設の内部空間(=facility/megaがAIRを返す)、
    // かつ直下1〜2タイルがSOLID(水が溜まる床/槽底)。tileAt/コリジョンには一切影響しない。
    // 半透明の水色を水平線としてタイル中央高さに引くだけなので、固体には見えず貯水槽/水面として読める。
    if (system === 'water') {
      ctx.strokeStyle = 'rgba(90,150,200,0.15)';
      ctx.lineWidth = Math.max(1, 0.12 * P);
      for (let ty = span.y; ty < span.y + span.h; ty++) {
        const wy = by + ty;
        for (let tx = span.x; tx < span.x + span.w; tx++) {
          if (chunk[ty * CHUNK_SIZE + tx] !== TILE.AIR) continue;
          const wx = bx + tx;
          const inFacility =
            megaFacilityAt(this.seed, wx, wy) === TILE.AIR ||
            facilityTileAt(this.seed, wx, wy) === TILE.AIR;
          if (!inFacility) continue;
          // 前室(内側・底)では tileAt が施設オーバーレイを抑止するので、そこは施設内部ではない
          const mods = terrainModsAt(this.seed, wx, wy);
          if (mods?.suppressLadder || mods?.forceFloor) continue;
          if (!isSolid(around(tx, ty + 1)) && !isSolid(around(tx, ty + 2))) continue;
          const y = (ty + 0.5) * P;
          ctx.beginPath();
          ctx.moveTo(tx * P, y);
          ctx.lineTo((tx + 1) * P, y);
          ctx.stroke();
        }
      }
    }

    // 人の痕跡(環境ストーリーテリング)。床の縁(AIRかつ直下SOLID)と壁面(SOLIDかつ左右空気)に
    // 決定論的に散らす。焼き込みのみ・非衝突。ライトに照らされて初めて読める暗い色調。
    for (let ty = span.y; ty < span.y + span.h; ty++) {
      const wy = by + ty;
      for (let tx = span.x; tx < span.x + span.w; tx++) {
        const wx = bx + tx;
        const here = chunk[ty * CHUNK_SIZE + tx];
        if (here === TILE.AIR) {
          if (!isSolid(around(tx, ty + 1))) continue;
          const tr = traceAt(this.seed, wx, wy, 'floor');
          if (tr) {
            // 休憩点の箱の灯だけは地区 accent に寄せた色で暈を描く(段階 3、設計 §4.2)
            const lampCell = tr.type === 'lamp' ? restLampCellAt(this.seed, wx, wy) : null;
            this.drawFloorTrace(ctx, tr, tx, ty, lampCell === null ? undefined : restLampColor(this.seed, lampCell));
          }
        } else if (here === TILE.SOLID) {
          const faceLeft = !isSolid(around(tx - 1, ty));
          const faceRight = !isSolid(around(tx + 1, ty));
          if (!faceLeft && !faceRight) continue;
          const tr = traceAt(this.seed, wx, wy, 'wall');
          if (tr) {
            // 休憩点の箱の刻印は地区ごとの刻線数で描く(段階 3、設計 §4.2 の刻印)
            const tallyCell = tr.type === 'tally' ? restTallyCellAt(this.seed, wx, wy) : null;
            const strokes = tallyCell === null ? undefined : REST_TALLY_STROKES[biomeIdForCell(this.seed, tallyCell)];
            this.drawWallTrace(ctx, tr, tx, ty, faceLeft ? -1 : 1, strokes);
          }
        }
      }
    }
    ctx.restore();
    return canvas;
  }

  /**
   * 超構造体材パレット(§6.1): 界面の板(HARD)をほぼ黒の平坦な面として塗る。アトラス・陰影帯・
   * リム・ディザは当てず、16 タイルごとの 1 px 継ぎ目線、上下面の 2 px の硬いエッジ(大穴に
   * 近いほど強い)、下面の 8 タイル間隔の短い垂下リブだけで量塊を示す。
   * 継ぎ目・リブ・エッジはワールド座標から決まるので、チャンク境界や部分再焼き込みで切れない。
   * リブは板の下の空気タイル側から描く(板の最下行がチャンク下端でも自チャンク内に収まる)。
   */
  private bakeHardPlates(
    ctx: CanvasRenderingContext2D,
    chunk: Uint8Array,
    around: (lx: number, ly: number) => number,
    bx: number, by: number, span: CellRect,
  ): void {
    const P = BAKE_PPT;
    ctx.globalAlpha = 1;
    // 1) 平坦な塗り + 継ぎ目線
    for (let ty = span.y; ty < span.y + span.h; ty++) {
      for (let tx = span.x; tx < span.x + span.w; tx++) {
        if (chunk[ty * CHUNK_SIZE + tx] !== TILE.HARD) continue;
        ctx.fillStyle = HARD_FILL;
        ctx.fillRect(tx * P, ty * P, P, P);
        const seam = hardSeamAt(bx + tx, by + ty);
        if (seam.v || seam.h) {
          ctx.fillStyle = HARD_SEAM;
          ctx.globalAlpha = 0.9;
          if (seam.v) ctx.fillRect(tx * P, ty * P, 1, P);
          if (seam.h) ctx.fillRect(tx * P, ty * P, P, 1);
          ctx.globalAlpha = 1;
        }
      }
    }
    // 2) 硬いエッジ(空気に面した辺)。継ぎ目より後に描いてエッジが勝つ。
    for (let ty = span.y; ty < span.y + span.h; ty++) {
      for (let tx = span.x; tx < span.x + span.w; tx++) {
        if (chunk[ty * CHUNK_SIZE + tx] !== TILE.HARD) continue;
        const openN = !isSolid(around(tx, ty - 1));
        const openS = !isSolid(around(tx, ty + 1));
        const openW = !isSolid(around(tx - 1, ty));
        const openE = !isSolid(around(tx + 1, ty));
        if (!openN && !openS && !openW && !openE) continue;
        const wx = bx + tx;
        const wy = by + ty;
        if (openN || openS) {
          const cell = biomeCellAt(this.seed, wy);
          const s = hardEdgeStrength(wx - holeCenterX(nearestPassage(this.seed, cell, wx).x));
          ctx.globalAlpha = 0.9 * s;
          if (openN) {
            ctx.fillStyle = HARD_EDGE_TOP;
            ctx.fillRect(tx * P, ty * P, P, EDGE_PX);
          }
          if (openS) {
            ctx.fillStyle = HARD_EDGE_BOTTOM;
            ctx.fillRect(tx * P, (ty + 1) * P - EDGE_PX, P, EDGE_PX);
          }
        }
        if (openW || openE) {
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = HARD_EDGE_SIDE;
          if (openW) ctx.fillRect(tx * P, ty * P, EDGE_PX, P);
          if (openE) ctx.fillRect((tx + 1) * P - EDGE_PX, ty * P, EDGE_PX, P);
        }
      }
    }
    ctx.globalAlpha = 1;
    // 3) 下面の垂下リブ(板の直下の非固体タイルの上端に描く)
    for (let ty = span.y; ty < span.y + span.h; ty++) {
      for (let tx = span.x; tx < span.x + span.w; tx++) {
        if (chunk[ty * CHUNK_SIZE + tx] === TILE.HARD) continue;
        if (around(tx, ty - 1) !== TILE.HARD || !hardRibAt(bx + tx)) continue;
        const rx = (tx + 0.375) * P;
        ctx.fillStyle = HARD_FILL;
        ctx.fillRect(rx, ty * P, 0.25 * P, 0.5 * P);
        ctx.fillStyle = HARD_EDGE_BOTTOM;
        ctx.globalAlpha = 0.6;
        ctx.fillRect(rx + 0.25 * P - 1, ty * P, 1, 0.5 * P);
        ctx.globalAlpha = 1;
      }
    }
  }

  /** 床の縁の痕跡。タイル(tx,ty)内の正規化座標で描く(y=1が床面)。暗い色調。
   * lampColor は休憩点の灯だけに渡る地区色の暈(通常の落ちている灯は従来の金色)。 */
  private drawFloorTrace(ctx: CanvasRenderingContext2D, tr: Trace, tx: number, ty: number, lampColor?: string): void {
    const P = BAKE_PPT;
    const X = (x: number) => (tx + x) * P;
    const Y = (y: number) => (ty + y) * P;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    switch (tr.type) {
      case 'corpse': {
        ctx.strokeStyle = '#8f8a7e';
        ctx.fillStyle = '#12100c';
        ctx.lineWidth = Math.max(1, 0.05 * P);
        ctx.globalAlpha = 0.8;
        ctx.beginPath(); ctx.arc(X(0.5), Y(0.6), 0.11 * P, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(X(0.5), Y(0.71)); ctx.lineTo(X(0.55), Y(0.95));
        ctx.moveTo(X(0.44), Y(0.78)); ctx.lineTo(X(0.6), Y(0.78));
        ctx.moveTo(X(0.45), Y(0.84)); ctx.lineTo(X(0.6), Y(0.84));
        ctx.moveTo(X(0.55), Y(0.95)); ctx.lineTo(X(0.3), Y(0.93));
        ctx.moveTo(X(0.55), Y(0.95)); ctx.lineTo(X(0.82), Y(0.9));
        ctx.stroke();
        break;
      }
      case 'lamp': {
        const gx = X(0.5), gy = Y(0.9);
        const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, 0.6 * P);
        g.addColorStop(0, lampColor ? rgbaOf(lampColor, 0.35) : 'rgba(202,166,74,0.35)');
        g.addColorStop(1, lampColor ? rgbaOf(lampColor, 0) : 'rgba(202,166,74,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(gx, gy, 0.6 * P, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#141d27';
        ctx.strokeStyle = '#33506a';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.rect(X(0.4), Y(0.88), 0.24 * P, 0.08 * P); ctx.fill(); ctx.stroke();
        break;
      }
      case 'pack': {
        ctx.fillStyle = '#12161b';
        ctx.strokeStyle = '#3a4a3a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(X(0.36), Y(0.98)); ctx.lineTo(X(0.4), Y(0.82));
        ctx.lineTo(X(0.6), Y(0.82)); ctx.lineTo(X(0.64), Y(0.98));
        ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      }
      case 'shells': {
        ctx.fillStyle = '#7a6a3a';
        ctx.globalAlpha = 0.75;
        for (const [ox, oy] of [[0.32, 0.96], [0.46, 0.98], [0.6, 0.95], [0.7, 0.98]] as const) {
          ctx.fillRect(X(ox), Y(oy), 0.08 * P, 0.03 * P);
        }
        break;
      }
    }
    ctx.restore();
  }

  /** 壁面の痕跡。露出面側(dir: -1=左,1=右)寄りに描く。
   * tallyStrokes は休憩点の刻印だけに渡る地区ごとの刻線数(通常の刻印は従来の 4 本)。 */
  private drawWallTrace(ctx: CanvasRenderingContext2D, tr: Trace, tx: number, ty: number, dir: -1 | 1, tallyStrokes?: number): void {
    const P = BAKE_PPT;
    const base = dir === -1 ? 0.12 : 0.62;
    const X = (x: number) => (tx + base + x) * P;
    const Y = (y: number) => (ty + y) * P;
    ctx.save();
    ctx.lineCap = 'round';
    switch (tr.type) {
      case 'tally': {
        ctx.strokeStyle = '#5a6a70';
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = Math.max(1, 0.04 * P);
        const strokes = tallyStrokes ?? 4;
        const step = strokes > 1 ? 0.21 / (strokes - 1) : 0;
        for (let i = 0; i < strokes; i++) {
          ctx.beginPath(); ctx.moveTo(X(0.02 + i * step), Y(0.35)); ctx.lineTo(X(0.02 + i * step), Y(0.6)); ctx.stroke();
        }
        ctx.beginPath(); ctx.moveTo(X(-0.02), Y(0.48)); ctx.lineTo(X(0.24), Y(0.47)); ctx.stroke();
        break;
      }
      case 'warning': {
        ctx.fillStyle = '#3a4658';
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.moveTo(X(0), Y(0.42)); ctx.lineTo(X(0.16), Y(0.42)); ctx.lineTo(X(0.14), Y(0.36));
        ctx.lineTo(X(0.26), Y(0.5)); ctx.lineTo(X(0.14), Y(0.64)); ctx.lineTo(X(0.16), Y(0.58));
        ctx.lineTo(X(0), Y(0.58)); ctx.closePath(); ctx.fill();
        break;
      }
    }
    ctx.restore();
  }

  private draw(ctx: CanvasRenderingContext2D, op: DecorOp): void {
    const P = BAKE_PPT;
    switch (op.kind) {
      case 'line':
        ctx.strokeStyle = op.color;
        ctx.lineWidth = Math.max(1, op.w * P);
        ctx.beginPath();
        ctx.moveTo(op.x1 * P, op.y1 * P);
        ctx.lineTo(op.x2 * P, op.y2 * P);
        ctx.stroke();
        break;
      case 'dot':
        ctx.fillStyle = op.color;
        ctx.beginPath();
        ctx.arc(op.x * P, op.y * P, Math.max(1, op.r * P), 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'poly': {
        ctx.beginPath();
        ctx.moveTo(op.pts[0] * P, op.pts[1] * P);
        for (let i = 2; i < op.pts.length; i += 2) ctx.lineTo(op.pts[i] * P, op.pts[i + 1] * P);
        if (op.fill) {
          ctx.closePath();
          ctx.fillStyle = op.color;
          ctx.fill();
        } else {
          ctx.strokeStyle = op.color;
          ctx.lineWidth = Math.max(1, op.w * P);
          ctx.stroke();
        }
        break;
      }
      case 'hatch': {
        ctx.save();
        ctx.beginPath();
        ctx.rect(op.x * P, op.y * P, op.w * P, op.h * P);
        ctx.clip();
        ctx.fillStyle = this.hatchPattern(op.spacing, op.color, !!op.cross);
        ctx.fillRect(op.x * P, op.y * P, op.w * P, op.h * P);
        ctx.restore();
        break;
      }
      case 'rect':
        ctx.globalAlpha = op.alpha ?? 1;
        ctx.fillStyle = op.color;
        ctx.fillRect(op.x * P, op.y * P, op.w * P, op.h * P);
        ctx.globalAlpha = 1;
        break;
      case 'grad': {
        const g = op.dir === 'v'
          ? ctx.createLinearGradient(op.x * P, op.y * P, op.x * P, (op.y + op.h) * P)
          : ctx.createLinearGradient(op.x * P, op.y * P, (op.x + op.w) * P, op.y * P);
        for (const [off, color] of op.stops) g.addColorStop(off, color);
        ctx.globalAlpha = op.alpha ?? 1;
        ctx.fillStyle = g;
        ctx.fillRect(op.x * P, op.y * P, op.w * P, op.h * P);
        ctx.globalAlpha = 1;
        break;
      }
    }
  }

  private hatchPattern(spacing: number, color: string, cross: boolean): CanvasPattern {
    const key = `${spacing}|${color}|${cross ? 'x' : '/'}`;
    let pat = this.patterns.get(key);
    if (!pat) {
      const s = Math.max(3, Math.round(spacing * BAKE_PPT));
      const c = document.createElement('canvas');
      c.width = s;
      c.height = s;
      const pctx = c.getContext('2d', { willReadFrequently: true })!;
      pctx.lineWidth = 1;
      // 主方向の45°線(タイル境界で連続するようセル内で完結する複数本)
      pctx.strokeStyle = color;
      pctx.beginPath();
      pctx.moveTo(0, s);
      pctx.lineTo(s, 0);
      pctx.moveTo(-s / 2, s / 2);
      pctx.lineTo(s / 2, -s / 2);
      pctx.moveTo(s / 2, s * 1.5);
      pctx.lineTo(s * 1.5, s / 2);
      pctx.stroke();
      if (cross) {
        // 逆向き45°線を淡く重ねてクロスハッチ(格子ではなく織り目状の陰影で密度アップ)
        pctx.globalAlpha = 0.5;
        pctx.beginPath();
        pctx.moveTo(0, 0);
        pctx.lineTo(s, s);
        pctx.moveTo(s / 2, -s / 2);
        pctx.lineTo(s * 1.5, s / 2);
        pctx.moveTo(-s / 2, s / 2);
        pctx.lineTo(s / 2, s * 1.5);
        pctx.stroke();
        pctx.globalAlpha = 1;
      }
      pat = pctx.createPattern(c, 'repeat')! as CanvasPattern;
      this.patterns.set(key, pat);
    }
    return pat;
  }
}
