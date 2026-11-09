/**
 * CC0 サンプルの対応表(音質改善、2026-11-08)。ファイル実体は assets/audio/ にあり、
 * 出所と加工内容は assets/audio/CREDITS.md が台帳。Vite のアセットとして import し、
 * base パスには自動で追従させる。ここは「名前 → URL」の写像だけを持ち、鳴らし方は
 * engine.ts、音量やレートの数値は params.ts が決める。
 */
import pulse0 from '../../assets/audio/pulse_0.ogg';
import pulse1 from '../../assets/audio/pulse_1.ogg';
import pulse2 from '../../assets/audio/pulse_2.ogg';
import laserLarge from '../../assets/audio/laser_large.ogg';
import hit0 from '../../assets/audio/hit_0.ogg';
import hit1 from '../../assets/audio/hit_1.ogg';
import downImpact from '../../assets/audio/down_impact.ogg';
import hurtImpact from '../../assets/audio/hurt_impact.ogg';
import land0 from '../../assets/audio/land_0.ogg';
import footstep0 from '../../assets/audio/footstep_0.ogg';
import footstep1 from '../../assets/audio/footstep_1.ogg';
import footstep2 from '../../assets/audio/footstep_2.ogg';
import footstep3 from '../../assets/audio/footstep_3.ogg';
import footstep4 from '../../assets/audio/footstep_4.ogg';
import ladder0 from '../../assets/audio/ladder_0.ogg';
import ladder1 from '../../assets/audio/ladder_1.ogg';
import switch_ from '../../assets/audio/switch.ogg';
import tick from '../../assets/audio/tick.ogg';
import confirm from '../../assets/audio/confirm.ogg';
import pickupCharge from '../../assets/audio/pickup_charge.ogg';
import pickupHeal from '../../assets/audio/pickup_heal.ogg';
import pickupRation from '../../assets/audio/pickup_ration.ogg';
import cache from '../../assets/audio/cache.ogg';
import eat0 from '../../assets/audio/eat_0.ogg';
import eat1 from '../../assets/audio/eat_1.ogg';
import warnError from '../../assets/audio/warn_error.ogg';
import jingleMilestone from '../../assets/audio/jingle_milestone.ogg';
import jingleRecord from '../../assets/audio/jingle_record.ogg';
import rest from '../../assets/audio/rest.ogg';
import crashMetal from '../../assets/audio/crash_metal.ogg';
import explosionCrunch from '../../assets/audio/explosion_crunch.ogg';
import explosionLow from '../../assets/audio/explosion_low.ogg';
import mining0 from '../../assets/audio/mining_0.ogg';
import mining1 from '../../assets/audio/mining_1.ogg';
import thruster from '../../assets/audio/thruster.ogg';
import engineLoop from '../../assets/audio/engine_loop.ogg';

export const SAMPLE_URLS = {
  pulse0, pulse1, pulse2, laserLarge,
  hit0, hit1, downImpact, hurtImpact, land0,
  footstep0, footstep1, footstep2, footstep3, footstep4,
  ladder0, ladder1, switch: switch_, tick, confirm,
  pickupCharge, pickupHeal, pickupRation, cache,
  eat0, eat1, warnError, jingleMilestone, jingleRecord, rest,
  crashMetal, explosionCrunch, explosionLow, mining0, mining1, thruster,
  engineLoop,
} as const;

export type SampleName = keyof typeof SAMPLE_URLS;

/** バリエーションを持つ素材の名前列(選択は params.pickVariant で決定論に行う) */
export const PULSE_SAMPLES: readonly SampleName[] = ['pulse0', 'pulse1', 'pulse2'];
export const HIT_SAMPLES: readonly SampleName[] = ['hit0', 'hit1'];
export const FOOTSTEP_SAMPLES: readonly SampleName[] = ['footstep0', 'footstep1', 'footstep2', 'footstep3', 'footstep4'];
export const LADDER_SAMPLES: readonly SampleName[] = ['ladder0', 'ladder1'];
export const EAT_SAMPLES: readonly SampleName[] = ['eat0', 'eat1'];
export const MINING_SAMPLES: readonly SampleName[] = ['mining0', 'mining1'];

/**
 * ドロップ取得音の素材: 種別で素材を変える。未知の種別は糧食に落とす
 * (params.pickupNotes の既定と同じ考え方で、新種別が増えても無音にしない)。
 */
export function pickupSampleName(kind: string): SampleName {
  if (kind === 'charge') return 'pickupCharge';
  if (kind === 'heal') return 'pickupHeal';
  return 'pickupRation';
}
