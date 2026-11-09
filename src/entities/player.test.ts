import { describe, expect, it } from 'vitest';
import { TILE, type Tile } from '../world/tiles';
import { JUMP_VELOCITY, Player, type PlayerInput } from './player';

const noInput: PlayerInput = { left: false, right: false, jump: false, up: false, down: false };
const emptyTiles = (): Tile => TILE.AIR;
/** y=10行が床 */
const floorTiles = (_tx: number, ty: number): Tile => (ty === 10 ? TILE.SOLID : TILE.AIR);
/** x=3列が梯子、y=10行が床 */
const ladderTiles = (tx: number, ty: number): Tile => {
  if (ty === 10) return TILE.SOLID;
  if (tx === 3) return TILE.LADDER;
  return TILE.AIR;
};

describe('Player', () => {
  it('空中では重力で落ちる', () => {
    const p = new Player(0, 0);
    p.update(noInput, 1 / 60, emptyTiles);
    expect(p.body.vy).toBeGreaterThan(0);
    expect(p.body.y).toBeGreaterThan(0);
  });

  it('左右入力で移動する', () => {
    const p = new Player(5, 0);
    p.update({ ...noInput, right: true }, 1 / 60, emptyTiles);
    expect(p.body.x).toBeGreaterThan(5);
  });

  it('接地中のみジャンプできる', () => {
    const p = new Player(0, 8);
    // 着地するまで落とす
    for (let i = 0; i < 120; i++) p.update(noInput, 1 / 60, floorTiles);
    expect(p.body.onGround).toBe(true);
    p.update({ ...noInput, jump: true }, 1 / 60, floorTiles);
    expect(p.body.vy).toBeLessThan(0); // 上向き

    // 空中で再ジャンプはできない(vyは重力に従うだけ)
    const vyAfterJump = p.body.vy;
    p.update({ ...noInput, jump: true }, 1 / 60, floorTiles);
    expect(p.body.vy).toBeGreaterThan(vyAfterJump);
  });

  it('梯子の上では重力を受けず、上入力で昇れる', () => {
    const p = new Player(2.8, 5); // 体の中心xが梯子列(x=3)に重なる
    const y0 = p.body.y;
    p.update({ ...noInput, up: true }, 1 / 60, ladderTiles);
    expect(p.body.y).toBeLessThan(y0);
  });

  it('梯子を登り切って自bandの床行を越えられる(足元判定で頂上バグを回避)', () => {
    // 床帯(band)の梯子は自bandの床行(ty=10)で終わる。梯子の穴はx=3列のみで、
    // 他の列は床行がSOLID。梯子はband内(ty=10..17)を貫通し、床行(ty=10)も
    // 穴(LADDER)として貫いている(worldgenの実装を模す)。
    const climbPastFloorTiles = (tx: number, ty: number): Tile => {
      if (tx === 3 && ty >= 10 && ty <= 17) return TILE.LADDER;
      if (ty === 10) return TILE.SOLID;
      return TILE.AIR;
    };
    const p = new Player(3.1, 15); // 梯子の下の方、体は梯子列(x=3)に収まる(隣列とはみ出さない)
    const upInput = { ...noInput, up: true };
    let minFeet = Infinity;
    for (let i = 0; i < 300; i++) {
      p.update(upInput, 1 / 60, climbPastFloorTiles); // 5秒登り続ける
      minFeet = Math.min(minFeet, p.body.y + p.body.h);
    }
    // 中心タイルのみの旧判定では、体の中心が床行(y=10)を越えた瞬間onLadderがfalseになり、
    // 足はまだ梯子列(穴)の中で上昇の途中なのに重力に切り替わってしまい、
    // 床の上(y<=10)まで登り切れず頂上で足踏みし続ける(実測: 中心のみ判定だとminFeetは
    // 10.58程度で頭打ちになり、決して10を下回らない)。
    // 足元判定を加えた新実装では、床の上まで登り切れる。
    expect(minFeet).toBeLessThanOrEqual(10);

    // 上入力を離し、右へ踏み出して穴の外(SOLIDな床)へ移動すると着地する
    const stepOff = { ...noInput, right: true };
    for (let i = 0; i < 120; i++) p.update(stepOff, 1 / 60, climbPastFloorTiles);
    expect(p.body.onGround).toBe(true);
  });

  it('梯子上でジャンプ入力するとJUMP_VELOCITYで離脱できる', () => {
    const p = new Player(2.8, 12); // 梯子列(x=3)の途中
    p.update({ ...noInput, jump: true }, 1 / 60, ladderTiles);
    expect(p.body.vy).toBe(JUMP_VELOCITY);
  });
});

describe('Player 移動の手触り(アクション化 第1段)', () => {
  const settle = (p: Player, tiles = floorTiles) => {
    for (let i = 0; i < 120; i++) p.update(noInput, 1 / 60, tiles);
  };

  it('横移動は即時ではなく加速し、数フレームで最高速に達する', () => {
    const p = new Player(0, 8);
    settle(p);
    p.update({ ...noInput, right: true }, 1 / 60, floorTiles);
    expect(p.body.vx).toBeGreaterThan(0);
    expect(p.body.vx).toBeLessThan(6); // 1 フレームでは最高速(6)にならない
    for (let i = 0; i < 10; i++) p.update({ ...noInput, right: true }, 1 / 60, floorTiles);
    expect(p.body.vx).toBeCloseTo(6);
    // 離すと短い距離で止まる
    for (let i = 0; i < 10; i++) p.update(noInput, 1 / 60, floorTiles);
    expect(p.body.vx).toBe(0);
  });

  it('長押しジャンプの最大高さは従来と同等(約2.8タイル)', () => {
    const p = new Player(0, 8);
    settle(p);
    const startFeet = p.body.y + p.body.h;
    let minFeet = Infinity;
    for (let i = 0; i < 90; i++) {
      p.update({ ...noInput, jump: true }, 1 / 60, floorTiles);
      minFeet = Math.min(minFeet, p.body.y + p.body.h);
    }
    const height = startFeet - minFeet;
    expect(height).toBeGreaterThan(2.5);
    expect(height).toBeLessThan(3.1);
  });

  it('短押しジャンプは長押しより低くなる(可変ジャンプ)', () => {
    const apexOf = (holdFrames: number): number => {
      const p = new Player(0, 8);
      settle(p);
      let minFeet = Infinity;
      for (let i = 0; i < 90; i++) {
        p.update({ ...noInput, jump: i < holdFrames }, 1 / 60, floorTiles);
        minFeet = Math.min(minFeet, p.body.y + p.body.h);
      }
      return minFeet;
    };
    const shortApex = apexOf(2);
    const longApex = apexOf(90);
    expect(shortApex - longApex).toBeGreaterThan(0.8); // 短押しは 0.8 タイル以上低い
  });

  it('崖を出て 0.1 秒以内なら跳べる(コヨーテタイム)', () => {
    const cliffTiles = (tx: number, ty: number): Tile => (ty === 10 && tx < 5 ? TILE.SOLID : TILE.AIR);
    const p = new Player(2, 8);
    settle(p, cliffTiles);
    // 右端まで歩いて崖を出る
    for (let i = 0; i < 60 && p.body.onGround; i++) p.update({ ...noInput, right: true }, 1 / 60, cliffTiles);
    expect(p.body.onGround).toBe(false);
    // 3 フレーム(=0.05 秒)後に押す
    for (let i = 0; i < 3; i++) p.update(noInput, 1 / 60, cliffTiles);
    p.update({ ...noInput, jump: true }, 1 / 60, cliffTiles);
    expect(p.body.vy).toBeLessThan(0);
  });

  it('着地の直前に押したジャンプが着地と同時に発動する(入力バッファ)', () => {
    const p = new Player(0, 5); // 空中から落ちる
    // 足元が床(行 10)の 0.9 タイル以内に来た落下中に、ジャンプを 1 フレームだけ押して離す
    let pressed = false;
    let jumpedAfterLanding = false;
    let wasGrounded = false;
    for (let i = 0; i < 240; i++) {
      const nearFloor = !p.body.onGround && p.body.y + p.body.h > 9.1;
      const input = nearFloor && !pressed ? { ...noInput, jump: true } : noInput;
      if (nearFloor && !pressed) pressed = true;
      p.update(input, 1 / 60, floorTiles);
      if (wasGrounded && p.body.vy < 0) jumpedAfterLanding = true;
      wasGrounded = p.body.onGround;
    }
    expect(pressed).toBe(true);
    expect(jumpedAfterLanding).toBe(true);
  });

  it('落下中は重力が増す(2 フレーム目の vy が通常重力より大きい)', () => {
    const p = new Player(0, 0);
    p.update(noInput, 1 / 60, emptyTiles); // vy: 0 → 0.5(通常)
    p.update(noInput, 1 / 60, emptyTiles); // 落下中は 1.5 倍: 0.5 + 0.75 = 1.25
    expect(p.body.vy).toBeCloseTo(1.25);
  });
});

describe('Player HP と被弾(アクション化 第4段)', () => {
  it('damage で HP が減り、ノックバックはダメージ源から離れる向き', () => {
    const p = new Player(10, 0);
    expect(p.damage(20)).toBe(true); // 源は右 → 左へ跳ねる
    expect(p.hp).toBe(4);
    expect(p.body.vx).toBeLessThan(0);
    expect(p.body.vy).toBeLessThan(0);
    const q = new Player(10, 0);
    expect(q.damage(0)).toBe(true); // 源は左 → 右へ跳ねる
    expect(q.body.vx).toBeGreaterThan(0);
  });

  it('無敵中はダメージを受けない。1 秒たてば再び受ける', () => {
    const p = new Player(0, 0);
    expect(p.damage(5)).toBe(true);
    expect(p.damage(5)).toBe(false);
    expect(p.hp).toBe(4);
    for (let i = 0; i < 70; i++) p.update(noInput, 1 / 60, emptyTiles);
    expect(p.damage(5)).toBe(true);
    expect(p.hp).toBe(3);
  });

  it('ノックバック中は横入力を受けない', () => {
    const p = new Player(10, 0);
    p.damage(20); // vx は負(左向き)
    p.update({ ...noInput, right: true }, 1 / 60, emptyTiles);
    expect(p.body.vx).toBeLessThan(0); // 右入力に反転していない
  });

  it('HP が 0 で dead、revive で全回復する', () => {
    const p = new Player(0, 0);
    for (let k = 0; k < 5; k++) {
      p.damage(5);
      for (let i = 0; i < 70; i++) p.update(noInput, 1 / 60, emptyTiles);
    }
    expect(p.dead).toBe(true);
    p.revive();
    expect(p.hp).toBe(5);
    expect(p.dead).toBe(false);
  });
});

describe('Player 崖つかみ(段階 2)', () => {
  /** x>=5 かつ y>=10 が固体の塊。縁は (5, 10)、その上(行 8〜9)は空いている */
  const blockTiles = (tx: number, ty: number): Tile =>
    tx >= 5 && ty >= 10 ? TILE.SOLID : TILE.AIR;
  const rightInput = { ...noInput, right: true };
  /** 壁面(x=5)に接した位置から右へ押しながら落とし、掴まるまで進める */
  const fallAndGrab = (tiles = blockTiles): Player => {
    const p = new Player(4.25, 9.3);
    for (let i = 0; i < 10 && !p.ledge; i++) p.update(rightInput, 1 / 60, tiles);
    return p;
  };

  it('落下中に壁へ押していると自動で掴まり、スナップして静止する', () => {
    const p = fallAndGrab();
    expect(p.ledge).toEqual({ side: 1, tx: 5, ty: 10 });
    expect(p.body.x).toBeCloseTo(4.25);
    expect(p.body.y).toBeCloseTo(10.25);
    expect(p.body.vy).toBe(0);
    expect(p.facing).toBe(1);
    // 掴まり中は重力を受けず、横入力でも動かない
    for (let i = 0; i < 30; i++) p.update(rightInput, 1 / 60, blockTiles);
    expect(p.ledge).not.toBeNull();
    expect(p.body.y).toBeCloseTo(10.25);
    expect(p.body.onGround).toBe(false);
  });

  it('壁へ押していなければ掴まらない(落ちていく)', () => {
    const p = new Player(4.25, 9.3);
    for (let i = 0; i < 20; i++) p.update(noInput, 1 / 60, blockTiles);
    expect(p.ledge).toBeNull();
    expect(p.body.y).toBeGreaterThan(10.3); // 縁の高さを通り過ぎている
  });

  it('上昇中(vy < 0)は掴まらない', () => {
    const p = new Player(4.25, 9.3);
    p.body.vy = -10;
    p.update(rightInput, 1 / 60, blockTiles);
    expect(p.ledge).toBeNull();
  });

  it('上入力でよじ登り、縁の上に立つ(通常の地上状態)', () => {
    const p = fallAndGrab();
    p.update({ ...noInput, up: true }, 1 / 60, blockTiles);
    expect(p.ledge).toBeNull();
    expect(p.body.x).toBeCloseTo(5);
    expect(p.body.y).toBeCloseTo(10 - 1.75);
    expect(p.body.onGround).toBe(true);
    for (let i = 0; i < 30; i++) p.update(noInput, 1 / 60, blockTiles);
    expect(p.body.onGround).toBe(true);
    expect(p.body.y + p.body.h).toBeLessThanOrEqual(10 + 1e-6);
  });

  it('ジャンプの押下エッジでもよじ登る。押しっぱなしでは登らない', () => {
    const held = new Player(4.25, 9.3);
    for (let i = 0; i < 10 && !held.ledge; i++) held.update({ ...rightInput, jump: true }, 1 / 60, blockTiles);
    // 掴まる前からジャンプを押し続けていた: 掴まったまま
    expect(held.ledge).not.toBeNull();
    held.update({ ...noInput, jump: true }, 1 / 60, blockTiles);
    expect(held.ledge).not.toBeNull();
    // 離して押し直すと登る
    held.update(noInput, 1 / 60, blockTiles);
    held.update({ ...noInput, jump: true }, 1 / 60, blockTiles);
    expect(held.ledge).toBeNull();
    expect(held.body.onGround).toBe(true);
  });

  it('登り先が固体と重なるなら登らず掴まりを維持する', () => {
    const lowCeiling = (tx: number, ty: number): Tile =>
      blockTiles(tx, ty) === TILE.SOLID || (tx === 5 && ty === 8) ? TILE.SOLID : TILE.AIR;
    const p = fallAndGrab(lowCeiling);
    expect(p.ledge).not.toBeNull();
    p.update({ ...noInput, up: true }, 1 / 60, lowCeiling);
    expect(p.ledge).not.toBeNull();
    expect(p.body.y).toBeCloseTo(10.25);
  });

  it('下入力で手を離して落下を再開する(押し出しなし)', () => {
    const p = fallAndGrab();
    p.update({ ...noInput, down: true }, 1 / 60, blockTiles);
    expect(p.ledge).toBeNull();
    const x0 = p.body.x;
    for (let i = 0; i < 5; i++) p.update(noInput, 1 / 60, blockTiles);
    expect(p.body.y).toBeGreaterThan(10.25);
    expect(p.body.x).toBeCloseTo(x0);
  });

  it('縁から離れる向きの入力で手を離し、壁から離れる向きへ押し出される', () => {
    const p = fallAndGrab();
    p.update({ ...noInput, left: true }, 1 / 60, blockTiles);
    expect(p.ledge).toBeNull();
    expect(p.body.vx).toBeLessThan(0);
    p.update(noInput, 1 / 60, blockTiles);
    expect(p.body.x).toBeLessThan(4.25);
  });

  it('被弾すると掴まりが解除され、通常のノックバックを受ける', () => {
    const p = fallAndGrab();
    expect(p.damage(10)).toBe(true); // 源は右(壁側) → 左へ跳ねる
    expect(p.ledge).toBeNull();
    expect(p.body.vx).toBeLessThan(0);
    expect(p.body.vy).toBeLessThan(0);
    // ノックバック中は壁へ押しても掴み直さない
    for (let i = 0; i < 5; i++) p.update(rightInput, 1 / 60, blockTiles);
    expect(p.ledge).toBeNull();
  });

  it('解除から 0.25 秒は再掴まりしない(クールダウン)', () => {
    const p = fallAndGrab();
    p.update({ ...noInput, down: true }, 1 / 60, blockTiles);
    expect(p.ledge).toBeNull();
    // 毎フレーム掴まれる位置へ戻しながら壁へ押し続け、再び掴まるまでのフレーム数を数える
    let frames = 0;
    while (!p.ledge && frames < 60) {
      p.body.x = 4.25;
      p.body.y = 9.5;
      p.body.vy = 0;
      p.update(rightInput, 1 / 60, blockTiles);
      frames++;
    }
    expect(p.ledge).not.toBeNull();
    expect(frames).toBeGreaterThanOrEqual(15); // 0.25 秒 = 15 フレーム
    expect(frames).toBeLessThanOrEqual(17);
  });

  it('左側の縁にも掴まり、左を向く', () => {
    const blockLeft = (tx: number, ty: number): Tile =>
      tx <= 4 && ty >= 10 ? TILE.SOLID : TILE.AIR;
    const p = new Player(5, 9.3);
    for (let i = 0; i < 10 && !p.ledge; i++) p.update({ ...noInput, left: true }, 1 / 60, blockLeft);
    expect(p.ledge).toEqual({ side: -1, tx: 4, ty: 10 });
    expect(p.facing).toBe(-1);
    p.update({ ...noInput, up: true }, 1 / 60, blockLeft);
    expect(p.ledge).toBeNull();
    expect(p.body.x).toBeCloseTo(5 - 0.75);
    expect(p.body.onGround).toBe(true);
  });

  it('梯子の上では掴まらない', () => {
    // 体の中心列(x=4)が梯子。右の塊は同じ
    const ladderBeside = (tx: number, ty: number): Tile =>
      tx === 4 ? TILE.LADDER : blockTiles(tx, ty);
    const p = new Player(4.25, 9.3);
    for (let i = 0; i < 10; i++) p.update(rightInput, 1 / 60, ladderBeside);
    expect(p.ledge).toBeNull();
  });
});

describe('Player 向きと歩行位相', () => {
  it('左右入力で向きが変わり、入力がなければ維持される', () => {
    const p = new Player(0, 8);
    for (let i = 0; i < 120; i++) p.update(noInput, 1 / 60, floorTiles);
    p.update({ ...noInput, left: true }, 1 / 60, floorTiles);
    expect(p.facing).toBe(-1);
    p.update(noInput, 1 / 60, floorTiles);
    expect(p.facing).toBe(-1);
    p.update({ ...noInput, right: true }, 1 / 60, floorTiles);
    expect(p.facing).toBe(1);
  });

  it('接地して歩いている間だけwalkPhaseが進む', () => {
    const p = new Player(0, 8);
    for (let i = 0; i < 120; i++) p.update(noInput, 1 / 60, floorTiles);
    const before = p.walkPhase;
    p.update(noInput, 1 / 60, floorTiles);
    expect(p.walkPhase).toBe(before); // 静止中は進まない
    p.update({ ...noInput, right: true }, 1 / 60, floorTiles);
    expect(p.walkPhase).toBeGreaterThan(before);
  });

  it('walkPhase は移動距離に比例して進む(歩幅 1 タイル = 位相 π)', () => {
    const p = new Player(0, 8);
    for (let i = 0; i < 120; i++) p.update(noInput, 1 / 60, floorTiles);
    const x0 = p.body.x;
    const phase0 = p.walkPhase;
    for (let i = 0; i < 60; i++) p.update({ ...noInput, right: true }, 1 / 60, floorTiles);
    const distance = p.body.x - x0;
    expect(distance).toBeGreaterThan(3);
    expect((p.walkPhase - phase0) / distance).toBeCloseTo(Math.PI, 1);
  });
});
