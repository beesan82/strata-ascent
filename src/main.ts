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

// ?seed=123 で世界を変えられる
const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed')) || DEFAULT_SEED;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const hud = document.getElementById('hud')!;

const store = new ChunkStore(seed);
const spawn = findSpawn(seed);
const player = new Player(spawn.x, spawn.y);
const camera = new Camera(player.centerX, player.centerY);
const input = new Input();
const renderer = new Renderer(canvas);

function resize(): void {
  renderer.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

const tiles = (tx: number, ty: number) => store.tileAt(tx, ty);

let frames = 0;

function update(dt: number): void {
  player.update(input.state, dt, tiles);
  camera.follow(player.centerX, player.centerY, dt);

  frames++;
  if (frames % EVICT_INTERVAL_FRAMES === 0) {
    const pcx = Math.floor(player.centerX / CHUNK_SIZE);
    const pcy = Math.floor(player.centerY / CHUNK_SIZE);
    store.evictFarFrom(pcx, pcy, EVICT_RADIUS);
  }
}

function updateHud(): void {
  const altitude = Math.max(0, Math.floor(-player.body.y));
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
  renderer.render(store, camera, player, input.mouseX, input.mouseY);
  updateHud();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
