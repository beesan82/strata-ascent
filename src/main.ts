import { Camera } from './core/camera';
import { Input, MOVE_KEYS } from './core/input';
import { Player } from './entities/player';
import { Graviton } from './entities/graviton';
import { BAKE_KEEP_RADIUS, Renderer } from './render/renderer';
import { ChunkStore } from './world/chunks';
import { Destruction } from './world/destruction';
import { regionAt, type System } from './world/hierarchy';
import { isGreatInterface, layerNumber, overlookCellAt } from './world/interface';
import { biomeCellAt } from './world/biomeCells';
import { towerTopFloorAt } from './world/landmark';
import { CHUNK_SIZE } from './world/tiles';
import { findSpawn, isHardAt } from './world/worldgen';
import { sampleOpenness, targetZoomForOpenness, quantizeZoom } from './core/zoom';
import { displayAltitude, highestLayer } from './core/coordinate';
import { autoViewStarted, initialView, viewState, type ViewState } from './core/view';
import { Caption, captionText } from './render/caption';
import { AudioEngine } from './audio/engine';
import { beaconHum, HUM_RANGE, nearestPlateDistance } from './audio/params';
import { beaconsInView } from './render/beacon';
import { biomeIdForCell } from './world/biomeCells';

const DEFAULT_SEED = 20260711;
const STEP_MS = 1000 / 60;
const EVICT_INTERVAL_FRAMES = 120;
const EVICT_RADIUS = 4;
// 開放度サンプリング間隔(フレーム)。6=約100ms。tileAt多数のため毎フレームは避ける。
const OPENNESS_SAMPLE_INTERVAL_FRAMES = 6;

// ?seed=123 で世界を変えられる(0も有効な値として許可。未指定/非数値時のみデフォルト)
const params = new URLSearchParams(location.search);
const seedParam = params.get('seed');
const seed = seedParam !== null && Number.isFinite(Number(seedParam)) ? Number(seedParam) : DEFAULT_SEED;
const freezeSimulation = params.get('freeze') === '1';
// ?stats=1 で renderer.render の所要時間と、そのうち present(ラスタ化+量子化)の所要時間(ms)を
// 直近 600 フレームぶん window.__renderMs / window.__presentMs に残す(scripts/frametime.mjs が読む)
// ?stats=2 はさらに描画段階ごとの同期ラスタ化時間を window.__stageMs に残す(段階ごとの重さ調べ)
const collectStats = params.get('stats') === '1' || params.get('stats') === '2';
const profileStages = params.get('stats') === '2';
// present の内訳も window.__presentParts(getImageData / quantize / putImageData / blit の 4 配列)に残す。
const renderMs: number[] = [];
const presentMs: number[] = [];
const presentParts: number[][] = [[], [], [], []];
const stageMs: Record<string, number[]> = {};
if (collectStats) {
  const w = window as unknown as {
    __renderMs: number[]; __presentMs: number[]; __presentParts: number[][];
    __stageMs: Record<string, number[]>; __captureRaw: () => void; __rawFrame: () => { w: number; h: number; data: number[] } | null;
  };
  w.__renderMs = renderMs;
  w.__presentMs = presentMs;
  w.__presentParts = presentParts;
  w.__stageMs = stageMs;
  // scripts/dumpframe.mjs: 量子化前の生画素を 1 フレームぶん取り出す(Node 側の量子化ベンチ用)
  w.__captureRaw = () => renderer.captureRawFrame();
  w.__rawFrame = () => {
    const raw = renderer.lastRawFrame;
    if (!raw) return null;
    const { w: bw, h: bh } = renderer.bufferSize;
    return { w: bw, h: bh, data: Array.from(raw) };
  };
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hud = document.getElementById('hud')!;
const caption = new Caption(document.getElementById('caption')!);

const destruction = new Destruction();
const store = new ChunkStore(seed, destruction);
const graviton = new Graviton();
// デバッグ/スクリーンショット用: ?x=&y= でスポーン位置を上書き(埋まり座標は自己責任)
const qx = params.get('x');
const qy = params.get('y');
const spawn = qx !== null && qy !== null ? { x: Number(qx), y: Number(qy) } : findSpawn(seed);
const player = new Player(spawn.x, spawn.y);
const camera = new Camera(player.centerX, player.centerY);
const input = new Input();
const renderer = new Renderer(canvas, seed);
// 音(§6.7): キー/クリックのたびに AudioContext の開始・resume を試みる(ブラウザの自動再生制限)。
// M はトグル(Input.muted)。最初のキーが M のときに一瞬鳴らないよう、開始の前にミュートを渡す
const audio = new AudioEngine();
input.onInput(() => {
  audio.setMuted(input.muted);
  audio.start();
});
// タブを隠すと rAF が止まり updateAudio が来ないが、AudioContext は進み続けるので context ごと止める
document.addEventListener('visibilitychange', () => {
  if (document.hidden) audio.suspend();
  else audio.resume();
});
// 眺望(§6.4)の状態。純粋関数 viewState の出力(目標ズーム・中心オフセット)にカメラが追従する
let view: ViewState = initialView(biomeCellAt(seed, Math.floor(spawn.y)));
// HUD の階層(§6.5): 到達した最高階層。落下で下がっても減らない
let maxLayer = layerNumber(seed, biomeCellAt(seed, Math.floor(spawn.y)));
renderer.profileStages = profileStages;
const debug = params.get('debug');
renderer.setDebug(debug);

const towerTop = (cell: number, x: number) => towerTopFloorAt(seed, cell, x);

let dpr = window.devicePixelRatio || 1;

function resize(): void {
  dpr = window.devicePixelRatio || 1;
  renderer.resize(Math.round(window.innerWidth * dpr), Math.round(window.innerHeight * dpr));
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
}
window.addEventListener('resize', resize);
resize();

const tiles = (tx: number, ty: number) => store.tileAt(tx, ty);

// 重力子砲: 発射パラメータとビーム残光(演出)
const BORE_LENGTH = 300; // タイル
const BORE_RADIUS = 3;   // タイル(半径)
const BEAM_TTL = 0.18;   // 秒: ビーム残光の寿命(切り札の一撃として一瞬だが読める長さ)
let lastBeam: { angle: number; ttl: number } | null = null;

/** チャージ完了→離した瞬間: エイム方向へ地形を貫通破壊し、タイルへ反映して焼き込みを無効化する */
function fire(): void {
  const aim = renderer.aimAngle; // ライトコーンと同一の角度(=ビーム=破壊方向を保証)
  // 未生成チャンクは生成せず破壊マスクだけ記録する(発射フレームでの同期生成を避ける)
  const affected = destruction.bore(
    player.centerX, player.centerY, aim, BORE_LENGTH, BORE_RADIUS,
    (tx, ty) => store.peekTileAt(tx, ty),
    // 未生成チャンクでも界面の板・塔・崩落斜路(HARD)は記録しない(生成状態に関わらず不壊)
    (tx, ty) => isHardAt(seed, tx, ty),
  );
  for (const key of affected) {
    const [cx, cy] = key.split(',').map(Number);
    store.applyDestruction(cx, cy); // 生成済みチャンクへその場で反映(再生成しない)
  }
  renderer.invalidateBored(affected, store); // 焼き込みを再焼き込み待ちに(境界際の隣チャンクも)
  lastBeam = { angle: aim, ttl: BEAM_TTL };
}

let frames = 0;
let simTime = 0;
// カメラの目標ズーム。開放度から毎数フレーム更新し、camera.zoomToで平滑追従する
let zoomTarget = 1;
// 開放度の時間平滑(EMA)状態。サンプル格子がタイル境界にスナップするため、歩くたび
// 窓端の列が入れ替わって生の開放度が階段状にガタつく。数サンプルぶん時間平均することで
// ズーム目標の微振動(=移動中の画面の伸び縮み・酔い)を断つ。nullは初回未計測。
let opennessEma: number | null = null;
// EMA係数。約100msごとの更新で0.35=数サンプル(~0.3秒)で追随。小さいほど滑らかで鈍い。
const OPENNESS_EMA_ALPHA = 0.35;

function clamp(lo: number, hi: number, v: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function update(dt: number): void {
  simTime += dt;
  const s = input.state;
  const pressed = input.takePressed();
  player.update(s, dt, tiles);
  // 眺望(§6.4): 接地・静止で Shift → 手動、見晴らし台に初めて接地 → 自動(通過演出)。
  // 足元の行は接地時に body の下端がタイル境界に揃うので round で取る。
  const footRow = Math.round(player.body.y + player.body.h);
  const halfW = canvas.width / 2;
  const halfH = canvas.height / 2;
  const next = viewState(view, {
    shift: input.shiftHeld,
    moving: s.left || s.right || s.up || s.down || s.jump,
    newlyMoving: MOVE_KEYS.some((c) => pressed.has(c)),
    grounded: player.body.onGround,
    still: player.body.onGround && player.body.vx === 0,
    aimX: input.mouseSeen ? clamp(-1, 1, (input.mouseX * dpr - halfW) / halfW) : 0,
    aimY: input.mouseSeen ? clamp(-1, 1, (input.mouseY * dpr - halfH) / halfH) : 0,
    // 塔(§5.5)の頂部の床からも発火する(述語は interface.ts → landmark.ts の循環 import を避けるため)
    overlookCell: player.body.onGround ? overlookCellAt(seed, Math.floor(player.centerX), footRow, towerTop) : null,
    baseZoom: zoomTarget,
  }, dt);
  if (autoViewStarted(view, next)) {
    // 字幕(§6.5): 板 cell を越えた先の層は cell−1。大界面ならその旨を添える
    const cell = next.autoFiredMinCell!;
    caption.show(captionText(layerNumber(seed, cell - 1), isGreatInterface(cell)), simTime);
    audio.passage(); // 通過音(§6.7): 見晴らし台に出た瞬間に 1 音
  }
  view = next;
  camera.follow(player.centerX + view.offsetX, player.centerY + view.offsetY, dt);
  // 開放度は毎フレームだと重い(tileAt多数)ので6フレームごとに測る。
  // 求めた目標ズームは quantizeZoom で離散段へ量子化してから、毎フレーム平滑追従する
  // (camera.zoomTo自体は連続補間。描画スケールの段スナップは段I Task5でrenderer側が行う)。
  if (frames % OPENNESS_SAMPLE_INTERVAL_FRAMES === 0) {
    const raw = sampleOpenness(tiles, player.centerX, player.centerY);
    opennessEma = opennessEma === null ? raw : opennessEma + (raw - opennessEma) * OPENNESS_EMA_ALPHA;
    zoomTarget = quantizeZoom(targetZoomForOpenness(opennessEma));
  }
  // 眺望中は view.zoom が 0.35、それ以外は開放度由来の zoomTarget(1 フレーム前の値で十分)
  camera.zoomTo(view.zoom, dt);
  graviton.update(dt, input.fireHeld, fire);
  updateAudio();
  if (lastBeam) {
    lastBeam.ttl -= dt;
    if (lastBeam.ttl <= 0) lastBeam = null;
  }

  frames++;
  if (frames % EVICT_INTERVAL_FRAMES === 0) {
    const pcx = Math.floor(player.centerX / CHUNK_SIZE);
    const pcy = Math.floor(player.centerY / CHUNK_SIZE);
    store.evictFarFrom(pcx, pcy, EVICT_RADIUS);
    renderer.evictFarFrom(pcx, pcy, BAKE_KEEP_RADIUS);
  }
}

/**
 * 音の状態を毎フレーム渡す。ドローンは今いる層のバイオーム、うなりは最寄りの板までの距離、残響は開放度の EMA、
 * ハムは近くの光柱(軸から ±64 タイル)の最大。光柱の列挙は 1 フレームに数回の passageX で軽い。
 */
function updateAudio(): void {
  if (input.muted !== audio.muted) audio.setMuted(input.muted);
  if (!audio.started) return;
  const cx = player.centerX;
  const cy = player.centerY;
  let hum = 0;
  for (const b of beaconsInView(seed, cx, cy, 2 * HUM_RANGE, 2 * HUM_RANGE)) {
    const dy = cy < b.top ? b.top - cy : cy > b.floor ? cy - b.floor : 0;
    hum = Math.max(hum, beaconHum(cx - b.x, dy));
  }
  audio.update({
    biome: biomeIdForCell(seed, biomeCellAt(seed, Math.floor(cy))),
    plateDistance: nearestPlateDistance(seed, cy),
    openness: opennessEma ?? 0.5,
    hum,
    walking: player.body.onGround && player.body.vx !== 0,
    walkPhase: player.walkPhase,
  });
}

/** 系統 → 日本語ラベル(配色と同じ地域系統で表示) */
const SYSTEM_LABEL: Record<System, string> = {
  water: '水系',
  power: '電力系',
  habitation: '居住区',
  disposal: '廃棄区',
  foundry: '精錬区',
};

function updateHud(): void {
  const altitude = displayAltitude(player.body.y, player.body.h);
  // 接地しているときだけ更新する。孔の梯子は板の上面より 4 タイル上まで延びるので、登って降りただけで
  // 頭の cell が上の層になり n が上がっていた(段階3 の保留)。床に立った層だけを「到達」と数える
  if (player.body.onGround) maxLayer = highestLayer(maxLayer, layerNumber(seed, biomeCellAt(seed, Math.floor(player.body.y))));
  const sys = regionAt(seed, Math.floor(player.centerX), Math.floor(player.body.y)).system;
  let cannon = `重粒子砲 ${graviton.charges}/3`;
  const r = graviton.chargeRatio;
  if (r > 0 && r < 1) {
    // 溜めゲージ(ASCII固定でフォント差異なく確実に表示)
    const bars = Math.round(r * 4);
    cannon += ` [${'#'.repeat(bars)}${'-'.repeat(4 - bars)}]`;
  }
  hud.textContent = `第 ${maxLayer} 階層 / 高度 ${altitude} — ${SYSTEM_LABEL[sys]} [seed:${seed}] — ${cannon}`;
}

let last = performance.now();
let acc = 0;

function frame(now: number): void {
  acc += Math.min(now - last, 100); // タブ復帰時のスパイラル防止
  last = now;
  if (freezeSimulation) {
    acc = 0;
  } else {
    while (acc >= STEP_MS) {
      update(STEP_MS / 1000);
      acc -= STEP_MS;
    }
  }
  const beam = lastBeam ? { angle: lastBeam.angle, alpha: lastBeam.ttl / BEAM_TTL } : null;
  const t0 = collectStats ? performance.now() : 0;
  renderer.render(store, camera, player, input.mouseX * dpr, input.mouseY * dpr, simTime, {
    chargeRatio: graviton.chargeRatio,
    beam,
  });
  if (collectStats) {
    // present の getImageData が描画コマンドを同期ラスタ化させるので、ここの時間に描画全体が含まれる
    renderMs.push(performance.now() - t0);
    presentMs.push(renderer.lastPresentMs);
    const parts = renderer.lastPresentParts;
    for (let i = 0; i < 4; i++) presentParts[i].push(parts[i]);
    if (profileStages) {
      for (const [name, ms] of Object.entries(renderer.stageMs)) {
        const arr = stageMs[name] ?? (stageMs[name] = []);
        arr.push(ms);
        if (arr.length > 600) arr.shift();
      }
    }
    if (renderMs.length > 600) {
      renderMs.shift();
      presentMs.shift();
      for (const arr of presentParts) arr.shift();
    }
  }
  updateHud();
  caption.update(simTime);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
