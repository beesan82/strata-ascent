import { TILE } from '../world/tiles';
import { walkPhaseAdvance } from '../core/gait';
import { bodyOverlapsSolid, findLedge, moveBody, type Body, type Ledge, type TileLookup } from './physics';

export interface PlayerInput {
  left: boolean;
  right: boolean;
  jump: boolean;
  up: boolean;
  down: boolean;
}

const WALK_SPEED = 6; // タイル/秒
const CLIMB_SPEED = 4;
export const JUMP_VELOCITY = -13;
const GRAVITY = 30;
const MAX_FALL = 25;
// アクション化 第1段(設計書 2026-11-04-action-phase1): 移動の手触り
const ACCEL = 60; // 水平加速(タイル/秒²)。最高速まで 0.1 秒
const DECEL = 90; // 水平減速。離して約 0.07 秒で停止
const JUMP_CUT = 0.45; // 可変ジャンプ: 上昇中に離すと vy をこの倍率に割る
const COYOTE_TIME = 0.1; // 足場を離れてから跳べる猶予(秒)
const JUMP_BUFFER = 0.12; // ジャンプ押下を先行受付する時間(秒)
const FALL_GRAVITY_MULT = 1.5; // 落下時のみ重力を増す(キレ)
// アクション化 第1弾・第4段: HP と被弾
export const MAX_HP = 5;
const INVULN_TIME = 1.0; // 被弾後の無敵時間(秒)
const KNOCK_TIME = 0.25; // 被弾直後に横入力を受け付けない時間(秒)
const KNOCK_VX = 8; // ノックバックの水平速度
const KNOCK_VY = -6; // ノックバックの跳ね上がり
// 段階 2: 崖つかみ(設計 2026-11-09-ledge-grab)
const LEDGE_REGRAB_COOLDOWN = 0.25; // 解除から再掴まりまでの不応期(秒)。解除直後の再掴まりループ防止
const LEDGE_PUSH_VX = 3; // 縁から離れる向きに離したときの小さな押し出し(タイル/秒)
// アニメーション作り込み(設計 2026-11-09-anim-polish): 描画専用の位相とタイマ。
// ゲームプレイ(移動・入力判定)には一切使わない
/**
 * 梯子昇降の位相が π 進む縦移動距離(タイル)。歩行の walkPhaseAdvance(歩幅 1 タイル = π)と同じ流儀で、
 * 音の段の刻み(audio/params.LADDER_RUNG_STEP = 0.5)に揃えて、足の踏み替えと段の音が同期する
 */
export const CLIMB_RUNG_TILES = 0.5;
/** 着地の沈み込みの長さ(秒)。pose 側はこの値で残り時間を正規化する */
export const LAND_POSE_TIME = 0.1;
/**
 * 着地ポーズを数える最小の落下速度(タイル/秒)。着地直後、体が床へ沈み込む数フレームは
 * 接地が点滅し、落下速度 1 前後の小さな再接地が起きる(physics の既存の挙動)。
 * それらでポーズを再点火しないための下限で、沈み込みが見え始める速度(pose 側で 5)より下に置く
 */
export const LAND_MIN_VY = 3;
/** よじ登り直後の復帰ポーズ(屈み→立つ)の長さ(秒) */
export const CLIMB_UP_POSE_TIME = 0.16;
/** 梯子上で足元の床を探るときの下方向の試し量(タイル)。moveBody の探索刻み(1/16)と同じ */
const LADDER_FLOOR_PROBE = 1 / 16;

/** 掴まり中の状態。縁の位置(縁タイルの列・行)と側だけを持つ */
export interface LedgeHold {
  side: 1 | -1;
  tx: number;
  ty: number;
}

function approach(v: number, target: number, delta: number): number {
  return v < target ? Math.min(v + delta, target) : Math.max(v - delta, target);
}

export class Player {
  body: Body;
  /** 向き(1=右, -1=左)。描画用でゲームプレイには影響しない */
  facing: 1 | -1 = 1;
  /** 歩行アニメーションの位相(接地歩行中のみ進む。移動距離駆動: 歩幅 1 タイル = π) */
  walkPhase = 0;
  private coyoteT = 0;
  private bufferT = 0;
  private prevJump = false;
  /** 現在 HP(0 で死亡。復活は main が revive() を呼ぶ) */
  hp = MAX_HP;
  /** 無敵の残り時間(描画の点滅にも使う) */
  invulnT = 0;
  private knockT = 0;
  /** 掴まり中の縁(null なら通常状態)。描画のポーズ判定とハプティクスの発火(main)が読む */
  ledge: LedgeHold | null = null;
  private regrabT = 0;
  // ---- 描画専用(設計 2026-11-09-anim-polish)。物理・入力判定からは読まない ----
  /**
   * 梯子に乗っていて、梯子ポーズで描くべきか(直近の update で判定)。
   * 梯子タイルの上でも、昇降しておらず足元に床があるとき(床面で梯子の列を横切るとき)は false
   */
  onLadderNow = false;
  /** 梯子昇降の位相(昇降中のみ進む。縦移動距離駆動: CLIMB_RUNG_TILES = π)。梯子を離れると 0 に戻る */
  climbPhase = 0;
  /** 着地の沈み込みの残り時間(秒)。接地への遷移で LAND_POSE_TIME を入れ、経過で減る */
  landT = 0;
  /** 着地した瞬間の落下速度(タイル/秒、下が正)。沈み込みの深さを決める */
  landVy = 0;
  /** よじ登り直後の復帰ポーズの残り時間(秒) */
  climbUpT = 0;

  constructor(x: number, y: number) {
    this.body = { x, y, w: 0.75, h: 1.75, vx: 0, vy: 0, onGround: false };
  }

  get centerX(): number {
    return this.body.x + this.body.w / 2;
  }

  get centerY(): number {
    return this.body.y + this.body.h / 2;
  }

  get dead(): boolean {
    return this.hp <= 0;
  }

  /** ノックバック中(被弾直後の横入力を受け付けない間)。安定接地点の記録などで使う */
  get knocked(): boolean {
    return this.knockT > 0;
  }

  /**
   * 敵接触などのダメージ。無敵中は受けない(その場合は false)。
   * fromX はダメージ源の中心 X で、ノックバックはそこから離れる向き。
   */
  damage(fromX: number): boolean {
    if (this.invulnT > 0 || this.dead) return false;
    this.hp -= 1;
    this.invulnT = INVULN_TIME;
    this.knockT = KNOCK_TIME;
    // 掴まり中の被弾は手を離し、通常のノックバックを受ける(設計 §掴まり中)
    if (this.ledge) this.releaseLedge();
    const b = this.body;
    b.vx = this.centerX < fromX ? -KNOCK_VX : KNOCK_VX;
    b.vy = KNOCK_VY;
    return true;
  }

  /** 復活・回復: HP を全回復し、少し長めの無敵を付ける */
  revive(): void {
    this.hp = MAX_HP;
    this.invulnT = INVULN_TIME * 2;
    this.knockT = 0;
    this.body.vx = 0;
    this.body.vy = 0;
    this.ledge = null;
    this.regrabT = 0;
    this.landT = 0;
    this.climbUpT = 0;
  }

  update(input: PlayerInput, dt: number, tiles: TileLookup): void {
    const b = this.body;
    this.invulnT = Math.max(0, this.invulnT - dt);
    this.knockT = Math.max(0, this.knockT - dt);
    this.regrabT = Math.max(0, this.regrabT - dt);
    // 描画専用タイマは掴まり中も進める(よじ登りの復帰ポーズは掴まり解除の直後に始まる)
    this.landT = Math.max(0, this.landT - dt);
    this.climbUpT = Math.max(0, this.climbUpT - dt);

    if (this.ledge) {
      this.updateLedge(input, tiles);
      return;
    }

    // 横移動: 目標速度へ加速/減速で寄せる(空中も同じ)。
    // ノックバック中は入力を受けず、勢いをそのまま流す
    if (this.knockT <= 0) {
      const target = (input.right ? WALK_SPEED : 0) - (input.left ? WALK_SPEED : 0);
      b.vx = approach(b.vx, target, (target === 0 ? DECEL : ACCEL) * dt);
    }

    if (b.vx > 0) this.facing = 1;
    else if (b.vx < 0) this.facing = -1;
    // 位相は時間ではなく移動距離で進める(歩幅と同期させ、足裏の滑りを消す。core/gait)
    if (b.vx !== 0 && b.onGround) this.walkPhase += walkPhaseAdvance(Math.abs(b.vx) * dt);

    // ジャンプの押下エッジでバッファを積み、解放エッジで可変ジャンプの割り込みを行う
    const jumpPressed = input.jump && !this.prevJump;
    const jumpReleased = !input.jump && this.prevJump;
    if (jumpPressed) this.bufferT = JUMP_BUFFER;
    else this.bufferT = Math.max(0, this.bufferT - dt);
    this.prevJump = input.jump;

    const onLadder = this.onLadder(tiles);
    if (onLadder) {
      b.vy = (input.down ? CLIMB_SPEED : 0) - (input.up ? CLIMB_SPEED : 0);
      if (input.jump) b.vy = JUMP_VELOCITY;
      this.coyoteT = 0;
      // 描画専用: 昇降の位相は歩行と同じく移動距離で進める(段の音と同期)。
      // 床面で梯子の列に立っている(昇降せず足元が床)ときは梯子ポーズにしない
      if (b.vy !== 0) this.climbPhase += (Math.PI * Math.abs(b.vy) * dt) / CLIMB_RUNG_TILES;
      this.onLadderNow = b.vy !== 0 || !this.feetSupported(tiles);
    } else {
      this.onLadderNow = false;
      this.climbPhase = 0;
      if (b.onGround) this.coyoteT = COYOTE_TIME;
      else this.coyoteT = Math.max(0, this.coyoteT - dt);

      const canJump = b.onGround || this.coyoteT > 0;
      if ((input.jump && b.onGround) || (this.bufferT > 0 && canJump)) {
        b.vy = JUMP_VELOCITY;
        this.bufferT = 0;
        this.coyoteT = 0;
      } else {
        if (jumpReleased && b.vy < 0) b.vy *= JUMP_CUT;
        const g = b.vy > 0 ? GRAVITY * FALL_GRAVITY_MULT : GRAVITY;
        b.vy = Math.min(b.vy + g * dt, MAX_FALL);
      }
    }

    // 壁へ押している向き(入力優先、無ければ水平速度の向き)。移動解決で vx が 0 に潰れる前に取る
    const pushDir: 1 | -1 | 0 = input.right && !input.left ? 1 : input.left && !input.right ? -1 : b.vx > 0 ? 1 : b.vx < 0 ? -1 : 0;

    // 着地の検出(描画専用): moveBody は下方向の衝突で vy を 0 に潰すので、落下速度は移動前に取る。
    // 着地直後の沈み込み区間の小さな再接地は数えない(LAND_MIN_VY のコメント参照)
    const wasGrounded = b.onGround;
    const fallVy = b.vy;
    moveBody(b, dt, tiles);
    if (!wasGrounded && b.onGround && fallVy >= LAND_MIN_VY) {
      this.landT = LAND_POSE_TIME;
      this.landVy = fallVy;
    }

    // 崖つかみの成立(設計 §掴まりの成立): 空中で落下中(vy >= 0)、壁へ押しており、
    // 不応期とノックバックの外。梯子の上では掴まらない(梯子の操作を優先する)
    if (
      pushDir !== 0 && !b.onGround && b.vy >= 0 && !onLadder &&
      this.regrabT <= 0 && this.knockT <= 0
    ) {
      const ledge = findLedge(b, tiles, pushDir);
      if (ledge) this.grabLedge(ledge);
    }
  }

  /** 掴まる: スナップ位置へ置いて静止し、壁の側を向く */
  private grabLedge(ledge: Ledge): void {
    const b = this.body;
    b.x = ledge.x;
    b.y = ledge.y;
    b.vx = 0;
    b.vy = 0;
    b.onGround = false;
    this.facing = ledge.side;
    this.ledge = { side: ledge.side, tx: ledge.tx, ty: ledge.ty };
    this.coyoteT = 0;
    this.bufferT = 0;
    this.onLadderNow = false;
    this.climbPhase = 0;
  }

  /** 手を離す。どの解除でも再掴まりの不応期が付く */
  private releaseLedge(): void {
    this.ledge = null;
    this.regrabT = LEDGE_REGRAB_COOLDOWN;
  }

  /**
   * 掴まり中(設計 §掴まり中、§解除とよじ登り): 重力を受けず静止する。
   * 上入力かジャンプの押下エッジでよじ登り(登り先が固体と重なるなら維持)、
   * 下入力で手を離して落下、縁から離れる向きの入力で小さく押し出して落下。
   * ジャンプは長押しのままの掴まりで即座に登らないよう押下エッジで見る。
   */
  private updateLedge(input: PlayerInput, tiles: TileLookup): void {
    const b = this.body;
    const l = this.ledge!;
    b.vx = 0;
    b.vy = 0;
    b.onGround = false;
    this.facing = l.side;
    this.coyoteT = 0;
    this.bufferT = 0;
    const jumpPressed = input.jump && !this.prevJump;
    this.prevJump = input.jump;

    if (input.up || jumpPressed) {
      // よじ登り: 縁タイルの上に立つ位置へ即座に移動する
      const cx = l.side === 1 ? l.tx : l.tx + 1 - b.w;
      const cy = l.ty - b.h;
      if (!bodyOverlapsSolid(tiles, cx, cy, b.w, b.h)) {
        b.x = cx;
        b.y = cy;
        b.onGround = true;
        this.releaseLedge();
        // 描画専用: 縁に手をついた屈みから立ち上がる復帰ポーズを出す(移動自体は即時のまま)
        this.climbUpT = CLIMB_UP_POSE_TIME;
      }
      return;
    }
    if (input.down) {
      this.releaseLedge();
      return;
    }
    const away = l.side === 1 ? input.left : input.right;
    if (away) {
      this.releaseLedge();
      b.vx = -l.side * LEDGE_PUSH_VX;
    }
  }

  /**
   * 体の中心タイルだけでなく足元タイル(体がSOLID床に埋まる直前の行)も見る。
   * 中心のみだと、床帯の梯子は自bandの床行で終わっているため、体の中心が
   * 床行を越えた瞬間にonLadderがfalseになり、足はまだ床に埋まっていて
   * 上昇できず梯子の頂上で永久に足踏みするバグがあった。
   */
  private onLadder(tiles: TileLookup): boolean {
    const cx = Math.floor(this.centerX);
    if (tiles(cx, Math.floor(this.centerY)) === TILE.LADDER) return true;
    const feetY = Math.floor(this.body.y + this.body.h - 1e-6);
    return tiles(cx, feetY) === TILE.LADDER;
  }

  /**
   * 足元のすぐ下に床があるか(描画専用)。梯子の上では vy = 0 のとき moveBody が下方向の衝突を
   * 起こさず onGround が立たないので、床面に立ったまま梯子の列にいる状態をこれで見分ける。
   * 物理の onGround には書き戻さない
   */
  private feetSupported(tiles: TileLookup): boolean {
    const b = this.body;
    return bodyOverlapsSolid(tiles, b.x, b.y + LADDER_FLOOR_PROBE, b.w, b.h);
  }
}
