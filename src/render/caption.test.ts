import { expect, it } from 'vitest';
import { captionAlpha, captionText } from './caption';

it('字幕の文言', () => {
  expect(captionText(2, false)).toBe('第 2 階層');
  expect(captionText(3, true)).toBe('第 3 階層 — 大界面');
});

it('2 秒表示して 0.5 秒でフェード', () => {
  expect(captionAlpha(-0.1)).toBe(0);
  expect(captionAlpha(0)).toBe(1);
  expect(captionAlpha(2)).toBe(1);
  expect(captionAlpha(2.25)).toBeCloseTo(0.5, 5);
  expect(captionAlpha(2.5)).toBe(0);
  expect(captionAlpha(10)).toBe(0);
});
