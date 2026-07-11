import { describe, expect, it } from 'vitest';
import { Camera } from './camera';

describe('Camera', () => {
  it('目標に向かって近づく(指数的追従)', () => {
    const cam = new Camera(0, 0);
    cam.follow(10, -20, 1 / 60);
    expect(cam.x).toBeGreaterThan(0);
    expect(cam.x).toBeLessThan(10);
    expect(cam.y).toBeLessThan(0);
    expect(cam.y).toBeGreaterThan(-20);
  });

  it('時間が経てば目標にほぼ一致する', () => {
    const cam = new Camera(0, 0);
    for (let i = 0; i < 300; i++) cam.follow(10, -20, 1 / 60);
    expect(cam.x).toBeCloseTo(10, 1);
    expect(cam.y).toBeCloseTo(-20, 1);
  });
});
