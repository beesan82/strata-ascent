import { Camera } from './core/camera';
import { hapticCannonFire, hapticDamage, hapticEnemyDown, initNativeShell } from './core/haptics';
import { Input, MOVE_KEYS } from './core/input';
import { installTouchControls } from './core/touch';
import { MAX_HP, Player } from './entities/player';
import { Graviton } from './entities/graviton';
import { pulseAimDir, PulseGun, PULSE_DAMAGE, PULSE_SIZE, type Pulse } from './entities/pulse';
import { Flyer, Walker } from './entities/enemy';
import { chooseFlyerSpawns, chooseSpawns, findAirPockets, findFloorRuns, flyerMulFor } from './world/spawn';
import { grandHallAt } from './world/grandhall';
import { nearestRestPoint } from './world/restpoint';
import { BAKE_KEEP_RADIUS, Renderer } from './render/renderer';
import { ChunkStore } from './world/chunks';
import { Destruction } from './world/destruction';
import { regionAt, type System } from './world/hierarchy';
import { isGreatInterface, layerNumber, overlookCellAt } from './world/interface';
import { biomeCellAt } from './world/biomeCells';
import { towerTopFloorAt } from './world/landmark';
import { CHUNK_SIZE } from './world/tiles';
import { findSpawn, isHardAt } from './world/worldgen';
import { sampleOpenness, targetZoomForOpenness, nextZoomStep, advanceZoom } from './core/zoom';
import { lookahead } from './core/stick';
import { displayAltitude, highestLayer } from './core/coordinate';
import { autoViewStarted, initialView, viewState, type ViewState } from './core/view';
import { Caption, captionText } from './render/caption';
import { AudioEngine } from './audio/engine';
import { beaconHum, HUM_RANGE, nearestPlateDistance } from './audio/params';
import { beaconsInView } from './render/beacon';
import { biomeIdForCell, districtNameForCell } from './world/biomeCells';
import { terrainProfileFor } from './world/biomeTerrain';

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
const pulseGun = new PulseGun();

/** 生存中の歩行敵(スポーン識別子つき)。出現の決定は world/spawn の決定論スキャン */
let enemies: { spawnId: string; walker: Walker }[] = [];
/** 生存中の飛行敵(スポーン識別子つき)。出現の決定は walker と同じスキャンに相乗りする */
let flyers: { spawnId: string; flyer: Flyer }[] = [];
const ENEMY_SCAN_INTERVAL_FRAMES = 30;
const ENEMY_SCAN_X = 40;
const ENEMY_SCAN_Y = 24;

/**
 * 撃破済みスポーン ID のセッション内記録(第2弾 §4)。倒した敵は二度と出ない。
 * プレイヤーの死亡でもリセットしない(破壊した地形の保持と揃える)。
 * セッション跨ぎは保持しない(セーブ機構が無い現行の前提)。
 */
const defeatedEnemies = new Set<string>();
/** 記録の安全弁: 数百体規模が前提だが、際限なく伸びないよう古い順に落とす */
const DEFEATED_LIMIT = 10000;
function recordDefeated(id: string): void {
  defeatedEnemies.add(id);
  if (defeatedEnemies.size > DEFEATED_LIMIT) {
    const oldest = defeatedEnemies.values().next().value;
    if (oldest !== undefined) defeatedEnemies.delete(oldest);
  }
}

/** プレイヤー近傍の地形を走査して敵の出現集合を更新する(倒していない敵は範囲を離れると再出現する) */
function refreshEnemies(): void {
  const cell = biomeCellAt(seed, Math.floor(player.body.y));
  const layer = layerNumber(seed, cell);
  const biomeId = biomeIdForCell(seed, cell);
  // 地区倍率(ゾーン化 段階 2、設計 §5): 基礎率は層番号ベースのまま、地区の spawnMul を乗せる
  const spawnMul = terrainProfileFor(biomeId).spawnMul;
  const cx = Math.floor(player.centerX);
  const cy = Math.floor(player.centerY);
  const runs = findFloorRuns(tiles, cx - ENEMY_SCAN_X, cy - ENEMY_SCAN_Y, cx + ENEMY_SCAN_X, cy + ENEMY_SCAN_Y);
  const rp = nearestRestPoint(seed, player.centerX, player.centerY);
  const protectedPoints = [
    { x: spawn.x, y: spawn.y, r: 10 },
    { x: rp.x, y: rp.floorY, r: 20 },
  ];
  const desired = chooseSpawns(seed, layer, runs, protectedPoints, spawnMul, defeatedEnemies);
  const ids = new Set(desired.map((d) => d.id));
  enemies = enemies.filter((e) => ids.has(e.spawnId));
  for (const d of desired) {
    if (!enemies.some((e) => e.spawnId === d.id)) {
      enemies.push({ spawnId: d.id, walker: new Walker(d.x, d.y, d.dir) });
    }
  }
  // 飛行敵(第2弾 §1): 地区ゲートが閉じている間はポケット走査自体をしない(他地区では無コスト)
  if (flyerMulFor(biomeId) > 0) {
    const pockets = findAirPockets(tiles, cx - ENEMY_SCAN_X, cy - ENEMY_SCAN_Y, cx + ENEMY_SCAN_X, cy + ENEMY_SCAN_Y);
    // スキャン範囲に重なるセルの大広間を集める(広間の中には出さない)
    const halls = [];
    const cellMin = biomeCellAt(seed, cy - ENEMY_SCAN_Y);
    const cellMax = biomeCellAt(seed, cy + ENEMY_SCAN_Y);
    for (let c = cellMin; c <= cellMax; c++) {
      const hall = grandHallAt(seed, c);
      if (hall) halls.push(hall);
    }
    const desiredFlyers = chooseFlyerSpawns(seed, layer, pockets, protectedPoints, biomeId, halls, defeatedEnemies);
    const flyerIds = new Set(desiredFlyers.map((d) => d.id));
    flyers = flyers.filter((e) => flyerIds.has(e.spawnId));
    for (const d of desiredFlyers) {
      if (!flyers.some((e) => e.spawnId === d.id)) {
        flyers.push({ spawnId: d.id, flyer: new Flyer(d.x, d.y, d.phase) });
      }
    }
  } else if (flyers.length > 0) {
    flyers = [];
  }
}
// デバッグ/スクリーンショット用: ?x=&y= でスポーン位置を上書き(埋まり座標は自己責任)
const qx = params.get('x');
const qy = params.get('y');
const spawn = qx !== null && qy !== null ? { x: Number(qx), y: Number(qy) } : findSpawn(seed);
const player = new Player(spawn.x, spawn.y);
/** 復活点(ボディ左上)。休憩点に触れるたびに更新される */
let respawnPoint = { x: spawn.x, y: spawn.y };
const camera = new Camera(player.centerX, player.centerY);
const input = new Input();
installTouchControls(input); // タッチ端末でのみ画面ボタンが出る(それ以外は何もしない)
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
  hapticCannonFire();
  // スティック砲の発射が成立したら、武器モードをパルスへ自動復帰させる(設計 §3-3)。
  // PC の KeyF 発射では発射候補が無いのでモードには触れない
  if (input.takeCannonRelease()) input.notifyCannonFired();
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
// カメラの目標ズーム(段)。開放度から毎数フレーム更新し、描画ズームは advanceZoom で追従する
let zoomTarget = 1;
// 段キーパー(core/zoom.ts の nextZoomStep)の現在の段。連続ズーム(開放度由来の目標)から
// ヒステリシス付きで段を選び、境界付近での段の往復(チャタリング)を断つ
let zoomStep = 1;
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
  // 右スティックで狙っている間は、向きも照準の左右へ追従させる(移動方向と独立に狙うため。
  // ほぼ真上の狙いで向きが暴れないよう、横成分が弱いときは変えない)
  if (input.touchAimActive && Math.abs(input.touchAimX) >= 0.3) {
    player.facing = input.touchAimX > 0 ? 1 : -1;
  }
  // 眺望(§6.4): 接地・静止で Shift → 手動、見晴らし台に初めて接地 → 自動(通過演出)。
  // 足元の行は接地時に body の下端がタイル境界に揃うので round で取る。
  const footRow = Math.round(player.body.y + player.body.h);
  const halfW = canvas.width / 2;
  const halfH = canvas.height / 2;
  // 照準ベクトルの合成(優先順位: マウス > 右スティック照準 > 保持照準 > 向きの水平)。
  // タッチチャンネルは PC では常に無効なので従来どおり。砲のタッチ照準も右スティックに一本化した
  const touchAim = input.touchAimActive
    ? { x: input.touchAimX, y: input.touchAimY }
    : input.heldAimActive ? { x: input.heldAimX, y: input.heldAimY } : null;
  const next = viewState(view, {
    shift: input.shiftHeld,
    moving: s.left || s.right || s.up || s.down || s.jump,
    newlyMoving: MOVE_KEYS.some((c) => pressed.has(c)),
    grounded: player.body.onGround,
    still: player.body.onGround && player.body.vx === 0,
    // マウスが一度も動いていない(タッチ等)間は、スティック照準があればそれを使い、
    // 無ければプレイヤーの向きの水平に倒す(左上に張り付かせない)
    aimX: input.mouseSeen
      ? clamp(-1, 1, (input.mouseX * dpr - halfW) / halfW)
      : touchAim ? touchAim.x : player.facing,
    aimY: input.mouseSeen
      ? clamp(-1, 1, (input.mouseY * dpr - halfH) / halfH)
      : touchAim ? touchAim.y : 0,
    // 塔(§5.5)の頂部の床からも発火する(述語は interface.ts → landmark.ts の循環 import を避けるため)
    overlookCell: player.body.onGround ? overlookCellAt(seed, Math.floor(player.centerX), footRow, towerTop) : null,
    baseZoom: zoomTarget,
  }, dt);
  if (autoViewStarted(view, next)) {
    // 字幕(§6.5): 板 cell を越えた先の層は cell−1。大界面ならその旨を添える。
    // 地区が前セルと変わった場合と大界面では、入った先の地区名も併記する(地区化段階1)
    const cell = next.autoFiredMinCell!;
    const entered = cell - 1;
    const great = isGreatInterface(cell);
    const districtChanged = biomeIdForCell(seed, entered) !== biomeIdForCell(seed, cell);
    const district = districtChanged || great ? districtNameForCell(seed, entered) : undefined;
    caption.show(captionText(layerNumber(seed, entered), great, district), simTime);
    audio.passage(); // 通過音(§6.7): 見晴らし台に出た瞬間に 1 音
  }
  view = next;
  // カメラ先行(視線 = 照準方向): 狙った先が画面に入るよう、照準方向へ中心を寄せる。
  // 眺望オフセットとは別レイヤで加算し、眺望の状態遷移には触らない。
  // 拡張(5 タイル)は発射中・砲の溜め中に加え、砲モードでスティック照準が有効な間も効かせる
  // (砲は狙い始めた時点から先の視界が価値を持つため。設計 2026-11-05-weapon-switch §4)
  const la = lookahead(
    touchAim,
    input.pulseHeld || graviton.chargeRatio > 0 || (input.weaponMode === 'cannon' && input.touchAimActive),
  );
  camera.follow(player.centerX + view.offsetX + la.x, player.centerY + view.offsetY + la.y, dt);
  // 開放度は毎フレームだと重い(tileAt多数)ので6フレームごとに測る。
  // 連続ズーム(開放度由来)から段キーパーがヒステリシス付きで段を選び、zoomTarget とする。
  // 描画ズームは即時スナップせず、advanceZoom で段へ滑らかに遷移させる。
  if (frames % OPENNESS_SAMPLE_INTERVAL_FRAMES === 0) {
    const raw = sampleOpenness(tiles, player.centerX, player.centerY);
    opennessEma = opennessEma === null ? raw : opennessEma + (raw - opennessEma) * OPENNESS_EMA_ALPHA;
    zoomStep = nextZoomStep(zoomStep, targetZoomForOpenness(opennessEma));
    zoomTarget = zoomStep;
    // 休憩点の箱の中に立ったら全回復し、復活点をここへ更新する
    const rp = nearestRestPoint(seed, player.centerX, player.centerY);
    const feet = player.body.y + player.body.h;
    if (
      player.centerX > rp.left && player.centerX < rp.right &&
      player.centerY < rp.floorY && Math.abs(feet - rp.floorY) < 0.6
    ) {
      respawnPoint = { x: rp.x - player.body.w / 2, y: rp.floorY - player.body.h };
      if (player.hp < MAX_HP) player.hp = MAX_HP;
    }
  }
  // 眺望中は view.zoom が 0.35、それ以外は段キーパー由来の zoomTarget(1 フレーム前の値で十分)。
  // どちらも段の値なので、描画ズームは advanceZoom で段から段へ滑らかに遷移させる
  // (眺望の出入りも開放度の段移動も同じ経路。ジャンプは起きない)
  camera.zoom = advanceZoom(camera.zoom, view.zoom, dt);
  if (input.takeFireCancel()) graviton.cancelCharge(); // タッチ照準のキャンセル(解放より先に破棄)
  graviton.update(dt, input.fireHeld, fire);
  input.expireCannonRelease(); // スティック砲の発射候補は、この update で発射しなければ失効する
  // パルス(連射武器): 照準は右スティックのアナログ方向 > 保持照準 > 移動入力の 8 方向。
  // タッチチャンネルは PC では常に無効なので、キーボード/マウス時は従来どおり 8 方向になる
  const pulseDir = input.touchAimActive
    ? { x: input.touchAimX, y: input.touchAimY }
    : input.heldAimActive
      ? { x: input.heldAimX, y: input.heldAimY }
      : pulseAimDir(input.state, player.facing);
  pulseGun.update(dt, input.pulseHeld, player.centerX, player.centerY, pulseDir.x, pulseDir.y, tiles);

  // 歩行敵・飛行敵: 出現集合の更新、巡回/追尾、パルスとの命中判定(接触ダメージは第4段)
  if (frames % ENEMY_SCAN_INTERVAL_FRAMES === 0) refreshEnemies();
  for (const e of enemies) e.walker.update(dt, tiles);
  for (const e of flyers) e.flyer.update(dt, tiles, player.centerX, player.centerY);
  if ((enemies.length > 0 || flyers.length > 0) && pulseGun.pulses.length > 0) {
    const spent = new Set<Pulse>();
    for (const p of pulseGun.pulses) {
      for (const e of enemies) {
        const b = e.walker.body;
        if (
          p.body.x < b.x + b.w && p.body.x + p.body.w > b.x &&
          p.body.y < b.y + b.h && p.body.y + p.body.h > b.y
        ) {
          if (e.walker.hit(PULSE_DAMAGE)) hapticEnemyDown();
          spent.add(p);
          break;
        }
      }
      if (spent.has(p)) continue;
      for (const e of flyers) {
        const b = e.flyer.body;
        if (
          p.body.x < b.x + b.w && p.body.x + p.body.w > b.x &&
          p.body.y < b.y + b.h && p.body.y + p.body.h > b.y
        ) {
          if (e.flyer.hit(PULSE_DAMAGE)) hapticEnemyDown();
          spent.add(p);
          break;
        }
      }
    }
    if (spent.size > 0) pulseGun.pulses = pulseGun.pulses.filter((p) => !spent.has(p));
    // 撃破を記録してから実体を捨てる(記録保持 §4: 倒した敵は再出現しない)
    for (const e of enemies) if (e.walker.dead) recordDefeated(e.spawnId);
    enemies = enemies.filter((e) => !e.walker.dead);
    for (const e of flyers) if (e.flyer.dead) recordDefeated(e.spawnId);
    flyers = flyers.filter((e) => !e.flyer.dead);
  }

  // 敵との接触ダメージと、死亡時の復活(最後の休憩点、無ければスポーン地点)
  if (!player.dead) {
    const pb = player.body;
    for (const e of enemies) {
      const b = e.walker.body;
      if (pb.x < b.x + b.w && pb.x + pb.w > b.x && pb.y < b.y + b.h && pb.y + pb.h > b.y) {
        if (player.damage(e.walker.centerX)) hapticDamage();
        break;
      }
    }
    if (!player.dead) {
      for (const e of flyers) {
        const b = e.flyer.body;
        if (pb.x < b.x + b.w && pb.x + pb.w > b.x && pb.y < b.y + b.h && pb.y + pb.h > b.y) {
          if (player.damage(e.flyer.centerX)) hapticDamage();
          break;
        }
      }
    }
  }
  if (player.dead) {
    player.body.x = respawnPoint.x;
    player.body.y = respawnPoint.y;
    player.revive();
    enemies = []; // 実体は捨てるが撃破記録(defeatedEnemies)は残す(§4: 死亡でリセットしない)
    flyers = [];
    pulseGun.pulses = [];
  }
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
  // 武器表示(設計 2026-11-05-weapon-switch §2-3): 現在の武器を角括弧で囲む
  const weapon = input.weaponMode === 'pulse' ? `武器 [パルス] / ${cannon}` : `武器 パルス / [${cannon}]`;
  const hearts = '♥'.repeat(player.hp) + '♡'.repeat(Math.max(0, MAX_HP - player.hp));
  hud.textContent = `第 ${maxLayer} 階層 / 高度 ${altitude} — ${SYSTEM_LABEL[sys]} [seed:${seed}] — ${weapon} — HP ${hearts}`;
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
  // マウスが一度も動いていない(タッチ等)間は、照準用のマウス位置を合成する:
  // スティック照準/保持照準の方向の点、無ければ「プレイヤーの向きの水平」
  // (実マウス座標 0,0 だと照準が画面左上に張り付き、コーンとビームの向きが実用にならないため)
  const stickAim = !input.mouseSeen
    ? input.touchAimActive
      ? { x: input.touchAimX, y: input.touchAimY }
      : input.heldAimActive ? { x: input.heldAimX, y: input.heldAimY } : null
    : null;
  const aimR = (canvas.height / 2) * 0.9; // 角度が歪まないよう両軸を同じ半径で取る
  const aimMouseX = input.mouseSeen
    ? input.mouseX * dpr
    : stickAim ? canvas.width / 2 + stickAim.x * aimR : canvas.width / 2 + (player.facing * canvas.width) / 4;
  const aimMouseY = input.mouseSeen
    ? input.mouseY * dpr
    : stickAim ? canvas.height / 2 + stickAim.y * aimR : canvas.height / 2;
  renderer.render(store, camera, player, aimMouseX, aimMouseY, simTime, {
    chargeRatio: graviton.chargeRatio,
    beam,
    pulses: pulseGun.pulses.map((p) => ({
      x: p.body.x + PULSE_SIZE / 2,
      y: p.body.y + PULSE_SIZE / 2,
      dx: p.dx,
      dy: p.dy,
    })),
    enemies: [
      ...enemies.map((e) => ({
        x: e.walker.centerX,
        y: e.walker.centerY,
        flash: e.walker.flashT > 0,
      })),
      ...flyers.map((e) => ({
        x: e.flyer.centerX,
        y: e.flyer.centerY,
        flash: e.flyer.flashT > 0,
        flyer: true,
      })),
    ],
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

void initNativeShell(); // アプリ版のみ: 横向きロックとステータスバー非表示(Web では no-op)
requestAnimationFrame(frame);
