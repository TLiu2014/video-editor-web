import { describe, expect, it } from 'vitest';
import { mediaRateFactor, mediaShouldPlay, nextShuttleSpeed } from './shuttle';

describe('JKL shuttle', () => {
  it('starts at 1× in the pressed direction', () => {
    expect(nextShuttleSpeed(1, false, 1)).toBe(1);
    expect(nextShuttleSpeed(1, false, -1)).toBe(-1);
  });
  it('steps up 1 → 2 → 4 → 8 and caps', () => {
    expect(nextShuttleSpeed(1, true, 1)).toBe(2);
    expect(nextShuttleSpeed(4, true, 1)).toBe(8);
    expect(nextShuttleSpeed(8, true, 1)).toBe(8);
    expect(nextShuttleSpeed(-2, true, -1)).toBe(-4);
  });
  it('reversing direction restarts at 1×', () => {
    expect(nextShuttleSpeed(4, true, -1)).toBe(-1);
    expect(nextShuttleSpeed(-8, true, 1)).toBe(1);
  });
  it('media plays only forward, sped up by the shuttle', () => {
    expect(mediaShouldPlay({ isPlaying: true, shuttleSpeed: -2 })).toBe(false);
    expect(mediaShouldPlay({ isPlaying: true, shuttleSpeed: 4 })).toBe(true);
    expect(mediaRateFactor({ shuttleSpeed: 4 })).toBe(4);
    expect(mediaRateFactor({ shuttleSpeed: -4 })).toBe(1);
  });
});
