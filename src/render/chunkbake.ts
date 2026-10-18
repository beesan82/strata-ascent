import type { ChunkStore } from '../world/chunks';
import { CHUNK_SIZE, TILE } from '../world/tiles';
import { blobId } from './tileset/autotile';
import type { Atlas } from './tileset/atlas';
import { generateAtlas, type TilePalette } from './tileset/generate';
import { regionAt } from '../world/hierarchy';
import { conduitAt } from '../world/network';
import { facilityTileAt } from '../world/facility';
import { megaFacilityAt } from '../world/megafacility';
import { biomeBlend, blendBiomeVisuals, mixHex, type BiomeBlend } from './biome';
import { reliefEdges, reliefBands, rimSegments } from './tileset/relief';
import { DECOR_MARGIN, DecorCache, decorOpBounds, type DecorOp } from './decor';
import { dirtyBoundsAround, expandRect, type CellRect } from './dirtyBounds';
import { traceAt, type Trace } from './traces';
import { STEEL } from './steel';

/** 焼き込み解像度(px/タイル)。表示は拡縮されるが16pxあれば線は読める */
export const BAKE_PPT = 16;

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
    for (let ty = span.y; ty < span.y + span.h; ty++) {
      for (let tx = span.x; tx < span.x + span.w; tx++) {
        if (chunk[ty * CHUNK_SIZE + tx] !== TILE.SOLID) continue;
        const nb = {
          n: around(tx, ty - 1) === TILE.SOLID,
          e: around(tx + 1, ty) === TILE.SOLID,
          s: around(tx, ty + 1) === TILE.SOLID,
          w: around(tx - 1, ty) === TILE.SOLID,
          ne: around(tx + 1, ty - 1) === TILE.SOLID,
          se: around(tx + 1, ty + 1) === TILE.SOLID,
          sw: around(tx - 1, ty + 1) === TILE.SOLID,
          nw: around(tx - 1, ty - 1) === TILE.SOLID,
        };
        const r = atlas.rect(blobId(nb));
        ctx.drawImage(
          atlas.source,
          r.sx, r.sy, r.sw, r.sh,
          tx * BAKE_PPT, ty * BAKE_PPT, BAKE_PPT + 1, BAKE_PPT + 1,
        );
      }
    }

    // 後退内面(厚み)＋上端リムライト。空気に面したSOLIDエッジに、露出面から内側へ純黒へ
    // 後退する暗帯を敷き、歩ける上端に明るいリム線を引く(可読性)。焼き込みのみ・当たり無改修。
    // 濃さ/深さは ambientLevel 連動で、明バイオームでは控えめにして足場を読める範囲に保つ。
    const P = BAKE_PPT;
    const reliefDepth = 0.24 + (1 - biome.ambientLevel) * 0.12; // 0.24〜0.36 タイル
    const bandAlpha = 0.32 + (1 - biome.ambientLevel) * 0.34;   // 0.32〜0.66
    const rimTopColor = mixHex(biome.palette.edge, '#ffffff', 0.4);
    for (let ty = span.y; ty < span.y + span.h; ty++) {
      for (let tx = span.x; tx < span.x + span.w; tx++) {
        if (chunk[ty * CHUNK_SIZE + tx] !== TILE.SOLID) continue;
        const edges = reliefEdges(
          around(tx, ty - 1) === TILE.SOLID,
          around(tx + 1, ty) === TILE.SOLID,
          around(tx, ty + 1) === TILE.SOLID,
          around(tx - 1, ty) === TILE.SOLID,
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
          ctx.strokeStyle = s.top ? rimTopColor : biome.palette.edge;
          ctx.globalAlpha = s.top ? 0.9 : 0.4;
          ctx.lineWidth = Math.max(1, (s.top ? 0.12 : 0.07) * P);
          ctx.beginPath();
          ctx.moveTo((tx + s.x1) * P, (ty + s.y1) * P);
          ctx.lineTo((tx + s.x2) * P, (ty + s.y2) * P);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;

    // 装飾(アトラスが描く表面線画=surfaceタグ付きはスキップ、物理装飾は残す)。
    // モックの色構成に合わせ、物理装飾は鋼ランプ由来のPALETTE色のまま焼く
    // (旧accent置換は廃止。暖色は錆・灯のみに限定する)。
    ctx.lineCap = 'round';
    for (const op of this.decorFor(cx, cy, store)) {
      if (tiles) {
        // 部分焼き込みでは、描く範囲に掛からない命令を省く(範囲内の画素には影響しない)
        const b = decorOpBounds(op, 1 / P);
        if (b.x1 < span.x || b.x0 > span.x + span.w || b.y1 < span.y || b.y0 > span.y + span.h) continue;
      }
      this.draw(ctx, op);
    }

    // 配管コリドー: 全系統のconduitに配管ラインを重ね、通路が「配管」として読めるようにする。
    // networkTileAtと同じ条件なので、conduitが歩けるタイルを生む場所と正確に一致する。
    // 装飾は焼き込みキャンバスへの描画のみ。tileAt/ゲームプレイには一切影響しない。
    // 配管コリドーの線は鋼基調+系統accentを微量ティント(暖色の氾濫を防ぐ。系統識別は残す)
    ctx.strokeStyle = mixHex(STEEL.post, biome.accent, 0.25);
    ctx.lineWidth = Math.max(1, 0.14 * P);
    for (let ty = span.y; ty < span.y + span.h; ty++) {
      const wy = by + ty;
      for (let tx = span.x; tx < span.x + span.w; tx++) {
        const wx = bx + tx;
        const c = conduitAt(this.seed, wx, wy);
        if (!c) continue;
        ctx.beginPath();
        if (c.role === 'vertical') {
          // 縦シャフト: タイル中央に縦配管/ケーブルを1本
          const x = (tx + 0.5) * P;
          ctx.moveTo(x, ty * P);
          ctx.lineTo(x, (ty + 1) * P);
        } else {
          // 水平コリドー(floor/inside): タイル上部に水平配管を1本
          const y = (ty + 0.18) * P;
          ctx.moveTo(tx * P, y);
          ctx.lineTo((tx + 1) * P, y);
        }
        ctx.stroke();
      }
    }

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
          if (around(tx, ty + 1) !== TILE.SOLID && around(tx, ty + 2) !== TILE.SOLID) continue;
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
          if (around(tx, ty + 1) !== TILE.SOLID) continue;
          const tr = traceAt(this.seed, wx, wy, 'floor');
          if (tr) this.drawFloorTrace(ctx, tr, tx, ty);
        } else if (here === TILE.SOLID) {
          const faceLeft = around(tx - 1, ty) !== TILE.SOLID;
          const faceRight = around(tx + 1, ty) !== TILE.SOLID;
          if (!faceLeft && !faceRight) continue;
          const tr = traceAt(this.seed, wx, wy, 'wall');
          if (tr) this.drawWallTrace(ctx, tr, tx, ty, faceLeft ? -1 : 1);
        }
      }
    }
    ctx.restore();
    return canvas;
  }

  /** 床の縁の痕跡。タイル(tx,ty)内の正規化座標で描く(y=1が床面)。暗い色調。 */
  private drawFloorTrace(ctx: CanvasRenderingContext2D, tr: Trace, tx: number, ty: number): void {
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
        g.addColorStop(0, 'rgba(202,166,74,0.35)');
        g.addColorStop(1, 'rgba(202,166,74,0)');
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

  /** 壁面の痕跡。露出面側(dir: -1=左,1=右)寄りに描く。 */
  private drawWallTrace(ctx: CanvasRenderingContext2D, tr: Trace, tx: number, ty: number, dir: -1 | 1): void {
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
        for (let i = 0; i < 4; i++) {
          ctx.beginPath(); ctx.moveTo(X(0.02 + i * 0.07), Y(0.35)); ctx.lineTo(X(0.02 + i * 0.07), Y(0.6)); ctx.stroke();
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
