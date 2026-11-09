import { Camera } from './core/camera';
import { hapticCannonFire, hapticDamage, hapticEnemyDown, hapticLedgeGrab, initNativeShell } from './core/haptics';
import { Input, MOVE_KEYS } from './core/input';
import { installTouchControls } from './core/touch';
import { MAX_HP, Player } from './entities/player';
import { Graviton, MAX_CHARGES, BORE_LENGTH, BORE_RADIUS, rechargeTimeFor } from './entities/graviton';
import { pulseAimDir, PulseGun, PULSE_DAMAGE, PULSE_SIZE, type Pulse } from './entities/pulse';
import { Boss, BOSS_BEAM_DAMAGE, BOSS_H, BOSS_HP, BOSS_W, Flyer, Walker } from './entities/enemy';
import { Turret, TurretShot } from './entities/turret';
import { beamHit } from './entities/beamHit';
import { canAddSupply, canPickup, DropItem, pushDrop, pushSupply } from './entities/drop';
import { dropFor } from './world/drop';
import { chooseSupplyCaches, restStockSecondFor, supplyFor, type SupplyCache } from './world/supply';
import { chooseFlyerSpawns, chooseSpawns, chooseTurretSpawns, findAirPockets, findFloorRuns, flyerMulFor, turretMulFor } from './world/spawn';
import { bossRewardFor, bossSpawnFor, type BossSpawn } from './world/boss';
import { grandHallAt } from './world/grandhall';
import { nearestRestPoint } from './world/restpoint';
import { BAKE_KEEP_RADIUS, Renderer } from './render/renderer';
import { ChunkStore } from './world/chunks';
import { Destruction } from './world/destruction';
import { regionAt, type System } from './world/hierarchy';
import { isGreatInterface, layerNumber, overlookCellAt } from './world/interface';
import { biomeCellAt } from './world/biomeCells';
import { towerTopFloorAt } from './world/landmark';
import { CHUNK_SIZE, TILE } from './world/tiles';
import { DEBRIS_TTL } from './render/beamShape';
import { poseMotionOf, poseMuzzleWorld } from './render/playerPose';
import { findSpawn, isHardAt } from './world/worldgen';
import { sampleOpenness, targetZoomForOpenness, nextZoomStep, advanceZoom } from './core/zoom';
import { lookahead } from './core/stick';
import {
  initialSatiety,
  MAX_RATIONS,
  resetSatietyOnDeath,
  satietyBiomeMulFor,
  satietyLevel,
  stepSatiety,
  type SatietyState,
} from './core/satiety';
import {
  addRemainsSite,
  initialGroundAnchor,
  pruneRemainsSites,
  stepGroundAnchor,
  type GroundAnchor,
} from './core/remains';
import {
  addCarry,
  carriedTotal,
  initialCarry,
  isCarryKind,
  secureCaptionText,
  secureCarry,
  securedTotal,
  type CarryState,
} from './core/carry';
import { displayAltitude, highestLayer } from './core/coordinate';
import {
  crossedMilestone,
  loadBestLayer,
  milestoneCaptionText,
  newRecordCaptionText,
  saveBestLayer,
  type LayerStorage,
} from './core/records';
import { autoViewStarted, initialView, viewState, type ViewState } from './core/view';
import { Caption, captionText } from './render/caption';
import { AudioEngine } from './audio/engine';
import { beaconHum, HUM_RANGE, LADDER_RUNG_STEP, LAND_MIN_VY, nearestPlateDistance, rungCrossed } from './audio/params';
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
/** 生存中の固定砲台(スポーン識別子つき)。出現の決定は walker と同じスキャンに相乗りする */
let turrets: { spawnId: string; turret: Turret }[] = [];
/** 飛んでいる砲台の弾。プレイヤーに当たると消費され、地形・寿命でも消える */
let turretShots: TurretShot[] = [];
/**
 * 有効化中のボス「広間番人」(第2弾 §2)。大広間のあるセルにプレイヤーがいる間だけ
 * 1 体を有効化する。実体は範囲を離れると捨てられるが、撃破は記録保持に残る。
 */
let boss: { spawnId: string; boss: Boss; spawn: BossSpawn } | null = null;
/** 音用: 前フレームに有効だったボスのスポーン ID(出現の検出) */
let prevBossSpawnId: string | null = null;
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

/** 生存中のドロップ(第2弾 §3)。撃破位置から落ちて床に静止し、寿命で消える */
let drops: DropItem[] = [];
/** セッション通算の撃破カウンタ。ドロップ抽選(dropFor)の killIndex として使う */
let killCount = 0;

/** 満腹度(サバイバル段階 1)。状態は core/satiety の純関数で進める */
let satiety: SatietyState = initialSatiety();
/**
 * 携行と確保(エクストラクション段階 A)。素材セルを拾うと携行に入り、休憩点の箱に入ると
 * 確保済みへ移る。状態は core/carry の純関数で進める。段階 A では死亡しても携行は残る
 */
let carry: CarryState = initialCarry();
/** 字幕は状態が落ちた瞬間だけ出すための前回レベル */
let satietyPrevLevel = satietyLevel(satiety.value);

/** 音の遷移検出用(§6.7): 接地と落下速度の前フレーム値、梯子の累積移動距離 */
let prevGrounded = true;
let prevFallVy = 0;
let ladderTravel = 0;
/** 崖つかみの遷移検出用(段階 2): 前フレームに掴まっていたか */
let prevHanging = false;

/** 開封済み補給キャッシュの ID(セッション内のみ。死亡でも戻らない) */
const claimedSupplyCaches = new Set<string>();
/** 備蓄を開けた休憩点の ID(セッション内のみ) */
const claimedRestStocks = new Set<string>();
/** 現在有効な補給キャッシュ(敵スキャンに相乗りして更新する。近傍に最大 1 個) */
let supplyCache: SupplyCache | null = null;

/**
 * 敵 1 体の撃破処理: 記録保持への登録と、ドロップ抽選を 1 回だけ行う。
 * 地区は撃破位置のセルで決める。ドロップは敵の中心から落下する。
 */
function onEnemyKilled(spawnId: string, centerX: number, centerY: number): void {
  audio.enemyDown(); // 撃破音(§6.7): パルスでもビームでも撃破処理はここに集約される
  recordDefeated(spawnId);
  const biomeId = biomeIdForCell(seed, biomeCellAt(seed, Math.floor(centerY)));
  const kind = dropFor(seed, spawnId, killCount, biomeId);
  killCount++;
  if (!kind) return;
  // 糧食は「後で戻って使う」判断が要るため、発生源によらず補給品として残す(サバイバル設計 §5)。
  // 素材セル(段階 A)も同じく補給品(寿命なし)。地面の上限は pushSupply の種別上限で抑える
  if (kind === 'ration' || kind === 'material') pushSupply(drops, new DropItem(kind, centerX, centerY, true));
  else pushDrop(drops, new DropItem(kind, centerX, centerY));
}

/**
 * ボスの撃破処理: 記録保持への登録と、確定ドロップ(回復 1 + 砲弾 1 + 糧食 1、総数 3)。
 * 構成は bossRewardFor(サバイバル段階 2、設計 §5・§10)。抽選(dropFor)は経由せず、
 * 撃破位置から落として広間の床へ散らす(第2弾 §2)。
 * 糧食は敵ドロップと同じく補給品として残す(段階 1 の裁定)。
 */
function onBossKilled(spawnId: string, b: Boss): void {
  audio.bossDown(); // ボス撃破音(§6.7): 通常の撃破音より長く重い
  recordDefeated(spawnId);
  killCount++;
  const offsets = [0, -1.5, 1.5]; // 構成の並び順に対応(中心=回復、左=砲弾、右=糧食)
  bossRewardFor().forEach((kind, i) => {
    const item = new DropItem(kind, b.centerX + offsets[i], b.centerY, kind === 'ration');
    if (kind === 'ration') pushSupply(drops, item);
    else pushDrop(drops, item);
  });
}

/**
 * 死亡時の遺留品(サバイバル段階 3、設計 §8): 所持糧食を最後の安定接地点へ落とす。
 * 対象は糧食だけ(砲弾は自動回復するため回収価値が薄く、回復セルは所持品として存在しない)。
 * 遺留品は補給品(寿命なし)として出し、箇所は最大 2 つまで(3 つ目で最も古い箇所が消える)。
 * 復活処理(テレポートと糧食リセット)より前に呼ぶこと。
 */
function dropRemainsOnDeath(): void {
  if (satiety.rations <= 0) return;
  // 回収・消滅済みの箇所は数えない(空いた枠は新しい遺留品に使える)
  remainsSites = pruneRemainsSites(remainsSites, drops);
  const cx = groundAnchor.x + player.body.w / 2;
  const cy = groundAnchor.y + player.body.h / 2;
  const offsets = satiety.rations === 1 ? [0] : [-0.75, 0.75];
  const items: DropItem[] = [];
  for (let i = 0; i < satiety.rations; i++) {
    const item = new DropItem('ration', cx + offsets[i], cy, true);
    pushSupply(drops, item);
    items.push(item);
  }
  const added = addRemainsSite(remainsSites, items);
  remainsSites = added.sites;
  if (added.evicted.length > 0) {
    const evicted = new Set(added.evicted);
    drops = drops.filter((d) => !evicted.has(d));
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
  // スキャン範囲に重なるセルの大広間(飛行敵の除外とキャッシュの除外で共用)
  const halls = [];
  const cellMin = biomeCellAt(seed, cy - ENEMY_SCAN_Y);
  const cellMax = biomeCellAt(seed, cy + ENEMY_SCAN_Y);
  for (let c = cellMin; c <= cellMax; c++) {
    const hall = grandHallAt(seed, c);
    if (hall) halls.push(hall);
  }
  // 固定砲台(v2.0 Task 6): 地区ゲート(電力区・精錬区)が開いているときだけ床ランを引く。
  // 歩行敵の選定結果(desired)を occupied として渡し、近接する位置には置かない
  if (turretMulFor(biomeId) > 0) {
    const desiredTurrets = chooseTurretSpawns(
      seed, layer, runs, protectedPoints, biomeId, halls,
      desired.map((d) => ({ x: d.x, y: d.y })), defeatedEnemies,
    );
    const turretIds = new Set(desiredTurrets.map((d) => d.id));
    turrets = turrets.filter((e) => turretIds.has(e.spawnId));
    for (const d of desiredTurrets) {
      if (!turrets.some((e) => e.spawnId === d.id)) {
        turrets.push({ spawnId: d.id, turret: new Turret(d.x, d.y) });
      }
    }
  } else if (turrets.length > 0) {
    turrets = [];
  }
  // 飛行敵(第2弾 §1): 地区ゲートが閉じている間はポケット走査自体をしない(他地区では無コスト)
  if (flyerMulFor(biomeId) > 0) {
    const pockets = findAirPockets(tiles, cx - ENEMY_SCAN_X, cy - ENEMY_SCAN_Y, cx + ENEMY_SCAN_X, cy + ENEMY_SCAN_Y);
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
  // ボス(第2弾 §2): プレイヤーがいるセルの大広間にだけ有効化する。
  // 撃破済みなら bossSpawnFor が null を返し、二度と出ない(再戦不可)
  const bs = bossSpawnFor(seed, cell, defeatedEnemies);
  if (bs) {
    if (!boss || boss.spawnId !== bs.id) {
      boss = { spawnId: bs.id, boss: new Boss(bs.x, bs.floorY, bs.hall.x0, bs.hall.x1), spawn: bs };
    }
  } else {
    boss = null;
  }
  // 補給キャッシュ(サバイバル §6): 同じ床ラン・保護点へ相乗りし、近傍に最大 1 個。
  // 開封済みは選定後の減算で差し引く(開封した候補の代わりは繰り上がらない)
  const caches = chooseSupplyCaches(seed, runs, protectedPoints, halls, claimedSupplyCaches);
  supplyCache = caches[0] ?? null;
}
// デバッグ/スクリーンショット用: ?x=&y= でスポーン位置を上書き(埋まり座標は自己責任)
const qx = params.get('x');
const qy = params.get('y');
const spawn = qx !== null && qy !== null ? { x: Number(qx), y: Number(qy) } : findSpawn(seed);
const player = new Player(spawn.x, spawn.y);
/** 復活点(ボディ左上)。休憩点に触れるたびに更新される */
let respawnPoint = { x: spawn.x, y: spawn.y };
/** 最後に安定して接地していた場所(遺留品の落下先、サバイバル段階 3)。初期値はスポーン地点 */
let groundAnchor: GroundAnchor = initialGroundAnchor(spawn.x, spawn.y);
/** 遺留品の箇所(セッション内のみ、最大 2 箇所)。実体は drops 内の DropItem への参照で持つ */
let remainsSites: DropItem[][] = [];
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
input.onWeaponChange(() => audio.weaponSwitch()); // 切替音(§6.7)。砲の自動復帰でも鳴る
// タブを隠すと rAF が止まり updateAudio が来ないが、AudioContext は進み続けるので context ごと止める
document.addEventListener('visibilitychange', () => {
  if (document.hidden) audio.suspend();
  else audio.resume();
});
// 眺望(§6.4)の状態。純粋関数 viewState の出力(目標ズーム・中心オフセット)にカメラが追従する
let view: ViewState = initialView(biomeCellAt(seed, Math.floor(spawn.y)));
// HUD の階層(§6.5): 到達した最高階層。落下で下がっても減らない
let maxLayer = layerNumber(seed, biomeCellAt(seed, Math.floor(spawn.y)));
/** localStorage の取得自体が例外になる環境があるため安全に取る(取れなければ記録なしで続行する) */
function safeLocalStorage(): LayerStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
const recordStorage = safeLocalStorage();
/**
 * 最深到達の記録(v2.0 Task 7)。seed ごとに localStorage へ永続化され、HUD に併記される。
 * ここでの読み込みと updateHud での保存だけが役割で、ゲームの数値・生成・物理には影響しない。
 */
let bestLayer = loadBestLayer(recordStorage, seed);
/** セッション開始時点の記録。新記録の字幕はこれを初めて超えたときにセッションで 1 回だけ出す */
const sessionStartBestLayer = bestLayer;
let newRecordAnnounced = false;
// スポーン位置も「到達した階層」に含める(開始時の maxLayer の定義と揃える)。字幕は出さず、
// 記録だけを同期する。これにより ?x=&y= で深い位置から始めた場合も記録が保存される
if (maxLayer > bestLayer) {
  bestLayer = maxLayer;
  saveBestLayer(recordStorage, seed, bestLayer);
}
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

// 重力子砲: ビーム残光(演出)。発射パラメータ(BORE_*)は entities/graviton で定義し beamHit と共有する
const BEAM_TTL = 0.3;   // 秒: ビーム残光の寿命(段階 3: 太さと明度が痩せていく減衰を読める長さ)
let lastBeam: { angle: number; ttl: number } | null = null;

// 発射直後の単発の「押し」(演出)。発射方向と逆向きへ画面を押し、0.1 秒で減衰する
const PUSH_TTL = 0.1;
let beamPush: { angle: number; ttl: number } | null = null;
// 溜めが満タン(chargeRatio=1)になってからの経過秒(描画の完了リング用。段階1 エフェクト設計 §2-4)。
// graviton の状態機械には触らず、update で chargeRatio を見て数えるだけ
let chargeFullT = 0;

// 破片の発生点(演出)。掘削点と命中点に置き、形と配置は render/beamShape が決める
interface DebrisBurst { x: number; y: number; angle: number; key: number; ttl: number }
let debrisBursts: DebrisBurst[] = [];
let shotCounter = 0;
const MAX_DEBRIS_BURSTS = 24;

function pushDebris(x: number, y: number, angle: number): void {
  debrisBursts.push({ x, y, angle, key: shotCounter, ttl: DEBRIS_TTL });
  if (debrisBursts.length > MAX_DEBRIS_BURSTS) {
    debrisBursts.splice(0, debrisBursts.length - MAX_DEBRIS_BURSTS);
  }
}

/**
 * 発射方向で最初に地形へ触れる点(掘削点)。破壊の適用前に呼ぶこと。
 * 未生成チャンクは生成せず、そこまで届かなければ null(破片は出さない)。
 */
function firstContact(ox: number, oy: number, angle: number): { x: number; y: number } | null {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  for (let d = 0.5; d <= BORE_LENGTH; d += 0.25) {
    const x = ox + dx * d;
    const y = oy + dy * d;
    const t = store.peekTileAt(Math.floor(x), Math.floor(y));
    if (t === undefined) return null;
    if (t !== TILE.AIR) return { x, y };
  }
  return null;
}

/** チャージ完了→離した瞬間: エイム方向へ地形を貫通破壊し、タイルへ反映して焼き込みを無効化する */
function fire(): void {
  hapticCannonFire();
  audio.cannonFire(); // 発射音(§6.7): サブの pitch 落下 + ノイズの破裂
  // 砲の発射が成立したら、武器モードをパルスへ自動復帰させる(設計 §3-3)。
  // 発射候補はタッチ(右スティック)と PC(左クリック)の解放で共通に立つ
  if (input.takeCannonRelease()) input.notifyCannonFired();
  const aim = renderer.aimAngle; // ライトコーンと同一の角度(=ビーム=破壊方向を保証)
  shotCounter++;
  // 掘削点は破壊の適用前に取る(適用後はタイルが空気になっている)
  const contact = firstContact(player.centerX, player.centerY, aim);
  // 未生成チャンクは生成せず破壊マスクだけ記録する(発射フレームでの同期生成を避ける)
  const knownBefore = destruction.knownBroken;
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
  // 破砕音(§6.7): 実際に壊れた実タイル数に応じて 1 音だけ鳴らす(地形が壊れなければ鳴らない)
  audio.cannonCrush(destruction.knownBroken - knownBefore);
  lastBeam = { angle: aim, ttl: BEAM_TTL };
  beamPush = { angle: aim, ttl: PUSH_TTL };
  if (contact) pushDebris(contact.x, contact.y, aim);
  applyBeamToEnemies(aim);
}

/**
 * 重粒子砲と敵の相互作用(第2弾 §3)。ビーム軸の capsule(beamHit)内の通常敵は
 * 即死し、撃破処理は通常経路(onEnemyKilled: 記録保持 + ドロップ抽選)を通す。
 * ボスには固定ダメージ BOSS_BEAM_DAMAGE(hit() の硬直 2 倍がそのまま効く)。
 * 掘削はこの時点ですでに適用済みで、地形が消えた直線上の敵を薙ぐ形になる。
 */
function applyBeamToEnemies(angle: number): void {
  const ox = player.centerX;
  const oy = player.centerY;
  const halfDiag = (w: number, h: number) => Math.hypot(w, h) / 2;
  let anyKill = false;
  for (const e of enemies) {
    if (!e.walker.dead && beamHit(ox, oy, angle, e.walker.centerX, e.walker.centerY, halfDiag(e.walker.body.w, e.walker.body.h))) {
      e.walker.hit(e.walker.hp); // 現在 HP ぶんを与えて即死させる(通常の被弾経路を通す)
      pushDebris(e.walker.centerX, e.walker.centerY, angle); // 命中点の破片
      anyKill = true;
    }
  }
  for (const e of flyers) {
    if (!e.flyer.dead && beamHit(ox, oy, angle, e.flyer.centerX, e.flyer.centerY, halfDiag(e.flyer.body.w, e.flyer.body.h))) {
      e.flyer.hit(e.flyer.hp);
      pushDebris(e.flyer.centerX, e.flyer.centerY, angle); // 命中点の破片
      anyKill = true;
    }
  }
  for (const e of turrets) {
    if (!e.turret.dead && beamHit(ox, oy, angle, e.turret.centerX, e.turret.centerY, halfDiag(e.turret.body.w, e.turret.body.h))) {
      e.turret.hit(e.turret.hp); // 通常敵と同じ即死経路
      pushDebris(e.turret.centerX, e.turret.centerY, angle); // 命中点の破片
      anyKill = true;
    }
  }
  if (anyKill) hapticEnemyDown();
  for (const e of enemies) if (e.walker.dead) onEnemyKilled(e.spawnId, e.walker.centerX, e.walker.centerY);
  enemies = enemies.filter((e) => !e.walker.dead);
  for (const e of flyers) if (e.flyer.dead) onEnemyKilled(e.spawnId, e.flyer.centerX, e.flyer.centerY);
  flyers = flyers.filter((e) => !e.flyer.dead);
  for (const e of turrets) if (e.turret.dead) onEnemyKilled(e.spawnId, e.turret.centerX, e.turret.centerY);
  turrets = turrets.filter((e) => !e.turret.dead);
  if (boss && beamHit(ox, oy, angle, boss.boss.centerX, boss.boss.centerY, halfDiag(BOSS_W, BOSS_H))) {
    pushDebris(boss.boss.centerX, boss.boss.centerY, angle); // 命中点の破片(撃破でなくても出す)
    if (boss.boss.hit(BOSS_BEAM_DAMAGE)) {
      hapticEnemyDown();
      onBossKilled(boss.spawnId, boss.boss);
      boss = null;
    } else {
      audio.enemyHit(); // 命中音(§6.7): 倒れていない命中だけ
    }
  }
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
  // ジャンプ・着地・梯子の音(§6.7): 物理の遷移から拾う(ゲームの数値・判定には触らない)。
  // ノックバックの跳ね上がりはジャンプと誤認しないよう knocked 中は除く
  const groundedNow = player.body.onGround;
  if (prevGrounded && !groundedNow && player.body.vy < -5 && !player.knocked) audio.jump();
  if (!prevGrounded && groundedNow) audio.land(prevFallVy);
  prevGrounded = groundedNow;
  prevFallVy = player.body.vy;
  // 崖つかみ(段階 2): 掴まった瞬間にハプティクス Light と、最小音量の着地音を相乗りさせる
  // (着地音のゲインは落下速度が決めるので、鳴る最小の速度 LAND_MIN_VY を渡す)
  const hanging = player.ledge !== null;
  if (!prevHanging && hanging) {
    hapticLedgeGrab();
    audio.land(LAND_MIN_VY);
  }
  prevHanging = hanging;
  // 梯子: 中心か足元が梯子タイルにあり縦に動いている間、段の刻み(rungCrossed)で鳴らす
  {
    const cxT = Math.floor(player.centerX);
    const feetRow = Math.floor(player.body.y + player.body.h - 1e-6);
    const onLadder =
      tiles(cxT, Math.floor(player.centerY)) === TILE.LADDER || tiles(cxT, feetRow) === TILE.LADDER;
    if (onLadder && player.body.vy !== 0) {
      const prevTravel = ladderTravel;
      ladderTravel += Math.abs(player.body.vy) * dt;
      if (rungCrossed(prevTravel, ladderTravel)) {
        audio.ladderRung(Math.floor(ladderTravel / LADDER_RUNG_STEP));
      }
    } else {
      ladderTravel = 0;
    }
  }
  // 安定接地点(遺留品の落下先、サバイバル段階 3): 接地が 1 秒続いた場所を記録する。
  // 空中・ノックバック中は更新しない(死亡座標そのものは回収不能な場所になり得るため使わない)
  groundAnchor = stepGroundAnchor(groundAnchor, {
    grounded: player.body.onGround,
    knocked: player.knocked,
    x: player.body.x,
    y: player.body.y,
    dt,
  });
  // 右スティックで狙っている間は、向きも照準の左右へ追従させる(移動方向と独立に狙うため。
  // ほぼ真上の狙いで向きが暴れないよう、横成分が弱いときは変えない)
  // 崖つかみ中は壁の側を向いたままにする(Player が毎フレーム facing を縁の側へ揃える)
  if (!hanging && input.touchAimActive && Math.abs(input.touchAimX) >= 0.3) {
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
    // 休憩点の箱の中に立ったら復活点をここへ更新する(HP は回復しない: サバイバル段階 2、設計 §7。
    // 回復は回復セルと死亡時の復活だけ。安全圏としての満腹度不消耗は下の inRestBox で維持する)
    const rp = nearestRestPoint(seed, player.centerX, player.centerY);
    const feet = player.body.y + player.body.h;
    const inRestBox =
      player.centerX > rp.left && player.centerX < rp.right &&
      player.centerY < rp.floorY && Math.abs(feet - rp.floorY) < 0.6;
    if (inRestBox) {
      const nextRespawn = { x: rp.x - player.body.w / 2, y: rp.floorY - player.body.h };
      if (nextRespawn.x !== respawnPoint.x || nextRespawn.y !== respawnPoint.y) {
        respawnPoint = nextRespawn;
        audio.respawnSet(); // 復活点が移ったときだけ鳴らす(§6.7)
      }
      // 確保(エクストラクション段階 A): どの休憩点でも、箱に入れば携行中の素材を全て確保済みへ移す。
      // 合図は専用の短い音と字幕(既存の音系・字幕系に相乗り)。携行が 0 のときは何も起きない
      const secured = secureCarry(carry);
      if (secured.moved > 0) {
        carry = secured.state;
        audio.secure();
        caption.show(secureCaptionText(secured.moved), simTime);
      }
      // 休憩点の初回補給(サバイバル §7): 初めて入った休憩点だけ備蓄を開ける(セッション内のみ)。
      // 備蓄は糧食 1 個 + 地区別の 1 個を荷袋(packX)付近へ出す。再訪しても補充されない。
      // 補給品の上限に達している間は開けず、消費して空きを作れば開けられる
      const restId = `r:${rp.cell},${rp.k}`;
      if (!claimedRestStocks.has(restId) && canAddSupply(drops, 2)) {
        claimedRestStocks.add(restId);
        const stockBiome = biomeIdForCell(seed, rp.cell);
        pushSupply(drops, new DropItem('ration', rp.packX + 0.5, rp.floorY - 0.5, true));
        pushSupply(drops, new DropItem(restStockSecondFor(seed, restId, stockBiome), rp.packX - 1, rp.floorY - 0.5, true));
        audio.restStock(); // 初回補給の音(§6.7)
      }
    }
    // 満腹度(サバイバル段階 1): 開放度と同じ 6 フレーム間隔で進める(毎フレームの休憩点探索は足さない)。
    // 安全圏は休憩点の箱の中とスポーン保護範囲(敵出現の保護点 r=10 と同じ範囲)
    const inSpawnProtection =
      Math.max(Math.abs(player.centerX - spawn.x), Math.abs(player.centerY - spawn.y)) <= 10;
    const sat = stepSatiety(satiety, {
      dt: OPENNESS_SAMPLE_INTERVAL_FRAMES * (STEP_MS / 1000),
      inSafeZone: inRestBox || inSpawnProtection,
      // 崖つかみ中は静止中扱い(設計 2026-11-09-ledge-grab §掴まり中)
      still: (player.body.onGround || hanging) && player.body.vx === 0,
      // 地区消耗倍率(サバイバル段階 2、設計 §4): プレイヤーのいるセルの地区で引く
      biomeMul: satietyBiomeMulFor(biomeIdForCell(seed, biomeCellAt(seed, Math.floor(player.centerY)))),
    });
    satiety = sat.state;
    if (sat.ateRation) audio.eat(); // 自動摂取の音(§6.7)。結果はこれまで拾われていなかった
    if (sat.hpDamage > 0) {
      // 飢餓ダメージは敵とは別経路: ノックバックも無敵時間も流用せず HP だけを減らす(設計 §4)
      player.hp = Math.max(0, player.hp - sat.hpDamage);
      audio.starveHurt(); // 飢餓の音(§6.7): 被弾とは別の音で経路の違いを表す
    }
    // 状態が low / critical へ落ちた瞬間だけ字幕で知らせる(毎秒表示はしない)
    const level = satietyLevel(satiety.value);
    if (level !== satietyPrevLevel) {
      if (level === 'low') caption.show('満腹度低下', simTime);
      else if (level === 'critical') caption.show('糧食が必要', simTime);
      // 字幕と同じ遷移で警告音も鳴らす(§6.7)。危険側へ落ちたときだけ
      if (level === 'low' || level === 'critical' || level === 'starving') audio.satietyWarn();
      satietyPrevLevel = level;
    }
  }
  // 眺望中は view.zoom が 0.35、それ以外は段キーパー由来の zoomTarget(1 フレーム前の値で十分)。
  // どちらも段の値なので、描画ズームは advanceZoom で段から段へ滑らかに遷移させる
  // (眺望の出入りも開放度の段移動も同じ経路。ジャンプは起きない)
  camera.zoom = advanceZoom(camera.zoom, view.zoom, dt);
  if (input.takeFireCancel()) graviton.cancelCharge(); // タッチ照準のキャンセル(解放より先に破棄)
  // 満腹度が危険域(critical / starving)では砲の自動回復が半分の速さになる(サバイバル段階 2、設計 §4)
  const satLevelNow = satietyLevel(satiety.value);
  const chargesBefore = graviton.charges;
  // 崖つかみ中は武器を使えない(設計 §掴まり中): 溜めは破棄し、発射・溜め入力を無視する
  if (hanging) graviton.cancelCharge();
  graviton.update(dt, input.fireHeld && !hanging, fire, rechargeTimeFor(satLevelNow === 'critical' || satLevelNow === 'starving'));
  // 自動回復で弾が増えたときだけ小さく知らせる(§6.7)。発射で減った分は差し引きで消える
  if (graviton.charges > chargesBefore) audio.rechargeTick();
  // 満タン継続時間(描画専用): 満タンの間だけ積み、離す・発射・キャンセルで ratio が落ちれば 0 に戻る
  chargeFullT = graviton.chargeRatio >= 1 ? chargeFullT + dt : 0;
  input.expireCannonRelease(); // スティック砲の発射候補は、この update で発射しなければ失効する
  // パルス(連射武器): 照準は右スティックのアナログ方向 > 保持照準 > 移動入力の 8 方向。
  // タッチチャンネルは PC では常に無効なので、キーボード/マウス時は従来どおり 8 方向になる
  const pulseDir = input.touchAimActive
    ? { x: input.touchAimX, y: input.touchAimY }
    : input.heldAimActive
      ? { x: input.heldAimX, y: input.heldAimY }
      : pulseAimDir(input.state, player.facing);
  // 発射原点は描画ポーズの銃口(肩−手−銃先)に合わせる。体の中心固定だと
  // 弾が腰の高さから出て見えるため、ポーズと照準から銃口の座標を取る。
  // isWalking の定義は renderer の描画判定と同一にする
  const muzzle = poseMuzzleWorld(
    player.centerX,
    player.centerY,
    player.facing,
    player.walkPhase,
    player.body.onGround && player.body.vx !== 0,
    Math.atan2(pulseDir.y, pulseDir.x),
    simTime,
    hanging,
    poseMotionOf(player), // 空中・梯子などのポーズでも描画の銃口と発射原点を一致させる
  );
  // 発射音(§6.7): 発射総数の差分で鳴らす。PulseGun 側は音を持たない(検証用カウンタのみ)
  const shotsBefore = pulseGun.shotsFired;
  pulseGun.update(
    dt, input.pulseHeld && !hanging, muzzle.x, muzzle.y, pulseDir.x, pulseDir.y, tiles,
    player.centerX, player.centerY,
  );
  for (let i = shotsBefore; i < pulseGun.shotsFired; i++) audio.pulseFire(i);

  // 歩行敵・飛行敵: 出現集合の更新、巡回/追尾、パルスとの命中判定(接触ダメージは第4段)
  if (frames % ENEMY_SCAN_INTERVAL_FRAMES === 0) refreshEnemies();
  for (const e of enemies) e.walker.update(dt, tiles);
  for (const e of flyers) {
    const prevMode = e.flyer.mode;
    e.flyer.update(dt, tiles, player.centerX, player.centerY);
    // 追尾開始の合図(§6.7): 巡回→追尾の遷移でだけ鳴らす
    if (prevMode === 'patrol' && e.flyer.mode === 'chase') audio.flyerAlert();
  }
  // 固定砲台: 発射された弾を保持リストへ移し、弾の更新と消滅、地形との衝突を行う
  for (const e of turrets) {
    const fired = e.turret.update(dt, tiles, player.centerX, player.centerY);
    if (fired.length > 0) audio.turretFire(); // 砲台の発射音(§6.7)
    for (const s of fired) turretShots.push(s);
  }
  if (turretShots.length > 0) {
    for (const s of turretShots) s.update(dt, tiles);
    turretShots = turretShots.filter((s) => !s.dead);
    // 弾とプレイヤーの重なり: 重なった弾は無敵時間で無効化されても消費する
    if (!player.dead && turretShots.length > 0) {
      const pb = player.body;
      turretShots = turretShots.filter((s) => {
        const b = s.body;
        const overlap = pb.x < b.x + b.w && pb.x + pb.w > b.x && pb.y < b.y + b.h && pb.y + pb.h > b.y;
        if (!overlap) return true;
        if (player.damage(s.centerX)) { hapticDamage(); audio.hurt(); }
        return false;
      });
    }
  }
  // ボスの出現音(§6.7): 有効化された最初のフレームに 1 回
  const bossIdNow = boss ? boss.spawnId : null;
  if (bossIdNow !== null && bossIdNow !== prevBossSpawnId) audio.bossAppear();
  prevBossSpawnId = bossIdNow;
  if (boss) {
    const hall = boss.spawn.hall;
    const playerInHall =
      player.centerX >= hall.x0 && player.centerX < hall.x1 &&
      player.centerY >= hall.y0 && player.centerY < hall.y1;
    const prevPhase = boss.boss.phase;
    boss.boss.update(dt, tiles, player.centerX, player.centerY, playerInHall);
    // 予備動作の開始に短い警告音を 1 回だけ重ねる(Task 2、音響エンジン相乗り)
    if (prevPhase !== 'windup' && boss.boss.phase === 'windup') audio.bossWarn();
    // 突進開始と激突(硬直入り)の音(§6.7)
    if (prevPhase === 'windup' && boss.boss.phase === 'charge') audio.bossCharge();
    if (prevPhase === 'charge' && boss.boss.phase === 'stunned') audio.bossCrash();
  }
  if ((enemies.length > 0 || flyers.length > 0 || turrets.length > 0 || boss) && pulseGun.pulses.length > 0) {
    const spent = new Set<Pulse>();
    for (const p of pulseGun.pulses) {
      for (const e of enemies) {
        const b = e.walker.body;
        if (
          p.body.x < b.x + b.w && p.body.x + p.body.w > b.x &&
          p.body.y < b.y + b.h && p.body.y + p.body.h > b.y
        ) {
          if (e.walker.hit(PULSE_DAMAGE)) hapticEnemyDown(); else audio.enemyHit(); // 命中音(§6.7)
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
          if (e.flyer.hit(PULSE_DAMAGE)) hapticEnemyDown(); else audio.enemyHit(); // 命中音(§6.7)
          spent.add(p);
          break;
        }
      }
      if (spent.has(p)) continue;
      for (const e of turrets) {
        const b = e.turret.body;
        if (
          p.body.x < b.x + b.w && p.body.x + p.body.w > b.x &&
          p.body.y < b.y + b.h && p.body.y + p.body.h > b.y
        ) {
          if (e.turret.hit(PULSE_DAMAGE)) hapticEnemyDown(); else audio.enemyHit(); // 命中音(§6.7)
          spent.add(p);
          break;
        }
      }
      if (spent.has(p) || !boss) continue;
      const b = boss.boss.body;
      if (
        p.body.x < b.x + b.w && p.body.x + p.body.w > b.x &&
        p.body.y < b.y + b.h && p.body.y + p.body.h > b.y
      ) {
        if (boss.boss.hit(PULSE_DAMAGE)) hapticEnemyDown(); else audio.enemyHit(); // 命中音(§6.7)
        spent.add(p);
      }
    }
    if (spent.size > 0) pulseGun.pulses = pulseGun.pulses.filter((p) => !spent.has(p));
    // 撃破を記録してから実体を捨てる(記録保持 §4: 倒した敵は再出現しない)。
    // 記録と同時にドロップ抽選も 1 回だけ行う(§3)
    for (const e of enemies) if (e.walker.dead) onEnemyKilled(e.spawnId, e.walker.centerX, e.walker.centerY);
    enemies = enemies.filter((e) => !e.walker.dead);
    for (const e of flyers) if (e.flyer.dead) onEnemyKilled(e.spawnId, e.flyer.centerX, e.flyer.centerY);
    flyers = flyers.filter((e) => !e.flyer.dead);
    for (const e of turrets) if (e.turret.dead) onEnemyKilled(e.spawnId, e.turret.centerX, e.turret.centerY);
    turrets = turrets.filter((e) => !e.turret.dead);
    if (boss && boss.boss.dead) {
      onBossKilled(boss.spawnId, boss.boss);
      boss = null;
    }
  }

  // ドロップ: 落下・寿命の更新と、プレイヤー接触での取得(満タン時は拾えず残る)
  for (const d of drops) d.update(dt, tiles);
  if (drops.length > 0) drops = drops.filter((d) => !d.expired);
  if (!player.dead && drops.length > 0) {
    const pb = player.body;
    drops = drops.filter((d) => {
      const b = d.body;
      const overlap = pb.x < b.x + b.w && pb.x + pb.w > b.x && pb.y < b.y + b.h && pb.y + pb.h > b.y;
      if (!overlap) return true;
      if (!canPickup(d.kind, graviton.charges, MAX_CHARGES, player.hp, MAX_HP, satiety.rations, MAX_RATIONS, carriedTotal(carry), carry.cap)) return true;
      if (d.kind === 'charge') graviton.charges++;
      else if (d.kind === 'heal') player.hp++;
      // 素材セル(段階 A)は携行へ入る(休憩点で確保済みへ移る)
      else if (isCarryKind(d.kind)) carry = addCarry(carry, d.kind);
      // 糧食は所持数だけが増える(満腹度は即時回復しない。自動摂取で消費される)
      else satiety = { ...satiety, rations: satiety.rations + 1 };
      audio.pickup(d.kind); // 取得音(§6.7): 種別で音色を変える
      return false;
    });
  }

  // 補給キャッシュ: 接触で即開封し、中身 1 個をその場に補給品として出す(サバイバル §6)。
  // 補給品の上限に達している間は開封済みにしない(消費して空きを作れば開けられる)
  if (supplyCache && !player.dead && canAddSupply(drops, 1)) {
    const c = supplyCache;
    const pb = player.body;
    const overlap =
      pb.x < c.x + 0.45 && pb.x + pb.w > c.x - 0.45 &&
      pb.y < c.floorY && pb.y + pb.h > c.floorY - 0.6;
    if (overlap) {
      claimedSupplyCaches.add(c.id);
      const cacheBiome = biomeIdForCell(seed, biomeCellAt(seed, c.floorY));
      pushSupply(drops, new DropItem(supplyFor(seed, c.id, cacheBiome), c.x, c.floorY - 0.5, true));
      supplyCache = null;
      audio.cacheOpen(); // 開封音(§6.7)
    }
  }

  // 敵との接触ダメージと、死亡時の復活(最後の休憩点、無ければスポーン地点)
  if (!player.dead) {
    const pb = player.body;
    for (const e of enemies) {
      const b = e.walker.body;
      if (pb.x < b.x + b.w && pb.x + pb.w > b.x && pb.y < b.y + b.h && pb.y + pb.h > b.y) {
        if (player.damage(e.walker.centerX)) { hapticDamage(); audio.hurt(); }
        break;
      }
    }
    if (!player.dead) {
      for (const e of flyers) {
        const b = e.flyer.body;
        if (pb.x < b.x + b.w && pb.x + pb.w > b.x && pb.y < b.y + b.h && pb.y + pb.h > b.y) {
          if (player.damage(e.flyer.centerX)) { hapticDamage(); audio.hurt(); }
          break;
        }
      }
    }
    if (!player.dead && boss) {
      const b = boss.boss.body;
      if (pb.x < b.x + b.w && pb.x + pb.w > b.x && pb.y < b.y + b.h && pb.y + pb.h > b.y) {
        if (player.damage(boss.boss.centerX)) { hapticDamage(); audio.hurt(); }
      }
    }
  }
  if (player.dead) {
    audio.death(); // 死亡音と復活音(§6.7)。復活音はエンジン側で少し遅らせて鳴らす
    audio.revive();
    // 遺留品(サバイバル段階 3): テレポートの前に、所持糧食を最後の安定接地点へ落とす
    dropRemainsOnDeath();
    player.body.x = respawnPoint.x;
    player.body.y = respawnPoint.y;
    player.revive();
    // 満腹度は 35 に戻し、糧食は 0(遺留品へ移ったぶん。保持はしない)
    satiety = resetSatietyOnDeath(satiety);
    // 携行素材(エクストラクション段階 A)は死亡しても保持する(ロスト・遺留品化は段階 B)
    satietyPrevLevel = satietyLevel(satiety.value);
    // 復活点が新しい基準になる(次の遺留品の落下先は、ここから先の安定接地で決まる)
    groundAnchor = initialGroundAnchor(respawnPoint.x, respawnPoint.y);
    enemies = []; // 実体は捨てるが撃破記録(defeatedEnemies)は残す(§4: 死亡でリセットしない)
    flyers = [];
    turrets = []; // 砲台も実体は捨てる(撃破済みなら記録により再出現しない)
    turretShots = []; // 砲台の弾も消す
    boss = null; // ボスも実体は捨てる(撃破済みなら記録により再出現しない)
    pulseGun.pulses = [];
  }
  updateAudio();
  if (lastBeam) {
    lastBeam.ttl -= dt;
    if (lastBeam.ttl <= 0) lastBeam = null;
  }
  if (beamPush) {
    beamPush.ttl -= dt;
    if (beamPush.ttl <= 0) beamPush = null;
  }
  if (debrisBursts.length > 0) {
    for (const b of debrisBursts) b.ttl -= dt;
    debrisBursts = debrisBursts.filter((b) => b.ttl > 0);
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
    chargeRatio: graviton.chargeRatio,
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
  if (player.body.onGround) {
    const prevMax = maxLayer;
    const nextMax = highestLayer(prevMax, layerNumber(seed, biomeCellAt(seed, Math.floor(player.body.y))));
    if (nextMax > prevMax) {
      maxLayer = nextMax;
      // 最深記録(v2.0 Task 7): 記録を上回ったら更新して保存する(表示と保存だけ)
      if (nextMax > bestLayer) {
        bestLayer = nextMax;
        saveBestLayer(recordStorage, seed, bestLayer);
      }
      // 字幕: 節目(5 階層ごと)を跨いだら到達を知らせる。セッション開始時点の記録を初めて
      // 超えたときは新記録として知らせる(セッションで 1 回だけ)。両方が重なったら節目を
      // 優先し、新記録の字幕はその回で消費する
      const milestone = crossedMilestone(prevMax, nextMax);
      const exceedsStart = !newRecordAnnounced && nextMax > sessionStartBestLayer;
      if (milestone !== null) {
        caption.show(milestoneCaptionText(milestone), simTime);
        audio.milestone(); // 節目のジングル(§6.7)
        if (exceedsStart) newRecordAnnounced = true;
      } else if (exceedsStart) {
        newRecordAnnounced = true;
        caption.show(newRecordCaptionText(nextMax), simTime);
        audio.newRecord(); // 新記録のジングル(§6.7)
      }
    }
  }
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
  // ボス HP バー(第2弾 §2): 番人が有効な間だけ、プレイヤー HP と同じ HUD 経路に相乗りする
  let bossHud = '';
  if (boss) {
    const filled = Math.max(0, Math.ceil((boss.boss.hp / BOSS_HP) * 10));
    bossHud = ` — 広間番人 [${'#'.repeat(filled)}${'-'.repeat(10 - filled)}]`;
  }
  // 満腹度(サバイバル §4): 既存 HUD 文字列へ相乗り。状態は色でなく文字でも分かるようにする
  const satLevel = satietyLevel(satiety.value);
  const satLabel = satLevel === 'low' ? '満腹低下' : satLevel === 'ok' ? '満腹' : '満腹危険';
  const satBars = Math.max(0, Math.min(10, Math.round(satiety.value / 10)));
  const satietyHud = ` — ${satLabel} [${'#'.repeat(satBars)}${'-'.repeat(10 - satBars)}] ${Math.floor(satiety.value)} / 糧食 ${satiety.rations}`;
  // 携行と確保の併記(エクストラクション段階 A): 携行 n/枠 と 確保済み m(最深記録の併記と同じ流儀)
  const carryHud = ` — 携行 ${carriedTotal(carry)}/${carry.cap} / 確保済み ${securedTotal(carry)}`;
  // 最深記録の併記(v2.0 Task 7)。記録が 0(記録なし)のときは出さない
  const bestHud = bestLayer > 0 ? ` / 最深記録 第 ${bestLayer} 階層` : '';
  hud.textContent = `第 ${maxLayer} 階層${bestHud} / 高度 ${altitude} — ${SYSTEM_LABEL[sys]} [seed:${seed}] — ${weapon} — HP ${hearts}${bossHud}${satietyHud}${carryHud}`;
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
  const push = beamPush ? { angle: beamPush.angle, t: beamPush.ttl / PUSH_TTL } : null;
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
    chargeFullT,
    beam,
    push,
    debris: debrisBursts.map((b) => ({
      x: b.x, y: b.y, angle: b.angle, key: b.key, age: DEBRIS_TTL - b.ttl,
    })),
    pulses: pulseGun.pulses.map((p) => ({
      x: p.body.x + PULSE_SIZE / 2,
      y: p.body.y + PULSE_SIZE / 2,
      dx: p.dx,
      dy: p.dy,
    })),
    shots: turretShots.map((s) => ({
      x: s.centerX,
      y: s.centerY,
      dx: s.dx,
      dy: s.dy,
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
      ...turrets.map((e) => ({
        x: e.turret.centerX,
        y: e.turret.centerY,
        flash: e.turret.flashT > 0,
        turret: true,
        angle: e.turret.angle,
      })),
      // ボス: 体格(w/h)と相を渡し、renderer 側で相の違い(予備動作の点滅・硬直の晒し)を読む
      ...(boss
        ? [{
            x: boss.boss.centerX,
            y: boss.boss.centerY,
            flash: boss.boss.flashT > 0,
            w: BOSS_W,
            h: BOSS_H,
            bossPhase: boss.boss.phase,
            bossPhaseT: boss.boss.phaseT,
            bossDir: boss.boss.dir,
          }]
        : []),
    ],
    // ドロップ: 寿命の残り 5 秒は点滅(約 4 Hz で消灯側のフレームを hidden にする)
    drops: drops.map((d) => ({
      x: d.centerX,
      y: d.centerY,
      kind: d.kind,
      hidden: d.blinking && Math.floor(simTime * 4) % 2 === 1,
    })),
    // 補給キャッシュ: 未開封のものだけ。中心は袋の見た目の中心(床の少し上)
    caches: supplyCache ? [{ x: supplyCache.x, y: supplyCache.floorY - 0.28 }] : [],
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
