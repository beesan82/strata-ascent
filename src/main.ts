import { Camera } from './core/camera';
import { Input } from './core/input';
import { Player } from './entities/player';
import { Graviton } from './entities/graviton';
import { BAKE_KEEP_RADIUS, Renderer } from './render/renderer';
import { ChunkStore } from './world/chunks';
import { Destruction } from './world/destruction';
import { regionAt, type System } from './world/hierarchy';
import { interfaceTileAt } from './world/interface';
import { CHUNK_SIZE, TILE } from './world/tiles';
import { findSpawn } from './world/worldgen';
import { sampleOpenness, targetZoomForOpenness, quantizeZoom } from './core/zoom';
import { displayY } from './core/coordinate';

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
const collectStats = params.get('stats') === '1';
const renderMs: number[] = [];
const presentMs: number[] = [];
if (collectStats) {
  const w = window as unknown as { __renderMs: number[]; __presentMs: number[] };
  w.__renderMs = renderMs;
  w.__presentMs = presentMs;
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hud = document.getElementById('hud')!;

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
const debug = params.get('debug');
renderer.setDebug(debug);

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
    // 未生成チャンクでも界面の板(HARD)は記録しない(板は生成状態に関わらず不壊)
    (tx, ty) => interfaceTileAt(seed, tx, ty) === TILE.HARD,
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

function update(dt: number): void {
  simTime += dt;
  player.update(input.state, dt, tiles);
  camera.follow(player.centerX, player.centerY, dt);
  // 開放度は毎フレームだと重い(tileAt多数)ので6フレームごとに測る。
  // 求めた目標ズームは quantizeZoom で離散段へ量子化してから、毎フレーム平滑追従する
  // (camera.zoomTo自体は連続補間。描画スケールの段スナップは段I Task5でrenderer側が行う)。
  if (frames % OPENNESS_SAMPLE_INTERVAL_FRAMES === 0) {
    const raw = sampleOpenness(tiles, player.centerX, player.centerY);
    opennessEma = opennessEma === null ? raw : opennessEma + (raw - opennessEma) * OPENNESS_EMA_ALPHA;
    zoomTarget = quantizeZoom(targetZoomForOpenness(opennessEma));
  }
  camera.zoomTo(zoomTarget, dt);
  graviton.update(dt, input.fireHeld, fire);
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

/** 系統 → 日本語ラベル(配色と同じ地域系統で表示) */
const SYSTEM_LABEL: Record<System, string> = {
  water: '水系',
  power: '電力系',
  habitation: '居住区',
  disposal: '廃棄区',
  foundry: '精錬区',
};

function updateHud(): void {
  const coordinateY = displayY(player.body.y, player.body.h);
  const sys = regionAt(seed, Math.floor(player.centerX), Math.floor(player.body.y)).system;
  let cannon = `重力子砲 ${graviton.charges}/3`;
  const r = graviton.chargeRatio;
  if (r > 0 && r < 1) {
    // 溜めゲージ(ASCII固定でフォント差異なく確実に表示)
    const bars = Math.round(r * 4);
    cannon += ` [${'#'.repeat(bars)}${'-'.repeat(4 - bars)}]`;
  }
  hud.textContent = `座標 Y ${coordinateY} — ${SYSTEM_LABEL[sys]} [seed:${seed}] — ${cannon}`;
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
    if (renderMs.length > 600) {
      renderMs.shift();
      presentMs.shift();
    }
  }
  updateHud();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
