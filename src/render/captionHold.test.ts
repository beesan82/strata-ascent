import { describe, expect, it } from 'vitest';
import { CAPTION_FADE_SECONDS, CAPTION_HOLD_SECONDS, captionAlpha, TERMINAL_CAPTION_HOLD_SECONDS } from './caption';

describe('captionAlpha の保持時間(端末の断片テキスト、設計 2026-11-10-infrastructure §4)', () => {
  it('省略時は従来どおり 2 秒保持', () => {
    expect(captionAlpha(CAPTION_HOLD_SECONDS)).toBe(1);
    expect(captionAlpha(CAPTION_HOLD_SECONDS + CAPTION_FADE_SECONDS / 2)).toBeCloseTo(0.5, 9);
  });

  it('端末の保持時間を渡すとその秒数まで不透明で、続く 0.5 秒で消える', () => {
    const hold = TERMINAL_CAPTION_HOLD_SECONDS;
    expect(hold).toBeGreaterThan(CAPTION_HOLD_SECONDS);
    expect(captionAlpha(hold - 0.01, hold)).toBe(1);
    expect(captionAlpha(hold + CAPTION_FADE_SECONDS / 2, hold)).toBeCloseTo(0.5, 9);
    expect(captionAlpha(hold + CAPTION_FADE_SECONDS, hold)).toBe(0);
  });
});
