import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Input } from './input';

// Input のコンストラクタは window へリスナを張るだけなので、最小スタブで足りる
beforeEach(() => {
  vi.stubGlobal('window', { addEventListener: () => {} });
});

describe('Input のタッチ入口', () => {
  it('touchDown/touchUp がキー集合へ出入りし、state に反映される', () => {
    const input = new Input();
    input.touchDown('KeyA');
    expect(input.state.left).toBe(true);
    expect(input.state.right).toBe(false);
    input.touchUp('KeyA');
    expect(input.state.left).toBe(false);
  });

  it('touchDown は押下エッジと入力コールバック(音の開始)を発火する', () => {
    const input = new Input();
    const cb = vi.fn();
    input.onInput(cb);
    input.touchDown('Space');
    expect(input.takePressed().has('Space')).toBe(true);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('KeyF は廃止済みで、押しても fireHeld は立たない(設計 §5、§6 段階 2)', () => {
    const input = new Input();
    expect(input.fireHeld).toBe(false);
    input.touchDown('KeyF');
    expect(input.fireHeld).toBe(false);
    input.touchUp('KeyF');
    expect(input.fireHeld).toBe(false);
  });

  it('pulseHeld は KeyJ のタッチ押下で立ち、離すと落ちる', () => {
    const input = new Input();
    expect(input.pulseHeld).toBe(false);
    input.touchDown('KeyJ');
    expect(input.pulseHeld).toBe(true);
    input.touchUp('KeyJ');
    expect(input.pulseHeld).toBe(false);
  });

  it('右スティック照準は既定で無効、setTouchAim で有効になり clearTouchAim で戻る', () => {
    const input = new Input();
    expect(input.touchAimActive).toBe(false);
    input.setTouchAim(0.6, -0.8, 0.8);
    expect(input.touchAimActive).toBe(true);
    expect(input.touchAimX).toBeCloseTo(0.6);
    expect(input.touchAimY).toBeCloseTo(-0.8);
    input.clearTouchAim();
    expect(input.touchAimActive).toBe(false);
  });

  it('発射閾値(0.55)を超えた倒し量では pulseHeld が立ち、照準だけ(0.4)では立たない', () => {
    const input = new Input();
    input.setTouchAim(1, 0, 0.4);
    expect(input.touchAimActive).toBe(true);
    expect(input.pulseHeld).toBe(false);
    input.setTouchAim(1, 0, 0.8);
    expect(input.pulseHeld).toBe(true);
    input.clearTouchAim();
    expect(input.pulseHeld).toBe(false);
  });

  it('デッドゾーン内(0.2)の倒し量では照準も有効にならない', () => {
    const input = new Input();
    input.setTouchAim(1, 0, 0.2);
    expect(input.touchAimActive).toBe(false);
    expect(input.pulseHeld).toBe(false);
  });

  it('保持照準はスティックを離しても残り、次の照準でだけ更新される', () => {
    const input = new Input();
    expect(input.heldAimActive).toBe(false);
    input.setTouchAim(1, 0, 0.8);
    input.clearTouchAim();
    expect(input.heldAimActive).toBe(true);
    expect(input.heldAimX).toBeCloseTo(1);
    expect(input.heldAimY).toBeCloseTo(0);
    input.setTouchAim(0, -1, 0.8);
    expect(input.heldAimX).toBeCloseTo(0);
    expect(input.heldAimY).toBeCloseTo(-1);
  });

  it('武器モードは既定でパルス、toggleWeapon で切り替わり、変更が通知される', () => {
    const input = new Input();
    const cb = vi.fn();
    input.onWeaponChange(cb);
    expect(input.weaponMode).toBe('pulse');
    input.toggleWeapon();
    expect(input.weaponMode).toBe('cannon');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenLastCalledWith('cannon');
    input.toggleWeapon();
    expect(input.weaponMode).toBe('pulse');
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenLastCalledWith('pulse');
  });

  it('スティックを倒したまま切り替えるとニュートラル要求が立つ', () => {
    const input = new Input();
    input.setTouchAim(1, 0, 0.8); // 発射閾値超えで倒し中
    input.toggleWeapon();
    expect(input.weaponMode).toBe('cannon');
    expect(input.weaponNeedsNeutral).toBe(true);
    // スティックを離した状態での切り替えでは立たない
    const input2 = new Input();
    input2.setTouchAim(1, 0, 0.8);
    input2.clearTouchAim();
    input2.toggleWeapon();
    expect(input2.weaponNeedsNeutral).toBe(false);
  });

  it('発射キャンセルの要求は takeFireCancel で 1 回だけ取れる', () => {
    const input = new Input();
    expect(input.takeFireCancel()).toBe(false);
    input.requestFireCancel();
    expect(input.takeFireCancel()).toBe(true);
    expect(input.takeFireCancel()).toBe(false);
  });
});

describe('Input の砲スティック(武器切り替え段階1)', () => {
  /** 砲モードへ切り替えた Input を作る */
  const cannonInput = (): Input => {
    const input = new Input();
    input.toggleWeapon();
    expect(input.weaponMode).toBe('cannon');
    return input;
  };

  it('砲モードでスティックを倒すと溜め(held)が立ち、fireHeld にも反映される', () => {
    const input = cannonInput();
    expect(input.cannonStickHeld).toBe(false);
    input.touchStick(0.8);
    expect(input.cannonStickHeld).toBe(true);
    expect(input.fireHeld).toBe(true);
    input.touchStickEnd();
    expect(input.cannonStickHeld).toBe(false);
    expect(input.fireHeld).toBe(false);
  });

  it('パルスモードではスティックを倒しても砲の溜めは始まらない', () => {
    const input = new Input();
    input.touchStick(0.8);
    expect(input.cannonStickHeld).toBe(false);
    input.touchStickEnd();
    expect(input.takeCannonRelease()).toBe(false);
  });

  it('charging のまま離すと発射候補が立ち、takeCannonRelease で 1 回だけ取れる', () => {
    const input = cannonInput();
    input.touchStick(0.8);
    input.touchStickEnd();
    expect(input.takeCannonRelease()).toBe(true);
    expect(input.takeCannonRelease()).toBe(false);
    expect(input.takeFireCancel()).toBe(false);
  });

  it('中心(0.45 圏内)へ戻して離すとキャンセル要求になり、発射候補は立たない', () => {
    const input = cannonInput();
    input.touchStick(0.8);
    input.touchStick(0.3); // cancel-armed
    expect(input.cannonStickHeld).toBe(true); // 解放までは溜め継続
    input.touchStickEnd();
    expect(input.takeFireCancel()).toBe(true);
    expect(input.takeCannonRelease()).toBe(false);
  });

  it('発射候補は expireCannonRelease で失効する(発射しなかったフレームの残り)', () => {
    const input = cannonInput();
    input.touchStick(0.8);
    input.touchStickEnd();
    input.expireCannonRelease();
    expect(input.takeCannonRelease()).toBe(false);
  });

  it('切り替え直後のニュートラル要求: 倒し続けても溜めは始まらず、戻してから倒すと始まる', () => {
    const input = new Input();
    input.setTouchAim(1, 0, 0.8); // パルス連射中
    expect(input.pulseHeld).toBe(true);
    input.toggleWeapon(); // 砲へ(スティックは倒れたまま)
    expect(input.weaponNeedsNeutral).toBe(true);
    input.touchStick(0.8); // 倒し続ける
    expect(input.cannonStickHeld).toBe(false);
    input.touchStick(0.1); // デッドゾーン以下へ戻す → 解除
    expect(input.weaponNeedsNeutral).toBe(false);
    input.touchStick(0.8); // 倒し直すと溜めが始まる
    expect(input.cannonStickHeld).toBe(true);
  });

  it('ニュートラル要求中はスティックを離しても解除され、その間パルスの暴発もしない', () => {
    const input = new Input();
    input.setTouchAim(1, 0, 0.8);
    input.toggleWeapon(); // 砲へ(needsNeutral)
    input.toggleWeapon(); // パルスへ戻す(スティックはまだ倒れている想定)
    expect(input.weaponMode).toBe('pulse');
    expect(input.weaponNeedsNeutral).toBe(true);
    input.setTouchAim(1, 0, 0.8); // 倒し続けても連射しない
    expect(input.pulseHeld).toBe(false);
    input.clearTouchAim(); // 指を離す
    input.touchStickEnd();
    expect(input.weaponNeedsNeutral).toBe(false);
    input.setTouchAim(1, 0, 0.8); // 倒し直せば連射する
    expect(input.pulseHeld).toBe(true);
  });

  it('砲モードではスティックを深く倒してもパルスは連射しない', () => {
    const input = cannonInput();
    input.setTouchAim(1, 0, 0.9);
    expect(input.touchAimActive).toBe(true); // 照準は共通で有効
    expect(input.pulseHeld).toBe(false);
  });

  it('溜め中の切り替えはキャンセル要求を出してから切り替わる', () => {
    const input = cannonInput();
    input.touchStick(0.8);
    expect(input.cannonStickHeld).toBe(true);
    input.toggleWeapon();
    expect(input.weaponMode).toBe('pulse');
    expect(input.cannonStickHeld).toBe(false);
    expect(input.takeFireCancel()).toBe(true);
    expect(input.takeCannonRelease()).toBe(false);
  });

  it('眺望中はスティックを倒しても溜めが始まらない', () => {
    const input = cannonInput();
    input.touchDown('ShiftLeft');
    input.touchStick(0.8);
    expect(input.cannonStickHeld).toBe(false);
    input.touchStickEnd();
    expect(input.takeCannonRelease()).toBe(false);
    input.touchUp('ShiftLeft');
  });

  it('溜め中に眺望へ入って離すと発射せずキャンセルになる', () => {
    const input = cannonInput();
    input.touchStick(0.8);
    expect(input.cannonStickHeld).toBe(true);
    input.touchDown('ShiftLeft');
    input.touchStickEnd();
    expect(input.takeFireCancel()).toBe(true);
    expect(input.takeCannonRelease()).toBe(false);
    input.touchUp('ShiftLeft');
  });

  it('notifyCannonFired で砲モードからパルスへ自動復帰し、変更が通知される', () => {
    const input = cannonInput();
    const cb = vi.fn();
    input.onWeaponChange(cb);
    input.notifyCannonFired();
    expect(input.weaponMode).toBe('pulse');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenLastCalledWith('pulse');
  });
});

describe('Input の PC 武器切替(武器切り替え段階 2)', () => {
  /** 砲モードへ切り替えた Input を作る */
  const cannonInput = (): Input => {
    const input = new Input();
    input.toggleWeapon();
    expect(input.weaponMode).toBe('cannon');
    return input;
  };

  it('KeyQ の押下エッジで切り替わり、押下中の二重エッジでは連続切り替えしない', () => {
    const input = new Input();
    input.touchDown('KeyQ'); // keydown と同じ pressKey 経路
    expect(input.weaponMode).toBe('cannon');
    input.touchDown('KeyQ'); // 離す前の二重押下はエッジにならない
    expect(input.weaponMode).toBe('cannon');
    input.touchUp('KeyQ');
    input.touchDown('KeyQ');
    expect(input.weaponMode).toBe('pulse');
    input.touchUp('KeyQ');
  });

  it('砲モードで左クリックを押すと溜めが立ち、離すと発射候補が立つ(パルスは出ない)', () => {
    const input = cannonInput();
    input.pressMouseLeft();
    expect(input.mouseCannonHeld).toBe(true);
    expect(input.fireHeld).toBe(true);
    expect(input.pulseHeld).toBe(false); // 砲モードの保持でパルスは連射されない
    input.releaseMouseLeft();
    expect(input.mouseCannonHeld).toBe(false);
    expect(input.fireHeld).toBe(false);
    expect(input.takeCannonRelease()).toBe(true);
    expect(input.takeCannonRelease()).toBe(false);
    expect(input.takeFireCancel()).toBe(false);
  });

  it('パルスモードで左クリックを押すとパルスが立ち、砲の溜めと発射候補は立たない', () => {
    const input = new Input();
    input.pressMouseLeft();
    expect(input.pulseHeld).toBe(true);
    expect(input.fireHeld).toBe(false);
    input.releaseMouseLeft();
    expect(input.pulseHeld).toBe(false);
    expect(input.takeCannonRelease()).toBe(false);
  });

  it('マウスの発射候補も expireCannonRelease で失効する', () => {
    const input = cannonInput();
    input.pressMouseLeft();
    input.releaseMouseLeft();
    input.expireCannonRelease();
    expect(input.takeCannonRelease()).toBe(false);
  });

  it('マウス溜め中の切り替え(KeyQ)はキャンセルしてから切り替わり、その押下ではパルスも出ない', () => {
    const input = cannonInput();
    input.pressMouseLeft();
    expect(input.fireHeld).toBe(true);
    input.touchDown('KeyQ'); // 溜め中の Q = キャンセルしてから切り替え(設計 §3-6、§5)
    expect(input.weaponMode).toBe('pulse');
    expect(input.mouseCannonHeld).toBe(false);
    expect(input.fireHeld).toBe(false);
    expect(input.takeFireCancel()).toBe(true);
    expect(input.takeCannonRelease()).toBe(false);
    // 切り替えの瞬間も左クリックは押されたまま: その押下ではパルス連射も始まらない
    expect(input.weaponNeedsNeutral).toBe(true);
    expect(input.pulseHeld).toBe(false);
    input.touchUp('KeyQ');
    input.releaseMouseLeft(); // 解放でニュートラル要求が解除される
    expect(input.weaponNeedsNeutral).toBe(false);
    expect(input.takeCannonRelease()).toBe(false);
    input.pressMouseLeft(); // 押し直せばパルスが出る
    expect(input.pulseHeld).toBe(true);
    input.releaseMouseLeft();
  });

  it('パルス連射中(左クリック保持)に切り替えると、その押下では溜めが始まらず、押し直すと始まる', () => {
    const input = new Input();
    input.pressMouseLeft();
    expect(input.pulseHeld).toBe(true);
    input.touchDown('KeyQ'); // 砲へ(左クリックは押されたまま)
    expect(input.weaponMode).toBe('cannon');
    expect(input.weaponNeedsNeutral).toBe(true);
    expect(input.mouseCannonHeld).toBe(false);
    expect(input.fireHeld).toBe(false);
    expect(input.pulseHeld).toBe(false);
    input.touchUp('KeyQ');
    input.releaseMouseLeft(); // 解放で解除。その押下の発射候補は立たない
    expect(input.weaponNeedsNeutral).toBe(false);
    expect(input.takeCannonRelease()).toBe(false);
    input.pressMouseLeft(); // 押し直すと溜めが始まる
    expect(input.mouseCannonHeld).toBe(true);
    expect(input.fireHeld).toBe(true);
    input.releaseMouseLeft();
  });

  it('眺望中の左クリックでは溜めが始まらず、解放しても発射候補は立たない', () => {
    const input = cannonInput();
    input.touchDown('ShiftLeft');
    input.pressMouseLeft();
    expect(input.mouseCannonHeld).toBe(false);
    expect(input.fireHeld).toBe(false);
    input.releaseMouseLeft();
    expect(input.takeCannonRelease()).toBe(false);
    input.touchUp('ShiftLeft');
  });

  it('溜め中に眺望へ入って離すと発射せずキャンセルになる(スティックと同型)', () => {
    const input = cannonInput();
    input.pressMouseLeft();
    expect(input.mouseCannonHeld).toBe(true);
    input.touchDown('ShiftLeft');
    input.releaseMouseLeft();
    expect(input.takeFireCancel()).toBe(true);
    expect(input.takeCannonRelease()).toBe(false);
    input.touchUp('ShiftLeft');
  });

  it('window リスナ結線: KeyQ keydown で切り替わりリピートは除かれ、KeyF とマウスも実リスナを通る', () => {
    const handlers = new Map<string, (e: unknown) => void>();
    vi.stubGlobal('window', {
      addEventListener: (type: string, fn: (e: unknown) => void) => handlers.set(type, fn),
    });
    const input = new Input();
    const keydown = handlers.get('keydown')!;
    const keyup = handlers.get('keyup')!;
    const ev = (code: string, repeat = false): KeyboardEvent =>
      ({ code, repeat, preventDefault: () => {} }) as unknown as KeyboardEvent;
    keydown(ev('KeyQ'));
    expect(input.weaponMode).toBe('cannon');
    keydown(ev('KeyQ', true)); // オートリピートは切り替えにならない
    expect(input.weaponMode).toBe('cannon');
    keyup(ev('KeyQ'));
    keydown(ev('KeyF')); // 廃止済み: 押しても溜めは立たない
    expect(input.fireHeld).toBe(false);
    keyup(ev('KeyF'));
    const pointer = (pointerType: string, button: number): PointerEvent =>
      ({ pointerType, button }) as unknown as PointerEvent;
    handlers.get('pointerdown')!(pointer('mouse', 0)); // 砲モード: 左クリックで溜め
    expect(input.fireHeld).toBe(true);
    expect(input.pulseHeld).toBe(false);
    handlers.get('pointerup')!(pointer('mouse', 0));
    expect(input.takeCannonRelease()).toBe(true);
    handlers.get('pointerdown')!(pointer('touch', 0)); // タッチの pointer では溜めもパルスも立たない
    expect(input.fireHeld).toBe(false);
    expect(input.pulseHeld).toBe(false);
  });
});
