import { describe, expect, it } from 'vitest';
import { cannonPhase } from './touch';

describe('cannonPhase(砲ドラッグの位相遷移)', () => {
  it('押下直後は charging、24px を超えると aiming になる', () => {
    expect(cannonPhase('charging', 0)).toBe('charging');
    expect(cannonPhase('charging', 24)).toBe('charging');
    expect(cannonPhase('charging', 25)).toBe('aiming');
  });

  it('aiming から 38px 圏内へ戻ると cancel、離れると aiming に戻る', () => {
    expect(cannonPhase('aiming', 100)).toBe('aiming');
    expect(cannonPhase('aiming', 38)).toBe('cancel');
    expect(cannonPhase('aiming', 39)).toBe('aiming');
    expect(cannonPhase('cancel', 20)).toBe('cancel');
    expect(cannonPhase('cancel', 39)).toBe('aiming');
  });

  it('charging のまま 38px 圏内にいても cancel にはならない(出て戻って初めてキャンセル)', () => {
    expect(cannonPhase('charging', 10)).toBe('charging');
  });
});
