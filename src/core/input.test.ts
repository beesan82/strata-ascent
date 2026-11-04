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

  it('touchDown 中は fireHeld が立つ(KeyF)', () => {
    const input = new Input();
    expect(input.fireHeld).toBe(false);
    input.touchDown('KeyF');
    expect(input.fireHeld).toBe(true);
    input.touchUp('KeyF');
    expect(input.fireHeld).toBe(false);
  });

  it('タッチ照準点は既定で無効、setTouchPoint で有効になり clearTouchPoint で戻る', () => {
    const input = new Input();
    expect(input.touchPointActive).toBe(false);
    input.setTouchPoint(123, 456);
    expect(input.touchPointActive).toBe(true);
    expect(input.touchPointX).toBe(123);
    expect(input.touchPointY).toBe(456);
    input.clearTouchPoint();
    expect(input.touchPointActive).toBe(false);
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

  it('発射キャンセルの要求は takeFireCancel で 1 回だけ取れる', () => {
    const input = new Input();
    expect(input.takeFireCancel()).toBe(false);
    input.requestFireCancel();
    expect(input.takeFireCancel()).toBe(true);
    expect(input.takeFireCancel()).toBe(false);
  });
});
