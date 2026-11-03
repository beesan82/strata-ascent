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
});
