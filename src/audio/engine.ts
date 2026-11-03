import type { BiomeId } from '../world/biomeCells';
import {
  BEAT_DETUNE_HZ, dbToGain, droneParams, footstepCrossed, HUM_FREQ, interfaceBeat, MASTER_DB, PASSAGE_DECAY, PASSAGE_FREQ,
  reverbBucket, reverbSecondsForBucket,
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
}

const DRONE_FADE = 0.4;
const WET_GAIN = 0.35;
const FOOTSTEP_SECONDS = 0.06;
const FOOTSTEP_GAIN = 0.5;
const HUM_GAIN = 0.06;
const HUM_LFO_HZ = 7;
const BEAT_GAIN = 0.5;
const PASSAGE_GAIN = 0.6;

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
  private impulses = new Map<number, AudioBuffer>();
  private reverbBucketNow = -1;
  private drone: Drone | null = null;
  private humGain!: GainNode;
  private isMuted = false;
  private prevWalkPhase = 0;

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
