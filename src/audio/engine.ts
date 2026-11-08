import type { BiomeId } from '../world/biomeCells';
import {
  BEAT_DETUNE_HZ, chargeFreq, chargeGain, crushParams, dbToGain,
  DOWN_FREQ_END, DOWN_FREQ_START, DOWN_GAIN, DOWN_NOISE_GAIN, DOWN_NOISE_HZ, DOWN_NOISE_SECONDS, DOWN_SECONDS,
  droneParams,
  FIRE_NOISE_END_HZ, FIRE_NOISE_GAIN, FIRE_NOISE_SECONDS, FIRE_NOISE_START_HZ,
  FIRE_SUB_END_HZ, FIRE_SUB_GAIN, FIRE_SUB_SECONDS, FIRE_SUB_START_HZ,
  footstepCrossed, HIT_FREQ, HIT_GAIN, HIT_NOISE_GAIN, HIT_NOISE_HZ, HIT_SECONDS, HUM_FREQ, interfaceBeat,
  DEATH_FREQ_END, DEATH_FREQ_START, DEATH_GAIN, DEATH_SECONDS,
  HURT_FREQ_END, HURT_FREQ_START, HURT_GAIN, HURT_SECONDS,
  JUMP_FREQ_END, JUMP_FREQ_START, JUMP_GAIN, JUMP_SECONDS,
  LADDER_FREQ_A, LADDER_FREQ_B, LADDER_GAIN, LADDER_SECONDS, landGain, LAND_NOISE_HZ, LAND_SECONDS,
  MASTER_DB, PASSAGE_DECAY, PASSAGE_FREQ,
  PULSE_FREQ_END, PULSE_FREQ_START, PULSE_GAIN, PULSE_SECONDS, pulseDetune,
  REVIVE_DELAY, REVIVE_GAIN, REVIVE_NOTE_GAP, REVIVE_NOTES,
  CACHE_GAIN, CACHE_HZ_END, CACHE_HZ_START, CACHE_SECONDS,
  EAT_GAIN, EAT_GAP, EAT_HZ, EAT_SECONDS,
  JINGLE_GAIN, JINGLE_NOTE_GAP, JINGLE_NOTE_SECONDS, MILESTONE_NOTES, NEW_RECORD_NOTES,
  PICKUP_GAIN, PICKUP_NOTE_GAP, pickupNotes,
  RECHARGE_FREQ, RECHARGE_GAIN, RECHARGE_SECONDS,
  RESPAWN_FREQ, RESPAWN_GAIN, RESPAWN_SECONDS, REST_STOCK_GAIN, REST_STOCK_NOTES,
  SATIETY_WARN_FREQ, SATIETY_WARN_GAIN, SATIETY_WARN_GAP, SATIETY_WARN_SECONDS,
  SWITCH_FREQ, SWITCH_GAIN, SWITCH_SECONDS,
  BOSS_APPEAR_FREQ, BOSS_APPEAR_GAIN, BOSS_APPEAR_NOISE_GAIN, BOSS_APPEAR_NOISE_HZ, BOSS_APPEAR_SECONDS,
  BOSS_CHARGE_GAIN, BOSS_CHARGE_HZ_END, BOSS_CHARGE_HZ_START, BOSS_CHARGE_SECONDS,
  BOSS_CRASH_GAIN, BOSS_CRASH_HZ, BOSS_CRASH_SECONDS, BOSS_CRASH_SUB_FREQ, BOSS_CRASH_SUB_GAIN, BOSS_CRASH_SUB_SECONDS,
  BOSS_DOWN_FREQ_END, BOSS_DOWN_FREQ_START, BOSS_DOWN_GAIN, BOSS_DOWN_NOISE_GAIN, BOSS_DOWN_NOISE_HZ, BOSS_DOWN_NOISE_SECONDS, BOSS_DOWN_SECONDS,
  FLYER_FREQ_END, FLYER_FREQ_START, FLYER_GAIN, FLYER_SECONDS,
  TURRET_FREQ_END, TURRET_FREQ_START, TURRET_GAIN, TURRET_SECONDS,
  reverbBucket, reverbSecondsForBucket,
  STARVE_FREQ_END, STARVE_FREQ_START, STARVE_GAIN, STARVE_SECONDS,
  WARN_FREQ_END, WARN_FREQ_START, WARN_GAIN, WARN_SECONDS,
} from './params';

/**
 * WebAudio の薄い層(設計書 §6.7)。パラメータは params.ts の純粋関数で決め、ここはノードの生成と
 * ゲインの追従だけ。テスト対象外。
 *
 * グラフ: master → destination。dry → master、convolver → wet(0.35) → master。
 * - ドローン: 層のバイオームごとに倍音の OscillatorNode の組 1 つ。層が変わればクロスフェード(0.4 秒)。
 *   界面に近づくと基音 + 0.7 Hz の正弦波が足されてうなる(interfaceBeat)。
 * - 足音: 60 ms のノイズバースト(バンドパス 900 Hz)を dry と convolver の両方へ。残響長は開放度(6 段)。
 * - 通過音: 110 Hz の正弦波を 1.8 秒で指数減衰。
 * - 光柱のハム: 2200 Hz の正弦波 + 7 Hz の LFO、距離で減衰(beaconHum の値を受ける)。
 * - 重粒子砲: 溜め中は比率で pitch とゲインが上がる唸り(鋸波 + 微デチューン、ローパス連動)を
 *   保持し、比率が 0 に戻れば短いリリースで止める。発射音(cannonFire)はサブ正弦波の pitch 落下 +
 *   ローパスを落とすノイズの破裂。破砕音(cannonCrush)は破壊数でパラメータが変わるノイズの崩落。
 * - ボス警告音(bossWarn): 予備動作の開始に 1 回だけ鳴る短い矩形波の下降チャープ。
 * - パルス(pulseFire): 6 発/秒の連射に耐える短い三角波の下降音。発射インデックスで pitch を
 *   ばらし(pulseDetune)、異常な高密度の呼び出しは最小間隔で間引く。残響には送らず締める。
 * - 命中(enemyHit)と撃破(enemyDown): ワンショット。撃破は main の onEnemyKilled に集約され、
 *   パルスでもビームでも同じ音になる。
 * 全ての公開メソッドは開始前(ctx === null)なら何もしない。
 */
export interface AudioFrame {
  /** 今いる層のバイオーム(ドローン) */
  biome: BiomeId;
  /** 最寄りの板までの距離(タイル。params.nearestPlateDistance) */
  plateDistance: number;
  /** 足音の残響(開放度 0..1) */
  openness: number;
  /** 光柱のハムの強さ 0..1(params.beaconHum の最大) */
  hum: number;
  /** 接地歩行中 */
  walking: boolean;
  walkPhase: number;
  /** 重粒子砲の溜め比率 0..1(0 = 溜めていない)。溜め音の pitch・ゲインと開始/停止に使う */
  chargeRatio: number;
}

const DRONE_FADE = 0.4;
const WET_GAIN = 0.35;
const FOOTSTEP_SECONDS = 0.06;
const FOOTSTEP_GAIN = 0.5;
const HUM_GAIN = 0.06;
const HUM_LFO_HZ = 7;
const BEAT_GAIN = 0.5;
const PASSAGE_GAIN = 0.6;
/** 発射音・破砕音用の長いノイズバッファ(秒)。足音用(0.06 秒)とは別に 1 本だけ作って使い回す */
const LONG_NOISE_SECONDS = 1.5;
/** 溜め音の追従の時定数(秒)。pitch・ゲイン・ローパス共通 */
const CHARGE_FOLLOW = 0.03;
/** 溜め音のリリース(キャンセル/発射で比率が 0 に戻ったときの止まり方) */
const CHARGE_RELEASE = 0.05;
/** パルス音の最小発音間隔(秒)。通常の連射(1/6 秒)では効かず、異常な集中だけを間引く */
const PULSE_MIN_INTERVAL = 0.03;

interface Charge {
  main: OscillatorNode;
  detuned: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

interface Drone {
  biome: BiomeId;
  gain: GainNode;
  beatGain: GainNode;
  oscs: OscillatorNode[];
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private dry!: GainNode;
  private convolver!: ConvolverNode;
  private wet!: GainNode;
  private noise!: AudioBuffer;
  private noiseLong!: AudioBuffer;
  private charge: Charge | null = null;
  private impulses = new Map<number, AudioBuffer>();
  private reverbBucketNow = -1;
  private drone: Drone | null = null;
  private humGain!: GainNode;
  private isMuted = false;
  private prevWalkPhase = 0;
  private lastPulseAt = -Infinity;

  get started(): boolean {
    return this.ctx !== null;
  }

  get muted(): boolean {
    return this.isMuted;
  }

  /**
   * 入力のたびに呼ぶ(ブラウザの自動再生制限)。初回で AudioContext を作り、以降は running でなければ
   * resume を試みるだけ(Esc など「ユーザー操作」に数えられないキーが最初だと suspended のまま残るため)。
   */
  start(): void {
    if (typeof AudioContext === 'undefined') return;
    if (this.ctx) {
      if (this.ctx.state !== 'running') void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.isMuted ? 0 : dbToGain(MASTER_DB);
    this.master.connect(ctx.destination);
    this.dry = ctx.createGain();
    this.dry.connect(this.master);
    this.convolver = ctx.createConvolver();
    this.wet = ctx.createGain();
    this.wet.gain.value = WET_GAIN;
    this.convolver.connect(this.wet);
    this.wet.connect(this.master);
    this.noise = this.makeNoise(FOOTSTEP_SECONDS);
    this.noiseLong = this.makeNoise(LONG_NOISE_SECONDS);
    // 光柱のハム: 正弦波 × (1 + 0.3 × LFO)。ゲインは update で距離に追従
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    this.humGain.connect(this.dry);
    const hum = ctx.createOscillator();
    hum.type = 'sine';
    hum.frequency.value = HUM_FREQ;
    const trem = ctx.createGain();
    trem.gain.value = 0.7;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = HUM_LFO_HZ;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.3;
    lfo.connect(lfoDepth);
    lfoDepth.connect(trem.gain);
    hum.connect(trem);
    trem.connect(this.humGain);
    hum.start();
    lfo.start();
    void ctx.resume();
  }

  /**
   * タブを隠したときに呼ぶ。rAF が止まって update が来なくなるので、context ごと止めないと
   * ドローンとハムが最後のゲインのまま鳴り続ける。開始前・実行中でなければ何もしない。
   */
  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  /** タブが戻ったときに呼ぶ。suspend した context だけを再開する(開始前の resume は start の役目) */
  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(muted ? 0 : dbToGain(MASTER_DB), this.ctx.currentTime, 0.05);
  }

  /** 毎フレーム(update ループ) */
  update(frame: AudioFrame): void {
    const ctx = this.ctx;
    if (!ctx) {
      this.prevWalkPhase = frame.walkPhase;
      return;
    }
    const now = ctx.currentTime;
    if (!this.drone || this.drone.biome !== frame.biome) this.switchDrone(frame.biome);
    this.drone!.beatGain.gain.setTargetAtTime(BEAT_GAIN * interfaceBeat(frame.plateDistance), now, 0.2);
    this.humGain.gain.setTargetAtTime(HUM_GAIN * frame.hum, now, 0.2);
    const bucket = reverbBucket(frame.openness);
    if (bucket !== this.reverbBucketNow) {
      this.reverbBucketNow = bucket;
      this.convolver.buffer = this.impulseFor(bucket);
    }
    if (frame.walking && footstepCrossed(this.prevWalkPhase, frame.walkPhase)) this.footstep();
    this.prevWalkPhase = frame.walkPhase;
    this.updateCharge(frame.chargeRatio);
  }

  /**
   * パルスの発射音: 短い三角波の pitch 落下。連射(6 発/秒)でも煩くならないよう
   * 残響には送らず dry だけで締め、pitch は発射インデックスで決定論にばらす。
   * 発射間隔(1/6 秒)より詰まった呼び出しは PULSE_MIN_INTERVAL で間引く(保険)。
   */
  pulseFire(shotIndex: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - this.lastPulseAt < PULSE_MIN_INTERVAL) return;
    this.lastPulseAt = now;
    const mul = pulseDetune(shotIndex);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(PULSE_FREQ_START * mul, now);
    osc.frequency.exponentialRampToValueAtTime(PULSE_FREQ_END * mul, now + PULSE_SECONDS);
    const g = ctx.createGain();
    g.gain.setValueAtTime(PULSE_GAIN, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + PULSE_SECONDS);
    osc.connect(g);
    g.connect(this.dry);
    osc.start(now);
    osc.stop(now + PULSE_SECONDS + 0.05);
  }

  /** 敵への命中(非撃破): 矩形波の低いブリップ + ノイズのティック */
  enemyHit(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = HIT_FREQ;
    const g = ctx.createGain();
    g.gain.setValueAtTime(HIT_GAIN, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + HIT_SECONDS);
    osc.connect(g);
    g.connect(this.dry);
    osc.start(now);
    osc.stop(now + HIT_SECONDS + 0.05);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = HIT_NOISE_HZ;
    bp.Q.value = 1;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(HIT_NOISE_GAIN, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + HIT_SECONDS);
    src.connect(bp);
    bp.connect(ng);
    ng.connect(this.dry);
    src.start(now);
    src.stop(now + HIT_SECONDS + 0.05);
  }

  /** 敵の撃破: 正弦波の pitch 落下(芯)+ ローパスのノイズ(崩れ)。パルスでもビームでも同じ音 */
  enemyDown(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(DOWN_FREQ_START, now);
    osc.frequency.exponentialRampToValueAtTime(DOWN_FREQ_END, now + DOWN_SECONDS);
    const g = ctx.createGain();
    g.gain.setValueAtTime(DOWN_GAIN, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + DOWN_SECONDS);
    osc.connect(g);
    g.connect(this.dry);
    g.connect(this.convolver);
    osc.start(now);
    osc.stop(now + DOWN_SECONDS + 0.05);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseLong;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = DOWN_NOISE_HZ;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(DOWN_NOISE_GAIN, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + DOWN_NOISE_SECONDS);
    src.connect(lp);
    lp.connect(ng);
    ng.connect(this.dry);
    src.start(now, Math.random());
    src.stop(now + DOWN_NOISE_SECONDS + 0.05);
  }

  /** プレイヤーの被弾: 鋸波の pitch 落下。ハプティクス(中)と対になる */
  hurt(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(HURT_FREQ_START, now);
    osc.frequency.exponentialRampToValueAtTime(HURT_FREQ_END, now + HURT_SECONDS);
    const g = ctx.createGain();
    g.gain.setValueAtTime(HURT_GAIN, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + HURT_SECONDS);
    osc.connect(g);
    g.connect(this.dry);
    g.connect(this.convolver);
    osc.start(now);
    osc.stop(now + HURT_SECONDS + 0.05);
  }

  /** 飢餓ダメージ: 被弾とは別の、三角波の空虚な下降 */
  starveHurt(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(STARVE_FREQ_START, now);
    osc.frequency.exponentialRampToValueAtTime(STARVE_FREQ_END, now + STARVE_SECONDS);
    const g = ctx.createGain();
    g.gain.setValueAtTime(STARVE_GAIN, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + STARVE_SECONDS);
    osc.connect(g);
    g.connect(this.dry);
    osc.start(now);
    osc.stop(now + STARVE_SECONDS + 0.05);
  }

  /** プレイヤーの死亡: 長い pitch 落下 */
  death(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(DEATH_FREQ_START, now);
    osc.frequency.exponentialRampToValueAtTime(DEATH_FREQ_END, now + DEATH_SECONDS);
    const g = ctx.createGain();
    g.gain.setValueAtTime(DEATH_GAIN, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + DEATH_SECONDS);
    osc.connect(g);
    g.connect(this.dry);
    g.connect(this.convolver);
    osc.start(now);
    osc.stop(now + DEATH_SECONDS + 0.05);
  }

  /** 復活: 死亡と同一フレームに呼ばれるため、少し遅らせて 2 音の正弦波を出す */
  revive(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + REVIVE_DELAY;
    REVIVE_NOTES.forEach((freq, i) => {
      const t = t0 + i * REVIVE_NOTE_GAP;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(REVIVE_GAIN, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      osc.connect(g);
      g.connect(this.dry);
      g.connect(this.convolver);
      osc.start(t);
      osc.stop(t + 0.3);
    });
  }

  /** ジャンプ: 軽い pitch 上昇 */
  jump(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(JUMP_FREQ_START, now);
    osc.frequency.exponentialRampToValueAtTime(JUMP_FREQ_END, now + JUMP_SECONDS);
    const g = ctx.createGain();
    g.gain.setValueAtTime(JUMP_GAIN, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + JUMP_SECONDS);
    osc.connect(g);
    g.connect(this.dry);
    osc.start(now);
    osc.stop(now + JUMP_SECONDS + 0.05);
  }

  /** 着地: 低いノイズのドスン。ゲインは landGain(落下速度)が決め、0 なら鳴らさない */
  land(fallSpeed: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const gain = landGain(fallSpeed);
    if (gain <= 0) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = LAND_NOISE_HZ;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + LAND_SECONDS);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.dry);
    g.connect(this.convolver);
    src.start(now);
    src.stop(now + LAND_SECONDS + 0.05);
  }

  /** 梯子の段: 短いノイズのティック。段の偶奇で周波数を交互に変える */
  ladderRung(rungIndex: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = rungIndex % 2 === 0 ? LADDER_FREQ_A : LADDER_FREQ_B;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(LADDER_GAIN, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + LADDER_SECONDS);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.dry);
    src.start(now);
    src.stop(now + LADDER_SECONDS + 0.05);
  }

  /**
   * 上行の短い音列(取得・補給・ジングルの共通形)。各音は正弦波で、立ち上がりだけ
   * 線形に開いてクリックを消し、指数で減衰させる。残響にも送って広がりを持たせる。
   */
  private noteRun(notes: readonly number[], gain: number, gap: number, noteSeconds: number): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    notes.forEach((freq, i) => {
      const t = t0 + i * gap;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + noteSeconds);
      osc.connect(g);
      g.connect(this.dry);
      g.connect(this.convolver);
      osc.start(t);
      osc.stop(t + noteSeconds + 0.05);
    });
  }

  /** ドロップ取得: 種別ごとの上行 2 音(pickupNotes) */
  pickup(kind: string): void {
    if (!this.ctx) return;
    this.noteRun(pickupNotes(kind), PICKUP_GAIN, PICKUP_NOTE_GAP, 0.16);
  }

  /** 補給キャッシュ開封: バンドパスを掃引するノイズの擦れ */
  cacheOpen(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseLong;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(CACHE_HZ_START, now);
    bp.frequency.exponentialRampToValueAtTime(CACHE_HZ_END, now + CACHE_SECONDS);
    const g = ctx.createGain();
    g.gain.setValueAtTime(CACHE_GAIN, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + CACHE_SECONDS);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.dry);
    g.connect(this.convolver);
    src.start(now, Math.random());
    src.stop(now + CACHE_SECONDS + 0.05);
  }

  /** 休憩点の初回補給: 温かい上行 2 音 */
  restStock(): void {
    if (!this.ctx) return;
    this.noteRun(REST_STOCK_NOTES, REST_STOCK_GAIN, 0.08, 0.25);
  }

  /** 復活点の更新: 控えめな単音(箱に入るたびでなく、移ったときだけ呼ばれる前提) */
  respawnSet(): void {
    if (!this.ctx) return;
    this.noteRun([RESPAWN_FREQ], RESPAWN_GAIN, 0, RESPAWN_SECONDS + 0.05);
  }

  /** 武器切替: 短い矩形波のクリック */
  weaponSwitch(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = SWITCH_FREQ;
    const g = ctx.createGain();
    g.gain.setValueAtTime(SWITCH_GAIN, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + SWITCH_SECONDS);
    osc.connect(g);
    g.connect(this.dry);
    osc.start(now);
    osc.stop(now + SWITCH_SECONDS + 0.05);
  }

  /** 砲の弾回復の完了: ごく小さな単音の合図 */
  rechargeTick(): void {
    if (!this.ctx) return;
    this.noteRun([RECHARGE_FREQ], RECHARGE_GAIN, 0, RECHARGE_SECONDS + 0.03);
  }

  /** 満腹度の警告(レベルが low / critical へ落ちた遷移): 低い矩形波の 2 連 */
  satietyWarn(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const t = t0 + i * SATIETY_WARN_GAP;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = SATIETY_WARN_FREQ;
      const g = ctx.createGain();
      g.gain.setValueAtTime(SATIETY_WARN_GAIN, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + SATIETY_WARN_SECONDS);
      osc.connect(g);
      g.connect(this.dry);
      osc.start(t);
      osc.stop(t + SATIETY_WARN_SECONDS + 0.05);
    }
  }

  /** 糧食の自動摂取: ローパスのノイズを 2 回噛む */
  eat(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const t = t0 + i * EAT_GAP;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = EAT_HZ;
      const g = ctx.createGain();
      g.gain.setValueAtTime(EAT_GAIN, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + EAT_SECONDS);
      src.connect(lp);
      lp.connect(g);
      g.connect(this.dry);
      src.start(t);
      src.stop(t + EAT_SECONDS + 0.05);
    }
  }

  /** 階層の節目到達: 3 音の上行ジングル */
  milestone(): void {
    if (!this.ctx) return;
    this.noteRun(MILESTONE_NOTES, JINGLE_GAIN, JINGLE_NOTE_GAP, JINGLE_NOTE_SECONDS);
  }

  /** 最深の新記録: 4 音の上行ジングル */
  newRecord(): void {
    if (!this.ctx) return;
    this.noteRun(NEW_RECORD_NOTES, JINGLE_GAIN, JINGLE_NOTE_GAP, JINGLE_NOTE_SECONDS);
  }

  /** 砲台の発射: 矩形波の硬い下降。パルス(三角波・低め)と音色で分ける */
  turretFire(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(TURRET_FREQ_START, now);
    osc.frequency.exponentialRampToValueAtTime(TURRET_FREQ_END, now + TURRET_SECONDS);
    const g = ctx.createGain();
    g.gain.setValueAtTime(TURRET_GAIN, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + TURRET_SECONDS);
    osc.connect(g);
    g.connect(this.dry);
    osc.start(now);
    osc.stop(now + TURRET_SECONDS + 0.05);
  }

  /** 飛行敵の追尾開始: 小さな上昇チャープ。頻発しても煩くならない音量に抑える */
  flyerAlert(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(FLYER_FREQ_START, now);
    osc.frequency.exponentialRampToValueAtTime(FLYER_FREQ_END, now + FLYER_SECONDS);
    const g = ctx.createGain();
    g.gain.setValueAtTime(FLYER_GAIN, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + FLYER_SECONDS);
    osc.connect(g);
    g.connect(this.dry);
    osc.start(now);
    osc.stop(now + FLYER_SECONDS + 0.05);
  }

  /** ボスの出現: 低い正弦波が膨らんで消える + ノイズの地鳴り */
  bossAppear(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = BOSS_APPEAR_FREQ;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(BOSS_APPEAR_GAIN, now + BOSS_APPEAR_SECONDS * 0.4);
    g.gain.exponentialRampToValueAtTime(0.001, now + BOSS_APPEAR_SECONDS);
    osc.connect(g);
    g.connect(this.dry);
    g.connect(this.convolver);
    osc.start(now);
    osc.stop(now + BOSS_APPEAR_SECONDS + 0.05);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseLong;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = BOSS_APPEAR_NOISE_HZ;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(BOSS_APPEAR_NOISE_GAIN, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + BOSS_APPEAR_SECONDS);
    src.connect(lp);
    lp.connect(ng);
    ng.connect(this.dry);
    src.start(now, Math.random());
    src.stop(now + BOSS_APPEAR_SECONDS + 0.05);
  }

  /** ボスの突進開始: バンドパスを掃引するノイズの疾走 */
  bossCharge(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseLong;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1;
    bp.frequency.setValueAtTime(BOSS_CHARGE_HZ_START, now);
    bp.frequency.exponentialRampToValueAtTime(BOSS_CHARGE_HZ_END, now + BOSS_CHARGE_SECONDS);
    const g = ctx.createGain();
    g.gain.setValueAtTime(BOSS_CHARGE_GAIN, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + BOSS_CHARGE_SECONDS);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.dry);
    g.connect(this.convolver);
    src.start(now, Math.random());
    src.stop(now + BOSS_CHARGE_SECONDS + 0.05);
  }

  /** ボスの激突(硬直入り): 低いノイズの衝突 + サブのドスン */
  bossCrash(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseLong;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = BOSS_CRASH_HZ;
    const g = ctx.createGain();
    g.gain.setValueAtTime(BOSS_CRASH_GAIN, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + BOSS_CRASH_SECONDS);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.dry);
    g.connect(this.convolver);
    src.start(now, Math.random());
    src.stop(now + BOSS_CRASH_SECONDS + 0.05);
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = BOSS_CRASH_SUB_FREQ;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(BOSS_CRASH_SUB_GAIN, now);
    sg.gain.exponentialRampToValueAtTime(0.001, now + BOSS_CRASH_SUB_SECONDS);
    sub.connect(sg);
    sg.connect(this.dry);
    sub.start(now);
    sub.stop(now + BOSS_CRASH_SUB_SECONDS + 0.05);
  }

  /** ボスの撃破: 通常撃破より長く重い pitch 落下 + ノイズの崩壊 */
  bossDown(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(BOSS_DOWN_FREQ_START, now);
    osc.frequency.exponentialRampToValueAtTime(BOSS_DOWN_FREQ_END, now + BOSS_DOWN_SECONDS);
    const g = ctx.createGain();
    g.gain.setValueAtTime(BOSS_DOWN_GAIN, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + BOSS_DOWN_SECONDS);
    osc.connect(g);
    g.connect(this.dry);
    g.connect(this.convolver);
    osc.start(now);
    osc.stop(now + BOSS_DOWN_SECONDS + 0.05);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseLong;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = BOSS_DOWN_NOISE_HZ;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(BOSS_DOWN_NOISE_GAIN, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + BOSS_DOWN_NOISE_SECONDS);
    src.connect(lp);
    lp.connect(ng);
    ng.connect(this.dry);
    ng.connect(this.convolver);
    src.start(now, Math.random());
    src.stop(now + BOSS_DOWN_NOISE_SECONDS + 0.05);
  }

  /** 通過音(見晴らし台に出た瞬間) */
  passage(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = PASSAGE_FREQ;
    const g = ctx.createGain();
    g.gain.setValueAtTime(PASSAGE_GAIN, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + PASSAGE_DECAY);
    osc.connect(g);
    g.connect(this.dry);
    g.connect(this.convolver);
    osc.start(now);
    osc.stop(now + PASSAGE_DECAY + 0.1);
  }

  /**
   * 溜め音の開始・追従・停止。比率 > 0 の間だけノードを持ち、pitch(chargeFreq)・ゲイン(chargeGain)・
   * ローパス(基音の 6 倍)を毎フレーム追従させる。比率が 0 に戻れば(発射・キャンセル共通)
   * 短いリリースで止めて参照を手放すので、ノードは溜まらない。
   */
  private updateCharge(ratio: number): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    if (ratio <= 0) {
      if (!this.charge) return;
      const c = this.charge;
      this.charge = null;
      c.gain.gain.setTargetAtTime(0, now, CHARGE_RELEASE);
      c.main.stop(now + 0.3);
      c.detuned.stop(now + 0.3);
      return;
    }
    if (!this.charge) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 2;
      filter.connect(gain);
      gain.connect(this.dry);
      gain.connect(this.convolver);
      const mk = (detune: number): OscillatorNode => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.detune.value = detune;
        o.connect(filter);
        o.start(now);
        return o;
      };
      // +9 セントの微デチューンでもう 1 本重ね、うなりで「唸り」にする
      this.charge = { main: mk(0), detuned: mk(9), filter, gain };
    }
    const c = this.charge;
    const f = chargeFreq(ratio);
    c.main.frequency.setTargetAtTime(f, now, CHARGE_FOLLOW);
    c.detuned.frequency.setTargetAtTime(f, now, CHARGE_FOLLOW);
    c.filter.frequency.setTargetAtTime(f * 6, now, CHARGE_FOLLOW);
    c.gain.gain.setTargetAtTime(chargeGain(ratio), now, CHARGE_FOLLOW);
  }

  /**
   * ボス予備動作の警告音: 矩形波の短い下降チャープを 1 回だけ鳴らす(passage と同じ
   * ワンショットの流儀)。予備動作の開始(approach→windup の遷移)で main から呼ばれる。
   * 音量は WARN_GAIN で控えめにし、残響は dry のみにして合図として立たせる。
   */
  bossWarn(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(WARN_FREQ_START, now);
    osc.frequency.exponentialRampToValueAtTime(WARN_FREQ_END, now + WARN_SECONDS);
    const g = ctx.createGain();
    g.gain.setValueAtTime(WARN_GAIN, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + WARN_SECONDS);
    osc.connect(g);
    g.connect(this.dry);
    osc.start(now);
    osc.stop(now + WARN_SECONDS + 0.1);
  }

  /** 発射音(重粒子砲): サブ正弦波の pitch 落下(重低音の芯)+ ローパスを落とすノイズ(破裂感) */
  cannonFire(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(FIRE_SUB_START_HZ, now);
    sub.frequency.exponentialRampToValueAtTime(FIRE_SUB_END_HZ, now + FIRE_SUB_SECONDS);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(FIRE_SUB_GAIN, now);
    sg.gain.exponentialRampToValueAtTime(0.001, now + FIRE_SUB_SECONDS);
    sub.connect(sg);
    sg.connect(this.dry);
    sg.connect(this.convolver);
    sub.start(now);
    sub.stop(now + FIRE_SUB_SECONDS + 0.1);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseLong;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.8;
    lp.frequency.setValueAtTime(FIRE_NOISE_START_HZ, now);
    lp.frequency.exponentialRampToValueAtTime(FIRE_NOISE_END_HZ, now + FIRE_NOISE_SECONDS);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(FIRE_NOISE_GAIN, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + FIRE_NOISE_SECONDS);
    src.connect(lp);
    lp.connect(ng);
    ng.connect(this.dry);
    ng.connect(this.convolver);
    src.start(now, Math.random());
    src.stop(now + FIRE_NOISE_SECONDS + 0.1);
  }

  /**
   * 破砕音: 掘削で壊れたタイル数(brokenTiles)に応じたノイズの崩落。1 発で 1 音に集約し、
   * パラメータは crushParams(対数圧縮・上限あり)。壊れていない(0 以下)ときは鳴らさない。
   * ローパスを開始帯域から 180 Hz へ落とし、岩が崩れてくぐもる動きにする。
   */
  cannonCrush(brokenTiles: number): void {
    const ctx = this.ctx;
    if (!ctx || brokenTiles <= 0) return;
    const p = crushParams(brokenTiles);
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseLong;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(p.startHz, now);
    lp.frequency.exponentialRampToValueAtTime(180, now + p.seconds);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(p.gain, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, now + p.seconds);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.dry);
    g.connect(this.convolver);
    src.start(now, Math.random());
    src.stop(now + p.seconds + 0.1);
  }

  private footstep(): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(FOOTSTEP_GAIN, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + FOOTSTEP_SECONDS);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.dry);
    g.connect(this.convolver);
    src.start(now);
    src.stop(now + FOOTSTEP_SECONDS + 0.05);
  }

  /** 層のドローンを切り替える。旧組はゲインを 0 へ追従させて 2 秒後に止める */
  private switchDrone(biome: BiomeId): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const old = this.drone;
    if (old) {
      old.gain.gain.setTargetAtTime(0, now, DRONE_FADE);
      for (const o of old.oscs) o.stop(now + 2);
    }
    const p = droneParams(biome);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.setTargetAtTime(dbToGain(p.gainDb), now, DRONE_FADE);
    gain.connect(this.dry);
    const oscs: OscillatorNode[] = [];
    p.harmonics.forEach((h, i) => {
      const o = ctx.createOscillator();
      o.type = p.type;
      o.frequency.value = p.freq * h;
      const g = ctx.createGain();
      g.gain.value = 1 / (i + 1) / p.harmonics.length; // 高い倍音ほど弱く
      o.connect(g);
      g.connect(gain);
      o.start(now);
      oscs.push(o);
    });
    // 界面のうなり: 基音 + 0.7 Hz の正弦波。ゲインは update で距離に追従
    const beatGain = ctx.createGain();
    beatGain.gain.value = 0;
    beatGain.connect(gain);
    const beat = ctx.createOscillator();
    beat.type = 'sine';
    beat.frequency.value = p.freq + BEAT_DETUNE_HZ;
    beat.connect(beatGain);
    beat.start(now);
    oscs.push(beat);
    this.drone = { biome, gain, beatGain, oscs };
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const n = Math.ceil(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** 合成インパルス応答(指数減衰ノイズ、ステレオ)。バケットごとに 1 回だけ作る */
  private impulseFor(bucket: number): AudioBuffer {
    const cached = this.impulses.get(bucket);
    if (cached) return cached;
    const ctx = this.ctx!;
    const seconds = reverbSecondsForBucket(bucket);
    const n = Math.ceil(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-5 * i / n);
    }
    this.impulses.set(bucket, buf);
    return buf;
  }
}
