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

  it('発射キャンセルの要求は takeFireCancel で 1 回だけ取れる', () => {
    const input = new Input();
    expect(input.takeFireCancel()).toBe(false);
    input.requestFireCancel();
    expect(input.takeFireCancel()).toBe(true);
    expect(input.takeFireCancel()).toBe(false);
  });
});
