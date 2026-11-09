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
  TURRET_SECONDS,
  COMP_ATTACK, COMP_KNEE_DB, COMP_RATIO, COMP_RELEASE, COMP_THRESHOLD_DB, SAMPLE_WET,
  ROOM_IR_SECONDS, ROOM_WET_GAIN, type ReverbSpace,
  HIT_FM_GAIN, HIT_FM_INDEX, HIT_FM_RATIO, pickVariant, sampleRate, ambientGain, DRONE_SYNTH_MUL,
  CRUSH_BIG_TILES, crushSampleGain, PULSE_SAMPLE_GAIN, PULSE_SAMPLE_RATE, PULSE_SAMPLE_SPREAD,
  PULSE_SAMPLE_CUT, PULSE_SAMPLE_WET, PULSE_SUB_GAIN, PULSE_SUB_START_HZ, PULSE_SUB_END_HZ, PULSE_SUB_SECONDS,
  TURRET_SAMPLE_GAIN, TURRET_SAMPLE_RATE, TURRET_SAMPLE_SPREAD, TURRET_SAMPLE_CUT, TURRET_SUB_GAIN,
  CANNON_BODY_GAIN, CANNON_BANG_GAIN, CANNON_BANG_WET,
  CHARGE_SUB_GAIN, chargeSubFreq,
  reverbBucket, reverbSecondsForBucket,
  STARVE_FREQ_END, STARVE_FREQ_START, STARVE_GAIN, STARVE_SECONDS,
  WARN_FREQ_END, WARN_FREQ_START, WARN_GAIN, WARN_SECONDS,
} from './params';

import { AMBIENT_LOOPS, EAT_SAMPLES, FOOTSTEP_SAMPLES, HIT_SAMPLES, LADDER_SAMPLES, MINING_SAMPLES, PULSE_SAMPLES, SAMPLE_URLS, pickupSampleName, type SampleName } from './samples';

/**
 * WebAudio の薄い層(設計書 §6.7)。パラメータは params.ts の純粋関数で決め、ここはノードの生成と
 * ゲインの追従だけ。テスト対象外。
 *
 * グラフ: master → compressor(リミッター寄り) → destination。dry → master、
 * convolver 2 系統(hall = 開放度連動 / room = 固定の短い部屋系)→ wet → master。
 * コンプレッサは音質改善(2026-11-08)で追加し、第 3 ラウンドで天井として締めた。
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
/** ハムのうねり LFO(Hz)。音質改善で 7 → 4.5 に落とし、深度も浅くした */
const HUM_LFO_HZ = 4.5;
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
  /** サブ正弦波(基音の 1/2)。重み付け用に歪ませず直接ゲインへ */
  sub: OscillatorNode;
  /** 深サブ正弦波(30→55 Hz、第 3 ラウンドで追加)。唸りとは別のゲインで低域の重みだけを足す */
  deepSub: OscillatorNode;
  deepSubGain: GainNode;
  /** 帯電ノイズ: バンドパスで基音に追従させ、比率で量を上げる */
  noise: AudioBufferSourceNode;
  noiseFilter: BiquadFilterNode;
  noiseGain: GainNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

interface Drone {
  biome: BiomeId;
  gain: GainNode;
  beatGain: GainNode;
  /** 倍音・うなり・LFO の全オシレータ(切替時に一括 stop する) */
  oscs: OscillatorNode[];
  /** 音色のうねり用ローパス。update で界面への近さにも連動させる */
  filter: BiquadFilterNode;
  cutoff: number;
  /** 環境ループのサンプル層(第 3 ラウンドで実録化、全バイオームにある) */
  layer: AudioBufferSourceNode | null;
  /** 環境ループ専用のゲイン。ドローンとは別系統で dry へ出し、切替時は個別にフェードさせる */
  layerGain: GainNode | null;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private dry!: GainNode;
  private convolver!: ConvolverNode;
  private wet!: GainNode;
  /** 部屋系リバーブ(固定の短い IR)。UI・合図の近い小音用 */
  private roomConvolver!: ConvolverNode;
  private roomWet!: GainNode;
  /** CC0 サンプルのデコード済みバッファ(assets/audio、台帳は CREDITS.md)。ロードは非同期で、無い音は合成で鳴らす */
  private samples = new Map<SampleName, AudioBuffer>();
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
  /** 足音・命中の素材ローテーション用カウンタ(決定論のバリエーション選択) */
  private stepCount = 0;
  private hitCount = 0;
  /** 砲台の発射カウンタ(レートの決定論ばらし用) */
  private turretShotCount = 0;

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
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = COMP_THRESHOLD_DB;
    comp.knee.value = COMP_KNEE_DB;
    comp.ratio.value = COMP_RATIO;
    comp.attack.value = COMP_ATTACK;
    comp.release.value = COMP_RELEASE;
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.loadSamples();
    this.dry = ctx.createGain();
    this.dry.connect(this.master);
    this.convolver = ctx.createConvolver();
    this.wet = ctx.createGain();
    this.wet.gain.value = WET_GAIN;
    this.convolver.connect(this.wet);
    this.wet.connect(this.master);
    this.roomConvolver = ctx.createConvolver();
    this.roomConvolver.buffer = this.makeImpulse(ROOM_IR_SECONDS);
    this.roomWet = ctx.createGain();
    this.roomWet.gain.value = ROOM_WET_GAIN;
    this.roomConvolver.connect(this.roomWet);
    this.roomWet.connect(this.master);
    this.noise = this.makeNoise(FOOTSTEP_SECONDS);
    this.noiseLong = this.makeNoise(LONG_NOISE_SECONDS);
    // 光柱のハム: 基音 + 半オクターブ下をローパスで丸め、遅い LFO でうねらせる(音質改善で耳障りさを除去)
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    this.humGain.connect(this.dry);
    const humLp = ctx.createBiquadFilter();
    humLp.type = 'lowpass';
    humLp.frequency.value = 3200;
    const hum = ctx.createOscillator();
    hum.type = 'sine';
    hum.frequency.value = HUM_FREQ;
    const humSub = ctx.createOscillator();
    humSub.type = 'sine';
    humSub.frequency.value = HUM_FREQ / 2;
    const humSubGain = ctx.createGain();
    humSubGain.gain.value = 0.4;
    const trem = ctx.createGain();
    trem.gain.value = 0.82;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = HUM_LFO_HZ;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.18;
    lfo.connect(lfoDepth);
    lfoDepth.connect(trem.gain);
    hum.connect(humLp);
    humSub.connect(humSubGain);
    humSubGain.connect(humLp);
    humLp.connect(trem);
    trem.connect(this.humGain);
    hum.start();
    humSub.start();
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

  /**
   * CC0 サンプルを全部 fetch + decode して保持する(合計 261 KB)。失敗した素材は
   * 無いものとして扱い、その音は合成フォールバックで鳴らす。開始直後はまだ
   * ロードが済んでいない音があるが、無音期間を作らないための割り切り。
   */
  private loadSamples(): void {
    const ctx = this.ctx!;
    for (const [name, url] of Object.entries(SAMPLE_URLS)) {
      fetch(url)
        .then((r) => r.arrayBuffer())
        .then((ab) => ctx.decodeAudioData(ab))
        .then((buf) => { this.samples.set(name as SampleName, buf); })
        .catch(() => { /* 素材が読めない音は合成で鳴らす */ });
    }
  }

  /** リバーブの送り先。未指定と hall は開放度連動の従来系、room は固定の短い部屋系 */
  private convolverFor(space?: ReverbSpace): ConvolverNode {
    return space === 'room' ? this.roomConvolver : this.convolver;
  }

  /**
   * サンプルのワンショット再生。ロード済みなら true、未ロード/失敗なら false を
   * 返し、呼び出し側が合成フォールバックに倒す。dry は常に送り、wet は残響への
   * 送り量(0 で送らない)。パンは dry 側にだけ付ける(残響は位置を洗うため)。
   * cut はローパスのカットオフ(Hz)で、甲高い素材を個別に暗くする per-sound EQ。
   * space は残響の送り先(既定 hall)。バッファは鳴らし切りだが、他の音と揃えて
   * 明示的に stop を掛ける。
   */
  private playSample(name: SampleName, opts: {
    gain?: number; rate?: number; pan?: number; wet?: number; at?: number;
    cut?: number; space?: ReverbSpace;
  } = {}): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const buf = this.samples.get(name);
    if (!buf) return false;
    const t = opts.at ?? ctx.currentTime;
    const rate = opts.rate ?? 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = opts.gain ?? 1;
    src.connect(g);
    let out: AudioNode = g;
    if (opts.cut) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = opts.cut;
      g.connect(f);
      out = f;
    }
    if (opts.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = opts.pan;
      out.connect(p);
      p.connect(this.dry);
    } else {
      out.connect(this.dry);
    }
    if (opts.wet) {
      const wg = ctx.createGain();
      wg.gain.value = opts.wet;
      out.connect(wg);
      wg.connect(this.convolverFor(opts.space));
    }
    src.start(t);
    src.stop(t + buf.duration / rate + 0.1);
    return true;
  }

  /** WaveShaper の歪みカーブ(量 k ごとに 1 回だけ作って使い回す) */
  private driveCurves = new Map<number, Float32Array>();
  private driveCurve(k: number): Float32Array {
    let curve = this.driveCurves.get(k);
    if (curve) return curve;
    curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = i / 128 - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    this.driveCurves.set(k, curve);
    return curve;
  }

  /**
   * 多層合成のワンショット(音質改善で新設)。1 つの音を「トランジェントのノイズ +
   * 倍音つき胴体(複数オシレータ、FM 可)+ フィルタ掃引 + ADSR + 任意の歪み」で組む。
   * 単一オシレータ + 指数減衰だけの基本形(チープさの原因)を置き換えるための部品で、
   * 数値は呼び出し側が params の定数から渡す。全ソースに stop を掛ける。
   */
  private voice(spec: {
    layers: readonly {
      type: OscillatorType; from: number; to?: number; detune?: number; gain: number;
      fm?: { ratio: number; index: number };
    }[];
    seconds: number;
    gain: number;
    attack?: number;
    filter?: { type: BiquadFilterType; from: number; to?: number; q?: number };
    noise?: { gain: number; type: BiquadFilterType; from: number; to?: number; q?: number; seconds?: number };
    drive?: number;
    pan?: number;
    wet?: number;
    space?: ReverbSpace;
    at?: number;
  }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = spec.at ?? ctx.currentTime;
    const attack = spec.attack ?? 0.004;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(spec.gain, t + attack);
    out.gain.exponentialRampToValueAtTime(0.001, t + spec.seconds);
    // 出口: out → (パン) → dry、wet があれば残響へも送る
    if (spec.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = spec.pan;
      out.connect(p);
      p.connect(this.dry);
    } else {
      out.connect(this.dry);
    }
    if (spec.wet) {
      const wg = ctx.createGain();
      wg.gain.value = spec.wet;
      out.connect(wg);
      wg.connect(this.convolverFor(spec.space));
    }
    // 入口: レイヤー → (歪み) → (フィルタ) → out
    let bus: AudioNode = out;
    if (spec.filter) {
      const f = ctx.createBiquadFilter();
      f.type = spec.filter.type;
      f.Q.value = spec.filter.q ?? 0.8;
      f.frequency.setValueAtTime(spec.filter.from, t);
      if (spec.filter.to) f.frequency.exponentialRampToValueAtTime(spec.filter.to, t + spec.seconds);
      f.connect(out);
      bus = f;
    }
    if (spec.drive) {
      const shaper = ctx.createWaveShaper();
      shaper.curve = this.driveCurve(spec.drive);
      shaper.connect(bus);
      bus = shaper;
    }
    for (const layer of spec.layers) {
      const osc = ctx.createOscillator();
      osc.type = layer.type;
      osc.frequency.setValueAtTime(layer.from, t);
      if (layer.to) osc.frequency.exponentialRampToValueAtTime(layer.to, t + spec.seconds);
      if (layer.detune) osc.detune.value = layer.detune;
      const lg = ctx.createGain();
      lg.gain.value = layer.gain;
      if (layer.fm) {
        const mod = ctx.createOscillator();
        mod.type = 'sine';
        mod.frequency.value = layer.from * layer.fm.ratio;
        const mg = ctx.createGain();
        mg.gain.setValueAtTime(layer.fm.index, t);
        mg.gain.exponentialRampToValueAtTime(1, t + spec.seconds);
        mod.connect(mg);
        mg.connect(osc.frequency);
        mod.start(t);
        mod.stop(t + spec.seconds + 0.1);
      }
      osc.connect(lg);
      lg.connect(bus);
      osc.start(t);
      osc.stop(t + spec.seconds + 0.1);
    }
    if (spec.noise) {
      const n = spec.noise;
      const nSeconds = n.seconds ?? spec.seconds;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseLong;
      src.loop = true;
      const nf = ctx.createBiquadFilter();
      nf.type = n.type;
      nf.Q.value = n.q ?? 0.8;
      nf.frequency.setValueAtTime(n.from, t);
      if (n.to) nf.frequency.exponentialRampToValueAtTime(n.to, t + nSeconds);
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0, t);
      ng.gain.linearRampToValueAtTime(n.gain, t + attack);
      ng.gain.exponentialRampToValueAtTime(0.001, t + nSeconds);
      src.connect(nf);
      nf.connect(ng);
      ng.connect(bus);
      src.start(t, Math.random());
      src.stop(t + nSeconds + 0.1);
    }
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
    // 界面に近いほどドローンのフィルタを開け、うなりと音色の変化を連動させる
    this.drone!.filter.frequency.setTargetAtTime(
      this.drone!.cutoff * (1 + 0.5 * interfaceBeat(frame.plateDistance)), now, 0.3);
    this.startAmbientLayer(this.drone!);
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
   * パルスの発射音(第 3 ラウンドで実録化): 芯は実録の短機関銃(Carl Gustav M45、
   * 3 テイクを決定論にローテーション)。第 2 ラウンドまでの laserSmall(純合成
   * ザップ)は「ピンピン」という甲高さの主因だったため廃止した。胴体の重みは
   * サブサンプ層(正弦波 120→38 Hz)が担う。サンプルが未ロードのときだけ、
   * ローパスで暗くした鋸波の芯に倒す(甲高い音には戻さない)。
   * 発射間隔(1/6 秒)より詰まった呼び出しは PULSE_MIN_INTERVAL で間引く(保険)。
   */
  pulseFire(shotIndex: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    if (now - this.lastPulseAt < PULSE_MIN_INTERVAL) return;
    this.lastPulseAt = now;
    const sampled = this.playSample(PULSE_SAMPLES[pickVariant(shotIndex, PULSE_SAMPLES.length)], {
      gain: PULSE_SAMPLE_GAIN,
      rate: sampleRate(PULSE_SAMPLE_RATE, shotIndex, PULSE_SAMPLE_SPREAD),
      wet: PULSE_SAMPLE_WET,
      cut: PULSE_SAMPLE_CUT,
    });
    // サブサンプ層: 実録の有無によらず毎発鳴らし、低域の胴体を一定に保つ
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(PULSE_SUB_START_HZ * pulseDetune(shotIndex), now);
    sub.frequency.exponentialRampToValueAtTime(PULSE_SUB_END_HZ, now + PULSE_SUB_SECONDS);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(sampled ? PULSE_SUB_GAIN : PULSE_SUB_GAIN * 0.6, now);
    sg.gain.exponentialRampToValueAtTime(0.001, now + PULSE_SUB_SECONDS);
    sub.connect(sg);
    sg.connect(this.dry);
    sub.start(now);
    sub.stop(now + PULSE_SUB_SECONDS + 0.05);
    if (sampled) return;
    const mul = pulseDetune(shotIndex);
    this.voice({
      layers: [{ type: 'sawtooth', from: PULSE_FREQ_START * 1.4 * mul, to: PULSE_FREQ_END * 1.1 * mul, gain: 1 }],
      filter: { type: 'lowpass', from: 3800, to: 900, q: 0.7 },
      seconds: PULSE_SECONDS + 0.02,
      gain: PULSE_GAIN,
    });
  }

  /**
   * 敵への命中(非撃破): 金属打撃のサンプル(バリエーションを決定論に回す)を主体に、
   * FM 合成の金属ティックを薄く重ねる。サンプルが無いときは従来の矩形波+ノイズ。
   */
  enemyHit(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const idx = this.hitCount++;
    if (this.playSample(HIT_SAMPLES[pickVariant(idx, HIT_SAMPLES.length)], {
      gain: 0.6, rate: sampleRate(1, idx, 0.04), wet: 0.3,
    })) {
      this.fmTick(now);
      return;
    }
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

  /** FM 金属ティック: 非整数倍のモジュレータで金属の「キン」を作る短い層 */
  private fmTick(at: number): void {
    const ctx = this.ctx!;
    const carrier = ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.value = HIT_FREQ;
    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = HIT_FREQ * HIT_FM_RATIO;
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(HIT_FM_INDEX, at);
    modGain.gain.exponentialRampToValueAtTime(1, at + HIT_SECONDS);
    mod.connect(modGain);
    modGain.connect(carrier.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(HIT_FM_GAIN, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + HIT_SECONDS);
    carrier.connect(g);
    g.connect(this.dry);
    carrier.start(at);
    carrier.stop(at + HIT_SECONDS + 0.05);
    mod.start(at);
    mod.stop(at + HIT_SECONDS + 0.05);
  }

  /** 敵の撃破: 打撃サンプル + 正弦波の pitch 落下(芯)+ ローパスのノイズ(崩れ)。パルスでもビームでも同じ音 */
  enemyDown(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.playSample('downImpact', { gain: 0.65, wet: 0.4 });
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

  /** プレイヤーの被弾: 打撃サンプル(肉感)+ フィルタで閉じる鋸波の落下。ハプティクス(中)と対になる */
  hurt(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const sampled = this.playSample('hurtImpact', { gain: 0.55, wet: 0.3 });
    this.voice({
      layers: [{ type: 'sawtooth', from: HURT_FREQ_START, to: HURT_FREQ_END, gain: 1 }],
      filter: { type: 'lowpass', from: 1600, to: 300, q: 0.8 },
      drive: 6,
      seconds: HURT_SECONDS + 0.04,
      gain: sampled ? 0.26 : HURT_GAIN,
      wet: 0.3,
    });
  }

  /** 飢餓ダメージ: 被弾とは別の、三角波+サブをローパスで閉じた空虚な下降 + 微かな息のノイズ */
  starveHurt(): void {
    if (!this.ctx) return;
    this.voice({
      layers: [
        { type: 'triangle', from: STARVE_FREQ_START, to: STARVE_FREQ_END, gain: 1 },
        { type: 'sine', from: STARVE_FREQ_START / 2, to: STARVE_FREQ_END / 2, gain: 0.5 },
      ],
      filter: { type: 'lowpass', from: 700, to: 220, q: 0.7 },
      noise: { gain: 0.06, type: 'lowpass', from: 300, seconds: 0.25 },
      seconds: STARVE_SECONDS + 0.08,
      gain: STARVE_GAIN + 0.02,
      attack: 0.02,
    });
  }

  /** プレイヤーの死亡: 多層の pitch 落下(基音+倍音+サブ)+ ノイズの尾 + 落下後の鈍い衝撃 */
  death(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.voice({
      layers: [
        { type: 'sine', from: DEATH_FREQ_START, to: DEATH_FREQ_END, gain: 1 },
        { type: 'triangle', from: DEATH_FREQ_START, to: DEATH_FREQ_END, gain: 0.4 },
        { type: 'sine', from: DEATH_FREQ_START / 2, to: DEATH_FREQ_END / 2, gain: 0.5 },
      ],
      filter: { type: 'lowpass', from: 1200, to: 150, q: 0.7 },
      noise: { gain: 0.12, type: 'lowpass', from: 400, seconds: DEATH_SECONDS + 0.1 },
      seconds: DEATH_SECONDS + 0.15,
      gain: DEATH_GAIN,
      wet: 0.5,
    });
    this.playSample('land0', { gain: 0.2, rate: 0.65, at: now + 0.35, wet: 0.4 });
  }

  /** 復活: 死亡と同一フレームに呼ばれるため、少し遅らせて。素材の上昇音 + 倍音つきパッド 2 音 */
  revive(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + REVIVE_DELAY;
    this.playSample('pickupHeal', { gain: 0.3, rate: 1.25, at: t0, wet: SAMPLE_WET });
    REVIVE_NOTES.forEach((freq, i) => {
      this.voice({
        layers: [
          { type: 'sine', from: freq, gain: 1 },
          { type: 'sine', from: freq * 2, gain: 0.35 },
          { type: 'triangle', from: freq, gain: 0.3 },
        ],
        filter: { type: 'lowpass', from: 1800, q: 0.7 },
        seconds: 0.3,
        gain: REVIVE_GAIN,
        attack: 0.02,
        wet: 0.5,
        at: t0 + i * REVIVE_NOTE_GAP,
      });
    });
  }

  /** ジャンプ: フィルタが開く上昇スイープ + 倍音 + 風切りのノイズ */
  jump(): void {
    if (!this.ctx) return;
    this.voice({
      layers: [
        { type: 'sine', from: JUMP_FREQ_START, to: JUMP_FREQ_END, gain: 0.8 },
        { type: 'triangle', from: JUMP_FREQ_START * 2, to: JUMP_FREQ_END * 2, gain: 0.3 },
      ],
      filter: { type: 'lowpass', from: 500, to: 2400, q: 0.7 },
      noise: { gain: 0.05, type: 'highpass', from: 1800, seconds: 0.1 },
      seconds: JUMP_SECONDS + 0.03,
      gain: JUMP_GAIN + 0.02,
      wet: 0.15,
    });
  }

  /** 着地: 柔らかい重打のサンプルを主体に。ゲインは landGain(落下速度)が決め、0 なら鳴らさない */
  land(fallSpeed: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const gain = landGain(fallSpeed);
    if (gain <= 0) return;
    if (this.playSample('land0', { gain: gain * 1.8, wet: 0.4 })) return;
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

  /** 梯子の段: 金属クリックのサンプル 2 種を段の偶奇で交互に。無いときは従来のノイズティック */
  ladderRung(rungIndex: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.playSample(LADDER_SAMPLES[pickVariant(rungIndex, LADDER_SAMPLES.length)], { gain: 0.5 })) return;
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

  /** ドロップ取得: 種別の素材(pickupSampleName)。無いときは従来の上行 2 音 */
  pickup(kind: string): void {
    if (!this.ctx) return;
    const rate = kind === 'charge' ? 1.1 : kind === 'ration' ? 0.85 : 1;
    if (this.playSample(pickupSampleName(kind), { gain: 0.5, rate, wet: SAMPLE_WET, space: 'room' })) return;
    this.noteRun(pickupNotes(kind), PICKUP_GAIN, PICKUP_NOTE_GAP, 0.16);
  }

  /** 補給キャッシュ開封: 開封のサンプル + バンドパスを掃引するノイズの擦れ(従来層は弱める) */
  cacheOpen(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const sampled = this.playSample('cache', { gain: 0.55, wet: SAMPLE_WET });
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
    g.gain.setValueAtTime(sampled ? CACHE_GAIN * 0.45 : CACHE_GAIN, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + CACHE_SECONDS);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.dry);
    g.connect(this.convolver);
    src.start(now, Math.random());
    src.stop(now + CACHE_SECONDS + 0.05);
  }

  /** 休憩点の初回補給: ピチカートのジングル素材。無いときは従来の温かい上行 2 音 */
  restStock(): void {
    if (!this.ctx) return;
    if (this.playSample('rest', { gain: 0.55, wet: SAMPLE_WET, space: 'room' })) return;
    this.noteRun(REST_STOCK_NOTES, REST_STOCK_GAIN, 0.08, 0.25);
  }

  /** 復活点の更新: 確認音のサンプル。無いときは従来の控えめな単音(移ったときだけ呼ばれる前提) */
  respawnSet(): void {
    if (!this.ctx) return;
    if (this.playSample('confirm', { gain: 0.5, wet: SAMPLE_WET, space: 'room' })) return;
    this.noteRun([RESPAWN_FREQ], RESPAWN_GAIN, 0, RESPAWN_SECONDS + 0.05);
  }

  /** 武器切替: 掛け金(ラッチ)のサンプル。無いときは従来の矩形波クリック */
  weaponSwitch(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.playSample('switch', { gain: 0.55, wet: 0.25, space: 'room' })) return;
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

  /** 砲の弾回復の完了: サンプル(tick)が読めていればそれ、無ければ従来の小さな単音 */
  rechargeTick(): void {
    if (!this.ctx) return;
    if (this.playSample('tick', { gain: 0.5, wet: SAMPLE_WET, space: 'room' })) return;
    this.noteRun([RECHARGE_FREQ], RECHARGE_GAIN, 0, RECHARGE_SECONDS + 0.03);
  }

  /** 満腹度の警告(レベルが low / critical へ落ちた遷移): 警告素材 + 低い三角波の 2 連 */
  satietyWarn(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    this.playSample('warnError', { gain: 0.45, rate: 0.8, wet: 0.2 });
    for (let i = 0; i < 2; i++) {
      this.voice({
        layers: [{ type: 'triangle', from: SATIETY_WARN_FREQ, to: SATIETY_WARN_FREQ * 0.9, gain: 1 }],
        filter: { type: 'lowpass', from: 600, q: 0.7 },
        seconds: SATIETY_WARN_SECONDS + 0.09,
        gain: SATIETY_WARN_GAIN + 0.03,
        at: t0 + i * SATIETY_WARN_GAP,
      });
    }
  }

  /** 糧食の自動摂取: 衣擦れのサンプルを 2 回噛む。無いときは従来のローパスノイズ 2 連 */
  eat(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    if (this.playSample(EAT_SAMPLES[0], { gain: 0.6, at: t0 })
      && this.playSample(EAT_SAMPLES[1], { gain: 0.6, at: t0 + EAT_GAP })) return;
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

  /** 階層の節目到達: 金属ジングルの素材。無いときは従来の 3 音ジングル */
  milestone(): void {
    if (!this.ctx) return;
    if (this.playSample('jingleMilestone', { gain: 0.6, wet: SAMPLE_WET, space: 'room' })) return;
    this.noteRun(MILESTONE_NOTES, JINGLE_GAIN, JINGLE_NOTE_GAP, JINGLE_NOTE_SECONDS);
  }

  /** 最深の新記録: 節目より明るい金属ジングルの素材。無いときは従来の 4 音ジングル */
  newRecord(): void {
    if (!this.ctx) return;
    if (this.playSample('jingleRecord', { gain: 0.6, wet: SAMPLE_WET, space: 'room' })) return;
    this.noteRun(NEW_RECORD_NOTES, JINGLE_GAIN, JINGLE_NOTE_GAP, JINGLE_NOTE_SECONDS);
  }

  /**
   * 砲台の発射(第 3 ラウンドで実録化): laserLarge のザップを廃止し、パルスと
   * 同じ銃(Carl Gustav M45)の中距離テイクを芯にする。同じ世界の武器としての
   * 家族感を持たせつつ、プレイヤーのものより細く・遠く聞こえるよう、芯は
   * 小さく速く(レート 1.12)、ローパスは低め、サブ層は浅くする。未ロード時は
   * 従来の合成胴体(鋸波+サブ+駆動)に倒す。
   */
  turretFire(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const idx = this.turretShotCount++;
    const sampled = this.playSample('turret0', {
      gain: TURRET_SAMPLE_GAIN,
      rate: sampleRate(TURRET_SAMPLE_RATE, idx, TURRET_SAMPLE_SPREAD),
      wet: 0.35,
      cut: TURRET_SAMPLE_CUT,
    });
    const now = ctx.currentTime;
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(100, now);
    sub.frequency.exponentialRampToValueAtTime(40, now + 0.1);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(sampled ? TURRET_SUB_GAIN : TURRET_SUB_GAIN * 0.6, now);
    sg.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    sub.connect(sg);
    sg.connect(this.dry);
    sub.start(now);
    sub.stop(now + 0.15);
    if (sampled) return;
    this.voice({
      layers: [
        { type: 'sawtooth', from: 320, to: 80, gain: 0.8 },
        { type: 'sine', from: 90, to: 45, gain: 0.6 },
      ],
      filter: { type: 'lowpass', from: 2400, to: 300, q: 0.8 },
      noise: { gain: 0.15, type: 'highpass', from: 1200, seconds: 0.12 },
      drive: 8,
      seconds: TURRET_SECONDS + 0.14,
      gain: 0.38,
      wet: 0.3,
    });
  }

  /** 飛行敵の追尾開始: 三角波のチャープをローパスの開閉で柔らかく(矩形波は廃止) */
  flyerAlert(): void {
    if (!this.ctx) return;
    this.voice({
      layers: [{ type: 'triangle', from: FLYER_FREQ_START, to: FLYER_FREQ_END, gain: 1 }],
      filter: { type: 'lowpass', from: 900, to: 2600, q: 1 },
      seconds: FLYER_SECONDS + 0.03,
      gain: FLYER_GAIN + 0.02,
      attack: 0.01,
    });
  }

  /** ボスの出現: 低い正弦波が膨らんで消える + ノイズの地鳴り + 低音爆発の素材を薄く */
  bossAppear(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.playSample('explosionLow', { gain: 0.3, rate: 0.7, wet: 0.6 });
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

  /** ボスの突進開始: 噴射サンプル(rate を上げて加速感) + バンドパスを掃引するノイズの疾走 */
  bossCharge(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const sampled = this.playSample('thruster', { gain: 0.5, rate: 1.3, wet: 0.3 });
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
    g.gain.setValueAtTime(sampled ? BOSS_CHARGE_GAIN * 0.6 : BOSS_CHARGE_GAIN, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + BOSS_CHARGE_SECONDS);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.dry);
    g.connect(this.convolver);
    src.start(now, Math.random());
    src.stop(now + BOSS_CHARGE_SECONDS + 0.05);
  }

  /** ボスの激突(硬直入り): 金属衝突のサンプル + 低いノイズの衝突 + サブのドスン */
  bossCrash(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const sampled = this.playSample('crashMetal', { gain: 0.7, wet: 0.5 });
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseLong;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = BOSS_CRASH_HZ;
    const g = ctx.createGain();
    g.gain.setValueAtTime(sampled ? BOSS_CRASH_GAIN * 0.55 : BOSS_CRASH_GAIN, now);
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

  /** ボスの撃破: 崩壊音のサンプル + 通常撃破より長く重い pitch 落下 + ノイズの崩壊 */
  bossDown(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.playSample('explosionCrunch', { gain: 0.55, rate: 0.9, wet: 0.6 });
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

  /** 通過音(見晴らし台に出た瞬間): 倍音パッドがフィルタを開きながら膨らむ「抜けた」音 */
  passage(): void {
    if (!this.ctx) return;
    this.voice({
      layers: [
        { type: 'sine', from: PASSAGE_FREQ, gain: 0.8 },
        { type: 'sine', from: PASSAGE_FREQ * 1.5, gain: 0.4 },
        { type: 'sine', from: PASSAGE_FREQ * 2, gain: 0.3 },
      ],
      filter: { type: 'lowpass', from: 250, to: 1500, q: 0.6 },
      noise: { gain: 0.03, type: 'bandpass', from: 600, to: 1400, q: 0.8, seconds: PASSAGE_DECAY },
      seconds: PASSAGE_DECAY,
      gain: PASSAGE_GAIN * 0.8,
      attack: 0.35,
      wet: 0.7,
    });
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
      c.deepSubGain.gain.setTargetAtTime(0, now, CHARGE_RELEASE);
      c.main.stop(now + 0.3);
      c.detuned.stop(now + 0.3);
      c.sub.stop(now + 0.3);
      c.deepSub.stop(now + 0.3);
      c.noise.stop(now + 0.3);
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
      // 鋸波のバズは軽い歪みでグリットを付けてからフィルタへ(音質改善)
      const shaper = ctx.createWaveShaper();
      shaper.curve = this.driveCurve(6);
      shaper.connect(filter);
      const mk = (detune: number): OscillatorNode => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.detune.value = detune;
        o.connect(shaper);
        o.start(now);
        return o;
      };
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.connect(gain);
      sub.start(now);
      // 深サブ(第 3 ラウンド): 唸りの共有ゲインとは別系統で、低域の重みだけを足す
      const deepSub = ctx.createOscillator();
      deepSub.type = 'sine';
      deepSub.frequency.value = chargeSubFreq(0);
      const deepSubGain = ctx.createGain();
      deepSubGain.gain.value = 0;
      deepSub.connect(deepSubGain);
      deepSubGain.connect(this.dry);
      deepSub.start(now);
      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseLong;
      noise.loop = true;
      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.Q.value = 1.2;
      const noiseGain = ctx.createGain();
      noiseGain.gain.value = 0;
      noise.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(filter);
      noise.start(now, Math.random());
      // +9 セントの微デチューンでもう 1 本重ね、うなりで「唸り」にする
      this.charge = { main: mk(0), detuned: mk(9), sub, deepSub, deepSubGain, noise, noiseFilter, noiseGain, filter, gain };
    }
    const c = this.charge;
    const f = chargeFreq(ratio);
    c.main.frequency.setTargetAtTime(f, now, CHARGE_FOLLOW);
    c.detuned.frequency.setTargetAtTime(f, now, CHARGE_FOLLOW);
    c.sub.frequency.setTargetAtTime(f / 2, now, CHARGE_FOLLOW);
    c.noiseFilter.frequency.setTargetAtTime(f * 10, now, CHARGE_FOLLOW);
    c.noiseGain.gain.setTargetAtTime(0.05 * ratio, now, CHARGE_FOLLOW);
    c.filter.frequency.setTargetAtTime(f * 6, now, CHARGE_FOLLOW);
    c.gain.gain.setTargetAtTime(chargeGain(ratio), now, CHARGE_FOLLOW);
    c.deepSub.frequency.setTargetAtTime(chargeSubFreq(ratio), now, CHARGE_FOLLOW);
    c.deepSubGain.gain.setTargetAtTime(CHARGE_SUB_GAIN * ratio, now, CHARGE_FOLLOW);
  }

  /**
   * ボス予備動作の警告音: デチューンした鋸波 2 本をバンドパス掃引 + 軽い歪みで
   * 鳴らす下降チャープを 2 連(矩形波は廃止)。予備動作の開始(approach→windup の
   * 遷移)で main から呼ばれる。音量は控えめにし、残響は dry のみにして合図として立たせる。
   */
  bossWarn(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      this.voice({
        layers: [
          { type: 'sawtooth', from: WARN_FREQ_START * 0.84, to: WARN_FREQ_END * 0.84, gain: 0.7 },
          { type: 'sawtooth', from: WARN_FREQ_START * 0.84, to: WARN_FREQ_END * 0.84, detune: 7, gain: 0.5 },
        ],
        filter: { type: 'bandpass', from: 1800, to: 700, q: 1.6 },
        drive: 10,
        seconds: WARN_SECONDS,
        gain: WARN_GAIN + 0.02,
        at: now + i * (WARN_SECONDS + 0.04),
      });
    }
  }

  /**
   * 発射音(重粒子砲): サブ正弦波の pitch 落下(重低音の芯)+ ローパスを落とすノイズ
   * (破裂感)に、低音爆発のサンプル層と歪ませた中域の鋸波を重ねて格上げ(混合)。
   * 第 3 ラウンドで実録レイヤーを 2 枚足した: 散弾銃の胴体(近距離の重い破裂)と
   * 花火の大砲の尾(ホールへ厚く送り、空間の残響で格を出す)。
   */
  cannonFire(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    this.playSample('explosionLow', { gain: 0.35, rate: 0.9, wet: 0.6 });
    this.playSample('cannonBody', { gain: CANNON_BODY_GAIN, wet: 0.35 });
    this.playSample('cannonBang', { gain: CANNON_BANG_GAIN, wet: CANNON_BANG_WET });
    this.voice({
      layers: [{ type: 'sawtooth', from: 300, to: 60, gain: 1 }],
      filter: { type: 'lowpass', from: 2000, to: 200, q: 0.8 },
      drive: 12,
      seconds: 0.28,
      gain: 0.22,
      wet: 0.3,
    });
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
   * 音質改善で、採掘打撃のサンプル(mining)を主体層に足し、大破壊時のみ崩壊音
   * (explosionCrunch)も薄く重ねる(混合)。
   */
  cannonCrush(brokenTiles: number): void {
    const ctx = this.ctx;
    if (!ctx || brokenTiles <= 0) return;
    this.playSample(MINING_SAMPLES[pickVariant(brokenTiles, MINING_SAMPLES.length)], {
      gain: crushSampleGain(brokenTiles),
      rate: sampleRate(0.9, brokenTiles, 0.06),
      wet: 0.5,
    });
    if (brokenTiles >= CRUSH_BIG_TILES) {
      this.playSample('explosionCrunch', { gain: 0.3, rate: 0.8, wet: 0.6 });
    }
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

  /**
   * 足音: コンクリートの足音サンプルを歩数で決定論に回す(5 種)。残響への送りは
   * サンプルの wet でまかなう。無いときは従来のバンドパスノイズ。
   */
  private footstep(): void {
    const ctx = this.ctx!;
    const idx = this.stepCount++;
    if (this.playSample(FOOTSTEP_SAMPLES[pickVariant(idx, FOOTSTEP_SAMPLES.length)], {
      gain: FOOTSTEP_GAIN, rate: sampleRate(1, idx, 0.03), wet: 0.35,
    })) return;
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

  /**
   * 層のドローンを切り替える。旧組はゲインを 0 へ追従させて 2 秒後に止める。
   * 音質改善で、倍音はローパス(遅い LFO でカットオフがうねる)+ ゲインの微かな
   * うねり + 左右への振り分けを通し、静的なオルガン音から「奥行きのある持続音」に
   * 作り替えた。第 3 ラウンドで環境音の主役は実録ループ(startAmbientLayer)に移し、
   * この合成ドローンは地区の音程の色を残す接着剤まで下げた。
   */
  private switchDrone(biome: BiomeId): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const old = this.drone;
    if (old) {
      old.gain.gain.setTargetAtTime(0, now, DRONE_FADE);
      for (const o of old.oscs) o.stop(now + 2);
      if (old.layerGain) old.layerGain.gain.setTargetAtTime(0, now, DRONE_FADE);
      if (old.layer) old.layer.stop(now + 2);
    }
    const p = droneParams(biome);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    // 第 3 ラウンド: 実録ループが主役。合成ドローンは DRONE_SYNTH_MUL で接着剤まで下げる
    gain.gain.setTargetAtTime(dbToGain(p.gainDb) * DRONE_SYNTH_MUL, now, DRONE_FADE);
    gain.connect(this.dry);
    const cutoff = p.freq * 6;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.5;
    filter.frequency.value = cutoff;
    const trim = ctx.createGain();
    trim.gain.value = 0.88;
    filter.connect(trim);
    trim.connect(gain);
    const oscs: OscillatorNode[] = [];
    const mkLfo = (hz: number, depth: number, target: AudioParam): void => {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = hz;
      const lg = ctx.createGain();
      lg.gain.value = depth;
      lfo.connect(lg);
      lg.connect(target);
      lfo.start(now);
      oscs.push(lfo);
    };
    mkLfo(0.07, cutoff * 0.35, filter.frequency);
    mkLfo(0.053, 0.12, trim.gain);
    p.harmonics.forEach((h, i) => {
      const o = ctx.createOscillator();
      o.type = p.type;
      o.frequency.value = p.freq * h;
      const g = ctx.createGain();
      g.gain.value = 1 / (i + 1) / p.harmonics.length; // 高い倍音ほど弱く
      const pan = ctx.createStereoPanner();
      pan.pan.value = i % 2 === 0 ? -0.25 : 0.25; // 倍音を左右へ薄く広げる
      o.connect(g);
      g.connect(pan);
      pan.connect(filter);
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
    this.drone = { biome, gain, beatGain, oscs, filter, cutoff, layer: null, layerGain: null };
    this.startAmbientLayer(this.drone);
  }

  /**
   * 環境ループの実録層(第 3 ラウンド)。バイオーム対応の実録ループを専用ゲインで
   * dry へ直接出し、環境音の主役にする(旧 engineLoop の合成素材は廃止)。
   * サンプルのロードが済んでから呼ばれる場合があるため update からも呼ばれ、
   * 既に敷いてあれば何もしない。フェードイン/アウトは DRONE_FADE でドローンと揃える。
   */
  private startAmbientLayer(d: Drone): void {
    if (d.layer) return;
    const buf = this.samples.get(AMBIENT_LOOPS[d.biome]);
    if (!buf) return;
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.setTargetAtTime(ambientGain(d.biome), now, DRONE_FADE);
    src.connect(g);
    g.connect(this.dry);
    src.start();
    d.layer = src;
    d.layerGain = g;
  }

  private makeNoise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const n = Math.ceil(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** 合成インパルス応答(指数減衰ノイズ、ステレオ)を指定の長さで作る */
  private makeImpulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const n = Math.ceil(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-5 * i / n);
    }
    return buf;
  }

  /** ホール系のインパルス応答。バケットごとに 1 回だけ作る */
  private impulseFor(bucket: number): AudioBuffer {
    const cached = this.impulses.get(bucket);
    if (cached) return cached;
    const buf = this.makeImpulse(reverbSecondsForBucket(bucket));
    this.impulses.set(bucket, buf);
    return buf;
  }
}
