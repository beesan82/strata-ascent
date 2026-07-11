import { Camera } from './core/camera';
import { Input } from './core/input';
import { Player } from './entities/player';
import { Renderer } from './render/renderer';
import { ChunkStore } from './world/chunks';
import { stratumAt } from './world/strata';
import { CHUNK_SIZE } from './world/tiles';
import { findSpawn } from './world/worldgen';

const DEFAULT_SEED = 20260711;
const STEP_MS = 1000 / 60;
const EVICT_INTERVAL_FRAMES = 120;
const EVICT_RADIUS = 4;
// 焼き込みキャッシュは1枚1024×1024(~4MB)と重いので、衝突ストアより狭い半径で破棄する。
// 半径2=5チャンク幅=320タイル > ビューポート44タイルなので視界は常にカバーされる。
const BAKE_EVICT_RADIUS = 2;

// ?seed=123 で世界を変えられる(0も有効な値として許可。未指定/非数値時のみデフォルト)
const params = new URLSearchParams(location.search);
const seedParam = params.get('seed');
const seed = seedParam !== null && Number.isFinite(Number(seedParam)) ? Number(seedParam) : DEFAULT_SEED;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hud = document.getElementById('hud')!;

const store = new ChunkStore(seed);
// デバッグ/スクリーンショット用: ?x=&y= でスポーン位置を上書き(埋まり座標は自己責任)
const qx = params.get('x');
const qy = params.get('y');
const spawn = qx !== null && qy !== null ? { x: Number(qx), y: Number(qy) } : findSpawn(seed);
const player = new Player(spawn.x, spawn.y);
const camera = new Camera(player.centerX, player.centerY);
const input = new Input();
const renderer = new Renderer(canvas, seed);

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

let frames = 0;
let simTime = 0;

function update(dt: number): void {
  simTime += dt;
  player.update(input.state, dt, tiles);
  camera.follow(player.centerX, player.centerY, dt);

  frames++;
  if (frames % EVICT_INTERVAL_FRAMES === 0) {
    const pcx = Math.floor(player.centerX / CHUNK_SIZE);
    const pcy = Math.floor(player.centerY / CHUNK_SIZE);
    store.evictFarFrom(pcx, pcy, EVICT_RADIUS);
    renderer.evictFarFrom(pcx, pcy, BAKE_EVICT_RADIUS);
  }
}

function updateHud(): void {
  const altitude = Math.max(0, Math.floor(-(player.body.y + player.body.h)));
  const stratum = stratumAt(player.body.y);
  hud.textContent = `高度 ${altitude}m — ${stratum.name} [seed:${seed}]`;
}

let last = performance.now();
let acc = 0;

function frame(now: number): void {
  acc += Math.min(now - last, 100); // タブ復帰時のスパイラル防止
  last = now;
  while (acc >= STEP_MS) {
    update(STEP_MS / 1000);
    acc -= STEP_MS;
  }
  renderer.render(store, camera, player, input.mouseX * dpr, input.mouseY * dpr, simTime);
  updateHud();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
